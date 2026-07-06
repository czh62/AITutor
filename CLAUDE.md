# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

AI 辅助教学系统，当前架构：

| 目录 | 角色 | 是否运行 | 技术 |
|---|---|---|---|
| `ui/` | Web 前端（问答+文档+知识图谱三面板） | ✅ 运行（:5173） | React 19 + TS + Vite + Tailwind v4 + Zustand |
| `src/` | 后端（AgentLoop + LightRAG + Quiz + Search） | ✅ 运行（:8000） | FastAPI + httpx + pydantic v2 + SQLAlchemy + OpenAI SDK |
| LightRAG 容器 | 外部 RAG 引擎 | ✅ 运行（:9621） | docker compose |

**运行链路**：浏览器 → vite dev server(:5173) proxy → `src.main:app`(:8000) → LightRAG(:9621) + LLM API。

⚠️ `README.md` 已严重过时（提到的 Streamlit 前端、`requirements.txt`、`start_*.sh`/`.bat`、`tests/` 目录**均不存在**）。以本文件和实际代码为准。旧 `backend/` 和 `frontend/` 目录已删除并迁移到 `src/` + `ui/`。

## 常用命令

```bash
# LightRAG（后端依赖，先起）
docker compose up -d lightrag                        # :9621

# 后端 src/
uvicorn src.main:app --reload --port 8000

# 前端 ui/
cd ui && npm run dev                                  # :5173，vite proxy 自动转发
cd ui && npm run build                                # tsc -b && vite build → dist/
cd ui && npm run lint                                 # tsc --noEmit
cd ui && npm run test                                 # vitest
VITE_USE_MOCK=true npm run dev                        # 前端走 mock，无需 LightRAG/后端
```

Python 依赖按需安装：`fastapi`、`uvicorn`、`sqlalchemy`、`httpx`、`python-multipart`、`pydantic`、`pydantic-settings`、`openai`、`duckduckgo-search`。前端依赖见 `ui/package.json`（`cd ui && npm install`）。

## 前端架构（ui/）

从 LightRAG 官方 `lightrag_webui` 改造而来，结构与 webui 同源。改文档管理界面时，**优先对照 webui 的同名文件**判断是改动还是回归 bug。

- 入口链：`main.tsx` → `App.tsx`。三面板布局：左侧 ActivityBar + DocumentManager（侧边栏）+ QAPanel（问答主区） + GraphViewer（知识图谱），按 tab 用 `visibility:hidden` 切换显隐，**非条件渲染卸载**。默认 tab 为 `'qa'`。
- 路径别名 `@` → `ui/src/`（见 `tsconfig.json` paths 与 `vite.config.ts` resolve.alias）。
- **API 客户端** `src/api/aitutor.ts`：`USE_MOCK = VITE_USE_MOCK==='true'`。mock 模式走 `src/api/mockData.ts`；非 mock 模式全部走真实 HTTP。`backendBaseUrl=''`（空），靠 vite proxy 转发，**生产构建时需改为直连地址**。提供 NDJSON 流式消费函数（`queryStream`/`quizGenerateStream`/`resumeStream`/`quizJudgeStream`/`quizFollowupStream`），统一用 fetch + ReadableStream.getReader() 模式。
- **类型定义** `src/api/types.ts` 对齐后端 schema。核心类型：`ChatMessage`（含 `quizQuestions`/`quizAnswers`/`quizJudgments`/`askUser` 扩展字段）、`QuizQuestion`（6 种题型）、`QuizAnswerState`/`QuizJudgmentState`、`StreamEvent`。
- **Zustand stores**：
  - `stores/qa.ts` — 问答面板状态（messages/queryMode/sessionId），persist 到 localStorage，version=2 带 migrate 清理 stale `isStreaming` 标记。异步回调中必须用 `useQAStore.getState()` 读最新状态，避免 stale closure。
  - `stores/graph.ts` — 知识图谱状态（sigma 实例、graphology graph），**只读**，未移植 webui 的编辑功能。
  - `stores/settings.ts` — 图谱相关设置子集，persist。
- **UI 组件**：
  - `components/chat/` — 问答面板核心组件：QAPanel → ChatComposer + ChatMessage（含 QuizViewer） + AssistantResponse + AskUserCard + ModelThinkingCard + LoopTracePanel
  - `components/chat/QuizViewer.tsx` — **聚合出题组件**（替代原逐题 QuizCard 列表）。导航 chips + 进度条 + 按题型切换输入 + 自动判题(choice/concept/fill_in_blank) / AI判题(short_answer/written/coding) + 追问讲解 inline mini 聊天。作答/判词状态通过 zustand store 持久化。
  - `components/chat/QuizCard.tsx` — 保留但不再渲染，可能用于后续"回顾全部题目"模式。
  - `components/chat/QuizConfigDialog.tsx` — 出题配置对话框（题型/数量/难度）。
  - `components/documents/` — 文档管理对话框。
  - `components/ui/` — 原子组件（Card/Button/Table/Dialog/Tooltip/Popover 等手写，非 shadcn）。
  - `components/graph/` — 知识图谱组件（sigma.js + graphology）。
- **纯函数工具** `src/lib/`：
  - `quiz-grading.ts` — 自动判题纯函数：`isAutoGradable()`/`getUserAnswer()`/`isAnswerCorrect()`/`resolveChoiceAnswerKey()`/`resolveConceptAnswer()`。concept 判断必须用 `resolveConceptAnswer()` 规范化，不要直接 `=== 'true'`。
  - `streamEvents.ts` — NDJSON 流式事件解析与过滤。
  - `thinkSegments.ts` — 思考标签（`<thinking>`）分片逻辑。

**与 webui 的实质差异（易踩坑）**：
1. `documentStatusFilters.ts` 被改写——`completed`/`parse` 桶用数组 `status_filters`（webui 用单值 `status_filter`），并把已废弃的 `preprocessed` 同时塞进 `completed` 和 `parse` 两个桶（webui 不归任何桶）。改过滤逻辑时注意这是有意行为。
2. `DocumentManager.tsx` 的 `fetchDocuments` 请求体多带了一个 `statusFilter` 字段（webui 不带），后端 pydantic 忽略未知字段，无害但属脏数据。
3. **vite 8 + graphology 白屏坑（已在 `vite.config.ts` 修）**：vite 8.1.2 的 import-analysis 把 graphology `Graph` 类里名为 `import`/`export` 的**类方法定义**误判成**动态 `import()` 调用**，注入 `__vite__injectQuery` 破坏方法体 → 白屏。修复：`vite.config.ts` 的 `resolve.alias` 把 `graphology` 指向 CJS 入口 `dist/graphology.cjs.js`。**改 graphology 版本或升 vite 后若再白屏，先查此 alias 是否仍生效。**
4. **切换 tab 白屏坑：GraphViewer 必须常驻不卸载（已在 `App.tsx` 修）**。本仓 `App.tsx` 用两面板常驻 + `visibility` 切换（对齐 webui forceMount）。**勿为"简洁"改回条件渲染**——切换时卸载会导致 sigma 实例与残留 graphology graph 状态冲突 → React 树崩。

**布局约定**：界面高度链完全依赖 `flex` + `min-h-0` + `absolute inset-0` 层层传递。Tailwind 的 `flex-col` **必须配合 `flex`** 才生效——单独写 `flex-col` 会让容器塌缩、子元素 `flex-1` 失效。

**异步回调 stale closure 坑**：QuizViewer 中 `quizJudgeStream`/`quizFollowupStream` 的 onChunk/onDone/onError 回调中，**必须用 `useQAStore.getState()` 读 store 最新状态**，不能用闭包捕获的 render-scope 变量（`judgments[idx]` 总是初始值）。这是 zustand + async callback 的经典坑。

## 后端架构（src/）

核心能力：AgentLoop（tool-calling 循环）+ LightRAG 代理 + 出题判题 + 联网搜索 + 两层记忆。

### 分层

- **`api/` — routers（5 个）**：
  - `query.py` — 知识问答（`POST /query`、`/query/stream`、`/query/resume`），3 个 NDJSON 流式端点
  - `quiz.py` — 出题判题（`POST /quiz/generate`、`/quiz/generate/stream`、`/quiz/judge/stream`、`/quiz/followup/stream`），4 个端点
  - `documents.py` — 文档 CRUD/流水线（9 个端点）
  - `graph.py` — 知识图谱只读转发（4 端点）
  - `health.py` — 聚合健康检查

- **`services/` — 业务服务**：
  - `query_service.py` — `QueryService`：包装 AgentLoop，适配 stream events 为 API 响应
  - `quiz_service.py` — `QuizService`：三阶段出题（RAG 检索 → 规划 → 出题），StreamBus 推送 NDJSON
  - `quiz_judge_service.py` — `QuizJudgeService`：AI 判题 + 追问讲解，**asyncio.create_task + yield 模式**（不是方法体完成后 return bus.stream_lines()）
  - `quiz_prompts.py` / `quiz_judge_prompts.py` — 出题和判题的中文/英文 prompt 模板
  - `quiz_types.py` — 出题内部数据模型（QuizQuestion 等）
  - `lightrag_client.py` — `LightRAGClient`（httpx.AsyncClient），所有方法返回原始 dict
  - `llm_client.py` — `LLMClient`（OpenAI AsyncOpenAI），支持纯文本和 function-calling 两种调用形态
  - `search_client.py` — `SearchClient`（DuckDuckGo 联网搜索，零配置）
  - `__init__.py` — 工厂函数：`create_lightrag_client`/`create_llm_client`/`create_search_client`/`create_quiz_service`/`create_memory_manager`

- **`agentloop/` — AgentLoop 核心**：
  - `loop.py` — `AgentLoop`：tool-calling 循环（RAG/web_search/ask_user 三工具），async generator yield NDJSON
  - `bus.py` — `StreamBus`：NDJSON 流式事件总线（asyncio.Queue + None 哨兵）
  - `stream.py` — `StreamEventType`/`make_event`：事件类型枚举（stage_start/progress/content/thinking/result/error/session/done）
  - `context.py` — `UnifiedContext`：对话上下文管理（消息列表 + 来源 + 系统提示词）
  - `tools.py` — `TOOL_DEFINITIONS`/`dispatch_tool_calls`：3 个工具（rag/web_search/ask_user）
  - `state.py` — 数据类型（AgentLoopState/DispatchOutcome/LoopOutcome/AskUserPayload/ToolCall/SourceItem）
  - `prompt_assembler.py` — `ChatPromptAssembler`：块式系统提示词组装（general → runtime_policy → loop → memory → language）
  - `prompts.py` — 提示词块定义（GENERAL_BLOCK/LOOP_BLOCK/LANGUAGE_BLOCK 等）
  - `think_filter.py` — `InlineThinkFilter`：流式 `<thinking>` 标签分离器
  - `memory.py` — `MemoryManager`：两层记忆（L1 追踪 + L2 摘要），SQLite 存储，重启后清空

- **`schemas/` — pydantic 模型**：`query.py`/`quiz.py`/`documents.py`/`graph.py`/`common.py`，全部 `ConfigDict(extra="ignore")`。
  - `quiz.py` 新增 `QuizJudgeRequest`/`QuizFollowupRequest`/`QuizQuestionResponse`

- **`db/` — SQLAlchemy**：
  - `models.py` — 三表：`ChatSession`（ask_user 暂停恢复）、`TraceEvent`（L1 追踪）、`MemorySummary`（L2 摘要）
  - `session.py` — engine/会话，`reset_database()` 每次 startup 删 SQLite 文件重建

- **`core/`**：`config.py`（pydantic-settings）、`exceptions.py`（AppException 体系）、`logging.py`、`middleware.py`（请求 ID + 日志）

### 关键设计模式

**StreamBus + asyncio.create_task + yield 流式模式**：
所有 NDJSON 流式端点（query/stream、quiz/generate/stream、quiz/judge/stream、quiz/followup/stream）统一采用此模式：
1. 创建 StreamBus
2. `asyncio.create_task(_run())` 后台运行业务逻辑
3. `async for line in bus.stream_lines(): yield line` 前台并行消费 queue
4. 最后 `await task` 确保异常不丢

**不要用** `return bus.stream_lines()`——这会让整个方法体先完成再返回生成器，客户端收不到实时流。必须用 yield 模式让方法成为真正的 async generator。

**依赖注入**：路由层用 `Depends(get_xxx)` 从 `app.state` 获取服务实例。`QuizJudgeService` 通过 `get_llm_client` 获取 LLMClient 临时构造（不存 app.state），避免访问 QuizService 的私有 `_llm` 属性。

**异常转换**：`LightRAGClient._handle_error` 把 httpx 错误映射为 `AppException` 子类。`main.py` 全局 handler 统一返回 `{detail, code}`。新增路由沿用此模式，不要在 endpoint 里写 try/except + HTTPException。

## API 端点一览

| 端点 | 方法 | 说明 |
|---|---|---|
| `/query` | POST | 非流式 AgentLoop 查询 |
| `/query/stream` | POST | NDJSON 流式 AgentLoop 查询 |
| `/query/resume` | POST | NDJSON 恢复 ask_user 暂停会话 |
| `/quiz/generate` | POST | 非流式出题 |
| `/quiz/generate/stream` | POST | NDJSON 流式出题 |
| `/quiz/judge/stream` | POST | NDJSON 流式 AI 判题 |
| `/quiz/followup/stream` | POST | NDJSON 流式追问讲解 |
| `/documents/paginated` | POST | 文档分页查询 |
| `/documents` | POST | 上传文档 |
| `/documents/{id}` | GET/DELETE | 单文档操作 |
| `/documents/pipeline_status` | GET | 流水线状态 |
| `/documents/pipeline_status/{id}` | GET | 单文档流水线状态 |
| `/graphs` | GET | 知识图谱数据 |
| `/graph/label/list` | GET | 标签列表 |
| `/graph/label/popular` | GET | 热门标签 |
| `/graph/label/search` | GET | 标签搜索 |
| `/health` | GET | 聚合健康检查 |

## LightRAG API 契约（易错点）

前端与 `src/` schema 均对齐此契约：

- `POST /documents/paginated`（**POST + JSON body**，非 GET query）。`status_filters`(数组) 优先于 `status_filter`(单值)。
- **`status_counts` 是全库计数（不受当前过滤影响）**，且一定含 `"all"` 键。
- `DocStatus` 枚举值全小写：`pending`/`parsing`/`analyzing`/`processing`/`preprocessed`(已废弃)/`processed`/`failed`。
- `GET /health` 返回 `pipeline_busy`（**非** `pipelineActive`）+ `auth_mode`。
- `GET /documents/pipeline_status` 的 `job_start` 是 **ISO 8601 字符串**（非毫秒时间戳）。
- 鉴权：LightRAG `AUTH_MODE=disabled` 时免 token（当前配置）。

## 配置（.env）

根目录 `.env`（`.gitignore` 忽略）有双重角色：
1. **给 LightRAG 容器**配 LLM/Embedding/Rerank（`LLM_BINDING`、`EMBEDDING_*` 等），`docker-compose.yml` 挂载 `/app/.env`。
2. **`src/` 后端**也读 `.env`（pydantic-settings），用 `database_url`/`lightrag_base_url`/`llm_binding_host`/`llm_model`/`search_enabled` 等。

`data/` 目录：`aitutor.db`（业务库）、`rag_storage/`+`inputs/`+`prompts/`（LightRAG 容器卷）、`uploads/`。`data/` 整体被 `.gitignore` 忽略。**`main.py` 每次 startup 删 SQLite 文件重建**——业务数据重启后丢失。
