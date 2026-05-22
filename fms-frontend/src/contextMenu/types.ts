import type { ReactNode } from 'react'

export type ContextMenuAction = () => void | Promise<void>

export interface ContextMenuItemDef {
  id: string
  label?: string
  icon?: ReactNode
  shortcut?: string
  disabled?: boolean
  loading?: boolean
  danger?: boolean
  hidden?: boolean
  type?: 'separator'
  children?: ContextMenuItemDef[]
  onSelect?: ContextMenuAction
}

export interface OpenContextMenuOptions {
  x: number
  y: number
  items: ContextMenuItemDef[]
  ariaLabel?: string
}

export interface ContextMenuState {
  open: boolean
  x: number
  y: number
  items: ContextMenuItemDef[]
  ariaLabel: string
}
