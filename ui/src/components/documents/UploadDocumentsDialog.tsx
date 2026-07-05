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

const DOCUMENT_UPLOAD_ACCEPT = {
  'text/plain': ['.txt'],
  'text/markdown': ['.md'],
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
}
const DOCUMENT_UPLOAD_EXTENSIONS = ['.txt', '.md', '.pdf', '.docx']
const DOCUMENT_TYPE_ERROR = '仅Supported:  TXT、MD、PDF、DOCX 文件'
const ACCEPTED_UPLOAD_STATUSES = new Set(['success', 'partial_success'])

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
      if (msg.includes('file-invalid-type')) msg = DOCUMENT_TYPE_ERROR
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
      const toastId = toast.loading('Uploading files...')
      let hasAcceptedUpload = false
      let hasFailure = false
      let batchTriggered = false

      // 按File Name排序后顺序Upload
      const sorted = [...files].sort((a, b) =>
        new Intl.Collator(['zh-CN', 'en'], { numeric: true }).compare(a.name, b.name)
      )

      for (const file of sorted) {
        try {
          setProgresses((p) => ({ ...p, [file.name]: 0 }))
          const result = await uploadDocument(file, (pct) =>
            setProgresses((p) => ({ ...p, [file.name]: pct }))
          )
          if (!ACCEPTED_UPLOAD_STATUSES.has(result.status)) {
            hasFailure = true
            setFileErrors((p) => ({ ...p, [file.name]: result.message }))
          } else {
            hasAcceptedUpload = true
            if (!batchTriggered) {
              batchTriggered = true
              onUploadBatchAccepted?.()
            }
          }
        } catch (err) {
          hasFailure = true
          setFileErrors((p) => ({ ...p, [file.name]: errorMessage(err) }))
        }
      }

      if (hasFailure) {
        toast.error('Some files failed to upload', { id: toastId })
      } else {
        toast.success('Upload successful. Processing in the background.', { id: toastId, duration: 2000 })
      }
      setIsUploading(false)
      if (hasAcceptedUpload && !hasFailure) {
        setProgresses({})
        setFileErrors({})
        setOpen(false)
        void onDocumentsUploaded?.().catch(() => undefined)
      }
    },
    [onDocumentsUploaded, onUploadBatchAccepted]
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
        <Button variant="default" size="sm" title="Upload Documents">
          <UploadIcon /> Upload
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Upload Documents</DialogTitle>
          <DialogDescription>Drag files here or click to browse.</DialogDescription>
        </DialogHeader>
        <FileUploader
          maxSize={200 * 1024 * 1024}
          description="仅Supported:  TXT、MD、PDF、DOCX 文件，单文件最大 200MB"
          accept={DOCUMENT_UPLOAD_ACCEPT}
          extensions={DOCUMENT_UPLOAD_EXTENSIONS}
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
