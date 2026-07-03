import { useState } from 'react'
import { MessageCircleQuestionIcon, SendIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AskUserPayload } from '@/api/types'

/**
 * ask_user 交互卡片（对齐 DeepTutor AskUserOptions / InteractiveAskUserCard）。
 *
 * AgentLoop 调用 ask_user 工具暂停时，后端发射 wait_for_input 事件，
 * 前端把 AskUserPayload 渲染为问题卡片：
 * - 上下文说明（为何提问）
 * - 每个问题：文本 + 可选选项（单选 radio），无选项则纯文本输入框
 * - 「回复」按钮 → 收集所有问题答案回调 onRespond
 *
 * 答案以 { questionId: answer } 形式回传后端 /query/resume。
 */
interface AskUserCardProps {
  payload: AskUserPayload
  onRespond: (answers: Record<string, string>) => void
  disabled?: boolean
}

export default function AskUserCard({ payload, onRespond, disabled }: AskUserCardProps) {
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const setAnswer = (qid: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }))
  }

  const allAnswered = payload.questions.every((q) => {
    const a = (answers[q.id] || '').trim()
    return a.length > 0
  })

  const handleRespond = () => {
    if (!allAnswered || disabled) return
    onRespond(answers)
  }

  return (
    <div
      className={cn(
        'my-3 rounded-2xl border border-emerald-200/80 bg-emerald-50/60',
        'shadow-sm overflow-hidden'
      )}
    >
      {/* 头部 */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-emerald-100/50 border-b border-emerald-200/60">
        <MessageCircleQuestionIcon className="w-4 h-4 text-emerald-600" />
        <span className="text-sm font-medium text-emerald-800">AI 想向你确认</span>
      </div>

      {/* 上下文说明 */}
      {payload.context && (
        <div className="px-4 pt-3 text-sm text-stone-600 whitespace-pre-wrap">
          {payload.context}
        </div>
      )}

      {/* 问题列表 */}
      <div className="px-4 py-3 space-y-4">
        {payload.questions.map((q, idx) => (
          <div key={q.id} className="space-y-2">
            <div className="text-sm font-medium text-stone-800">
              {payload.questions.length > 1 && (
                <span className="text-emerald-600 mr-1.5">Q{idx + 1}.</span>
              )}
              {q.text}
            </div>

            {q.options && q.options.length > 0 ? (
              // 选项模式：单选 radio
              <div className="flex flex-col gap-1.5">
                {q.options.map((opt, oi) => {
                  const checked = answers[q.id] === opt
                  return (
                    <label
                      key={oi}
                      className={cn(
                        'flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer text-sm',
                        'border transition-colors',
                        checked
                          ? 'border-emerald-400 bg-emerald-100/70 text-emerald-900'
                          : 'border-stone-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/40'
                      )}
                    >
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        className="accent-emerald-600"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => setAnswer(q.id, opt)}
                      />
                      <span>{opt}</span>
                    </label>
                  )
                })}
                {/* 选项模式下也允许自由输入（Other） */}
                <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm border border-stone-200 bg-white">
                  <input
                    type="radio"
                    name={`q-${q.id}`}
                    className="accent-emerald-600"
                    checked={!!answers[q.id] && !q.options.includes(answers[q.id])}
                    disabled={disabled}
                    onChange={() => setAnswer(q.id, '')}
                  />
                  <span className="text-stone-500">其他：</span>
                  <input
                    type="text"
                    className="flex-1 bg-transparent outline-none text-stone-800 placeholder:text-stone-400"
                    placeholder="自定义回答"
                    disabled={disabled}
                    value={
                      !!answers[q.id] && !q.options.includes(answers[q.id]) ? answers[q.id] : ''
                    }
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                  />
                </label>
              </div>
            ) : (
              // 纯文本输入模式
              <textarea
                className={cn(
                  'w-full px-3 py-2 rounded-lg text-sm bg-white resize-none',
                  'border border-stone-200 outline-none transition-colors',
                  'focus:border-emerald-400 focus:ring-1 focus:ring-emerald-200',
                  'placeholder:text-stone-400'
                )}
                rows={2}
                placeholder="输入你的回答…"
                disabled={disabled}
                value={answers[q.id] || ''}
                onChange={(e) => setAnswer(q.id, e.target.value)}
              />
            )}
          </div>
        ))}
      </div>

      {/* 回复按钮 */}
      <div className="px-4 pb-3 flex justify-end">
        <button
          type="button"
          onClick={handleRespond}
          disabled={!allAnswered || disabled}
          className={cn(
            'inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-all',
            allAnswered && !disabled
              ? 'bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm'
              : 'bg-stone-200 text-stone-400 cursor-not-allowed'
          )}
        >
          <SendIcon className="w-3.5 h-3.5" />
          回复
        </button>
      </div>
    </div>
  )
}
