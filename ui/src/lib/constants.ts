import type { VariantProps } from 'class-variance-authority'
import type { buttonVariants } from '@/components/ui/Button'

export const backendBaseUrl = ''

export const SiteInfo = {
  name: 'AI Tutor',
  description: '文档知识问答与知识图谱'
}

export const defaultQueryLabel = '*'

export const supportedFileTypes: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt', '.text'],
  'text/markdown': ['.md', '.markdown'],
  'text/csv': ['.csv'],
  'application/json': ['.json'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/msword': ['.doc'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.ms-excel': ['.xls']
}

export const dropdownDisplayLimit = 100
export const popularLabelsDefaultLimit = 300
export const searchLabelsDefaultLimit = 50
export const searchResultLimit = 50

export const minNodeSize = 6
export const maxNodeSize = 22
export const nodeBorderColor = '#FFFFFF'
export const nodeBorderColorSelected = '#10B981'
export const nodeColorDisabled = '#CBD5E1'

export const labelColorLightTheme = '#1C1816'
export const labelColorDarkTheme = '#E8E4DE'
export const LabelColorHighlightedDarkTheme = '#FFFFFF'

export const edgeColorDarkTheme = '#6B7280'
export const edgeColorHighlightedDarkTheme = '#94A3B8'
export const edgeColorHighlightedLightTheme = '#64748B'
export const edgeColorSelected = '#10B981'

export const EDGE_PERF_LIMIT = 5000
export const ANIMATE_NODE_LIMIT = 2000
export const LABEL_RENDER_LIMIT = 3000

export const workerBudgetMs = (nodeCount: number): number => {
  if (nodeCount >= 50000) return 12000
  if (nodeCount >= 10000) return 8000
  if (nodeCount >= 3000) return 5000
  return 2500
}

export const controlButtonVariant: VariantProps<typeof buttonVariants>['variant'] = 'ghost'
