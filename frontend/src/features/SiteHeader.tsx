import { GraduationCapIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SiteInfo } from '@/lib/constants'

type Tab = 'qa' | 'knowledge-graph'

interface SiteHeaderProps {
  currentTab: Tab
  onTabChange: (tab: Tab) => void
}

const TABS: { value: Tab; label: string }[] = [
  { value: 'qa', label: '知识问答' },
  { value: 'knowledge-graph', label: '知识图谱' }
]

export default function SiteHeader({ currentTab, onTabChange }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-50 flex h-10 w-full border-b border-border/40 bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex min-w-[200px] w-auto items-center">
        <a href="/" className="flex items-center gap-2">
          <GraduationCapIcon className="size-4 text-emerald-400" aria-hidden="true" />
          <span className="font-bold md:inline-block">{SiteInfo.name}</span>
        </a>
        <span className="mx-2 text-xs text-gray-500">|</span>
        <span className="text-sm font-medium">{SiteInfo.description}</span>
      </div>

      {/* 中间：选项块（文档 / 知识图谱） */}
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
                  ? 'bg-emerald-400 text-zinc-50'
                  : 'text-foreground/80 hover:bg-background/60'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 右侧占位，保持 tab 居中（主题切换已移除） */}
      <div className="min-w-[200px] w-auto" />
    </header>
  )
}
