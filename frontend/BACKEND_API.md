# AI Tutor 文档界面所需后端接口清单（对齐 LightRAG 真实契约）

前端位于 `frontend/`，默认直连 LightRAG（http://localhost:9621）。
环境变量 `VITE_USE_MOCK=true` 时走前端 mock（开发调试用）。

LightRAG 路由前缀为 `/documents`（无 `/api`），`vite.config.ts` 已配置 proxy
将 `/documents` 和 `/health` 转发到 `http://localhost:9621`。

鉴权：LightRAG `AUTH_MODE=disabled` 时免 token；否则需 JWT 或 API Key。
当前按无鉴权模式接入；登录页与 token 拦截器后续补充。

## 1. 文档相关接口（对应 LightRAG `/documents/*`）

### `POST /documents/paginated`
分页查询文档列表（LightRAG 为 POST body 传参，不是 GET query）。

- Request body：
  - `page` (int, 默认 1)
  - `page_size` (int, 默认 10)
  - `status_filter` (string, 可选)：单值过滤
  - `status_filters` (string[], 可选)：多值过滤（如 `["processed","preprocessed"]`）
  - `sort_field`：`created_at` / `updated_at` / `id` / `file_path`
  - `sort_direction`：`asc` / `desc`
- 响应：
  ```json
  {
    "documents": [DocStatusResponse],
    "pagination": { "page": 1, "page_size": 10, "total_count": 100, "total_pages": 10, "has_next": true, "has_prev": false },
    "status_counts": { "all": 100, "processed": 80, ... }
  }
  ```
- `DocStatusResponse` 字段：`id`, `file_path`, `content_summary`, `content_length`, `chunks_count`, `status`, `created_at`, `updated_at`, `track_id`, `error_msg`, `metadata`

### `POST /documents/upload`
上传单个文档（multipart/form-data，字段名 `file`）。

- 请求体：`multipart/form-data`，字段 `file`
- 响应：`{ "status": "success" | "partial_success" | "failure", "message": "..." }`
- 同名文件冲突时返回 HTTP 409

### `POST /documents/scan`
扫描输入目录中的新文档，并重新处理所有失败的文档。

- 响应：`{ "status": "scanning_started" | "scanning_skipped_pipeline_busy" | "scanning_no_new_documents", "message": "..." }`

### `DELETE /documents/delete_document`
删除指定文档。

- Request body：`{ "doc_ids": ["id1", "id2"], "delete_file": true, "delete_llm_cache": false }`
- 响应：`{ "status": "success" | "failure", "message": "..." }`

### `DELETE /documents`
清空所有文档。

- 无请求体
- 响应：`{ "status": "success" | "failure", "message": "..." }`

### `POST /documents/clear_cache`
清空 LLM 缓存（独立接口，与清空文档分开调用）。

- 响应：`{ "status": "success" | "fail", "message": "..." }`

## 2. 流水线与健康检查

### `GET /documents/pipeline_status`
获取文档处理流水线状态。

- 响应：
  ```json
  {
    "autoscanned": false,
    "busy": false,
    "job_name": "",
    "job_start": "2024-01-01T00:00:00",
    "docs": 100,
    "batchs": 10,
    "cur_batch": 3,
    "request_pending": false,
    "cancellation_requested": false,
    "latest_message": "...",
    "history_messages": ["..."],
    "update_status": {}
  }
  ```
  - `job_start` 为 ISO 8601 字符串（不是毫秒时间戳）

### `POST /documents/cancel_pipeline`
请求取消当前流水线任务。

- 响应：`{ "status": "cancellation_requested" | "not_busy", "message": "..." }`

### `GET /documents/status_counts`
获取各状态的文档数量（LightRAG 独立接口）。

- 响应：`{ "status_counts": { "all": 100, "processed": 80, ... } }`

### `GET /health`
后端健康检查。LightRAG 返回 `pipeline_busy`（不是 `pipelineActive`）。

- 响应：
  ```json
  {
    "status": "healthy",
    "pipeline_busy": false,
    "auth_mode": "disabled",
    "configuration": { ... }
  }
  ```

## 3. 知识图谱接口（对应 LightRAG `/graphs`、`/graph/label/*`）

只读转发，供知识图谱查看器使用。路径无 `/api` 前缀，与 LightRAG 路由结构对齐。
`vite.config.ts` 已配置 proxy 将 `/graphs` 与 `/graph` 转发到 `src/` 后端（:8000），
后端再转发到 LightRAG（:9621）。`VITE_USE_MOCK=true` 时走前端 mock 图谱数据。

### `GET /graphs`
按实体标签查询知识图谱（节点 + 边）。`label=*` 表示全局图谱。

- Query：`label` (string, 默认 `*`)、`max_depth` (int, 默认 3)、`max_nodes` (int, 默认 1000)
- 响应：
  ```json
  {
    "nodes": [{ "id": "...", "labels": ["..."], "properties": { ... } }],
    "edges": [{ "id": "...", "source": "...", "target": "...", "type": "...", "properties": { ... } }]
  }
  ```

### `GET /graph/label/list`
全部实体标签。

- 响应：`["标签1", "标签2", ...]`

### `GET /graph/label/popular`
热门实体标签。

- Query：`limit` (int, 默认 300)
- 响应：`["标签1", ...]`

### `GET /graph/label/search`
搜索实体标签。

- Query：`q` (string, 必填)、`limit` (int, 默认 50)
- 响应：`["标签1", ...]`

> 实体/关系编辑（`/graph/entity/edit`、`/graph/relation/edit`、`/graph/entity/exists`）未实现，
> 当前为只读查看器；后续如需编辑能力再补。

## 4. 与 LightRAG 直连的使用方式

```bash
# 启动 LightRAG 服务
docker compose up -d lightrag

# 启动前端（直连 LightRAG）
cd frontend
npm run dev   # vite proxy 自动转发 /documents → localhost:9621

# 使用 mock 模式（无需 LightRAG）
VITE_USE_MOCK=true npm run dev
```

## 5. 当前未实现 / 后续补充

| 能力 | 状态 |
|---|---|
| 鉴权（JWT / API Key） | ❌ 未实现（需登录页 + axios 拦截器） |
| `GET /documents/scan-progress` | ❌ 未调用（LightRAG 有此接口） |
| `POST /documents/reprocess_failed` | ❌ 未调用（与 scan 功能重叠，可后续加） |
| `GET /documents/track_status/{track_id}` | ❌ 未调用（追踪单个上传状态） |
| `GET /documents/status_counts` | ✅ 有函数但组件未单独调用（分页响应已含） |
