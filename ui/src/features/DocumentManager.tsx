import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import EmptyCard from '@/components/ui/EmptyCard'
import Checkbox from '@/components/ui/Checkbox'
import UploadDocumentsDialog from '@/components/documents/UploadDocumentsDialog'
import ClearDocumentsDialog from '@/components/documents/ClearDocumentsDialog'
import DeleteDocumentsDialog from '@/components/documents/DeleteDocumentsDialog'
import PipelineStatusDialog from '@/components/documents/PipelineStatusDialog'
import PaginationControls from '@/components/ui/PaginationControls'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@/components/ui/Tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/Popover'
import {
  RefreshCwIcon,
  ActivityIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  RotateCcwIcon,
  CheckSquareIcon,
  XIcon,
  AlertTriangle,

  MoreHorizontalIcon,
  Trash2Icon,
  ChevronLeftIcon
} from 'lucide-react'
import { toast } from 'sonner'
import {
  clearMasteryDocuments,
  getDocumentsPaginated,
  scanNewDocuments,
  checkHealth
} from '@/api/aitutor'
import type {
  DocStatus,
  DocStatusResponse,
  PaginationInfo,
  StatusFilter
} from '@/api/types'
import {
  STATUS_LABELS,
  STATUS_COLORS,
  getStatusRequestFilters
} from '@/features/documentStatusFilters'

type SortField = 'created_at' | 'updated_at' | 'id' | 'file_path'
type SortDirection = 'asc' | 'desc'

const DEFAULT_PAGE_SIZE = 10
const PROCESSING_LIKE_STATUSES: DocStatus[] = ['processing', 'pending', 'parsing', 'analyzing']
const MASTERY_DOCUMENTS_CLEARED_EVENT = 'aitutor:mastery-documents-cleared'

const getDisplayFileName = (doc: DocStatusResponse, maxLength = 24): string => {
  if (!doc.file_path || doc.file_path.trim() === '') return doc.id
  const parts = doc.file_path.split('/')
  const fileName = parts[parts.length - 1]
  if (!fileName) return doc.id
  return fileName.length > maxLength ? fileName.slice(0, maxLength) + '...' : fileName
}

const formatDocumentDetails = (doc: DocStatusResponse): string => {
  const lines: string[] = []
  if (doc.track_id) lines.push(`Track ID: ${doc.track_id}`)
  if (doc.metadata && Object.keys(doc.metadata).length > 0) {
    lines.push(`Metadata:\n${JSON.stringify(doc.metadata, null, 2)}`)
  }
  if (doc.error_msg) lines.push(`Error Message:\n${doc.error_msg}`)
  return lines.join('\n\n')
}

function DocumentStatusPopover({ doc }: { doc: DocStatusResponse }) {
  const details = formatDocumentDetails(doc)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="ml-1 inline-flex size-5 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
          aria-label="View details"
        >
          <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="max-w-md whitespace-pre-wrap break-words p-3 text-xs text-foreground">
        {details}
      </PopoverContent>
    </Popover>
  )
}

export default function DocumentManager({ onCollapse }: { onCollapse?: () => void }) {
  const [showPipelineStatus, setShowPipelineStatus] = useState(false)
  const [showClearDialog, setShowClearDialog] = useState(false)
  const [pipelineActive, setPipelineActive] = useState(false)

  const [docs, setDocs] = useState<DocStatusResponse[]>([])
  const [hasAny, setHasAny] = useState(false)
  const [pagination, setPagination] = useState<PaginationInfo>({
    page: 1,
    page_size: DEFAULT_PAGE_SIZE,
    total_count: 0,
    total_pages: 0,
    has_next: false,
    has_prev: false
  })
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({ all: 0 })
  const [isRefreshing, setIsRefreshing] = useState(false)

  // 固定显示File Name（精简后移除File Name/ID 切换 UI）；初始按更新时间倒序
  const showFileName = true
  const [sortField, setSortField] = useState<SortField>('updated_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([])
  const isSelectionMode = selectedDocIds.length > 0

  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const fetchDocuments = useCallback(async () => {
    setIsRefreshing(true)
    try {
      const req = {
        ...getStatusRequestFilters(statusFilter),
        statusFilter, // mock 模式下识别过滤桶，直连 LightRAG 时会被 status_filter/status_filters 替代
        page: pagination.page,
        page_size: pagination.page_size,
        sort_field: sortField,
        sort_direction: sortDirection
      }
      const res = await getDocumentsPaginated(req)
      if (!mountedRef.current) return
      setDocs(res.documents)
      setHasAny(res.pagination.total_count > 0)
      setPagination(res.pagination)
      setStatusCounts(res.status_counts)
    } catch (err) {
      toast.error(`Failed to load documents: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (mountedRef.current) setIsRefreshing(false)
    }
  }, [pagination.page, pagination.page_size, sortField, sortDirection, statusFilter])

  useEffect(() => {
    fetchDocuments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagination.page, pagination.page_size, statusFilter, sortField, sortDirection])

  // 轮询：流水线活跃时 5s，否则 30s
  useEffect(() => {
    const tick = async () => {
      const health = await checkHealth().catch(() => null)
      if (health && mountedRef.current) {
        setPipelineActive(health.pipeline_busy)
        if (health.pipeline_busy) fetchDocuments()
      }
    }
    tick()
    const interval = pipelineActive ? 5000 : 30000
    const timer = setInterval(tick, interval)
    return () => clearInterval(timer)
  }, [pipelineActive, fetchDocuments])

  const handleSort = (field: SortField) => {
    // 精简后仅File Name列可点排序；showFileName 固定 true，按 file_path 排序
    let actual = field
    if (field === 'id') actual = showFileName ? 'file_path' : 'id'
    const newDir: SortDirection =
      sortField === actual && sortDirection === 'desc' ? 'asc' : 'desc'
    setSortField(actual)
    setSortDirection(newDir)
    setPagination((p) => ({ ...p, page: 1 }))
  }

  const handlePageChange = (newPage: number) => {
    if (newPage === pagination.page) return
    setPagination((p) => ({ ...p, page: newPage }))
    setSelectedDocIds([])
  }

  const handlePageSizeChange = (size: number) => {
    setPagination((p) => ({ ...p, page: 1, page_size: size }))
    setSelectedDocIds([])
  }

  const handleStatusFilterChange = (f: StatusFilter) => {
    if (f === statusFilter) return
    setStatusFilter(f)
    setPagination((p) => ({ ...p, page: 1 }))
    setSelectedDocIds([])
  }

  const handleScan = useCallback(async () => {
    try {
      const { status, message } = await scanNewDocuments()
      toast.message(message)
      if (status === 'scanning_started') {
        setPipelineActive(true)
        fetchDocuments()
      }
    } catch (err) {
      toast.error(`Failed to scan documents: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [fetchDocuments])

  const handleDocumentSelect = (id: string, checked: boolean) => {
    setSelectedDocIds((prev) =>
      checked ? [...prev, id] : prev.filter((x) => x !== id)
    )
  }

  const handleSelectCurrentPage = () => {
    if (selectedDocIds.length === docs.length) {
      setSelectedDocIds([])
    } else {
      setSelectedDocIds(docs.map((d) => d.id))
    }
  }

  const handleDocumentsDeleted = useCallback(async () => {
    setSelectedDocIds([])
    await fetchDocuments()
  }, [fetchDocuments])

  const handleDocumentsCleared = useCallback(async () => {
    setSelectedDocIds([])
    setStatusFilter('all')
    setIsRefreshing(true)
    try {
      const res = await getDocumentsPaginated({
        statusFilter: 'all',
        page: 1,
        page_size: pagination.page_size,
        sort_field: sortField,
        sort_direction: sortDirection
      })
      const nextStatusCounts = res.status_counts ?? {}
      const remainingCount =
        typeof nextStatusCounts.all === 'number'
          ? nextStatusCounts.all
          : typeof res.pagination.total_count === 'number'
            ? res.pagination.total_count
            : res.documents.length
      const processingCountFromCounts = PROCESSING_LIKE_STATUSES.reduce(
        (sum, status) => sum + (nextStatusCounts[status] ?? 0),
        0
      )
      const processingCount =
        processingCountFromCounts > 0
          ? processingCountFromCounts
          : res.documents.filter((doc) => PROCESSING_LIKE_STATUSES.includes(doc.status)).length
      let masteryResetFailed = false

      if (mountedRef.current) {
        setDocs(res.documents)
        setHasAny(remainingCount > 0)
        setPagination(res.pagination)
        setStatusCounts(nextStatusCounts)
      }

      if (remainingCount === 0) {
        try {
          await clearMasteryDocuments()
          window.dispatchEvent(new Event(MASTERY_DOCUMENTS_CLEARED_EVENT))
        } catch (err) {
          masteryResetFailed = true
          console.warn(
            `ClearKnowledge PointsStatusFailed：${err instanceof Error ? err.message : String(err)}`
          )
        }
      }

      return {
        remainingCount,
        processingCount,
        statusCounts: nextStatusCounts,
        masteryResetFailed
      }
    } finally {
      if (mountedRef.current) setIsRefreshing(false)
    }
  }, [pagination.page_size, sortField, sortDirection])

  const completedCount = statusCounts.processed ?? 0
  const parseCount = (statusCounts.parsing ?? 0) + (statusCounts.pending ?? 0) + (statusCounts.preprocessed ?? 0)
  const analyzeCount = statusCounts.analyzing ?? 0
  const processCount = statusCounts.processing ?? 0
  const failedCount = statusCounts.failed ?? 0

  // Status过滤按钮（对齐 DeepT 导航项风格：rounded-lg + hover/active 背景过渡）
  const filterBtn = useMemo(
    () =>
      (filter: StatusFilter, label: string, count: number, colorClass: string) => (
        <button
          type="button"
          onClick={() => handleStatusFilterChange(filter)}
          disabled={isRefreshing}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs transition-colors disabled:opacity-50',
            statusFilter === filter
              ? 'bg-background/60 font-medium text-foreground'
              : 'text-muted-foreground hover:bg-background/40 hover:text-foreground'
          )}
        >
          <span>{label}</span>
          <span className={count > 0 ? colorClass : 'text-muted-foreground/60'}>{count}</span>
        </button>
      ),
    [statusFilter, isRefreshing]
  )

  // 「更多」菜单项（对齐 DeepT 行样式：rounded-lg + hover 背景）
  const moreMenuItem = (onClick: () => void, icon: ReactNode, label: string) => (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/85 transition-colors hover:bg-background/60 hover:text-foreground"
    >
      {icon}
      {label}
    </button>
  )

  // Tool栏图标按钮统一样式（对齐 DeepT 折叠态导航图标按钮：
  // h-9 w-9 rounded-xl，hover:bg-background/60，transition-all duration-150，无 active:scale）
  const iconBtnClass =
    'flex h-9 w-9 items-center justify-center rounded-xl text-foreground/85 transition-all duration-150 hover:bg-background/60 hover:text-foreground disabled:opacity-50'

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 顶部Tool栏 + Status过滤行 */}
      <div className="flex-none px-3 pb-2 pt-3">
        <div className="flex items-center gap-1">
          <UploadDocumentsDialog
            onUploadBatchAccepted={() => {
              setPipelineActive(true)
              fetchDocuments()
            }}
            onDocumentsUploaded={async () => {
              fetchDocuments()
            }}
          />
          <button
            type="button"
            onClick={fetchDocuments}
            disabled={isRefreshing}
            aria-label="Refresh documents"
            title="Refresh documents"
            className={iconBtnClass}
          >
            <RotateCcwIcon className="h-[18px] w-[18px]" strokeWidth={1.6} />
          </button>

          <div className="flex-1" />

          {isSelectionMode && (
            <DeleteDocumentsDialog
              selectedDocIds={selectedDocIds}
              onDocumentsDeleted={handleDocumentsDeleted}
            />
          )}
          {isSelectionMode && (
            <button
              type="button"
              onClick={handleSelectCurrentPage}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-foreground/85 transition-colors hover:bg-background/60 hover:text-foreground"
            >
              {selectedDocIds.length === docs.length ? (
                <>
                  <XIcon className="h-4 w-4" strokeWidth={1.6} /> Cancel ({docs.length})
                </>
              ) : (
                <>
                  <CheckSquareIcon className="h-4 w-4" strokeWidth={1.6} /> Select all ({docs.length})
                </>
              )}
            </button>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                title="More actions"
                className={iconBtnClass}
              >
                <MoreHorizontalIcon className="h-[18px] w-[18px]" strokeWidth={1.6} />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-40 p-1">
              {moreMenuItem(handleScan, <RefreshCwIcon className="h-4 w-4" strokeWidth={1.6} />, 'Scan / Retry')}
              {moreMenuItem(
                () => setShowPipelineStatus(true),
                <ActivityIcon className="h-4 w-4" strokeWidth={1.6} />,
                'Pipeline Status'
              )}
              {moreMenuItem(
                () => setShowClearDialog(true),
                <Trash2Icon className="h-4 w-4" strokeWidth={1.6} />,
                'Clear Documents'
              )}
            </PopoverContent>
          </Popover>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Collapse sidebar"
              title="Collapse sidebar"
              className={iconBtnClass}
            >
              <ChevronLeftIcon className="h-[18px] w-[18px]" strokeWidth={1.6} />
            </button>
          )}
        </div>

        {/* Status过滤行 */}
        <div className="mt-2 flex flex-wrap gap-1">
          {filterBtn('all', 'All', statusCounts.all ?? 0, '')}
          {filterBtn('completed', 'Completed', completedCount, 'text-green-600')}
          {filterBtn('parse', 'Parsing', parseCount, 'text-cyan-600')}
          {filterBtn('analyze', 'Analyzing', analyzeCount, 'text-indigo-600')}
          {filterBtn('process', 'Processing', processCount, 'text-blue-600')}
          {filterBtn('failed', 'Failed', failedCount, 'text-red-600')}
        </div>
      </div>

      {/* 文档列表：表头 + 行列表 */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {!hasAny ? (
          <EmptyCard title="No Documents" description="No documents uploaded yet" className="m-2 rounded-lg" />
        ) : (
          <TooltipProvider>
            {/* 表头 + 行列表共享同一 padding/gap/列宽，确保对齐 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-1">
              {/* 表头：三列（File Name flex-1 / Status+详情 w-20 / 勾Select w-6），与行完全同结构 */}
              <div className="flex items-center gap-2 px-2.5 pb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground/60">
                <button
                  type="button"
                  onClick={() => handleSort('id')}
                  disabled={isRefreshing}
                  className="flex min-w-0 flex-1 items-center gap-1 cursor-pointer select-none transition-colors hover:text-foreground disabled:opacity-50"
                  title="Toggle file name sorting"
                >
                  <span>File Name</span>
                  {sortField === 'file_path' && (
                    sortDirection === 'asc'
                      ? <ArrowUpIcon className="h-3 w-3" strokeWidth={2} />
                      : <ArrowDownIcon className="h-3 w-3" strokeWidth={2} />
                  )}
                </button>
                <div className="w-20 shrink-0">Status</div>
                <div className="w-6 shrink-0 text-center">Select</div>
              </div>
              {/* 行列表 */}
              {docs.map((doc) => {
                const status = doc.status as DocStatus
                const selected = selectedDocIds.includes(doc.id)
                return (
                  <div
                    key={doc.id}
                    className={cn(
                      'group/doc flex items-center gap-2 rounded-lg px-2.5 py-1.5 transition-colors',
                      selected
                        ? 'bg-background/60 font-medium'
                        : 'hover:bg-background/40'
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="truncate font-mono text-[13px] text-foreground/90">
                            {getDisplayFileName(doc)}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-2xl">
                          {doc.file_path}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    {/* Status + 详情按钮合并为一个 flex 子项，与表头 w-20 列对齐 */}
                    <div className="w-20 shrink-0 flex items-center gap-1">
                      <span className={cn('truncate text-xs', STATUS_COLORS[status])}>
                        {STATUS_LABELS[status]}
                      </span>
                      {doc.error_msg && <DocumentStatusPopover doc={doc} />}
                    </div>
                    <div className="w-6 shrink-0 flex justify-center">
                      <Checkbox
                        checked={selected}
                        onCheckedChange={(c) => handleDocumentSelect(doc.id, c === true)}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </TooltipProvider>
        )}
      </div>

      {/* 底部分页栏 */}
      {pagination.total_pages > 1 && (
        <div className="flex-none border-t border-border/40 px-3 py-1">
          <PaginationControls
            currentPage={pagination.page}
            totalPages={pagination.total_pages}
            pageSize={pagination.page_size}
            totalCount={pagination.total_count}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
            isLoading={isRefreshing}
            compact
          />
        </div>
      )}

      {/* 对话框（常驻挂载，受控开关） */}
      <PipelineStatusDialog open={showPipelineStatus} onOpenChange={setShowPipelineStatus} />
      <ClearDocumentsDialog
        open={showClearDialog}
        onOpenChange={setShowClearDialog}
        onDocumentsCleared={handleDocumentsCleared}
      />
    </div>
  )
}
