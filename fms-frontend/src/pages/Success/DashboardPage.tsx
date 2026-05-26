import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, DatePicker, Skeleton, Typography } from 'antd'
import dayjs from 'dayjs'
import { dashboardApi } from '../../api/dashboard'
import { sessionApiCacheGet } from '../../utils/sessionApiCache'
import { DashboardTable } from './dashboard/DashboardTable'
import { WeeklyCard } from './dashboard/WeeklyCard'
import type { MainDashboardRow, WeeklyRow } from './dashboard/types'
import {
  type PerformanceListItem,
  filterItemsByMonth,
  sortByCreatedDesc,
  weekOfMonthInSelection,
  performanceItemToMainRow,
  performanceItemToWeeklyRow,
} from './dashboard/suDashPerformance'
import './dashboard/su-dash.css'

const { Title } = Typography

interface DashboardData {
  week1: WeeklyRow[]
  week2: WeeklyRow[]
  week3: WeeklyRow[]
  week4: WeeklyRow[]
  summary: MainDashboardRow[]
}

function computeDashboard(raw: PerformanceListItem[], month: dayjs.Dayjs): DashboardData {
  const inMonth = filterItemsByMonth(raw, month)
  const sorted = sortByCreatedDesc(inMonth)
  const w1: WeeklyRow[] = []
  const w2: WeeklyRow[] = []
  const w3: WeeklyRow[] = []
  const w4: WeeklyRow[] = []
  for (const it of sorted) {
    const row = performanceItemToWeeklyRow(it)
    const bucket = weekOfMonthInSelection(it.created_at, month)
    if (bucket === 1) w1.push(row)
    else if (bucket === 2) w2.push(row)
    else if (bucket === 3) w3.push(row)
    else w4.push(row)
  }
  return {
    week1: w1,
    week2: w2,
    week3: w3,
    week4: w4,
    summary: sorted.map(performanceItemToMainRow),
  }
}

export function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [rawItems, setRawItems] = useState<PerformanceListItem[]>([])
  const [month, setMonth] = useState(() => dayjs().startOf('month'))

  const loadPerformanceData = useCallback(async () => {
    setSetupError(null)
    const cachedOpen = sessionApiCacheGet<{ items?: PerformanceListItem[] }>(
      'dashboard:success-performance-list:in_progress:exclude_na',
    )
    const cachedDone = sessionApiCacheGet<{ items?: PerformanceListItem[] }>(
      'dashboard:success-performance-list:completed:exclude_na',
    )
    if (cachedOpen?.items?.length || cachedDone?.items?.length) {
      const merged = [...(cachedOpen?.items || []), ...(cachedDone?.items || [])]
      const byId = new Map<string, PerformanceListItem>()
      for (const row of merged) {
        if (row.id) byId.set(row.id, row)
      }
      setRawItems([...byId.values()])
      setLoading(false)
    } else {
      setLoading(true)
    }
    try {
      const [openData, doneData] = await Promise.all([
        dashboardApi.getSuccessPerformanceList('in_progress'),
        dashboardApi.getSuccessPerformanceList('completed'),
      ])
      const merged: PerformanceListItem[] = [...(openData.items || []), ...(doneData.items || [])]
      const byId = new Map<string, PerformanceListItem>()
      for (const row of merged) {
        if (row.id) byId.set(row.id, row)
      }
      setRawItems([...byId.values()])
    } catch (e) {
      const ax = e as { response?: { status?: number; data?: { detail?: string } } }
      if (ax.response?.status === 503) {
        setSetupError(ax.response?.data?.detail || 'Run database/SUCCESS_PERFORMANCE_MONITORING.sql in Supabase.')
      } else {
        setSetupError('Failed to load performance data.')
      }
      setRawItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPerformanceData()
  }, [loadPerformanceData])

  const data = useMemo(() => computeDashboard(rawItems, month), [rawItems, month])

  const weekCards = useMemo(
    () => [
      { title: 'WEEK - 1', rows: data.week1 },
      { title: 'WEEK - 2', rows: data.week2 },
      { title: 'WEEK - 3', rows: data.week3 },
      { title: 'WEEK - 4', rows: data.week4 },
    ],
    [data]
  )

  return (
    <div className="su-dash-page">
      <div className="su-dash-toolbar">
        <div className="su-dash-toolbar__month">
          <span className="su-dash-toolbar__label">Month</span>
          <DatePicker
            picker="month"
            allowClear={false}
            format="MMM YYYY"
            value={month}
            onChange={(v) => {
              if (v) setMonth(v.startOf('month'))
            }}
          />
        </div>
        <Title level={4} className="su-dash-title page-main-heading">
          Customer Success Dashboard
        </Title>
        <div className="su-dash-toolbar__spacer" aria-hidden />
      </div>

      {setupError && (
        <Alert type="warning" message={setupError} showIcon style={{ marginBottom: 12 }} />
      )}

      {loading ? (
        <div className="su-loading-wrap">
          <Skeleton active title={{ width: '36%' }} paragraph={{ rows: 10 }} />
        </div>
      ) : (
        <>
          <div className="su-week-grid">
            {weekCards.map((card) => (
              <WeeklyCard key={card.title} title={card.title} rows={card.rows} />
            ))}
          </div>
          <DashboardTable rows={data.summary} />
        </>
      )}
    </div>
  )
}
