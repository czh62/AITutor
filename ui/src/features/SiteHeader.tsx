import { GraduationCapIcon } from 'lucide-react'
import { SiteInfo } from '@/lib/constants'
import { cn } from '@/lib/utils'

export type AppTab = 'qa' | 'knowledge-graph'

interface SiteHeaderProps {
  currentTab: AppTab
  onTabChange: (tab: AppTab) => void
}

const TABS: { value: AppTab; label: string }[] = [
  { value: 'qa', label: 'Knowledge Q&A' },
  { value: 'knowledge-graph', label: 'Knowledge Graph' }
]

export default function SiteHeader({ currentTab, onTabChange }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-50 flex h-10 w-full border-b border-border/40 bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex min-w-[220px] items-center">
        <a href="/" className="flex items-center gap-2">
          <GraduationCapIcon className="size-4 text-emerald-400" aria-hidden="true" />
          <span className="font-bold md:inline-block">{SiteInfo.name}</span>
        </a>
        <span className="mx-2 text-xs text-muted-foreground">|</span>
        <span className="text-sm font-medium text-foreground/80">{SiteInfo.description}</span>
      </div>

      <div className="flex h-10 flex-1 items-center justify-center">
        <div className="flex h-8 items-center gap-2 rounded-md bg-muted/40 p-1">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => onTabChange(tab.value)}
              className={cn(
                'cursor-pointer rounded-md px-2 py-1 text-sm font-medium transition-colors',
                currentTab === tab.value
                  ? 'bg-emerald-500 text-white'
                  : 'text-foreground/80 hover:bg-background/60'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-w-[220px]" />
    </header>
  )
}
