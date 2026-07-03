import { useSettingsStore } from '@/stores/settings'
import { useGraphStore } from '@/stores/graph'

/**
 * 左下角状态栏：显示当前深度、节点数、边数。
 */
const SettingsDisplay = () => {
  const graphQueryMaxDepth = useSettingsStore.use.graphQueryMaxDepth()
  const graphNodeCount = useGraphStore.use.graphNodeCount()
  const graphEdgeCount = useGraphStore.use.graphEdgeCount()

  return (
    <div className="absolute bottom-4 left-[calc(1rem+2.5rem)] flex items-center gap-2 text-xs text-gray-400">
      <div>深度: {graphQueryMaxDepth}</div>
      <div>节点: {graphNodeCount}</div>
      <div>边: {graphEdgeCount}</div>
    </div>
  )
}

export default SettingsDisplay
