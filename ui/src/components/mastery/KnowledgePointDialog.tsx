import { useEffect, useMemo, useState } from 'react'
import { BookOpenIcon, CheckCircle2Icon, Loader2Icon, PenLineIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { assessKnowledgePoint, studyKnowledgePoint } from '@/api/aitutor'
import type { MasteryKnowledgePoint, MasteryModule, MasteryStudyResponse } from '@/api/types'
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

interface KnowledgePointDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  docId: string
  module: MasteryModule | null
  knowledgePoint: MasteryKnowledgePoint | null
  onChanged: () => void
}

const TYPE_LABELS: Record<MasteryKnowledgePoint['knowledge_type'], string> = {
  memory: '记忆型',
  concept: '概念型',
  procedure: '程序型',
  design: '设计型'
}

export default function KnowledgePointDialog({
  open,
  onOpenChange,
  docId,
  module,
  knowledgePoint,
  onChanged
}: KnowledgePointDialogProps) {
  const [study, setStudy] = useState<MasteryStudyResponse | null>(null)
  const [loadingStudy, setLoadingStudy] = useState(false)
  const [quizOpen, setQuizOpen] = useState(false)
  const [feynmanOpen, setFeynmanOpen] = useState(false)
  const [explanation, setExplanation] = useState('')
  const [assessing, setAssessing] = useState(false)

  const canFeynman = useMemo(
    () => knowledgePoint?.knowledge_type === 'concept' || knowledgePoint?.knowledge_type === 'design',
    [knowledgePoint]
  )

  useEffect(() => {
    if (!open) {
      setStudy(null)
      setFeynmanOpen(false)
      setExplanation('')
    }
  }, [open])

  const handleStudy = async () => {
    if (!knowledgePoint) return
    setLoadingStudy(true)
    try {
      setStudy(await studyKnowledgePoint(docId, knowledgePoint.id))
    } catch (err) {
      toast.error(`加载学习内容失败：${errorMessage(err)}`)
    } finally {
      setLoadingStudy(false)
    }
  }

  const handleAssess = async (passed: boolean) => {
    if (!knowledgePoint) return
    setAssessing(true)
    try {
      await assessKnowledgePoint(docId, knowledgePoint.id, passed, explanation)
      toast.success(passed ? '已标记为理解' : '已加入继续学习')
      onChanged()
      onOpenChange(false)
    } catch (err) {
      toast.error(`提交费曼解释失败：${errorMessage(err)}`)
    } finally {
      setAssessing(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{knowledgePoint?.title || '知识点'}</DialogTitle>
            <DialogDescription>
              {module?.title || '学习模块'} · {knowledgePoint ? TYPE_LABELS[knowledgePoint.knowledge_type] : ''}
            </DialogDescription>
          </DialogHeader>

          {knowledgePoint && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-md bg-secondary p-2">
                  <p className="font-semibold text-foreground">{knowledgePoint.mastery_level}%</p>
                  <p className="text-muted-foreground">掌握度</p>
                </div>
                <div className="rounded-md bg-secondary p-2">
                  <p className="font-semibold text-foreground">{knowledgePoint.dependencies.length}</p>
                  <p className="text-muted-foreground">依赖</p>
                </div>
                <div className="rounded-md bg-secondary p-2">
                  <p className="font-semibold text-foreground">{knowledgePoint.status === 'mastered' ? '已掌握' : knowledgePoint.status === 'learning' ? '学习中' : '未学'}</p>
                  <p className="text-muted-foreground">状态</p>
                </div>
              </div>

              <div className="rounded-md border bg-background p-3">
                <p className="text-sm leading-6 text-foreground">{knowledgePoint.description}</p>
                {knowledgePoint.dependencies.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    依赖：{knowledgePoint.dependencies.join('、')}
                  </p>
                )}
              </div>

              {study && (
                <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                  <p className="text-sm font-medium text-foreground">学习说明</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {study.study_prompt}
                  </p>
                </div>
              )}

              {feynmanOpen && (
                <div className="rounded-md border p-3">
                  <p className="text-sm font-medium text-foreground">费曼解释</p>
                  <textarea
                    value={explanation}
                    onChange={(event) => setExplanation(event.target.value)}
                    className="mt-2 min-h-28 w-full resize-y rounded-md border border-input bg-background p-3 text-sm outline-none focus:border-primary"
                    placeholder="假设你在教一个刚接触这个主题的人，用自己的话解释它..."
                  />
                  <div className="mt-3 flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleAssess(false)} disabled={assessing}>
                      还不稳
                    </Button>
                    <Button size="sm" onClick={() => handleAssess(true)} disabled={assessing || !explanation.trim()}>
                      {assessing ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <CheckCircle2Icon className="h-4 w-4" />}
                      通过理解
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={handleStudy} disabled={loadingStudy}>
                  {loadingStudy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <BookOpenIcon className="h-4 w-4" />}
                  学习
                </Button>
                <Button variant="outline" onClick={() => setQuizOpen(true)}>
                  <PenLineIcon className="h-4 w-4" />
                  测验
                </Button>
                {canFeynman && (
                  <Button variant="outline" onClick={() => setFeynmanOpen((value) => !value)}>
                    <SparklesIcon className="h-4 w-4" />
                    费曼解释
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
        knowledgePoint={knowledgePoint}
        onChanged={onChanged}
      />
    </>
  )
}
