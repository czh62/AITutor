import { useState, useEffect, useMemo } from 'react'
import {
  ChevronDown, BrainCircuit, SearchIcon, GlobeIcon, PencilIcon,
  BookOpenIcon, Sparkles, CheckCircleIcon, MessageCircleQuestionIcon
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { StreamEvent, LoopEventType } from '@/api/types'

/* ------------------------------------------------------------------ */
/*  Type与辅助                                                          */
/* ------------------------------------------------------------------ */

type TraceMetadata = {
  call_id?: string
  call_kind?: string
  call_role?: string
  query?: string
  quality?: string
  provider?: string
  status?: string
  results?: Array<{ title: string; url: string; snippet: string }>
  original_query?: string
  need_web_search?: boolean
  missing_aspects?: string[]
  rewritten_query?: string
  // tool_call / tool_result 相关
  tool_name?: string
  tool_call_id?: string
  arguments?: Record<string, unknown>
  full_content?: string
  sources_count?: number
  ask_user?: { questions: Array<{ id: string; text: string; options?: string[] | null }>; context: string }
  paused?: boolean
}

function getTraceMeta(event: StreamEvent): TraceMetadata {
  return (event.metadata ?? {}) as TraceMetadata
}

/** 折叠空白并截断到 max 字符 + 省略号 */
function clip(value: string, max = 56) {
  const text = value.replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/* 按call_id分组事件 */
type TraceItem = { callId: string; events: StreamEvent[] }

function groupByCallId(events: StreamEvent[]): TraceItem[] {
  const groups: TraceItem[] = []
  const indexById = new Map<string, number>()

  for (const event of events) {
    const callId = String(getTraceMeta(event).call_id || '')
    if (!callId) continue  // 无call_id的事件跳过（stage_start/done/result等全局事件）
    const existingIndex = indexById.get(callId)
    if (existingIndex === undefined) {
      indexById.set(callId, groups.length)
      groups.push({ callId, events: [event] })
    } else {
      groups[existingIndex].events.push(event)
    }
  }
  return groups
}

/** 判断一个call_id组是否仍在活跃（最后事件没有completion标记） */
function isTraceActive(events: StreamEvent[]): boolean {
  // 如果有progress事件且quality为sufficient/forced，视为完成
  for (const event of events) {
    if (event.type === 'progress') {
      const meta = getTraceMeta(event)
      if (meta.quality === 'sufficient' || meta.quality === 'forced' || meta.quality === 'short_query') {
        return false
      }
    }
  }
  // 如果有search事件且status=complete或failed，搜索完成但仍需看后续
  // content事件意味着LLM正在产出文本，视为活跃
  for (const event of events) {
    if (event.type === 'content') return false  // content意味着这个call在产出最终文本
  }
  return true
}

/** 判断call_id组是否有可渲染内容 */
function hasTraceSubstance(events: StreamEvent[]): boolean {
  return events.some(event => {
    if (event.type === 'thinking' || event.type === 'observation') {
      return event.content.trim().length > 0
    }
    if (event.type === 'search') {
      return true  // 搜索事件总是有内容
    }
    if (event.type === 'tool_call' || event.type === 'tool_result') {
      return true  // Tool调用/Result事件总是有内容
    }
    if (event.type === 'wait_for_input') {
      return true  // ask_user 暂停事件
    }
    if (event.type === 'content') {
      // narration 轮的 preamble 文本（agent_loop_round + narration 角色）
      const kind = String(getTraceMeta(event).call_kind || '')
      const role = String(getTraceMeta(event).call_role || '')
      if (kind === 'agent_loop_round' && role === 'narration' && event.content.trim()) {
        return true
      }
    }
    if (event.type === 'progress') {
      return event.content.trim().length > 0
    }
    if (event.type === 'query_rewrite') {
      return event.content.trim().length > 0
    }
    if (event.type === 'error') {
      return event.content.trim().length > 0
    }
    return false
  })
}

/** 获取call_kind */
function getCallKind(events: StreamEvent[]): string {
  for (const event of events) {
    const kind = String(getTraceMeta(event).call_kind || '')
    if (kind) return kind
  }
  return ''
}

/** 获取call_role */
function getCallRole(events: StreamEvent[]): string {
  for (const event of events) {
    const role = String(getTraceMeta(event).call_role || '')
    if (role) return role
  }
  return ''
}

/** 获取指定Type事件的文本 */
function getTraceText(events: StreamEvent[], types: LoopEventType[]): string {
  const textEvents = events.filter(
    e => types.includes(e.type) && e.content.trim().length > 0
  )
  if (!textEvents.length) return ''
  return textEvents.map(e => e.content).join('')
}

/* ------------------------------------------------------------------ */
/*  行图标与描述                                                        */
/* ------------------------------------------------------------------ */

type CallKindIcon = {
  icon: typeof SearchIcon
  label: string  // 中文Labels
}

function describeCallKind(kind: string, role: string, events: StreamEvent[]): CallKindIcon {
  switch (kind) {
    case 'agent_loop_round':
      if (role === 'retrieve') return { icon: SearchIcon, label: 'Retrieval' }
      if (role === 'observe') return { icon: BookOpenIcon, label: 'Observation' }
      if (role === 'narration') return { icon: Sparkles, label: 'Reasoning' }
      return { icon: Sparkles, label: 'Reasoning' }
    case 'llm_evaluation':
      return { icon: BrainCircuit, label: 'Evaluation' }
    case 'web_search':
      return { icon: GlobeIcon, label: 'Web Search' }
    case 'llm_final_response':
      return { icon: CheckCircleIcon, label: 'Answer' }
    case 'tool_call':
      // 按 tool_name 细分图标（rag / web_search / ask_user）
      return describeToolCall(events)
    default:
      return { icon: Sparkles, label: 'Reasoning' }
  }
}

/** tool_call Tool行图标（按 tool_name 区分） */
function describeToolCall(events: StreamEvent[]): CallKindIcon {
  let toolName = ''
  for (const e of events) {
    const name = String(getTraceMeta(e).tool_name || '')
    if (name) {
      toolName = name
      break
    }
  }
  switch (toolName) {
    case 'rag':
      return { icon: BookOpenIcon, label: 'Search Knowledge Base' }
    case 'web_search':
      return { icon: GlobeIcon, label: 'Web Search' }
    case 'ask_user':
      return { icon: MessageCircleQuestionIcon, label: 'Ask You' }
    default:
      return { icon: Sparkles, label: 'Call Tool' }
  }
}

/** 获取chip文本（紧随Labels的补充信息） */
function getChip(kind: string, role: string, events: StreamEvent[]): string | null {
  const query = events.map(e => getTraceMeta(e).query).find(Boolean) || ''
  switch (kind) {
    case 'agent_loop_round':
      if (role === 'retrieve' && query) return clip(query, 40)
      return null
    case 'llm_evaluation':
      // 显示quality判定
      for (const event of events) {
        if (event.type === 'thinking') {
          const meta = getTraceMeta(event)
          if (meta.quality) return meta.quality === 'sufficient' ? 'Sufficient' : 'Insufficient'
        }
      }
      return null
    case 'web_search':
      // 显示Search Results数
      for (const event of events) {
        if (event.type === 'search') {
          const meta = getTraceMeta(event)
          if (meta.status === 'complete' && meta.results) {
            return `${meta.results.length} results`
          }
        }
      }
      return query ? clip(query, 40) : null
    case 'tool_call':
      // Tool行 chip：显示Tool参数摘要（rag/web_search 的 query，ask_user 的Question数）
      return getToolCallChip(events)
    default:
      return null
  }
}

/** tool_call 行的 chip 文本 */
function getToolCallChip(events: StreamEvent[]): string | null {
  for (const e of events) {
    const meta = getTraceMeta(e)
    const args = meta.arguments as Record<string, unknown> | undefined
    const toolName = String(meta.tool_name || '')
    if (e.type === 'tool_call' && args) {
      if (toolName === 'ask_user') {
        const qs = args.questions
        const n = Array.isArray(qs) ? qs.length : 0
        return n ? `${n} questions` : null
      }
      const q = typeof args.query === 'string' ? args.query : ''
      if (q) return clip(q, 40)
    }
    if (e.type === 'tool_result') {
      const cnt = meta.sources_count
      if (typeof cnt === 'number' && cnt > 0) return `${cnt} sources`
    }
  }
  return null
}

/* ------------------------------------------------------------------ */
/*  流式模式检测                                                        */
/* ------------------------------------------------------------------ */

type StreamingMode = 'reasoning' | 'exploring' | 'searching' | 'evaluating' | 'tool_calling' | 'waiting' | 'responding' | 'responded'

function detectStreamingMode(events: StreamEvent[], isStreaming: boolean): StreamingMode {
  if (!isStreaming) return 'responded'

  // 从后往前扫描，最后一个有意义的事件决定模式
  for (let idx = events.length - 1; idx >= 0; idx--) {
    const event = events[idx]
    const meta = getTraceMeta(event)
    const kind = String(meta.call_kind || '')

    // ask_user 暂停：等待用户Reply
    if (event.type === 'wait_for_input') return 'waiting'
    if (kind === 'llm_final_response' && event.type === 'content') return 'responding'
    if (kind === 'llm_evaluation' && event.type === 'thinking') return 'evaluating'
    if (kind === 'web_search') return 'searching'
    // tool-calling：Tool调用进行中
    if (event.type === 'tool_call') return 'tool_calling'
    if (event.type === 'tool_result') return 'tool_calling'
    if (kind === 'agent_loop_round' && event.type === 'observation') return 'exploring'
    if (event.type === 'search') return 'searching'
    if (event.type === 'thinking') return 'evaluating'
  }
  return 'reasoning'
}

const MODE_LABELS: Record<StreamingMode, string> = {
  reasoning: 'EduMind AI is reasoning...',
  exploring: 'EduMind AI is retrieving...',
  searching: 'EduMind AI is searching...',
  evaluating: 'EduMind AI is evaluating...',
  tool_calling: 'EduMind AI is calling tools...',
  waiting: 'EduMind AI is waiting for your reply...',
  responding: 'EduMind AI is answering...',
  responded: 'EduMind AI answered',
}

const MODE_ICONS: Record<StreamingMode, typeof Sparkles> = {
  reasoning: BrainCircuit,
  exploring: SearchIcon,
  searching: GlobeIcon,
  evaluating: BrainCircuit,
  tool_calling: Sparkles,
  waiting: MessageCircleQuestionIcon,
  responding: CheckCircleIcon,
  responded: CheckCircleIcon,
}

/* ------------------------------------------------------------------ */
/*  计时器                                                              */
/* ------------------------------------------------------------------ */

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const rem = total % 60
  return rem === 0 ? `${minutes}m` : `${minutes}m ${rem}s`
}

/* ------------------------------------------------------------------ */
/*  TraceRowItem — 内联活动行                                           */
/* ------------------------------------------------------------------ */

function TraceRowItem({
  trace,
  active,
}: {
  trace: TraceItem
  active: boolean
}) {
  const { events: callEvents } = trace
  const kind = getCallKind(callEvents)
  const role = getCallRole(callEvents)

  // llm_final_response 组不在trace里显示（它属于Answer气泡）
  if (kind === 'llm_final_response') return null

  // 无实质内容的组跳过
  if (!hasTraceSubstance(callEvents)) return null

  const descriptor = describeCallKind(kind, role, callEvents)
  const chip = getChip(kind, role, callEvents)
  const isThinking = kind === 'llm_evaluation'  // Evaluation类行始终展开（thinking是核心内容）

  // 折叠/展开Status：Thinking类行常开，其余流式Auto展开完成后折叠
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = isThinking ? true : (userOpen ?? active)

  const thoughtText = getTraceText(callEvents, ['thinking'])
  const observationText = getTraceText(callEvents, ['observation'])
  const progressText = getTraceText(callEvents, ['progress'])

  // Search Results
  const searchResults = useMemo(() => {
    for (const event of callEvents) {
      if (event.type === 'search') {
        const meta = getTraceMeta(event)
        if (meta.results && meta.status === 'complete') return meta.results
      }
    }
    return null
  }, [callEvents])

  const quality = useMemo(() => {
    for (const event of callEvents) {
      if (event.type === 'thinking') {
        const meta = getTraceMeta(event)
        if (meta.quality) return meta.quality
      }
      if (event.type === 'progress') {
        const meta = getTraceMeta(event)
        if (meta.quality) return meta.quality
      }
    }
    return ''
  }, [callEvents])

  // 改写Query
  const rewrittenQuery = useMemo(() => {
    for (const event of callEvents) {
      if (event.type === 'query_rewrite') return event.content
      if (event.type === 'progress') {
        const meta = getTraceMeta(event)
        if (meta.rewritten_query) return String(meta.rewritten_query)
      }
    }
    return ''
  }, [callEvents])

  // Tool调用/Result信息（tool_call 行用）
  const toolInfo = useMemo(() => {
    let callArgs: string = ''
    let resultText: string = ''
    let toolName = ''
    for (const event of callEvents) {
      const meta = getTraceMeta(event)
      if (event.type === 'tool_call') {
        toolName = String(meta.tool_name || toolName)
        const args = meta.arguments as Record<string, unknown> | undefined
        if (args) {
          if (toolName === 'ask_user') {
            const qs = Array.isArray(args.questions) ? args.questions : []
            callArgs = qs.map((q: any, i: number) => `Q${i + 1}: ${q?.text || ''}`).join('\n')
          } else {
            const q = typeof args.query === 'string' ? args.query : ''
            callArgs = q
          }
        }
      }
      if (event.type === 'tool_result') {
        toolName = String(meta.tool_name || toolName)
        const full = meta.full_content
        resultText = typeof full === 'string' ? full : event.content
      }
    }
    return { toolName, callArgs, resultText }
  }, [callEvents])

  const isToolRow = kind === 'tool_call'
  // narration 轮的 preamble 文本（agent_loop_round + narration，非Tool行）
  const narrationText = useMemo(() => {
    if (isToolRow) return ''
    return getTraceText(
      callEvents.filter(
        (e) =>
          e.type === 'content' &&
          String(getTraceMeta(e).call_role || '') === 'narration'
      ),
      ['content']
    )
  }, [callEvents, isToolRow])
  const canToggle =
    !isThinking &&
    (thoughtText || observationText || searchResults || progressText || (isToolRow && (toolInfo.callArgs || toolInfo.resultText)) || narrationText)

  return (
    <div className="group/row">
      {/* 行标题 */}
      <button
        type="button"
        onClick={canToggle ? () => setUserOpen(!open) : undefined}
        disabled={!canToggle}
        className={cn(
          'flex w-full items-center gap-2.5 py-1.5 text-[13px] leading-[1.5]',
          canToggle
            ? 'cursor-pointer text-muted-foreground hover:text-foreground transition-colors'
            : 'cursor-default text-muted-foreground',
        )}
      >
        {/* 脉动/静态图标 */}
        <descriptor.icon
          size={15}
          strokeWidth={1.5}
          className={cn(
            'shrink-0',
            active ? 'text-primary animate-pulse' : 'text-muted-foreground/55',
          )}
        />

        {/* Labels + chip */}
        <span className={cn('font-medium', active && 'animate-pulse')}>
          {descriptor.label}
        </span>
        {chip && (
          <span className="text-muted-foreground/55 truncate text-[12px]">
            {chip}
          </span>
        )}

        {/* quality 标记 */}
        {quality && kind === 'llm_evaluation' && (
          <span className={cn(
            'text-[11px] font-medium',
            quality === 'sufficient' ? 'text-emerald-500' : 'text-amber-500',
          )}>
            {quality === 'sufficient' ? '✓' : '✗'}
          </span>
        )}

        {/* 折叠 chevron */}
        {canToggle && (
          <ChevronDown
            size={13}
            className={cn(
              'ml-auto shrink-0 text-muted-foreground/40 opacity-0 transition-[transform,opacity] duration-150',
              'group-hover/row:opacity-100',
              open ? '' : '-rotate-90',
            )}
          />
        )}
      </button>

      {/* 展开内容 */}
      {open && (
        <div className="ml-[26px] mr-2 mt-0.5 max-h-[180px] overflow-y-auto pr-1 text-[11.5px] leading-[1.6] text-muted-foreground">
          {/* Thinking文本 */}
          {thoughtText && (
            <div className="space-y-0.5">
              <div className="text-[10px] font-semibold tracking-[0.04em] text-muted-foreground/70">
                Thinking
              </div>
              <div className="whitespace-pre-wrap break-words">{thoughtText}</div>
            </div>
          )}

          {/* narration preamble（Tool调用前的说明文本） */}
          {narrationText && !isToolRow && (
            <div className="whitespace-pre-wrap break-words text-muted-foreground/80">
              {clip(narrationText, 200)}
            </div>
          )}

          {/* Tool调用参数 */}
          {isToolRow && toolInfo.callArgs && (
            <div className="space-y-0.5">
              <div className="text-[10px] font-semibold tracking-[0.04em] text-muted-foreground/70">
                {toolInfo.toolName === 'ask_user' ? 'Question' : 'Query'}
              </div>
              <div className="whitespace-pre-wrap break-words text-muted-foreground/80">
                {clip(toolInfo.callArgs, 200)}
              </div>
            </div>
          )}

          {/* ToolResult */}
          {isToolRow && toolInfo.resultText && (
            <div className="mt-1 space-y-0.5">
              <div className="text-[10px] font-semibold tracking-[0.04em] text-muted-foreground/70">
                Result
              </div>
              <div className="whitespace-pre-wrap break-words text-muted-foreground/70">
                {clip(toolInfo.resultText, 400)}
              </div>
            </div>
          )}

          {/* Search Results */}
          {searchResults && searchResults.length > 0 && (
            <div className="mt-1 space-y-0.5">
              <div className="text-[10px] font-semibold tracking-[0.04em] text-muted-foreground/70">
                Search Results
              </div>
              {searchResults.slice(0, 3).map((r, i) => (
                <div key={i} className="text-muted-foreground/70 truncate">
                  🔗 {r.title}: {r.snippet.slice(0, 80)}{r.snippet.length > 80 ? '…' : ''}
                </div>
              ))}
            </div>
          )}

          {/* ObservationResult */}
          {observationText && (
            <div className="mt-1 space-y-0.5">
              <div className="text-[10px] font-semibold tracking-[0.04em] text-muted-foreground/70">
                Observation
              </div>
              <div className="whitespace-pre-wrap break-words text-muted-foreground/70">
                {clip(observationText, 300)}
              </div>
            </div>
          )}

          {/* 改写Query */}
          {rewrittenQuery && (
            <div className="mt-0.5 flex items-start gap-1 text-amber-600 dark:text-amber-400">
              <PencilIcon className="h-2.5 w-2.5 shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap break-words font-medium">
                Rewrite: {rewrittenQuery}
              </span>
            </div>
          )}

          {/* 进度文本 */}
          {progressText && !thoughtText && (
            <div className="opacity-70">{progressText}</div>
          )}

          {/* Incorrect */}
          {callEvents.some(e => e.type === 'error') && (
            <div className="mt-1 space-y-0.5">
              {callEvents.filter(e => e.type === 'error' && e.content.trim()).map((e, i) => (
                <div key={i} className="text-red-400/80">✗ {e.content}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  CallTracePanel — 按call_id分组的trace面板                          */
/* ------------------------------------------------------------------ */

function CallTracePanel({
  events,
  isStreaming,
}: {
  events: StreamEvent[]
  isStreaming?: boolean
}) {
  const traceGroups = useMemo(() => groupByCallId(events), [events])

  // 过滤掉无实质内容和final_response组
  const renderableGroups = useMemo(
    () => traceGroups.filter(g => {
      const kind = getCallKind(g.events)
      if (kind === 'llm_final_response') return false
      return hasTraceSubstance(g.events)
    }),
    [traceGroups],
  )

  if (!renderableGroups.length) return null

  return (
    <div className="mb-3 space-y-0.5">
      {renderableGroups.map((group, idx) => {
        const isLast = idx === renderableGroups.length - 1
        const active = Boolean(isStreaming) && isLast && isTraceActive(group.events)
        return (
          <TraceRowItem
            key={group.callId}
            trace={group}
            active={active}
          />
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  StreamingStatus — Status行                                            */
/* ------------------------------------------------------------------ */

function StreamingStatus({
  events,
  isStreaming,
  expandable,
  expanded,
  onToggle,
}: {
  events: StreamEvent[]
  isStreaming?: boolean
  expandable?: boolean
  expanded?: boolean
  onToggle?: () => void
}) {
  const mode = detectStreamingMode(events, Boolean(isStreaming))
  const label = MODE_LABELS[mode]
  const Icon = MODE_ICONS[mode]

  // 计时器
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    if (!isStreaming) return
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => window.clearInterval(timer)
  }, [isStreaming])

  // 计算耗时：从第一个事件到now（流式）或最后事件（完成）
  const duration = useMemo(() => {
    const timestamps = events
      .map(e => e.timestamp)
      .filter((t): t is number => typeof t === 'number' && t > 0)
    if (!timestamps.length) return null
    const min = Math.min(...timestamps)
    const max = isStreaming ? now : Math.max(...timestamps)
    return Math.max(0, max - min)
  }, [events, isStreaming, now])

  const durationLabel = duration != null ? formatDuration(duration) : null

  const isResponded = mode === 'responded'
  const breathingClass = isResponded ? '' : 'animate-pulse'

  const rowInner = (
    <>
      <Icon
        size={20}
        strokeWidth={1.5}
        className={cn('shrink-0', isResponded ? 'text-muted-foreground/70' : 'text-primary/90 animate-pulse')}
      />
      <span className={cn('font-semibold', breathingClass, isResponded ? 'text-muted-foreground/70' : 'text-muted-foreground')}>
        {label}
      </span>
      {durationLabel && (
        <span className="text-[12px] font-medium tabular-nums text-muted-foreground/55">
          · {durationLabel}
        </span>
      )}
    </>
  )

  if (expandable) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="group/act flex w-full items-center gap-2.5 text-[14px] leading-none text-muted-foreground hover:text-foreground transition-colors"
      >
        {rowInner}
        <ChevronDown
          size={14}
          strokeWidth={2}
          className={cn(
            'ml-0.5 shrink-0 text-muted-foreground/45 transition-[transform,color] duration-200',
            'group-hover/act:text-muted-foreground',
            expanded ? '' : '-rotate-90',
          )}
        />
      </button>
    )
  }

  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2.5 text-[14px] font-semibold leading-none text-muted-foreground">
      {rowInner}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  AssistantActivity — Status行 + trace折叠/展开                         */
/* ------------------------------------------------------------------ */

export function AssistantActivity({
  events,
  isStreaming,
  content,
}: {
  events: StreamEvent[]
  isStreaming?: boolean
  content?: string
}) {
  const hasFinalContent = Boolean(content && content.trim().length > 0)

  // 判断是否进入了最终Answer阶段
  const finalPhase = useMemo(() => {
    if (!isStreaming) return true
    // 检测是否有finish标记或llm_final_response事件
    for (const event of events) {
      const meta = getTraceMeta(event)
      if (meta.call_role === 'finish') return true
      if (meta.call_kind === 'llm_final_response' && event.type === 'content') return true
    }
    return false
  }, [events, isStreaming])

  // 判断是否有可渲染的trace组
  const hasTrace = useMemo(() => {
    const groups = groupByCallId(events)
    return groups.some(g => {
      const kind = getCallKind(g.events)
      if (kind === 'llm_final_response') return false
      return hasTraceSubstance(g.events)
    })
  }, [events])

  // null = Auto跟随phase（流式展开，完成后折叠）；boolean = 用户手动pin
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = hasTrace && (userOpen ?? !finalPhase)

  // 无内容、无trace、非流式 → 不渲染
  if (!isStreaming && !hasFinalContent && !hasTrace) return null

  return (
    <div className="mb-2">
      <StreamingStatus
        events={events}
        isStreaming={isStreaming}
        expandable={hasTrace}
        expanded={open}
        onToggle={() => setUserOpen(!open)}
      />
      {hasTrace && (
        <div
          className={cn(
            'grid transition-[grid-template-rows,opacity] duration-300 ease-out',
            open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
          )}
        >
          <div className="overflow-hidden">
            {/* 竖线引导 + trace内容 */}
            <div className="ml-[11px] border-l border-border/45 pl-[13px] pt-2">
              <CallTracePanel events={events} isStreaming={isStreaming} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  TraceFlow — 便捷入口                                                */
/* ------------------------------------------------------------------ */

export function TraceFlow({
  events,
  isStreaming,
}: {
  events: StreamEvent[]
  isStreaming?: boolean
}) {
  const hasTrace = useMemo(() => {
    const groups = groupByCallId(events)
    return groups.some(g => {
      const kind = getCallKind(g.events)
      if (kind === 'llm_final_response') return false
      return hasTraceSubstance(g.events)
    })
  }, [events])

  if (!hasTrace) return null
  return <CallTracePanel events={events} isStreaming={isStreaming} />
}

/* ------------------------------------------------------------------ */
/*  向后兼容：LoopTrace → StreamEvent[] 转换                            */
/* ------------------------------------------------------------------ */

import type { LoopTrace } from '@/api/types'

/** 将旧格式LoopTrace转换为StreamEvent[]（向后兼容） */
export function loopTraceToEvents(trace: LoopTrace): StreamEvent[] {
  const events: StreamEvent[] = []

  events.push({
    type: 'stage_start',
    round: 0,
    content: '',
    metadata: { original_query: trace.steps[0]?.originalQuery || '', max_rounds: trace.rounds },
  })

  for (const step of trace.steps) {
    const roundCallId = `agent_loop_round_${step.round}`
    const evalCallId = `eval_round_${step.round}`

    events.push({
      type: 'observation',
      round: step.round,
      content: step.contextSummary || '',
      metadata: { call_id: roundCallId, call_kind: 'agent_loop_round', call_role: 'retrieve', query: step.query },
    })

    events.push({
      type: 'thinking',
      round: step.round,
      content: step.thinking || '',
      metadata: { call_id: evalCallId, call_kind: 'llm_evaluation', call_role: 'thought', quality: step.quality },
    })

    if (step.webSearchQuery) {
      events.push({
        type: 'search',
        round: step.round,
        content: `Found ${step.webSearchResults?.length || 0} web results`,
        metadata: {
          call_id: `search_round_${step.round}`, call_kind: 'web_search',
          query: step.webSearchQuery, status: 'complete',
          results: (step.webSearchResults || []).map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
        },
      })
    }

    const isSufficient = step.quality === 'sufficient' || step.quality === 'short_query'
    events.push({
      type: 'progress',
      round: step.round,
      content: isSufficient ? 'Context is sufficient. Preparing the answer.' : 'Context is insufficient. Need to rewrite the query.',
      metadata: {
        call_id: roundCallId, call_kind: 'agent_loop_round',
        call_role: isSufficient ? 'finish' : 'narration',
        quality: step.quality,
        rewritten_query: step.rewrittenQuery || '',
        need_web_search: step.needWebSearch || false,
      },
    })

    if (step.rewrittenQuery && !isSufficient) {
      events.push({
        type: 'query_rewrite',
        round: step.round + 1,
        content: step.rewrittenQuery,
        metadata: { call_id: roundCallId, call_kind: 'agent_loop_round', call_role: 'narration', original_query: step.originalQuery },
      })
    }
  }

  events.push({
    type: 'result',
    round: 0,
    content: '',
    metadata: { call_id: 'loop_summary', rounds: trace.rounds, completed: trace.completed, engine: trace.engine },
  })

  return events
}

/* ------------------------------------------------------------------ */
/*  旧LoopTracePanel — 向后兼容渲染                                     */
/* ------------------------------------------------------------------ */

export { default as LoopTracePanelLegacy } from './LoopTracePanel'
