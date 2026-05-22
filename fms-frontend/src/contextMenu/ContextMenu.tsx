import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { RightOutlined } from '@ant-design/icons'
import type { ContextMenuItemDef } from './types'
import { clampMenuPosition, filterVisibleItems } from './utils'
import './contextMenu.css'

function visibleItems(items: ContextMenuItemDef[]): ContextMenuItemDef[] {
  return filterVisibleItems(items)
}

interface ItemListProps {
  items: ContextMenuItemDef[]
  focusedPath: string | null
  openSubPath: string | null
  onFocusPath: (path: string | null) => void
  onOpenSub: (path: string | null) => void
  onSelect: (item: ContextMenuItemDef) => void
}

function ContextMenuItemList({
  items,
  focusedPath,
  openSubPath,
  onFocusPath,
  onOpenSub,
  onSelect,
}: ItemListProps) {
  const visible = visibleItems(items)

  return (
    <>
      {visible.map((it) => {
        if (it.type === 'separator') {
          return <div key={it.id} className="ip-context-menu__separator" role="separator" />
        }
        const hasChildren = Boolean(it.children?.length)
        const isFocused = focusedPath === it.id
        const isSubOpen = openSubPath === it.id

        return (
          <div
            key={it.id}
            style={{ position: 'relative' }}
            onMouseEnter={() => {
              onFocusPath(it.id)
              onOpenSub(hasChildren ? it.id : null)
            }}
          >
            <button
              type="button"
              role="menuitem"
              data-cm-item={it.id}
              className={[
                'ip-context-menu__item',
                isFocused ? 'ip-context-menu__item--focused' : '',
                it.danger ? 'ip-context-menu__item--danger' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              disabled={it.disabled || it.loading}
              aria-haspopup={hasChildren ? 'menu' : undefined}
              aria-expanded={hasChildren ? isSubOpen : undefined}
              onClick={() => {
                if (hasChildren) {
                  onOpenSub(isSubOpen ? null : it.id)
                  return
                }
                if (!it.disabled && !it.loading) onSelect(it)
              }}
            >
              <span className="ip-context-menu__icon" aria-hidden>
                {it.loading ? <span className="ip-context-menu__spinner" /> : it.icon}
              </span>
              <span className="ip-context-menu__label">{it.label}</span>
              {it.shortcut ? <span className="ip-context-menu__shortcut">{it.shortcut}</span> : null}
              {hasChildren ? <RightOutlined className="ip-context-menu__chevron" /> : null}
            </button>
            {hasChildren && isSubOpen && it.children ? (
              <SubMenuFlyout
                anchorId={it.id}
                items={it.children}
                focusedPath={focusedPath}
                openSubPath={openSubPath}
                onFocusPath={onFocusPath}
                onOpenSub={onOpenSub}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        )
      })}
    </>
  )
}

function SubMenuFlyout({
  anchorId,
  items,
  focusedPath,
  openSubPath,
  onFocusPath,
  onOpenSub,
  onSelect,
}: ItemListProps & { anchorId: string }) {
  const [pos, setPos] = useState({ left: 0, top: 0 })

  useLayoutEffect(() => {
    const btn = document.querySelector(`[data-cm-item="${anchorId}"]`)?.parentElement
    const el = btn ?? document.activeElement
    if (!(el instanceof HTMLElement)) return
    const rect = el.getBoundingClientRect()
    const w = 210
    const h = Math.min(items.length * 36 + 16, 360)
    setPos(clampMenuPosition(rect.right - 2, rect.top, w, h))
  }, [anchorId, items.length])

  return createPortal(
    <div
      className="ip-context-menu ip-context-menu__submenu"
      style={{ left: pos.left, top: pos.top, position: 'fixed' }}
      role="menu"
    >
      <ContextMenuItemList
        items={items}
        focusedPath={focusedPath}
        openSubPath={openSubPath}
        onFocusPath={onFocusPath}
        onOpenSub={onOpenSub}
        onSelect={onSelect}
      />
    </div>,
    document.body,
  )
}

export interface ContextMenuViewProps {
  open: boolean
  x: number
  y: number
  items: ContextMenuItemDef[]
  ariaLabel: string
  onClose: () => void
}

export function ContextMenuView({ open, x, y, items, ariaLabel, onClose }: ContextMenuViewProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const [openSubPath, setOpenSubPath] = useState<string | null>(null)

  const visible = visibleItems(items)
  const focusable = visible.filter((it) => it.type !== 'separator' && !it.disabled)

  useLayoutEffect(() => {
    if (!open) return
    const el = menuRef.current
    const w = el?.offsetWidth ?? 240
    const h = el?.offsetHeight ?? 280
    setPosition(clampMenuPosition(x, y, w, h))
  }, [open, x, y, items])

  useEffect(() => {
    if (!open) return
    setFocusedPath(focusable[0]?.id ?? null)
    setOpenSubPath(null)
    requestAnimationFrame(() => menuRef.current?.focus())
  }, [open])

  const runSelect = useCallback(
    async (item: ContextMenuItemDef) => {
      if (item.disabled || item.loading || !item.onSelect) return
      onClose()
      try {
        await item.onSelect()
      } catch {
        /* caller handles */
      }
    },
    [onClose],
  )

  const moveFocus = useCallback(
    (delta: number) => {
      if (!focusable.length) return
      const idx = focusable.findIndex((f) => f.id === focusedPath)
      const next = (idx + delta + focusable.length) % focusable.length
      const node = focusable[next]!
      setFocusedPath(node.id)
      setOpenSubPath(node.children?.length ? node.id : null)
    },
    [focusable, focusedPath],
  )

  useEffect(() => {
    if (!open) return

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        moveFocus(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        moveFocus(-1)
        return
      }
      if (e.key === 'ArrowRight') {
        const cur = focusable.find((f) => f.id === focusedPath)
        if (cur?.children?.length) {
          e.preventDefault()
          setOpenSubPath(cur.id)
        }
        return
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setOpenSubPath(null)
        return
      }
      if (e.key === 'Enter') {
        e.preventDefault()
        const cur = focusable.find((f) => f.id === focusedPath)
        if (cur?.children?.length) setOpenSubPath(cur.id)
        else if (cur) void runSelect(cur)
      }
    }

    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t)) return
      const inSub = Array.from(document.querySelectorAll('.ip-context-menu__submenu')).some((el) =>
        el.contains(t),
      )
      if (inSub) return
      onClose()
    }

    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onPointer, true)
    window.addEventListener('scroll', onClose, true)
    window.addEventListener('resize', onClose)

    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onPointer, true)
      window.removeEventListener('scroll', onClose, true)
      window.removeEventListener('resize', onClose)
    }
  }, [open, focusedPath, focusable, moveFocus, onClose, runSelect])

  if (typeof document === 'undefined') return null

  return createPortal(
    <AnimatePresence>
      {open && visible.length > 0 ? (
        <>
          <motion.div
            className="ip-context-menu-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.1 }}
            aria-hidden
          />
          <motion.div
            ref={menuRef}
            className="ip-context-menu"
            style={{ left: position.left, top: position.top, position: 'fixed' }}
            role="menu"
            aria-label={ariaLabel}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
          >
            <ContextMenuItemList
              items={visible}
              focusedPath={focusedPath}
              openSubPath={openSubPath}
              onFocusPath={setFocusedPath}
              onOpenSub={setOpenSubPath}
              onSelect={(it) => void runSelect(it)}
            />
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body,
  )
}
