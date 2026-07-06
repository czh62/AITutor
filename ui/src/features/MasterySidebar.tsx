import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangleIcon,
  BrainCircuitIcon,
  CheckCircle2Icon,
  ChevronLeftIcon,
  ClockIcon,
  HelpCircleIcon,
  Loader2Icon,
  MessageCircleIcon,
  RefreshCwIcon,
  RotateCcwIcon
} from 'lucide-react'
import Button from '@/components/ui/Button'
import BuildStatusDialog from '@/components/mastery/BuildStatusDialog'
import MasteryTree from '@/components/mastery/MasteryTree'
import ResetProgressDialog from '@/components/mastery/ResetProgressDialog'
import {
  getMasteryDocument,
  getMasteryDocuments,
  recordKnowledgePointQuizStarted,
  scheduleKnowledgePointReview,
  selfAssessKnowledgePoint,
  startKnowledgePointLearning
} from '@/api/aitutor'
import type {
  MasteryBuildStatus,
  MasteryDocumentDetail,
  MasteryDocumentSummary,
  MasteryKnowledgePoint,
  MasteryModule
} from '@/api/types'
import { cn } from '@/lib/utils'
import { useQAStore } from '@/stores/qa'
import { toast } from 'sonner'

interface MasterySidebarProps {
  onCollapse?: () => void
}

const MASTERY_DOCUMENTS_CLEARED_EVENT = 'aitutor:mastery-documents-cleared'
type MasteryProgressFilter = 'learning' | 'new' | 'review'

const FILTER_LABELS: Record<MasteryProgressFilter, string> = {
  learning: 'In Progress',
  new: 'Not Started',
  review: 'Review'
}

const FILTER_EMPTY_TEXT: Record<MasteryProgressFilter, string> = {
  learning: 'No in-progress items.',
  new: 'No not-started items.',
  review: 'No review items yet.'
}

const BUILD_STATUS_LABELS: Record<MasteryBuildStatus, string> = {
  not_started: 'Processing',
  queued: 'Processing',
  waiting_rag: 'Processing',
  building: 'Building',
  ready: 'ready to learn',
  build_failed: 'Build Failed',
  rag_failed: 'RAG Failed'
}

function commandId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function detailToSummary(detail: MasteryDocumentDetail): MasteryDocumentSummary {
  return {
    doc_id: detail.doc_id,
    title: detail.title,
    source_file: detail.source_file,
    rag_status: detail.rag_status,
    build_status: detail.build_status,
    build_error: detail.build_error,
    updated_at: detail.updated_at,
    progress: detail.progress
  }
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

function isReviewPoint(point: MasteryKnowledgePoint): boolean {
  return Boolean(point.review_later_at ?? point.review_due)
}

function pointMatchesFilter(point: MasteryKnowledgePoint, filter: MasteryProgressFilter): boolean {
  if (filter === 'review') return isReviewPoint(point)
  return point.status === filter
}

function filterModules(modules: MasteryModule[], filter: MasteryProgressFilter | null): MasteryModule[] {
  if (!filter) return modules
  return modules
    .map((module) => {
      const knowledgePoints = module.knowledge_points.filter((point) => pointMatchesFilter(point, filter))
      return {
        ...module,
        knowledge_points: knowledgePoints,
        mastered: knowledgePoints.filter((point) => point.status === 'mastered').length,
        total: knowledgePoints.length
      }
    })
    .filter((module) => module.knowledge_points.length > 0)
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
          {doc.progress.counts.mastered}/{doc.progress.counts.total} Mastered
        </span>
        {doc.progress.due_reviews > 0 && <span>{doc.progress.due_reviews}  due for review</span>}
      </div>
    </button>
  )
}

export default function MasterySidebar({ onCollapse }: MasterySidebarProps) {
  const enqueueCommand = useQAStore((state) => state.enqueueCommand)
  const [documents, setDocuments] = useState<MasteryDocumentSummary[]>([])
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null)
  const [detail, setDetail] = useState<MasteryDocumentDetail | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<MasteryKnowledgePoint | null>(null)
  const [selectedModule, setSelectedModule] = useState<MasteryModule | null>(null)
  const [buildStatusOpen, setBuildStatusOpen] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [runningAction, setRunningAction] = useState<string | null>(null)
  const [progressFilter, setProgressFilter] = useState<MasteryProgressFilter | null>(null)
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
      toast.error(`Failed to load knowledge points: ${err instanceof Error ? err.message : String(err)}`)
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
      toast.error(`Failed to load knowledge tree: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      if (mountedRef.current) setLoadingDetail(false)
    }
  }, [])

  const refreshMastery = useCallback(async () => {
    await loadDocuments()
    await loadDetail(selectedDocument)
  }, [loadDocuments, loadDetail, selectedDocument])

  const applyDetailUpdate = useCallback((updated: MasteryDocumentDetail) => {
    setDetail(updated)
    setDocuments((current) =>
      current.map((doc) => (doc.doc_id === updated.doc_id ? detailToSummary(updated) : doc))
    )
  }, [])

  useEffect(() => {
    loadDocuments()
  }, [loadDocuments])

  useEffect(() => {
    const handleMasteryDocumentsCleared = () => {
      setDocuments([])
      setSelectedDocId(null)
      setDetail(null)
      setSelectedPoint(null)
      setSelectedModule(null)
    }
    window.addEventListener(MASTERY_DOCUMENTS_CLEARED_EVENT, handleMasteryDocumentsCleared)
    return () => {
      window.removeEventListener(MASTERY_DOCUMENTS_CLEARED_EVENT, handleMasteryDocumentsCleared)
    }
  }, [])

  useEffect(() => {
    if (!needsPolling) return
    const timer = setInterval(loadDocuments, 10000)
    return () => clearInterval(timer)
  }, [loadDocuments, needsPolling])

  const selectedDetailDocId = selectedDocument?.doc_id ?? ''
  const selectedDetailRagStatus = selectedDocument?.rag_status ?? ''
  const selectedDetailBuildStatus = selectedDocument ? getBuildStatus(selectedDocument) : ''

  useEffect(() => {
    loadDetail(selectedDocument)
  }, [loadDetail, selectedDetailBuildStatus, selectedDetailDocId, selectedDetailRagStatus])

  useEffect(() => {
    setSelectedPoint(null)
    setSelectedModule(null)
    setProgressFilter(null)
  }, [selectedDocId])

  const readyCount = documents.filter((doc) => getBuildStatus(doc) === 'ready').length
  const canRenderTree = selectedDocument?.rag_status === 'processed' && getBuildStatus(selectedDocument) === 'ready'
  const activeSelection = useMemo(() => {
    if (!selectedPoint) return null
    if (!detail) {
      return selectedModule ? { point: selectedPoint, module: selectedModule } : null
    }
    for (const module of detail.modules) {
      const point = module.knowledge_points.find((candidate) => candidate.id === selectedPoint.id)
      if (point) return { point, module }
    }
    return selectedModule ? { point: selectedPoint, module: selectedModule } : null
  }, [detail, selectedModule, selectedPoint])
  const selectedPointId = activeSelection?.point.id ?? selectedPoint?.id
  const filteredModules = useMemo(
    () => (detail ? filterModules(detail.modules, progressFilter) : []),
    [detail, progressFilter]
  )
  const reviewPointCount = useMemo(
    () => detail?.modules.reduce(
      (total, module) => total + module.knowledge_points.filter(isReviewPoint).length,
      0
    ) ?? 0,
    [detail]
  )
  const hasFilteredPoints = filteredModules.some((module) => module.knowledge_points.length > 0)

  const handleProgressFilterSelect = useCallback((filter: MasteryProgressFilter) => {
    setProgressFilter(filter)
    if (!detail || !selectedPoint) return
    const selectedPointStillVisible = detail.modules.some((module) =>
      module.knowledge_points.some((point) => point.id === selectedPoint.id && pointMatchesFilter(point, filter))
    )
    if (!selectedPointStillVisible) {
      setSelectedPoint(null)
      setSelectedModule(null)
    }
  }, [detail, selectedPoint])

  const handleProgressFilterClear = useCallback(() => {
    setProgressFilter(null)
  }, [])

  const handleKnowledgePointClick = async (point: MasteryKnowledgePoint, module: MasteryModule) => {
    if (!selectedDocument) return
    setSelectedPoint(point)
    setSelectedModule(module)
    setRunningAction(`start:${point.id}`)
    try {
      const result = await startKnowledgePointLearning(selectedDocument.doc_id, point.id)
      applyDetailUpdate(result.document)
      enqueueCommand({
        id: commandId('mastery-query'),
        kind: 'query',
        prompt: result.prompt,
        metadata: {
          source: 'mastery',
          docId: selectedDocument.doc_id,
          knowledgePointId: point.id
        }
      })
      toast.success('Started knowledge point learning')
    } catch (err) {
      toast.error(`Failed to start learning: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunningAction(null)
    }
  }

  const handleContinuePoint = useCallback(() => {
    if (!selectedDocument || !activeSelection) return
    enqueueCommand({
      id: commandId('mastery-followup'),
      kind: 'query',
      prompt: `I want to continue discussing the knowledge point "${activeSelection.point.title}". Use the current document to help me understand it, and first ask me one question that can reveal gaps in my understanding.`,
      metadata: {
        source: 'mastery',
        docId: selectedDocument.doc_id,
        knowledgePointId: activeSelection.point.id
      }
    })
  }, [activeSelection, enqueueCommand, selectedDocument])

  const handlePointUnderstood = useCallback(async () => {
    if (!selectedDocument || !activeSelection) return
    setRunningAction('understood')
    try {
      const updated = await selfAssessKnowledgePoint(selectedDocument.doc_id, activeSelection.point.id, true)
      applyDetailUpdate(updated)
      toast.success('Marked as mastered')
    } catch (err) {
      toast.error(`Failed to update learning status: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunningAction(null)
    }
  }, [activeSelection, applyDetailUpdate, selectedDocument])

  const handlePointQuiz = useCallback(async () => {
    if (!selectedDocument || !activeSelection) return
    setRunningAction('quiz')
    try {
      const updated = await recordKnowledgePointQuizStarted(selectedDocument.doc_id, activeSelection.point.id)
      applyDetailUpdate(updated)
      enqueueCommand({
        id: commandId('mastery-quiz'),
        kind: 'quiz',
        topic: `Knowledge point "${activeSelection.point.title}" from document "${selectedDocument.title}". Focus on definition, dependencies, and use cases in the document.`,
        num_questions: 3,
        difficulty: 'auto',
        question_types: [],
        metadata: {
          source: 'mastery',
          docId: selectedDocument.doc_id,
          knowledgePointId: activeSelection.point.id
        }
      })
      toast.success('Started knowledge point quiz')
    } catch (err) {
      toast.error(`Failed to start quiz: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunningAction(null)
    }
  }, [activeSelection, applyDetailUpdate, enqueueCommand, selectedDocument])

  const handleReviewLater = useCallback(async () => {
    if (!selectedDocument || !activeSelection) return
    setRunningAction('review')
    try {
      const updated = await scheduleKnowledgePointReview(selectedDocument.doc_id, activeSelection.point.id)
      applyDetailUpdate(updated)
      toast.success('Added to review later')
    } catch (err) {
      toast.error(`Failed to schedule review: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRunningAction(null)
    }
  }, [activeSelection, applyDetailUpdate, selectedDocument])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-border/60 px-3">
        <div className="flex min-w-0 items-center gap-2">
          <BrainCircuitIcon className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">Knowledge Points</p>
            <p className="text-[11px] text-muted-foreground">{readyCount}/{documents.length} ready to learn</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={refreshMastery}
            disabled={loadingDocs}
            tooltip="Refresh knowledge points"
          >
            <RefreshCwIcon className={cn('h-4 w-4', loadingDocs && 'animate-spin')} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onCollapse} tooltip="Collapse sidebar">
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="max-h-56 shrink-0 overflow-y-auto border-b border-border/60 p-2">
          {documents.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              No knowledge points yet. Upload and process a document first.
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
            <div className="py-8 text-center text-xs text-muted-foreground">No Documents</div>
          ) : !canRenderTree ? (
            <div className="py-8 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border bg-background">
                <StatusIcon status={getBuildStatus(selectedDocument)} />
              </div>
              <p className="mt-3 text-sm font-medium">{BUILD_STATUS_LABELS[getBuildStatus(selectedDocument)]}</p>
              <p className="mx-auto mt-1 max-w-56 text-xs leading-5 text-muted-foreground">
                Knowledge points stay processing until RAG completes. The knowledge tree appears only after the document is completed.
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
                View Status
              </Button>
            </div>
          ) : loadingDetail ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2Icon className="h-4 w-4 animate-spin" />
              Loading knowledge tree
            </div>
          ) : detail ? (
            <div className="py-2">
              <div className="rounded-md border border-border bg-background p-3">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-muted-foreground">Learning Progress</span>
                  <span className="font-medium text-foreground">
                    {detail.progress.counts.mastered}/{detail.progress.counts.total}
                  </span>
                </div>
                <div className="mt-2">
                  <ProgressBar doc={detail} />
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[11px]">
                  <button
                    type="button"
                    onClick={() => handleProgressFilterSelect('learning')}
                    className={cn(
                      'rounded-md bg-secondary p-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      progressFilter === 'learning' && 'bg-accent text-accent-foreground ring-1 ring-primary/30'
                    )}
                    aria-pressed={progressFilter === 'learning'}
                  >
                    <p className="font-semibold text-foreground">{detail.progress.counts.learning}</p>
                    <p className="text-muted-foreground">In Progress</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleProgressFilterSelect('new')}
                    className={cn(
                      'rounded-md bg-secondary p-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      progressFilter === 'new' && 'bg-accent text-accent-foreground ring-1 ring-primary/30'
                    )}
                    aria-pressed={progressFilter === 'new'}
                  >
                    <p className="font-semibold text-foreground">{detail.progress.counts.new}</p>
                    <p className="text-muted-foreground">Not Started</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleProgressFilterSelect('review')}
                    className={cn(
                      'rounded-md bg-secondary p-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      progressFilter === 'review' && 'bg-accent text-accent-foreground ring-1 ring-primary/30'
                    )}
                    aria-pressed={progressFilter === 'review'}
                  >
                    <p className="font-semibold text-foreground">{reviewPointCount}</p>
                    <p className="text-muted-foreground">Review</p>
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setBuildStatusOpen(true)}
                    className="px-2 text-xs"
                  >
                    Status
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setResetDialogOpen(true)}
                    className="px-2 text-xs"
                  >
                    <RotateCcwIcon className="h-3.5 w-3.5" />
                    Reset
                  </Button>
                </div>
              </div>

              {activeSelection && (
                <div className="mt-3 rounded-md border border-primary/20 bg-primary/5 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">
                        {activeSelection.point.title}
                      </p>
                      <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
                        {activeSelection.point.description}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-md bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground">
                      {activeSelection.point.mastery_level}%
                    </span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Button
                      variant="default"
                      size="sm"
                      className="px-2 text-xs"
                      onClick={handleContinuePoint}
                      disabled={Boolean(runningAction)}
                    >
                      <MessageCircleIcon className="h-3.5 w-3.5" />
                      Continue Discussion
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="px-2 text-xs"
                      onClick={handlePointUnderstood}
                      disabled={Boolean(runningAction)}
                    >
                      <CheckCircle2Icon className="h-3.5 w-3.5" />
                      I Understand
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="px-2 text-xs"
                      onClick={handlePointQuiz}
                      disabled={Boolean(runningAction)}
                    >
                      <HelpCircleIcon className="h-3.5 w-3.5" />
                      Quiz
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="px-2 text-xs"
                      onClick={handleReviewLater}
                      disabled={Boolean(runningAction)}
                    >
                      <ClockIcon className="h-3.5 w-3.5" />
                      Review Later
                    </Button>
                  </div>
                </div>
              )}

              <div className="mt-3">
                {progressFilter && (
                  <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs">
                    <span className="min-w-0 truncate text-muted-foreground">
                      Showing: <span className="font-medium text-foreground">{FILTER_LABELS[progressFilter]}</span>
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 shrink-0 px-2 text-xs"
                      onClick={handleProgressFilterClear}
                    >
                      Clear Filter
                    </Button>
                  </div>
                )}
                {hasFilteredPoints ? (
                  <MasteryTree
                    modules={filteredModules}
                    selectedKnowledgePointId={selectedPointId}
                    onKnowledgePointClick={handleKnowledgePointClick}
                  />
                ) : (
                  <div className="rounded-md border border-dashed border-border bg-background p-4 text-center text-xs text-muted-foreground">
                    {progressFilter ? FILTER_EMPTY_TEXT[progressFilter] : 'No knowledge points found.'}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-xs text-muted-foreground">Knowledge tree is unavailable</div>
          )}
        </div>
      </div>
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
