import { create } from 'zustand'
import { createSelectors } from '@/lib/utils'
import { DirectedGraph } from 'graphology'
import MiniSearch from 'minisearch'

// Minimal imperative handle the store needs to own a running layout: enough to
// terminate the previous one before a new layout takes over.
export interface LayoutSupervisorHandle {
  kill: () => void
}

export type RawNodeType = {
  // for NetworkX: id is identical to properties['entity_id']
  // for Neo4j: id is unique identifier for each node
  id: string
  labels: string[]
  properties: Record<string, any>

  size: number
  x: number
  y: number
  color: string

  degree: number
}

export type RawEdgeType = {
  // for NetworkX: id is "source-target"
  // for Neo4j: id is unique identifier for each edge
  id: string
  source: string
  target: string
  type?: string
  properties: Record<string, any>
  // dynamicId: key for sigmaGraph
  dynamicId: string
}

export class RawGraph {
  nodes: RawNodeType[] = []
  edges: RawEdgeType[] = []
  // nodeIDMap: map node id to index in nodes array (SigmaGraph has nodeId as key)
  nodeIdMap: Record<string, number> = {}
  // edgeIDMap: map edge id to index in edges array (SigmaGraph not use id as key)
  edgeIdMap: Record<string, number> = {}
  // edgeDynamicIdMap: map edge dynamic id to index in edges array (SigmaGraph has DynamicId as key)
  edgeDynamicIdMap: Record<string, number> = {}

  getNode = (nodeId: string) => {
    const nodeIndex = this.nodeIdMap[nodeId]
    if (nodeIndex !== undefined) {
      return this.nodes[nodeIndex]
    }
    return undefined
  }

  getEdge = (edgeId: string, dynamicId: boolean = true) => {
    const edgeIndex = dynamicId ? this.edgeDynamicIdMap[edgeId] : this.edgeIdMap[edgeId]
    if (edgeIndex !== undefined) {
      return this.edges[edgeIndex]
    }
    return undefined
  }

  buildDynamicMap = () => {
    // Null-prototype: dynamic ids are graph-generated, but keep this consistent
    // with the null-proto node/edge id maps so a missing-key lookup never
    // returns an inherited Object.prototype member.
    this.edgeDynamicIdMap = Object.create(null) as Record<string, number>
    for (let i = 0; i < this.edges.length; i++) {
      const edge = this.edges[i]
      this.edgeDynamicIdMap[edge.dynamicId] = i
    }
  }
}

interface GraphState {
  selectedNode: string | null
  focusedNode: string | null
  selectedEdge: string | null
  focusedEdge: string | null

  rawGraph: RawGraph | null
  sigmaGraph: DirectedGraph | null
  sigmaInstance: any | null

  // Reactive node/edge counts. The sigma graph is mutated in place, so
  // `sigmaGraph.order` / `.size` are NOT reactive in React. These mirror them
  // and are the single source of truth for: the status bar (SettingsDisplay)
  // and the edge-count adaptive behavior (curved vs straight edges, edge-event
  // gating). Kept as a store invariant — see setSigmaGraph/reset/setGraphCounts.
  graphNodeCount: number
  graphEdgeCount: number

  searchEngine: MiniSearch | null

  moveToSelectedNode: boolean
  isFetching: boolean
  graphIsEmpty: boolean
  lastSuccessfulQueryLabel: string

  typeColorMap: Map<string, string>

  // Global flags to track data fetching attempts
  graphDataFetchAttempted: boolean
  labelsFetchAttempted: boolean

  setSigmaInstance: (instance: any) => void
  setSelectedNode: (nodeId: string | null, moveToSelectedNode?: boolean) => void
  setFocusedNode: (nodeId: string | null) => void
  setSelectedEdge: (edgeId: string | null) => void
  setFocusedEdge: (edgeId: string | null) => void
  clearSelection: () => void
  reset: () => void

  setMoveToSelectedNode: (moveToSelectedNode: boolean) => void
  setGraphIsEmpty: (isEmpty: boolean) => void
  setLastSuccessfulQueryLabel: (label: string) => void

  setRawGraph: (rawGraph: RawGraph | null) => void
  setSigmaGraph: (sigmaGraph: DirectedGraph | null) => void
  // Update the reactive node/edge counts together (one set call → one notify).
  setGraphCounts: (nodeCount: number, edgeCount: number) => void
  setIsFetching: (isFetching: boolean) => void

  // True while a layout (sync or worker) is computing. Drives the loading
  // overlay so a layout click doesn't look like a frozen UI on large graphs.
  isLayoutComputing: boolean
  setIsLayoutComputing: (running: boolean) => void

  // Single-owner handle for the running worker-layout supervisor. Only ONE
  // layout may run at a time: the initial FA2 (GraphControl) and a manually
  // selected worker layout (LayoutsControl) both register here. Registering a
  // new owner (or null) kills the previous supervisor first, so two layouts
  // never mutate the same node coordinates concurrently. Not reactive —
  // consumers read it via getState().
  activeLayoutSupervisor: LayoutSupervisorHandle | null
  setActiveLayoutSupervisor: (next: LayoutSupervisorHandle | null) => void
  // Release `handle` ONLY if it still owns the shared slot (clears it, which
  // kills it); otherwise just kill `handle` directly because a newer layout
  // already took the slot.
  releaseLayoutSupervisor: (handle: LayoutSupervisorHandle | null) => void

  // Legend color mapping methods
  setTypeColorMap: (typeColorMap: Map<string, string>) => void

  // Search engine methods
  setSearchEngine: (engine: MiniSearch | null) => void
  resetSearchEngine: () => void

  // Methods to set global flags
  setGraphDataFetchAttempted: (attempted: boolean) => void
  setLabelsFetchAttempted: (attempted: boolean) => void

  // Version counter to trigger data refresh
  graphDataVersion: number
  incrementGraphDataVersion: () => void
}

const useGraphStoreBase = create<GraphState>()((set, get) => ({
  selectedNode: null,
  focusedNode: null,
  selectedEdge: null,
  focusedEdge: null,

  moveToSelectedNode: false,
  isFetching: false,
  graphIsEmpty: false,
  lastSuccessfulQueryLabel: '', // Initialize as empty to ensure fetchAllDatabaseLabels runs on first query

  // Initialize global flags
  graphDataFetchAttempted: false,
  labelsFetchAttempted: false,

  rawGraph: null,
  sigmaGraph: null,
  sigmaInstance: null,

  graphNodeCount: 0,
  graphEdgeCount: 0,

  typeColorMap: new Map<string, string>(),

  searchEngine: null,

  setGraphIsEmpty: (isEmpty: boolean) => set({ graphIsEmpty: isEmpty }),
  setLastSuccessfulQueryLabel: (label: string) => set({ lastSuccessfulQueryLabel: label }),

  setIsFetching: (isFetching: boolean) => set({ isFetching }),

  isLayoutComputing: false,
  setIsLayoutComputing: (running: boolean) => set({ isLayoutComputing: running }),

  activeLayoutSupervisor: null,
  setActiveLayoutSupervisor: (next: LayoutSupervisorHandle | null) => {
    const prev = get().activeLayoutSupervisor
    if (prev && prev !== next) {
      try {
        prev.kill()
      } catch {
        /* worker already terminated */
      }
    }
    set({ activeLayoutSupervisor: next })
  },
  releaseLayoutSupervisor: (handle: LayoutSupervisorHandle | null) => {
    if (get().activeLayoutSupervisor === handle) {
      get().setActiveLayoutSupervisor(null) // clears the slot, killing `handle`
    } else {
      try {
        handle?.kill()
      } catch {
        /* worker already terminated */
      }
    }
  },

  setSelectedNode: (nodeId: string | null, moveToSelectedNode?: boolean) =>
    set({ selectedNode: nodeId, moveToSelectedNode }),
  setFocusedNode: (nodeId: string | null) => set({ focusedNode: nodeId }),
  setSelectedEdge: (edgeId: string | null) => set({ selectedEdge: edgeId }),
  setFocusedEdge: (edgeId: string | null) => set({ focusedEdge: edgeId }),
  clearSelection: () =>
    set({
      selectedNode: null,
      focusedNode: null,
      selectedEdge: null,
      focusedEdge: null
    }),
  reset: () => {
    set({
      selectedNode: null,
      focusedNode: null,
      selectedEdge: null,
      focusedEdge: null,
      rawGraph: null,
      sigmaGraph: null, // to avoid other components from acccessing graph objects
      searchEngine: null,
      moveToSelectedNode: false,
      graphIsEmpty: false,
      graphNodeCount: 0,
      graphEdgeCount: 0
    });
  },

  setRawGraph: (rawGraph: RawGraph | null) =>
    set({
      rawGraph
    }),

  setSigmaGraph: (sigmaGraph: DirectedGraph | null) => {
    // Replace graph instance, no need to keep WebGL context. Sync the reactive
    // counts in the SAME set call so "graph" and "counts" are never observed out
    // of step.
    set({
      sigmaGraph,
      graphNodeCount: sigmaGraph ? sigmaGraph.order : 0,
      graphEdgeCount: sigmaGraph ? sigmaGraph.size : 0
    });
  },

  setGraphCounts: (nodeCount: number, edgeCount: number) =>
    set({ graphNodeCount: nodeCount, graphEdgeCount: edgeCount }),

  setMoveToSelectedNode: (moveToSelectedNode?: boolean) => set({ moveToSelectedNode }),

  setSigmaInstance: (instance: any) => set({ sigmaInstance: instance }),

  setTypeColorMap: (typeColorMap: Map<string, string>) => set({ typeColorMap }),

  setSearchEngine: (engine: MiniSearch | null) => set({ searchEngine: engine }),
  resetSearchEngine: () => set({ searchEngine: null }),

  // Methods to set global flags
  setGraphDataFetchAttempted: (attempted: boolean) => set({ graphDataFetchAttempted: attempted }),
  setLabelsFetchAttempted: (attempted: boolean) => set({ labelsFetchAttempted: attempted }),

  // Version counter implementation
  graphDataVersion: 0,
  incrementGraphDataVersion: () => set((state) => ({ graphDataVersion: state.graphDataVersion + 1 }))
}))

const useGraphStore = createSelectors(useGraphStoreBase)

export { useGraphStore }
