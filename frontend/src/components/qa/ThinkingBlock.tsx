import { useState, useEffect, useRef } from 'react'
import { ChevronRightIcon, Loader2, BrainCircuit } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 推理模型思维链折叠区块（对齐 DeepTutor ModelThinkingCard 交互模式）。
 *
 * 把 parseThinking 剥离出的思考内容渲染为可折叠面板：
 * - 流式进行中（think 块未闭合）默认展开 + spinner，标注"思考中…"，便于观察进展；
 * - 闭合后标注"思考过程"，自动折叠，用户可手动 pin 展开/折叠；
 * - 用户手动 toggle 后，pin 选择覆盖自动行为；
 * - 思考内容按纯文本展示（whitespace-pre-wrap），不再走 markdown 渲染。
 *
 * 交互对齐 DeepTutor ModelThinkingCard：
 * - 用 useState<boolean | null> 管理 userToggled（null = 自动跟随）
 * - 用 details/summary 元素获得原生折叠语义
 * - 用 useEffect 同步 details.open 属性
 */
interface Props {
  thinking: string
  /** think 块是否仍在流式输出（未闭合） */
  streaming: boolean
}

export default function ThinkingBlock({ thinking, streaming }: Props) {
  // null = 自动跟随（流式时展开，闭合后折叠）；boolean = 用户手动 pin
  const [userToggled, setUserToggled] = useState<boolean | null>(null)
  const open = userToggled !== null ? userToggled : !streaming ? false : true
  const detailsRef = useRef<HTMLDetailsElement>(null)

  // 同步 details.open 属性
  useEffect(() => {
    const el = detailsRef.current
    if (el && el.open !== open) {
      el.open = open
    }
  }, [open])

  const handleToggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const next = event.currentTarget.open
    if (next !== open) {
      setUserToggled(next)
    }
  }

  const hasBody = thinking.trim().length > 0

  return (
    <details
      ref={detailsRef}
      onToggle={handleToggle}
      className="group/think my-2 overflow-hidden rounded-md border border-border/50 bg-muted/30 text-xs"
    >
      <summary
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-muted-foreground hover:bg-muted/60 [&::-webkit-details-marker]:hidden"
      >
        <ChevronRightIcon className={cn('h-3 w-3 shrink-0 transition-transform group-open/think:rotate-90')} />
        <BrainCircuit className="h-3 w-3 shrink-0 opacity-80" />
        <span>{streaming ? '思考中…' : '思考过程'}</span>
        {streaming && (
          <Loader2 className="ml-1 h-3 w-3 animate-spin text-muted-foreground/70" />
        )}
      </summary>
      <div className="border-t border-border/40 px-2.5 py-2">
        {hasBody ? (
          <div className="max-h-72 overflow-auto whitespace-pre-wrap break-words leading-relaxed text-muted-foreground/90">
            {thinking}
          </div>
        ) : (
          <div className="italic text-muted-foreground/70">
            {streaming ? '思考中...' : ''}
          </div>
        )}
      </div>
    </details>
  )
}
