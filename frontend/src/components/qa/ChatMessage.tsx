import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'
import type { ChatMessage as ChatMessageType } from '@/api/types'
import ThinkingBlock from '@/components/qa/ThinkingBlock'
import { parseThinking } from '@/lib/parseThinking'

/**
 * 单条对话气泡。
 * - user：右对齐，emerald 背景，纯文本（whitespace-pre-wrap）。
 * - assistant：左对齐，muted 背景。先用 parseThinking 剥离推理模型的思维链块
 *   （think 标签包裹），交由 ThinkingBlock 折叠展示；剥离后的正文才走
 *   react-markdown + remark-gfm 渲染，避免 think 内容被原样显示为文本。
 * - error：红色背景。
 * 流式中末尾显示闪烁光标。
 */
export default function ChatMessage({ message }: { message: ChatMessageType }) {
  const isUser = message.role === 'user'
  const parsed = isUser ? null : parseThinking(message.content)
  return (
    <div className={cn('flex w-full', isUser ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'max-w-[85%] break-words rounded-lg px-3 py-2 text-sm leading-relaxed',
          isUser
            ? 'bg-emerald-500 text-white'
            : message.isError
              ? 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400'
              : 'bg-muted text-foreground'
        )}
      >
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        ) : (
          <div
            className={cn(
              // 不依赖 @tailwindcss/typography，用任意选择器给 markdown 元素打底样式
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
            )}
          >
            {parsed?.thinking && (
              <ThinkingBlock thinking={parsed.thinking} streaming={!parsed.thinkingClosed} />
            )}
            {parsed?.body ? (
              <>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{parsed.body}</ReactMarkdown>
                {message.isStreaming && (
                  <span className="ml-0.5 inline-block animate-pulse">▌</span>
                )}
              </>
            ) : null}
          </div>
        )}

        {message.references && message.references.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-black/10 pt-1.5 text-xs opacity-80 dark:border-white/10">
            <span>📎 引用：</span>
            {message.references.map((r, i) => (
              <span
                key={i}
                className="rounded bg-black/10 px-1 py-0.5 dark:bg-white/10"
                title={r.file_path}
              >
                {r.file_path ?? r.reference_id ?? `#${i + 1}`}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
