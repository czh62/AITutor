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
  track_id?: string
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
//  知识点学习路径（对齐后端 src/schemas/mastery.py）
// ============================================================

export type MasteryBuildStatus =
  | 'not_started'
  | 'queued'
  | 'waiting_rag'
  | 'building'
  | 'ready'
  | 'build_failed'
  | 'rag_failed'
export type MasteryKnowledgeType = 'memory' | 'concept' | 'procedure' | 'design'
export type MasteryObjectiveStatus = 'new' | 'learning' | 'mastered'
export type MasteryNextStepAction =
  | 'answer_pending'
  | 'review'
  | 'probe'
  | 'practice'
  | 'assess'
  | 'complete'

export interface MasteryProgressSummary {
  counts: {
    mastered: number
    learning: number
    new: number
    total: number
  }
  due_reviews: number
  complete: boolean
}

export interface MasteryDocumentSummary {
  doc_id: string
  title: string
  source_file: string
  rag_status: DocStatus | string
  build_status: MasteryBuildStatus
  build_error?: string | null
  updated_at: string
  progress: MasteryProgressSummary
}

export interface MasteryKnowledgePoint {
  id: string
  title: string
  name?: string
  description: string
  knowledge_type: MasteryKnowledgeType
  type?: MasteryKnowledgeType
  status: MasteryObjectiveStatus
  mastery_level: number
  mastery?: number
  dependencies: string[]
  review_due?: string | null
  has_pending_question: boolean
}

export interface MasteryModule {
  id: string
  title: string
  name?: string
  summary: string
  description?: string
  mastered?: number
  total?: number
  knowledge_points: MasteryKnowledgePoint[]
}

export interface MasteryNextStep {
  action: MasteryNextStepAction
  module_id?: string | null
  module_title?: string | null
  module_name?: string | null
  knowledge_point_id?: string | null
  knowledge_point_title?: string | null
  knowledge_point_name?: string | null
  knowledge_point_type?: string | null
  status?: string | null
  gate?: string | null
  mastery?: number | null
  threshold?: number | null
  reason: string
  prompt?: string | null
  pending_prompt?: string | null
}

export interface MasteryDocumentDetail extends MasteryDocumentSummary {
  modules: MasteryModule[]
  next_step: MasteryNextStep
  build_warnings: string[]
}

export interface MasteryStudyResponse {
  doc_id?: string
  knowledge_point_id?: string
  title?: string
  description?: string
  explanation?: string
  dependencies?: string[]
  knowledge_point: MasteryKnowledgePoint
  study_prompt: string
  next_step: MasteryNextStep
}

export interface MasteryQuizResponse {
  question_id?: string
  knowledge_point_id: string
  question: string
  prompt?: string
  question_type?: string
  options?: string[]
  expected_points?: string[]
  next_step: MasteryNextStep
}

export interface MasteryGradeResponse {
  passed: boolean
  is_correct?: boolean
  score: number
  mastery?: number
  mastered?: boolean
  feedback: string
  retry_question?: string | null
  next_step: MasteryNextStep
  document: MasteryDocumentDetail
}

export interface MasteryAssessResponse {
  passed: boolean
  next_step: MasteryNextStep
  document: MasteryDocumentDetail
}

// ============================================================
//  知识问答（对齐后端 src/schemas/query.py 与 LightRAG POST /query[/stream]）
// ============================================================

/** 查询模式（对齐 LightRAG QueryParam.mode） */
export type QueryMode = 'naive' | 'local' | 'global' | 'hybrid' | 'mix' | 'bypass'

/** 查询请求（前端发 query/mode/stream/force_web_search/session_id） */
export interface QueryRequest {
  query: string
  mode: QueryMode
  stream?: boolean
  force_web_search?: boolean  // 用户手动勾选联网搜索
  session_id?: string         // ask_user 暂停恢复用会话标识
}

/** RAG 引用来源项（对齐后端 ReferenceItem） */
export interface ReferenceItem {
  reference_id?: string
  file_path?: string
  content?: unknown[]
}

/** 联网搜索引用项 */
export interface SearchCitation {
  id: number
  url: string
  title: string
  snippet: string
}

/** 工具来源项（对齐后端 SourceItem，区分 rag/web） */
export interface SourceItem {
  id: string
  content: string
  file_path: string
  type: 'rag' | 'web'
}

/** ask_user 单个问题 */
export interface AskUserQuestion {
  id: string
  text: string
  options?: string[] | null  // null/undefined 表示纯文本输入
}

/** ask_user 完整载荷 */
export interface AskUserPayload {
  questions: AskUserQuestion[]
  context: string
}

/** 工具调用信息（tool_call 事件） */
export interface ToolCallInfo {
  id: string
  name: 'rag' | 'web_search' | 'ask_user' | string
  arguments: Record<string, unknown>
}

/** 工具结果信息（tool_result 事件） */
export interface ToolResultInfo {
  tool_call_id: string
  name: string
  content: string
  sources_count?: number
  ask_user?: AskUserPayload  // ask_user 工具的结果带此字段
  paused?: boolean
}

/** 对话消息（QAPanel 渲染用） */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  references?: ReferenceItem[]
  isError?: boolean
  isStreaming?: boolean
  // 原始事件流，供 TracePanels 按 call_id 分组渲染思维链
  traceEvents?: StreamEvent[]
  // 旧格式，向后兼容保留（有 traceEvents 时优先使用 traceEvents）
  loopTrace?: LoopTrace
  // ask_user 暂停态：loop 等待用户回复
  askUserPayload?: AskUserPayload
  isWaitingForInput?: boolean
  // 出题结果：出题流程产出的题目列表
  quizQuestions?: QuizQuestion[]
  // 作答状态：题号 → 用户的作答（选择/输入）
  quizAnswers?: Record<number, QuizAnswerState>
  // AI 判词状态：题号 → 判题结果
  quizJudgments?: Record<number, QuizJudgmentState>
}

export type QACommand =
  | {
      id: string
      kind: 'query'
      prompt: string
      metadata?: { source: 'mastery'; docId: string; knowledgePointId: string }
    }
  | {
      id: string
      kind: 'quiz'
      topic: string
      num_questions: number
      difficulty: QuizDifficulty
      question_types: QuizQuestionType[]
      metadata?: { source: 'mastery'; docId: string; knowledgePointId: string }
    }

/** AgentLoop 思维链追踪 */
export interface LoopTrace {
  rounds: number
  completed: boolean
  engine: string
  steps: LoopStep[]
}

/** AgentLoop 单轮步骤 */
export interface LoopStep {
  round: number
  query: string                // 本轮使用的查询（可能是改写后的）
  originalQuery: string        // 原始用户查询
  thinking: string             // 评估思考
  quality: string              // sufficient / insufficient / forced / short_query
  rewrittenQuery?: string      // 如果 insufficient，建议的改写查询
  contextSummary: string       // 本轮检索到的上下文摘要
  needWebSearch?: boolean      // LLM 评估是否需要联网搜索
  webSearchQuery?: string      // 联网搜索使用的查询
  webSearchResults?: SearchCitation[]  // 联网搜索结果摘要
}

/** AgentLoop NDJSON 流式事件类型 */
export type LoopEventType =
  | 'stage_start' | 'stage_end' | 'thinking' | 'query_rewrite'
  | 'observation' | 'progress' | 'content'
  | 'tool_call' | 'tool_result'
  | 'references' | 'search' | 'sources' | 'result'
  | 'error' | 'wait_for_input' | 'session' | 'session_meta' | 'done'

/** AgentLoop NDJSON 流式事件（对齐后端 StreamEvent） */
export interface StreamEvent {
  type: LoopEventType
  round: number
  content: string
  metadata: Record<string, unknown>  // 包含 call_id, call_kind, call_role 等门控标记
  timestamp?: number                 // 可选时间戳（后端未提供时由前端补充）
}

/** 旧版事件类型别名，向后兼容 */
export type LoopEvent = StreamEvent

// ============================================================
//  出题（对齐后端 src/schemas/quiz.py 与 QuizService NDJSON 流）
// ============================================================

/** 题型分类（对齐后端 QuestionType） */
export type QuizQuestionType = 'choice' | 'concept' | 'fill_in_blank' | 'short_answer' | 'written' | 'coding'

/** 出题难度 */
export type QuizDifficulty = 'easy' | 'medium' | 'hard' | 'auto'

/** 出题请求体 */
export interface QuizGenerateRequest {
  topic: string
  num_questions: number
  difficulty: QuizDifficulty
  question_types: QuizQuestionType[]  // 空=任意题型
}

/** 单道题目（对齐后端 QuizQuestion） */
export interface QuizQuestion {
  question_id: string
  question: string
  question_type: QuizQuestionType
  correct_answer: string
  explanation: string
  options: Record<string, string> | null
  topic: string
  difficulty: string
}

/** 题型下拉选项（中文标签） */
export const QUIZ_QUESTION_TYPE_OPTIONS: { value: QuizQuestionType; label: string }[] = [
  { value: 'choice', label: '选择题' },
  { value: 'concept', label: '判断题' },
  { value: 'fill_in_blank', label: '填空题' },
  { value: 'short_answer', label: '简答题' },
  { value: 'written', label: '论述题' },
  { value: 'coding', label: '编程题' },
]

/** 题型中文标签映射 */
export const QUIZ_TYPE_LABELS: Record<QuizQuestionType, string> = {
  choice: '选择题',
  concept: '判断题',
  fill_in_blank: '填空题',
  short_answer: '简答题',
  written: '论述题',
  coding: '编程题',
}

/** 难度下拉选项 */
export const QUIZ_DIFFICULTY_OPTIONS: { value: QuizDifficulty; label: string }[] = [
  { value: 'auto', label: '自动' },
  { value: 'easy', label: '简单' },
  { value: 'medium', label: '中等' },
  { value: 'hard', label: '困难' },
]

/** Query Mode 下拉选项（默认 mix） */
export const QUERY_MODE_OPTIONS: { value: QueryMode; label: string }[] = [
  { value: 'mix', label: 'Mix（混合）' },
  { value: 'local', label: 'Local（局部）' },
  { value: 'global', label: 'Global（全局）' },
  { value: 'hybrid', label: 'Hybrid（混合检索）' },
  { value: 'naive', label: 'Naive（朴素）' },
  { value: 'bypass', label: 'Bypass（旁路）' }
]

// ============================================================
//  作答 + 判题 + 追问（新增）
// ============================================================

/** 单题作答状态 */
export interface QuizAnswerState {
  /** 选择题/判断题：选中的选项键（A/B/C/D 或 "true"/"false"） */
  selected: string | null
  /** 填空题/主观题：输入的文字 */
  typed: string
  /** 是否已提交 */
  submitted: boolean
}

/** 单题 AI 判词状态 */
export interface QuizJudgmentState {
  /** 判词全文（流式追加） */
  text: string
  /** 是否正在流式接收 */
  isStreaming: boolean
  /** 错误信息 */
  error: string | null
}

/** AI 判题请求体（对齐后端 QuizJudgeRequest） */
export interface QuizJudgeRequest {
  question: string
  question_type: string
  options: Record<string, string> | null
  correct_answer: string
  explanation: string
  user_answer: string
  language: string
}

/** 追问讲解请求体（对齐后端 QuizFollowupRequest） */
export interface QuizFollowupRequest {
  followup_question: string
  question: string
  question_type: string
  options: Record<string, string> | null
  correct_answer: string
  explanation: string
  user_answer: string
  ai_judgment: string | null
  language: string
}
