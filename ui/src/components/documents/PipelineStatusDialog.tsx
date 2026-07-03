import { useState, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { GripHorizontalIcon } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription
} from '@/components/ui/Dialog'
import Button from '@/components/ui/Button'
import { getPipelineStatus, cancelPipeline } from '@/api/aitutor'
import type { PipelineStatus } from '@/api/types'
import { errorMessage } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { useDraggable } from '@/hooks/useDraggable'

interface PipelineStatusDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export default function PipelineStatusDialog({ open, onOpenChange }: PipelineStatusDialogProps) {
  const [status, setStatus] = useState<PipelineStatus | null>(null)
  const [isUserScrolled, setIsUserScrolled] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const historyRef = useRef<HTMLDivElement>(null)
  const { pos, reset, dragHandleProps } = useDraggable()

  // 弹窗关闭时复位 UI 状态（拖动位置、取消确认）
  useEffect(() => {
    if (!open) {
      setShowCancelConfirm(false)
      reset()
    }
  }, [open, reset])

  // 历史日志自动滚动到底部（用户手动上滚后停止跟随）
  useEffect(() => {
    const container = historyRef.current
    if (!container || isUserScrolled) return
    container.scrollTop = container.scrollHeight
  }, [status?.history_messages, isUserScrolled])

  const handleScroll = () => {
    const container = historyRef.current
    if (!container) return
    const isAtBottom =
      Math.abs(container.scrollHeight - container.scrollTop - container.clientHeight) < 1
    setIsUserScrolled(!isAtBottom)
  }

  // 打开时每 2s 刷新流水线状态
  useEffect(() => {
    if (!open) return
    const fetchStatus = async () => {
      try {
        const data = await getPipelineStatus()
        setStatus(data)
      } catch (err) {
        toast.error(`获取流水线状态失败：${errorMessage(err)}`)
      }
    }
    fetchStatus()
    const interval = setInterval(fetchStatus, 2000)
    return () => clearInterval(interval)
  }, [open])

  const handleConfirmCancel = async () => {
    setShowCancelConfirm(false)
    try {
      const result = await cancelPipeline()
      if (result.status === 'cancellation_requested') {
        toast.success('已请求取消流水线')
      } else if (result.status === 'not_busy') {
        toast.info('流水线当前空闲，无需取消')
      }
    } catch (err) {
      toast.error(`取消流水线失败：${errorMessage(err)}`)
    }
  }

  const canCancel = status?.busy === true && !status?.cancellation_requested

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-draggable
        className={cn(
          'sm:max-w-[800px] transition-none',
          // 未拖动时居中默认定位；拖动后改用绝对坐标（覆盖 Radix 默认 translate）
          pos === null
            ? 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2'
            : '!translate-x-0 !translate-y-0'
        )}
        style={
          pos === null
            ? undefined
            : { left: pos.x, top: pos.y, transform: 'none' }
        }
      >
        <DialogDescription className="sr-only">
          {status?.job_name
            ? `任务名: ${status.job_name}, 进度: ${status.cur_batch}/${status.batchs}`
            : '当前无活动任务'}
        </DialogDescription>

        {/* 拖动手柄 + 标题 */}
        <DialogHeader className="flex flex-row items-center" {...dragHandleProps}>
          <GripHorizontalIcon className="mr-2 h-5 w-5 shrink-0 text-muted-foreground" />
          <DialogTitle className="flex-1 select-none">流水线状态</DialogTitle>
        </DialogHeader>

        {/* 状态内容 */}
        <div className="space-y-4 pt-4">
          {/* 状态指示灯 + 取消按钮 */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">忙:</div>
                <div
                  className={cn(
                    'h-2 w-2 rounded-full',
                    status?.busy ? 'bg-green-500' : 'bg-gray-300'
                  )}
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm font-medium">请求等待:</div>
                <div
                  className={cn(
                    'h-2 w-2 rounded-full',
                    status?.request_pending ? 'bg-green-500' : 'bg-gray-300'
                  )}
                />
              </div>
              {status?.cancellation_requested && (
                <div className="flex items-center gap-2">
                  <div className="text-sm font-medium">取消中:</div>
                  <div className="h-2 w-2 rounded-full bg-red-500" />
                </div>
              )}
            </div>

            {status?.busy && (
              <Button
                variant="destructive"
                size="sm"
                disabled={!canCancel}
                onClick={() => setShowCancelConfirm(true)}
                title={
                  status?.cancellation_requested ? '取消进行中…' : '取消当前流水线任务'
                }
              >
                取消
              </Button>
            )}
          </div>

          {/* 任务信息卡 */}
          <div className="space-y-2 rounded-md border p-3">
            <div className="text-sm">
              任务名: {status?.job_name || '-'}
            </div>
            <div className="flex justify-between text-sm">
              <span>
                开始时间:{' '}
                {status?.job_start
                  ? new Date(status.job_start).toLocaleString(undefined, {
                      year: 'numeric',
                      month: 'numeric',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: 'numeric',
                      second: 'numeric'
                    })
                  : '-'}
              </span>
              <span>
                进度:{' '}
                {status ? `${status.cur_batch}/${status.batchs} 批` : '-'}
              </span>
            </div>
          </div>

          {/* 历史消息日志区 */}
          <div className="space-y-2">
            <div className="text-sm font-medium">流水线消息:</div>
            <div
              ref={historyRef}
              onScroll={handleScroll}
              className="min-h-[7.5em] max-h-[40vh] overflow-y-auto overflow-x-hidden rounded-md bg-zinc-800 p-3 font-mono text-xs text-zinc-100"
            >
              {status?.history_messages?.length ? (
                status.history_messages.map((msg, idx) => (
                  <div key={idx} className="break-all whitespace-pre-wrap">
                    {msg}
                  </div>
                ))
              ) : (
                '-'
              )}
            </div>
          </div>
        </div>
      </DialogContent>

      {/* 取消二次确认 */}
      <Dialog open={showCancelConfirm} onOpenChange={setShowCancelConfirm}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>取消流水线</DialogTitle>
            <DialogDescription>
              确定要取消当前流水线任务吗？正在处理的文档将回到等待状态。
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex justify-end gap-3">
            <Button variant="outline" onClick={() => setShowCancelConfirm(false)}>
              取消
            </Button>
            <Button variant="destructive" onClick={handleConfirmCancel}>
              确认取消
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}
