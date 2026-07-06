import dayjs from 'dayjs'
import type { Dayjs } from 'dayjs'

/** Same IST offset as legacy `getDefaultPreviousWeekFilter` — KPIs are reviewed on India calendar. */
export function dayjsFromIstNow(): Dayjs {
  const nowIst = new Date(Date.now() + (330 - new Date().getTimezoneOffset()) * 60_000)
  return dayjs(nowIst)
}

/**
 * KPI week index (1-based) aligned with backend `week_of_month_for_date`:
 * anchor = Monday of the ISO week containing the 1st of the month → full Mon–Sun weeks (may overlap adjacent months).
 */
export function weekOfMonth(d: Dayjs): number {
  const ref = d.startOf('day')
  const first = ref.startOf('month')
  const jsDow = first.day()
  const pyWd = (jsDow + 6) % 7
  const anchor = first.subtract(pyWd, 'day')
  const diffDays = ref.diff(anchor.startOf('day'), 'day')
  return Math.max(1, Math.floor(diffDays / 7) + 1)
}

export function maxWeekOfMonth(reference: Dayjs): number {
  const end = reference.daysInMonth()
  let maxWeek = 1
  for (let day = 1; day <= end; day += 1) {
    const d = reference.date(day)
    maxWeek = Math.max(maxWeek, weekOfMonth(d))
  }
  return maxWeek
}

/** Monday-start / Sunday-end KPI week bounds for filters (aligned with backend). */
export function getKpiCalendarWeekBounds(
  year: number,
  monthIndexZero: number,
  weekIndexOne: number,
): { start: Dayjs; end: Dayjs } | null {
  if (
    !Number.isFinite(year) ||
    monthIndexZero < 0 ||
    monthIndexZero > 11 ||
    weekIndexOne < 1
  )
    return null
  const ref = dayjs().year(year).month(monthIndexZero).date(1)
  const maxW = maxWeekOfMonth(ref)
  if (weekIndexOne > maxW) return null
  const first = ref.startOf('month').startOf('day')
  const pyWd = (first.day() + 6) % 7
  const anchor = first.subtract(pyWd, 'day')
  const start = anchor.add((weekIndexOne - 1) * 7, 'day')
  const end = start.add(6, 'day').endOf('day')
  return { start: start.startOf('day'), end }
}

/** True when selected month filter’s KPI week overlaps a different calendar month (merged week UX). */
export function isKpiMergedWeekAcrossMonths(
  year: number,
  monthIndexZero: number,
  weekIndexOne: number,
): boolean {
  const b = getKpiCalendarWeekBounds(year, monthIndexZero, weekIndexOne)
  if (!b) return false
  const ym = refMonthYear(year, monthIndexZero)
  return monthYearOf(b.start) !== ym || monthYearOf(b.end) !== ym
}

function refMonthYear(year: number, monthIndexZero: number): string {
  return `${year}-${monthIndexZero}`
}

function monthYearOf(d: Dayjs): string {
  return `${d.year()}-${d.month()}`
}

/** KPI week indices shown in the month dropdown (excludes last slot if it continues in the next month). */
export function listKpiWeekIndicesForMonth(year: number, monthIndexZero: number): number[] {
  const ref = dayjs().year(year).month(monthIndexZero).date(1)
  const maxW = maxWeekOfMonth(ref)
  const filterYm = refMonthYear(year, monthIndexZero)
  const weeks: number[] = []
  for (let w = 1; w <= maxW; w += 1) {
    const bounds = getKpiCalendarWeekBounds(year, monthIndexZero, w)
    if (!bounds) continue
    if (monthYearOf(bounds.end) !== filterYm) continue
    weeks.push(w)
  }
  return weeks.length ? weeks : [1]
}

export function buildKpiWeekSelectOptions(year: number, monthIndexZero: number) {
  return listKpiWeekIndicesForMonth(year, monthIndexZero).map((w) => ({
    label: `week ${w}`,
    value: `week ${w}`,
  }))
}

/**
 * Trailing merged weeks (e.g. Jun week 5 → 29 Jun–5 Jul) map to the next calendar month, week 1.
 */
export function resolveKpiCanonicalWeekFilter(
  year: number,
  monthIndexZero: number,
  weekIndexOne: number,
): { year: number; monthIndexZero: number; weekIndexOne: number } {
  const bounds = getKpiCalendarWeekBounds(year, monthIndexZero, weekIndexOne)
  if (!bounds) return { year, monthIndexZero, weekIndexOne }
  const filterYm = refMonthYear(year, monthIndexZero)
  if (monthYearOf(bounds.end) === filterYm) {
    return { year, monthIndexZero, weekIndexOne }
  }
  const nextYear = bounds.end.year()
  const nextMonth = bounds.end.month()
  const weekOne = getKpiCalendarWeekBounds(nextYear, nextMonth, 1)
  if (weekOne?.start.isSame(bounds.start, 'day')) {
    return { year: nextYear, monthIndexZero: nextMonth, weekIndexOne: 1 }
  }
  return { year, monthIndexZero, weekIndexOne }
}

export function getKpiCanonicalWeekSelection(
  monthLabel: string,
  yearStr: string,
  weekStr: string,
  months: readonly string[],
): { month: string; year: string; week: string } | null {
  const monthIndex = months.indexOf(monthLabel)
  if (monthIndex < 0) return null
  const y = Number(yearStr)
  if (!Number.isFinite(y)) return null
  const weekNum = Number(weekStr.replace(/[^\d]/g, '')) || 1
  const canonical = resolveKpiCanonicalWeekFilter(y, monthIndex, weekNum)
  if (
    canonical.year === y &&
    canonical.monthIndexZero === monthIndex &&
    canonical.weekIndexOne === weekNum
  ) {
    return null
  }
  return {
    month: months[canonical.monthIndexZero],
    year: String(canonical.year),
    week: `week ${canonical.weekIndexOne}`,
  }
}

export function getDefaultPreviousWeekFilter() {
  const safe = dayjsFromIstNow().subtract(7, 'day')
  const rawMonthIndex = safe.month()
  const rawYear = safe.year()
  const rawWeek = weekOfMonth(safe)
  const canonical = resolveKpiCanonicalWeekFilter(rawYear, rawMonthIndex, rawWeek)
  return {
    monthIndex: canonical.monthIndexZero,
    year: String(canonical.year),
    week: canonical.weekIndexOne,
  }
}
