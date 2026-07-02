import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Button from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/Table'
import { Card, CardHeader, CardContent } from '@/components/ui/Card'
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
  Info,
  MoreHorizontalIcon,
  Trash2Icon,
  ChevronLeftIcon
} from 'lucide-react'
import { toast } from 'sonner'
import {
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

const getDisplayFileName = (doc: DocStatusResponse, maxLength = 24): string => {
  if (!doc.file_path || doc.file_path.trim() === '') return doc.id
  const parts = doc.file_path.split('/')
  const fileName = parts[parts.length - 1]
  if (!fileName) return doc.id
  return fileName.length > maxLength ? fileName.slice(0, maxLength) + '...' : fileName
}

const hasDocumentDetails = (doc: DocStatusResponse): boolean =>
  Boolean(doc.track_id || doc.error_msg || (doc.metadata && Object.keys(doc.metadata).length > 0))

const formatDocumentDetails = (doc: DocStatusResponse): string => {
  const lines: string[] = []
  if (doc.track_id) lines.push(`Track ID: ${doc.track_id}`)
  if (doc.metadata && Object.keys(doc.metadata).length > 0) {
    lines.push(`Metadata:\n${JSON.stringify(doc.metadata, null, 2)}`)
  }
  if (doc.error_msg) lines.push(`Error Message:\n${doc.error_msg}`)
  return lines.join('\n\n')
}

function DocumentStatusDetailsDialog({ doc }: { doc: DocStatusResponse }) {
  const details = formatDocumentDetails(doc)
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="ml-1 inline-flex size-5 items-center justify-center rounded hover:bg-accent"
            aria-label="查看详情"
          >
            {doc.error_msg ? (
              <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
            ) : (
              <Info className="h-3.5 w-3.5 text-blue-500" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-md whitespace-pre-wrap break-words">
          {details}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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

  // 固定显示文件名（精简后移除文件名/ID 切换 UI）；初始按更新时间倒序
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
      toast.error(`加载文档失败：${err instanceof Error ? err.message : String(err)}`)
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
    // 精简后仅文件名列可点排序；showFileName 固定 true，按 file_path 排序
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
      toast.error(`扫描文档失败：${err instanceof Error ? err.message : String(err)}`)
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
    setStatusCounts({})
    await fetchDocuments()
  }, [fetchDocuments])

  const completedCount = statusCounts.processed ?? 0
  const parseCount = (statusCounts.parsing ?? 0) + (statusCounts.pending ?? 0) + (statusCounts.preprocessed ?? 0)
  const analyzeCount = statusCounts.analyzing ?? 0
  const processCount = statusCounts.processing ?? 0
  const failedCount = statusCounts.failed ?? 0

  const filterBtn = useMemo(
    () => (
      (filter: StatusFilter, label: string, count: number, colorClass: string) => (
        <Button
          size="sm"
          variant={statusFilter === filter ? 'secondary' : 'outline'}
          onClick={() => handleStatusFilterChange(filter)}
          disabled={isRefreshing}
          className={cn(
            'h-7 px-2 text-xs',
            count > 0 ? colorClass : 'text-gray-500',
            statusFilter === filter && 'font-medium shadow-sm border'
          )}
        >
          {label} ({count})
        </Button>
      )
    ),
    [statusFilter, isRefreshing]
  )

  // 「更多」菜单项
  const moreMenuItem = (onClick: () => void, icon: React.ReactNode, label: string) => (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
    >
      {icon}
      {label}
    </button>
  )

  return (
    <Card className="!rounded-none flex h-full min-h-0 flex-col overflow-hidden">
      <CardHeader className="flex-none px-3 py-2">
        {/* 顶部工具栏：上传 / 刷新 / 更多（选择模式：删除 / 全选） */}
        <div className="flex items-center gap-2">
          <UploadDocumentsDialog
            onUploadBatchAccepted={() => {
              setPipelineActive(true)
              fetchDocuments()
            }}
            onDocumentsUploaded={async () => {
              fetchDocuments()
            }}
          />
          <Button
            variant="outline"
            size="sm"
            onClick={fetchDocuments}
            disabled={isRefreshing}
            tooltip="刷新文档列表"
          >
            <RotateCcwIcon className="h-4 w-4" />
          </Button>

          <div className="flex-1" />

          {isSelectionMode && (
            <DeleteDocumentsDialog
              selectedDocIds={selectedDocIds}
              onDocumentsDeleted={handleDocumentsDeleted}
            />
          )}
          {isSelectionMode && (
            <Button variant="outline" size="sm" onClick={handleSelectCurrentPage} className="h-9">
              {selectedDocIds.length === docs.length ? (
                <>
                  <XIcon className="h-4 w-4" /> 取消({docs.length})
                </>
              ) : (
                <>
                  <CheckSquareIcon className="h-4 w-4" /> 全选({docs.length})
                </>
              )}
            </Button>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" tooltip="更多操作" className="h-9">
                <MoreHorizontalIcon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-40 p-1">
              {moreMenuItem(handleScan, <RefreshCwIcon className="h-4 w-4" />, '扫描/重试')}
              {moreMenuItem(
                () => setShowPipelineStatus(true),
                <ActivityIcon className="h-4 w-4" />,
                '流水线状态'
              )}
              {moreMenuItem(
                () => setShowClearDialog(true),
                <Trash2Icon className="h-4 w-4" />,
                '清空文档'
              )}
            </PopoverContent>
          </Popover>
          {onCollapse && (
            <Button variant="ghost" size="sm" onClick={onCollapse} tooltip="收起侧边栏" aria-label="收起侧边栏" className="h-9">
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* 状态过滤行 */}
        <div className="mt-2 flex flex-wrap gap-1">
          {filterBtn('all', '全部', statusCounts.all ?? 0, '')}
          {filterBtn('completed', '已完成', completedCount, 'text-green-600')}
          {filterBtn('parse', '解析', parseCount, 'text-cyan-600')}
          {filterBtn('analyze', '分析', analyzeCount, 'text-indigo-600')}
          {filterBtn('process', '处理', processCount, 'text-blue-600')}
          {filterBtn('failed', '失败', failedCount, 'text-red-600')}
        </div>
      </CardHeader>

      <CardContent className="relative min-h-0 flex-1 p-0">
        {!hasAny && (
          <div className="absolute inset-0 p-0">
            <EmptyCard title="无文档" description="还没有上传任何文档" />
          </div>
        )}
        {hasAny && (
          <div className="absolute inset-0 flex min-h-0 flex-col">
            <div className="absolute inset-[-1px] flex flex-col overflow-hidden rounded-md border">
              <TooltipProvider>
                <Table className="w-full">
                  <TableHeader className="sticky top-0 z-10 bg-background shadow-sm">
                    <TableRow className="border-b bg-card/95 backdrop-blur">
                      <TableHead
                        onClick={() => handleSort('id')}
                        className="cursor-pointer select-none hover:bg-gray-200 dark:hover:bg-gray-800"
                      >
                        <div className="flex items-center">
                          文件名
                          {sortField === 'file_path' && (
                            <span className="ml-1">
                              {sortDirection === 'asc' ? (
                                <ArrowUpIcon size={14} />
                              ) : (
                                <ArrowDownIcon size={14} />
                              )}
                            </span>
                          )}
                        </div>
                      </TableHead>
                      <TableHead className="w-28">状态</TableHead>
                      <TableHead className="w-12 text-center">选</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody className="text-sm">
                    {docs.map((doc) => {
                      const status = doc.status as DocStatus
                      return (
                        <TableRow key={doc.id}>
                          <TableCell className="max-w-0 truncate font-mono">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="truncate">{getDisplayFileName(doc)}</div>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-2xl">
                                {doc.file_path}
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center">
                              <span className={cn('truncate', STATUS_COLORS[status])}>
                                {STATUS_LABELS[status]}
                              </span>
                              {hasDocumentDetails(doc) && (
                                <DocumentStatusDetailsDialog doc={doc} />
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <Checkbox
                              checked={selectedDocIds.includes(doc.id)}
                              onCheckedChange={(c) =>
                                handleDocumentSelect(doc.id, c === true)
                              }
                              className="mx-auto"
                            />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </TooltipProvider>
            </div>
          </div>
        )}
      </CardContent>

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
    </Card>
  )
}
