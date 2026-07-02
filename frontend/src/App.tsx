import { useState } from 'react'
import { Toaster } from 'sonner'
import SiteHeader from '@/features/SiteHeader'
import DocumentManager from '@/features/DocumentManager'
import GraphViewer from '@/features/GraphViewer'
import QAPanel from '@/features/QAPanel'
import ActivityBar from '@/components/ActivityBar'
import { cn } from '@/lib/utils'
import { useResizableWidth } from '@/hooks/useResizableWidth'

type Tab = 'qa' | 'knowledge-graph'

export default function App() {
  const [tab, setTab] = useState<Tab>('qa')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  // 左侧文档管理默认宽度（比原 w-1/3 更窄），可拖动调整并持久化到 localStorage
  const { width: leftWidth, resizerProps } = useResizableWidth({
    initial: 360,
    min: 260,
    max: 640,
    storageKey: 'aitutor-doc-panel-width'
  })

  return (
    <>
      <main className="flex h-screen w-screen flex-col overflow-hidden">
        <SiteHeader currentTab={tab} onTabChange={setTab} />
        {/* 两面板均常驻挂载，用 visibility 切换显隐——对齐 webui TabsContent forceMount
            语义。若改回条件渲染卸载 GraphViewer，卸载时 stores/graph.ts 的 sigmaGraph
            会残留，再次挂载时被新 Sigma 实例复用 → "edge can't be repaint" → React 树崩
            → 白屏（CDP 实测：文档→图谱切换必现）。visibility:hidden（非 display:none）
            保留 canvas 尺寸，sigma 能正常创建 WebGL context。
            qa 面板内：活动栏 + 可折叠侧边栏（DocumentManager）+ 主区（QAPanel）。
            侧边栏用 width:0 隐藏而非卸载，保留文档列表/分页状态。 */}
        <div className="relative grow overflow-hidden">
          <div className={cn('absolute inset-0', tab !== 'qa' && 'invisible')}>
            <div className="flex h-full w-full">
              <ActivityBar
                sidebarOpen={sidebarOpen}
                onToggleSidebar={() => setSidebarOpen((o) => !o)}
              />
              <aside
                style={{ width: sidebarOpen ? leftWidth : 0 }}
                className={cn(
                  'flex min-h-0 shrink-0 flex-col overflow-hidden',
                  sidebarOpen && 'border-r border-border/40'
                )}
              >
                <DocumentManager onCollapse={() => setSidebarOpen(false)} />
              </aside>
              {sidebarOpen && (
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
          <div className={cn('absolute inset-0', tab !== 'knowledge-graph' && 'invisible')}>
            <GraphViewer />
          </div>
        </div>
      </main>
      <Toaster position="bottom-center" closeButton richColors />
    </>
  )
}
