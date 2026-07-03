import { FileTextIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'

interface ActivityBarProps {
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

export default function ActivityBar({ sidebarOpen, onToggleSidebar }: ActivityBarProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border/40 bg-secondary py-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleSidebar}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150',
                sidebarOpen
                  ? 'bg-accent text-foreground shadow-sm'
                  : 'text-foreground/85 hover:bg-background/60 hover:text-foreground'
              )}
              aria-label="文档管理"
              aria-pressed={sidebarOpen}
            >
              <FileTextIcon className="h-[18px] w-[18px]" strokeWidth={sidebarOpen ? 2 : 1.6} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{sidebarOpen ? '收起侧边栏' : '文档管理'}</TooltipContent>
        </Tooltip>
      </aside>
    </TooltipProvider>
  )
}
