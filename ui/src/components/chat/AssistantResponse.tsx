import { Fragment, memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import ModelThinkingCard from './ModelThinkingCard'
import { parseModelThinkingSegments } from '@/lib/thinkSegments'
import { cn } from '@/lib/utils'

interface AssistantResponseProps {
  content: string
  isStreaming?: boolean
  className?: string
}

function AssistantResponseImpl({
  content,
  isStreaming = false,
  className
}: AssistantResponseProps) {
  const segments = useMemo(() => parseModelThinkingSegments(content), [content])
  const hasRenderableSegment = segments.some((segment) => segment.content.trim().length > 0)

  if (!hasRenderableSegment && !isStreaming) return null

  return (
    <div
      role="article"
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        'break-words text-[15px] leading-[1.75] text-foreground',
        '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        '[&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5',
        '[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
        '[&_h1]:mb-1 [&_h1]:mt-2 [&_h1]:text-base [&_h1]:font-bold',
        '[&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:font-bold [&_h3]:my-1 [&_h3]:font-semibold',
        '[&_a]:text-emerald-600 [&_a]:underline dark:[&_a]:text-emerald-400',
        '[&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-2 [&_blockquote]:italic [&_blockquote]:text-muted-foreground',
        '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-zinc-900 [&_pre]:p-3 [&_pre]:text-xs [&_pre]:text-zinc-100',
        '[&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs dark:[&_code]:bg-white/10',
        '[&_pre_code]:m-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-emerald-300',
        '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs',
        '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1',
        className
      )}
    >
      {segments.map((segment, index) => {
        if (segment.kind === 'think') {
          return (
            <ModelThinkingCard
              key={`think-${index}`}
              content={segment.content}
              closed={segment.closed}
            />
          )
        }

        if (!segment.content.trim()) return <Fragment key={`text-${index}`} />

        return (
          <ReactMarkdown
            key={`text-${index}`}
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
          >
            {segment.content}
          </ReactMarkdown>
        )
      })}
      {isStreaming && <span className="ml-0.5 inline-block animate-pulse">▌</span>}
    </div>
  )
}

const AssistantResponse = memo(AssistantResponseImpl)
AssistantResponse.displayName = 'AssistantResponse'

export default AssistantResponse
