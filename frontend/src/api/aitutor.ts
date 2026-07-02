/**
 * AI Tutor 后端 API 客户端。
 *
 * 直连 LightRAG（默认 http://localhost:9621）的真实 HTTP API。
 * 路由前缀为 /documents（无 /api），与 LightRAG 完全一致。
 *
 * 环境变量 VITE_USE_MOCK=true 时走前端 mock 分支（开发调试用），
 * 否则全部走真实 HTTP 调用。
 *
 * 鉴权：LightRAG AUTH_MODE=disabled 时免 token；否则需 JWT 或 API Key。
 * 当前按无鉴权模式接入；登录页与 token 拦截器后续补充。
 */
import axios from 'axios'
import { backendBaseUrl } from '@/lib/constants'

import type {
  DocumentsRequest,
  DocumentsPaginatedResponse,
  DocStatusResponse,
  DocStatus,
  HealthStatus,
  PipelineStatus,
  CancelPipelineResult,
  ScanResult,
  UploadResult,
  ClearDocumentsResult,
  DeleteDocumentsResult,
  GraphData,
  QueryRequest,
  ReferenceItem
} from './types'

// ---- mock 数据与状态（仅 VITE_USE_MOCK=true 时使用） ----
import { mockDocuments, countByStatus, nextMockId, mockGraphData, mockGraphLabels, mockQueryAnswer } from './mockData'
let mockStore: DocStatusResponse[] = [...mockDocuments]
let mockPipelineActive = false
let mockCancellationRequested = false
let mockPipelineTimer: ReturnType<typeof setInterval> | null = null
let mockJob = { name: '', start: null as number | null, curBatch: 0, totalBatches: 0 }
const mockHistory: string[] = []
const MAX_HISTORY = 200
function pushHistory(msg: string) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`
  mockHistory.push(line)
  if (mockHistory.length > MAX_HISTORY) mockHistory.splice(0, mockHistory.length - MAX_HISTORY)
}

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

// ---- axios 实例 ----
const api = axios.create({
  baseURL: backendBaseUrl,
  headers: { 'Content-Type': 'application/json' },
  timeout: 300000 // LightRAG 实体抽取/索引较慢，需长超时
})

// ---- Mock 辅助 ----
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

// ============================================================
//  1. 分页查询文档列表
// ============================================================

/**
 * POST /documents/paginated
 * 分页查询文档列表（支持状态过滤、排序）。
 * LightRAG 真实接口为 POST（body 传参），不是 GET query。
 */
export async function getDocumentsPaginated(
  request: DocumentsRequest & { statusFilter?: string }
): Promise<DocumentsPaginatedResponse> {
  if (USE_MOCK) {
    return getDocumentsPaginatedMock(request)
  }
  const resp = await api.post<DocumentsPaginatedResponse>('/documents/paginated', request)
  return resp.data
}

// ---- mock 实现 ----
async function getDocumentsPaginatedMock(
  request: DocumentsRequest & { statusFilter?: string }
): Promise<DocumentsPaginatedResponse> {
  await delay(300)
  const { status_filters, status_filter } =
    request.statusFilter === 'all'
      ? { status_filters: undefined, status_filter: undefined }
      : (() => {
          const map: Record<string, DocStatus[]> = {
            completed: ['processed', 'preprocessed'],
            parse: ['parsing', 'pending', 'preprocessed'],
            analyze: ['analyzing'],
            process: ['processing'],
            failed: ['failed']
          }
          const arr = map[request.statusFilter ?? 'all']
          return arr
            ? { status_filters: arr, status_filter: undefined }
            : { status_filters: undefined, status_filter: undefined }
        })()

  let list = mockStore.slice()
  if (status_filters) list = list.filter((d) => status_filters.includes(d.status))
  if (status_filter) list = list.filter((d) => d.status === status_filter)

  const field = request.sort_field
  const dir = request.sort_direction === 'asc' ? 1 : -1
  list.sort((a, b) => {
    let va: string | number = a[field] as string
    let vb: string | number = b[field] as string
    if (field === 'created_at' || field === 'updated_at') {
      va = new Date(a[field]).getTime()
      vb = new Date(b[field]).getTime()
    }
    if (typeof va === 'string' && typeof vb === 'string') {
      return dir * va.localeCompare(vb)
    }
    return dir * ((va as number) > (vb as number) ? 1 : (va as number) < (vb as number) ? -1 : 0)
  })

  const page = request.page
  const pageSize = request.page_size
  const total = list.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = (page - 1) * pageSize
  const pageDocs = list.slice(start, start + pageSize)

  return {
    documents: pageDocs,
    pagination: {
      page,
      page_size: pageSize,
      total_count: total,
      total_pages: totalPages,
      has_next: page < totalPages,
      has_prev: page > 1
    },
    status_counts: countByStatus(mockStore)
  }
}

// ============================================================
//  2. 扫描 / 重试
// ============================================================

/**
 * POST /documents/scan
 * 扫描输入目录中的新文档，并重新处理所有失败的文档。
 */
export async function scanNewDocuments(): Promise<ScanResult> {
  if (USE_MOCK) {
    await delay(400)
    if (mockPipelineActive) {
      return { status: 'scanning_skipped_pipeline_busy', message: '流水线被占用，已跳过本次扫描' }
    }
    mockPipelineActive = true
    beginMockJob('扫描/重试')
    return { status: 'scanning_started', message: '扫描已启动' }
  }
  const resp = await api.post<ScanResult>('/documents/scan')
  return resp.data
}

// ============================================================
//  3. 上传文档
// ============================================================

/**
 * POST /documents/upload
 * 上传单个文档（multipart/form-data，字段名 file）。
 * onProgress 回调用于上报上传进度百分比。
 */
export async function uploadDocument(
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadResult> {
  if (USE_MOCK) {
    return uploadDocumentMock(file, onProgress)
  }
  const formData = new FormData()
  formData.append('file', file)
  const resp = await api.post<UploadResult>('/documents/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (e.total && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
    }
  })
  return resp.data
}

async function uploadDocumentMock(
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadResult> {
  for (let p = 0; p <= 100; p += 25) {
    onProgress?.(p)
    await delay(120)
  }
  const newDoc: DocStatusResponse = {
    id: nextMockId(),
    file_path: file.name,
    content_summary: `${file.name} 的内容摘要（mock）`,
    content_length: file.size,
    chunks_count: 0,
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    metadata: { source: 'upload', size: file.size }
  }
  mockStore = [newDoc, ...mockStore]
  pushHistory(`[上传] ${file.name} 已加入处理队列`)
  setTimeout(() => {
    const target = mockStore.find((d) => d.id === newDoc.id)
    if (target) {
      target.status = 'parsing'
      target.updated_at = new Date().toISOString()
    }
    beginMockJob(`上传 ${file.name}`)
  }, 800)
  return { status: 'success', message: `${file.name} 上传成功` }
}

// ============================================================
//  4. 删除指定文档
// ============================================================

/**
 * DELETE /documents/delete_document
 * 删除指定文档。LightRAG 真实路径是 /delete_document（不是根路径 DELETE），
 * 请求体字段为 doc_ids（不是 ids）。
 */
export async function deleteDocuments(
  docIds: string[],
  deleteFile: boolean = false,
  deleteLLMCache: boolean = false
): Promise<DeleteDocumentsResult> {
  if (USE_MOCK) {
    await delay(500)
    mockStore = mockStore.filter((d) => !docIds.includes(d.id))
    return { status: 'success', message: `已删除 ${docIds.length} 个文档` }
  }
  const resp = await api.delete<DeleteDocumentsResult>('/documents/delete_document', {
    data: { doc_ids: docIds, delete_file: deleteFile, delete_llm_cache: deleteLLMCache }
  })
  return resp.data
}

// ============================================================
//  5. 清空所有文档
// ============================================================

/**
 * DELETE /documents
 * 清空所有文档。LightRAG 真实路径是 /documents 根路径 DELETE。
 * 清 LLM 缓存是独立接口 POST /documents/clear_cache。
 */
export async function clearDocuments(): Promise<ClearDocumentsResult> {
  if (USE_MOCK) {
    await delay(700)
    mockStore = []
    return { status: 'success', message: '已清空所有文档' }
  }
  const resp = await api.delete<ClearDocumentsResult>('/documents')
  return resp.data
}

/**
 * POST /documents/clear_cache
 * 清空 LLM 缓存（独立接口，非清空文档的一部分）。
 */
export async function clearCache(): Promise<{ status: 'success' | 'fail'; message?: string }> {
  if (USE_MOCK) {
    await delay(300)
    return { status: 'success', message: '缓存已清空' }
  }
  const resp = await api.post<{ status: 'success' | 'fail'; message?: string }>('/documents/clear_cache')
  return resp.data
}

// ============================================================
//  6. 流水线状态
// ============================================================

/**
 * GET /documents/pipeline_status
 * 获取文档处理流水线状态（对齐 LightRAG 真实契约）。
 * 注意：LightRAG 用下划线（pipeline_status），不是连字符（pipeline-status）。
 */
export async function getPipelineStatus(): Promise<PipelineStatus> {
  if (USE_MOCK) {
    await delay(200)
    const counts = countByStatus(mockStore)
    return {
      autoscanned: false,
      busy: mockPipelineActive,
      job_name: mockPipelineActive ? mockJob.name : '',
      job_start: mockJob.start ? new Date(mockJob.start).toISOString() : undefined,
      docs: mockStore.length,
      batchs: mockJob.totalBatches,
      cur_batch: mockJob.curBatch,
      request_pending: (counts.pending ?? 0) > 0,
      cancellation_requested: mockCancellationRequested,
      latest_message: mockHistory.length > 0 ? mockHistory[mockHistory.length - 1] : '',
      history_messages: mockHistory.slice()
    }
  }
  const resp = await api.get<PipelineStatus>('/documents/pipeline_status')
  return resp.data
}

// ============================================================
//  7. 取消流水线
// ============================================================

/**
 * POST /documents/cancel_pipeline
 * 请求取消当前流水线任务。
 */
export async function cancelPipeline(): Promise<CancelPipelineResult> {
  if (USE_MOCK) {
    await delay(300)
    if (!mockPipelineActive) {
      return { status: 'not_busy', message: '流水线当前空闲' }
    }
    mockCancellationRequested = true
    pushHistory(`[取消] 已请求取消流水线任务（${mockJob.name}）`)
    return { status: 'cancellation_requested', message: '取消请求已发送' }
  }
  const resp = await api.post<CancelPipelineResult>('/documents/cancel_pipeline')
  return resp.data
}

// ============================================================
//  8. 健康检查
// ============================================================

/**
 * GET /health
 * 后端健康检查。LightRAG 返回 pipeline_busy（不是 pipelineActive）。
 */
export async function checkHealth(): Promise<HealthStatus> {
  if (USE_MOCK) {
    await delay(150)
    return {
      status: 'healthy',
      pipeline_busy: mockPipelineActive,
      message: mockPipelineActive ? 'processing' : 'idle'
    }
  }
  const resp = await api.get<HealthStatus>('/health')
  return resp.data
}

// ============================================================
//  9. 状态计数（额外接口，LightRAG 独立提供）
// ============================================================

/**
 * GET /documents/status_counts
 * 获取各状态的文档数量（LightRAG 独立接口）。
 */
export async function getStatusCounts(): Promise<Record<string, number>> {
  if (USE_MOCK) {
    await delay(200)
    return countByStatus(mockStore)
  }
  const resp = await api.get<Record<string, number>>('/documents/status_counts')
  return resp.data
}

// ============================================================
//  10. 知识图谱
// ============================================================

/**
 * GET /graphs?label=&max_depth=&max_nodes=
 * 按 label 查询知识图谱（节点+边）。label 为 * 时返回全局图谱。
 */
export async function queryGraphs(
  label: string,
  maxDepth: number,
  maxNodes: number
): Promise<GraphData> {
  if (USE_MOCK) {
    await delay(200)
    // mock 模式：对具体 label 返回以其为源的小子图，否则返回全图
    if (label && label !== '*') {
      const nodes = mockGraphData.nodes.filter(
        (n) => n.id === label || mockGraphData.edges.some((e) => (e.source === label && e.target === n.id) || (e.target === label && e.source === n.id))
      )
      const nodeIds = new Set(nodes.map((n) => n.id))
      const edges = mockGraphData.edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      return { nodes, edges }
    }
    return mockGraphData
  }
  const resp = await api.get<GraphData>('/graphs', {
    params: { label, max_depth: maxDepth, max_nodes: maxNodes }
  })
  return resp.data
}

/**
 * GET /graph/label/list
 * 全部实体标签。
 */
export async function getGraphLabels(): Promise<string[]> {
  if (USE_MOCK) {
    await delay(120)
    return mockGraphLabels
  }
  const resp = await api.get<string[]>('/graph/label/list')
  return resp.data
}

/**
 * GET /graph/label/popular?limit=
 * 热门实体标签。
 */
export async function getPopularLabels(limit: number = 300): Promise<string[]> {
  if (USE_MOCK) {
    await delay(120)
    return mockGraphLabels.slice(0, limit)
  }
  const resp = await api.get<string[]>('/graph/label/popular', { params: { limit } })
  return resp.data
}

/**
 * GET /graph/label/search?q=&limit=
 * 搜索实体标签。
 */
export async function searchLabels(query: string, limit: number = 50): Promise<string[]> {
  if (USE_MOCK) {
    await delay(100)
    const q = query.toLowerCase()
    return mockGraphLabels.filter((l) => l.toLowerCase().includes(q)).slice(0, limit)
  }
  const resp = await api.get<string[]>('/graph/label/search', {
    params: { q: query, limit }
  })
  return resp.data
}

// ============================================================
//  Mock 流水线模拟（仅 USE_MOCK=true 时使用）
// ============================================================

function beginMockJob(reason: string) {
  mockPipelineActive = true
  mockCancellationRequested = false
  mockJob = {
    name: '文档索引流水线',
    start: Date.now(),
    curBatch: 0,
    totalBatches: mockStore.filter((d) =>
      ['pending', 'parsing', 'analyzing', 'processing', 'failed'].includes(d.status)
    ).length || 1
  }
  pushHistory(`[启动] ${reason}：开始处理 ${mockJob.totalBatches} 个文档批次`)
  startMockPipeline()
}

function startMockPipeline() {
  if (mockPipelineTimer) return
  mockPipelineTimer = setInterval(() => {
    if (mockCancellationRequested) {
      pushHistory('[取消] 流水线已停止，剩余文档回到等待状态')
      for (const d of mockStore) {
        if (['parsing', 'analyzing', 'processing'].includes(d.status)) {
          d.status = 'pending'
          d.updated_at = new Date().toISOString()
        }
      }
      mockPipelineActive = false
      mockCancellationRequested = false
      mockJob.start = null
      if (mockPipelineTimer) {
        clearInterval(mockPipelineTimer)
        mockPipelineTimer = null
      }
      return
    }

    const order: DocStatus[] = ['pending', 'parsing', 'analyzing', 'processing', 'processed']
    for (const d of mockStore) {
      const idx = order.indexOf(d.status)
      if (idx >= 0 && idx < order.length - 1) {
        const prev = d.status
        d.status = order[idx + 1]
        d.updated_at = new Date().toISOString()
        if (d.status === 'processed' && d.chunks_count === 0) {
          d.chunks_count = Math.max(1, Math.floor((d.content_length ?? 1000) / 4000))
        }
        mockJob.curBatch = Math.min(mockJob.curBatch + 1, mockJob.totalBatches)
        pushHistory(`[处理] ${d.file_path}：${prev} -> ${d.status}`)
        break
      }
    }

    const active = mockStore.some((d) =>
      ['pending', 'parsing', 'analyzing', 'processing'].includes(d.status)
    )
    if (!active) {
      pushHistory('[完成] 所有文档处理完毕')
      mockPipelineActive = false
      mockJob.start = null
      if (mockPipelineTimer) {
        clearInterval(mockPipelineTimer)
        mockPipelineTimer = null
      }
    }
  }, 2500)
}

// ============================================================
//  11. 知识问答（流式查询）
// ============================================================

/**
 * POST /query/stream — NDJSON 流式查询。
 * 逐行解析 {"response":"..."} / {"references":[...]} / {"error":"..."}，
 * 通过 onChunk/onReferences/onError 回调上报。signal 中止可停止。
 *
 * 参考 LightRAG webui `_readNdjsonStream`：fetch + ReadableStream.getReader()。
 */
export async function queryStream(
  request: QueryRequest,
  callbacks: {
    onChunk: (text: string) => void
    onReferences?: (refs: ReferenceItem[]) => void
    onError?: (msg: string) => void
    signal?: AbortSignal
  }
): Promise<void> {
  const { onChunk, onReferences, onError, signal } = callbacks
  if (USE_MOCK) {
    return queryStreamMock(request, { onChunk, onReferences, onError, signal })
  }
  try {
    const resp = await fetch(`${backendBaseUrl}/query/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson'
      },
      body: JSON.stringify({ ...request, stream: true }),
      signal
    })
    if (!resp.ok || !resp.body) {
      onError?.(`查询失败：HTTP ${resp.status}`)
      return
    }
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const parsed = JSON.parse(trimmed)
          if (typeof parsed.response === 'string') {
            onChunk(parsed.response)
          } else if (Array.isArray(parsed.references)) {
            onReferences?.(parsed.references as ReferenceItem[])
          } else if (parsed.error) {
            onError?.(parsed.error)
          }
        } catch {
          /* 跳过无法解析的行 */
        }
      }
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return // 用户主动停止，静默
    onError?.(err instanceof Error ? err.message : String(err))
  }
}

// ---- mock 流式实现 ----
async function queryStreamMock(
  request: QueryRequest,
  callbacks: {
    onChunk: (text: string) => void
    onReferences?: (refs: ReferenceItem[]) => void
    onError?: (msg: string) => void
    signal?: AbortSignal
  }
): Promise<void> {
  const { onChunk, onReferences, signal } = callbacks
  const { chunks, references } = mockQueryAnswer(request.query, request.mode)
  // 首行先发引用，再逐段输出正文
  onReferences?.(references)
  for (const chunk of chunks) {
    if (signal?.aborted) return
    onChunk(chunk)
    // eslint-disable-next-line no-await-in-loop
    await delay(60 + Math.random() * 80)
  }
}
