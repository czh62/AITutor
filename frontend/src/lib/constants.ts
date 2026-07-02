export const backendBaseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

export const supportedFileTypes: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt', '.md', '.markdown'],
  'text/csv': ['.csv'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx']
}

export const SiteInfo = {
  name: 'AI Tutor',
  description: 'AI assisted learning workspace'
} as const

export const defaultQueryLabel = '*'

export const controlButtonVariant = 'ghost' as const

export const searchResultLimit = 20
export const dropdownDisplayLimit = 20
export const popularLabelsDefaultLimit = 50
export const searchLabelsDefaultLimit = 50

export const minNodeSize = 4
export const maxNodeSize = 16
export const nodeBorderColor = '#ffffff'
export const nodeBorderColorSelected = '#f59e0b'
export const nodeColorDisabled = '#cbd5e1'

export const labelColorLightTheme = '#111827'
export const labelColorDarkTheme = '#f8fafc'
export const LabelColorHighlightedDarkTheme = '#ffffff'

export const edgeColorDarkTheme = '#64748b'
export const edgeColorHighlightedLightTheme = '#2563eb'
export const edgeColorHighlightedDarkTheme = '#93c5fd'
export const edgeColorSelected = '#f59e0b'

export const EDGE_PERF_LIMIT = 3000
export const LABEL_RENDER_LIMIT = 1500
export const ANIMATE_NODE_LIMIT = 1000

export const workerBudgetMs = (nodeCount: number): number => {
  if (nodeCount <= 300) return 2500
  if (nodeCount <= 1000) return 4000
  if (nodeCount <= 3000) return 6500
  return 9000
}
