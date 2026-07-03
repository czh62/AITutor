import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { createSelectors } from '@/lib/utils'
import { defaultQueryLabel } from '@/lib/constants'

/**
 * 图谱查看器设置（只读子集，来自 LightRAG webui stores/settings.ts）。
 * 仅保留与知识图谱渲染相关的字段；theme/language/auth/retrieval 等不在本仓此处管理。
 * 带 persist 中间件，localStorage 持久化。
 */
interface SettingsState {
  // Graph viewer settings
  showPropertyPanel: boolean
  showNodeSearchBar: boolean
  showLegend: boolean
  setShowLegend: (show: boolean) => void

  showNodeLabel: boolean
  enableNodeDrag: boolean

  showEdgeLabel: boolean
  enableHideUnselectedEdges: boolean
  enableEdgeEvents: boolean

  minEdgeSize: number
  setMinEdgeSize: (size: number) => void

  maxEdgeSize: number
  setMaxEdgeSize: (size: number) => void

  graphQueryMaxDepth: number
  setGraphQueryMaxDepth: (depth: number) => void

  graphMaxNodes: number
  setGraphMaxNodes: (nodes: number, triggerRefresh?: boolean) => void

  backendMaxGraphNodes: number | null
  setBackendMaxGraphNodes: (maxNodes: number | null) => void

  // 当前查询的实体标签（* 表示全局图谱）
  queryLabel: string
  setQueryLabel: (queryLabel: string) => void

  // 标签下拉框刷新触发器（运行时态，不持久化）
  searchLabelDropdownRefreshTrigger: number
  triggerSearchLabelDropdownRefresh: () => void
}

const useSettingsStoreBase = create<SettingsState>()(
  persist(
    (set) => ({
      showPropertyPanel: true,
      showNodeSearchBar: true,
      showLegend: false,

      showNodeLabel: true,
      enableNodeDrag: true,

      showEdgeLabel: false,
      enableHideUnselectedEdges: true,
      enableEdgeEvents: false,

      minEdgeSize: 1,
      maxEdgeSize: 1,

      graphQueryMaxDepth: 3,
      graphMaxNodes: 1000,
      backendMaxGraphNodes: null,

      queryLabel: defaultQueryLabel,

      setShowLegend: (show: boolean) => set({ showLegend: show }),

      setMinEdgeSize: (size: number) => set({ minEdgeSize: size }),
      setMaxEdgeSize: (size: number) => set({ maxEdgeSize: size }),

      setGraphQueryMaxDepth: (depth: number) => set({ graphQueryMaxDepth: depth }),

      setGraphMaxNodes: (nodes: number, triggerRefresh: boolean = false) => {
        const state = useSettingsStoreBase.getState()
        if (state.graphMaxNodes === nodes) {
          return
        }

        if (triggerRefresh) {
          const currentLabel = state.queryLabel
          // Atomically update both the node count and the query label to trigger a refresh.
          set({ graphMaxNodes: nodes, queryLabel: '' })

          // Restore the label after a short delay.
          setTimeout(() => {
            set({ queryLabel: currentLabel })
          }, 300)
        } else {
          set({ graphMaxNodes: nodes })
        }
      },

      setBackendMaxGraphNodes: (maxNodes: number | null) =>
        set({ backendMaxGraphNodes: maxNodes }),

      setQueryLabel: (queryLabel: string) => set({ queryLabel }),

      // Search label dropdown refresh trigger (not persisted)
      searchLabelDropdownRefreshTrigger: 0,
      triggerSearchLabelDropdownRefresh: () =>
        set((state) => ({
          searchLabelDropdownRefreshTrigger: state.searchLabelDropdownRefreshTrigger + 1
        }))
    }),
    {
      name: 'aitutor-graph-settings',
      storage: createJSONStorage(() => localStorage),
      version: 1,
      // searchLabelDropdownRefreshTrigger 为运行时态，不持久化
      partialize: (state) => ({
        showPropertyPanel: state.showPropertyPanel,
        showNodeSearchBar: state.showNodeSearchBar,
        showLegend: state.showLegend,
        showNodeLabel: state.showNodeLabel,
        enableNodeDrag: state.enableNodeDrag,
        showEdgeLabel: state.showEdgeLabel,
        enableHideUnselectedEdges: state.enableHideUnselectedEdges,
        enableEdgeEvents: state.enableEdgeEvents,
        minEdgeSize: state.minEdgeSize,
        maxEdgeSize: state.maxEdgeSize,
        graphQueryMaxDepth: state.graphQueryMaxDepth,
        graphMaxNodes: state.graphMaxNodes,
        queryLabel: state.queryLabel
      })
    }
  )
)

const useSettingsStore = createSelectors(useSettingsStoreBase)

export { useSettingsStore }
