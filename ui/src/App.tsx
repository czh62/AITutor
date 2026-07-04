import { useState } from 'react'
import { Toaster } from 'sonner'
import ActivityBar, { type SidebarMode } from '@/components/ActivityBar'
import DocumentManager from '@/features/DocumentManager'
import GraphViewer from '@/features/GraphViewer'
import MasterySidebar from '@/features/MasterySidebar'
import QAPanel from '@/features/QAPanel'
import SiteHeader, { type AppTab } from '@/features/SiteHeader'
import { useResizableWidth } from '@/hooks/useResizableWidth'
import { cn } from '@/lib/utils'

export default function App() {
  const [tab, setTab] = useState<AppTab>('qa')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('documents')
  const { width: leftWidth, resizerProps } = useResizableWidth({
    initial: 360,
    min: 260,
    max: 640,
    storageKey: 'aitutor-ui-doc-panel-width'
  })

  return (
    <>
      <main className="flex h-screen w-screen flex-col overflow-hidden">
        <SiteHeader currentTab={tab} onTabChange={setTab} />
        <div className="relative grow overflow-hidden">
          <div className={cn('absolute inset-0', tab !== 'qa' && 'invisible')}>
            <div className="flex h-full w-full">
              <ActivityBar
                sidebarOpen={sidebarOpen}
                activeMode={sidebarMode}
                onModeChange={(mode) => {
                  setSidebarMode(mode)
                  setSidebarOpen(true)
                }}
                onToggleSidebar={() => setSidebarOpen((open) => !open)}
              />
              <aside
                style={{ width: sidebarOpen ? leftWidth : 0 }}
                className={cn(
                  'flex min-h-0 shrink-0 flex-col overflow-hidden bg-secondary',
                  sidebarOpen && 'border-r border-border/40'
                )}
              >
                {sidebarMode === 'documents' ? (
                  <DocumentManager onCollapse={() => setSidebarOpen(false)} />
                ) : (
                  <MasterySidebar onCollapse={() => setSidebarOpen(false)} />
                )}
              </aside>
              {sidebarOpen && (
                <div
                  {...resizerProps}
                  className="w-1 shrink-0 cursor-col-resize bg-border/40 transition-colors hover:bg-muted-foreground/40"
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
