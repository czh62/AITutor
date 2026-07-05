import { useEffect, useRef } from 'react'
import {
  ArrowUpIcon,
  BrainIcon,
  EraserIcon,
  GlobeIcon,
  SlidersHorizontalIcon,
  SquareIcon
} from 'lucide-react'
import type { QueryMode } from '@/api/types'
import { QUERY_MODE_OPTIONS } from '@/api/types'
import { cn } from '@/lib/utils'

interface ChatComposerProps {
  input: string
  onInputChange: (value: string) => void
  queryMode: QueryMode
  onQueryModeChange: (mode: QueryMode) => void
  forceWebSearch: boolean
  onForceWebSearchChange: (value: boolean) => void
  hasMessages: boolean
  isStreaming: boolean
  onSend: () => void
  onStop: () => void
  onClear: () => void
  onOpenQuiz: () => void
}

export default function ChatComposer({
  input,
  onInputChange,
  queryMode,
  onQueryModeChange,
  forceWebSearch,
  onForceWebSearchChange,
  hasMessages,
  isStreaming,
  onSend,
  onStop,
  onClear,
  onOpenQuiz
}: ChatComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
  }, [input])

  return (
    <div
      className="mx-auto w-full shrink-0 px-6 pb-5"
      style={{
        maxWidth: hasMessages ? '960px' : '720px',
        transition: 'max-width 650ms cubic-bezier(0.16, 1, 0.3, 1)'
      }}
    >
      <div className="relative rounded-[26px] border border-border/55 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.025),0_10px_28px_-10px_rgba(0,0,0,0.08)] transition-colors focus-within:border-emerald-500/50">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onSend()
            }
          }}
          placeholder="Ask a question... (Enter to send, Shift+Enter for a new line)"
          rows={1}
          className="max-h-[200px] min-h-[44px] w-full resize-none bg-transparent px-4 pb-2 pt-3.5 text-[16px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
        />

        <div className="flex items-center gap-1 px-3 pb-2 pt-0.5">
          <div className="relative flex items-center">
            <SlidersHorizontalIcon className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
            <select
              aria-label="Query mode"
              value={queryMode}
              onChange={(event) => onQueryModeChange(event.target.value as QueryMode)}
              disabled={isStreaming}
              className="h-8 cursor-pointer appearance-none rounded-lg bg-transparent pl-7 pr-7 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted/60 focus:bg-muted/60 disabled:opacity-50"
            >
              {QUERY_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <label className="flex cursor-pointer select-none items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
            <input
              type="checkbox"
              checked={forceWebSearch}
              onChange={(event) => onForceWebSearchChange(event.target.checked)}
              disabled={isStreaming}
              className="h-3.5 w-3.5 rounded border-border accent-emerald-500"
            />
            <GlobeIcon className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Web Search</span>
          </label>

          <button
            type="button"
            onClick={onOpenQuiz}
            disabled={isStreaming}
            className="flex cursor-pointer select-none items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            <BrainIcon className="h-3.5 w-3.5" />
            <span className="text-xs font-medium">Quiz</span>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            {hasMessages && (
              <button
                type="button"
                onClick={onClear}
                disabled={isStreaming}
                aria-label="Clear conversation"
                title="Clear conversation"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
              >
                <EraserIcon className="h-4 w-4" />
              </button>
            )}
            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                aria-label="Stop generation"
                title="Stop generation"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-emerald-500 text-white transition-transform hover:bg-emerald-600 active:scale-95"
              >
                <SquareIcon className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onSend}
                disabled={!input.trim()}
                aria-label="Send"
                title="Send"
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-emerald-500 text-white transition-transform hover:bg-emerald-600 active:scale-95',
                  !input.trim() && 'opacity-25 hover:bg-emerald-500'
                )}
              >
                <ArrowUpIcon className="h-4 w-4" strokeWidth={2.5} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
