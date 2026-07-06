/**
 * 文档相关Type定义（对齐 LightRAG 真实 API 契约）。
 *
 * 后端为 LightRAG（默认 http://localhost:9621），路由前缀 /documents。
 * 环境变量 VITE_USE_MOCK=true 时走前端 mock，否则直连 LightRAG。
 */

/** 文档ProcessingStatus */
export type DocStatus =
  | 'processed'
  | 'preprocessed'
  | 'parsing'
  | 'analyzing'
  | 'processing'
  | 'pending'
  | 'failed'

/** 单个文档的Status响应 */
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
 * 分页Query请求（对齐 LightRAG POST /documents/paginated body）。
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

/** 分页Query响应 */
export interface DocumentsPaginatedResponse {
  documents: DocStatusResponse[]
  pagination: PaginationInfo
  status_counts: Record<string, number>
}

/** 文档UploadResult（对齐 LightRAG InsertResponse） */
export interface UploadResult {
  status: 'success' | 'partial_success' | 'failure'
  message: string
  track_id?: string
}

/** Scan / RetryResult（对齐 LightRAG ScanResponse） */
export interface ScanResult {
  status: 'scanning_started' | 'scanning_skipped_pipeline_busy' | 'scanning_no_new_documents'
  message: string
}

/** Clear DocumentsResult */
export interface ClearDocumentsResult {
  status: 'success' | 'failure'
  message: string
}

/** Delete DocumentsResult（对齐 LightRAG DeleteDocResponse） */
export interface DeleteDocumentsResult {
  status: 'success' | 'failure'
  message: string
}

/**
 * Pipeline Status（对齐 LightRAG GET /documents/pipeline_status）。
 * job_start 为 ISO 8601 字符串（不是毫秒时间戳）。
 */
export interface PipelineStatus {
  /** 是否已Auto扫描 */
  autoscanned: boolean
  /** 流水线是否正忙 */
  busy: boolean
  /** 当前Task名 */
  job_name: string
  /** Task开始时间（ISO 8601，无Task时为空字符串） */
  job_start?: string
  /** 文档总数 */
  docs: number
  /** 总批次数 */
  batchs: number
  /** 当前批次 */
  cur_batch: number
  /** 是否有待Processing的请求 */
  request_pending: boolean
  /** 是否已请求Cancel */
  cancellation_requested?: boolean
  /** 最近一条消息 */
  latest_message: string
  /** 流水线历史日志 */
  history_messages?: string[]
  /** 更新Status详情 */
  update_status?: Record<string, unknown>
}

/** Cancel PipelineResult */
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

/** Pipeline Status过滤桶（前端用） */
export type StatusBucket = 'completed' | 'parse' | 'analyze' | 'process' | 'failed'
export type StatusFilter = 'all' | StatusBucket

// ============================================================
//  Knowledge Graph（对齐后端 src/schemas/graph.py 与 LightRAG GET /graphs）
// ============================================================

/** 图谱Nodes（对齐后端 GraphNode） */
export interface GraphNode {
  id: string
  labels: string[]
  properties: Record<string, unknown>
}

/** 图谱Edges（对齐后端 GraphEdge） */
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
//  Knowledge PointsLearning Path（对齐后端 src/schemas/mastery.py）
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
  review_later_at?: number | string | null
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

export interface StartKnowledgePointLearningResponse {
  doc_id: string
  knowledge_point_id: string
  prompt: string
  document: MasteryDocumentDetail
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
//  Knowledge Q&A（对齐后端 src/schemas/query.py 与 LightRAG POST /query[/stream]）
// ============================================================

/** Query mode（对齐 LightRAG QueryParam.mode） */
export type QueryMode = 'naive' | 'local' | 'global' | 'hybrid' | 'mix' | 'bypass'

/** Query请求（前端发 query/mode/stream/force_web_search/session_id） */
export interface QueryRequest {
  query: string
  mode: QueryMode
  stream?: boolean
  force_web_search?: boolean  // 用户手动勾SelectWeb Search
  session_id?: string         // ask_user 暂停恢复用会话标识
}

/** RAG 引用来源项（对齐后端 ReferenceItem） */
export interface ReferenceItem {
  reference_id?: string
  file_path?: string
  content?: unknown[]
}

/** Web Search引用项 */
export interface SearchCitation {
  id: number
  url: string
  title: string
  snippet: string
}

/** Tool来源项（对齐后端 SourceItem，区分 rag/web） */
export interface SourceItem {
  id: string
  content: string
  file_path: string
  type: 'rag' | 'web'
}

/** ask_user 单个Question */
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

/** Tool调用信息（tool_call 事件） */
export interface ToolCallInfo {
  id: string
  name: 'rag' | 'web_search' | 'ask_user' | string
  arguments: Record<string, unknown>
}

/** ToolResult信息（tool_result 事件） */
export interface ToolResultInfo {
  tool_call_id: string
  name: string
  content: string
  sources_count?: number
  ask_user?: AskUserPayload  // ask_user Tool的Result带此字段
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
  // 旧格式，向后兼容保留（有 traceEvents 时优先Uses traceEvents）
  loopTrace?: LoopTrace
  // ask_user 暂停态：loop 等待用户Reply
  askUserPayload?: AskUserPayload
  isWaitingForInput?: boolean
  // QuizResult：Quiz流程产出的题目列表
  quizQuestions?: QuizQuestion[]
  // 作答Status：题号 → 用户的作答（Select择/输入）
  quizAnswers?: Record<number, QuizAnswerState>
  // AI 判词Status：题号 → 判题Result
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
  query: string                // 本轮Uses的Query（可能是改写后的）
  originalQuery: string        // 原始用户Query
  thinking: string             // EvaluationThinking
  quality: string              // sufficient / insufficient / forced / short_query
  rewrittenQuery?: string      // 如果 insufficient，建议的改写Query
  contextSummary: string       // 本轮Retrieval到的上下文摘要
  needWebSearch?: boolean      // LLM Evaluation是否需要Web Search
  webSearchQuery?: string      // Web SearchUses的Query
  webSearchResults?: SearchCitation[]  // Web SearchResult摘要
}

/** AgentLoop NDJSON 流式事件Type */
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
  metadata: Record<string, unknown>  // Includes call_id, call_kind, call_role 等门控标记
  timestamp?: number                 // 可Select时间戳（后端未提供时由前端补充）
}

/** 旧版事件Type别名，向后兼容 */
export type LoopEvent = StreamEvent

// ============================================================
//  Quiz（对齐后端 src/schemas/quiz.py 与 QuizService NDJSON 流）
// ============================================================

/** Question TypesClassification（对齐后端 QuestionType） */
export type QuizQuestionType = 'choice' | 'concept' | 'fill_in_blank' | 'short_answer' | 'written' | 'coding'

/** QuizDifficulty */
export type QuizDifficulty = 'easy' | 'medium' | 'hard' | 'auto'

/** Quiz请求体 */
export interface QuizGenerateRequest {
  topic: string
  num_questions: number
  difficulty: QuizDifficulty
  question_types: QuizQuestionType[]  // 空=任意Question Types
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

/** Question Types下拉Select项（中文Labels） */
export const QUIZ_QUESTION_TYPE_OPTIONS: { value: QuizQuestionType; label: string }[] = [
  { value: 'choice', label: 'Multiple Choice' },
  { value: 'concept', label: 'True / False' },
  { value: 'fill_in_blank', label: 'Fill in the Blank' },
  { value: 'short_answer', label: 'Short Answer' },
  { value: 'written', label: 'Essay' },
  { value: 'coding', label: 'Coding' },
]

/** Question Types中文Labels映射 */
export const QUIZ_TYPE_LABELS: Record<QuizQuestionType, string> = {
  choice: 'Multiple Choice',
  concept: 'True / False',
  fill_in_blank: 'Fill in the Blank',
  short_answer: 'Short Answer',
  written: 'Essay',
  coding: 'Coding',
}

/** Difficulty下拉Select项 */
export const QUIZ_DIFFICULTY_OPTIONS: { value: QuizDifficulty; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
]

/** Query Mode 下拉Select项（默认 mix） */
export const QUERY_MODE_OPTIONS: { value: QueryMode; label: string }[] = [
  { value: 'mix', label: 'Mix' },
  { value: 'local', label: 'Local' },
  { value: 'global', label: 'Global' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'naive', label: 'Naive' },
  { value: 'bypass', label: 'Bypass' }
]

// ============================================================
//  作答 + 判题 + 追问（新增）
// ============================================================

/** 单题作答Status */
export interface QuizAnswerState {
  /** Multiple Choice/True / False：Select中的Select项键（A/B/C/D 或 "true"/"false"） */
  selected: string | null
  /** Fill in the Blank/主观题：输入的文字 */
  typed: string
  /** 是否已提交 */
  submitted: boolean
}

/** 单题 AI 判词Status */
export interface QuizJudgmentState {
  /** 判词全文（流式追加） */
  text: string
  /** 是否正在流式接收 */
  isStreaming: boolean
  /** Incorrect信息 */
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

/** Ask Follow-up请求体（对齐后端 QuizFollowupRequest） */
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
