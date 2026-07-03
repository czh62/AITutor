import Graph, { UndirectedGraph } from 'graphology'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '@/lib/utils'
import * as Constants from '@/lib/constants'
import { useGraphStore, RawGraph } from '@/stores/graph'
import { toast } from 'sonner'
import { queryGraphs } from '@/api/aitutor'
import { useSettingsStore } from '@/stores/settings'

import { resolveNodeColor, DEFAULT_NODE_COLOR } from '@/utils/graphColor'

// Every node gets this border (the node-border program reads `borderColor`).
const NODE_BORDER_COLOR = '#FFFFFF'

// Bounded auto-retry for transient graph fetch failures. We must NOT retry
// without a cap, but we also must not wedge the query permanently on a single
// transient blip. After MAX_FETCH_RETRIES the query is suppressed until the
// user changes a parameter or hits refresh (graphDataVersion bump).
const MAX_FETCH_RETRIES = 3
const RETRY_BASE_DELAY_MS = 1000 // 1s -> 2s -> 4s exponential backoff

// Marks a TERMINAL failure that happened AFTER the network fetch succeeded:
// building the sigma graph from the payload, or a store/sigma subscriber
// throwing while applying it. These are deterministic — retrying re-fetches
// identical data and fails identically — so they must NOT enter the bounded
// backoff retry path.
class GraphBuildError extends Error {
  constructor(cause: unknown) {
    super('Graph build/apply failed')
    this.name = 'GraphBuildError'
    this.cause = cause
  }
}

// --- Performance helpers ----------------------------------------------------

// Deterministic, cheap replacement for `seedrandom(node.id)`.
const hashNodeIdToPosition = (id: string): { x: number; y: number } => {
  let h1 = 0xdeadbeef ^ id.length
  let h2 = 0x41c6ce57 ^ id.length
  for (let i = 0; i < id.length; i++) {
    const ch = id.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return { x: (h1 >>> 0) / 4294967296, y: (h2 >>> 0) / 4294967296 }
}

// Yield to the browser WITHOUT setTimeout's nested-timer clamp.
const yieldToBrowser = (): Promise<void> => {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (scheduler?.yield) return scheduler.yield()
  return new Promise<void>((resolve) => {
    const { port1, port2 } = new MessageChannel()
    port1.onmessage = () => {
      port1.close()
      resolve()
    }
    port2.postMessage(null)
  })
}

// Cooperative time-slicing: run synchronously until the frame budget is spent,
// then yield ONCE.
const FRAME_BUDGET_MS = 12
const CHECK_EVERY = 256 // power of two; performance.now() is sampled sparsely

// Per-type node colors, performance-safe.
const createTypeColorResolver = () => {
  let typeColorMap = useGraphStore.getState().typeColorMap
  const cache = new Map<string, string>()
  let mapUpdated = false

  return {
    colorFor(entityType: string | undefined): string {
      const key = entityType ?? ''
      let color = cache.get(key)
      if (color === undefined) {
        const resolved = resolveNodeColor(entityType, typeColorMap)
        if (resolved.updated) {
          typeColorMap = resolved.map
          mapUpdated = true
        }
        color = resolved.color || DEFAULT_NODE_COLOR
        cache.set(key, color)
      }
      return color
    },
    commit() {
      if (mapUpdated) {
        useGraphStore.setState({ typeColorMap })
        mapUpdated = false
      }
    }
  }
}

// Parse an edge's `weight` property into a finite number, preserving a
// legitimate 0.
const parseEdgeWeight = (properties: Record<string, unknown> | undefined): number => {
  const w = Number(properties?.weight)
  return Number.isFinite(w) ? w : 1
}

// Build a node label defensively.
const safeNodeLabel = (labels: unknown, fallbackId: string): string =>
  Array.isArray(labels) ? labels.join(', ') : fallbackId

// Add an undirected edge, working around a graphology 0.26.0 bug.
const addUndirectedEdgeSafe = (
  graph: UndirectedGraph,
  source: string,
  target: string,
  attributes: Record<string, unknown>
): string | null => {
  try {
    return graph.addEdge(source, target, attributes)
  } catch {
    try {
      return graph.addEdge(target, source, attributes)
    } catch {
      return null
    }
  }
}

export type NodeType = {
  x: number
  y: number
  label: string
  size: number
  color: string
  highlighted?: boolean
}
export type EdgeType = {
  label: string
  originalWeight?: number
  size?: number
  color?: string
  hidden?: boolean
}

const fetchGraph = async (label: string, maxDepth: number, maxNodes: number) => {
  let rawData: any

  useGraphStore.getState().setLabelsFetchAttempted(true)

  // If label is empty, use default label '*'
  const queryLabel = label || '*'

  try {
    console.log(`Fetching graph label: ${queryLabel}, depth: ${maxDepth}, nodes: ${maxNodes}`)
    rawData = await queryGraphs(queryLabel, maxDepth, maxNodes)
  } catch (e) {
    // Record the error, then RETHROW so the caller's .catch() runs its
    // bounded-retry path. Returning null here would resolve the promise
    // "successfully" and treat a transient failure as an empty graph.
    toast.error(`查询图谱失败：${errorMessage(e)}`)
    throw e
  }

  let rawGraph = null

  if (rawData) {
    // Null-prototype objects: node ids can collide with Object.prototype properties.
    const nodeIdMap: Record<string, number> = Object.create(null)
    const edgeIdMap: Record<string, number> = Object.create(null)

    for (let i = 0; i < rawData.nodes.length; i++) {
      const node = rawData.nodes[i]
      nodeIdMap[node.id] = i

      node.degree = 0
      node.size = 10
    }

    for (let i = 0; i < rawData.edges.length; i++) {
      const edge = rawData.edges[i]
      edgeIdMap[edge.id] = i

      const source = nodeIdMap[edge.source]
      const target = nodeIdMap[edge.target]
      if (source !== undefined && target !== undefined) {
        const sourceNode = rawData.nodes[source]
        if (!sourceNode) {
          console.error(`Source node ${edge.source} is undefined`)
          continue
        }

        const targetNode = rawData.nodes[target]
        if (!targetNode) {
          console.error(`Target node ${edge.target} is undefined`)
          continue
        }
        sourceNode.degree += 1
        targetNode.degree += 1
      }
    }

    // generate node size
    let minDegree = Number.MAX_SAFE_INTEGER
    let maxDegree = 0

    for (const node of rawData.nodes) {
      minDegree = Math.min(minDegree, node.degree)
      maxDegree = Math.max(maxDegree, node.degree)
    }
    const range = maxDegree - minDegree
    if (range > 0) {
      const scale = Constants.maxNodeSize - Constants.minNodeSize
      for (const node of rawData.nodes) {
        node.size = Math.round(
          Constants.minNodeSize + scale * Math.pow((node.degree - minDegree) / range, 0.5)
        )
      }
    }

    rawGraph = new RawGraph()
    rawGraph.nodes = rawData.nodes
    rawGraph.edges = rawData.edges
    rawGraph.nodeIdMap = nodeIdMap
    rawGraph.edgeIdMap = edgeIdMap

    console.log('Graph data loaded')
  }

  return { rawGraph, is_truncated: rawData?.is_truncated }
}

// Create a new graph instance with the raw graph data
const createSigmaGraph = async (rawGraph: RawGraph | null): Promise<UndirectedGraph | null> => {
  if (!rawGraph || !rawGraph.nodes.length) return null

  const graph = new UndirectedGraph()
  const typeColors = createTypeColorResolver()
  let sliceStart = performance.now()

  const nodes = rawGraph.nodes
  for (let i = 0; i < nodes.length; i++) {
    if ((i & (CHECK_EVERY - 1)) === 0 && performance.now() - sliceStart > FRAME_BUDGET_MS) {
      await yieldToBrowser()
      sliceStart = performance.now()
    }

    const rawNode = nodes[i]
    if (graph.hasNode(rawNode.id)) continue

    const { x, y } = hashNodeIdToPosition(rawNode.id)
    rawNode.color = typeColors.colorFor(rawNode.properties?.entity_type as string | undefined)

    graph.addNode(rawNode.id, {
      label: safeNodeLabel(rawNode.labels, rawNode.id),
      color: rawNode.color,
      x,
      y,
      size: rawNode.size,
      borderColor: NODE_BORDER_COLOR
    })
  }

  // Single store write for the whole build (keeps the Legend in sync)
  typeColors.commit()

  rawGraph.edgeDynamicIdMap = Object.create(null) as Record<string, number>
  let skippedEdges = 0

  const edges = rawGraph.edges
  for (let i = 0; i < edges.length; i++) {
    if ((i & (CHECK_EVERY - 1)) === 0 && performance.now() - sliceStart > FRAME_BUDGET_MS) {
      await yieldToBrowser()
      sliceStart = performance.now()
    }

    const rawEdge = edges[i]
    if (
      !graph.hasNode(rawEdge.source) ||
      !graph.hasNode(rawEdge.target) ||
      graph.hasEdge(rawEdge.source, rawEdge.target)
    ) {
      continue
    }

    const attributes = {
      label: (rawEdge.properties?.keywords as string | undefined) || undefined,
      originalWeight: parseEdgeWeight(rawEdge.properties)
    }
    const dynamicId = addUndirectedEdgeSafe(graph, rawEdge.source, rawEdge.target, attributes)
    if (dynamicId === null) {
      skippedEdges++
      continue
    }
    rawEdge.dynamicId = dynamicId
    rawGraph.edgeDynamicIdMap[rawEdge.dynamicId] = i
  }

  if (skippedEdges > 0) {
    console.warn(`[useLightragGraph] ${skippedEdges} edges could not be added to the graph`)
  }

  return graph
}

const useLightrangeGraph = () => {
  const queryLabel = useSettingsStore.use.queryLabel()
  const rawGraph = useGraphStore.use.rawGraph()
  const sigmaGraph = useGraphStore.use.sigmaGraph()
  const maxQueryDepth = useSettingsStore.use.graphQueryMaxDepth()
  const maxNodes = useSettingsStore.use.graphMaxNodes()
  const isFetching = useGraphStore.use.isFetching()
  const graphDataVersion = useGraphStore.use.graphDataVersion()

  // Use ref to track if data has been loaded and initial load
  const dataLoadedRef = useRef(false)
  const initialLoadRef = useRef(false)
  // Use ref to track if empty data has been handled
  const emptyDataHandledRef = useRef(false)

  const getNode = useCallback(
    (nodeId: string) => {
      return rawGraph?.getNode(nodeId) || null
    },
    [rawGraph]
  )

  const getEdge = useCallback(
    (edgeId: string, dynamicId: boolean = true) => {
      return rawGraph?.getEdge(edgeId, dynamicId) || null
    },
    [rawGraph]
  )

  // Track if a fetch is in progress to prevent multiple simultaneous fetches
  const fetchInProgressRef = useRef(false)

  const lastFetchSignatureRef = useRef<string | null>(null)

  const retryStateRef = useRef<{ signature: string; attempts: number }>({
    signature: '',
    attempts: 0
  })
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)

  // Reset graph when query label is cleared
  useEffect(() => {
    if (!queryLabel && (rawGraph !== null || sigmaGraph !== null)) {
      const state = useGraphStore.getState()
      state.reset()
      state.setGraphDataFetchAttempted(false)
      state.setLabelsFetchAttempted(false)
      dataLoadedRef.current = false
      initialLoadRef.current = false
    }
  }, [queryLabel, rawGraph, sigmaGraph])

  // Graph data fetching logic
  useEffect(() => {
    if (fetchInProgressRef.current) {
      return
    }

    if (!queryLabel && emptyDataHandledRef.current) {
      return
    }

    if (!isFetching && !useGraphStore.getState().graphDataFetchAttempted) {
      const fetchSignature = `${queryLabel}|${maxQueryDepth}|${maxNodes}|v${graphDataVersion}`
      if (lastFetchSignatureRef.current === fetchSignature) {
        console.warn(
          '[useLightragGraph] Suppressed duplicate graph fetch:',
          fetchSignature,
          '— graphDataFetchAttempted was reset after this query already ran'
        )
        useGraphStore.getState().setGraphDataFetchAttempted(true)
        return
      }

      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }

      fetchInProgressRef.current = true
      useGraphStore.getState().setGraphDataFetchAttempted(true)

      const state = useGraphStore.getState()
      state.setIsFetching(true)

      state.clearSelection()
      if (state.sigmaGraph) {
        state.sigmaGraph.forEachNode((node, attributes) => {
          if (attributes.highlighted) {
            state.sigmaGraph?.setNodeAttribute(node, 'highlighted', false)
          }
        })
      }

      console.log('Preparing graph data...')

      const currentQueryLabel = queryLabel
      const currentMaxQueryDepth = maxQueryDepth
      const currentMaxNodes = maxNodes

      let dataPromise: Promise<{
        rawGraph: RawGraph | null
        is_truncated: boolean | undefined
      } | null>

      if (currentQueryLabel) {
        dataPromise = fetchGraph(currentQueryLabel, currentMaxQueryDepth, currentMaxNodes)
      } else {
        console.log('Query label is empty, show empty graph')
        dataPromise = Promise.resolve({ rawGraph: null, is_truncated: false })
      }

      dataPromise
        .then(async (result) => {
          const state = useGraphStore.getState()
          const data = result?.rawGraph

          if (result?.is_truncated) {
            toast.info('图谱数据已按最大节点数截断')
          }

          // Reset state
          state.reset()

          // Check if data is empty or invalid
          if (!data || !data.nodes || data.nodes.length === 0) {
            // Create a graph with a single "Graph Is Empty" node
            const emptyGraph = new UndirectedGraph()

            emptyGraph.addNode('empty-graph-node', {
              label: '图谱为空',
              color: '#5D6D7E',
              x: 0.5,
              y: 0.5,
              size: 15,
              borderColor: Constants.nodeBorderColor,
              borderSize: 0.2
            })

            state.setSigmaGraph(emptyGraph)
            state.setRawGraph(null)
            state.setGraphCounts(0, 0)
            state.setGraphIsEmpty(true)

            if (currentQueryLabel) {
              useSettingsStore.getState().setQueryLabel('')
            }
            state.setLastSuccessfulQueryLabel('')

            console.log('Graph data is empty, created graph with empty graph node.')
          } else {
            let newSigmaGraph: UndirectedGraph | null
            try {
              newSigmaGraph = await createSigmaGraph(data)
            } catch (buildError) {
              console.error('[useLightragGraph] createSigmaGraph failed (graph build):', buildError)
              throw new GraphBuildError(buildError)
            }

            try {
              state.setSigmaGraph(newSigmaGraph)
              state.setRawGraph(data)
              state.setGraphIsEmpty(false)
            } catch (subscriberError) {
              console.error(
                '[useLightragGraph] a store/sigma subscriber threw while applying the new graph:',
                subscriberError
              )
              throw new GraphBuildError(subscriberError)
            }

            state.setLastSuccessfulQueryLabel(currentQueryLabel)

            console.log(
              `[useLightragGraph] sigma graph ready: ${newSigmaGraph?.order} nodes, ${newSigmaGraph?.size} edges`
            )

            state.setMoveToSelectedNode(true)
          }

          lastFetchSignatureRef.current = fetchSignature
          retryStateRef.current = { signature: '', attempts: 0 }

          dataLoadedRef.current = true
          initialLoadRef.current = true
          fetchInProgressRef.current = false
          state.setIsFetching(false)

          if ((!data || !data.nodes || data.nodes.length === 0) && !currentQueryLabel) {
            emptyDataHandledRef.current = true
          }
        })
        .catch((error) => {
          console.error(
            '[useLightragGraph] graph load failed (see preceding log for stage):',
            error
          )

          const state = useGraphStore.getState()
          state.setIsFetching(false)
          dataLoadedRef.current = false
          fetchInProgressRef.current = false
          state.setLastSuccessfulQueryLabel('')

          if (error instanceof GraphBuildError) {
            console.error(
              '[useLightragGraph] graph build failed (not retrying — deterministic):',
              fetchSignature
            )
            lastFetchSignatureRef.current = fetchSignature
            retryStateRef.current = { signature: '', attempts: 0 }
            toast.error('图谱数据渲染失败，请使用刷新重试')
            return
          }

          const retry = retryStateRef.current
          if (retry.signature !== fetchSignature) {
            retry.signature = fetchSignature
            retry.attempts = 0
          }

          if (retry.attempts < MAX_FETCH_RETRIES) {
            retry.attempts += 1
            const delay = RETRY_BASE_DELAY_MS * 2 ** (retry.attempts - 1)
            console.warn(
              `[useLightragGraph] graph fetch failed, retry ${retry.attempts}/${MAX_FETCH_RETRIES} in ${delay}ms:`,
              fetchSignature
            )
            if (retryTimerRef.current !== null) {
              clearTimeout(retryTimerRef.current)
            }
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null
              useGraphStore.getState().setGraphDataFetchAttempted(false)
              setRetryNonce((n) => n + 1)
            }, delay)
          } else {
            console.error(
              `[useLightragGraph] graph fetch failed after ${MAX_FETCH_RETRIES} retries, giving up:`,
              fetchSignature
            )
            lastFetchSignatureRef.current = fetchSignature
            toast.error('图谱数据加载失败，请使用刷新重试')
          }
        })
    }
  }, [queryLabel, maxQueryDepth, maxNodes, isFetching, graphDataVersion, retryNonce])

  // Clean up any pending backoff retry timer on unmount.
  useEffect(() => {
    return () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
    }
  }, [])

  const lightrageGraph = useCallback(() => {
    // If we already have a graph instance, return it
    if (sigmaGraph) {
      return sigmaGraph as Graph<NodeType, EdgeType>
    }

    // If no graph exists yet, create a new one and store it
    console.log('Creating new Sigma graph instance')
    const graph = new UndirectedGraph()
    useGraphStore.getState().setSigmaGraph(graph)
    return graph as Graph<NodeType, EdgeType>
  }, [sigmaGraph])

  return { lightrageGraph, getNode, getEdge }
}

export default useLightrangeGraph
