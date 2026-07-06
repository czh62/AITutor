import { useState } from 'react'
import Button from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/Dialog'
import { clearDocuments, clearCache } from '@/api/aitutor'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/utils'

interface ClearDocumentsVerification {
  remainingCount: number
  processingCount: number
  statusCounts: Record<string, number>
  masteryResetFailed?: boolean
}

interface ClearDocumentsDialogProps {
  /** 受控打开：传入则由外部控制开关（用于「更多」菜单触发）；不传则自管理。 */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onDocumentsCleared?: () => Promise<ClearDocumentsVerification>
}

export default function ClearDocumentsDialog({
  open: openProp,
  onOpenChange,
  onDocumentsCleared
}: ClearDocumentsDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp ?? internalOpen
  const setOpen = (o: boolean) => {
    if (onOpenChange) onOpenChange(o)
    else setInternalOpen(o)
    if (!o) {
      setConfirm('')
      setClearCacheOption(false)
    }
  }
  const [confirm, setConfirm] = useState('')
  const [clearCacheOption, setClearCacheOption] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleClear = async () => {
    if (confirm !== 'yes') return
    setBusy(true)
    try {
      // Clear Documents（DELETE /documents）
      const clearResult = await clearDocuments()
      if (clearResult.status !== 'success') {
        throw new Error(clearResult.message || 'Clear DocumentsFailed')
      }
      // Clear LLM Cache（独立接口 POST /documents/clear_cache）
      if (clearCacheOption) {
        try {
          await clearCache()
          toast.success('Cache cleared successfully')
        } catch (cacheErr) {
          const message = errorMessage(cacheErr)
          console.warn(`Clear缓存Failed：${message}`)
        }
      }
      const verification = await onDocumentsCleared?.()
      const remainingCount = verification?.remainingCount ?? 0
      const processingCount = verification?.processingCount ?? 0
      if (remainingCount === 0 && verification?.masteryResetFailed) {
        toast.warning('Documents were cleared, but knowledge point state failed to refresh. Please try again later.')
      } else if (remainingCount === 0) {
        toast.success('Documents cleared successfully')
      } else if (processingCount > 0) {
        toast.warning('Some documents are still processing and cannot be cleared yet.')
      } else {
        toast.warning('Clear request sent, but some documents remain. Please refresh and check again later.')
      }
      setOpen(false)
      setConfirm('')
      setClearCacheOption(false)
    } catch (err) {
      toast.error(`Failed to clear documents: ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear Documents</DialogTitle>
          <DialogDescription>This action will remove all documents from the system.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="font-medium text-red-600">
            Warning: this action will permanently delete all documents and cannot be undone.
          </p>
          <p>Clear all documents? Type yes to confirm.</p>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Type yes to confirm"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={clearCacheOption}
              onChange={(e) => setClearCacheOption(e.target.checked)}
            />
            Clear LLM Cache
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleClear}
            disabled={confirm !== 'yes' || busy}
          >
            {busy ? '正在清除...' : '确定'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
