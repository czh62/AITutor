# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## 项目概览

AI 辅助教学系统，当前架构：

| 目录 | 角色 | 是否运行 | 技术 |
|---|---|---|---|
| `ui/` | Web 前端（问答+文档+知识图谱三面板） | ✅ 运行（:5173） | React 19 + TS + Vite + Tailwind v4 + Zustand |
| `src/` | 后端（AgentLoop + LightRAG + Quiz + Search） | ✅ 运行（:8000） | FastAPI + httpx + pydantic v2 + SQLAlchemy + OpenAI SDK |
| LightRAG 容器 | 外部 RAG 引擎 | ✅ 运行（:9621） | docker compose |

**运行链路**：浏览器 → vite dev server(:5173) proxy → `src.main:app`(:8000) → LightRAG(:9621) + LLM API。

⚠️ `README.md` 已严重过时。以本文件和实际代码为准。旧 `backend/` 和 `frontend/` 目录已删除并迁移到 `src/` + `ui/`。

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
- **API 客户端** `src/api/aitutor.ts`：`USE_MOCK = VITE_USE_MOCK==='true'`。提供 NDJSON 流式消费函数（`queryStream`/`quizGenerateStream`/`resumeStream`/`quizJudgeStream`/`quizFollowupStream`），统一用 fetch + ReadableStream.getReader() 模式。
- **类型定义** `src/api/types.ts` 对齐后端 schema。核心类型：`ChatMessage`（含 `quizQuestions`/`quizAnswers`/`quizJudgments`/`askUser` 扩展字段）、`QuizQuestion`（6 种题型）、`QuizAnswerState`/`QuizJudgmentState`、`StreamEvent`。
- **Zustand stores**：
  - `stores/qa.ts` — 问答面板状态（messages/queryMode/sessionId），persist 到 localStorage，version=2 带 migrate 清理 stale `isStreaming` 标记。异步回调中必须用 `useQAStore.getState()` 读最新状态，避免 stale closure。
  - `stores/graph.ts` — 知识图谱状态（sigma 实例、graphology graph），**只读**。
  - `stores/settings.ts` — 图谱相关设置子集，persist。
- **UI 组件**：
  - `components/chat/QuizViewer.tsx` — **聚合出题组件**（替代原逐题 QuizCard 列表）。导航 chips + 进度条 + 按题型切换输入 + 自动判题/AI判题 + 追问讲解 inline mini 聊天。作答/判词状态通过 zustand store 持久化。
  - `components/chat/QuizCard.tsx` — 保留但不再渲染。
  - `components/chat/QuizConfigDialog.tsx` — 出题配置对话框。
  - `components/documents/` — 文档管理对话框。
  - `components/ui/` — 原子组件（手写，非 shadcn）。
  - `components/graph/` — 知识图谱组件。
- **纯函数工具** `src/lib/`：
  - `quiz-grading.ts` — 自动判题：`isAutoGradable()`/`getUserAnswer()`/`isAnswerCorrect()`/`resolveChoiceAnswerKey()`/`resolveConceptAnswer()`。concept 判断必须用 `resolveConceptAnswer()` 规范化。
  - `streamEvents.ts` — NDJSON 流式事件解析与过滤。
  - `thinkSegments.ts` — 思考标签分片逻辑。

**与 webui 的实质差异（易踩坑）**：
1. `documentStatusFilters.ts` 被改写——`completed`/`parse` 桶用数组 `status_filters`。
2. **vite 8 + graphology 白屏坑**：`vite.config.ts` 的 `resolve.alias` 把 `graphology` 指向 CJS 入口。**改版本或升 vite 后若再白屏，先查此 alias。**
3. **GraphViewer 必须常驻不卸载**：用两面板常驻 + `visibility` 切换。**勿改回条件渲染**。
4. **布局约定**：`flex-col` **必须配合 `flex`** 才生效——单独写会让容器塌缩。

**异步回调 stale closure 坑**：QuizViewer 中流式回调**必须用 `useQAStore.getState()` 读 store 最新状态**，不能用闭包捕获的 render-scope 变量。

## 后端架构（src/）

核心能力：AgentLoop（tool-calling 循环）+ LightRAG 代理 + 出题判题 + 联网搜索 + 两层记忆。

### 分层

- **`api/` — routers（5 个）**：
  - `query.py` — 知识问答（3 端点：`/query`、`/query/stream`、`/query/resume`）
  - `quiz.py` — 出题判题（4 端点：`/quiz/generate`、`/quiz/generate/stream`、`/quiz/judge/stream`、`/quiz/followup/stream`）
  - `documents.py` — 文档 CRUD/流水线（9 端点）
  - `graph.py` — 知识图谱只读（4 端点）
  - `health.py` — 健康检查

- **`services/` — 业务服务**：
  - `query_service.py` — 包装 AgentLoop
  - `quiz_service.py` — 三阶段出题（RAG→规划→出题）
  - `quiz_judge_service.py` — AI 判题 + 追问讲解，**asyncio.create_task + yield 模式**
  - `quiz_prompts.py` / `quiz_judge_prompts.py` — prompt 模板
  - `lightrag_client.py` — `LightRAGClient`，所有方法返回原始 dict
  - `llm_client.py` — `LLMClient`（OpenAI SDK），纯文本 + function-calling
  - `search_client.py` — `SearchClient`（DuckDuckGo）
  - `__init__.py` — 工厂函数

- **`agentloop/` — AgentLoop 核心**：
  - `loop.py` — tool-calling 循环（rag/web_search/ask_user），async generator
  - `bus.py` — `StreamBus`（asyncio.Queue + None 哨兵）
  - `stream.py` — `StreamEventType` 事件枚举
  - `context.py` — `UnifiedContext` 对话上下文
  - `tools.py` — 工具定义与分发（3 个工具）
  - `state.py` — 数据类型
  - `prompt_assembler.py` + `prompts.py` — 块式系统提示词
  - `think_filter.py` — `<thinking>` 标签分离
  - `memory.py` — `MemoryManager`（L1追踪+L2摘要，重启清空）

- **`schemas/`** — pydantic 模型，全部 `ConfigDict(extra="ignore")`
- **`db/`** — SQLAlchemy 三表（ChatSession/TraceEvent/MemorySummary），startup 时删 SQLite 重建
- **`core/`** — config/exceptions/logging/middleware

### 关键设计模式

**StreamBus + asyncio.create_task + yield 流式模式**：
所有 NDJSON 流式端点统一采用此模式。**不要用 `return bus.stream_lines()`**——必须用 yield 模式让方法成为真正的 async generator。

**依赖注入**：`Depends(get_xxx)` 从 `app.state` 获取服务。`QuizJudgeService` 通过 `get_llm_client` 获取 LLMClient 临时构造，避免访问私有属性。

**异常转换**：全局 handler 统一返回 `{detail, code}`。新增路由沿用此模式，不要写 try/except + HTTPException。

## API 端点一览

| 端点 | 方法 | 说明 |
|---|---|---|
| `/query` | POST | 非流式 AgentLoop 查询 |
| `/query/stream` | POST | NDJSON 流式查询 |
| `/query/resume` | POST | 恢复暂停会话 |
| `/quiz/generate` | POST | 非流式出题 |
| `/quiz/generate/stream` | POST | 流式出题 |
| `/quiz/judge/stream` | POST | 流式 AI 判题 |
| `/quiz/followup/stream` | POST | 流式追问讲解 |
| `/documents/paginated` | POST | 文档分页 |
| `/documents` | POST | 上传文档 |
| `/documents/{id}` | GET/DELETE | 单文档操作 |
| `/documents/pipeline_status` | GET | 流水线状态 |
| `/documents/pipeline_status/{id}` | GET | 单文档流水线 |
| `/graphs` | GET | 图谱数据 |
| `/graph/label/list` | GET | 标签列表 |
| `/graph/label/popular` | GET | 热门标签 |
| `/graph/label/search` | GET | 标签搜索 |
| `/health` | GET | 健康检查 |

## LightRAG API 契约（易错点）

- `POST /documents/paginated`（POST + JSON body）。`status_filters`(数组) 优先于 `status_filter`(单值)。
- **`status_counts` 是全库计数**，含 `"all"` 键。
- `DocStatus` 全小写。`GET /health` 返回 `pipeline_busy`（非 `pipelineActive`）。
- 鉴权：当前 `AUTH_MODE=disabled` 免 token。

## 配置（.env）

根目录 `.env` 双重角色：LightRAG 容器配置 + `src/` 后端配置。`data/` 整体 `.gitignore`。**`main.py` 每次 startup 删 SQLite 重建**——业务数据重启后丢失。
