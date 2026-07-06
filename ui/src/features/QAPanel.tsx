import { useCallback, useEffect, useRef, useState } from 'react'
import { GraduationCapIcon } from 'lucide-react'
import {
  queryStream,
  quizGenerateStream,
  resumeStream
} from '@/api/aitutor'
import type {
  AskUserPayload,
  ChatMessage as ChatMessageType,
  QACommand,
  QueryMode,
  QuizDifficulty,
  QuizQuestion,
  QuizQuestionType,
  ReferenceItem,
  StreamEvent
} from '@/api/types'
import ChatComposer from '@/components/chat/ChatComposer'
import ChatMessage from '@/components/chat/ChatMessage'
import QuizConfigDialog from '@/components/chat/QuizConfigDialog'
import { isNarrationMarker } from '@/lib/streamEvents'
import { useQAStore } from '@/stores/qa'

type QuizRunConfig = Extract<QACommand, { kind: 'quiz' }>

export default function QAPanel() {
  const messages = useQAStore((state) => state.messages)
  const queryMode = useQAStore((state) => state.queryMode)
  const sessionId = useQAStore((state) => state.sessionId)
  const pendingCommands = useQAStore((state) => state.pendingCommands)
  const setQueryMode = useQAStore((state) => state.setQueryMode)
  const setSessionId = useQAStore((state) => state.setSessionId)
  const addMessage = useQAStore((state) => state.addMessage)
  const updateMessage = useQAStore((state) => state.updateMessage)
  const consumeCommand = useQAStore((state) => state.consumeCommand)
  const clearMessages = useQAStore((state) => state.clearMessages)

  const [input, setInput] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [forceWebSearch, setForceWebSearch] = useState(false)
  const [showQuizDialog, setShowQuizDialog] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasMessages = messages.length > 0

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const buildStreamCallbacks = useCallback(
    (assistantId: string) => {
      const events: StreamEvent[] = []
      const chunksByCall = new Map<string, string[]>()
      const chunkOrder: string[] = []
      const narrationCallIds = new Set<string>()

      const recomputeAnswer = () => {
        let answer = ''
        for (const callId of chunkOrder) {
          if (narrationCallIds.has(callId)) continue
          answer += (chunksByCall.get(callId) || []).join('')
        }
        updateMessage(assistantId, { content: answer })
      }

      const pushEvent = (event: StreamEvent) => {
        const enriched = { ...event, timestamp: Date.now() / 1000 }
        events.push(enriched)
        if (isNarrationMarker(enriched)) {
          const callId = String(enriched.metadata.call_id || '')
          if (callId) {
            narrationCallIds.add(callId)
            recomputeAnswer()
          }
        }
        updateMessage(assistantId, { traceEvents: [...events] })
      }

      return {
        onChunk: (chunk: string, callId?: string) => {
          const cid = callId || '_default'
          if (!chunksByCall.has(cid)) {
            chunksByCall.set(cid, [])
            chunkOrder.push(cid)
          }
          chunksByCall.get(cid)!.push(chunk)
          recomputeAnswer()
        },
        onReferences: (refs: ReferenceItem[]) =>
          updateMessage(assistantId, {
            references: refs.filter(r => r.reference_id || r.file_path)
          }),
        onError: (message: string) =>
          updateMessage(assistantId, {
            content: message,
            isError: true,
            isStreaming: false
          }),
        onLoopEvent: pushEvent,
        onWaitForInput: (payload: AskUserPayload) => {
          pushEvent({
            type: 'wait_for_input',
            round: 0,
            content: payload.context || 'More information is needed.',
            metadata: { ask_user: payload }
          })
          updateMessage(assistantId, {
            askUserPayload: payload,
            isWaitingForInput: true,
            isStreaming: false
          })
        },
        onSession: (sid: string) => setSessionId(sid),
        onSources: () => {
          // Sources are normalized into references for this UI.
        }
      }
    },
    [setSessionId, updateMessage]
  )

  const runQuery = useCallback(async (rawQuery: string) => {
    const query = rawQuery.trim()
    if (!query || isStreaming) return

    const userMsg: ChatMessageType = { id: genId(), role: 'user', content: query }
    const assistantId = genId()
    const assistantMsg: ChatMessageType = {
      id: assistantId,
      role: 'assistant',
      content: '',
      isStreaming: true,
      traceEvents: []
    }
    addMessage(userMsg)
    addMessage(assistantMsg)
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller
    const callbacks = buildStreamCallbacks(assistantId)

    try {
      await queryStream(
        { query, mode: queryMode, force_web_search: forceWebSearch },
        { ...callbacks, signal: controller.signal }
      )
    } finally {
      updateMessage(assistantId, { isStreaming: false })
      setIsStreaming(false)
      abortRef.current = null
    }
  }, [
    addMessage,
    buildStreamCallbacks,
    forceWebSearch,
    isStreaming,
    queryMode,
    updateMessage
  ])

  const handleSend = useCallback(async () => {
    const query = input.trim()
    if (!query || isStreaming) return

    setInput('')
    await runQuery(query)
  }, [input, isStreaming, runQuery])

  const handleAskUserRespond = useCallback(
    async (assistantId: string, answers: Record<string, string>) => {
      if (!sessionId) return
      updateMessage(assistantId, {
        isWaitingForInput: false,
        askUserPayload: undefined,
        isStreaming: true
      })
      setIsStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller
      const callbacks = buildStreamCallbacks(assistantId)

      try {
        await resumeStream(sessionId, answers, {
          ...callbacks,
          signal: controller.signal
        })
      } finally {
        updateMessage(assistantId, { isStreaming: false })
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [buildStreamCallbacks, sessionId, updateMessage]
  )

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    setIsStreaming(false)
  }, [])

  const runQuiz = useCallback(
    async (config: Pick<QuizRunConfig, 'topic' | 'num_questions' | 'difficulty' | 'question_types'>) => {
      if (isStreaming) return

      const assistantId = genId()
      const questions: QuizQuestion[] = []
      const events: StreamEvent[] = []

      addMessage({
        id: genId(),
        role: 'user',
        content: `Generate ${config.num_questions} questions for "${config.topic}"`
      })
      addMessage({
        id: assistantId,
        role: 'assistant',
        content: `Generating questions for "${config.topic}"...`,
        isStreaming: true,
        traceEvents: [],
        quizQuestions: []
      })
      setIsStreaming(true)

      const controller = new AbortController()
      abortRef.current = controller

      try {
        await quizGenerateStream(
          {
            topic: config.topic,
            num_questions: config.num_questions,
            difficulty: config.difficulty,
            question_types: config.question_types
          },
          {
            onProgress: (message) => updateMessage(assistantId, { content: message }),
            onQuestion: (question) => {
              questions.push(question)
              updateMessage(assistantId, { quizQuestions: [...questions] })
            },
            onResult: (resultQuestions) => {
              updateMessage(assistantId, {
                content: resultQuestions.length ? 'Quiz ready' : 'No questions generated',
                isStreaming: false,
                quizQuestions: resultQuestions
              })
            },
            onError: (message) =>
              updateMessage(assistantId, {
                content: message,
                isError: true,
                isStreaming: false
              }),
            onLoopEvent: (event) => {
              events.push({ ...event, timestamp: Date.now() / 1000 })
              updateMessage(assistantId, { traceEvents: [...events] })
            },
            signal: controller.signal
          }
        )
      } finally {
        updateMessage(assistantId, { isStreaming: false })
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [addMessage, isStreaming, updateMessage]
  )

  const handleQuizConfirm = useCallback(
    async (config: {
      topic: string
      num_questions: number
      difficulty: QuizDifficulty
      question_types: QuizQuestionType[]
    }) => {
      setShowQuizDialog(false)
      await runQuiz(config)
    },
    [runQuiz]
  )

  useEffect(() => {
    if (isStreaming || pendingCommands.length === 0) return

    const command = pendingCommands[0]
    consumeCommand(command.id)
    if (command.kind === 'query') {
      void runQuery(command.prompt)
      return
    }

    void runQuiz({
      topic: command.topic,
      num_questions: command.num_questions,
      difficulty: command.difficulty,
      question_types: command.question_types
    })
  }, [consumeCommand, isStreaming, pendingCommands, runQuery, runQuiz])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {hasMessages ? (
        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[960px] space-y-9 px-6 py-6">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                onAskUserRespond={
                  message.isWaitingForInput && message.askUserPayload
                    ? (answers) => handleAskUserRespond(message.id, answers)
                    : undefined
                }
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-1 flex-col items-center justify-center animate-fade-in">
            <div className="flex flex-col items-center gap-3 text-center">
              <GraduationCapIcon className="h-10 w-10 text-emerald-500" />
              <h1 className="font-serif text-[36px] font-medium leading-tight text-foreground">
                Knowledge Q&A
              </h1>
              <p className="max-w-md text-sm text-muted-foreground">
                Ask questions from uploaded documents, follow up, and generate quizzes with trace and source views.
              </p>
            </div>
          </div>
        </div>
      )}

      {showQuizDialog && (
        <QuizConfigDialog
          onConfirm={handleQuizConfirm}
          onCancel={() => setShowQuizDialog(false)}
          isStreaming={isStreaming}
        />
      )}

      <ChatComposer
        input={input}
        onInputChange={setInput}
        queryMode={queryMode}
        onQueryModeChange={(mode: QueryMode) => setQueryMode(mode)}
        forceWebSearch={forceWebSearch}
        onForceWebSearchChange={setForceWebSearch}
        hasMessages={hasMessages}
        isStreaming={isStreaming}
        onSend={handleSend}
        onStop={handleStop}
        onClear={clearMessages}
        onOpenQuiz={() => setShowQuizDialog(true)}
      />
    </div>
  )
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}
