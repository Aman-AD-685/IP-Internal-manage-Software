import type { CSSProperties, ReactNode } from 'react'

interface ContextMenuTargetProps {
  /** In-app path for open-in-new-tab (e.g. /dashboard-kpi?person=Aman) */
  openHref: string
  /** Menu label when right-clicking */
  openLabel?: string
  children: ReactNode
  className?: string
  style?: CSSProperties
}

/**
 * Wraps buttons/links so right-click shows Open in New Tab (via global data-open-href handler).
 */
export function ContextMenuTarget({
  openHref,
  openLabel,
  children,
  className,
  style,
}: ContextMenuTargetProps) {
  return (
    <span
      data-open-href={openHref}
      data-open-label={openLabel}
      className={className}
      style={{ display: 'inline-block', ...style }}
    >
      {children}
    </span>
  )
}
