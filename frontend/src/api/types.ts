/**
 * 文档相关类型定义（对齐 LightRAG 真实 API 契约）。
 *
 * 后端为 LightRAG（默认 http://localhost:9621），路由前缀 /documents。
 * 环境变量 VITE_USE_MOCK=true 时走前端 mock，否则直连 LightRAG。
 */

/** 文档处理状态 */
export type DocStatus =
  | 'processed'
  | 'preprocessed'
  | 'parsing'
  | 'analyzing'
  | 'processing'
  | 'pending'
  | 'failed'

/** 单个文档的状态响应 */
export interface DocStatusResponse {
  id: string
  file_path: string
  content_summary?: string
  content_length?: number
  chunks_count?: number
  status: DocStatus
  created_at: string
  updated_at: string
  track_id?: string
  error_msg?: string
  metadata?: Record<string, unknown>
}

/** 分页信息 */
export interface PaginationInfo {
  page: number
  page_size: number
  total_count: number
  total_pages: number
  has_next: boolean
  has_prev: boolean
}

/**
 * 分页查询请求（对齐 LightRAG POST /documents/paginated body）。
 * LightRAG 用 status_filter（单值）或 status_filters（多值数组），
 * 不再用 not_status。
 */
export interface DocumentsRequest {
  status_filter?: DocStatus | null
  status_filters?: DocStatus[] | null
  page: number
  page_size: number
  sort_field: 'created_at' | 'updated_at' | 'id' | 'file_path'
  sort_direction: 'asc' | 'desc'
}

/** 分页查询响应 */
export interface DocumentsPaginatedResponse {
  documents: DocStatusResponse[]
  pagination: PaginationInfo
  status_counts: Record<string, number>
}

/** 文档上传结果（对齐 LightRAG InsertResponse） */
export interface UploadResult {
  status: 'success' | 'partial_success' | 'failure'
  message: string
}

/** 扫描/重试结果（对齐 LightRAG ScanResponse） */
export interface ScanResult {
  status: 'scanning_started' | 'scanning_skipped_pipeline_busy' | 'scanning_no_new_documents'
  message: string
}

/** 清空文档结果 */
export interface ClearDocumentsResult {
  status: 'success' | 'failure'
  message: string
}

/** 删除文档结果（对齐 LightRAG DeleteDocResponse） */
export interface DeleteDocumentsResult {
  status: 'success' | 'failure'
  message: string
}

/**
 * 流水线状态（对齐 LightRAG GET /documents/pipeline_status）。
 * job_start 为 ISO 8601 字符串（不是毫秒时间戳）。
 */
export interface PipelineStatus {
  /** 是否已自动扫描 */
  autoscanned: boolean
  /** 流水线是否正忙 */
  busy: boolean
  /** 当前任务名 */
  job_name: string
  /** 任务开始时间（ISO 8601，无任务时为空字符串） */
  job_start?: string
  /** 文档总数 */
  docs: number
  /** 总批次数 */
  batchs: number
  /** 当前批次 */
  cur_batch: number
  /** 是否有待处理的请求 */
  request_pending: boolean
  /** 是否已请求取消 */
  cancellation_requested?: boolean
  /** 最近一条消息 */
  latest_message: string
  /** 流水线历史日志 */
  history_messages?: string[]
  /** 更新状态详情 */
  update_status?: Record<string, unknown>
}

/** 取消流水线结果 */
export interface CancelPipelineResult {
  status: 'cancellation_requested' | 'not_busy'
  message?: string
}

/**
 * 健康检查（对齐 LightRAG GET /health）。
 * LightRAG 返回 pipeline_busy，前端映射为 pipelineActive。
 */
export interface HealthStatus {
  status: 'healthy' | 'error'
  pipeline_busy: boolean
  auth_mode?: 'enabled' | 'disabled'
  message?: string
}

/** 流水线状态过滤桶（前端用） */
export type StatusBucket = 'completed' | 'parse' | 'analyze' | 'process' | 'failed'
export type StatusFilter = 'all' | StatusBucket

// ============================================================
//  知识图谱（对齐后端 src/schemas/graph.py 与 LightRAG GET /graphs）
// ============================================================

/** 图谱节点（对齐后端 GraphNode） */
export interface GraphNode {
  id: string
  labels: string[]
  properties: Record<string, unknown>
}

/** 图谱边（对齐后端 GraphEdge） */
export interface GraphEdge {
  id: string
  source: string
  target: string
  type?: string | null
  properties: Record<string, unknown>
}

/** 图谱数据（对齐后端 GraphData，LightRAG GET /graphs 响应） */
export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// ============================================================
//  知识问答（对齐后端 src/schemas/query.py 与 LightRAG POST /query[/stream]）
// ============================================================

/** 查询模式（对齐 LightRAG QueryParam.mode） */
export type QueryMode = 'naive' | 'local' | 'global' | 'hybrid' | 'mix' | 'bypass'

/** 查询请求（前端只发 query/mode/stream，其余参数由 LightRAG 服务端默认） */
export interface QueryRequest {
  query: string
  mode: QueryMode
  stream?: boolean
}

/** RAG 引用来源项（对齐后端 ReferenceItem） */
export interface ReferenceItem {
  reference_id?: string
  file_path?: string
  content?: unknown[]
}

/** 对话消息（QAPanel 渲染用） */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  references?: ReferenceItem[]
  isError?: boolean
  isStreaming?: boolean
}

/** Query Mode 下拉选项（默认 mix） */
export const QUERY_MODE_OPTIONS: { value: QueryMode; label: string }[] = [
  { value: 'mix', label: 'Mix（混合）' },
  { value: 'local', label: 'Local（局部）' },
  { value: 'global', label: 'Global（全局）' },
  { value: 'hybrid', label: 'Hybrid（混合检索）' },
  { value: 'naive', label: 'Naive（朴素）' },
  { value: 'bypass', label: 'Bypass（旁路）' }
]
