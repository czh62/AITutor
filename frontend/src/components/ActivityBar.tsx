import { FileTextIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip'

interface ActivityBarProps {
  /** 侧边栏是否展开（高亮当前激活的功能） */
  sidebarOpen: boolean
  onToggleSidebar: () => void
}

/**
 * 最左侧活动栏（IDE 风格，对齐 DeepTutor 折叠态侧栏）：
 * bg-secondary 暖底 + 文档管理图标按钮。
 * 按钮 rounded-xl，激活态 bg-accent + shadow-sm（DeepT 导航图标按钮风格），
 * 过渡 transition-all duration-150（DeepT 全项目无 active:scale，仅靠背景色变化反馈）。
 */
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
        {/* 预留扩展位：后续可在此添加"问答历史""设置"等侧边栏功能图标 */}
      </aside>
    </TooltipProvider>
  )
}
