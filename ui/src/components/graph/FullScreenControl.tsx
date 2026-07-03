import { useFullScreen } from '@react-sigma/core'
import { MaximizeIcon, MinimizeIcon } from 'lucide-react'
import { controlButtonVariant } from '@/lib/constants'
import Button from '@/components/ui/Button'

/**
 * 切换全屏模式。
 */
const FullScreenControl = () => {
  const { isFullScreen, toggle } = useFullScreen()

  return (
    <>
      {isFullScreen ? (
        <Button variant={controlButtonVariant} onClick={toggle} tooltip="退出全屏" size="icon">
          <MinimizeIcon />
        </Button>
      ) : (
        <Button variant={controlButtonVariant} onClick={toggle} tooltip="全屏" size="icon">
          <MaximizeIcon />
        </Button>
      )}
    </>
  )
}

export default FullScreenControl
