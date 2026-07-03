import { GlobeIcon, PaperclipIcon } from 'lucide-react'
import type { ChatMessage as ChatMessageType, StreamEvent } from '@/api/types'
import { cn } from '@/lib/utils'
import AssistantResponse from './AssistantResponse'
import AskUserCard from './AskUserCard'
import QuizCard from './QuizCard'
import { AssistantActivity, loopTraceToEvents } from './TracePanels'

interface ChatMessageProps {
  message: ChatMessageType
  onAskUserRespond?: (answers: Record<string, string>) => void
}

export default function ChatMessage({ message, onAskUserRespond }: ChatMessageProps) {
  if (message.role === 'user') {
    return (
      <div className="flex w-full justify-end">
        <div className="max-w-[75%] whitespace-pre-wrap break-words rounded-2xl bg-secondary px-4 py-2.5 text-sm leading-relaxed text-foreground shadow-sm">
          {message.content}
        </div>
      </div>
    )
  }

  const events: StreamEvent[] | undefined =
    message.traceEvents ?? (message.loopTrace ? loopTraceToEvents(message.loopTrace) : undefined)

  return (
    <div className="flex w-full justify-start">
      <div
        className={cn(
          'w-full text-foreground',
          message.isError &&
            'whitespace-pre-wrap rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950 dark:text-red-400'
        )}
      >
        {events && events.length > 0 && (
          <AssistantActivity
            events={events}
            isStreaming={message.isStreaming}
            content={message.content}
          />
        )}

        {message.isWaitingForInput && message.askUserPayload && onAskUserRespond && (
          <AskUserCard payload={message.askUserPayload} onRespond={onAskUserRespond} />
        )}

        {message.isError ? (
          <div>{message.content}</div>
        ) : (
          <AssistantResponse content={message.content} isStreaming={message.isStreaming} />
        )}

        {message.quizQuestions && message.quizQuestions.length > 0 && (
          <div className="mt-4 space-y-3">
            {message.quizQuestions.map((question, index) => (
              <QuizCard key={question.question_id} question={question} ordinal={index + 1} />
            ))}
          </div>
        )}

        {message.references && message.references.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>引用：</span>
            {message.references.map((reference, index) => {
              const isWebRef = reference.reference_id?.startsWith('web_')
              const Icon = isWebRef ? GlobeIcon : PaperclipIcon
              return (
                <span
                  key={`${reference.reference_id ?? reference.file_path ?? index}`}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5',
                    isWebRef
                      ? 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400'
                      : 'bg-muted'
                  )}
                  title={reference.file_path}
                >
                  <Icon className="h-3 w-3" />
                  {isWebRef && reference.file_path ? (
                    <a
                      href={reference.file_path}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-blue-800 dark:hover:text-blue-300"
                    >
                      {reference.file_path}
                    </a>
                  ) : (
                    reference.file_path ?? reference.reference_id ?? `#${index + 1}`
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
