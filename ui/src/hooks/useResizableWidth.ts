import { useCallback, useEffect, useRef, useState } from 'react'

interface Options {
  /** 默认宽度（px） */
  initial: number
  /** 最小宽度（px） */
  min: number
  /** 最大宽度（px） */
  max: number
  /** 持久化到 localStorage 的 key；不传则不持久化 */
  storageKey?: string
}

/**
 * 左右分栏宽度拖动 hook。
 *
 * 用法：把返回的 width 绑到左侧面板的 style.width，把 resizerProps 绑到
 * 左右面板之间的拖动条元素（该元素必须是左侧面板的**下一个兄弟节点**，
 * 因为 onPointerDown 通过 previousElementSibling 读取左侧当前宽度）。
 *
 * - pointer events + setPointerCapture，鼠标移出拖动条仍能收到 move/up。
 * - 拖动期间给 body 设 user-select:none，避免选中文本。
 * - 宽度 clamp 到 [min, max]。
 * - 可选持久化到 localStorage，跨会话恢复。
 */
export function useResizableWidth({ initial, min, max, storageKey }: Options) {
  const [width, setWidth] = useState(() => {
    if (storageKey) {
      const saved = Number(localStorage.getItem(storageKey))
      if (saved >= min && saved <= max) return saved
    }
    return initial
  })

  // 拖动状态用 ref，避免回调依赖 width 导致频繁重建
  const stateRef = useRef({ dragging: false, startX: 0, startW: initial })

  useEffect(() => {
    if (!storageKey) return
    localStorage.setItem(storageKey, String(width))
  }, [width, storageKey])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return
      const left = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null
      stateRef.current = {
        dragging: true,
        startX: e.clientX,
        startW: left ? left.getBoundingClientRect().width : initial
      }
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      document.body.style.userSelect = 'none'
      e.preventDefault()
    },
    [initial]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const st = stateRef.current
      if (!st.dragging) return
      const dx = e.clientX - st.startX
      const nw = Math.max(min, Math.min(max, st.startW + dx))
      setWidth(nw)
    },
    [min, max]
  )

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const st = stateRef.current
    if (!st.dragging) return
    st.dragging = false
    document.body.style.userSelect = ''
    ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
  }, [])

  return {
    width,
    resizerProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp
    }
  }
}
