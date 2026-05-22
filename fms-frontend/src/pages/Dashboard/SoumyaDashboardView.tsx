import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Segmented, Select, Table, Tag, Typography } from 'antd'
import { ReloadOutlined, ThunderboltOutlined, UnorderedListOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import {
  dashboardKpiApi,
  MONTHS,
  YEARS,
  soumyaKpiCacheKey,
  type SoumyaDashboardResponse,
  type SoumyaCardDetailKey,
  type SoumyaCardDetailRow,
  type SoumyaDelayRankedTicket,
  type SoumyaTrendWeek,
} from '../../api/dashboardKpi'
import { sessionApiCacheGet } from '../../utils/sessionApiCache'
import {
  getDefaultPreviousWeekFilter,
  getKpiCalendarWeekBounds,
  isKpiMergedWeekAcrossMonths,
  maxWeekOfMonth,
  weekOfMonth,
} from './kpiWeekUtils'
import { SoumyaDashboardSkeleton, TableLoadMoreSkeleton } from '../../components/common/skeletons'
import { formatDelay } from '../../utils/helpers'
import './soumya-dashboard.css'

function formatDelayFromHours(hours: number | null | undefined): string {
  if (hours == null || Number.isNaN(hours)) return '—'
  return formatDelay(Math.max(0, Math.round(hours * 3600)))
}

function DelayTypesCell({ row }: { row: SoumyaDelayRankedTicket | SoumyaCardDetailRow }) {
  const messages =
    row.delay_messages && row.delay_messages.length > 0
      ? row.delay_messages
      : row.delay_label && row.delay_label !== '—'
        ? row.delay_label.split(' · ').map((s) => s.trim()).filter(Boolean)
        : []
  if (!messages.length) {
    return <span className="soumya-delay-types-cell">—</span>
  }
  return (
    <div className="soumya-delay-types-cell">
      {messages.map((msg, i) => (
        <span key={`${i}-${msg}`} className="soumya-delay-types-cell__line">
          {msg}
        </span>
      ))}
    </div>
  )
}

const { Text } = Typography
const RANKED_PAGE = 25

type LeaderboardScope = 'week' | 'all'

const CARD_MODAL_TITLES: Record<SoumyaCardDetailKey, string> = {
  stage2_volume: 'Stage 2 ticket volume – Details',
  avg_resolution: 'Avg resolution time – Details',
  escalation_frequency: 'Escalation frequency (72hr+) – Details',
  deadline_adherence: 'Deadline adherence rate – Details',
  weekly_sla_breach: 'Weekly SLA breach – Details',
  pending_staging: 'Pending Staging tickets – Details',
}

function TrendBars({
  weeks,
  field,
  variant = 'escalation',
  targetHours,
}: {
  weeks: SoumyaTrendWeek[]
  field: 'escalation_count' | 'sla_breach_count' | 'avg_resolution_hours'
  variant?: 'escalation' | 'breach' | 'resolution'
  targetHours?: number
}) {
  if (!weeks.length) {
    return (
      <Text type="secondary" style={{ fontSize: 12 }}>
        No trend data yet — hourly cron builds weekly history.
      </Text>
    )
  }
  const max = Math.max(1, ...weeks.map((w) => Number(w[field]) || 0))
  const breachAt = targetHours ?? 48
  return (
    <div className="soumya-trend" role="img" aria-label="Weekly trend">
      {weeks.map((w) => {
        const v = Number(w[field]) || 0
        const h = Math.max(8, (v / max) * 100)
        const overTarget = variant === 'resolution' && v > breachAt
        const title =
          variant === 'resolution'
            ? `${w.week_start}: ${formatDelayFromHours(v)} avg`
            : `${w.week_start}: ${v}`
        return (
          <div
            key={w.week_start}
            className={`soumya-trend__bar${
              (variant === 'breach' && v > 0) || overTarget ? ' soumya-trend__bar--breach' : ''
            }`}
            style={{ height: `${h}%` }}
            title={title}
          />
        )
      })}
    </div>
  )
}

function WrapCell({ value, className }: { value?: string; className?: string }) {
  return <span className={className ? `${className} soumya-col-wrap` : 'soumya-col-wrap'}>{value?.trim() || '—'}</span>
}

function RankBadge({ rank }: { rank: number }) {
  const cls =
    rank === 1
      ? 'soumya-rank-badge--1'
      : rank === 2
        ? 'soumya-rank-badge--2'
        : rank === 3
          ? 'soumya-rank-badge--3'
          : 'soumya-rank-badge--n'
  return <span className={`soumya-rank-badge ${cls}`}>{rank}</span>
}

const delayColumns: ColumnsType<SoumyaDelayRankedTicket> = [
  {
    title: '#',
    dataIndex: 'rank',
    width: 56,
    render: (r: number) => <RankBadge rank={r} />,
  },
  {
    title: 'Ref',
    dataIndex: 'reference_no',
    width: 132,
    className: 'soumya-col-ref-cell',
    render: (v: string) => (
      <Text code className="soumya-col-ref">
        {v || '—'}
      </Text>
    ),
  },
  {
    title: 'Title',
    dataIndex: 'title',
    width: 180,
    className: 'soumya-col-wrap-cell',
    render: (v: string) => <WrapCell value={v} />,
  },
  {
    title: 'Description',
    dataIndex: 'description',
    width: 200,
    className: 'soumya-col-wrap-cell',
    render: (v: string) => <WrapCell value={v} />,
  },
  {
    title: 'Company',
    dataIndex: 'company_name',
    width: 160,
    className: 'soumya-col-wrap-cell',
    render: (v: string) => <WrapCell value={v} className="soumya-col-company" />,
  },
  {
    title: 'Type',
    dataIndex: 'type',
    width: 72,
    render: (t: string) => (t ? <Tag>{t}</Tag> : '—'),
  },
  {
    title: 'Priority',
    dataIndex: 'priority',
    width: 72,
    render: (p: string) => (p ? <Tag color="volcano">{p}</Tag> : '—'),
  },
  {
    title: 'Delay',
    dataIndex: 'delay_display',
    width: 130,
    render: (_: string, row) => (
      <span className="soumya-delay-score">
        {row.delay_display || formatDelayFromHours(row.delay_hours)}
      </span>
    ),
  },
  {
    title: 'Delay types',
    dataIndex: 'delay_label',
    width: 280,
    render: (_: string, row) => <DelayTypesCell row={row} />,
  },
]

const cardDetailColumns: ColumnsType<SoumyaCardDetailRow> = [
  {
    title: 'Ref',
    dataIndex: 'reference_no',
    width: 132,
    className: 'soumya-col-ref-cell',
    render: (v: string) => (
      <Text code className="soumya-col-ref">
        {v || '—'}
      </Text>
    ),
  },
  {
    title: 'Title',
    dataIndex: 'title',
    width: 180,
    className: 'soumya-col-wrap-cell',
    render: (v: string) => <WrapCell value={v} />,
  },
  {
    title: 'Description',
    dataIndex: 'description',
    width: 220,
    className: 'soumya-col-wrap-cell',
    render: (v: string) => <WrapCell value={v} />,
  },
  {
    title: 'Company',
    dataIndex: 'company_name',
    width: 160,
    className: 'soumya-col-wrap-cell',
    render: (v: string) => <WrapCell value={v} className="soumya-col-company" />,
  },
  {
    title: 'Type',
    dataIndex: 'type',
    width: 72,
    render: (t: string) => (t ? <Tag>{t}</Tag> : '—'),
  },
  {
    title: 'Priority',
    dataIndex: 'priority',
    width: 72,
    render: (p: string) => (p ? <Tag color="volcano">{p}</Tag> : '—'),
  },
  {
    title: 'Delay',
    dataIndex: 'delay_display',
    width: 120,
    render: (_: string, row) => row.delay_display || formatDelayFromHours(row.delay_hours),
  },
]

interface SoumyaDashboardViewProps {
  onRefresh?: () => void
}

export function SoumyaDashboardView({ onRefresh }: SoumyaDashboardViewProps) {
  const previousWeekDefaults = getDefaultPreviousWeekFilter()
  const [month, setMonth] = useState<string>(MONTHS[previousWeekDefaults.monthIndex] ?? MONTHS[dayjs().month()])
  const [year, setYear] = useState<string>(previousWeekDefaults.year || String(dayjs().year()))
  const [week, setWeek] = useState<string>(`week ${previousWeekDefaults.week}`)
  const [leaderboardScope, setLeaderboardScope] = useState<LeaderboardScope>('week')

  const [data, setData] = useState<SoumyaDashboardResponse | null>(null)
  const [rankedRows, setRankedRows] = useState<SoumyaDelayRankedTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [cardModal, setCardModal] = useState<{ key: SoumyaCardDetailKey; title: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadGenRef = useRef(0)

  const monthIndexSel = MONTHS.findIndex((m) => m === month)
  const yearNum = Number(year)
  const maxWeekSelectable =
    monthIndexSel >= 0 && Number.isFinite(yearNum)
      ? maxWeekOfMonth(dayjs().year(yearNum).month(monthIndexSel).date(1))
      : 5
  const weekOptions = Array.from({ length: maxWeekSelectable }, (_, i) => ({
    label: `week ${i + 1}`,
    value: `week ${i + 1}`,
  }))

  useEffect(() => {
    if (monthIndexSel < 0 || !Number.isFinite(yearNum)) return
    const maxWeek = maxWeekOfMonth(dayjs().year(yearNum).month(monthIndexSel).date(1))
    const parsed = Number((week || '').replace(/[^\d]/g, '')) || weekOfMonth(dayjs())
    if (parsed > maxWeek) setWeek(`week ${maxWeek}`)
  }, [month, year, week, monthIndexSel, yearNum])

  const fetchPage = useCallback(
    async (reset: boolean) => {
      const gen = ++loadGenRef.current
      const offset = reset ? 0 : rankedRows.length
      const requestParams = {
        month,
        year,
        week,
        leaderboard_scope: leaderboardScope,
        ranked_offset: offset,
        ranked_limit: RANKED_PAGE,
      }
      if (reset) {
        const cacheKey = soumyaKpiCacheKey({
          month,
          year,
          week,
          leaderboard_scope: leaderboardScope,
          ranked_offset: 0,
          ranked_limit: RANKED_PAGE,
        })
        const cached = sessionApiCacheGet<SoumyaDashboardResponse>(cacheKey)
        if (cached?.success !== false) {
          setData(cached)
          setHasMore(!!cached.meta?.has_more)
          setRankedRows(cached.delay_ranked_tickets ?? [])
          setLoading(false)
          setError(null)
        } else {
          setLoading(true)
          setError(null)
        }
      } else {
        setLoadingMore(true)
      }
      try {
        const res = await dashboardKpiApi.getSoumyaKpi(requestParams)
        if (gen !== loadGenRef.current) return
        setData(res)
        setHasMore(!!res.meta?.has_more)
        setRankedRows((prev) =>
          reset ? res.delay_ranked_tickets ?? [] : [...prev, ...(res.delay_ranked_tickets ?? [])],
        )
        if (reset) onRefresh?.()
      } catch {
        if (gen !== loadGenRef.current) return
        if (reset) {
          setError('Failed to load Soumya dashboard metrics.')
          setData(null)
          setRankedRows([])
        }
      } finally {
        if (gen === loadGenRef.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [month, year, week, leaderboardScope, rankedRows.length, onRefresh],
  )

  useEffect(() => {
    void fetchPage(true)
  }, [month, year, week, leaderboardScope]) // eslint-disable-line react-hooks/exhaustive-deps

  const rankedLenRef = useRef(0)
  rankedLenRef.current = rankedRows.length

  const loadMore = useCallback(() => {
    if (loading || loadingMore || !hasMore) return
    void (async () => {
      const gen = ++loadGenRef.current
      setLoadingMore(true)
      try {
        const res = await dashboardKpiApi.getSoumyaKpi({
          month,
          year,
          week,
          leaderboard_scope: leaderboardScope,
          ranked_offset: rankedLenRef.current,
          ranked_limit: RANKED_PAGE,
        })
        if (gen !== loadGenRef.current) return
        setData(res)
        setHasMore(!!res.meta?.has_more)
        setRankedRows((prev) => [...prev, ...(res.delay_ranked_tickets ?? [])])
      } finally {
        if (gen === loadGenRef.current) setLoadingMore(false)
      }
    })()
  }, [hasMore, loading, loadingMore, month, year, week, leaderboardScope])

  const onTableScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) loadMore()
  }

  const openCardModal = (key: SoumyaCardDetailKey) => {
    setCardModal({ key, title: CARD_MODAL_TITLES[key] })
  }

  const cardModalRows: SoumyaCardDetailRow[] = cardModal
    ? (data?.card_details?.[cardModal.key] ?? [])
    : []

  const weekNumDisplay = Number((week || '').replace(/[^\d]/g, '')) || 1
  const mergedFromLocal =
    monthIndexSel >= 0 &&
    Number.isFinite(yearNum) &&
    isKpiMergedWeekAcrossMonths(yearNum, monthIndexSel, weekNumDisplay)
  const localBounds =
    monthIndexSel >= 0 && Number.isFinite(yearNum)
      ? getKpiCalendarWeekBounds(yearNum, monthIndexSel, weekNumDisplay)
      : null
  const mergeRangeText =
    data?.meta?.week_label ||
    (localBounds ? `${localBounds.start.format('D MMM')} – ${localBounds.end.format('D MMM YYYY')}` : '')

  if (loading && !data) {
    return <SoumyaDashboardSkeleton />
  }

  if (error && !data) {
    return (
      <Alert
        type="error"
        showIcon
        message={error}
        action={
          <Button size="small" onClick={() => void fetchPage(true)}>
            Retry
          </Button>
        }
      />
    )
  }

  const cards = data?.cards
  if (!cards || !data) return null

  const c1 = cards.stage2_volume
  const c2 = cards.avg_resolution
  const c4 = cards.deadline_adherence
  const c6 = cards.weekly_sla_breach
  const cStaging = cards.pending_staging

  const detailCount = (key: SoumyaCardDetailKey) => data.card_details?.[key]?.length ?? 0
  const dataAsOfLabel = data.meta?.data_as_of
    ? dayjs(data.meta.data_as_of).format('DD MMM YYYY, HH:mm')
    : null

  const leaderboardSubtext =
    leaderboardScope === 'all'
      ? `Stage 2 completed (all time). Ranked by longest Stage 2 duration. Demo C excluded. Pool: ${data.meta?.leaderboard_pool_size ?? rankedRows.length}.`
      : `Stage 2 completed in selected week${mergeRangeText ? ` (${mergeRangeText})` : ''}. Ranked by highest delay first. Demo C excluded.`

return (
    <div className="soumya-dash">
      <div className="soumya-dash-hero">
        <div>
          <h2>
            <ThunderboltOutlined style={{ marginRight: 8, color: '#4a6bff' }} />
            Soumya Dashboard
          </h2>
          <p>
            KPI cards use the selected calendar week (default: previous week) — query arrival in that week. Demo C
            excluded. Staging is live pending queue.
          </p>
        </div>
        <div className="soumya-dash-meta">
          <div>Week tickets: {data.meta?.total_tickets_scanned ?? 0}</div>
          <div>Ranked: {data.meta?.total_ranked ?? rankedRows.length}</div>
          <div>Updated: {data.generated_at ? dayjs(data.generated_at).format('DD MMM YYYY, HH:mm') : '—'}</div>
          <Button
            type="text"
            icon={<ReloadOutlined />}
            onClick={() => void fetchPage(true)}
            loading={loading}
            style={{ color: '#4a6bff', marginTop: 8 }}
          >
            Refresh
          </Button>
        </div>
      </div>

      <div className="dashboard-kpi-filters soumya-dash-filters">
        <span className="dashboard-kpi-filter-field">
          <Text className="dashboard-kpi-filter-label">Month</Text>
          <Select
            value={month}
            onChange={setMonth}
            options={MONTHS.map((m) => ({ label: m, value: m }))}
            className="dashboard-kpi-filter-select"
            popupClassName="dashboard-kpi-select-dropdown"
          />
        </span>
        <span className="dashboard-kpi-filter-field">
          <Text className="dashboard-kpi-filter-label">Year</Text>
          <Select
            value={year}
            onChange={setYear}
            options={YEARS.map((y) => ({ label: y, value: y }))}
            className="dashboard-kpi-filter-select"
            popupClassName="dashboard-kpi-select-dropdown"
          />
        </span>
        <span className="dashboard-kpi-filter-field">
          <Text className="dashboard-kpi-filter-label">Week</Text>
          <Select
            value={week}
            onChange={setWeek}
            options={weekOptions}
            className="dashboard-kpi-filter-select dashboard-kpi-filter-select--week"
            popupClassName="dashboard-kpi-select-dropdown"
          />
          {mergedFromLocal ? (
            <Tag className="dashboard-kpi-merge-tag">Merged week</Tag>
          ) : null}
        </span>
      </div>
      {mergeRangeText ? (
        <Text className="dashboard-kpi-merge-hint">
          Calendar week: {mergeRangeText}
          {dataAsOfLabel ? ` · Week KPIs measured as of ${dataAsOfLabel}` : null}
        </Text>
      ) : null}

      <div className="soumya-kpi-grid soumya-kpi-grid--4">
        <article
          className="soumya-kpi-card soumya-kpi-card--clickable"
          role="button"
          tabIndex={0}
          onClick={() => openCardModal('stage2_volume')}
          onKeyDown={(e) => e.key === 'Enter' && openCardModal('stage2_volume')}
        >
          <div className="soumya-kpi-card__label">
            {detailCount('stage2_volume') > 0 ? (
              <UnorderedListOutlined className="soumya-kpi-card__list-icon" title="View details" />
            ) : null}
          </div>
          <div className="soumya-kpi-card__title">Stage 2 ticket volume</div>
          <div className="soumya-buckets">
            <div className="soumya-bucket" style={{ borderColor: c1.colors.safe }}>
              <div className="soumya-bucket__val" style={{ color: c1.colors.safe }}>
                {c1.bucket_0_24}
              </div>
              <div className="soumya-bucket__lbl">{c1.labels.safe}</div>
            </div>
            <div className="soumya-bucket" style={{ borderColor: c1.colors.warning }}>
              <div className="soumya-bucket__val" style={{ color: c1.colors.warning }}>
                {c1.bucket_24_72}
              </div>
              <div className="soumya-bucket__lbl">{c1.labels.warning}</div>
            </div>
            <div className="soumya-bucket" style={{ borderColor: c1.colors.breach }}>
              <div className="soumya-bucket__val" style={{ color: c1.colors.breach }}>
                {c1.bucket_72_plus}
              </div>
              <div className="soumya-bucket__lbl">{c1.labels.breach}</div>
            </div>
          </div>
          <span className="soumya-target-pill">Open at Stage 2: {c1.total}</span>
          {detailCount('stage2_volume') > 0 ? (
            <span className="soumya-card-hint">Click for {detailCount('stage2_volume')} tickets</span>
          ) : null}
        </article>

        <article className="soumya-kpi-card soumya-kpi-card--combo">
          <div
            className="soumya-kpi-card__main soumya-kpi-card--clickable"
            role="button"
            tabIndex={0}
            onClick={() => openCardModal('avg_resolution')}
            onKeyDown={(e) => e.key === 'Enter' && openCardModal('avg_resolution')}
          >
          <div className="soumya-kpi-card__label">
            {detailCount('avg_resolution') > 0 ? (
              <UnorderedListOutlined className="soumya-kpi-card__list-icon" title="View resolution details" />
            ) : null}
          </div>
          <div className="soumya-kpi-card__title">Avg resolution time</div>
          <div className={`soumya-metric-big soumya-metric-big--${c2.status === 'green' ? 'ok' : 'bad'}`}>
            {c2.avg_display}
          </div>
          <TrendBars
            weeks={c2.trend_weeks ?? []}
            field="avg_resolution_hours"
            variant="resolution"
            targetHours={c2.target_hours}
          />
          {detailCount('avg_resolution') > 0 ? (
            <span className="soumya-card-hint">Click for {detailCount('avg_resolution')} tickets</span>
          ) : null}
          </div>
          <div
            className="soumya-kpi-sla-mini soumya-kpi-card--clickable"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation()
              openCardModal('weekly_sla_breach')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation()
                openCardModal('weekly_sla_breach')
              }
            }}
          >
            <div className="soumya-kpi-sla-mini__head">
              <span className="soumya-kpi-sla-mini__title">Weekly SLA breach count</span>
              {detailCount('weekly_sla_breach') > 0 ? (
                <UnorderedListOutlined className="soumya-kpi-card__list-icon" title="View breach details" />
              ) : null}
            </div>
            <div
              className={`soumya-kpi-sla-mini__val ${c6.on_target ? 'soumya-kpi-sla-mini__val--ok' : 'soumya-kpi-sla-mini__val--bad'}`}
            >
              {c6.count_this_week}
            </div>
            <span className="soumya-kpi-sla-mini__meta">
              Target = {c6.weekly_total ?? c6.target} weekly · goal 0 breach
            </span>
          </div>
        </article>

        <article
          className="soumya-kpi-card soumya-kpi-card--clickable"
          role="button"
          tabIndex={0}
          onClick={() => openCardModal('deadline_adherence')}
          onKeyDown={(e) => e.key === 'Enter' && openCardModal('deadline_adherence')}
        >
          <div className="soumya-kpi-card__label">
            {detailCount('deadline_adherence') > 0 ? (
              <UnorderedListOutlined className="soumya-kpi-card__list-icon" title="View details" />
            ) : null}
          </div>
          <div className="soumya-kpi-card__title">Deadline adherence rate</div>
          <div
            className={`soumya-metric-big soumya-metric-big--${
              c4.status === 'green' ? 'ok' : c4.status === 'red' ? 'bad' : 'neutral'
            }`}
          >
            {c4.percent_display ?? (c4.has_data === false ? '—' : `${c4.percent}%`)}
          </div>
          <span
            className={
              !c4.has_data
                ? 'soumya-target-pill'
                : c4.on_target
                  ? 'soumya-target-pill'
                  : 'soumya-target-pill soumya-target-pill--fail'
            }
          >
            {c4.has_data
              ? `Target ${c4.target_percent}%+ · ${c4.on_time}/${c4.total_with_deadline} on time`
              : 'No closed tickets with deadline in selected week'}
          </span>
          <p className="soumya-card-formula">
            Chores/bugs that arrived and closed in this week: % closed on or before committed deadline (or Stage 3 + 2h /
            query + 1 day if not set).
          </p>
          {detailCount('deadline_adherence') > 0 ? (
            <span className="soumya-card-hint">Click for {detailCount('deadline_adherence')} tickets</span>
          ) : null}
        </article>

        {cStaging ? (
          <article
            className="soumya-kpi-card soumya-kpi-card--clickable soumya-kpi-card--staging"
            role="button"
            tabIndex={0}
            onClick={() => openCardModal('pending_staging')}
            onKeyDown={(e) => e.key === 'Enter' && openCardModal('pending_staging')}
          >
            <div className="soumya-kpi-card__label">
              Staging
              {detailCount('pending_staging') > 0 ? (
                <UnorderedListOutlined className="soumya-kpi-card__list-icon" title="View details" />
              ) : null}
            </div>
            <div className="soumya-kpi-card__title">Pending Staging tickets</div>
            <div
              className={`soumya-metric-big ${cStaging.total === 0 ? 'soumya-metric-big--ok' : 'soumya-metric-big--warn'}`}
            >
              {cStaging.total}
            </div>
            <span className="soumya-target-pill">
              Chores/Bugs: {cStaging.chores_bugs} · Features: {cStaging.features}
            </span>
            <p className="soumya-card-formula">Live queue — not limited to selected week.</p>
            {detailCount('pending_staging') > 0 ? (
              <span className="soumya-card-hint">Click for {detailCount('pending_staging')} tickets</span>
            ) : null}
          </article>
        ) : null}
      </div>

      <section className="soumya-delay-section">
        <div className="soumya-delay-section__head">
          <div>
            <h3>Delay leaderboard</h3>
            <p className="sub">{leaderboardSubtext}</p>
          </div>
          <Segmented<LeaderboardScope>
            className="soumya-leaderboard-scope"
            value={leaderboardScope}
            onChange={(v) => setLeaderboardScope(v)}
            options={[
              { label: 'Previous Week data', value: 'week' },
              { label: 'All data', value: 'all' },
            ]}
          />
        </div>
        <div ref={scrollRef} className="soumya-delay-scroll" onScroll={onTableScroll}>
          <Table
            className="soumya-delay-table"
            rowKey={(r) => r.id || r.reference_no || String(r.rank)}
            columns={delayColumns}
            dataSource={rankedRows}
            pagination={false}
            size="small"
            scroll={{ x: 1140 }}
          />
          {loadingMore ? <TableLoadMoreSkeleton rows={3} columns={7} /> : null}
          {!hasMore && rankedRows.length > 0 ? (
            <div className="soumya-delay-end">End of list</div>
          ) : null}
        </div>
      </section>

      <Modal
        title={cardModal?.title}
        open={!!cardModal}
        onCancel={() => setCardModal(null)}
        footer={null}
        width={920}
        destroyOnClose
        className="soumya-detail-modal"
      >
        <Table
          rowKey={(r) => r.id || r.reference_no || r.title || String(Math.random())}
          columns={cardDetailColumns}
          dataSource={cardModalRows}
          pagination={cardModalRows.length > 12 ? { pageSize: 12 } : false}
          size="small"
          scroll={{ x: 1012 }}
        />
      </Modal>
    </div>
  )
}
