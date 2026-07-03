import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { searchResultLimit } from '@/lib/constants'
import { useGraphStore } from '@/stores/graph'
import MiniSearch from 'minisearch'

// 搜索结果中的消息项标识
export const messageId = '__message_item'

// 搜索结果选项
export interface OptionItem {
  id: string
  type: 'nodes' | 'edges' | 'message'
  message?: string
}

// GraphViewer 使用的搜索选项类型
export type GraphSearchOption = OptionItem | null

interface GraphSearchProps {
  value?: OptionItem | null
  onChange?: (value: GraphSearchOption) => void
  onFocus?: (value: GraphSearchOption) => void
}

const NodeOption = ({ id }: { id: string }) => {
  const graph = useGraphStore.use.sigmaGraph()

  if (!graph?.hasNode(id)) {
    return null
  }

  const label = graph.getNodeAttribute(id, 'label') || id
  const color = graph.getNodeAttribute(id, 'color') || '#666'
  const size = graph.getNodeAttribute(id, 'size') || 4

  return (
    <div className="flex items-center gap-2 p-2 text-sm">
      <div
        className="rounded-full flex-shrink-0"
        style={{
          width: Math.max(8, Math.min(size * 2, 16)),
          height: Math.max(8, Math.min(size * 2, 16)),
          backgroundColor: color
        }}
      />
      <span className="truncate">{label}</span>
    </div>
  )
}

function OptionComponent(item: OptionItem) {
  return (
    <div>
      {item.type === 'nodes' && <NodeOption id={item.id} />}
      {item.type === 'message' && <div className="p-2 text-xs text-gray-500">{item.message}</div>}
    </div>
  )
}

/**
 * 节点搜索输入框：基于 MiniSearch 全文索引，支持前缀/模糊匹配与中间内容匹配。
 * 自包含实现（不依赖 @react-sigma/graph-search / AsyncSearch）。
 */
const GraphSearch: FC<GraphSearchProps> = ({ value, onChange, onFocus }) => {
  const graph = useGraphStore.use.sigmaGraph()
  const searchEngine = useGraphStore.use.searchEngine()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<OptionItem[]>([])
  const containerRef = useRef<HTMLDivElement>(null)

  // 图谱变化时重置搜索索引
  useEffect(() => {
    if (graph) {
      useGraphStore.getState().resetSearchEngine()
    }
  }, [graph])

  // 按需构建 MiniSearch 索引
  useEffect(() => {
    if (!graph || graph.nodes().length === 0 || searchEngine) {
      return
    }

    const newSearchEngine = new MiniSearch({
      idField: 'id',
      fields: ['label'],
      searchOptions: {
        prefix: true,
        fuzzy: 0.2,
        boost: { label: 2 }
      }
    })

    const documents = graph
      .nodes()
      .filter((id) => graph.hasNode(id))
      .map((id: string) => ({
        id,
        label: graph.getNodeAttribute(id, 'label')
      }))

    if (documents.length > 0) {
      newSearchEngine.addAll(documents)
    }

    useGraphStore.getState().setSearchEngine(newSearchEngine)
  }, [graph, searchEngine])

  const loadOptions = useCallback(
    async (q?: string): Promise<OptionItem[]> => {
      if (onFocus) onFocus(null)

      if (!graph || !searchEngine || graph.nodes().length === 0) {
        return []
      }

      if (!q) {
        const nodeIds = graph
          .nodes()
          .filter((id) => graph.hasNode(id))
          .slice(0, searchResultLimit)
        return nodeIds.map((id) => ({ id, type: 'nodes' as const }))
      }

      let result: OptionItem[] = searchEngine
        .search(q)
        .filter((r: { id: string }) => graph.hasNode(r.id))
        .map((r: { id: string }) => ({ id: r.id, type: 'nodes' as const }))

      // 结果较少时补充中间内容匹配
      if (result.length < 5) {
        const matchedIds = new Set(result.map((item) => item.id))
        const middleMatches = graph
          .nodes()
          .filter((id) => {
            if (matchedIds.has(id)) return false
            if (!graph.hasNode(id)) return false
            const label = graph.getNodeAttribute(id, 'label')
            return (
              label &&
              typeof label === 'string' &&
              !label.toLowerCase().startsWith(q.toLowerCase()) &&
              label.toLowerCase().includes(q.toLowerCase())
            )
          })
          .map((id) => ({ id, type: 'nodes' as const }))
        result = [...result, ...middleMatches]
      }

      return result.length <= searchResultLimit
        ? result
        : [
            ...result.slice(0, searchResultLimit),
            {
              type: 'message',
              id: messageId,
              message: `还有 ${result.length - searchResultLimit} 个结果未显示`
            }
          ]
    },
    [graph, searchEngine, onFocus]
  )

  // 输入变化时刷新选项
  useEffect(() => {
    let active = true
    loadOptions(query).then((opts) => {
      if (active) setOptions(opts)
    })
    return () => {
      active = false
    }
  }, [query, loadOptions])

  // 点击外部关闭下拉
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const displayValue = useMemo(() => {
    if (value && value.type === 'nodes') {
      const label = graph?.getNodeAttribute(value.id, 'label')
      return (typeof label === 'string' && label) || value.id
    }
    return ''
  }, [value, graph])

  return (
    <div ref={containerRef} className="relative">
      <input
        className="bg-background/60 w-40 rounded-xl border px-3 py-1.5 text-sm opacity-60 backdrop-blur-lg transition-all hover:w-56 hover:opacity-100 focus:w-56 focus:opacity-100 focus:outline-none"
        placeholder="搜索节点..."
        value={open ? query : displayValue}
        aria-label="搜索节点"
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onChange={(e) => setQuery(e.target.value)}
      />
      {open && (
        <div className="bg-background absolute top-full left-0 z-20 mt-1 max-h-80 w-56 overflow-auto rounded-md border shadow-md">
          {options.length === 0 ? (
            <div className="p-3 text-center text-sm text-gray-500">无匹配节点</div>
          ) : (
            options.map((item) => (
              <div
                key={item.id}
                className="cursor-pointer hover:bg-accent"
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (item.id !== messageId && item.type === 'nodes') {
                    onChange?.({ id: item.id, type: 'nodes' })
                    onFocus?.({ id: item.id, type: 'nodes' })
                  }
                  setOpen(false)
                }}
              >
                <OptionComponent {...item} />
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export default GraphSearch
