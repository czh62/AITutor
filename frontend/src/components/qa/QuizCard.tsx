import { useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QuizQuestion } from '@/api/types'
import { QUIZ_TYPE_LABELS } from '@/api/types'

/**
 * QuizCard — 单道题目渲染卡片。
 *
 * 渲染题面（Markdown）、选项（choice 类型显示 A/B/C/D）、
 * 答案折叠区（默认折叠，点击展开显示 correct_answer + explanation）、题型/难度标签。
 */

interface QuizCardProps {
  question: QuizQuestion
  ordinal: number          // 第 N 题
  defaultRevealed?: boolean // 是否默认展开答案
}

export default function QuizCard({ question, ordinal, defaultRevealed = false }: QuizCardProps) {
  const [revealed, setRevealed] = useState(defaultRevealed)

  const typeLabel = QUIZ_TYPE_LABELS[question.question_type] || question.question_type
  const diffLabel = question.difficulty === 'easy' ? '简单' : question.difficulty === 'medium' ? '中等' : question.difficulty === 'hard' ? '困难' : ''

  return (
    <div className="rounded-xl border border-border/55 bg-card shadow-sm transition-colors">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30">
        <span className="inline-flex items-center rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-700">
          第 {ordinal} 题
        </span>
        <span className="text-xs font-medium text-muted-foreground">{typeLabel}</span>
        {diffLabel && (
          <span className="text-xs text-muted-foreground/60">{diffLabel}</span>
        )}
        {question.topic && (
          <span className="text-xs text-muted-foreground/50 truncate ml-auto max-w-[200px]">{question.topic}</span>
        )}
      </div>

      {/* Body — 题面 */}
      <div className="px-4 py-3 text-sm leading-relaxed text-foreground whitespace-pre-wrap">
        {question.question}
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
                <span className="whitespace-pre-wrap">{value}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Concept (T/F) */}
      {question.question_type === 'concept' && (
        <div className="px-4 pb-3 flex items-center gap-3 text-sm">
          <span className="inline-flex items-center rounded-md px-2 py-0.5 bg-muted/30">正确</span>
          <span className="inline-flex items-center rounded-md px-2 py-0.5 bg-muted/30">错误</span>
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
              收起答案
            </>
          ) : (
            <>
              <ChevronDownIcon className="h-3 w-3" />
              显示答案
            </>
          )}
        </button>

        {revealed && (
          <div className="mt-2 space-y-2 text-sm">
            <div>
              <span className="font-semibold text-emerald-600">答案：</span>
              <span className="text-foreground">{formatAnswer(question)}</span>
            </div>
            {question.explanation && question.explanation !== 'N/A' && (
              <div>
                <span className="font-semibold text-muted-foreground">解析：</span>
                <span className="text-foreground whitespace-pre-wrap">{question.explanation}</span>
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
    return q.correct_answer === 'true' ? '正确' : '错误'
  }
  return q.correct_answer
}
