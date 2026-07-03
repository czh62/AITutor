import { useMemo } from 'react'
import { useGraphStore, RawNodeType, RawEdgeType } from '@/stores/graph'
import { PropertyValue } from './PropertyRowComponents'

/**
 * 只读属性面板：显示选中/悬停的节点或边信息。
 * （剥离了 expand/prune 与属性编辑能力。）
 */
const PropertiesView = () => {
  const selectedNode = useGraphStore.use.selectedNode()
  const focusedNode = useGraphStore.use.focusedNode()
  const selectedEdge = useGraphStore.use.selectedEdge()
  const focusedEdge = useGraphStore.use.focusedEdge()
  const graphDataVersion = useGraphStore.use.graphDataVersion()
  const rawGraph = useGraphStore.use.rawGraph()

  const { currentElement, currentType } = useMemo(() => {
    let type: 'node' | 'edge' | null = null
    let element: RawNodeType | RawEdgeType | null = null
    if (focusedNode) {
      type = 'node'
      element = rawGraph?.getNode(focusedNode) || null
    } else if (selectedNode) {
      type = 'node'
      element = rawGraph?.getNode(selectedNode) || null
    } else if (focusedEdge) {
      type = 'edge'
      element = rawGraph?.getEdge(focusedEdge, true) || null
    } else if (selectedEdge) {
      type = 'edge'
      element = rawGraph?.getEdge(selectedEdge, true) || null
    }

    if (element) {
      return {
        currentElement:
          type === 'node'
            ? refineNodeProperties(element as RawNodeType)
            : refineEdgeProperties(element as RawEdgeType),
        currentType: type
      }
    }
    return { currentElement: null, currentType: null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedNode, selectedNode, focusedEdge, selectedEdge, graphDataVersion, rawGraph])

  if (!currentElement) {
    return <></>
  }

  return (
    <div className="bg-background/80 max-w-xs rounded-lg border-2 p-2 text-xs backdrop-blur-lg">
      {currentType == 'node' ? (
        <NodePropertiesView node={currentElement as any} />
      ) : (
        <EdgePropertiesView edge={currentElement as any} />
      )}
    </div>
  )
}

type NodeType = RawNodeType & {
  relationships: {
    type: string
    id: string
    label: string
  }[]
}

type EdgeType = RawEdgeType & {
  sourceNode?: RawNodeType
  targetNode?: RawNodeType
}

const refineNodeProperties = (node: RawNodeType): NodeType => {
  const state = useGraphStore.getState()
  const relationships = []

  if (state.sigmaGraph && state.rawGraph) {
    try {
      if (!state.sigmaGraph.hasNode(node.id)) {
        return { ...node, relationships: [] }
      }

      const edges = state.sigmaGraph.edges(node.id)

      for (const edgeId of edges) {
        if (!state.sigmaGraph.hasEdge(edgeId)) continue;

        const edge = state.rawGraph.getEdge(edgeId, true)
        if (edge) {
          const isTarget = node.id === edge.source
          const neighbourId = isTarget ? edge.target : edge.source

          if (!state.sigmaGraph.hasNode(neighbourId)) continue;

          const neighbour = state.rawGraph.getNode(neighbourId)
          if (neighbour) {
            relationships.push({
              type: '相邻',
              id: neighbourId,
              label: neighbour.properties['entity_id']
                ? neighbour.properties['entity_id']
                : neighbour.labels.join(', ')
            })
          }
        }
      }
    } catch (error) {
      console.error('Error refining node properties:', error)
    }
  }

  return { ...node, relationships }
}

const refineEdgeProperties = (edge: RawEdgeType): EdgeType => {
  const state = useGraphStore.getState()
  let sourceNode: RawNodeType | undefined = undefined
  let targetNode: RawNodeType | undefined = undefined

  if (state.sigmaGraph && state.rawGraph) {
    try {
      if (!state.sigmaGraph.hasEdge(edge.dynamicId)) {
        return { ...edge, sourceNode: undefined, targetNode: undefined }
      }

      if (state.sigmaGraph.hasNode(edge.source)) {
        sourceNode = state.rawGraph.getNode(edge.source)
      }

      if (state.sigmaGraph.hasNode(edge.target)) {
        targetNode = state.rawGraph.getNode(edge.target)
      }
    } catch (error) {
      console.error('Error refining edge properties:', error)
    }
  }

  return { ...edge, sourceNode, targetNode }
}

const PropertyRow = ({
  name,
  value,
  onClick,
  truncate
}: {
  name: string
  value: unknown
  onClick?: () => void
  truncate?: string
}) => {
  const formatValue = (v: unknown): string => {
    if (typeof v === 'string') return v.replace(/<SEP>/g, ';\n')
    return typeof v === 'string' ? v : JSON.stringify(v, null, 2)
  }

  const formattedValue = formatValue(value)
  let tooltip = formattedValue
  if (name === 'source_id' && truncate) {
    tooltip += `\n(已截断: ${truncate})`
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-primary/60 tracking-wide whitespace-nowrap">
        {name}
        {name === 'source_id' && truncate && <sup className="text-red-500">†</sup>}
      </span>
      :
      <PropertyValue value={formattedValue} onClick={onClick} tooltip={tooltip} />
    </div>
  )
}

const NodePropertiesView = ({ node }: { node: NodeType }) => {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-md pl-1 font-bold tracking-wide text-blue-700">节点</h3>
      <div className="bg-primary/5 max-h-96 overflow-auto rounded p-1">
        <PropertyRow name="ID" value={String(node.id)} />
        <PropertyRow
          name="标签"
          value={node.labels.join(', ')}
          onClick={() => {
            useGraphStore.getState().setSelectedNode(node.id, true)
          }}
        />
        <PropertyRow name="度数" value={node.degree} />
      </div>
      <h3 className="text-md pl-1 font-bold tracking-wide text-amber-700">属性</h3>
      <div className="bg-primary/5 max-h-96 overflow-auto rounded p-1">
        {Object.keys(node.properties)
          .sort()
          .map((name) => {
            if (name === 'created_at' || name === 'truncate') return null
            return (
              <PropertyRow
                key={name}
                name={name}
                value={node.properties[name]}
                truncate={node.properties['truncate']}
              />
            )
          })}
      </div>
      {node.relationships.length > 0 && (
        <>
          <h3 className="text-md pl-1 font-bold tracking-wide text-emerald-700">关系</h3>
          <div className="bg-primary/5 max-h-96 overflow-auto rounded p-1">
            {node.relationships.map(({ type, id, label }) => {
              return (
                <PropertyRow
                  key={id}
                  name={type}
                  value={label}
                  onClick={() => {
                    useGraphStore.getState().setSelectedNode(id, true)
                  }}
                />
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

const EdgePropertiesView = ({ edge }: { edge: EdgeType }) => {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-md pl-1 font-bold tracking-wide text-violet-700">边</h3>
      <div className="bg-primary/5 max-h-96 overflow-auto rounded p-1">
        <PropertyRow name="ID" value={edge.id} />
        {edge.type && <PropertyRow name="类型" value={edge.type} />}
        <PropertyRow
          name="源节点"
          value={edge.sourceNode ? edge.sourceNode.labels.join(', ') : edge.source}
          onClick={() => {
            useGraphStore.getState().setSelectedNode(edge.source, true)
          }}
        />
        <PropertyRow
          name="目标节点"
          value={edge.targetNode ? edge.targetNode.labels.join(', ') : edge.target}
          onClick={() => {
            useGraphStore.getState().setSelectedNode(edge.target, true)
          }}
        />
      </div>
      <h3 className="text-md pl-1 font-bold tracking-wide text-amber-700">属性</h3>
      <div className="bg-primary/5 max-h-96 overflow-auto rounded p-1">
        {Object.keys(edge.properties)
          .sort()
          .map((name) => {
            if (name === 'created_at' || name === 'truncate') return null
            return (
              <PropertyRow
                key={name}
                name={name}
                value={edge.properties[name]}
                truncate={edge.properties['truncate']}
              />
            )
          })}
      </div>
    </div>
  )
}

export default PropertiesView
