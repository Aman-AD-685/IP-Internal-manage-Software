import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ContextMenuView } from './ContextMenu'
import type { ContextMenuState, OpenContextMenuOptions } from './types'
import { filterVisibleItems } from './utils'
import { buildActionButtonMenu } from './presets'

interface ContextMenuContextValue {
  openMenu: (options: OpenContextMenuOptions) => void
  closeMenu: () => void
  isOpen: boolean
}

const ContextMenuContext = createContext<ContextMenuContextValue | null>(null)

const initialState: ContextMenuState = {
  open: false,
  x: 0,
  y: 0,
  items: [],
  ariaLabel: 'Context menu',
}

export function GlobalContextMenuProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ContextMenuState>(initialState)

  const closeMenu = useCallback(() => {
    setState((s) => ({ ...s, open: false }))
  }, [])

  const openMenu = useCallback((options: OpenContextMenuOptions) => {
    const items = filterVisibleItems(options.items)
    if (!items.length) return
    setState({
      open: true,
      x: options.x,
      y: options.y,
      items,
      ariaLabel: options.ariaLabel ?? 'Context menu',
    })
  }, [])

  const value = useMemo(
    () => ({
      openMenu,
      closeMenu,
      isOpen: state.open,
    }),
    [openMenu, closeMenu, state.open],
  )

  // Any element with data-open-href gets Open in New Tab on right-click (header buttons, forms, etc.)
  useEffect(() => {
    const onContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (!target) return
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return

      const el = target.closest('[data-open-href]') as HTMLElement | null
      if (!el) return

      const href = el.getAttribute('data-open-href')?.trim()
      if (!href) return

      e.preventDefault()
      e.stopPropagation()

      const label =
        el.getAttribute('data-open-label')?.trim() ||
        el.textContent?.trim().slice(0, 48) ||
        'Page'
      const items = buildActionButtonMenu(href, label)
      openMenu({
        x: e.clientX,
        y: e.clientY,
        items,
        ariaLabel: `Actions for ${label}`,
      })
    }

    document.addEventListener('contextmenu', onContextMenu, true)
    return () => document.removeEventListener('contextmenu', onContextMenu, true)
  }, [openMenu])

  return (
    <ContextMenuContext.Provider value={value}>
      {children}
      <ContextMenuView
        open={state.open}
        x={state.x}
        y={state.y}
        items={state.items}
        ariaLabel={state.ariaLabel}
        onClose={closeMenu}
      />
    </ContextMenuContext.Provider>
  )
}

export function useContextMenu(): ContextMenuContextValue {
  const ctx = useContext(ContextMenuContext)
  if (!ctx) {
    throw new Error('useContextMenu must be used within GlobalContextMenuProvider')
  }
  return ctx
}
