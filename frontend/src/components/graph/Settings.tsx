import { useState, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import Checkbox from '@/components/ui/Checkbox'
import Button from '@/components/ui/Button'

import { controlButtonVariant, EDGE_PERF_LIMIT } from '@/lib/constants'
import { useSettingsStore } from '@/stores/settings'
import { useGraphStore } from '@/stores/graph'

import { SettingsIcon, Undo2 } from 'lucide-react'

/** 简易分隔线（避免引入 @radix-ui/react-separator）。 */
const Separator = () => <div className="h-px bg-border my-1" />

/**
 * 带标签的复选框。
 */
const LabeledCheckBox = ({
  checked,
  onCheckedChange,
  label,
  disabled,
  title
}: {
  checked: boolean
  onCheckedChange: () => void
  label: string
  disabled?: boolean
  title?: string
}) => {
  const id = `checkbox-${label.toLowerCase().replace(/\s+/g, '-')}`

  return (
    <div
      className={`flex items-center gap-2${disabled ? ' cursor-not-allowed opacity-50' : ''}`}
      title={title}
    >
      <Checkbox id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      <label
        htmlFor={id}
        className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      >
        {label}
      </label>
    </div>
  )
}

/**
 * 带标签的数字输入框。
 */
const LabeledNumberInput = ({
  value,
  onEditFinished,
  label,
  min,
  max,
  defaultValue
}: {
  value: number
  onEditFinished: (value: number) => void
  label: string
  min: number
  max?: number
  defaultValue?: number
}) => {
  const [currentValue, setCurrentValue] = useState<number | null>(value)
  const id = `input-${label.toLowerCase().replace(/\s+/g, '-')}`

  const currentValueRef = useRef(currentValue)
  const valueRef = useRef(value)
  const onEditFinishedRef = useRef(onEditFinished)
  useLayoutEffect(() => {
    currentValueRef.current = currentValue
    valueRef.current = value
    onEditFinishedRef.current = onEditFinished
  })

  const [previousValue, setPreviousValue] = useState(value)
  if (value !== previousValue) {
    setPreviousValue(value)
    setCurrentValue(value)
  }

  useEffect(() => {
    return () => {
      const cur = currentValueRef.current
      if (cur !== null && cur !== valueRef.current) {
        onEditFinishedRef.current(cur)
      }
    }
  }, [])

  const onValueChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const text = e.target.value.trim()
      if (text.length === 0) {
        setCurrentValue(null)
        return
      }
      const newValue = Number.parseInt(text)
      if (!isNaN(newValue) && newValue !== currentValue) {
        if (min !== undefined && newValue < min) return
        if (max !== undefined && newValue > max) return
        setCurrentValue(newValue)
      }
    },
    [currentValue, min, max]
  )

  const onBlur = useCallback(() => {
    if (currentValue !== null && value !== currentValue) {
      onEditFinished(currentValue)
    }
  }, [value, currentValue, onEditFinished])

  const handleReset = useCallback(() => {
    if (defaultValue !== undefined && value !== defaultValue) {
      setCurrentValue(defaultValue)
      onEditFinished(defaultValue)
    }
  }, [defaultValue, value, onEditFinished])

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={id}
        className="text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
      >
        {label}
      </label>
      <div className="flex items-center gap-1">
        <input
          id={id}
          type="number"
          value={currentValue === null ? '' : currentValue}
          onChange={onValueChange}
          className="h-6 w-full min-w-0 rounded border px-1 pr-1 focus:outline-none"
          min={min}
          max={max}
          onBlur={onBlur}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onBlur()
          }}
        />
        {defaultValue !== undefined && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0 hover:bg-muted text-muted-foreground hover:text-foreground"
            onClick={handleReset}
            type="button"
            title="恢复默认"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  )
}

// 需要 useEffect（LabeledNumberInput 的 unmount 提交逻辑）

/**
 * 设置弹出面板（只读查看器子集）。
 */
export default function Settings() {
  const [opened, setOpened] = useState<boolean>(false)

  const showPropertyPanel = useSettingsStore.use.showPropertyPanel()
  const showNodeSearchBar = useSettingsStore.use.showNodeSearchBar()
  const showNodeLabel = useSettingsStore.use.showNodeLabel()
  const enableEdgeEvents = useSettingsStore.use.enableEdgeEvents()
  const graphEdgeCount = useGraphStore.use.graphEdgeCount()
  const enableNodeDrag = useSettingsStore.use.enableNodeDrag()
  const enableHideUnselectedEdges = useSettingsStore.use.enableHideUnselectedEdges()
  const showEdgeLabel = useSettingsStore.use.showEdgeLabel()
  const minEdgeSize = useSettingsStore.use.minEdgeSize()
  const maxEdgeSize = useSettingsStore.use.maxEdgeSize()
  const graphQueryMaxDepth = useSettingsStore.use.graphQueryMaxDepth()
  const graphMaxNodes = useSettingsStore.use.graphMaxNodes()
  const backendMaxGraphNodes = useSettingsStore.use.backendMaxGraphNodes()

  const setEnableNodeDrag = useCallback(
    () => useSettingsStore.setState((pre) => ({ enableNodeDrag: !pre.enableNodeDrag })),
    []
  )
  const setEnableEdgeEvents = useCallback(
    () => useSettingsStore.setState((pre) => ({ enableEdgeEvents: !pre.enableEdgeEvents })),
    []
  )
  const setEnableHideUnselectedEdges = useCallback(
    () =>
      useSettingsStore.setState((pre) => ({
        enableHideUnselectedEdges: !pre.enableHideUnselectedEdges
      })),
    []
  )
  const setShowEdgeLabel = useCallback(
    () => useSettingsStore.setState((pre) => ({ showEdgeLabel: !pre.showEdgeLabel })),
    []
  )
  const setShowPropertyPanel = useCallback(
    () => useSettingsStore.setState((pre) => ({ showPropertyPanel: !pre.showPropertyPanel })),
    []
  )
  const setShowNodeSearchBar = useCallback(
    () => useSettingsStore.setState((pre) => ({ showNodeSearchBar: !pre.showNodeSearchBar })),
    []
  )
  const setShowNodeLabel = useCallback(
    () => useSettingsStore.setState((pre) => ({ showNodeLabel: !pre.showNodeLabel })),
    []
  )

  const setGraphQueryMaxDepth = useCallback((depth: number) => {
    if (depth < 1) return
    useSettingsStore.setState({ graphQueryMaxDepth: depth })
    useGraphStore.getState().setGraphDataFetchAttempted(false)
  }, [])

  const setGraphMaxNodes = useCallback((nodes: number) => {
    const maxLimit = backendMaxGraphNodes || 1000
    if (nodes < 1 || nodes > maxLimit) return
    useSettingsStore.getState().setGraphMaxNodes(nodes, true)
  }, [backendMaxGraphNodes])

  const saveSettings = () => setOpened(false)

  return (
    <Popover open={opened} onOpenChange={setOpened}>
      <PopoverTrigger asChild>
        <Button variant={controlButtonVariant} tooltip="设置" size="icon">
          <SettingsIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="end"
        sideOffset={8}
        collisionPadding={5}
        className="p-2 max-w-[200px]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex flex-col gap-2">
          <LabeledCheckBox
            checked={showPropertyPanel}
            onCheckedChange={setShowPropertyPanel}
            label="显示属性面板"
          />
          <LabeledCheckBox
            checked={showNodeSearchBar}
            onCheckedChange={setShowNodeSearchBar}
            label="显示搜索栏"
          />

          <Separator />

          <LabeledCheckBox
            checked={showNodeLabel}
            onCheckedChange={setShowNodeLabel}
            label="显示节点标签"
          />
          <LabeledCheckBox
            checked={enableNodeDrag}
            onCheckedChange={setEnableNodeDrag}
            label="节点可拖拽"
          />

          <Separator />

          <LabeledCheckBox
            checked={showEdgeLabel}
            onCheckedChange={setShowEdgeLabel}
            label="显示边标签"
          />
          <LabeledCheckBox
            checked={enableHideUnselectedEdges}
            onCheckedChange={setEnableHideUnselectedEdges}
            label="隐藏未选中边"
          />
          <LabeledCheckBox
            checked={enableEdgeEvents}
            onCheckedChange={setEnableEdgeEvents}
            label="边事件"
            disabled={graphEdgeCount > EDGE_PERF_LIMIT}
            title={
              graphEdgeCount > EDGE_PERF_LIMIT
                ? `边数超过 ${EDGE_PERF_LIMIT}，已禁用边事件`
                : undefined
            }
          />

          <div className="flex flex-col gap-2">
            <label htmlFor="edge-size-min" className="text-sm leading-none font-medium">
              边粗细范围
            </label>
            <div className="flex items-center gap-2">
              <input
                id="edge-size-min"
                type="number"
                value={minEdgeSize}
                onChange={(e) => {
                  const newValue = Number(e.target.value)
                  if (!isNaN(newValue) && newValue >= 1 && newValue <= maxEdgeSize) {
                    useSettingsStore.setState({ minEdgeSize: newValue })
                  }
                }}
                className="h-6 w-16 min-w-0 rounded border px-1 focus:outline-none"
                min={1}
                max={Math.min(maxEdgeSize, 10)}
              />
              <span>-</span>
              <div className="flex items-center gap-1">
                <input
                  id="edge-size-max"
                  type="number"
                  value={maxEdgeSize}
                  onChange={(e) => {
                    const newValue = Number(e.target.value)
                    if (!isNaN(newValue) && newValue >= minEdgeSize && newValue >= 1 && newValue <= 10) {
                      useSettingsStore.setState({ maxEdgeSize: newValue })
                    }
                  }}
                  className="h-6 w-16 min-w-0 rounded border px-1 focus:outline-none"
                  min={minEdgeSize}
                  max={10}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0 hover:bg-muted text-muted-foreground hover:text-foreground"
                  onClick={() => useSettingsStore.setState({ minEdgeSize: 1, maxEdgeSize: 5 })}
                  type="button"
                  title="恢复默认"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <Separator />
          <LabeledNumberInput
            label="最大查询深度"
            min={1}
            value={graphQueryMaxDepth}
            defaultValue={3}
            onEditFinished={setGraphQueryMaxDepth}
          />
          <LabeledNumberInput
            label={`最大节点数 (≤ ${backendMaxGraphNodes || 1000})`}
            min={1}
            max={backendMaxGraphNodes || 1000}
            value={graphMaxNodes}
            defaultValue={backendMaxGraphNodes || 1000}
            onEditFinished={setGraphMaxNodes}
          />

          <Button
            onClick={saveSettings}
            variant="outline"
            size="sm"
            className="ml-auto px-4"
          >
            保存
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
