/** Shared KPI colour thresholds: green ≥90%, amber 70–89%, red <70%. */

export type KpiThresholdLevel = 'high' | 'medium' | 'low'

export const KPI_THRESHOLD = {
  high: 90,
  medium: 70,
} as const

export const KPI_THRESHOLD_COLORS = {
  high: '#16A34A',
  medium: '#D97706',
  low: '#DC2626',
  neutral: '#64748B',
} as const

export function kpiThresholdLevel(value?: number | null): KpiThresholdLevel {
  const pct = typeof value === 'number' && Number.isFinite(value) ? value : 0
  if (pct >= KPI_THRESHOLD.high) return 'high'
  if (pct >= KPI_THRESHOLD.medium) return 'medium'
  return 'low'
}

export function kpiThresholdColor(value?: number | null): string {
  return KPI_THRESHOLD_COLORS[kpiThresholdLevel(value)]
}

export function kpiThresholdLabel(value?: number | null): string {
  const level = kpiThresholdLevel(value)
  if (level === 'high') return 'On track'
  if (level === 'medium') return 'Watch'
  return 'At risk'
}

/** Pill styles for KPI summary cards (replaces old High/Medium/Low 80/50 scale). */
export function kpiThresholdPillStyle(value?: number | null): {
  label: string
  background: string
  color: string
} {
  const level = kpiThresholdLevel(value)
  const color = KPI_THRESHOLD_COLORS[level]
  const background =
    level === 'high'
      ? 'rgba(22,163,74,0.15)'
      : level === 'medium'
        ? 'rgba(217,119,6,0.15)'
        : 'rgba(220,38,38,0.15)'
  return { label: kpiThresholdLabel(value), background, color }
}

/** Last N values from a week series (for sparklines). */
export function lastNWeeks(arr?: number[] | null, n = 4): number[] {
  if (!arr?.length) return []
  return arr.slice(-n).map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0))
}

export type KpiTrendDirection = 'up' | 'down' | 'flat'

/** Week-over-week from last two points; ±3pp deadband → flat. */
export function kpiTrendFromSeries(series?: number[] | null): {
  direction: KpiTrendDirection
  delta: number
} {
  if (!series || series.length < 2) return { direction: 'flat', delta: 0 }
  const a = series[series.length - 2] ?? 0
  const b = series[series.length - 1] ?? 0
  const delta = Math.round((b - a) * 10) / 10
  if (delta >= 3) return { direction: 'up', delta }
  if (delta <= -3) return { direction: 'down', delta }
  return { direction: 'flat', delta }
}
