import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { SigmaContainer, useRegisterEvents, useSigma } from '@react-sigma/core'
import { Settings as SigmaSettings } from 'sigma/settings'
import {
  EdgeArrowProgram,
  EdgeLineProgram,
  EdgeRectangleProgram,
  NodePointProgram,
  NodeCircleProgram
} from 'sigma/rendering'
import { NodeBorderProgram } from '@sigma/node-border'
import { EdgeCurvedArrowProgram, createEdgeCurveProgram } from '@sigma/edge-curve'

import FocusOnNode from '@/components/graph/FocusOnNode'
import LayoutsControl from '@/components/graph/LayoutsControl'
import GraphControl from '@/components/graph/GraphControl'
import ZoomControl from '@/components/graph/ZoomControl'
import FullScreenControl from '@/components/graph/FullScreenControl'
import Settings from '@/components/graph/Settings'
import GraphSearch, { type GraphSearchOption, type OptionItem } from '@/components/graph/GraphSearch'
import GraphLabels from '@/components/graph/GraphLabels'
import PropertiesView from '@/components/graph/PropertiesView'
import SettingsDisplay from '@/components/graph/SettingsDisplay'
import Legend from '@/components/graph/Legend'
import LegendButton from '@/components/graph/LegendButton'

import { useSettingsStore } from '@/stores/settings'
import { useGraphStore } from '@/stores/graph'
import useIsDarkMode from '@/hooks/useIsDarkMode'
import useLightragGraph from '@/hooks/useLightragGraph'
import { labelColorDarkTheme, labelColorLightTheme, edgeColorDarkTheme, EDGE_PERF_LIMIT } from '@/lib/constants'

import '@react-sigma/core/lib/style.css'

// Function to create sigma settings based on theme.
// `enableEdgeEvents` MUST be passed in (not toggled at runtime): sigma allocates
// the edge WebGL picking buffer once at construction based on this flag, so a
// later setSettings({ enableEdgeEvents: true }) cannot retroactively enable edge
// hover/click. We therefore key it off the user setting here and let the
// SigmaContainer rebuild the instance when the setting changes.
const createSigmaSettings = (
  isDarkTheme: boolean,
  enableEdgeEvents: boolean
): Partial<SigmaSettings> => ({
  allowInvalidContainer: true,
  defaultNodeType: 'border',
  defaultEdgeType: 'rect',
  renderEdgeLabels: false,
  hideEdgesOnMove: true,
  edgeProgramClasses: {
    rect: EdgeRectangleProgram,
    line: EdgeLineProgram,
    arrow: EdgeArrowProgram,
    curvedArrow: EdgeCurvedArrowProgram,
    curvedNoArrow: createEdgeCurveProgram()
  },
  nodeProgramClasses: {
    point: NodePointProgram,
    default: NodePointProgram,
    circle: NodeCircleProgram,
    border: NodeBorderProgram
  },
  labelGridCellSize: 60,
  labelRenderedSizeThreshold: 12,
  enableEdgeEvents,
  defaultEdgeColor: isDarkTheme ? edgeColorDarkTheme : '#d3d3d3',
  labelColor: {
    color: isDarkTheme ? labelColorDarkTheme : labelColorLightTheme,
    attribute: 'labelColor'
  },
  edgeLabelColor: {
    color: isDarkTheme ? labelColorDarkTheme : labelColorLightTheme,
    attribute: 'labelColor'
  },
  edgeLabelSize: 8,
  labelSize: 12
})

const GraphEvents = () => {
  const registerEvents = useRegisterEvents()
  const sigma = useSigma()
  const [draggedNode, setDraggedNode] = useState<string | null>(null)

  useEffect(() => {
    registerEvents({
      downNode: (e) => {
        setDraggedNode(e.node)
        sigma.getGraph().setNodeAttribute(e.node, 'highlighted', true)
      },
      mousemovebody: (e) => {
        if (!draggedNode) return
        const pos = sigma.viewportToGraph(e)
        sigma.getGraph().setNodeAttribute(draggedNode, 'x', pos.x)
        sigma.getGraph().setNodeAttribute(draggedNode, 'y', pos.y)

        e.preventSigmaDefault()
        e.original.preventDefault()
        e.original.stopPropagation()
      },
      mouseup: () => {
        if (draggedNode) {
          setDraggedNode(null)
          sigma.getGraph().removeNodeAttribute(draggedNode, 'highlighted')
        }
      },
      mousedown: (e) => {
        const mouseEvent = e.original as MouseEvent
        if (mouseEvent.buttons !== 0 && !sigma.getCustomBBox()) {
          sigma.setCustomBBox(sigma.getBBox())
        }
      }
    })
  }, [registerEvents, sigma, draggedNode])

  return null
}

const GraphViewer = () => {
  const sigmaRef = useRef<any>(null)

  const selectedNode = useGraphStore.use.selectedNode()
  const focusedNode = useGraphStore.use.focusedNode()
  const moveToSelectedNode = useGraphStore.use.moveToSelectedNode()
  const isFetching = useGraphStore.use.isFetching()
  const isLayoutComputing = useGraphStore.use.isLayoutComputing()

  const showPropertyPanel = useSettingsStore.use.showPropertyPanel()
  const showNodeSearchBar = useSettingsStore.use.showNodeSearchBar()
  const enableNodeDrag = useSettingsStore.use.enableNodeDrag()
  const showLegend = useSettingsStore.use.showLegend()
  const enableEdgeEvents = useSettingsStore.use.enableEdgeEvents()
  const graphEdgeCount = useGraphStore.use.graphEdgeCount()

  // 图谱数据加载入口：fetch → build sigmaGraph → 触发 GraphControl 跑 FA2 布局。
  // webui 原在 PropertiesView 内调用此 hook；本仓 PropertiesView 改为直接读 store，
  // 故必须在此显式调用，否则 sigmaGraph 恒为 null、画布空白（搜索框/控制条仍显示）。
  useLightragGraph()

  // Edge events are disabled above EDGE_PERF_LIMIT regardless of the user setting.
  const effectiveEdgeEvents = enableEdgeEvents && graphEdgeCount <= EDGE_PERF_LIMIT

  const isDarkMode = useIsDarkMode()

  const memoizedSigmaSettings = useMemo(
    () => createSigmaSettings(isDarkMode, effectiveEdgeEvents),
    [isDarkMode, effectiveEdgeEvents]
  )

  // Clean up sigma instance when component unmounts
  useEffect(() => {
    return () => {
      const sigma = useGraphStore.getState().sigmaInstance
      if (sigma) {
        try {
          sigma.kill()
          useGraphStore.getState().setSigmaInstance(null)
          console.log('Cleared sigma instance on Graphviewer unmount')
        } catch (error) {
          console.error('Error cleaning up sigma instance:', error)
        }
      }
    }
  }, [])

  const onSearchFocus = useCallback((value: GraphSearchOption) => {
    if (value === null) useGraphStore.getState().setFocusedNode(null)
    else if (value.type === 'nodes') useGraphStore.getState().setFocusedNode(value.id)
  }, [])

  const onSearchSelect = useCallback((value: GraphSearchOption) => {
    if (value === null) {
      useGraphStore.getState().setSelectedNode(null)
    } else if (value.type === 'nodes') {
      useGraphStore.getState().setSelectedNode(value.id, true)
    }
  }, [])

  const autoFocusedNode = useMemo(() => focusedNode ?? selectedNode, [focusedNode, selectedNode])
  const searchInitSelectedNode = useMemo(
    (): OptionItem | null => (selectedNode ? { type: 'nodes', id: selectedNode } : null),
    [selectedNode]
  )

  return (
    <div className="relative h-full w-full overflow-hidden">
      <SigmaContainer
        settings={memoizedSigmaSettings}
        className="!bg-background !size-full overflow-hidden"
        ref={sigmaRef}
      >
        <GraphControl />

        {enableNodeDrag && <GraphEvents />}

        <FocusOnNode node={autoFocusedNode} move={moveToSelectedNode} />

        <div className="absolute top-2 left-2 flex items-start gap-2">
          <GraphLabels />
          {showNodeSearchBar && (
            <GraphSearch
              value={searchInitSelectedNode}
              onFocus={onSearchFocus}
              onChange={onSearchSelect}
            />
          )}
        </div>

        <div className="bg-background/60 absolute bottom-2 left-2 flex flex-col rounded-xl border-2 backdrop-blur-lg">
          <LayoutsControl />
          <ZoomControl />
          <FullScreenControl />
          <LegendButton />
          <Settings />
        </div>

        {showPropertyPanel && (
          <div className="absolute top-2 right-2 z-10">
            <PropertiesView />
          </div>
        )}

        {showLegend && (
          <div className="absolute right-2 bottom-10 z-0">
            <Legend className="bg-background/60 backdrop-blur-lg" />
          </div>
        )}

        <SettingsDisplay />
      </SigmaContainer>

      {/* Loading overlay - shown for data fetch or layout run. */}
      {(isFetching || isLayoutComputing) && (
        <div className="bg-background/80 absolute inset-0 z-10 flex items-center justify-center">
          <div className="text-center">
            <div className="border-primary mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-4 border-t-transparent"></div>
            <p>
              {isFetching
                ? '正在加载图谱数据...'
                : '正在计算布局...'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default GraphViewer
