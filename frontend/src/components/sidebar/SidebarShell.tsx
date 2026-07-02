import { useState } from 'react'
import {
  GraduationCap,
  MessageSquare,
  Share2,
  FileText,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronDown,
  Trash2,
  Settings,
  type LucideIcon
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { SiteInfo } from '@/lib/constants'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/Tooltip'

type Tab = 'qa' | 'knowledge-graph'

interface SidebarShellProps {
  /** 当前激活的主 tab */
  tab: Tab
  onTabChange: (tab: Tab) => void
  /** QA 层内文档面板是否展开 */
  docPanelOpen: boolean
  onToggleDoc: () => void
  /** sidebar 折叠态（220px ↔ 60px） */
  collapsed: boolean
  onToggleCollapse: () => void
  /** Recents 当前会话标题 */
  sessionTitle: string
  onClearSession: () => void
  canClear: boolean
}

interface NavItem {
  key: string
  label: string
  icon: LucideIcon
  active: boolean
  onClick: () => void
}

/**
 * DeepTutor 风格的左侧边栏外壳（移植自 DeepTutor components/sidebar/SidebarShell.tsx）。
 * 适配当前项目：主导航是 tab 切换而非路由；Recents 是单会话 + 清空。
 * 样式用 shadcn CSS 变量（与 index.css 同名），自动适配主题。
 */
export default function SidebarShell({
  tab,
  onTabChange,
  docPanelOpen,
  onToggleDoc,
  collapsed,
  onToggleCollapse,
  sessionTitle,
  onClearSession,
  canClear
}: SidebarShellProps) {
  const [recentsCollapsed, setRecentsCollapsed] = useState(false)

  const primaryNav: NavItem[] = [
    {
      key: 'qa',
      label: '知识问答',
      icon: MessageSquare,
      active: tab === 'qa',
      onClick: () => onTabChange('qa')
    },
    {
      key: 'knowledge-graph',
      label: '知识图谱',
      icon: Share2,
      active: tab === 'knowledge-graph',
      onClick: () => onTabChange('knowledge-graph')
    },
    {
      key: 'documents',
      label: '文档管理',
      icon: FileText,
      active: docPanelOpen,
      onClick: onToggleDoc
    }
  ]

  /* ---- 折叠态 60px ---- */
  if (collapsed) {
    return (
      <TooltipProvider delayDuration={300}>
        <aside className="group/sb relative flex h-screen w-[60px] shrink-0 flex-col items-center bg-[var(--secondary)] py-3 transition-all duration-200">
          {/* logo + 展开按钮（hover 时 logo 淡出、展开按钮淡入） */}
          <div className="relative mb-2 flex h-9 w-9 items-center justify-center">
            <div className="flex items-center justify-center transition-opacity duration-150 group-hover/sb:opacity-0">
              <GraduationCap className="h-[22px] w-[22px] text-[var(--primary)]" />
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  aria-label="展开侧边栏"
                  className="absolute inset-0 flex items-center justify-center rounded-lg text-[var(--muted-foreground)] opacity-0 transition-all duration-150 hover:bg-[var(--background)]/60 hover:text-[var(--foreground)] group-hover/sb:opacity-100"
                >
                  <PanelLeftOpen size={16} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">展开侧边栏</TooltipContent>
            </Tooltip>
          </div>

          {/* 主导航 icon-only */}
          <nav className="mt-1 flex w-full flex-col items-center gap-1 px-1.5">
            {primaryNav.map((item) => (
              <Tooltip key={item.key}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={item.onClick}
                    aria-label={item.label}
                    className={cn(
                      'relative flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-150',
                      item.active
                        ? 'bg-[var(--accent)] text-[var(--foreground)] shadow-sm'
                        : 'text-[var(--foreground)]/85 hover:bg-[var(--background)]/60 hover:text-[var(--foreground)]'
                    )}
                  >
                    <item.icon size={18} strokeWidth={item.active ? 2 : 1.6} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{item.label}</TooltipContent>
              </Tooltip>
            ))}
          </nav>

          <div className="flex-1" />

          {/* 底部 */}
          <div className="flex w-full flex-col items-center gap-1 px-1.5">
            <div className="my-1 h-px w-7 bg-[var(--border)]/40" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  disabled
                  aria-label="设置"
                  className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-xl text-[var(--muted-foreground)]/40"
                >
                  <Settings size={18} strokeWidth={1.6} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right">设置（敬请期待）</TooltipContent>
            </Tooltip>
          </div>
        </aside>
      </TooltipProvider>
    )
  }

  /* ---- 展开态 220px ---- */
  return (
    <aside className="flex h-screen w-[220px] shrink-0 flex-col bg-[var(--secondary)] transition-all duration-200">
      {/* Header：logo + 站名 + 折叠按钮 */}
      <div className="flex h-14 items-center justify-between px-4">
        <a href="/" className="group flex items-center gap-1.5">
          <GraduationCap className="h-[22px] w-[22px] shrink-0 text-[var(--primary)] transition-transform duration-200 group-hover:scale-105" />
          <span className="text-[15px] font-semibold tracking-tight text-[var(--foreground)]">
            {SiteInfo.name}
          </span>
        </a>
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label="折叠侧边栏"
          className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:text-[var(--foreground)]"
        >
          <PanelLeftClose size={15} />
        </button>
      </div>

      {/* 主导航 */}
      <nav className="px-2 pt-1">
        <div className="space-y-px">
          {primaryNav.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={item.onClick}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] transition-colors',
                item.active
                  ? 'bg-[var(--accent)] font-medium text-[var(--foreground)]'
                  : 'text-[var(--foreground)]/85 hover:bg-[var(--background)]/60 hover:text-[var(--foreground)]'
              )}
            >
              <item.icon size={16} strokeWidth={item.active ? 1.9 : 1.5} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Recents 会话历史（当前会话单条 + 清空） */}
      <section
        className={cn(
          'mt-4 flex min-h-0 flex-col',
          recentsCollapsed ? '' : 'flex-1'
        )}
      >
        <button
          type="button"
          onClick={() => setRecentsCollapsed((c) => !c)}
          aria-expanded={!recentsCollapsed}
          className="mx-2 flex items-center justify-between rounded-md px-2 py-1 text-left text-[11.5px] font-normal text-[var(--muted-foreground)]/60 transition-colors hover:bg-[var(--background)]/40 hover:text-[var(--muted-foreground)]"
        >
          <span>最近</span>
          <ChevronDown
            size={13}
            strokeWidth={1.7}
            className={cn(
              'transition-all duration-200',
              recentsCollapsed ? '-rotate-90 opacity-60' : 'opacity-60'
            )}
          />
        </button>
        {!recentsCollapsed && (
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-0.5">
            <div className="group/sess flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--background)]/40 hover:text-[var(--foreground)]">
              <MessageSquare size={14} strokeWidth={1.6} className="shrink-0 opacity-70" />
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[13px]',
                  !sessionTitle && 'italic'
                )}
              >
                {sessionTitle || '新对话'}
              </span>
              <button
                type="button"
                onClick={onClearSession}
                disabled={!canClear}
                aria-label="清空对话"
                title="清空对话"
                className={cn(
                  'shrink-0 rounded p-0.5 text-[var(--muted-foreground)] opacity-0 transition-opacity hover:text-[var(--destructive)] group-hover/sess:opacity-100',
                  !canClear && 'pointer-events-none opacity-30'
                )}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        )}
      </section>

      {recentsCollapsed && <div className="flex-1" />}

      {/* 底部：设置占位 + 站点描述 */}
      <div className="border-t border-[var(--border)]/40 px-2 py-2">
        <button
          type="button"
          disabled
          title="设置（敬请期待）"
          className="flex w-full cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13.5px] text-[var(--muted-foreground)]/40"
        >
          <Settings size={16} strokeWidth={1.5} />
          <span>设置</span>
        </button>
        <div className="mt-0.5 px-3 py-1 text-[11px] text-[var(--muted-foreground)]/55">
          {SiteInfo.description}
        </div>
      </div>
    </aside>
  )
}
