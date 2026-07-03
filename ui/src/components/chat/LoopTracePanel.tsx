import { useState } from 'react'
import { ChevronRightIcon, SearchIcon, BrainCircuitIcon, CheckCircleIcon, XCircleIcon, PencilIcon, GlobeIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { LoopTrace, LoopStep } from '@/api/types'

/**
 * AgentLoop 思维链面板。
 *
 * 渲染每轮查询改写的思维过程：
 * - 每轮为一个可折叠卡片，显示查询、评估思考、质量判定
 * - insufficient 的轮次高亮显示改写查询
 * - sufficient / forced 的最后一轮用不同样式标记
 * - 联网搜索结果单独显示（搜索查询 + 结果摘要）
 * - 流式进行中默认展开；完成后默认折叠
 *
 * 整体外观：圆角边框 + 浅背景，与 ThinkingBlock 风格一致。
 */
interface Props {
  trace: LoopTrace
  isStreaming?: boolean
}

export default function LoopTracePanel({ trace, isStreaming }: Props) {
  const [open, setOpen] = useState(true)

  const hasInsufficient = trace.steps.some(s => s.quality === 'insufficient')
  const hasWebSearch = trace.steps.some(s => s.webSearchQuery || s.needWebSearch)
  const lastQuality = trace.steps.length > 0 ? trace.steps[trace.steps.length - 1].quality : ''

  return (
    <div className="my-2 overflow-hidden rounded-md border border-border/50 bg-muted/30 text-xs">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-muted-foreground hover:bg-muted/60"
      >
        <ChevronRightIcon className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} />
        <SearchIcon className="h-3 w-3 shrink-0 text-emerald-500" />
        <span>
          思维链（{trace.rounds} 轮
          {trace.completed ? '，已完成' : '，强制结束'}
          {lastQuality === 'sufficient' && '，充分'}
          {hasInsufficient && '，有改写'}
          {hasWebSearch && '，有搜索'}
         ）
        </span>
        {isStreaming && <span className="ml-auto inline-block animate-pulse">▌</span>}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border/40 px-2.5 py-2">
          {trace.steps.map((step) => (
            <StepCard key={step.round} step={step} />
          ))}
        </div>
      )}
    </div>
  )
}

/** 单轮步骤卡片。 */
function StepCard({ step }: { step: LoopStep }) {
  const isSufficient = step.quality === 'sufficient'
  const isInsufficient = step.quality === 'insufficient'
  const isForced = step.quality === 'forced'
  const isShortQuery = step.quality === 'short_query'

  return (
    <div
      className={cn(
        'rounded border border-border/40 px-2 py-1.5',
        isSufficient && 'border-emerald-400/40 bg-emerald-50/30 dark:bg-emerald-950/20',
        isInsufficient && 'border-amber-400/40 bg-amber-50/30 dark:bg-amber-950/20',
        isForced && 'border-red-400/40 bg-red-50/30 dark:bg-red-950/20',
        isShortQuery && 'border-blue-400/40 bg-blue-50/30 dark:bg-blue-950/20',
      )}
    >
      {/* 轮次标题 */}
      <div className="flex items-center gap-1 font-medium text-foreground">
        <span className="text-muted-foreground">Round {step.round + 1}</span>
        {isSufficient && <CheckCircleIcon className="h-3 w-3 text-emerald-500" />}
        {isInsufficient && <XCircleIcon className="h-3 w-3 text-amber-500" />}
        {isForced && <XCircleIcon className="h-3 w-3 text-red-400" />}
        <span className={cn(
          'ml-1 text-[11px]',
          isSufficient && 'text-emerald-600 dark:text-emerald-400',
          isInsufficient && 'text-amber-600 dark:text-amber-400',
          isForced && 'text-red-500 dark:text-red-400',
          isShortQuery && 'text-blue-500 dark:text-blue-400',
        )}>
          {isSufficient ? '充分' : isInsufficient ? '不充分' : isShortQuery ? '短查询' : '强制结束'}
        </span>
      </div>

      {/* 查询 */}
      <div className="mt-1 flex items-start gap-1 text-muted-foreground">
        <SearchIcon className="h-2.5 w-2.5 shrink-0 mt-0.5 text-blue-400" />
        <span className="whitespace-pre-wrap break-words">
          查询: <span className="text-foreground">{step.query}</span>
        </span>
      </div>

      {/* 思考 */}
      {step.thinking && (
        <div className="mt-0.5 flex items-start gap-1 text-muted-foreground">
          <BrainCircuitIcon className="h-2.5 w-2.5 shrink-0 mt-0.5 text-violet-400" />
          <span className="whitespace-pre-wrap break-words">{step.thinking}</span>
        </div>
      )}

      {/* 联网搜索 */}
      {step.webSearchQuery && (
        <div className="mt-0.5 flex items-start gap-1 text-blue-500 dark:text-blue-400">
          <GlobeIcon className="h-2.5 w-2.5 shrink-0 mt-0.5" />
          <span className="whitespace-pre-wrap break-words font-medium">
            搜索: {step.webSearchQuery}
          </span>
        </div>
      )}
      {step.webSearchResults && step.webSearchResults.length > 0 && (
        <div className="mt-0.5 space-y-0.5">
          {step.webSearchResults.slice(0, 3).map((r, i) => (
            <div key={i} className="text-muted-foreground/70 truncate">
              {r.title}: {r.snippet.slice(0, 80)}{r.snippet.length > 80 ? '...' : ''}
            </div>
          ))}
        </div>
      )}

      {/* 改写查询 */}
      {step.rewrittenQuery && (
        <div className="mt-0.5 flex items-start gap-1 text-amber-600 dark:text-amber-400">
          <PencilIcon className="h-2.5 w-2.5 shrink-0 mt-0.5" />
          <span className="whitespace-pre-wrap break-words font-medium">
            改写: {step.rewrittenQuery}
          </span>
        </div>
      )}

      {/* 上下文摘要 */}
      {step.contextSummary && (
        <div className="mt-0.5 text-muted-foreground/70 truncate">
          {step.contextSummary.slice(0, 120)}{step.contextSummary.length > 120 ? '...' : ''}
        </div>
      )}
    </div>
  )
}
