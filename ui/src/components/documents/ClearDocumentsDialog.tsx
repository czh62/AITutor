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
      // 清空文档（DELETE /documents）
      const clearResult = await clearDocuments()
      if (clearResult.status !== 'success') {
        throw new Error(clearResult.message || '清空文档失败')
      }
      // 清空 LLM 缓存（独立接口 POST /documents/clear_cache）
      if (clearCacheOption) {
        try {
          await clearCache()
          toast.success('缓存清空成功')
        } catch (cacheErr) {
          const message = errorMessage(cacheErr)
          console.warn(`清空缓存失败：${message}`)
        }
      }
      const verification = await onDocumentsCleared?.()
      const remainingCount = verification?.remainingCount ?? 0
      const processingCount = verification?.processingCount ?? 0
      if (remainingCount === 0) {
        toast.success('文档清空成功')
      } else if (processingCount > 0) {
        toast.warning('部分文档仍在处理中，暂时无法清除。')
      } else {
        toast.warning('清除请求已发送，但仍有文档残留，请稍后刷新确认。')
      }
      setOpen(false)
      setConfirm('')
      setClearCacheOption(false)
    } catch (err) {
      toast.error(`清空文档失败：${errorMessage(err)}`)
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
          <DialogTitle>清空文档</DialogTitle>
          <DialogDescription>此操作将从系统中移除所有文档</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <p className="font-medium text-red-600">
            警告：此操作将永久删除所有文档，无法恢复！
          </p>
          <p>确定要清空所有文档吗？请输入 yes 确认操作</p>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="输入 yes 确认"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={clearCacheOption}
              onChange={(e) => setClearCacheOption(e.target.checked)}
            />
            清空 LLM 缓存
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            取消
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
