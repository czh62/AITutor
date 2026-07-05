import { useEffect, useRef, useState } from 'react'
import { BrainCircuitIcon, ChevronDownIcon, Loader2Icon } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

interface ModelThinkingCardProps {
  content: string
  closed: boolean
}

export default function ModelThinkingCard({ content, closed }: ModelThinkingCardProps) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null)
  const detailsRef = useRef<HTMLDetailsElement>(null)
  const open = userToggled !== null ? userToggled : !closed

  useEffect(() => {
    const el = detailsRef.current
    if (el && el.open !== open) el.open = open
  }, [open])

  return (
    <details
      ref={detailsRef}
      onToggle={(event) => {
        const next = event.currentTarget.open
        if (next !== open) setUserToggled(next)
      }}
      className="group/think my-3 overflow-hidden rounded-xl border border-border/60 bg-card/50 transition-colors hover:border-border"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronDownIcon className="h-3 w-3 shrink-0 opacity-70 transition-transform group-open/think:rotate-180" />
        <BrainCircuitIcon className="h-3 w-3 shrink-0 opacity-80" />
        <span>Model Thinking</span>
        {!closed && <Loader2Icon className="ml-1 h-3 w-3 animate-spin opacity-70" />}
      </summary>
      <div className="border-t border-border/40 bg-background/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
        {content.trim() ? (
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {content}
          </ReactMarkdown>
        ) : (
          <div className="italic text-muted-foreground/70">Thinking...</div>
        )}
      </div>
    </details>
  )
}
