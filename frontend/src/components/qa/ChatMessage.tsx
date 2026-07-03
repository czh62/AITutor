import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import type { ChatMessage as ChatMessageType, StreamEvent } from '@/api/types'
import ThinkingBlock from '@/components/qa/ThinkingBlock'
import { AssistantActivity, loopTraceToEvents } from '@/components/qa/TracePanels'
import { parseThinking } from '@/lib/parseThinking'

/**
 * 单条对话（仿 DeepTutor 风格）：
 * - user：右对齐，max-w-75%，rounded-2xl bg-secondary 暖色气泡，纯文本（whitespace-pre-wrap）。
 * - assistant：**无气泡**，全宽左对齐直接渲染 markdown（15px / 行高 1.75），长回答阅读更佳；
 *   渲染管线：AssistantActivity 状态行 → TraceFlow 内联 trace → ThinkingBlock → markdown body → references
 *   优先使用 traceEvents（新版 StreamEvent[] 门控格式），有 loopTrace 但无 traceEvents 时向后兼容转换。
 * - error：保留淡红气泡以突出错误态（区别于正常 assistant 的无气泡）。
 */
export default function ChatMessage({ message }: { message: ChatMessageType }) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex w-full justify-end">
        <div className="max-w-[75%] whitespace-pre-wrap break-words rounded-2xl bg-secondary px-4 py-2.5 text-sm leading-relaxed text-foreground shadow-sm">
          {message.content}
        </div>
      </div>
    )
  }

  const parsed = parseThinking(message.content)

  // 确定要渲染的 trace events：
  // 优先使用 traceEvents，无则从 loopTrace 向后兼容转换
  const traceEvents: StreamEvent[] | undefined = message.traceEvents
  const fallbackEvents: StreamEvent[] | undefined = message.loopTrace
    ? loopTraceToEvents(message.loopTrace)
    : undefined
  const events = traceEvents ?? fallbackEvents

  return (
    <div className="flex w-full justify-start">
      <div
        className={cn(
          'w-full break-words text-[15px] leading-[1.75] text-foreground',
          message.isError
            ? 'whitespace-pre-wrap rounded-lg bg-red-50 px-3 py-2 text-red-600 dark:bg-red-950 dark:text-red-400'
            : cn(
                '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
                '[&_p]:my-1.5',
                '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5',
                '[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5',
                '[&_li]:my-0.5',
                '[&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-base [&_h1]:font-bold',
                '[&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:font-bold',
                '[&_h3]:my-1 [&_h3]:font-semibold',
                '[&_strong]:font-semibold',
                '[&_a]:underline [&_a]:text-emerald-600 dark:[&_a]:text-emerald-400',
                '[&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-black/20 [&_blockquote]:pl-2 [&_blockquote]:italic [&_blockquote]:text-muted-foreground',
                '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-zinc-900 [&_pre]:p-2.5 [&_pre]:text-xs [&_pre]:text-zinc-100',
                '[&_code]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs dark:[&_code]:bg-white/10',
                '[&_pre_code]:m-0 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-emerald-300',
                '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs',
                '[&_th]:border [&_th]:border-black/20 [&_th]:px-2 [&_th]:py-1 [&_th]:bg-black/5 [&_th]:font-semibold dark:[&_th]:border-white/20 dark:[&_th]:bg-white/5',
                '[&_td]:border [&_td]:border-black/20 [&_td]:px-2 [&_td]:py-1 dark:[&_td]:border-white/20'
              )
        )}
      >
        {/* 1. AssistantActivity 状态行 + trace 折叠/展开 */}
        {events && events.length > 0 && (
          <AssistantActivity
            events={events}
            isStreaming={message.isStreaming}
            content={message.content}
          />
        )}

        {/* 2. ThinkingBlock（推理模型的 <think> 标签内容） */}
        {parsed?.thinking && (
          <ThinkingBlock thinking={parsed.thinking} streaming={!parsed.thinkingClosed} />
        )}

        {/* 3. Markdown body（回答气泡内容） */}
        {message.isError ? (
          <div>{message.content}</div>
        ) : parsed?.body ? (
          <>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{parsed.body}</ReactMarkdown>
            {message.isStreaming && (
              <span className="ml-0.5 inline-block animate-pulse">▌</span>
            )}
          </>
        ) : null}

        {/* 4. References footer */}
        {message.references && message.references.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>引用：</span>
            {message.references.map((r, i) => {
              const isWebRef = r.reference_id?.startsWith('web_')
              return (
                <span
                  key={i}
                  className={cn(
                    'rounded-full px-2 py-0.5',
                    isWebRef ? 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400' : 'bg-muted',
                  )}
                  title={r.file_path}
                >
                  {isWebRef ? '🌐' : '📎'}
                  {isWebRef ? (
                    <a href={r.file_path} target="_blank" rel="noopener noreferrer" className="underline hover:text-blue-800 dark:hover:text-blue-300">
                      {r.file_path ?? `#${i + 1}`}
                    </a>
                  ) : (
                    r.file_path ?? r.reference_id ?? `#${i + 1}`
                  )}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
