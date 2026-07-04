import { useState } from 'react'
import { AlertTriangleIcon, HammerIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { buildMasteryDocument } from '@/api/aitutor'
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

interface BuildStatusDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  document: MasteryDocumentSummary | null
  onChanged: () => void
}

export default function BuildStatusDialog({
  open,
  onOpenChange,
  document,
  onChanged
}: BuildStatusDialogProps) {
  const [retrying, setRetrying] = useState(false)

  const handleRetry = async () => {
    if (!document) return
    setRetrying(true)
    try {
      await buildMasteryDocument(document.doc_id)
      toast.success('已重新触发知识树构建')
      onChanged()
      onOpenChange(false)
    } catch (err) {
      toast.error(`重试构建失败：${errorMessage(err)}`)
    } finally {
      setRetrying(false)
    }
  }

  const canRetry = document?.rag_status === 'processed'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>知识树状态</DialogTitle>
          <DialogDescription>{document?.title || '当前文档'} 的 RAG 与知识树构建状态</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md bg-secondary p-3">
              <p className="text-xs text-muted-foreground">RAG 状态</p>
              <p className="mt-1 font-medium text-foreground">{document?.rag_status || '-'}</p>
            </div>
            <div className="rounded-md bg-secondary p-3">
              <p className="text-xs text-muted-foreground">知识树状态</p>
              <p className="mt-1 font-medium text-foreground">{document?.build_status || '-'}</p>
            </div>
          </div>

          {document?.build_error && (
            <div className="rounded-md border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
              <div className="flex items-start gap-2">
                <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{document.build_error}</p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button onClick={handleRetry} disabled={!canRetry || retrying}>
              {retrying ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <HammerIcon className="h-4 w-4" />}
              重试构建
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
