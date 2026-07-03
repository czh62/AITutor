import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '@/stores/settings'
import { useGraphStore } from '@/stores/graph'
import {
  dropdownDisplayLimit,
  controlButtonVariant,
  popularLabelsDefaultLimit,
  searchLabelsDefaultLimit
} from '@/lib/constants'
import { RefreshCw } from 'lucide-react'
import Button from '@/components/ui/Button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import { getPopularLabels, searchLabels } from '@/api/aitutor'

/**
 * 标签选择下拉框：选择要查询的实体标签（* 表示全局图谱）。
 * 自包含异步 combobox（不依赖 react-select / AsyncSelect）。
 */
const GraphLabels = () => {
  const label = useSettingsStore.use.queryLabel()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<string[]>(['*'])
  const popularRef = useRef<string[] | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 拉取选项列表：空查询用热门标签，否则后端搜索
  const fetchOptions = useCallback(async (q: string) => {
    let results: string[]
    if (!q.trim() || q.trim() === '*') {
      if (popularRef.current === null) {
        try {
          const popular = await getPopularLabels(popularLabelsDefaultLimit)
          popularRef.current = popular
        } catch (error) {
          console.error('Failed to fetch popular labels:', error)
          popularRef.current = []
        }
      }
      results = popularRef.current.slice(0, dropdownDisplayLimit)
    } else {
      try {
        const apiResults = await searchLabels(q.trim(), searchLabelsDefaultLimit)
        results = apiResults.length <= dropdownDisplayLimit
          ? apiResults
          : [...apiResults.slice(0, dropdownDisplayLimit), '...']
      } catch (error) {
        console.error('Search labels failed:', error)
        results = []
      }
    }
    // 始终把 * 置顶，并去重
    setOptions(['*', ...results.filter((l) => l !== '*')])
  }, [])

  // 下拉打开时加载热门标签
  useEffect(() => {
    if (open) {
      fetchOptions(query)
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // 输入变化时防抖搜索
  useEffect(() => {
    if (!open) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      fetchOptions(query)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, open, fetchOptions])

  const handleSelect = useCallback(
    (newLabel: string) => {
      if (newLabel === '...') {
        newLabel = '*'
      }
      // 重复选中同一标签（非 *）时切回全局
      const currentLabel = useSettingsStore.getState().queryLabel
      if (newLabel === currentLabel && newLabel !== '*') {
        newLabel = '*'
      }

      useGraphStore.getState().setGraphDataFetchAttempted(false)
      useSettingsStore.getState().setQueryLabel(newLabel)
      useGraphStore.getState().incrementGraphDataVersion()
      setOpen(false)
    },
    []
  )

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    // 清空图例颜色缓存，刷新后重新生成
    useGraphStore.getState().setTypeColorMap(new Map<string, string>())

    let currentLabel = label
    if (!currentLabel || currentLabel.trim() === '') {
      useSettingsStore.getState().setQueryLabel('*')
      currentLabel = '*'
    }

    // 强制重新拉取热门标签
    popularRef.current = null

    useGraphStore.getState().setGraphDataFetchAttempted(false)
    useGraphStore.getState().setLastSuccessfulQueryLabel('')
    useGraphStore.getState().incrementGraphDataVersion()

    try {
      await fetchOptions(query)
    } catch (error) {
      console.error('Error during refresh:', error)
    } finally {
      setIsRefreshing(false)
    }
  }, [label, query, fetchOptions])

  const refreshTooltip = isRefreshing
    ? '正在刷新...'
    : !label || label === '*'
      ? '刷新全局图谱'
      : `刷新当前标签：${label}`

  return (
    <div className="flex items-center">
      <Button
        size="icon"
        variant={controlButtonVariant}
        onClick={handleRefresh}
        tooltip={refreshTooltip}
        className="mr-2"
        disabled={isRefreshing}
      >
        <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
      </Button>
      <div className="w-full min-w-[280px] max-w-[500px]">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="bg-background/60 flex h-8 w-full min-w-[280px] items-center justify-between rounded-md border px-3 text-sm backdrop-blur-lg hover:opacity-100"
              title="选择标签"
            >
              <span className="truncate text-left">{label || '*'}</span>
              <span className="ml-2 text-xs text-gray-400">▾</span>
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={4}
            collisionPadding={8}
            className="w-80 p-2"
          >
            <input
              className="mb-2 w-full rounded border px-2 py-1 text-sm focus:outline-none"
              placeholder="搜索标签..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="max-h-72 overflow-auto">
              {options.length === 0 ? (
                <div className="py-6 text-center text-sm text-gray-500">暂无标签</div>
              ) : (
                options.map((opt) => (
                  <div
                    key={opt}
                    className={`cursor-pointer truncate rounded px-2 py-1.5 text-sm hover:bg-accent ${
                      opt === label ? 'bg-accent/60 font-medium' : ''
                    }`}
                    title={opt}
                    onClick={() => handleSelect(opt)}
                  >
                    {opt}
                  </div>
                ))
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
}

export default GraphLabels
