/**
 * QuizViewer — 聚合出题组件。
 *
 * 替代原来的逐题 QuizCard 列表，参照 DeepTutor QuizViewer 的聚合布局：
 * - 导航 chips（Q1/Q2/Q3...）+ 前进后退箭头 + 进度条 + 完成计数
 * - 一道一道作答（按题型切换输入方式）
 * - 提交后自动判题（choice/concept/fill_in_blank）或 AI 判题（主观题）
 * - 答案回顾区：参考答案 + AI 判词 双 tab
 * - 追问讲解：inline mini 聊天区域
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
  EMPTY_ANSWER,
  EMPTY_JUDGMENT,
} from '@/lib/quiz-grading'
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

  // 从 store 获取作答和判词状态
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

  // ── 更新作答状态 ──────────────────────────────────────
  const updateAnswer = useCallback(
    (patch: Partial<QuizAnswerState>) => {
      const current = answers[idx] ?? EMPTY_ANSWER
      updateMessage(messageId, {
        quizAnswers: { ...answers, [idx]: { ...current, ...patch } },
      })
    },
    [answers, idx, messageId, updateMessage],
  )

  // ── 提交答案 ──────────────────────────────────────────
  const handleSubmit = useCallback(() => {
    if (!ans.selected && !ans.typed.trim()) return
    updateAnswer({ submitted: true })
    setReviewOpen(true)
  }, [ans, updateAnswer])

  // ── 重置答案 ──────────────────────────────────────────
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

  // ── AI 判题 ──────────────────────────────────────────
  const handleAiJudge = useCallback(async () => {
    if (judgment.isStreaming) return

    const controller = new AbortController()
    judgeAbortRef.current = controller

    // 设置流式状态
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
          // 从 store 实时读取最新状态，避免 stale closure
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

  // ── 追问讲解 ──────────────────────────────────────────
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

    // 添加空的 AI 回复消息
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
                  ? { ...m, content: `错误: ${msg}`, isStreaming: false }
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
            ? { ...m, content: `错误: ${String(err)}`, isStreaming: false }
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
    if (isAutoGradable(question.question_type)) {
      const correct = isAnswerCorrect(question, a)
      return correct
        ? 'bg-emerald-500/20 text-emerald-700 border-emerald-500/40'
        : 'bg-red-500/20 text-red-700 border-red-500/40'
    }
    // 非自动判题：已提交=中性色
    return 'bg-blue-500/15 text-blue-700 border-blue-500/30'
  }

  // ── 题型对应作答区域 ──────────────────────────────────
  const renderAnswerInput = () => {
    if (ans.submitted) {
      // 已提交后只显示对/错标记
      if (isAutoGradable(q.question_type)) {
        const correct = isAnswerCorrect(q, ans)
        return (
          <div className="flex items-center gap-2 mt-2">
            {correct ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2.5 py-1 text-sm font-medium text-emerald-700">
                <Check className="h-4 w-4" /> 正确
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-red-500/15 px-2.5 py-1 text-sm font-medium text-red-700">
                <X className="h-4 w-4" /> 错误
              </span>
            )}
          </div>
        )
      }
      // 非自动判题：显示"已提交"标记
      return (
        <div className="flex items-center gap-2 mt-2">
          <span className="inline-flex items-center gap-1 rounded-md bg-blue-500/15 px-2.5 py-1 text-sm font-medium text-blue-700">
            已提交
          </span>
        </div>
      )
    }

    // 未提交 → 显示输入控件
    switch (q.question_type) {
      case 'choice':
        return (
          <div className="space-y-1.5 mt-2">
            {(['A', 'B', 'C', 'D'] as const).map((key) => {
              const value = q.options?.[key]
              if (!value) return null
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => updateAnswer({ selected: key })}
                  className={cn(
                    'flex items-start gap-2 rounded-lg px-3 py-2 text-sm w-full text-left transition-colors border',
                    ans.selected === key
                      ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 font-medium'
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
            <button
              type="button"
              onClick={() => updateAnswer({ selected: 'true' })}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-colors border',
                ans.selected === 'true'
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700'
                  : 'bg-muted/30 border-border/30 hover:bg-muted/50',
              )}
            >
              正确
            </button>
            <button
              type="button"
              onClick={() => updateAnswer({ selected: 'false' })}
              className={cn(
                'rounded-lg px-4 py-2 text-sm font-medium transition-colors border',
                ans.selected === 'false'
                  ? 'bg-red-500/10 border-red-500/40 text-red-700'
                  : 'bg-muted/30 border-border/30 hover:bg-muted/50',
              )}
            >
              错误
            </button>
          </div>
        )

      case 'fill_in_blank':
        return (
          <input
            type="text"
            value={ans.typed}
            onChange={(e) => updateAnswer({ typed: e.target.value })}
            placeholder="输入答案..."
            className="mt-2 w-full rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-emerald-500/50 focus:outline-none"
          />
        )

      case 'short_answer':
        return (
          <textarea
            value={ans.typed}
            onChange={(e) => updateAnswer({ typed: e.target.value })}
            placeholder="输入简要回答..."
            rows={3}
            className="mt-2 w-full rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-emerald-500/50 focus:outline-none resize-y"
          />
        )

      case 'written':
        return (
          <textarea
            value={ans.typed}
            onChange={(e) => updateAnswer({ typed: e.target.value })}
            placeholder="输入论述内容..."
            rows={5}
            className="mt-2 w-full rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-emerald-500/50 focus:outline-none resize-y"
          />
        )

      case 'coding':
        return (
          <textarea
            value={ans.typed}
            onChange={(e) => updateAnswer({ typed: e.target.value })}
            placeholder="输入代码..."
            rows={6}
            className="mt-2 w-full rounded-lg border border-border/40 bg-muted/20 px-3 py-2 text-sm text-foreground font-mono placeholder:text-muted-foreground focus:border-emerald-500/50 focus:outline-none resize-y"
          />
        )

      default:
        return null
    }
  }

  // ── 题面 + 题型标签 ──────────────────────────────────
  const typeLabel = QUIZ_TYPE_LABELS[q.question_type] || q.question_type
  const diffLabel = q.difficulty === 'easy' ? '简单' : q.difficulty === 'medium' ? '中等' : q.difficulty === 'hard' ? '困难' : ''

  // ── 格式化答案 ──────────────────────────────────────
  function formatAnswer(q: QuizQuestion): string {
    if (q.question_type === 'choice' && q.options && q.correct_answer) {
      const optionText = q.options[q.correct_answer]
      return optionText ? `${q.correct_answer}. ${optionText}` : q.correct_answer
    }
    if (q.question_type === 'concept') {
      return resolveConceptAnswer(q.correct_answer) === 'true' ? '正确' : '错误'
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
            <span>已完成</span>
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

        {/* 题号 chips */}
        <div className="mt-2 flex items-center gap-1.5 overflow-x-auto">
          {questions.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setIdx(i)}
              className={cn(
                'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-colors border',
                i === idx
                  ? 'bg-emerald-500/20 text-emerald-700 border-emerald-500/50 ring-1 ring-emerald-500/30'
                  : getChipStyle(i),
              )}
            >
              Q{i + 1}
            </button>
          ))}
        </div>
      </div>

      {/* ── 题面区域 ─────────────────────────────────── */}
      <div className="px-4 py-3">
        {/* 题型/难度标签 */}
        <div className="flex items-center gap-2 mb-2">
          <span className="inline-flex items-center rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-700">
            第 {idx + 1} 题
          </span>
          <span className="text-xs font-medium text-muted-foreground">{typeLabel}</span>
          {diffLabel && (
            <span className="text-xs text-muted-foreground/60">{diffLabel}</span>
          )}
          {q.topic && (
            <span className="text-xs text-muted-foreground/50 truncate ml-auto max-w-[200px]">{q.topic}</span>
          )}
        </div>

        {/* 题面 Markdown */}
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
              提交答案
            </button>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={handleRetry}
              className="rounded-lg border border-border/40 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted/30 transition-colors"
            >
              重答
            </button>
            <button
              type="button"
              onClick={handleAiJudge}
              disabled={judgment.isStreaming}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors flex items-center gap-1',
                judgment.isStreaming
                  ? 'opacity-50 border-border/30 text-muted-foreground'
                  : 'border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10',
              )}
            >
              {judgment.isStreaming ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" /> 判题中...
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" /> AI 判题
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
              <MessageSquarePlus className="h-3 w-3" /> 追问讲解
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
              {reviewOpen ? '收起答案回顾' : '展开答案回顾'}
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
                        ? 'bg-emerald-500/15 text-emerald-700'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    参考答案
                  </button>
                  <button
                    type="button"
                    onClick={() => setAnswerView('judgment')}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                      answerView === 'judgment'
                        ? 'bg-emerald-500/15 text-emerald-700'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    AI 判词
                  </button>
                </div>

                {/* 参考答案 tab */}
                {answerView === 'reference' && (
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-semibold text-emerald-600">答案：</span>
                      <span className="text-foreground">{formatAnswer(q)}</span>
                    </div>
                    {q.explanation && q.explanation !== 'N/A' && (
                      <div>
                        <span className="font-semibold text-muted-foreground">解析：</span>
                        <span className="text-foreground">
                          <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                            {q.explanation}
                          </ReactMarkdown>
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* AI 判词 tab */}
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
                        点击「AI 判题」按钮获取判词
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

        {/* ── 追问讲解 inline 区域 ────────────────────── */}
        {showFollowup && ans.submitted && (
          <div className="mt-3 border-t border-border/30 pt-3">
            <div className="text-xs font-medium text-blue-700 mb-2 flex items-center gap-1">
              <MessageSquarePlus className="h-3 w-3" /> 追问讲解
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
                placeholder="输入追问..."
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
