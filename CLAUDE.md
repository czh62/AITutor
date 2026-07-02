# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

AI 辅助教学系统，处于架构迁移中，当前有**三套并存代码**：

| 目录 | 角色 | 是否运行 | 技术 |
|---|---|---|---|
| `frontend/` | 文档管理 Web 前端 | ✅ 运行 | React 19 + TS + Vite + Tailwind v4 |
| `src/` | 新后端（LightRAG 薄代理层） | ✅ 运行（:8000） | FastAPI + httpx + pydantic v2 |
| `backend/` | 旧业务后端（技能树/问答/测验/复习） | ❌ 未运行 | FastAPI + SQLAlchemy |
| LightRAG 容器 | 外部 RAG 引擎 | ✅ 运行（:9621） | docker compose |

**运行链路**：浏览器 → vite dev server(:5173) proxy → `src.main:app`(:8000) → LightRAG(:9621)。
`backend/` 不在这条链路上，是历史业务逻辑的载体，保留待迁移到 `src/`。

⚠️ `README.md` 已严重过时（提到的 Streamlit 前端、`requirements.txt`、`start_*.sh`/`.bat`、`tests/` 目录**均不存在**）。以本文件和实际代码为准。

## 常用命令

```bash
# LightRAG（后端依赖，先起）
docker compose up -d lightrag                        # :9621

# 新后端 src/（前端实际调用的后端）
uvicorn src.main:app --reload --port 8000

# 前端
cd frontend && npm run dev                           # :5173，vite proxy 自动转发
cd frontend && npm run build                         # tsc -b && vite build → dist/
cd frontend && npm run lint                          # eslint
VITE_USE_MOCK=true npm run dev                       # 前端走 mock，无需 LightRAG/后端

# 旧后端 backend/（如需独立运行）
uvicorn backend.main:app --reload --port 8000
```

无 `requirements.txt`，按需安装：`fastapi`、`uvicorn`、`sqlalchemy`、`httpx`、`python-multipart`、`pydantic`、`pydantic-settings`。前端依赖见 `frontend/package.json`（`cd frontend && npm install`）。

`tests/` 目录已删除；旧 `backend/` 原有的 unittest 测试暂无。

## 前端架构（frontend/）

从 LightRAG 官方 `lightrag_webui`（见 `/Users/mike/PycharmProjects/LightRAG/lightrag_webui`）改造而来，结构与 webui 同源。改文档管理界面时，**优先对照 webui 的同名文件**判断是改动还是回归 bug。

- 入口链：`main.tsx` → `App.tsx`（`<SiteHeader/>` + `<DocumentManager/>` 与 `<GraphViewer/>` 两面板**常驻挂载**，按 tab 用 `visibility:hidden` 切换显隐，**非条件渲染卸载**）。SiteHeader 双选项块「文档 / 知识图谱」，tab 状态在 `App.tsx` 用 useState 管理（非 radix Tabs）。
- 路径别名 `@` → `frontend/src/`（见 `tsconfig.json` paths 与 `vite.config.ts` resolve.alias）。
- API 客户端 `src/api/aitutor.ts`：`USE_MOCK = VITE_USE_MOCK==='true'`。mock 模式走 `src/api/mockData.ts` 内的内存存储 + 模拟流水线 + mock 图谱；非 mock 模式全部走真实 HTTP。`backendBaseUrl=''`（空），靠 vite proxy 转发，**生产构建时需改为直连地址**。
- 类型定义 `src/api/types.ts` 严格对齐 LightRAG 契约（见下）。`src/features/documentStatusFilters.ts` 把前端过滤桶（all/completed/parse/analyze/process/failed）映射为 LightRAG 的 `status_filter`/`status_filters`。
- UI 原子组件在 `src/components/ui/`（Card/Button/Table/Dialog/Tooltip/Popover 等手写，非 shadcn 自动生成），文档相关对话框在 `src/components/documents/`。
- **知识图谱查看器**（`features/GraphViewer.tsx` + `components/graph/*`，从 webui 同名文件移植）：基于 sigma.js + graphology + zustand。`stores/graph.ts`（共享图谱状态，已剥离 edit 方法）、`stores/settings.ts`（图谱相关设置子集，persist）、`hooks/useLightragGraph.tsx`（已剥离 expand/prune 分支）、`utils/graphColor.ts`。**只读**——未移植 webui 的实体/关系编辑（EditablePropertyRow/PropertyEditDialog/MergeDialog）。i18n 全部替换为硬编码中文；`useIsDarkMode` 读本仓 `ThemeProvider` 而非 webui settings store。`@react-sigma/graph-search` 未引入（GraphSearch 自写）。

**与 webui 的实质差异（易踩坑）**：
1. `documentStatusFilters.ts` 被改写——`completed`/`parse` 桶用数组 `status_filters`（webui 用单值 `status_filter`），并把已废弃的 `preprocessed` 同时塞进 `completed` 和 `parse` 两个桶（webui 不归任何桶）。改过滤逻辑时注意这是有意行为。
2. `DocumentManager.tsx` 的 `fetchDocuments` 请求体多带了一个 `statusFilter` 字段（webui 不带），后端 pydantic 忽略未知字段，无害但属脏数据。
3. **vite 8 + graphology 白屏坑（已在 `vite.config.ts` 修）**：vite 8.1.2 的 import-analysis 把 graphology `Graph` 类里名为 `import`/`export` 的**类方法定义**（`import(data, merge = false) {}`，保留字当方法名本身合法）误判成**动态 `import()` 调用**，向方法体注入 `__vite__injectQuery(data, 'import')`，把方法破坏成 `import(__vite__injectQuery(...), merge = false) {`——浏览器报 `SyntaxError: Unexpected token '('`，整条 import 链崩溃 → 纯白屏（`#root` 空）。因 `stores/graph.ts` 顶层 `import { DirectedGraph } from 'graphology'`，App → GraphViewer → 该 store，故与当前 tab 无关（默认「文档」也白屏）。tsc 通过、所有模块 HTTP 200、store 顶层无抛错——常规排查全失效，最终靠 CDP headless 抓 `Runtime.exceptionThrown` 才定位。修复：`vite.config.ts` 的 `resolve.alias` 把 `graphology` 指向 CJS 入口 `dist/graphology.cjs.js`（其方法为 `_proto["import"]` quoted key，无 `import(...)` 调用模式，不触发误判）。CJS 版功能等价（`merge` 经 `arguments` 检测），前端也未直接调用 `.import()`/`.export()`，无副作用。**改 graphology 版本或升 vite 后若再白屏，先查此 alias 是否仍生效。**
4. **切换 tab 白屏坑：GraphViewer 必须常驻不卸载（已在 `App.tsx` 修）**。webui 用 radix `<TabsContent forceMount>` + `data-[state=inactive]:invisible`（`visibility:hidden`）切 tab，**GraphViewer 永不卸载**（注释明说 "preserve WebGL contexts"）。本仓 `App.tsx` 一度改成 `useState` + 条件渲染 `{tab==='documents'?<DocumentManager/>:<GraphViewer/>}`，丢失 forceMount 语义 → 切到「文档」时 GraphViewer 卸载，cleanup（`GraphViewer.tsx` 末尾 effect）只 `sigma.kill()`+`setSigmaInstance(null)`，**但 `stores/graph.ts` 的 `sigmaGraph`/`rawGraph` 残留** → 切回「知识图谱」时新 Sigma 实例绑定残留旧 graphology graph，`GraphControl` 的 `updateEachEdgeAttributes` effect 触发 `sigma.refresh()` → `Sigma: edge "..." can't be repaint`（新 sigma 的 edge render 缓存与残留 graph 状态对不上）→ React 树崩 → `#root` 清空。**仅"切换"路径复现，首次加载正常**，故 `App.tsx` 曾临时把默认 tab 改成 `'knowledge-graph'` 绕过排查。CDP headless 须用 `--use-gl=angle --use-angle=swiftshader`；`--disable-gpu` 会让 WebGL 不可用，产生 `Cannot read properties of null (reading 'blendFunc')` 假阳性（sigma `createWebGLContext` 三种 getContext 全 null 后无防御，`allowInvalidContainer` 只兜底容器宽高为 0，不兜底 gl null）。修复：`App.tsx` 改回两面板常驻 + `visibility` 切换（对齐 webui forceMount）。**勿为"简洁"改回条件渲染**——webui 的 GraphControl 有完全相同的 `updateEachEdgeAttributes`+`refresh` effect，靠常驻不卸载规避，非 effect 本身有错。

**布局约定**：界面高度链完全依赖 `flex` + `min-h-0` + `absolute inset-0` 层层传递。Tailwind 的 `flex-col`（`flex-direction:column`）**必须配合 `flex`（`display:flex`）才生效**——单独写 `flex-col` 会让容器塌缩、子元素 `flex-1` 失效、内部 `absolute` 元素高度归零，表现为"列表区整个不可见但 API 正常"。修改 `DocumentManager.tsx` 的卡片嵌套时务必保留成对的 `flex flex-col`。

## 新后端架构（src/）

薄代理层：收前端请求 → 调 `LightRAGClient` → 用 pydantic schema 解析 LightRAG 原始 dict → 返回。**所有路径无 `/api` 前缀**，与 LightRAG 路由结构对齐（`/documents/*`、`/graphs`、`/graph/label/*`、`/health`）。

分层：
- `api/` — routers。`documents.py`（文档 CRUD/流水线，9 个端点）、`graph.py`（知识图谱只读转发 4 端点：`GET /graphs`、`/graph/label/list`、`/graph/label/popular`、`/graph/label/search`）、`health.py`（聚合健康检查，LightRAG 不可用时降级返回 `status="error"` 而非 500）。
- `services/lightrag_client.py` — `LightRAGClient`（httpx.AsyncClient，懒创建，lifespan 时存入 `app.state.lightrag_client`，shutdown 时 `close()`）。**所有方法返回原始 dict**，schema 解析在 router 层。
- `schemas/documents.py`、`schemas/graph.py`（`GraphNode`/`GraphEdge`/`GraphData`）— pydantic 模型，全部 `ConfigDict(extra="ignore")`（容忍 LightRAG 返回未知字段），与前端 `types.ts` 一一对应。
- `core/config.py` — `Settings(BaseSettings)` 用 pydantic-settings 从 `.env` 读，`get_settings()` 经 `lru_cache` 单例。`core/exceptions.py` 异常体系，`core/middleware.py` 请求 ID + 日志中间件。
- `db/session.py` — SQLAlchemy engine/会话，**当前无业务模型**，`init_db()` 仅建空表，预留迁移旧 `backend/` 模型。

**异常转换**：`LightRAGClient._handle_error` 把 httpx 错误映射为 `AppException` 子类——`ConnectError`/`TimeoutException`/`HTTPStatusError(非404非409)` → `ServiceUnavailableError`(502)，404 → `NotFoundError`，409 → `ConflictError`。`main.py` 注册全局 handler 统一返回 `{detail, code}`，不向客户端泄露内部错误。新增需走下游的路由时沿用此模式，不要在 endpoint 里写 try/except + HTTPException。

## LightRAG API 契约（已核实，易错点）

前端 `BACKEND_API.md` 与 `src/` schema 均对齐此契约：

- `POST /documents/paginated`（**POST + JSON body**，非 GET query）。body 字段：`page`/`page_size`/`status_filter`(单值)/`status_filters`(数组，二者同时传时 `status_filters` 优先)/`sort_field`(`created_at`|`updated_at`|`id`|`file_path`)/`sort_direction`(`asc`|`desc`)。无 `not_status`。
- 响应 `{ documents, pagination, status_counts }`。`pagination` 含 `total_count`/`total_pages`/`has_next`/`has_prev`。**`status_counts` 是全库计数（不受当前过滤影响）**，且一定含 `"all"` 键。
- `DocStatus` 枚举值全小写：`pending`/`parsing`/`analyzing`/`processing`/`preprocessed`(已废弃)/`processed`/`failed`。
- `GET /health` 返回 `pipeline_busy`（**非** `pipelineActive`）+ `auth_mode`。
- `GET /documents/pipeline_status` 的 `job_start` 是 **ISO 8601 字符串**（非毫秒时间戳）。
- `GET /graphs?label=&max_depth=&max_nodes=` 返回 `{ nodes, edges }`。节点 `{ id, labels[], properties }`、边 `{ id, source, target, type, properties }`（NetworkX 存储下边 id 形如 `source-target`，节点 id 即 `properties.entity_id`）。`label=*` 为全局图谱。
- `GET /graph/label/list`、`/graph/label/popular?limit=`、`/graph/label/search?q=&limit=` 均返回 `string[]`。
- 鉴权：LightRAG `AUTH_MODE=disabled` 时免 token（当前配置）。否则需 JWT/API Key，前端尚未实现登录。

## 遗留后端（backend/）

未运行，但承载待迁移的业务逻辑。如需迁移到 `src/`，先理解这些流：

- 数据库：SQLite `./data/aitutor.db`，四表 `SkillNode`（技能树，`parent_ids` JSON 数组表前置依赖，`status` 取 `locked`/`available`/`learning`/`completed`，`mastery` 0–100）、`LearningProgress`、`QuizRecord`、`ReviewSchedule`。模型与 `get_db` 依赖都在 `backend/models/database.py`。
- 技能树构建（`services/skill_tree_builder.py`）：上传 → LightRAG 索引 → 中文 prompt 让 LLM 返回 JSON 技能树 → 重分配 UUID 映射 `parent_ids` → 根节点置 `available`，余 `locked`。解析失败走 `_fallback_skill_tree`。
- 节点解锁（`routers/quiz.py` `submit_quiz`）：mastery≥60 置 `completed`，扫描 `locked` 节点，parent 全 `completed` 则解锁为 `available`。
- 测验两套并存：新版 `POST /api/quiz/generate-node/{node_id}`（本地模板题，`fallback:true`）与旧版 `GET /api/quiz/generate/{node_id}`（LightRAG + LLM，失败兜底）。
- 间隔复习（`routers/review.py`）：SM-2 变体，`/curve` 用 `exp(-day/strength)` 估记忆保留率。
- 路由前缀 `/api/<domain>`（`/api/documents`、`/api/skill-tree`、`/api/quiz`、`/api/learning`、`/api/knowledge-points`、`/api/qa`、`/api/review`）。`knowledge_points` 复用 `SkillNode` 表。`get_node_title`/`get_node_or_404` 等辅助函数在多个 router 重复定义。
- `routers/qa.py` 的 `generate_answer` 仍是 mock 桩，未接真实 LightRAG/LLM。

## 配置（.env）

根目录 `.env`（`.gitignore` 忽略，但仓库存在）有双重角色：
1. **给 LightRAG 容器**配 LLM/Embedding/Rerank（`LLM_BINDING`、`EMBEDDING_*` 等），`docker-compose.yml` 挂载 `/app/.env`。
2. **`src/` 后端**也读 `.env`（pydantic-settings），但只用 `database_url`/`lightrag_base_url`/`lightrag_timeout` 等，均有默认值（`http://localhost:9621`、`sqlite:///./data/aitutor.db`、300s 超时）。

旧 `backend/` 与新 `src/` 都写 `./data/aitutor.db`，**勿同时运行两者**，否则争用同一 SQLite 文件。

`data/` 目录：`aitutor.db`（业务库）、`rag_storage/`+`inputs/`+`prompts/`（LightRAG 容器卷，见 docker-compose）、`uploads/`（旧 backend 上传目录）。`data/` 整体被 `.gitignore` 忽略。
