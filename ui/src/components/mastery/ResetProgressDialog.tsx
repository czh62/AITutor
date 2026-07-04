import { useState } from 'react'
import { Loader2Icon, RotateCcwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { resetMasteryDocument } from '@/api/aitutor'
import type { MasteryDocumentSummary } from '@/api/types'
import Button from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/Dialog'
import { errorMessage } from '@/lib/utils'

interface ResetProgressDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: MasteryDocumentSummary | null
  onChanged: () => void
}

export default function ResetProgressDialog({
  open,
  onOpenChange,
  document,
  onChanged
}: ResetProgressDialogProps) {
  const [busy, setBusy] = useState(false)

  const handleReset = async () => {
    if (!document) return
    setBusy(true)
    try {
      await resetMasteryDocument(document.doc_id)
      toast.success('学习进度已重置')
      onChanged()
      onOpenChange(false)
    } catch (err) {
      toast.error(`重置失败：${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>重置学习进度</DialogTitle>
          <DialogDescription>{document?.title || '当前文档'}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            重置后会保留知识树，但清空掌握度、答题记录、错误记录和复习计划。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleReset} disabled={busy}>
              {busy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <RotateCcwIcon className="h-4 w-4" />}
              确认重置
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
