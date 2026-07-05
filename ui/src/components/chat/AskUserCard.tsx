import { useMemo, useState } from 'react'
import { MessageCircleQuestionIcon, SendIcon } from 'lucide-react'
import type { AskUserPayload } from '@/api/types'
import { cn } from '@/lib/utils'

interface AskUserCardProps {
  payload: AskUserPayload
  onRespond: (answers: Record<string, string>) => void
  disabled?: boolean
}

export default function AskUserCard({ payload, onRespond, disabled }: AskUserCardProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const allAnswered = useMemo(
    () => payload.questions.every((question) => (answers[question.id] || '').trim().length > 0),
    [answers, payload.questions]
  )

  const setAnswer = (questionId: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }))
  }

  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-emerald-200/80 bg-emerald-50/70 shadow-sm dark:border-emerald-900/80 dark:bg-emerald-950/30">
      <div className="flex items-center gap-2 border-b border-emerald-200/60 bg-emerald-100/50 px-4 py-2.5 dark:border-emerald-900 dark:bg-emerald-950/40">
        <MessageCircleQuestionIcon className="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
        <span className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
          Needs your input
        </span>
      </div>

      {payload.context && (
        <div className="whitespace-pre-wrap px-4 pt-3 text-sm text-muted-foreground">
          {payload.context}
        </div>
      )}

      <div className="space-y-4 px-4 py-3">
        {payload.questions.map((question, index) => {
          const options = question.options ?? []
          const current = answers[question.id] || ''
          return (
            <div key={question.id} className="space-y-2">
              <div className="text-sm font-medium text-foreground">
                {payload.questions.length > 1 && (
                  <span className="mr-1.5 text-emerald-700 dark:text-emerald-300">
                    Q{index + 1}.
                  </span>
                )}
                {question.text}
              </div>

              {options.length > 0 ? (
                <div className="flex flex-col gap-1.5">
                  {options.map((option) => {
                    const checked = current === option
                    return (
                      <label
                        key={option}
                        className={cn(
                          'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors',
                          checked
                            ? 'border-emerald-400 bg-emerald-100/70 text-emerald-950 dark:bg-emerald-900/40 dark:text-emerald-50'
                            : 'border-border bg-card hover:border-emerald-300 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20'
                        )}
                      >
                        <input
                          type="radio"
                          name={`ask-${question.id}`}
                          className="mt-1 accent-emerald-600"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => setAnswer(question.id, option)}
                        />
                        <span>{option}</span>
                      </label>
                    )
                  })}
                  <input
                    type="text"
                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-emerald-400"
                    placeholder="Custom answer"
                    disabled={disabled}
                    value={options.includes(current) ? '' : current}
                    onChange={(event) => setAnswer(question.id, event.target.value)}
                  />
                </div>
              ) : (
                <textarea
                  rows={2}
                  className="w-full resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/50 focus:border-emerald-400"
                  placeholder="Enter your answer..."
                  disabled={disabled}
                  value={current}
                  onChange={(event) => setAnswer(question.id, event.target.value)}
                />
              )}
            </div>
          )
        })}
      </div>

      <div className="flex justify-end px-4 pb-3">
        <button
          type="button"
          onClick={() => {
            if (allAnswered && !disabled) onRespond(answers)
          }}
          disabled={!allAnswered || disabled}
          className={cn(
            'inline-flex h-8 items-center gap-1.5 rounded-lg px-4 text-sm font-medium transition-colors',
            allAnswered && !disabled
              ? 'bg-emerald-600 text-white hover:bg-emerald-700'
              : 'cursor-not-allowed bg-muted text-muted-foreground'
          )}
        >
          <SendIcon className="h-3.5 w-3.5" />
          Reply
        </button>
      </div>
    </div>
  )
}
