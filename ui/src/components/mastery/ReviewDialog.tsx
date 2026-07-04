import { useMemo, useState } from 'react'
import { CheckCircle2Icon, ClockIcon, PenLineIcon } from 'lucide-react'
import { toast } from 'sonner'
import { assessKnowledgePoint } from '@/api/aitutor'
import type { MasteryDocumentDetail, MasteryKnowledgePoint, MasteryModule } from '@/api/types'
import Button from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/Dialog'
import QuizDialog from '@/components/mastery/QuizDialog'
import { errorMessage } from '@/lib/utils'

interface ReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  docId: string
  detail: MasteryDocumentDetail | null
  onChanged: () => void
}

function findPoint(detail: MasteryDocumentDetail | null): { point: MasteryKnowledgePoint; module: MasteryModule } | null {
  if (!detail) return null
  const duePoint = detail.modules
    .flatMap((module) => module.knowledge_points.map((point) => ({ point, module })))
    .find(({ point }) => point.review_due && new Date(point.review_due).getTime() <= Date.now())
  if (duePoint) return duePoint
  if (detail.next_step.action === 'review' && detail.next_step.knowledge_point_id) {
    for (const module of detail.modules) {
      const point = module.knowledge_points.find((item) => item.id === detail.next_step.knowledge_point_id)
      if (point) return { point, module }
    }
  }
  return null
}

export default function ReviewDialog({
  open,
  onOpenChange,
  docId,
  detail,
  onChanged
}: ReviewDialogProps) {
  const target = useMemo(() => findPoint(detail), [detail])
  const [quizOpen, setQuizOpen] = useState(false)
  const [assessing, setAssessing] = useState(false)
  const isQualitative = target?.point.knowledge_type === 'concept' || target?.point.knowledge_type === 'design'

  const handleAssess = async (passed: boolean) => {
    if (!target) return
    setAssessing(true)
    try {
      await assessKnowledgePoint(docId, target.point.id, passed, '复习自评')
      toast.success(passed ? '复习通过' : '已保留为待学习')
      onChanged()
      onOpenChange(false)
    } catch (err) {
      toast.error(`提交复习失败：${errorMessage(err)}`)
    } finally {
      setAssessing(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>复习</DialogTitle>
            <DialogDescription>优先处理到期知识点，巩固后再继续新内容。</DialogDescription>
          </DialogHeader>

          {!target ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center">
              <ClockIcon className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">当前没有到期复习</p>
              <p className="mt-1 text-xs text-muted-foreground">继续学习或测验后，系统会生成新的复习节奏。</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-md border bg-secondary/60 p-3">
                <p className="text-sm font-semibold text-foreground">{target.point.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{target.module.title}</p>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{target.point.description}</p>
              </div>

              <div className="flex justify-end gap-2">
                {isQualitative ? (
                  <>
                    <Button variant="outline" onClick={() => handleAssess(false)} disabled={assessing}>
                      还需复习
                    </Button>
                    <Button onClick={() => handleAssess(true)} disabled={assessing}>
                      <CheckCircle2Icon className="h-4 w-4" />
                      已理解
                    </Button>
                  </>
                ) : (
                  <Button onClick={() => setQuizOpen(true)}>
                    <PenLineIcon className="h-4 w-4" />
                    开始复习题
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <QuizDialog
        open={quizOpen}
        onOpenChange={setQuizOpen}
        docId={docId}
        knowledgePoint={target?.point ?? null}
        onChanged={onChanged}
      />
    </>
  )
}
