import { useState, useRef, useEffect, useCallback } from 'react'
import { SendIcon, SquareIcon, EraserIcon } from 'lucide-react'
import Button from '@/components/ui/Button'
import { useQAStore } from '@/stores/qa'
import { queryStream } from '@/api/aitutor'
import { QUERY_MODE_OPTIONS } from '@/api/types'
import type { QueryMode } from '@/api/types'
import ChatMessage from '@/components/qa/ChatMessage'

/** 右侧 2/3 的知识问答面板：类 LLM 对话框。参数固定默认，仅 Query Mode 可调。 */
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* 顶栏：标题 + Query Mode 下拉 + 清空 */}
      <div className="flex flex-none items-center justify-between border-b border-border/40 px-4 py-2">
        <span className="text-sm font-semibold">知识问答</span>
        <div className="flex items-center gap-2">
          <label htmlFor="qa-mode-select" className="text-xs text-muted-foreground">模式</label>
          <select
            id="qa-mode-select"
            value={queryMode}
            onChange={(e) => setQueryMode(e.target.value as QueryMode)}
            disabled={isStreaming}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          >
            {QUERY_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearMessages}
            disabled={isStreaming || messages.length === 0}
            tooltip="清空对话"
          >
            <EraserIcon className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 消息列表 */}
      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center text-muted-foreground">
            <div>
              <p className="text-base">输入问题开始知识问答</p>
              <p className="mt-1 text-xs">基于已上传文档进行 RAG 检索，回答支持 Markdown 渲染</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <ChatMessage key={m.id} message={m} />
            ))}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="flex-none border-t border-border/40 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleSend()
          }}
          className="flex items-end gap-2"
        >
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
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          {isStreaming ? (
            <Button type="button" variant="outline" size="sm" onClick={handleStop} tooltip="停止生成">
              <SquareIcon className="h-4 w-4" /> 停止
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={!input.trim()} tooltip="发送">
              <SendIcon className="h-4 w-4" /> 发送
            </Button>
          )}
        </form>
      </div>
    </div>
  )
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
