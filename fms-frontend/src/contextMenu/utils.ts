import type { ContextMenuItemDef } from './types'
import { buildAppRouteUrl } from '../utils/authRedirect'

/** Clamp menu position so it stays inside the viewport. */
export function clampMenuPosition(
  clientX: number,
  clientY: number,
  menuWidth: number,
  menuHeight: number,
  padding = 8,
): { left: number; top: number } {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = clientX
  let top = clientY
  if (left + menuWidth + padding > vw) left = Math.max(padding, vw - menuWidth - padding)
  if (top + menuHeight + padding > vh) top = Math.max(padding, vh - menuHeight - padding)
  if (left < padding) left = padding
  if (top < padding) top = padding
  return { left, top }
}

/** Full same-origin URL for open-in-new-tab (preserves ?query and #hash). */
export function absoluteAppUrl(path: string): string {
  return buildAppRouteUrl(path)
}

export function openInNewTab(url: string): void {
  try {
    // Same-origin tabs share localStorage auth — no extra login prompt.
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    /* ignore */
  }
}

export function openInNewWindow(url: string): void {
  try {
    window.open(url, '_blank', 'noopener,noreferrer,width=1200,height=800')
  } catch {
    /* ignore */
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.left = '-9999px'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    } catch {
      return false
    }
  }
}

export function filterVisibleItems(items: ContextMenuItemDef[]): ContextMenuItemDef[] {
  return items
    .filter((it) => !it.hidden && (it.type === 'separator' || it.label))
    .map((it) =>
      it.children?.length
        ? { ...it, children: filterVisibleItems(it.children) }
        : it,
    )
}
