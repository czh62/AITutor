import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import Button from '@/components/ui/Button'

interface PaginationControlsProps {
  currentPage: number
  totalPages: number
  pageSize: number
  totalCount: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
  isLoading?: boolean
  compact?: boolean
}

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

export default function PaginationControls({
  currentPage,
  totalPages,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  isLoading
}: PaginationControlsProps) {
  const start = totalPages === 0 ? 0 : (currentPage - 1) * pageSize + 1
  const end = Math.min(currentPage * pageSize, totalCount)

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>
        {totalPages === 0 ? '0' : start}-{end} / 共 {totalCount}
      </span>
      <select
        value={pageSize}
        onChange={(e) => onPageSizeChange(Number(e.target.value))}
        disabled={isLoading}
        className="h-8 rounded-md border border-input bg-background px-1 text-xs"
      >
        {PAGE_SIZE_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s} / 页
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage <= 1 || isLoading}
      >
        <ChevronLeftIcon className="h-4 w-4" />
      </Button>
      <span>
        {currentPage} / {Math.max(totalPages, 1)}
      </span>
      <Button
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage >= totalPages || isLoading}
      >
        <ChevronRightIcon className="h-4 w-4" />
      </Button>
    </div>
  )
}
