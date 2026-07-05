import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { cn } from '@/lib/utils'
import type { QuizQuestion } from '@/api/types'
import { QUIZ_TYPE_LABELS } from '@/api/types'

/**
 * QuizCard — 单道题目渲染卡片。
 *
 * 渲染题面（Markdown）、Select项（choice Type显示 A/B/C/D）、
 * 答案折叠区（默认折叠，点击展开显示 correct_answer + explanation）、Question Types/DifficultyLabels。
 */

interface QuizCardProps {
  question: QuizQuestion
  ordinal: number          // Question N
  defaultRevealed?: boolean // 是否默认展开答案
}

export default function QuizCard({ question, ordinal, defaultRevealed = false }: QuizCardProps) {
  const [revealed, setRevealed] = useState(defaultRevealed)

  const typeLabel = QUIZ_TYPE_LABELS[question.question_type] || question.question_type
  const diffLabel = question.difficulty === 'easy' ? 'Easy' : question.difficulty === 'medium' ? 'Medium' : question.difficulty === 'hard' ? 'Hard' : ''

  return (
    <div className="rounded-xl border border-border/55 bg-card shadow-sm transition-colors">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30">
        <span className="inline-flex items-center rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-700">
          Question {ordinal}
        </span>
        <span className="text-xs font-medium text-muted-foreground">{typeLabel}</span>
        {diffLabel && (
          <span className="text-xs text-muted-foreground/60">{diffLabel}</span>
        )}
        {question.topic && (
          <span className="text-xs text-muted-foreground/50 truncate ml-auto max-w-[200px]">{question.topic}</span>
        )}
      </div>

      {/* Body —面 */}
      <div className="px-4 py-3 text-sm leading-relaxed text-foreground">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
          {question.question}
        </ReactMarkdown>
      </div>

      {/* Options (choice type) */}
      {question.question_type === 'choice' && question.options && (
        <div className="px-4 pb-3 space-y-1.5">
          {(['A', 'B', 'C', 'D'] as const).map((key) => {
            const value = question.options?.[key]
            if (!value) return null
            return (
              <div
                key={key}
                className={cn(
                  'flex items-start gap-2 rounded-lg px-3 py-1.5 text-sm transition-colors',
                  revealed && question.correct_answer === key
                    ? 'bg-emerald-500/10 text-emerald-700 font-medium'
                    : 'bg-muted/30 text-foreground'
                )}
              >
                <span className="font-semibold text-muted-foreground shrink-0">{key}.</span>
                <span className="inline">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {value}
                  </ReactMarkdown>
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Concept (T/F) */}
      {question.question_type === 'concept' && (
        <div className="px-4 pb-3 flex items-center gap-3 text-sm">
          <span className="inline-flex items-center rounded-md px-2 py-0.5 bg-muted/30">Correct</span>
          <span className="inline-flex items-center rounded-md px-2 py-0.5 bg-muted/30">Incorrect</span>
        </div>
      )}

      {/* Answer reveal button */}
      <div className="border-t border-border/30 px-4 py-2">
        <button
          type="button"
          onClick={() => setRevealed(!revealed)}
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {revealed ? (
            <>
              <ChevronUpIcon className="h-3 w-3" />
              Hide Answer
            </>
          ) : (
            <>
              <ChevronDownIcon className="h-3 w-3" />
              Show Answer
            </>
          )}
        </button>

        {revealed && (
          <div className="mt-2 space-y-2 text-sm">
            <div>
              <span className="font-semibold text-emerald-600">Answer: </span>
              <span className="text-foreground">{formatAnswer(question)}</span>
            </div>
            {question.explanation && question.explanation !== 'N/A' && (
              <div>
                <span className="font-semibold text-muted-foreground">Parsing：</span>
                <span className="text-foreground">
                <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                  {question.explanation}
                </ReactMarkdown>
              </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function formatAnswer(q: QuizQuestion): string {
  if (q.question_type === 'choice' && q.options && q.correct_answer) {
    const optionText = q.options[q.correct_answer]
    return optionText ? `${q.correct_answer}. ${optionText}` : q.correct_answer
  }
  if (q.question_type === 'concept') {
    return q.correct_answer === 'true' ? 'Correct' : 'Incorrect'
  }
  return q.correct_answer
}
