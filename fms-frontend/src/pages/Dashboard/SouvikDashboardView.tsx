import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  DatePicker,
  InputNumber,
  Space,
  Table,
  Tabs,
  Tag,
  Typography,
  message,
} from 'antd'
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import {
  dashboardKpiApi,
  type SouvikKpiWeekResponse,
  type SouvikReferenceResponse,
  type SouvikWeeklyLogRow,
} from '../../api/dashboardKpi'

const { Text } = Typography

/** Snap any date to the Monday of its week. */
function mondayOf(d: Dayjs): Dayjs {
  // dayjs: 0 = Sunday .. 6 = Saturday; ISO Monday start.
  const dow = d.day()
  const diff = dow === 0 ? -6 : 1 - dow
  return d.add(diff, 'day').startOf('day')
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function gradeColor(status: 'green' | 'amber' | 'red' | string): string {
  if (status === 'green') return 'green'
  if (status === 'amber') return 'gold'
  return 'red'
}

interface AreaMeta {
  key: string
  title: string
  weightPercent: number
  kpis: Array<{ key: string; label: string; formula: string; weightPercent: number }>
}

type ScoreMap = Record<string, Array<number | null>>

interface DailyEntryRow {
  kind: 'kpi' | 'subtotal'
  areaKey: string
  kpiKey?: string
  label: string
  formula?: string
  weightPercent: number
}

export function SouvikDashboardView() {
  const [weekStart, setWeekStart] = useState<Dayjs>(() => mondayOf(dayjs()))
  const [week, setWeek] = useState<SouvikKpiWeekResponse | null>(null)
  const [scores, setScores] = useState<ScoreMap>({})
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const [reference, setReference] = useState<SouvikReferenceResponse | null>(null)
  const [weeklyLog, setWeeklyLog] = useState<SouvikWeeklyLogRow[]>([])
  const [logLoading, setLogLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('weekly')
  const reqIdRef = useRef(0)

  const loadWeek = useCallback(async (ws: Dayjs) => {
    const myReq = ++reqIdRef.current
    setLoading(true)
    setError(null)
    try {
      const iso = ws.format('YYYY-MM-DD')
      dashboardKpiApi.clearSouvikCache(iso)
      const res = await dashboardKpiApi.getSouvikKpi(iso)
      if (myReq !== reqIdRef.current) return
      setWeek(res)
      const map: ScoreMap = {}
      res.areas.forEach((a) => a.kpis.forEach((k) => (map[k.key] = [...k.daily])))
      setScores(map)
      setDirty(false)
    } catch {
      if (myReq !== reqIdRef.current) return
      setError('Failed to load Souvik KPI for this week.')
    } finally {
      if (myReq === reqIdRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadWeek(weekStart)
  }, [weekStart, loadWeek])

  useEffect(() => {
    dashboardKpiApi
      .getSouvikReference()
      .then(setReference)
      .catch(() => {})
  }, [])

  const loadWeeklyLog = useCallback(async () => {
    setLogLoading(true)
    try {
      // Anchor the log to the current week's Monday minus a few weeks so recent
      // weeks (incl. the live one) are visible first.
      const start = mondayOf(dayjs()).subtract(8, 'week').format('YYYY-MM-DD')
      const res = await dashboardKpiApi.getSouvikWeeklyLog(start, 52)
      setWeeklyLog(res.rows ?? [])
    } catch {
      message.error('Failed to load Weekly Log')
    } finally {
      setLogLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'weekly' && weeklyLog.length === 0) void loadWeeklyLog()
  }, [activeTab, weeklyLog.length, loadWeeklyLog])

  const areaMeta: AreaMeta[] = useMemo(
    () =>
      (week?.areas ?? []).map((a) => ({
        key: a.key,
        title: a.title,
        weightPercent: a.weight_percent,
        kpis: a.kpis.map((k) => ({
          key: k.key,
          label: k.label,
          formula: k.formula,
          weightPercent: k.weight_percent,
        })),
      })),
    [week],
  )

  const canEdit = !!week?.can_edit

  // ---- live (client-side) recompute mirroring the backend math ----
  const derived = useMemo(() => {
    const kpiWeekly: Record<string, number> = {}
    const areaWeekly: Record<string, number> = {}
    const areaDaySubtotals: Record<string, number[]> = {}
    let composite = 0
    areaMeta.forEach((area) => {
      const daySums = [0, 0, 0, 0, 0, 0]
      let areaSum = 0
      area.kpis.forEach((kpi) => {
        const daily = scores[kpi.key] ?? [null, null, null, null, null, null]
        let sum = 0
        daily.forEach((v, i) => {
          const num = typeof v === 'number' ? v : 0
          sum += num
          daySums[i] += num
        })
        const weekly = (sum / 6) * (kpi.weightPercent / 100)
        kpiWeekly[kpi.key] = Math.round(weekly * 100) / 100
        areaSum += kpiWeekly[kpi.key]
      })
      areaWeekly[area.key] = Math.round(areaSum * 100) / 100
      areaDaySubtotals[area.key] = daySums.map(
        (s) => Math.round((s / (area.kpis.length || 1)) * 10) / 10,
      )
      composite += areaWeekly[area.key]
    })
    composite = Math.round(composite * 10) / 10
    let grade = 'Below Target'
    let status: 'green' | 'amber' | 'red' = 'red'
    if (composite >= 9) {
      grade = 'Excellent'
      status = 'green'
    } else if (composite >= 7) {
      grade = 'Good'
      status = 'green'
    } else if (composite >= 5) {
      grade = 'Needs attention'
      status = 'amber'
    }
    return { kpiWeekly, areaWeekly, areaDaySubtotals, composite, grade, status }
  }, [areaMeta, scores])

  const setCell = (kpiKey: string, dayIdx: number, value: number | null) => {
    setScores((prev) => {
      const arr = [...(prev[kpiKey] ?? [null, null, null, null, null, null])]
      arr[dayIdx] = value
      return { ...prev, [kpiKey]: arr }
    })
    setDirty(true)
  }

  const handleSave = async () => {
    if (!week) return
    setSaving(true)
    try {
      const rows: Array<{ work_date: string; kpi_key: string; score: number | null }> = []
      week.day_dates.forEach((d, i) => {
        areaMeta.forEach((area) =>
          area.kpis.forEach((kpi) => {
            const v = scores[kpi.key]?.[i]
            rows.push({ work_date: d, kpi_key: kpi.key, score: typeof v === 'number' ? v : null })
          }),
        )
      })
      await dashboardKpiApi.putSouvikDaily(rows)
      message.success('Daily scores saved')
      setWeeklyLog([])
      await loadWeek(weekStart)
    } catch (e) {
      const ax = e as { response?: { data?: { detail?: string } } }
      message.error(ax.response?.data?.detail || 'Failed to save scores')
    } finally {
      setSaving(false)
    }
  }

  // ---- Daily Entry table ----
  const dailyColumns: ColumnsType<DailyEntryRow> = useMemo(() => {
    const dayCols: ColumnsType<DailyEntryRow> = DAY_LABELS.map((label, idx) => ({
      title: (
        <div style={{ textAlign: 'center' }}>
          <div>{label}</div>
          <div style={{ fontSize: 11, color: '#8c8c8c', fontWeight: 400 }}>
            {week?.day_dates?.[idx] ? dayjs(week.day_dates[idx]).format('DD-MMM') : ''}
          </div>
        </div>
      ),
      key: `day-${idx}`,
      align: 'center',
      width: 84,
      render: (_: unknown, row: DailyEntryRow) => {
        if (row.kind === 'subtotal') {
          const sub = derived.areaDaySubtotals[row.areaKey]?.[idx]
          return <strong>{sub != null ? sub.toFixed(1) : '0.0'}</strong>
        }
        const v = scores[row.kpiKey as string]?.[idx]
        return (
          <InputNumber
            min={0}
            max={10}
            step={1}
            size="small"
            value={typeof v === 'number' ? v : null}
            disabled={!canEdit}
            controls={false}
            style={{ width: 56 }}
            onChange={(val) => setCell(row.kpiKey as string, idx, val as number | null)}
          />
        )
      },
    }))
    return [
      {
        title: 'KPI / Scoring guide',
        dataIndex: 'label',
        key: 'label',
        width: 280,
        render: (_: unknown, row: DailyEntryRow) =>
          row.kind === 'subtotal' ? (
            <strong>{row.label}</strong>
          ) : (
            <div>
              <div style={{ fontWeight: 500 }}>{row.label}</div>
              {row.formula && (
                <div style={{ fontSize: 11, color: '#8c8c8c' }}>{row.formula}</div>
              )}
            </div>
          ),
      },
      ...dayCols,
      {
        title: 'Weight',
        dataIndex: 'weightPercent',
        key: 'weight',
        align: 'center',
        width: 72,
        render: (_: unknown, row: DailyEntryRow) => `${row.weightPercent.toFixed(row.kind === 'subtotal' ? 1 : 1)}%`,
      },
      {
        title: 'Wkly Score',
        key: 'weekly',
        align: 'center',
        width: 96,
        render: (_: unknown, row: DailyEntryRow) => {
          const val =
            row.kind === 'subtotal'
              ? derived.areaWeekly[row.areaKey]
              : derived.kpiWeekly[row.kpiKey as string]
          return <strong>{val != null ? val.toFixed(2) : '0.00'}</strong>
        },
      },
    ]
  }, [week, scores, derived, canEdit])

  return (
    <div className="dashboard-kpi-page">
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'daily',
            label: 'Daily Entry',
            children: (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Card size="small">
                  <Space wrap align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <Space wrap align="center">
                      <Text strong>Week of (Monday):</Text>
                      <DatePicker
                        value={weekStart}
                        allowClear={false}
                        format="DD-MMM-YYYY"
                        onChange={(d) => d && setWeekStart(mondayOf(d))}
                      />
                      <Button icon={<ReloadOutlined />} onClick={() => void loadWeek(weekStart)}>
                        Refresh
                      </Button>
                      {!canEdit && <Tag color="default">View only</Tag>}
                    </Space>
                    <Space align="center">
                      <Text type="secondary">Weekly Composite</Text>
                      <Tag color={gradeColor(derived.status)} style={{ fontSize: 16, padding: '4px 12px' }}>
                        {derived.composite.toFixed(1)} / 10 · {derived.grade}
                      </Tag>
                      {canEdit && (
                        <Button
                          type="primary"
                          icon={<SaveOutlined />}
                          loading={saving}
                          disabled={!dirty}
                          onClick={() => void handleSave()}
                        >
                          Save
                        </Button>
                      )}
                    </Space>
                  </Space>
                </Card>

                {error && <Alert type="error" showIcon message={error} />}

                <Alert
                  type="info"
                  showIcon
                  message="Enter daily scores (1–10) for each KPI, Monday to Saturday. Weekly score and composite update live; the Weekly Log records every week permanently."
                />

                {areaMeta.map((area) => {
                  const rows: DailyEntryRow[] = [
                    ...area.kpis.map<DailyEntryRow>((k) => ({
                      kind: 'kpi',
                      areaKey: area.key,
                      kpiKey: k.key,
                      label: k.label,
                      formula: k.formula,
                      weightPercent: k.weightPercent,
                    })),
                    {
                      kind: 'subtotal',
                      areaKey: area.key,
                      label: `${area.title} sub-total`,
                      weightPercent: area.weightPercent,
                    },
                  ]
                  return (
                    <Card
                      key={area.key}
                      size="small"
                      title={`${area.title} — weight ${area.weightPercent.toFixed(0)}%`}
                      styles={{ body: { padding: 0 } }}
                    >
                      <Table<DailyEntryRow>
                        size="small"
                        loading={loading}
                        columns={dailyColumns}
                        dataSource={rows}
                        rowKey={(r) => `${area.key}-${r.kpiKey ?? 'subtotal'}`}
                        pagination={false}
                        rowClassName={(r) => (r.kind === 'subtotal' ? 'souvik-subtotal-row' : '')}
                        scroll={{ x: 760 }}
                      />
                    </Card>
                  )
                })}

                <Card size="small" title="Scoring guide">
                  <Space direction="vertical" size={2}>
                    <Text>9–10 — Excellent – fully on target</Text>
                    <Text>7–8 — Good – minor gaps, well managed</Text>
                    <Text>5–6 — Needs attention – gaps to address</Text>
                    <Text>1–4 — Below target – immediate action needed</Text>
                  </Space>
                </Card>
              </Space>
            ),
          },
          {
            key: 'weekly',
            label: 'Weekly Log',
            children: (
              <Card size="small" title="Weekly Log — Performance History">
                <Table<SouvikWeeklyLogRow>
                  size="small"
                  loading={logLoading}
                  dataSource={weeklyLog}
                  rowKey="week_from"
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  scroll={{ x: 880 }}
                  rowClassName={(r) => (r.is_current_week ? 'souvik-current-week-row' : '')}
                  columns={[
                    { title: 'Week From', dataIndex: 'week_from_label', key: 'from', width: 120 },
                    { title: 'Week To', dataIndex: 'week_to_label', key: 'to', width: 120 },
                    {
                      title: 'Payment',
                      dataIndex: 'payment_score',
                      key: 'pay',
                      align: 'center',
                      width: 90,
                      render: (v: number, r) => (r.has_data ? v.toFixed(1) : '—'),
                    },
                    {
                      title: 'Accounts',
                      dataIndex: 'accounts_score',
                      key: 'acc',
                      align: 'center',
                      width: 90,
                      render: (v: number, r) => (r.has_data ? v.toFixed(1) : '—'),
                    },
                    {
                      title: 'EA Support',
                      dataIndex: 'ea_score',
                      key: 'ea',
                      align: 'center',
                      width: 90,
                      render: (v: number, r) => (r.has_data ? v.toFixed(1) : '—'),
                    },
                    {
                      title: 'Composite',
                      dataIndex: 'composite_score',
                      key: 'comp',
                      align: 'center',
                      width: 100,
                      render: (v: number | null) => (v != null ? <strong>{v.toFixed(1)}</strong> : '—'),
                    },
                    {
                      title: 'Grade',
                      dataIndex: 'grade',
                      key: 'grade',
                      width: 130,
                      render: (g: string) =>
                        g ? (
                          <Tag
                            color={
                              g === 'Excellent' || g === 'Good'
                                ? 'green'
                                : g === 'Needs attention'
                                  ? 'gold'
                                  : 'red'
                            }
                          >
                            {g}
                          </Tag>
                        ) : (
                          '—'
                        ),
                    },
                    { title: 'Auto Comment', dataIndex: 'auto_comment', key: 'comment', ellipsis: true },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'reference',
            label: 'KPI Reference',
            children: (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                {(reference?.areas ?? []).map((area) => (
                  <Card
                    key={area.key}
                    size="small"
                    title={`${area.title} — weight ${area.weight_percent.toFixed(0)}%`}
                    styles={{ body: { padding: 0 } }}
                  >
                    <Table
                      size="small"
                      dataSource={area.kpis}
                      rowKey="key"
                      pagination={false}
                      columns={[
                        { title: 'KPI', dataIndex: 'label', key: 'label', width: 200 },
                        { title: 'Scoring formula', dataIndex: 'formula', key: 'formula' },
                        { title: 'Frequency', dataIndex: 'frequency', key: 'frequency', width: 120 },
                        { title: 'Data source', dataIndex: 'data_source', key: 'src', width: 180 },
                      ]}
                    />
                  </Card>
                ))}
                <Card size="small" title="Scoring guide">
                  <Space direction="vertical" size={2}>
                    {(reference?.scoring_guide ?? []).map((s) => (
                      <Text key={s.range}>
                        <strong>{s.range}</strong> — {s.label}
                      </Text>
                    ))}
                  </Space>
                </Card>
              </Space>
            ),
          },
        ]}
      />
    </div>
  )
}
