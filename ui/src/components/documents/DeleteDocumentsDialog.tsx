import { useState } from 'react'
import Button from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/Dialog'
import { deleteDocuments } from '@/api/aitutor'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/utils'
import { Trash2Icon } from 'lucide-react'

interface DeleteDocumentsDialogProps {
  selectedDocIds: string[]
  onDocumentsDeleted?: () => Promise<void>
}

export default function DeleteDocumentsDialog({
  selectedDocIds,
  onDocumentsDeleted
}: DeleteDocumentsDialogProps) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [deleteFile, setDeleteFile] = useState(true)
  const [deleteCache, setDeleteCache] = useState(false)
  const [busy, setBusy] = useState(false)

  const handleDelete = async () => {
    if (confirm !== 'yes') return
    setBusy(true)
    try {
      await deleteDocuments(selectedDocIds, deleteFile, deleteCache)
      toast.success('Document delete pipeline started')
      setOpen(false)
      setConfirm('')
      await onDocumentsDeleted?.()
    } catch (err) {
      toast.error(`Failed to delete documents: ${errorMessage(err)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) setConfirm('')
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" title="Delete selected documents">
          <Trash2Icon /> Delete ({selectedDocIds.length})
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Documents</DialogTitle>
          <DialogDescription>This action will permanently delete the selected documents.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="font-medium text-red-600">
            警告：This action will permanently delete the selected documents.，无法恢复！
          </p>
          <p>Delete {selectedDocIds.length} selected documents? Type yes to confirm.</p>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Type yes to confirm"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={deleteFile}
              onChange={(e) => setDeleteFile(e.target.checked)}
            />
            同时DeleteUpload文件
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={deleteCache}
              onChange={(e) => setDeleteCache(e.target.checked)}
            />
            同时Delete实体Relations抽取 LLM 缓存
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={confirm !== 'yes' || busy}
          >
            {busy ? 'Delete中...' : '确定'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
