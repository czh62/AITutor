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
      toast.success('Learning progress reset')
      onChanged()
      onOpenChange(false)
    } catch (err) {
      toast.error(`Reset failed: ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reset Learning Progress</DialogTitle>
          <DialogDescription>{document?.title || 'Current Document'}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <p className="rounded-md border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            Reset后会保留知识树，但ClearMastered度、答题记录、Incorrect记录和Review计划。
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleReset} disabled={busy}>
              {busy ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <RotateCcwIcon className="h-4 w-4" />}
              确认Reset
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
