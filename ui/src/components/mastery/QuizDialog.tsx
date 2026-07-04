import { useEffect, useState } from 'react'
import { Loader2Icon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'
import { createMasteryQuiz, gradeMasteryAnswer } from '@/api/aitutor'
import type { MasteryGradeResponse, MasteryKnowledgePoint, MasteryQuizResponse } from '@/api/types'
import Button from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/Dialog'
import { cn, errorMessage } from '@/lib/utils'

interface QuizDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  docId: string
  knowledgePoint: MasteryKnowledgePoint | null
  onChanged: () => void
}

export default function QuizDialog({
  open,
  onOpenChange,
  docId,
  knowledgePoint,
  onChanged
}: QuizDialogProps) {
  const [quiz, setQuiz] = useState<MasteryQuizResponse | null>(null)
  const [answer, setAnswer] = useState('')
  const [result, setResult] = useState<MasteryGradeResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open || !knowledgePoint) return
    setAnswer('')
    setResult(null)
    setQuiz(null)
    setLoading(true)
    createMasteryQuiz(docId, knowledgePoint.id)
      .then(setQuiz)
      .catch((err) => toast.error(`生成测验失败：${errorMessage(err)}`))
      .finally(() => setLoading(false))
  }, [docId, knowledgePoint, open])

  const handleSubmit = async () => {
    if (!answer.trim()) {
      toast.error('请先填写答案')
      return
    }
    setSubmitting(true)
    try {
      const graded = await gradeMasteryAnswer(docId, answer)
      setResult(graded)
      onChanged()
    } catch (err) {
      toast.error(`提交答案失败：${errorMessage(err)}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{knowledgePoint ? `测验：${knowledgePoint.title}` : '测验'}</DialogTitle>
          <DialogDescription>用自己的语言回答，系统会据此更新掌握度和下一步学习建议。</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2Icon className="h-4 w-4 animate-spin" />
            正在生成题目
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border bg-secondary/60 p-3">
              <p className="text-sm font-medium text-foreground">{quiz?.question || quiz?.prompt || '暂无题目'}</p>
              {quiz?.options && quiz.options.length > 0 && (
                <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                  {quiz.options.map((option) => (
                    <div key={option}>{option}</div>
                  ))}
                </div>
              )}
            </div>

            <textarea
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              className="min-h-32 w-full resize-y rounded-md border border-input bg-background p-3 text-sm outline-none focus:border-primary"
              placeholder="写下你的答案..."
              disabled={submitting || !!result}
            />

            {result && (
              <div
                className={cn(
                  'rounded-md border p-3 text-sm',
                  result.passed
                    ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                )}
              >
                <p className="font-medium">{result.passed ? '回答通过' : '还需要补强'}</p>
                <p className="mt-1">{result.feedback}</p>
                <p className="mt-1">掌握度：{result.score}%</p>
                {result.next_step.reason && <p className="mt-1">下一步：{result.next_step.reason}</p>}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                关闭
              </Button>
              <Button onClick={handleSubmit} disabled={submitting || !!result}>
                {submitting ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SendIcon className="h-4 w-4" />}
                提交
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
