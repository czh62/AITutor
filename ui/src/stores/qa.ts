import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ChatMessage, QueryMode } from '@/api/types'

interface QAState {
  messages: ChatMessage[]
  queryMode: QueryMode
  sessionId: string | null
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
          messages: state.messages.map((message) =>
            message.id === id ? { ...message, ...patch } : message
          )
        })),
      clearMessages: () => set({ messages: [], sessionId: null })
    }),
    {
      name: 'aitutor-ui-qa',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      partialize: (state) => ({
        messages: state.messages,
        queryMode: state.queryMode,
        sessionId: state.sessionId
      })
    }
  )
)
