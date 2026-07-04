import { BrainCircuitIcon, FileTextIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'

export type SidebarMode = 'documents' | 'mastery'

interface ActivityBarProps {
  sidebarOpen: boolean
  activeMode: SidebarMode
  onModeChange: (mode: SidebarMode) => void
  onToggleSidebar: () => void
}

const items: Array<{
  mode: SidebarMode
  label: string
  icon: typeof FileTextIcon
}> = [
  { mode: 'documents', label: '文档管理', icon: FileTextIcon },
  { mode: 'mastery', label: '知识点', icon: BrainCircuitIcon }
]

export default function ActivityBar({
  sidebarOpen,
  activeMode,
  onModeChange,
  onToggleSidebar
}: ActivityBarProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border/40 bg-secondary py-3">
        {items.map((item) => {
          const Icon = item.icon
          const active = sidebarOpen && activeMode === item.mode
          return (
            <Tooltip key={item.mode}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => {
                    if (active) {
                      onToggleSidebar()
                      return
                    }
                    onModeChange(item.mode)
                  }}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-md transition-all duration-150',
                    active
                      ? 'bg-accent text-foreground shadow-sm'
                      : 'text-foreground/85 hover:bg-background/60 hover:text-foreground'
                  )}
                  aria-label={item.label}
                  aria-pressed={active}
                >
                  <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2 : 1.6} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {active ? `收起${item.label}` : item.label}
              </TooltipContent>
            </Tooltip>
          )
        })}
      </aside>
    </TooltipProvider>
  )
}
