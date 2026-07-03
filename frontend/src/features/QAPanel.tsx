import { useState, useRef, useEffect, useCallback } from 'react'
import { ArrowUpIcon, SquareIcon, EraserIcon, GraduationCapIcon, GlobeIcon } from 'lucide-react'
import { useQAStore } from '@/stores/qa'
import { queryStream } from '@/api/aitutor'
import { QUERY_MODE_OPTIONS } from '@/api/types'
import type { QueryMode, StreamEvent } from '@/api/types'
import ChatMessage from '@/components/qa/ChatMessage'
import { cn } from '@/lib/utils'

/**
 * 知识问答面板（仿 DeepTutor 聊天主页风格）：
 * - 暖白 Cream 底；空状态用衬线大标题 + flexGrow spacer 把 composer 推到视觉中部偏下。
 * - Composer 为 rounded-[26px] 悬浮卡片 + 双层柔和阴影；空状态 max-w-720，有消息 max-w-960，
 *   650ms 宽度过渡。发送按钮 32px rounded-[10px] emerald 填充 + ArrowUp 粗笔触。
 * - Query Mode 选择器、联网搜索勾选、清空按钮收进 Composer 底部工具栏（无分隔线）。
 * - 思维链渲染改用 AssistantActivity + TraceFlow（对齐 DeepTutor 门控机制）
 */
export default function QAPanel() {
  const messages = useQAStore((s) => s.messages)
  const queryMode = useQAStore((s) => s.queryMode)
  const setQueryMode = useQAStore((s) => s.setQueryMode)
  const addMessage = useQAStore((s) => s.addMessage)
  const updateMessage = useQAStore((s) => s.updateMessage)
  const clearMessages = useQAStore((s) => s.clearMessages)

  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [forceWebSearch, setForceWebSearch] = useState(false)
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
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
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
      isStreaming: true,
      traceEvents: [] as StreamEvent[],
    }
    addMessage(userMsg)
    addMessage(assistantMsg)
    setIsStreaming(true)
    const controller = new AbortController()
    abortRef.current = controller
    let acc = ''
    // 直接收集 StreamEvent[]，不再手动拼装 LoopStep
    const events: StreamEvent[] = []
    try {
      await queryStream({ query, mode: queryMode, force_web_search: forceWebSearch }, {
        onChunk: (chunk) => {
          acc += chunk
          updateMessage(assistantId, { content: acc })
        },
        onReferences: (refs) => updateMessage(assistantId, { references: refs }),
        onError: (msg) => updateMessage(assistantId, { content: msg, isError: true }),
        onLoopEvent: (event) => {
          // 为事件补充时间戳（后端不提供时由前端补充，供计时器使用）
          const enriched: StreamEvent = {
            ...event,
            timestamp: Date.now() / 1000,
          }
          events.push(enriched)
          // 实时更新消息的 traceEvents（流式渐进）
          updateMessage(assistantId, { traceEvents: [...events] })
        },
        signal: controller.signal
      })
    } catch {
      /* 已在 queryStream 内通过 onError 上报 */
    } finally {
      updateMessage(assistantId, { isStreaming: false })
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [input, isStreaming, queryMode, forceWebSearch, addMessage, updateMessage])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* 消息区 / 空状态问候语 —— 占满主区 */}
      {hasMessages ? (
        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <div className="mx-auto w-full max-w-[960px] space-y-9 px-6 py-6">
          {messages.map((m) => (
            <ChatMessage key={m.id} message={m} />
          ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {/* flexGrow spacer 把问候语推到中部偏下（接近黄金分割），对齐 DeepTutor */}
          <div className="flex flex-1 flex-col items-center justify-center animate-fade-in">
            <div className="flex flex-col items-center gap-3 text-center">
              <GraduationCapIcon className="h-10 w-10 text-emerald-500" />
              <h1 className="font-serif text-[36px] font-medium leading-tight tracking-tight text-foreground">
                知识问答
              </h1>
              <p className="max-w-md text-sm text-muted-foreground">
                基于已上传文档进行 RAG 检索，回答支持 Markdown 渲染与思维链折叠
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Composer —— 始终底部，空状态 720px / 有消息 960px，宽度过渡 */}
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
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="输入你的问题…（Enter 发送，Shift+Enter 换行）"
            rows={1}
            className="max-h-[200px] min-h-[44px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[16px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/50"
          />
          {/* 底部工具栏：无分隔线，按钮安静平铺 */}
          <div className="flex items-center gap-1 px-3 pb-2 pt-0.5">
            {/* 左：Query Mode 选择器 */}
            <div className="relative flex items-center">
              <select
                aria-label="查询模式"
                value={queryMode}
                onChange={(e) => setQueryMode(e.target.value as QueryMode)}
                disabled={isStreaming}
                className={cn(
                  'h-8 cursor-pointer appearance-none rounded-lg bg-transparent pl-2 pr-7 text-sm font-medium text-foreground outline-none transition-colors hover:bg-muted/60 focus:bg-muted/60 disabled:opacity-50'
                )}
                title="查询模式"
              >
                {QUERY_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <svg
                className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>

            {/* 联网搜索勾选 */}
            <label className="flex items-center gap-1.5 cursor-pointer select-none text-sm text-muted-foreground hover:text-foreground transition-colors">
              <input
                type="checkbox"
                checked={forceWebSearch}
                onChange={(e) => setForceWebSearch(e.target.checked)}
                disabled={isStreaming}
                className="h-3.5 w-3.5 rounded border-border accent-emerald-500"
              />
              <GlobeIcon className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">联网搜索</span>
            </label>

            {/* 右：清空 + 发送/停止 */}
            <div className="ml-auto flex items-center gap-1.5">
              {hasMessages && (
                <button
                  type="button"
                  onClick={clearMessages}
                  disabled={isStreaming}
                  aria-label="清空对话"
                  title="清空对话"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
                >
                  <EraserIcon className="h-4 w-4" />
                </button>
              )}
              {isStreaming ? (
                <button
                  type="button"
                  onClick={handleStop}
                  aria-label="停止生成"
                  title="停止生成"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-emerald-500 text-white transition-transform hover:bg-emerald-600 active:scale-95"
                >
                  <SquareIcon className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!input.trim()}
                  aria-label="发送"
                  title="发送"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-[10px] bg-emerald-500 text-white transition-transform hover:bg-emerald-600 active:scale-95 disabled:opacity-25 disabled:hover:bg-emerald-500"
                >
                  <ArrowUpIcon className="h-4 w-4" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
