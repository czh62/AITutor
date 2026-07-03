import { useSigma } from '@react-sigma/core'
import { animateNodes } from 'sigma/utils'
import { useLayoutCirclepack } from '@react-sigma/layout-circlepack'
import { useLayoutCircular } from '@react-sigma/layout-circular'
import { useLayoutRandom } from '@react-sigma/layout-random'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import FA2Supervisor from 'graphology-layout-forceatlas2/worker'
import NoverlapSupervisor from 'graphology-layout-noverlap/worker'
import ForceSupervisor from 'graphology-layout-force/worker'
import { useCallback, useMemo, useState, useEffect, useRef } from 'react'

import Button from '@/components/ui/Button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import { controlButtonVariant, ANIMATE_NODE_LIMIT, workerBudgetMs } from '@/lib/constants'
import { useGraphStore } from '@/stores/graph'

import { GripIcon, PlayIcon, PauseIcon } from 'lucide-react'

type LayoutName =
  | 'Circular'
  | 'Circlepack'
  | 'Random'
  | 'Noverlaps'
  | 'Force Directed'
  | 'Force Atlas'

const LAYOUT_LABELS: Record<LayoutName, string> = {
  Circular: '环形布局',
  Circlepack: '圆形打包布局',
  Random: '随机布局',
  Noverlaps: '去重叠布局',
  'Force Directed': '力导向布局',
  'Force Atlas': 'Force Atlas 布局'
}

type WorkerLayoutName = 'Noverlaps' | 'Force Directed' | 'Force Atlas'
const WORKER_LAYOUTS: ReadonlySet<string> = new Set<WorkerLayoutName>([
  'Noverlaps',
  'Force Directed',
  'Force Atlas'
])

interface LayoutSupervisor {
  start: () => void
  stop: () => void
  kill: () => void
  isRunning: () => boolean
}

const buildSupervisor = (name: WorkerLayoutName, graph: unknown): LayoutSupervisor | null => {
  const order = (graph as { order: number }).order
  switch (name) {
    case 'Force Atlas':
      return new FA2Supervisor(graph as never, {
        settings: forceAtlas2.inferSettings(order)
      }) as unknown as LayoutSupervisor
    case 'Force Directed':
      return new ForceSupervisor(graph as never, {
        settings: {
          attraction: 0.0003,
          repulsion: 0.02,
          gravity: 0.02,
          inertia: 0.8,
          maxMove: 5
        }
      }) as unknown as LayoutSupervisor
    case 'Noverlaps':
      return new NoverlapSupervisor(graph as never, {
        settings: { margin: 10, expansion: 1.1, gridSize: 1, ratio: 1, speed: 3 }
      }) as unknown as LayoutSupervisor
    default:
      return null
  }
}

const WorkerLayoutControl = ({ layoutName }: { layoutName: WorkerLayoutName }) => {
  const sigma = useSigma()
  const sigmaGraph = useGraphStore.use.sigmaGraph()
  const [running, setRunning] = useState(false)
  const supervisorRef = useRef<LayoutSupervisor | null>(null)
  const stopTimerRef = useRef<number | null>(null)
  const startTimerRef = useRef<number | null>(null)

  const clearTimer = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current)
      stopTimerRef.current = null
    }
    if (startTimerRef.current !== null) {
      window.clearTimeout(startTimerRef.current)
      startTimerRef.current = null
    }
  }, [])

  const stop = useCallback(
    (settleView: boolean) => {
      clearTimer()
      try {
        supervisorRef.current?.stop()
      } catch (error) {
        console.error('Error stopping layout:', error)
      }
      setRunning(false)
      useGraphStore.getState().releaseLayoutSupervisor(supervisorRef.current)
      if (settleView) {
        try {
          sigma.setCustomBBox(null)
          sigma.refresh()
        } catch (error) {
          console.error('Error refreshing after layout:', error)
        }
      }
    },
    [clearTimer, sigma]
  )

  const start = useCallback(() => {
    const graph = useGraphStore.getState().sigmaGraph
    if (!graph || graph.order === 0) return

    clearTimer()

    try {
      supervisorRef.current?.kill()
    } catch {
      /* no live supervisor yet */
    }
    const supervisor = buildSupervisor(layoutName, graph)
    supervisorRef.current = supervisor
    if (!supervisor) return

    useGraphStore.getState().setActiveLayoutSupervisor(supervisor)

    try {
      sigma.setCustomBBox(null)
    } catch {
      /* ignore */
    }

    setRunning(true)
    startTimerRef.current = window.setTimeout(() => {
      startTimerRef.current = null
      if (supervisorRef.current !== supervisor) return
      try {
        supervisor.start()
      } catch (error) {
        console.error('Error starting layout:', error)
        setRunning(false)
        return
      }
      stopTimerRef.current = window.setTimeout(() => stop(true), workerBudgetMs(graph.order))
    }, 50)
  }, [layoutName, sigma, clearTimer, stop])

  useEffect(() => {
    start()
    return () => {
      clearTimer()
      useGraphStore.getState().releaseLayoutSupervisor(supervisorRef.current)
      supervisorRef.current = null
      setRunning(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutName, sigmaGraph])

  return (
    <Button
      size="icon"
      onClick={() => (running ? stop(false) : start())}
      tooltip={running ? '停止布局动画' : '开始布局动画'}
      variant={controlButtonVariant}
    >
      {running ? <PauseIcon /> : <PlayIcon />}
    </Button>
  )
}

const LayoutsControl = () => {
  const sigma = useSigma()
  const [layout, setLayout] = useState<LayoutName>('Circular')
  const [opened, setOpened] = useState<boolean>(false)

  const layoutCircular = useLayoutCircular()
  const layoutCirclepack = useLayoutCirclepack()
  const layoutRandom = useLayoutRandom()

  const syncLayouts = useMemo(() => {
    return {
      Circular: layoutCircular,
      Circlepack: layoutCirclepack,
      Random: layoutRandom
    } as Record<string, typeof layoutCircular>
  }, [layoutCircular, layoutCirclepack, layoutRandom])

  const allLayoutNames: LayoutName[] = useMemo(
    () => ['Circular', 'Circlepack', 'Random', 'Noverlaps', 'Force Directed', 'Force Atlas'],
    []
  )

  const runLayout = useCallback(
    (newLayout: LayoutName) => {
      console.debug('Running layout:', newLayout)

      if (WORKER_LAYOUTS.has(newLayout)) {
        setLayout(newLayout)
        setOpened(false)
        return
      }

      const graph = sigma.getGraph()
      if (!graph || graph.order === 0) {
        console.error('No graph available')
        return
      }

      const doLayout = () => {
        try {
          useGraphStore.getState().setActiveLayoutSupervisor(null)
          const pos = syncLayouts[newLayout].positions()
          sigma.setCustomBBox(null)
          if (graph.order > ANIMATE_NODE_LIMIT) {
            graph.updateEachNodeAttributes(
              (node, attr) => {
                const p = pos[node]
                if (p) {
                  attr.x = p.x
                  attr.y = p.y
                }
                return attr
              },
              { attributes: ['x', 'y'] }
            )
            sigma.refresh()
          } else {
            animateNodes(graph, pos, { duration: 400 })
          }
          sigma.getCamera().animatedReset()
          setLayout(newLayout)
        } catch (error) {
          console.error('Error running layout:', error)
        }
      }

      if (graph.order > ANIMATE_NODE_LIMIT) {
        useGraphStore.getState().setIsLayoutComputing(true)
        window.requestAnimationFrame(() => {
          try {
            doLayout()
          } finally {
            useGraphStore.getState().setIsLayoutComputing(false)
          }
        })
      } else {
        doLayout()
      }
      setOpened(false)
    },
    [syncLayouts, sigma]
  )

  return (
    <div>
      <div>
        {WORKER_LAYOUTS.has(layout) && (
          <WorkerLayoutControl layoutName={layout as WorkerLayoutName} />
        )}
      </div>
      <div>
        <Popover open={opened} onOpenChange={setOpened}>
          <PopoverTrigger asChild>
            <Button
              size="icon"
              variant={controlButtonVariant}
              onClick={() => setOpened((e: boolean) => !e)}
              tooltip="布局"
            >
              <GripIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={8}
            collisionPadding={5}
            sticky="always"
            className="min-w-auto p-1"
          >
            <div className="flex flex-col">
              {allLayoutNames.map((name) => (
                <button
                  key={name}
                  className={`cursor-pointer rounded px-2 py-1.5 text-left text-xs hover:bg-accent ${
                    name === layout ? 'bg-accent/60 font-medium' : ''
                  }`}
                  onClick={() => runLayout(name)}
                >
                  {LAYOUT_LABELS[name]}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

export default LayoutsControl
