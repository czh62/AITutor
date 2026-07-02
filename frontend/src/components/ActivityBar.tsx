import { FileTextIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip'

interface ActivityBarProps {
  /** 侧边栏是否展开（高亮当前激活的功能） */
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

/**
 * 最左侧活动栏（IDE 风格）：垂直图标菜单，点击切换左侧边栏功能。
 * 当前仅"文档管理"一项，预留扩展位（见下方注释）。
 */
export default function ActivityBar({ sidebarOpen, onToggleSidebar }: ActivityBarProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border/40 bg-card/95 py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onToggleSidebar}
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-md transition-colors',
                sidebarOpen
                  ? 'bg-emerald-400/15 text-emerald-600'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
              aria-label="文档管理"
              aria-pressed={sidebarOpen}
            >
              <FileTextIcon className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">{sidebarOpen ? '收起侧边栏' : '文档管理'}</TooltipContent>
        </Tooltip>
        {/* 预留扩展位：后续可在此添加"问答历史""设置"等侧边栏功能图标 */}
      </aside>
    </TooltipProvider>
  )
}
