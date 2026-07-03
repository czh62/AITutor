import { useState, useCallback } from 'react'
import Button from '@/components/ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/Dialog'
import FileUploader from '@/components/documents/FileUploader'
import type { FileRejection } from 'react-dropzone'
import { toast } from 'sonner'
import { errorMessage } from '@/lib/utils'
import { uploadDocument } from '@/api/aitutor'
import { UploadIcon } from 'lucide-react'

interface UploadDocumentsDialogProps {
  onDocumentsUploaded?: () => Promise<void>
  onUploadBatchAccepted?: () => void
}

export default function UploadDocumentsDialog({
  onDocumentsUploaded,
  onUploadBatchAccepted
}: UploadDocumentsDialogProps) {
  const [open, setOpen] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [progresses, setProgresses] = useState<Record<string, number>>({})
  const [fileErrors, setFileErrors] = useState<Record<string, string>>({})

  const handleRejected = useCallback((rejected: FileRejection[]) => {
    rejected.forEach(({ file, errors }) => {
      let msg = errors[0]?.message || `文件 ${file.name} 被拒绝`
      if (msg.includes('file-invalid-type')) msg = '不支持的文件类型'
      if (msg.includes('file-too-large')) msg = '文件过大'
      setProgresses((p) => ({ ...p, [file.name]: 100 }))
      setFileErrors((p) => ({ ...p, [file.name]: msg }))
    })
  }, [])

  const handleUpload = useCallback(
    async (files: File[]) => {
      setIsUploading(true)
      setFileErrors((prev) => {
        const next = { ...prev }
        files.forEach((f) => delete next[f.name])
        return next
      })
      const toastId = toast.loading('正在上传文件...')
      let hasSuccess = false
      let batchTriggered = false

      // 按文件名排序后顺序上传
      const sorted = [...files].sort((a, b) =>
        new Intl.Collator(['zh-CN', 'en'], { numeric: true }).compare(a.name, b.name)
      )

      for (const file of sorted) {
        try {
          setProgresses((p) => ({ ...p, [file.name]: 0 }))
          const result = await uploadDocument(file, (pct) =>
            setProgresses((p) => ({ ...p, [file.name]: pct }))
          )
          if (result.status !== 'success') {
            setFileErrors((p) => ({ ...p, [file.name]: result.message }))
          } else {
            hasSuccess = true
            if (!batchTriggered) {
              batchTriggered = true
              onUploadBatchAccepted?.()
            }
          }
        } catch (err) {
          setFileErrors((p) => ({ ...p, [file.name]: errorMessage(err) }))
        }
      }

      if (Object.keys(fileErrors).length > 0 && !hasSuccess) {
        toast.error('部分文件上传失败', { id: toastId })
      } else {
        toast.success('文件上传完成', { id: toastId })
      }
      if (hasSuccess) {
        await onDocumentsUploaded?.().catch(() => undefined)
      }
      setIsUploading(false)
    },
    [onDocumentsUploaded, onUploadBatchAccepted, fileErrors]
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (isUploading) return
        if (!o) {
          setProgresses({})
          setFileErrors({})
        }
        setOpen(o)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="default" size="sm" title="上传文档">
          <UploadIcon /> 上传
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>上传文档</DialogTitle>
          <DialogDescription>拖拽文件到此处或点击浏览</DialogDescription>
        </DialogHeader>
        <FileUploader
          maxSize={200 * 1024 * 1024}
          description="支持 TXT, MD, PDF, DOCX, PPTX, XLSX, JSON, CSV, HTML, EPUB 等，单文件最大 200MB"
          onUpload={handleUpload}
          onReject={handleRejected}
          progresses={progresses}
          fileErrors={fileErrors}
          disabled={isUploading}
        />
      </DialogContent>
    </Dialog>
  )
}
