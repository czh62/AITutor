import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangleIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ClockIcon,
  Loader2Icon,
  RefreshCwIcon,
  RotateCcwIcon
} from 'lucide-react'
import Button from '@/components/ui/Button'
import BuildStatusDialog from '@/components/mastery/BuildStatusDialog'
import KnowledgePointDialog from '@/components/mastery/KnowledgePointDialog'
import MasteryTree from '@/components/mastery/MasteryTree'
import ResetProgressDialog from '@/components/mastery/ResetProgressDialog'
import ReviewDialog from '@/components/mastery/ReviewDialog'
import { getMasteryDocument, getMasteryDocuments } from '@/api/aitutor'
import type {
  MasteryBuildStatus,
  MasteryDocumentDetail,
  MasteryDocumentSummary,
  MasteryKnowledgePoint,
  MasteryModule
} from '@/api/types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface MasterySidebarProps {
  onCollapse?: () => void
}

const BUILD_STATUS_LABELS: Record<MasteryBuildStatus, string> = {
  not_started: '处理中',
  queued: '处理中',
  waiting_rag: '处理中',
  building: '构建中',
  ready: '可学习',
  build_failed: '构建失败',
  rag_failed: 'RAG 失败'
}

function getBuildStatus(doc: MasteryDocumentSummary): MasteryBuildStatus {
  if (doc.rag_status === 'failed') return 'rag_failed'
  if (doc.rag_status !== 'processed') return 'waiting_rag'
  return doc.build_status
}

function isTerminal(doc: MasteryDocumentSummary): boolean {
  const status = getBuildStatus(doc)
  return status === 'ready' || status === 'build_failed' || status === 'rag_failed'
}

function statusTone(status: MasteryBuildStatus): string {
  if (status === 'ready') return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (status === 'build_failed' || status === 'rag_failed') return 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300'
  if (status === 'building') return 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300'
  return 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
}

function StatusIcon({ status }: { status: MasteryBuildStatus }) {
  if (status === 'ready') return <CheckCircle2Icon className="h-3.5 w-3.5" />
  if (status === 'build_failed' || status === 'rag_failed') return <AlertTriangleIcon className="h-3.5 w-3.5" />
  if (status === 'building') return <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
  return <ClockIcon className="h-3.5 w-3.5" />
}

function StatusBadge({ doc }: { doc: MasteryDocumentSummary }) {
  const status = getBuildStatus(doc)
  return (
    <span className={cn('inline-flex h-6 items-center gap-1 rounded-md border px-2 text-[11px] font-medium', statusTone(status))}>
      <StatusIcon status={status} />
      {BUILD_STATUS_LABELS[status]}
    </span>
  )
}

function ProgressBar({ doc }: { doc: MasteryDocumentSummary }) {
  const total = Math.max(doc.progress.counts.total, 1)
  const mastered = Math.round((doc.progress.counts.mastered / total) * 100)
  const learning = Math.round((doc.progress.counts.learning / total) * 100)
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/70">
      <div className="flex h-full">
        <div className="bg-emerald-500" style={{ width: `${mastered}%` }} />
        <div className="bg-sky-500" style={{ width: `${learning}%` }} />
      </div>
    </div>
  )
}

function DocumentRow({
  doc,
  active,
  onSelect
}: {
  doc: MasteryDocumentSummary
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-md border p-2.5 text-left transition-colors',
        active
          ? 'border-primary/35 bg-background shadow-sm'
          : 'border-transparent hover:border-border hover:bg-background/70'
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{doc.title}</p>
          <p className="truncate text-xs text-muted-foreground">{doc.source_file}</p>
        </div>
        <StatusBadge doc={doc} />
      </div>
      <div className="mt-2">
        <ProgressBar doc={doc} />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {doc.progress.counts.mastered}/{doc.progress.counts.total} 掌握
        </span>
        {doc.progress.due_reviews > 0 && <span>{doc.progress.due_reviews} 个待复习</span>}
      </div>
    </button>
  )
}

export default function MasterySidebar({ onCollapse }: MasterySidebarProps) {
  const [documents, setDocuments] = useState<MasteryDocumentSummary[]>([])
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [detail, setDetail] = useState<MasteryDocumentDetail | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<MasteryKnowledgePoint | null>(null)
  const [selectedModule, setSelectedModule] = useState<MasteryModule | null>(null)
  const [pointDialogOpen, setPointDialogOpen] = useState(false)
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false)
  const [buildStatusOpen, setBuildStatusOpen] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const selectedDocument = useMemo(
    () => documents.find((doc) => doc.doc_id === selectedDocId) ?? documents[0] ?? null,
    [documents, selectedDocId]
  )

  const needsPolling = useMemo(
    () => documents.some((doc) => !isTerminal(doc)),
    [documents]
  )

  const loadDocuments = useCallback(async () => {
    setLoadingDocs(true)
    try {
      const result = await getMasteryDocuments()
      if (!mountedRef.current) return
      setDocuments(result.documents)
      setSelectedDocId((current) => current ?? result.documents[0]?.doc_id ?? null)
    } catch (err) {
      toast.error(`加载知识点失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (mountedRef.current) setLoadingDocs(false)
    }
  }, [])

  const loadDetail = useCallback(async (doc: MasteryDocumentSummary | null) => {
    if (!doc || doc.rag_status !== 'processed' || getBuildStatus(doc) !== 'ready') {
      setDetail(null)
      return
    }
    setLoadingDetail(true)
    try {
      const result = await getMasteryDocument(doc.doc_id)
      if (mountedRef.current) setDetail(result)
    } catch (err) {
      toast.error(`加载知识树失败：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (mountedRef.current) setLoadingDetail(false)
    }
  }, [])

  const refreshMastery = useCallback(async () => {
    await loadDocuments()
    await loadDetail(selectedDocument)
  }, [loadDocuments, loadDetail, selectedDocument])

  useEffect(() => {
    loadDocuments()
  }, [loadDocuments])

  useEffect(() => {
    if (!needsPolling) return
    const timer = setInterval(loadDocuments, 10000)
    return () => clearInterval(timer)
  }, [loadDocuments, needsPolling])

  useEffect(() => {
    loadDetail(selectedDocument)
  }, [loadDetail, selectedDocument])

  const readyCount = documents.filter((doc) => getBuildStatus(doc) === 'ready').length
  const canRenderTree = selectedDocument?.rag_status === 'processed' && getBuildStatus(selectedDocument) === 'ready'
  const selectedPointId = selectedPoint?.id

  const handleKnowledgePointClick = (point: MasteryKnowledgePoint, module: MasteryModule) => {
    setSelectedPoint(point)
    setSelectedModule(module)
    setPointDialogOpen(true)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <BrainCircuitIcon className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">知识点</p>
            <p className="text-[11px] text-muted-foreground">{readyCount}/{documents.length} 可学习</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={refreshMastery}
            disabled={loadingDocs}
            tooltip="刷新知识点"
          >
            <RefreshCwIcon className={cn('h-4 w-4', loadingDocs && 'animate-spin')} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onCollapse} tooltip="收起侧边栏">
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="max-h-56 shrink-0 overflow-y-auto border-b border-border/60 p-2">
          {documents.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              上传 TXT、MD、PDF 或 DOCX 后会在这里生成知识树
            </div>
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <DocumentRow
                  key={doc.doc_id}
                  doc={doc}
                  active={selectedDocument?.doc_id === doc.doc_id}
                  onSelect={() => setSelectedDocId(doc.doc_id)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2">
          {!selectedDocument ? (
            <div className="py-8 text-center text-xs text-muted-foreground">暂无文档</div>
          ) : !canRenderTree ? (
            <div className="py-8 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border bg-background">
                <StatusIcon status={getBuildStatus(selectedDocument)} />
              </div>
              <p className="mt-3 text-sm font-medium">{BUILD_STATUS_LABELS[getBuildStatus(selectedDocument)]}</p>
              <p className="mx-auto mt-1 max-w-56 text-xs leading-5 text-muted-foreground">
                RAG 完成前知识点保持处理中；只有文档状态完成后才会渲染知识树。
              </p>
              {selectedDocument.build_error && (
                <p className="mx-auto mt-3 max-w-56 rounded-md border border-red-500/20 bg-red-500/10 p-2 text-xs text-red-600 dark:text-red-300">
                  {selectedDocument.build_error}
                </p>
              )}
              <Button
                className="mt-4"
                variant="outline"
                size="sm"
                onClick={() => setBuildStatusOpen(true)}
              >
                查看状态
              </Button>
            </div>
          ) : loadingDetail ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              正在加载知识树
            </div>
          ) : detail ? (
            <div className="py-2">
              <div className="rounded-md border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">学习进度</span>
                  <span className="font-medium text-foreground">
                    {detail.progress.counts.mastered}/{detail.progress.counts.total}
                  </span>
                </div>
                <div className="mt-2">
                  <ProgressBar doc={detail} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
                  <div className="rounded-md bg-secondary p-2">
                    <p className="font-semibold text-foreground">{detail.progress.counts.learning}</p>
                    <p className="text-muted-foreground">学习中</p>
                  </div>
                  <div className="rounded-md bg-secondary p-2">
                    <p className="font-semibold text-foreground">{detail.progress.counts.new}</p>
                    <p className="text-muted-foreground">未学</p>
                  </div>
                  <div className="rounded-md bg-secondary p-2">
                    <p className="font-semibold text-foreground">{detail.progress.due_reviews}</p>
                    <p className="text-muted-foreground">复习</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setReviewDialogOpen(true)}
                    className="px-2 text-xs"
                  >
                    <ClockIcon className="h-3.5 w-3.5" />
                    复习
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBuildStatusOpen(true)}
                    className="px-2 text-xs"
                  >
                    状态
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setResetDialogOpen(true)}
                    className="px-2 text-xs"
                  >
                    <RotateCcwIcon className="h-3.5 w-3.5" />
                    重置
                  </Button>
                </div>
              </div>

              <div className="mt-3">
                <MasteryTree
                  modules={detail.modules}
                  selectedKnowledgePointId={selectedPointId}
                  onKnowledgePointClick={handleKnowledgePointClick}
                />
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground">知识树暂不可用</div>
          )}
        </div>
      </div>
      <KnowledgePointDialog
        open={pointDialogOpen}
        onOpenChange={setPointDialogOpen}
        docId={selectedDocument?.doc_id ?? ''}
        module={selectedModule}
        knowledgePoint={selectedPoint}
        onChanged={refreshMastery}
      />
      <ReviewDialog
        open={reviewDialogOpen}
        onOpenChange={setReviewDialogOpen}
        docId={selectedDocument?.doc_id ?? ''}
        detail={detail}
        onChanged={refreshMastery}
      />
      <BuildStatusDialog
        open={buildStatusOpen}
        onOpenChange={setBuildStatusOpen}
        document={selectedDocument}
        onChanged={refreshMastery}
      />
      <ResetProgressDialog
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        document={selectedDocument}
        onChanged={refreshMastery}
      />
    </div>
  )
}
