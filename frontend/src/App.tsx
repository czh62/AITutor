import { useState, useEffect, useMemo } from 'react'
import { Toaster } from 'sonner'
import DocumentManager from '@/features/DocumentManager'
import GraphViewer from '@/features/GraphViewer'
import QAPanel from '@/features/QAPanel'
import SidebarShell from '@/components/sidebar/SidebarShell'
import { useQAStore } from '@/stores/qa'
import { cn } from '@/lib/utils'
import { useResizableWidth } from '@/hooks/useResizableWidth'

type Tab = 'qa' | 'knowledge-graph'

const SIDEBAR_COLLAPSED_KEY = 'aitutor-sidebar-collapsed'

export default function App() {
  const [tab, setTab] = useState<Tab>('qa')
  const [docPanelOpen, setDocPanelOpen] = useState(true)
  const [collapsed, setCollapsed] = useState(false)

  // 从 store 读消息（用于 Recents 当前会话标题 + 是否可清空 + 是否流式中）
  const messages = useQAStore((s) => s.messages)
  const clearMessages = useQAStore((s) => s.clearMessages)
  const isStreaming = useQAStore((s) => s.messages.some((m) => m.isStreaming))

  // 左侧文档管理默认宽度（比原 w-1/3 更窄），可拖动调整并持久化到 localStorage
  const { width: leftWidth, resizerProps } = useResizableWidth({
    initial: 360,
    min: 260,
    max: 640,
    storageKey: 'aitutor-doc-panel-width'
  })

  // sidebar 折叠态持久化（轻量，用 localStorage，不污染 settings store）
  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY)
    if (saved === '1') setCollapsed(true)
  }, [])
  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  // Recents 当前会话标题：取首条用户消息前 40 字，无则空（SidebarShell 显示"新对话"）
  const sessionTitle = useMemo(() => {
    const firstUser = messages.find((m) => m.role === 'user')
    if (!firstUser) return ''
    return firstUser.content.trim().replace(/\s+/g, ' ').slice(0, 40)
  }, [messages])

  // 文档管理点击：toggle 文档面板；打开时若不在 qa tab，切到 qa（面板只在 QA 层可见）
  const handleToggleDoc = () => {
    setDocPanelOpen((o) => {
      const next = !o
      if (next && tab !== 'qa') setTab('qa')
      return next
    })
  }

  const handleClearSession = () => {
    if (!isStreaming && messages.length > 0) clearMessages()
  }

  return (
    <>
      {/* DeepTutor 风格根布局：左 SidebarShell + 右 main；两面板常驻挂载 + visibility 切换 */}
      {/* GraphViewer 必须常驻不卸载（visibility:hidden 非 display:none）：卸载会令 stores/graph.ts
          的 sigmaGraph 残留，再次挂载时新 Sigma 实例复用 → "edge can't be repaint" → 白屏。
          文档面板用 width:0 折叠而非卸载，保留列表/分页状态。 */}
      <div className="flex h-screen w-screen overflow-hidden">
        <SidebarShell
          tab={tab}
          onTabChange={setTab}
          docPanelOpen={docPanelOpen}
          onToggleDoc={handleToggleDoc}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          sessionTitle={sessionTitle}
          onClearSession={handleClearSession}
          canClear={!isStreaming && messages.length > 0}
        />
        <main className="relative min-w-0 flex-1 overflow-hidden">
          {/* QA 层（常驻） */}
          <div className={cn('absolute inset-0', tab !== 'qa' && 'invisible')}>
            <div className="flex h-full w-full">
              <aside
                style={{ width: docPanelOpen ? leftWidth : 0 }}
                className={cn(
                  'flex min-h-0 shrink-0 flex-col overflow-hidden',
                  docPanelOpen && 'border-r border-border/40'
                )}
              >
                <DocumentManager onCollapse={() => setDocPanelOpen(false)} />
              </aside>
              {docPanelOpen && (
                <div
                  {...resizerProps}
                  className="w-1 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-emerald-500/60"
                  aria-label="拖动调整宽度"
                  role="separator"
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <QAPanel />
              </div>
            </div>
          </div>
          {/* GraphViewer 层（常驻） */}
          <div className={cn('absolute inset-0', tab !== 'knowledge-graph' && 'invisible')}>
            <GraphViewer />
          </div>
        </main>
      </div>
      <Toaster position="bottom-center" closeButton richColors />
    </>
  )
}
