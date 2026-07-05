/**
 * QuizViewer — 聚合Quiz组件。
 *
 * 替代原来的逐题 QuizCard 列表，参照 DeepTutor QuizViewer 的聚合Layout：
 * - 导航 chips（Q1/Q2/Q3...）+ 前进后退箭头 + 进度条 + 完成计数
 * - 一道一道作答（按Question Types切换输入方式）
 * - 提交后Auto判题（choice/concept/精确匹配的 fill_in_blank）或 AI Grading（主观/语义Fill in the Blank）
 * - 答案回顾区：Reference Answer + AI Grading 双 tab
 * - Ask Follow-up：inline mini 聊天区域
 */
import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Sparkles,
  MessageSquarePlus,
  Send,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { cn } from '@/lib/utils'
import { useQAStore } from '@/stores/qa'
import { quizJudgeStream, quizFollowupStream } from '@/api/aitutor'
import {
  isAutoGradable,
  isAnswerCorrect,
  getUserAnswer,
  resolveConceptAnswer,
  resolveChoiceAnswerKey,
  EMPTY_ANSWER,
  EMPTY_JUDGMENT,
} from '@/lib/quiz-grading'
import { getAnswerReviewKind } from '@/lib/quiz-display'
import type {
  QuizQuestion,
  QuizAnswerState,
  QuizJudgmentState,
} from '@/api/types'
import { QUIZ_TYPE_LABELS } from '@/api/types'

// ── 简化版追问聊天消息 ──────────────────────────────────
interface FollowupMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  isStreaming?: boolean
}

// ── Props ──────────────────────────────────────────────
interface QuizViewerProps {
  questions: QuizQuestion[]
  messageId: string  // ChatMessage.id，用于 store 更新
}

export default function QuizViewer({ questions, messageId }: QuizViewerProps) {
  const [idx, setIdx] = useState(0)
  const [showFollowup, setShowFollowup] = useState(false)
  const [followupMessages, setFollowupMessages] = useState<FollowupMessage[]>([])
  const [followupInput, setFollowupInput] = useState('')
  const [followupStreaming, setFollowupStreaming] = useState(false)
  const [answerView, setAnswerView] = useState<'reference' | 'judgment'>('reference')
  const [reviewOpen, setReviewOpen] = useState(false)
  const judgeAbortRef = useRef<AbortController | null>(null)
  const followupAbortRef = useRef<AbortController | null>(null)

  // 组件卸载时中止流式请求
  useEffect(() => {
    return () => {
      judgeAbortRef.current?.abort()
      followupAbortRef.current?.abort()
    }
  }, [])

  // 从 store 获取作答和判词Status
  const message = useQAStore((s) => s.messages.find((m) => m.id === messageId))
  const updateMessage = useQAStore((s) => s.updateMessage)

  const answers: Record<number, QuizAnswerState> = message?.quizAnswers ?? {}
  const judgments: Record<number, QuizJudgmentState> = message?.quizJudgments ?? {}

  const q = questions[idx]
  const ans = answers[idx] ?? EMPTY_ANSWER
  const judgment = judgments[idx] ?? EMPTY_JUDGMENT
  const total = questions.length
  const completedCount = useMemo(
    () => Object.values(answers).filter((a) => a.submitted).length,
    [answers],
  )
  const progressPercent = total > 0 ? (completedCount / total) * 100 : 0

  // ── 更新作答Status ──────────────────────────────────────
  const updateAnswer = useCallback(
    (patch: Partial<QuizAnswerState>) => {
      const current = answers[idx] ?? EMPTY_ANSWER
      updateMessage(messageId, {
        quizAnswers: { ...answers, [idx]: { ...current, ...patch } },
      })
    },
    [answers, idx, messageId, updateMessage],
  )

  // ── Submit Answer ──────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    if (!ans.selected && !ans.typed.trim()) return
    updateAnswer({ submitted: true })
    setReviewOpen(true)
  }, [ans, updateAnswer])

  // ── Reset答案 ──────────────────────────────────────────
  const handleRetry = useCallback(() => {
    updateAnswer({ selected: null, typed: '', submitted: false })
    // 清除判词 — 从 store 实时读取避免 stale closure
    const currentMsg = useQAStore.getState().messages.find((m) => m.id === messageId)
    const currentJudgments = currentMsg?.quizJudgments ?? {}
    updateMessage(messageId, {
      quizJudgments: { ...currentJudgments, [idx]: { ...EMPTY_JUDGMENT } },
    })
    setReviewOpen(false)
    setShowFollowup(false)
  }, [idx, messageId, updateAnswer, updateMessage])

  // ── AI Grading ──────────────────────────────────────────
  const handleAiJudge = useCallback(async () => {
    if (judgment.isStreaming) return

    const controller = new AbortController()
    judgeAbortRef.current = controller

    // 设置流式Status
    updateMessage(messageId, {
      quizJudgments: { ...judgments, [idx]: { text: '', isStreaming: true, error: null } },
    })
    setAnswerView('judgment')
    setReviewOpen(true)

    try {
      await quizJudgeStream(
        {
          question: q.question,
          question_type: q.question_type,
          options: q.options,
          correct_answer: q.correct_answer,
          explanation: q.explanation,
          user_answer: getUserAnswer(q, ans),
          language: 'zh',
        },
        {
          // 从 store 实时读取最新Status，避免 stale closure
          onChunk: (text) => {
            const currentMsg = useQAStore.getState().messages.find((m) => m.id === messageId)
            const currentJudgments = currentMsg?.quizJudgments ?? {}
            const currentJudgment = currentJudgments[idx] ?? { text: '', isStreaming: true, error: null }
            updateMessage(messageId, {
              quizJudgments: { ...currentJudgments, [idx]: { ...currentJudgment, text: currentJudgment.text + text, isStreaming: true, error: null } },
            })
          },
          onDone: (finalText) => {
            const currentMsg = useQAStore.getState().messages.find((m) => m.id === messageId)
            const currentJudgments = currentMsg?.quizJudgments ?? {}
            updateMessage(messageId, {
              quizJudgments: { ...currentJudgments, [idx]: { text: finalText, isStreaming: false, error: null } },
            })
            judgeAbortRef.current = null
          },
          onError: (msg) => {
            const currentMsg = useQAStore.getState().messages.find((m) => m.id === messageId)
            const currentJudgments = currentMsg?.quizJudgments ?? {}
            updateMessage(messageId, {
              quizJudgments: { ...currentJudgments, [idx]: { text: '', isStreaming: false, error: msg } },
            })
            judgeAbortRef.current = null
          },
          signal: controller.signal,
        },
      )
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      const currentMsg = useQAStore.getState().messages.find((m) => m.id === messageId)
      const currentJudgments = currentMsg?.quizJudgments ?? {}
      updateMessage(messageId, {
        quizJudgments: { ...currentJudgments, [idx]: { text: '', isStreaming: false, error: String(err) } },
      })
    }
  }, [q, ans, judgment, judgments, idx, messageId, updateMessage])

  // ── Ask Follow-up ──────────────────────────────────────────
  const handleFollowupSend = useCallback(async () => {
    const input = followupInput.trim()
    if (!input || followupStreaming) return
    setFollowupInput('')

    // 添加用户消息
    const userMsg: FollowupMessage = {
      id: `fu_${Date.now()}_user`,
      role: 'user',
      content: input,
    }
    setFollowupMessages((prev) => [...prev, userMsg])

    // 添加空的 AI Reply消息
    const aiMsgId = `fu_${Date.now()}_ai`
    const aiMsg: FollowupMessage = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      isStreaming: true,
    }
    setFollowupMessages((prev) => [...prev, aiMsg])
    setFollowupStreaming(true)

    const controller = new AbortController()
    followupAbortRef.current = controller

    try {
      await quizFollowupStream(
        {
          followup_question: input,
          question: q.question,
          question_type: q.question_type,
          options: q.options,
          correct_answer: q.correct_answer,
          explanation: q.explanation,
          user_answer: getUserAnswer(q, ans),
          ai_judgment: judgment.text || null,
          language: 'zh',
        },
        {
          onChunk: (text) => {
            setFollowupMessages((prev) =>
              prev.map((m) =>
                m.id === aiMsgId ? { ...m, content: m.content + text } : m,
              ),
            )
          },
          onDone: () => {
            setFollowupMessages((prev) =>
              prev.map((m) =>
                m.id === aiMsgId ? { ...m, isStreaming: false } : m,
              ),
            )
            setFollowupStreaming(false)
            followupAbortRef.current = null
          },
          onError: (msg) => {
            setFollowupMessages((prev) =>
              prev.map((m) =>
                m.id === aiMsgId
                  ? { ...m, content: `Incorrect: ${msg}`, isStreaming: false }
                  : m,
              ),
            )
            setFollowupStreaming(false)
            followupAbortRef.current = null
          },
          signal: controller.signal,
        },
      )
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setFollowupMessages((prev) =>
        prev.map((m) =>
          m.id === aiMsgId
            ? { ...m, content: `Incorrect: ${String(err)}`, isStreaming: false }
            : m,
        ),
      )
      setFollowupStreaming(false)
    }
  }, [followupInput, followupStreaming, q, ans, judgment])

  // ── chip 颜色逻辑 ──────────────────────────────────────
  const getChipStyle = (questionIdx: number) => {
    const a = answers[questionIdx]
    if (!a?.submitted) {
      return 'bg-muted/40 text-muted-foreground' // 未答：淡灰
    }
    const question = questions[questionIdx]
    if (question.question_type === 'fill_in_blank' || !isAutoGradable(question.question_type)) {
      const reviewKind = getAnswerReviewKind(question, a, judgments[questionIdx])
      if (reviewKind === 'correct') return 'bg-emerald-500/20 text-emerald-700 border-emerald-500/40'
      if (reviewKind === 'partial') return 'bg-amber-500/20 text-amber-700 border-amber-500/40'
      if (reviewKind === 'incorrect') return 'bg-red-500/20 text-red-700 border-red-500/40'
      return 'bg-blue-500/15 text-blue-700 border-blue-500/30'
    }
    if (isAutoGradable(question.question_type)) {
      const correct = isAnswerCorrect(question, a)
      return correct
        ? 'bg-emerald-500/20 text-emerald-700 border-emerald-500/40'
        : 'bg-red-500/20 text-red-700 border-red-500/40'
    }
  }

  // 当前Select中题目 → 蓝色高亮（不与正误颜色混淆）
  const activeChipStyle = 'bg-blue-500/20 text-blue-700 border-blue-500/50 ring-1 ring-blue-500/30'

  const renderReviewBadge = (kind: 'correct' | 'partial' | 'incorrect' | 'needs-ai') => {
    if (kind === 'correct') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2.5 py-1 text-sm font-medium text-emerald-700">
          <Check className="h-4 w-4" /> Correct
        </span>
      )
    }
    if (kind === 'partial') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2.5 py-1 text-sm font-medium text-amber-700">
          Partially Correct
        </span>
      )
    }
    if (kind === 'incorrect') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2.5 py-1 text-sm font-medium text-red-700">
          <X className="h-4 w-4" /> Incorrect
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/15 px-2.5 py-1 text-sm font-medium text-blue-700">
        Needs AI Grading
      </span>
    )
  }

  // ── Question Types对应作答区域 ──────────────────────────────────
  const renderAnswerInput = () => {
    if (ans.submitted) {
      // ── 已提交：客观题继续显示Select项（禁用），用颜色标注正误 ──
      switch (q.question_type) {
        case 'choice': {
          const correctKey = resolveChoiceAnswerKey(q.correct_answer, q.options)
          const correct = isAnswerCorrect(q, ans)
          return (
            <div className="mt-2">
              {/* 正误徽章 */}
              <div className="flex items-center gap-2 mb-2">
                {correct ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2.5 py-1 text-sm font-medium text-emerald-700">
                    <Check className="h-4 w-4" /> Correct
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2.5 py-1 text-sm font-medium text-red-700">
                    <X className="h-4 w-4" /> Incorrect
                  </span>
                )}
              </div>
              {/* Select项列表（禁用），颜色标注：CorrectSelect项绿色，用户错Select红色 */}
              <div className="space-y-1.5">
                {(['A', 'B', 'C', 'D'] as const).map((key) => {
                  const value = q.options?.[key]
                  if (!value) return null
                  const isCorrectOption = key === correctKey
                  const isUserSelected = ans.selected === key
                  // 用户Select了Incorrect答案 → 红色；CorrectSelect项 → 绿色；其余 → 灰色
                  let optionStyle: string
                  if (isUserSelected && isCorrectOption) {
                    optionStyle = 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 font-medium'
                  } else if (isUserSelected && !isCorrectOption) {
                    optionStyle = 'bg-red-500/10 border-red-500/40 text-red-700 font-medium'
                  } else if (isCorrectOption) {
                    optionStyle = 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 font-medium'
                  } else {
                    optionStyle = 'bg-muted/20 border-border/20 text-muted-foreground/60'
                  }
                  return (
                    <div
                      key={key}
                      className={cn(
                        'flex items-start gap-2 rounded-lg px-3 py-2 text-sm w-full text-left border',
                        optionStyle,
                      )}
                    >
                      <span className="font-semibold shrink-0">{key}.</span>
                      <span className="inline">
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                          {value}
                        </ReactMarkdown>
                      </span>
                      {/* CorrectSelect项标记 ✓ */}
                      {isCorrectOption && !isUserSelected && (
                        <Check className="h-4 w-4 text-emerald-600 shrink-0 ml-auto" />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        }

        case 'concept': {
          const correctAnswerNormalized = resolveConceptAnswer(q.correct_answer)
          const correct = isAnswerCorrect(q, ans)
          return (
            <div className="mt-2">
              {/* 正误徽章 */}
              <div className="flex items-center gap-2 mb-2">
                {correct ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2.5 py-1 text-sm font-medium text-emerald-700">
                    <Check className="h-4 w-4" /> Correct
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2.5 py-1 text-sm font-medium text-red-700">
                    <X className="h-4 w-4" /> Incorrect
                  </span>
                )}
              </div>
              {/* True / False按钮（禁用），颜色标注 */}
              <div className="flex items-center gap-3">
                {(['true', 'false'] as const).map((val) => {
                  const isCorrectOption = val === correctAnswerNormalized
                  const isUserSelected = ans.selected === val
                  let btnStyle: string
                  if (isUserSelected && isCorrectOption) {
                    btnStyle = 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 font-medium'
                  } else if (isUserSelected && !isCorrectOption) {
                    btnStyle = 'bg-red-500/10 border-red-500/40 text-red-700 font-medium'
                  } else if (isCorrectOption) {
                    btnStyle = 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 font-medium'
                  } else {
                    btnStyle = 'bg-muted/20 border-border/20 text-muted-foreground/60'
                  }
                  return (
                    <div
                      key={val}
                      className={cn(
                        'rounded-lg px-4 py-2 text-sm font-medium border inline-flex items-center gap-1',
                        btnStyle,
                      )}
                    >
                      {val === 'true' ? 'Correct' : 'Incorrect'}
                      {isCorrectOption && !isUserSelected && (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        }

        case 'fill_in_blank': {
          const reviewKind = getAnswerReviewKind(q, ans, judgment)
          return (
            <div className="flex items-center gap-3 mt-2">
              {renderReviewBadge(reviewKind)}
              <span className="text-sm text-foreground/80">Your answer: {ans.typed.trim()}</span>
            </div>
          )
        }

        // 主观题：已提交标记 + 用户Answer
        default: {
          const userAnswerText = getUserAnswerDisplay(q, ans)
          return (
            <div className="flex items-center gap-3 mt-2">
              {renderReviewBadge(getAnswerReviewKind(q, ans, judgment))}
              <span className="text-sm text-foreground/80">{userAnswerText}</span>
            </div>
          )
        }
      }
    }

    // ── 未提交：显示输入控件 ────────────────────────────────
    switch (q.question_type) {
      case 'choice':
        return (
          <div className="space-y-1.5 mt-2">
            {(['A', 'B', 'C', 'D'] as const).map((key) => {
              const value = q.options?.[key]
              if (!value) return null
              // Select中Select项统一蓝色，不与正误颜色混淆
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => updateAnswer({ selected: key })}
                  className={cn(
                    'flex items-start gap-2 rounded-lg px-3 py-2 text-sm w-full text-left transition-colors border',
                    ans.selected === key
                      ? 'bg-blue-500/10 border-blue-500/40 text-blue-700 font-medium'
                      : 'bg-muted/30 border-border/30 text-foreground hover:bg-muted/50',
                  )}
                >
                  <span className="font-semibold shrink-0">{key}.</span>
                  <span className="inline">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {value}
                    </ReactMarkdown>
                  </span>
                </button>
              )
            })}
          </div>
        )

      case 'concept':
        return (
          <div className="flex items-center gap-3 mt-2">
            {/* Select中Select项统一蓝色，不与正误颜色混淆 */}
            <button
              type="button"
              onClick={() => updateAnswer({ selected: 'true' })}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-colors border',
                ans.selected === 'true'
                  ? 'bg-blue-500/10 border-blue-500/40 text-blue-700'
                  : 'bg-muted/30 border-border/30 hover:bg-muted/50',
              )}
            >
              Correct
            </button>
            <button
              type="button"
              onClick={() => updateAnswer({ selected: 'false' })}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-colors border',
                ans.selected === 'false'
                  ? 'bg-blue-500/10 border-blue-500/40 text-blue-700'
                  : 'bg-muted/30 border-border/30 hover:bg-muted/50',
              )}
            >
              Incorrect
            </button>
          </div>
        )

      case 'fill_in_blank':
        return (
          <input
            type="text"
            value={ans.typed}
            onChange={(e) => updateAnswer({ typed: e.target.value })}
            placeholder="Enter your answer..."
            className="mt-2 w-full rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500/50 focus:outline-none"
          />
        )

      case 'short_answer':
        return (
          <textarea
            value={ans.typed}
            onChange={(e) => updateAnswer({ typed: e.target.value })}
            placeholder="Enter a short answer..."
            rows={3}
            className="mt-2 w-full rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500/50 focus:outline-none resize-y"
          />
        )

      case 'written':
        return (
          <textarea
            value={ans.typed}
            onChange={(e) => updateAnswer({ typed: e.target.value })}
            placeholder="Enter your response..."
            rows={5}
            className="mt-2 w-full rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-blue-500/50 focus:outline-none resize-y"
          />
        )

      case 'coding':
        return (
          <textarea
            value={ans.typed}
            onChange={(e) => updateAnswer({ typed: e.target.value })}
            placeholder="Enter code..."
            rows={6}
            className="mt-2 w-full rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:border-blue-500/50 focus:outline-none resize-y"
          />
        )

      default:
        return null
    }
  }

  // ── 格式化用户Answer（提交后显示） ──────────────────────
  function getUserAnswerDisplay(question: QuizQuestion, answer: QuizAnswerState): string {
    if (question.question_type === 'choice' && answer.selected && question.options) {
      const optionText = question.options[answer.selected]
      return optionText ? `Your choice: ${answer.selected}. ${optionText}` : `Your choice: ${answer.selected}`
    }
    if (question.question_type === 'concept') {
      return answer.selected === 'true' ? 'Your response: Correct' : answer.selected === 'false' ? 'Your response: Incorrect' : 'Not answered'
    }
    if (answer.typed.trim()) {
      const label = question.question_type === 'fill_in_blank' ? 'Your answer' : 'Your response'
      return `${label}：${answer.typed.trim()}`
    }
    return 'Not answered'
  }

  // ──面 + Question TypesLabels ──────────────────────────────────
  const typeLabel = QUIZ_TYPE_LABELS[q.question_type] || q.question_type
  const diffLabel = q.difficulty === 'easy' ? 'Easy' : q.difficulty === 'medium' ? 'Medium' : q.difficulty === 'hard' ? 'Hard' : ''

  // ── 格式化答案 ──────────────────────────────────────
  function formatAnswer(q: QuizQuestion): string {
    if (q.question_type === 'choice' && q.options && q.correct_answer) {
      const optionText = q.options[q.correct_answer]
      return optionText ? `${q.correct_answer}. ${optionText}` : q.correct_answer
    }
    if (q.question_type === 'concept') {
      return resolveConceptAnswer(q.correct_answer) === 'true' ? 'Correct' : 'Incorrect'
    }
    return q.correct_answer
  }

  return (
    <div className="rounded-xl border border-border/55 bg-card shadow-sm">
      {/* ── 导航头部 ─────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-border/30">
        {/* 顶部行：进度信息 + 导航箭头 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <span className="font-medium">{completedCount}/{total}</span>
            <span>Completed</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setIdx(Math.max(0, idx - 1))}
              disabled={idx === 0}
              className="p-1 rounded hover:bg-muted/50 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setIdx(Math.min(total - 1, idx + 1))}
              disabled={idx === total - 1}
              className="p-1 rounded hover:bg-muted/50 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 进度条 */}
        <div className="mt-2 h-1.5 rounded-full bg-muted/30 overflow-hidden">
          <div
            className="h-full rounded-full bg-emerald-500/60 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/*号 chips */}
        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto">
          {questions.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIdx(i)}
              className={cn(
                'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-colors border',
                i === idx
                  ? activeChipStyle
                  : getChipStyle(i),
              )}
            >
              Q{i + 1}
            </button>
          ))}
        </div>
      </div>

      {/* ──面区域 ─────────────────────────────────── */}
      <div className="px-4 py-3">
        {/* Question Types/DifficultyLabels */}
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            Question {idx + 1}
          </span>
          <span className="text-xs font-medium text-muted-foreground">{typeLabel}</span>
          {diffLabel && (
            <span className="text-xs text-muted-foreground/60">{diffLabel}</span>
          )}
          {q.topic && (
            <span className="text-xs text-muted-foreground/50 truncate ml-auto max-w-[200px]">{q.topic}</span>
          )}
        </div>

        {/*面 Markdown */}
        <div className="text-sm leading-relaxed text-foreground">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
            {q.question}
          </ReactMarkdown>
        </div>

        {/* 作答区域 */}
        {renderAnswerInput()}

        {/* ── 操作按钮 ───────────────────────────────── */}
        {!ans.submitted ? (
          <div className="mt-3 flex items-center">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!ans.selected && !ans.typed.trim()}
              className="rounded-lg bg-emerald-500/80 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-500/80 transition-colors"
            >
              Submit Answer
            </button>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-lg border border-border/40 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={handleAiJudge}
              disabled={judgment.isStreaming}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1',
                judgment.isStreaming
                  ? 'opacity-50 border-border/30 text-muted-foreground'
                  : 'border-blue-500/40 text-blue-700 hover:bg-blue-500/10',
              )}
            >
              {judgment.isStreaming ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> Grading...
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" /> AI Grading
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowFollowup(!showFollowup)
                if (!showFollowup) setReviewOpen(true)
              }}
              className="rounded-lg border border-blue-500/40 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-500/10 transition-colors flex items-center gap-1"
            >
              <MessageSquarePlus className="h-3 w-3" /> Ask Follow-up
            </button>
          </div>
        )}

        {/* ── 答案回顾区 ─────────────────────────────── */}
        {ans.submitted && (
          <div className="mt-4 border-t border-border/30">
            {/* 折叠/展开按钮 */}
            <button
              type="button"
              onClick={() => setReviewOpen(!reviewOpen)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground py-2 transition-colors"
            >
              {reviewOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {reviewOpen ? 'Hide Answer Review' : 'Show Answer Review'}
            </button>

            {reviewOpen && (
              <div className="pb-3">
                {/* Tab 切换 */}
                <div className="flex items-center gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => setAnswerView('reference')}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      answerView === 'reference'
                        ? 'bg-blue-500/15 text-blue-700'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    Reference Answer
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnswerView('judgment')}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      answerView === 'judgment'
                        ? 'bg-blue-500/15 text-blue-700'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    AI Grading
                  </button>
                </div>

                {/* Reference Answer tab */}
                {answerView === 'reference' && (
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-semibold text-blue-600">Your response: </span>
                      <span className="text-foreground">{getUserAnswerDisplay(q, ans).replace(/^(Your choice: |Your answer: |Your response: )/, '')}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-emerald-600">Answer: </span>
                      <span className="text-foreground">{formatAnswer(q)}</span>
                    </div>
                    {q.explanation && q.explanation !== 'N/A' && (
                      <div>
                        <span className="font-semibold text-muted-foreground">Parsing：</span>
                        <span className="text-foreground">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {q.explanation}
                          </ReactMarkdown>
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* AI Grading tab */}
                {answerView === 'judgment' && (
                  <div className="text-sm">
                    {judgment.error ? (
                      <div className="text-red-600">{judgment.error}</div>
                    ) : judgment.text ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {judgment.text}
                      </ReactMarkdown>
                    ) : (
                      <div className="text-muted-foreground italic">
                        Click AI Grading to evaluate this answer.
                      </div>
                    )}
                    {judgment.isStreaming && (
                      <span className="inline-block w-2 h-4 bg-emerald-500/60 animate-pulse ml-0.5" />
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Ask Follow-up inline 区域 ────────────────────── */}
        {showFollowup && ans.submitted && (
          <div className="mt-3 border-t border-border/30 pt-3">
            <div className="text-xs font-medium text-blue-700 mb-2 flex items-center gap-1">
              <MessageSquarePlus className="h-3 w-3" /> Ask Follow-up
            </div>

            {/* 聊天消息流 */}
            <div className="space-y-2 max-h-[200px] overflow-y-auto">
              {followupMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={cn(
                    'rounded-lg px-3 py-2 text-sm',
                    msg.role === 'user'
                      ? 'bg-muted/30 text-foreground'
                      : 'bg-card border border-border/30 text-foreground',
                  )}
                >
                  {msg.role === 'assistant' ? (
                    <>
                      <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                        {msg.content}
                      </ReactMarkdown>
                      {msg.isStreaming && (
                        <span className="inline-block w-2 h-4 bg-emerald-500/60 animate-pulse ml-0.5" />
                      )}
                    </>
                  ) : (
                    msg.content
                  )}
                </div>
              ))}
            </div>

            {/* Mini 输入栏 */}
            <div className="mt-2 flex items-center gap-2">
              <input
                type="text"
                value={followupInput}
                onChange={(e) => setFollowupInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleFollowupSend()
                  }
                }}
                placeholder="Ask a follow-up..."
                disabled={followupStreaming}
                className="flex-1 rounded-lg border border-border/40 bg-muted/20 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-emerald-500/50 focus:outline-none disabled:opacity-40"
              />
              <button
                type="button"
                onClick={handleFollowupSend}
                disabled={followupStreaming || !followupInput.trim()}
                className="p-1.5 rounded-lg bg-emerald-500/80 text-white hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-500/80 transition-colors"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
