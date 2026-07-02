import { useCamera, useSigma } from '@react-sigma/core'
import { useCallback } from 'react'
import Button from '@/components/ui/Button'
import { ZoomInIcon, ZoomOutIcon, FullscreenIcon, RotateCwIcon, RotateCcwIcon } from 'lucide-react'
import { controlButtonVariant } from '@/lib/constants'

/**
 * 图谱缩放与旋转控制。
 */
const ZoomControl = () => {
  const { zoomIn, zoomOut, reset } = useCamera({ duration: 200, factor: 1.5 })
  const sigma = useSigma()

  const handleZoomIn = useCallback(() => zoomIn(), [zoomIn])
  const handleZoomOut = useCallback(() => zoomOut(), [zoomOut])
  const handleResetZoom = useCallback(() => {
    if (!sigma) return

    try {
      sigma.setCustomBBox(null)
      sigma.refresh()

      const graph = sigma.getGraph()

      if (!graph?.order || graph.nodes().length === 0) {
        reset()
        return
      }

      sigma.getCamera().animate(
        { x: 0.5, y: 0.5, ratio: 1.1 },
        { duration: 1000 }
      )
    } catch (error) {
      console.error('Error resetting zoom:', error)
      reset()
    }
  }, [sigma, reset])

  const handleRotate = useCallback(() => {
    if (!sigma) return

    const camera = sigma.getCamera()
    const newAngle = camera.angle + Math.PI / 8

    camera.animate({ angle: newAngle }, { duration: 200 })
  }, [sigma])

  const handleRotateCounterClockwise = useCallback(() => {
    if (!sigma) return

    const camera = sigma.getCamera()
    const newAngle = camera.angle - Math.PI / 8

    camera.animate({ angle: newAngle }, { duration: 200 })
  }, [sigma])

  return (
    <>
      <Button
        variant={controlButtonVariant}
        onClick={handleRotate}
        tooltip="顺时针旋转"
        size="icon"
      >
        <RotateCwIcon />
      </Button>
      <Button
        variant={controlButtonVariant}
        onClick={handleRotateCounterClockwise}
        tooltip="逆时针旋转"
        size="icon"
      >
        <RotateCcwIcon />
      </Button>
      <Button
        variant={controlButtonVariant}
        onClick={handleResetZoom}
        tooltip="重置缩放"
        size="icon"
      >
        <FullscreenIcon />
      </Button>
      <Button variant={controlButtonVariant} onClick={handleZoomIn} tooltip="放大" size="icon">
        <ZoomInIcon />
      </Button>
      <Button variant={controlButtonVariant} onClick={handleZoomOut} tooltip="缩小" size="icon">
        <ZoomOutIcon />
      </Button>
    </>
  )
}

export default ZoomControl
