import { useCallback } from 'react'
import { BookOpenIcon } from 'lucide-react'
import Button from '@/components/ui/Button'
import { controlButtonVariant } from '@/lib/constants'
import { useSettingsStore } from '@/stores/settings'

/**
 * 切换Legend显示/隐藏。
 */
const LegendButton = () => {
  const showLegend = useSettingsStore.use.showLegend()
  const setShowLegend = useSettingsStore.use.setShowLegend()

  const toggleLegend = useCallback(() => {
    setShowLegend(!showLegend)
  }, [showLegend, setShowLegend])

  return (
    <Button
      variant={controlButtonVariant}
      onClick={toggleLegend}
      tooltip="Legend"
      size="icon"
    >
      <BookOpenIcon />
    </Button>
  )
}

export default LegendButton
