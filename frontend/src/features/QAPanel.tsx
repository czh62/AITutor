import { useState, useRef, useEffect, useCallback } from 'react'
import { ArrowUp, Square, Eraser, ChevronDown, GraduationCap } from 'lucide-react'
import { useQAStore } from '@/stores/qa'
import { queryStream } from '@/api/aitutor'
import { QUERY_MODE_OPTIONS } from '@/api/types'
import type { QueryMode } from '@/api/types'
import ChatMessage from '@/components/qa/ChatMessage'

/** 知识问答面板（DeepTutor 风格聊天区）：居中限宽 header + 消息列表 + 大圆角 composer 卡片。
 *  逻辑与数据流不变：textarea → handleSend → addMessage(user+placeholder) → queryStream(NDJSON)
 *  → onChunk 累加 updateMessage → ChatMessage(parseThinking + react-markdown + references)。 */
export default function QAPanel() {
  const messages = useQAStore((s) => s.messages)
  const queryMode = useQAStore((s) => s.queryMode)
  const setQueryMode = useQAStore((s) => s.setQueryMode)
  const addMessage = useQAStore((s) => s.addMessage)
  const updateMessage = useQAStore((s) => s.updateMessage)
  const clearMessages = useQAStore((s) => s.clearMessages)

  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const hasMessages = messages.length > 0

  // 新消息/流式更新时自动滚到底
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // textarea 自适应高度
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'
  }, [input])

  const handleSend = useCallback(async () => {
    const query = input.trim()
    if (!query || isStreaming) return
    setInput('')
    const userMsg = { id: genId(), role: 'user' as const, content: query }
    const assistantId = genId()
    const assistantMsg = {
      id: assistantId,
      role: 'assistant' as const,
      content: '',
      isStreaming: true
    }
    addMessage(userMsg)
    addMessage(assistantMsg)
    setIsStreaming(true)
    const controller = new AbortController()
    abortRef.current = controller
    let acc = ''
    try {
      await queryStream({ query, mode: queryMode }, {
        onChunk: (chunk) => {
          acc += chunk
          updateMessage(assistantId, { content: acc })
        },
        onReferences: (refs) => updateMessage(assistantId, { references: refs }),
        onError: (msg) => updateMessage(assistantId, { content: msg, isError: true }),
        signal: controller.signal
      })
    } catch {
      /* 已在 queryStream 内通过 onError 上报 */
    } finally {
      updateMessage(assistantId, { isStreaming: false })
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [input, isStreaming, queryMode, addMessage, updateMessage])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }, [])

  const canClear = !isStreaming && messages.length > 0

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--background)]">
      {/* 内联 header：serif 标题 + 清空 */}
      <div className="mx-auto flex w-full max-w-[960px] items-center justify-between px-6 pb-0 pt-3">
        <span className="font-serif text-[17px] font-semibold tracking-[-0.01em] text-[var(--foreground)]">
          知识问答
        </span>
        <button
          type="button"
          onClick={clearMessages}
          disabled={!canClear}
          title="清空对话"
          aria-label="清空对话"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--muted-foreground)] transition-[background-color,color] duration-150 hover:bg-[var(--muted)]/55 hover:text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[var(--muted-foreground)]"
        >
          <Eraser size={16} strokeWidth={1.7} />
        </button>
      </div>

      {/* 主内容（居中限宽） */}
      <div className="mx-auto flex w-full max-w-[960px] min-h-0 flex-1 flex-col overflow-hidden px-6">
        {!hasMessages ? (
          /* 空态：靠下居中，logo + serif 大字 greeting */
          <div className="flex min-h-0 flex-1 animate-fade-in flex-col items-center justify-end pb-14">
            <div className="flex items-center justify-center gap-4">
              <GraduationCap className="h-10 w-10 shrink-0 text-[var(--primary)]" />
              <h1 className="font-serif text-[36px] font-medium leading-[1.1] tracking-[-0.015em] text-[var(--foreground)]">
                你想了解什么？
              </h1>
            </div>
            <p className="mt-3 text-sm text-[var(--muted-foreground)]">
              基于已上传文档进行 RAG 检索，回答支持 Markdown 渲染
            </p>
          </div>
        ) : (
          /* 消息列表：底部 mask 渐隐，data-chat-scroll-root 关闭 overflow-anchor */
          <div
            ref={scrollRef}
            data-chat-scroll-root="true"
            className="mx-auto w-full min-h-0 flex-1 space-y-9 overflow-y-auto pr-4 pt-6"
            style={{
              paddingBottom: '48px',
              WebkitMaskImage:
                'linear-gradient(to bottom, transparent 0px, #000 32px, #000 calc(100% - 40px), transparent 100%)',
              maskImage:
                'linear-gradient(to bottom, transparent 0px, #000 32px, #000 calc(100% - 40px), transparent 100%)'
            }}
          >
            {messages.map((m) => (
              <ChatMessage key={m.id} message={m} />
            ))}
          </div>
        )}

        {/* composer：大圆角卡片，宽度随有消息 720↔960 过渡 */}
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSend()
          }}
          className={`relative z-20 mx-auto w-full shrink-0 pb-5 ${hasMessages ? 'max-w-[960px] pt-1' : 'max-w-[720px]'}`}
          style={{ transition: 'max-width 650ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          {hasMessages && (
            <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-transparent to-[var(--background)]/72" />
          )}
          <div className="relative rounded-[26px] border border-[var(--border)]/55 bg-[var(--card)] shadow-[0_1px_2px_rgba(0,0,0,0.025),0_10px_28px_-10px_rgba(0,0,0,0.08)] transition-colors">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="输入你的问题…（Enter 发送，Shift+Enter 换行）"
              rows={1}
              className="w-full resize-none overflow-hidden bg-transparent px-4 pb-2 pt-3.5 text-[16px] leading-relaxed text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
            />
            {/* 底部工具行：左 QueryMode 下拉，右 发送/停止 */}
            <div className="flex items-center gap-1 px-3 pb-2 pt-0.5">
              <div className="relative">
                <select
                  value={queryMode}
                  onChange={(e) => setQueryMode(e.target.value as QueryMode)}
                  disabled={isStreaming}
                  aria-label="查询模式"
                  className="h-8 appearance-none rounded-[10px] border border-[var(--border)]/55 bg-transparent pl-2.5 pr-7 text-[13px] text-[var(--foreground)] outline-none transition-colors hover:bg-[var(--muted)]/40 disabled:opacity-50"
                >
                  {QUERY_MODE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <ChevronDown
                  size={13}
                  strokeWidth={1.7}
                  className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
                />
              </div>
              {isStreaming ? (
                <button
                  type="button"
                  onClick={handleStop}
                  aria-label="停止生成"
                  title="停止生成"
                  className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--primary)] text-[var(--primary-foreground)] transition-[background-color,transform] duration-150 hover:bg-[var(--primary)]/90 active:scale-95"
                >
                  <Square size={14} className="fill-current" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim()}
                  aria-label="发送"
                  title="发送"
                  className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-[var(--primary)] text-[var(--primary-foreground)] transition-[background-color,transform] duration-150 hover:bg-[var(--primary)]/90 active:scale-95 disabled:opacity-25"
                >
                  <ArrowUp size={16} strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </form>

        {/* 弹性占位：空态把 composer 推到偏下，有消息时收紧 */}
        <div
          aria-hidden="true"
          className="shrink-0"
          style={{
            flexGrow: hasMessages ? 0 : 1.4,
            transition: 'flex-grow 650ms cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        />
      </div>
    </div>
  )
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
