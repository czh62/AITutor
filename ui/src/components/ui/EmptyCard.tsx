import { cn } from '@/lib/utils'

interface EmptyCardProps {
  title: string
  description?: string
  className?: string
}

export default function EmptyCard({ title, description, className }: EmptyCardProps) {
  return (
    <div
      className={cn(
        'flex h-full w-full flex-col items-center justify-center gap-2 rounded-md border border-dashed p-8 text-center',
        className
      )}
    >
      <p className="text-lg font-medium text-muted-foreground">{title}</p>
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </div>
  )
}
