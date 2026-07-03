import { useState } from 'react'
import { BrainIcon, XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QuizDifficulty, QuizQuestionType } from '@/api/types'
import { QUIZ_QUESTION_TYPE_OPTIONS, QUIZ_DIFFICULTY_OPTIONS } from '@/api/types'

/**
 * QuizConfigDialog — 出题配置对话框。
 *
 * 包含：主题输入、题目数量、难度选择、题型多选。
 * 点击「开始出题」触发 onConfirm，点击「取消」或 × 触发 onCancel。
 */

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

export default function QuizConfigDialog({ onConfirm, onCancel, isStreaming }: QuizConfigDialogProps) {
  const [topic, setTopic] = useState('')
  const [numQuestions, setNumQuestions] = useState(3)
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('auto')
  const [selectedTypes, setSelectedTypes] = useState<QuizQuestionType[]>([])

  const canSubmit = topic.trim().length > 0 && !isStreaming

  const toggleType = (type: QuizQuestionType) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in" onClick={onCancel}>
      <div
        className="relative w-full max-w-md rounded-2xl border border-border/55 bg-card shadow-[0_10px_40px_-10px_rgba(0,0,0,0.15)] animate-dialog-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border/30">
          <BrainIcon className="h-5 w-5 text-emerald-500" />
          <h2 className="text-base font-semibold text-foreground">出题配置</h2>
          <button
            type="button"
            onClick={onCancel}
            className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors"
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Topic */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">主题 <span className="text-muted-foreground/50">（必填）</span></label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：Python 基础语法、数据结构入门…"
              className="w-full rounded-xl border border-border/50 bg-transparent px-3 py-2 text-sm text-foreground outline-none focus:border-emerald-500/50 transition-colors placeholder:text-muted-foreground/40"
              autoFocus
            />
          </div>

          {/* Number + Difficulty row */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-sm font-medium text-foreground mb-1.5">题目数量</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setNumQuestions(Math.max(1, numQuestions - 1))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 text-sm font-semibold text-muted-foreground hover:bg-muted/60 transition-colors"
                >−</button>
                <span className="text-sm font-semibold text-foreground tabular-nums w-6 text-center">{numQuestions}</span>
                <button
                  type="button"
                  onClick={() => setNumQuestions(Math.min(10, numQuestions + 1))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/50 text-sm font-semibold text-muted-foreground hover:bg-muted/60 transition-colors"
                >+</button>
              </div>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-foreground mb-1.5">难度</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as QuizDifficulty)}
                className="w-full h-8 rounded-lg border border-border/50 bg-transparent px-2 text-sm text-foreground outline-none focus:border-emerald-500/50 cursor-pointer appearance-none"
              >
                {QUIZ_DIFFICULTY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Question types */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">题型 <span className="text-muted-foreground/50">（不选=任意题型）</span></label>
            <div className="flex flex-wrap gap-1.5">
              {QUIZ_QUESTION_TYPE_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggleType(o.value)}
                  className={cn(
                    'inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-medium transition-colors border',
                    selectedTypes.includes(o.value)
                      ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-700'
                      : 'bg-muted/30 border-border/30 text-muted-foreground hover:bg-muted/60'
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/30">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex h-9 items-center rounded-xl px-4 text-sm font-medium text-muted-foreground hover:bg-muted/60 transition-colors"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => {
              if (canSubmit) {
                onConfirm({
                  topic: topic.trim(),
                  num_questions: numQuestions,
                  difficulty,
                  question_types: selectedTypes,
                })
              }
            }}
            disabled={!canSubmit}
            className={cn(
              'inline-flex h-9 items-center rounded-xl px-4 text-sm font-medium text-white transition-colors',
              canSubmit
                ? 'bg-emerald-500 hover:bg-emerald-600 active:scale-[0.97]'
                : 'bg-muted/40 text-muted-foreground cursor-not-allowed'
            )}
          >
            <BrainIcon className="h-4 w-4 mr-1.5" />
            开始出题
          </button>
        </div>
      </div>
    </div>
  )
}
