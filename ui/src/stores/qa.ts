import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ChatMessage, QueryMode } from '@/api/types'

/**
 * 重新水合时清理残留的 isStreaming 标记。
 * 如果浏览器在 AI 判题流式传输中关闭，localStorage 会保存 isStreaming=true，
 * 重新加载后会永远显示"判题中..."状态。此函数在每次 store 初始化时
 * 将所有 isStreaming 标记重置为 false。
 */
function cleanStaleStreaming(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    const needsCleanJudgments = m.quizJudgments && Object.values(m.quizJudgments).some((j) => j.isStreaming)
    const needsCleanAnswers = m.quizAnswers && Object.values(m.quizAnswers).some((a) => !a.submitted && (a.selected || a.typed))
    if (needsCleanJudgments) {
      const cleanedJudgments = Object.fromEntries(
        Object.entries(m.quizJudgments!).map(([k, j]) => [k, { ...j, isStreaming: false }])
      )
      return { ...m, quizJudgments: cleanedJudgments as Record<number, import('@/api/types').QuizJudgmentState> }
    }
    // 清理：未提交但有内容的作答也不应该保留（可能是中途关闭）
    if (needsCleanAnswers) {
      const cleanedAnswers = Object.fromEntries(
        Object.entries(m.quizAnswers!).map(([k, a]) => [k, { ...a, submitted: false }])
      )
      return { ...m, quizAnswers: cleanedAnswers as Record<number, import('@/api/types').QuizAnswerState> }
    }
    return m
  })
}

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
      version: 2,
      partialize: (state) => ({
        messages: state.messages,
        queryMode: state.queryMode,
        sessionId: state.sessionId
      }),
      // 版本升级时清理残留的 isStreaming 标记
      migrate: (persistedState: any, version: number) => {
        if (version < 2 && persistedState.messages) {
          persistedState.messages = cleanStaleStreaming(persistedState.messages)
        }
        return persistedState as QAState
      },
    }
  )
)
