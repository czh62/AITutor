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
      toast.success('文档删除流水线启动成功')
      setOpen(false)
      setConfirm('')
      await onDocumentsDeleted?.()
    } catch (err) {
      toast.error(`删除文档失败：${errorMessage(err)}`)
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
        <Button variant="outline" size="sm" title="删除选中的文档">
          <Trash2Icon /> 删除 ({selectedDocIds.length})
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>删除文档</DialogTitle>
          <DialogDescription>此操作将永久删除选中的文档</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="font-medium text-red-600">
            警告：此操作将永久删除选中的文档，无法恢复！
          </p>
          <p>确定要删除 {selectedDocIds.length} 个选中的文档吗？请输入 yes 确认操作</p>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="输入 yes 确认"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={deleteFile}
              onChange={(e) => setDeleteFile(e.target.checked)}
            />
            同时删除上传文件
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={deleteCache}
              onChange={(e) => setDeleteCache(e.target.checked)}
            />
            同时删除实体关系抽取 LLM 缓存
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={confirm !== 'yes' || busy}
          >
            {busy ? '删除中...' : '确定'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
