import type { DocStatus, StatusBucket, StatusFilter } from '@/api/types'

/** 把后端原始状态归入前端的过滤桶 */
export function getStatusBucket(status: DocStatus): StatusBucket | null {
  switch (status) {
    case 'processed':
    case 'preprocessed':
      return 'completed'
    case 'parsing':
    case 'pending':
      return 'parse'
    case 'analyzing':
      return 'analyze'
    case 'processing':
      return 'process'
    case 'failed':
      return 'failed'
    default:
      return null
  }
}

/** 判断某文档状态是否匹配当前过滤桶 */
export function matchesStatusFilter(status: DocStatus, filter: StatusFilter): boolean {
  if (filter === 'all') return true
  return getStatusBucket(status) === filter
}

/** 过滤桶 -> LightRAG status_filters（数组，一个桶映射多个真实状态） */
export function getStatusRequestFilters(filter: StatusFilter): {
  status_filter?: DocStatus
  status_filters?: DocStatus[]
} {
  switch (filter) {
    case 'completed':
      return { status_filters: ['processed', 'preprocessed'] }
    case 'parse':
      return { status_filters: ['parsing', 'pending', 'preprocessed'] }
    case 'analyze':
      return { status_filter: 'analyzing' }
    case 'process':
      return { status_filter: 'processing' }
    case 'failed':
      return { status_filter: 'failed' }
    default:
      return {}
  }
}

/** 状态显示文本 */
export const STATUS_LABELS: Record<DocStatus, string> = {
  processed: '已完成',
  preprocessed: '预处理',
  parsing: '内容提取',
  analyzing: '分析中',
  processing: '处理中',
  pending: '等待中',
  failed: '失败'
}

/** 状态显示颜色 */
export const STATUS_COLORS: Record<DocStatus, string> = {
  processed: 'text-green-600',
  preprocessed: 'text-purple-600',
  parsing: 'text-cyan-600',
  analyzing: 'text-indigo-600',
  processing: 'text-blue-600',
  pending: 'text-yellow-600',
  failed: 'text-red-600'
}
