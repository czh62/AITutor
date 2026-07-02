import { useCallback, useEffect, useRef, useState } from 'react'

export interface DragPos {
  x: number
  y: number
}

/**
 * 弹窗拖动 hook。
 *
 * 用法：把 `pos` 作为内联 style 的 left/top，把 `dragHandleProps` 绑到
 * 拖动手柄元素（通常是 DialogHeader）。首次打开时 pos 为 null，由调用方
 * 渲染为居中默认定位；首次拖动后转为绝对坐标。
 *
 * onDragStart 在拖动开始时触发，调用方可用于将定位模式从"居中默认"
 * 切换到"绝对坐标"。
 */
export function useDraggable(initial?: DragPos | null) {
  const [pos, setPos] = useState<DragPos | null>(initial ?? null)
  // 拖动起点：鼠标 down 时的屏幕坐标 + 弹窗当前坐标
  const dragOrigin = useRef<{ mouseX: number; mouseY: number; posX: number; posY: number } | null>(null)
  const draggingRef = useRef(false)

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      // 仅响应主键（左键）；忽略 form 控件 / 按钮，避免与点击冲突
      if (e.button !== 0) return
      const target = e.target as HTMLElement
      if (target.closest('button, input, select, textarea, a')) return

      const rect = (e.currentTarget.closest('[data-draggable]') as HTMLElement | null)?.getBoundingClientRect()
      const startX = rect ? rect.left : e.clientX
      const startY = rect ? rect.top : e.clientY
      dragOrigin.current = { mouseX: e.clientX, mouseY: e.clientY, posX: startX, posY: startY }
      draggingRef.current = true
      // 捕获指针，确保移出元素仍能收到 move/up
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      e.preventDefault()
    },
    []
  )

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current || !dragOrigin.current) return
    const dx = e.clientX - dragOrigin.current.mouseX
    const dy = e.clientY - dragOrigin.current.mouseY
    let nx = dragOrigin.current.posX + dx
    let ny = dragOrigin.current.posY + dy
    // 限制在视口内（留出少量边距，避免完全拖出屏幕）
    const w = window.innerWidth
    const h = window.innerHeight
    nx = Math.max(8, Math.min(nx, w - 8))
    ny = Math.max(8, Math.min(ny, h - 8))
    setPos({ x: nx, y: ny })
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return
    draggingRef.current = false
    dragOrigin.current = null
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  }, [])

  const reset = useCallback(() => setPos(null), [])

  // 窗口尺寸变化时，若已拖动到屏外则复位
  useEffect(() => {
    const onResize = () => {
      if (!pos) return
      const w = window.innerWidth
      const h = window.innerHeight
      setPos({
        x: Math.min(pos.x, w - 8),
        y: Math.min(pos.y, h - 8)
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [pos])

  return {
    pos,
    reset,
    dragHandleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      style: { cursor: draggingRef.current ? 'grabbing' : 'grab', touchAction: 'none' } as React.CSSProperties
    }
  }
}
