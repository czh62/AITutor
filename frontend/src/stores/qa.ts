import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ChatMessage, QueryMode } from '@/api/types'

/**
 * 知识问答 store：消息列表 + Query Mode，persist 到 localStorage。
 * 对齐项目 stores/settings.ts 模式 + LightRAG webui retrievalHistory 持久化。
 *
 * 多轮上下文遵循 LightRAG 默认 history_turns=0，每次查询独立不带历史；
 * messages 仅作 UI 展示，不回传 conversation_history。
 */
interface QAState {
  messages: ChatMessage[]
  queryMode: QueryMode
  setQueryMode: (mode: QueryMode) => void
  addMessage: (message: ChatMessage) => void
  updateMessage: (id: string, patch: Partial<ChatMessage>) => void
  clearMessages: () => void
}

export const useQAStore = create<QAState>()(
  persist(
    (set) => ({
      messages: [],
      queryMode: 'mix',
      setQueryMode: (queryMode) => set({ queryMode }),
      addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
      updateMessage: (id, patch) =>
        set((state) => ({
          messages: state.messages.map((m) => (m.id === id ? { ...m, ...patch } : m))
        })),
      clearMessages: () => set({ messages: [] })
    }),
    {
      name: 'aitutor-qa',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({ messages: state.messages, queryMode: state.queryMode })
    }
  )
)
