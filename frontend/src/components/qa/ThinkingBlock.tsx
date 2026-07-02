import { useState } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * 推理模型思维链折叠区块。
 *
 * 把 parseThinking 剥离出的思考内容渲染为可折叠面板：
 * - 流式进行中（think 块未闭合）默认展开，标注"思考中…"，便于观察进展；
 * - 闭合后标注"思考过程"，用户可手动收起。
 * 思考内容按纯文本展示（whitespace-pre-wrap），不再走 markdown 渲染。
 */
interface Props {
  thinking: string
  /** think 块是否仍在流式输出（未闭合） */
  streaming: boolean
}

export default function ThinkingBlock({ thinking, streaming }: Props) {
  const [open, setOpen] = useState(true)
  return (
    <div className="my-2 overflow-hidden rounded-md border border-border/50 bg-muted/30 text-xs">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-muted-foreground hover:bg-muted/60"
      >
        <ChevronRightIcon className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')} />
        <span>{streaming ? '思考中…' : '思考过程'}</span>
        {streaming && <span className="ml-auto inline-block animate-pulse">▌</span>}
      </button>
      {open && (
        <div className="max-h-72 overflow-auto whitespace-pre-wrap break-words border-t border-border/40 px-2.5 py-2 leading-relaxed text-muted-foreground/90">
          {thinking}
        </div>
      )}
    </div>
  )
}
