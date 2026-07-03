import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ChatMessage, QueryMode } from '@/api/types'

/**
 * 知识问答 store：消息列表 + Query Mode + 会话 ID，persist 到 localStorage。
 * 对齐项目 stores/settings.ts 模式 + LightRAG webui retrievalHistory 持久化。
 *
 * 多轮上下文遵循 LightRAG 默认 history_turns=0，每次查询独立不带历史；
 * messages 仅作 UI 展示，不回传 conversation_history。
 * sessionId 用于 ask_user 暂停恢复（后端从 DB 加载暂停态 context）。
 */
interface QAState {
  messages: ChatMessage[]
  queryMode: QueryMode
  sessionId: string | null             // 当前 chat 会话（ask_user 恢复用）
  setQueryMode: (mode: QueryMode) => void
  setSessionId: (id: string | null) => void
  addMessage: (message: ChatMessage) => void
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void
  clearMessages: () => void
}

export const useQAStore = create<QAState>()(
  persist(
    (set) => ({
      messages: [],
      queryMode: 'mix',
      sessionId: null,
      setQueryMode: (queryMode) => set({ queryMode }),
      setSessionId: (sessionId) => set({ sessionId }),
      addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
      updateMessage: (id, patch) =>
        set((state) => ({
          messages: state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m))
        })),
      clearMessages: () => set({ messages: [], sessionId: null })
    }),
    {
      name: 'aitutor-qa',
      storage: createJSONStorage(() => localStorage),
      version: 2,
      partialize: (state) => ({ messages: state.messages, queryMode: state.queryMode, sessionId: state.sessionId })
    }
  )
)
