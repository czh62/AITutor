import { useCallback, useState } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { UploadCloudIcon, XIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { supportedFileTypes } from '@/lib/constants'

interface FileUploaderProps {
  maxFileCount?: number
  maxSize: number
  description: string
  onUpload: (files: File[]) => void
  onReject: (rejected: FileRejection[]) => void
  progresses: Record<string, number>
  fileErrors: Record<string, string>
  disabled?: boolean
}

const ALL_EXTENSIONS = Object.values(supportedFileTypes).flat()

export default function FileUploader({
  maxSize,
  description,
  onUpload,
  onReject,
  progresses,
  fileErrors,
  disabled
}: FileUploaderProps) {
  const [queued, setQueued] = useState<File[]>([])

  const onDrop = useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      if (rejected.length > 0) onReject(rejected)
      if (accepted.length > 0) {
        setQueued((prev) => [...prev, ...accepted])
        onUpload(accepted)
      }
    },
    [onUpload, onReject]
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxSize,
    accept: Object.entries(supportedFileTypes).reduce(
      (acc, [mime, exts]) => {
        acc[mime] = exts
        return acc
      },
      {} as Record<string, string[]>
    ),
    disabled,
    multiple: true
  })

  const removeFile = (name: string) => {
    setQueued((prev) => prev.filter((f) => f.name !== name))
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        {...getRootProps()}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border-2 border-dashed border-input p-8 text-center transition-colors',
          isDragActive ? 'border-primary bg-accent' : 'hover:border-primary/50',
          disabled && 'pointer-events-none opacity-50'
        )}
      >
        <input {...getInputProps()} />
        <UploadCloudIcon className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">
          {isDragActive ? '释放即可上传' : '拖放文件到此处，或点击选择文件'}
        </p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>

      {queued.length > 0 && (
        <ul className="flex flex-col gap-2">
          {queued.map((file) => {
            const progress = progresses[file.name] ?? 0
            const error = fileErrors[file.name]
            const done = progress >= 100 && !error
            return (
              <li
                key={file.name}
                className="flex items-center gap-3 rounded-md border p-2 text-sm"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFile(file.name)}
                      className="ml-2 rounded-sm opacity-60 hover:opacity-100"
                      aria-label="移除文件"
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {error ? (
                    <p className="text-xs text-red-500">{error}</p>
                  ) : (
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          done ? 'bg-green-500' : 'bg-primary'
                        )}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {error ? '失败' : done ? '完成' : `${progress}%`}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">支持扩展名：{ALL_EXTENSIONS.slice(0, 12).join(', ')}…</p>
    </div>
  )
}
