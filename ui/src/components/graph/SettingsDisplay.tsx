import { useSettingsStore } from '@/stores/settings'
import { useGraphStore } from '@/stores/graph'

/**
 * 左下角Status栏：显示当前深度、Nodes数、Edges数。
 */
const SettingsDisplay = () => {
  const graphQueryMaxDepth = useSettingsStore.use.graphQueryMaxDepth()
  const graphNodeCount = useGraphStore.use.graphNodeCount()
  const graphEdgeCount = useGraphStore.use.graphEdgeCount()

  return (
    <div className="absolute bottom-4 left-[calc(1rem+2.5rem)] flex items-center gap-2 text-xs text-gray-400">
      <div>Depth: {graphQueryMaxDepth}</div>
      <div>Nodes: {graphNodeCount}</div>
      <div>Edges: {graphEdgeCount}</div>
    </div>
  )
}

export default SettingsDisplay
