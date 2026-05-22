import { useCallback, useRef } from 'react'
import type { TouchEvent, MouseEvent } from 'react'
import { useContextMenu } from './GlobalContextMenuProvider'
import type { ContextMenuItemDef } from './types'
import { filterVisibleItems } from './utils'

const LONG_PRESS_MS = 520
const MOVE_CANCEL_PX = 12

export interface UseContextMenuTriggerOptions {
  disabled?: boolean
  ariaLabel?: string
}

/**
 * Returns props to spread on any element for right-click + mobile long-press.
 */
export function useContextMenuTrigger(
  getItems: (event: MouseEvent | TouchEvent) => ContextMenuItemDef[] | null | undefined,
  options?: UseContextMenuTriggerOptions,
) {
  const { openMenu } = useContextMenu()
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const clearLongPress = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    touchStartRef.current = null
  }, [])

  const showMenu = useCallback(
    (clientX: number, clientY: number, nativeEvent: MouseEvent | TouchEvent) => {
      if (options?.disabled) return
      const raw = getItems(nativeEvent as MouseEvent)
      const items = raw ? filterVisibleItems(raw) : []
      if (!items.length) return
      openMenu({
        x: clientX,
        y: clientY,
        items,
        ariaLabel: options?.ariaLabel,
      })
    },
    [getItems, openMenu, options?.disabled, options?.ariaLabel],
  )

  const onContextMenu = useCallback(
    (e: MouseEvent) => {
      if (options?.disabled) return
      e.preventDefault()
      e.stopPropagation()
      showMenu(e.clientX, e.clientY, e)
    },
    [showMenu, options?.disabled],
  )

  const onTouchStart = useCallback(
    (e: TouchEvent) => {
      if (options?.disabled) return
      const t = e.touches[0]
      if (!t) return
      touchStartRef.current = { x: t.clientX, y: t.clientY }
      clearLongPress()
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (touchStartRef.current) {
          showMenu(touchStartRef.current.x, touchStartRef.current.y, e)
        }
      }, LONG_PRESS_MS)
    },
    [clearLongPress, showMenu, options?.disabled],
  )

  const onTouchEnd = useCallback(() => {
    clearLongPress()
  }, [clearLongPress])

  const onTouchMove = useCallback(
    (e: TouchEvent) => {
      const start = touchStartRef.current
      const t = e.touches[0]
      if (!start || !t) return
      const dx = Math.abs(t.clientX - start.x)
      const dy = Math.abs(t.clientY - start.y)
      if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) clearLongPress()
    },
    [clearLongPress],
  )

  return {
    onContextMenu,
    onTouchStart,
    onTouchEnd,
    onTouchMove,
  }
}
