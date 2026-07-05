import { useState } from 'react'
import { BrainIcon, XIcon } from 'lucide-react'
import type { QuizDifficulty, QuizQuestionType } from '@/api/types'
import { QUIZ_DIFFICULTY_OPTIONS, QUIZ_QUESTION_TYPE_OPTIONS } from '@/api/types'
import { cn } from '@/lib/utils'

interface QuizConfigDialogProps {
  onConfirm: (config: {
    topic: string
    num_questions: number
    difficulty: QuizDifficulty
    question_types: QuizQuestionType[]
  }) => void
  onCancel: () => void
  isStreaming?: boolean
}

export default function QuizConfigDialog({
  onConfirm,
  onCancel,
  isStreaming
}: QuizConfigDialogProps) {
  const [topic, setTopic] = useState('')
  const [numQuestions, setNumQuestions] = useState(3)
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('auto')
  const [selectedTypes, setSelectedTypes] = useState<QuizQuestionType[]>([])
  const canSubmit = topic.trim().length > 0 && !isStreaming

  const toggleType = (type: QuizQuestionType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((item) => item !== type) : [...prev, type]
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 animate-fade-in"
      onClick={onCancel}
    >
      <div
        className="relative w-full max-w-lg rounded-2xl border border-border/55 bg-card shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] animate-dialog-pop-in"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-border/30 px-5 py-3.5">
          <BrainIcon className="h-5 w-5 text-emerald-500" />
          <h2 className="text-base font-semibold text-foreground">Quiz Settings</h2>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            aria-label="Close"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Topic <span className="text-muted-foreground/50">(required)</span>
            </label>
            <input
              type="text"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              placeholder="Example: Python basics, introductory data structures..."
              className="w-full rounded-xl border border-border/50 bg-transparent px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/40 focus:border-emerald-500/50"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-[120px_1fr] gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Number of Questions</label>
              <input
                type="number"
                min={1}
                max={20}
                value={numQuestions}
                onChange={(event) =>
                  setNumQuestions(Math.min(20, Math.max(1, Number(event.target.value) || 1)))
                }
                className="h-9 w-full rounded-lg border border-border/50 bg-transparent px-3 text-sm outline-none focus:border-emerald-500/50"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">Difficulty</label>
              <div className="grid grid-cols-4 gap-1 rounded-lg border border-border/25 p-0.5">
                {QUIZ_DIFFICULTY_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDifficulty(option.value)}
                    className={cn(
                      'flex h-8 items-center justify-center rounded-md text-xs font-medium transition-colors',
                      difficulty === option.value
                        ? 'bg-muted text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              Question Types <span className="text-muted-foreground/50">(leave empty for any type)</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {QUIZ_QUESTION_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => toggleType(option.value)}
                  className={cn(
                    'inline-flex items-center rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors',
                    selectedTypes.includes(option.value)
                      ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'border-border/30 bg-muted/30 text-muted-foreground hover:bg-muted/60'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/30 px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center rounded-xl px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (!canSubmit) return
              onConfirm({
                topic: topic.trim(),
                num_questions: numQuestions,
                difficulty,
                question_types: selectedTypes
              })
            }}
            disabled={!canSubmit}
            className={cn(
              'inline-flex h-9 items-center rounded-xl px-4 text-sm font-medium transition-colors',
              canSubmit
                ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                : 'cursor-not-allowed bg-muted/40 text-muted-foreground'
            )}
          >
            <BrainIcon className="mr-1.5 h-4 w-4" />
            Start Quiz
          </button>
        </div>
      </div>
    </div>
  )
}
