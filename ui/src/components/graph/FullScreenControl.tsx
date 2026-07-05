import { useFullScreen } from '@react-sigma/core'
import { MaximizeIcon, MinimizeIcon } from 'lucide-react'
import { controlButtonVariant } from '@/lib/constants'
import Button from '@/components/ui/Button'

/**
 * 切换Fullscreen模式。
 */
const FullScreenControl = () => {
  const { isFullScreen, toggle } = useFullScreen()

  return (
    <>
      {isFullScreen ? (
        <Button variant={controlButtonVariant} onClick={toggle} tooltip="Exit Fullscreen" size="icon">
          <MinimizeIcon />
        </Button>
      ) : (
        <Button variant={controlButtonVariant} onClick={toggle} tooltip="Fullscreen" size="icon">
          <MaximizeIcon />
        </Button>
      )}
    </>
  )
}

export default FullScreenControl
