import { Typography, Row, Col, Card, Button, Modal, Table, Alert } from 'antd'
import { TextCellTooltip, tableCellEllipsisStyle } from '../../components/common/TextCellTooltip'
import {
  CalendarOutlined,
  ReloadOutlined,
  CheckSquareOutlined,
  BugOutlined,
  RocketOutlined,
  FileTextOutlined,
} from '@ant-design/icons'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supportDashboardApi, type SupportDashboardStats, type WeekData } from '../../api/supportDashboard'
import { sessionApiCacheGet } from '../../utils/sessionApiCache'
import { ModalContentSkeleton, SkeletonOverlay } from '../../components/common/skeletons'
import { formatDateWeekly, truncateTitleDescCell } from '../../utils/helpers'
import { ROUTES } from '../../utils/constants'
import { isLocalBackend } from '../../api/axios'
import { getLocalUvicornStartCommand } from '../../utils/localBackend'

const { Title, Text } = Typography

function renderModalTitleDescription(_: unknown, r: Record<string, unknown>) {
  const t = String(r.title ?? '').trim()
  const d = String(r.description ?? '').trim()
  if (!t && !d) return <span>-</span>
  const tip = [t, d].filter(Boolean).join('\n\n')
  const tShow = t ? truncateTitleDescCell(t) : ''
  const dShow = d ? truncateTitleDescCell(d) : ''
  return (
    <TextCellTooltip tooltip={tip}>
      <div style={{ minWidth: 0, maxWidth: 360 }}>
        {tShow ? (
          <div style={tableCellEllipsisStyle}>
            <strong>{tShow}</strong>
          </div>
        ) : null}
        {dShow ? <div style={{ ...tableCellEllipsisStyle, fontWeight: 'normal' }}>{dShow}</div> : null}
      </div>
    </TextCellTooltip>
  )
}

const weekBoxColors = [
  { bg: 'linear-gradient(135deg, #4CAF50, #45a049)', border: '#ffc107' },
  { bg: 'linear-gradient(135deg, #2196F3, #1976D2)', border: 'transparent' },
  { bg: 'linear-gradient(135deg, #FF9800, #F57C00)', border: 'transparent' },
  { bg: 'linear-gradient(135deg, #9C27B0, #7B1FA2)', border: 'transparent' },
]

export const SupportDashboard = () => {
  const navigate = useNavigate()
  const [filteredModalOpen, setFilteredModalOpen] = useState(false)
  const [weeklyModalOpen, setWeeklyModalOpen] = useState(false)
  const [filteredLoading, setFilteredLoading] = useState(false)
  const [weeklyLoading, setWeeklyLoading] = useState(false)
  const [filteredData, setFilteredData] = useState<{ data: unknown[]; filterType: string; category: string; totalRecords: number } | null>(null)
  const [weeklyData, setWeeklyData] = useState<{ tickets: unknown[]; weekDateRange?: string; ticketType?: string; totalTickets?: number } | null>(null)
  const [weeklyView, setWeeklyView] = useState<'boxes' | 'table'>('boxes')
  const [currentFilter, setCurrentFilter] = useState<{ type: string; category: string } | null>(null)
  const [currentWeek, setCurrentWeek] = useState<WeekData | null>(null)
  const [featureModalOpen, setFeatureModalOpen] = useState(false)
  const [featureData, setFeatureData] = useState<{ data: unknown[]; filterType: string; totalRecords: number } | null>(null)
  const [featureLoading, setFeatureLoading] = useState(false)

  const cachedStats = sessionApiCacheGet<SupportDashboardStats>('support-dashboard:stats')

  const {
    data,
    isLoading: loading,
    error,
    refetch,
  } = useQuery<SupportDashboardStats>({
    queryKey: ['support-dashboard', 'stats'],
    queryFn: () => supportDashboardApi.getStats(),
    initialData: cachedStats?.weeksData ? cachedStats : undefined,
    staleTime: 120_000,
  })

  const errorMessage = (() => {
    if (!error) return null
    const ax = error as { response?: { data?: { detail?: string } }; request?: unknown; message?: string }
    const backendMsg = ax?.response?.data?.detail
    const isNetworkError = !ax?.response && (ax?.request || ax?.message?.toLowerCase().includes('network'))
    const msg = backendMsg
      ? String(backendMsg)
      : isNetworkError
        ? isLocalBackend
          ? `Backend not reachable. ${getLocalUvicornStartCommand()}`
          : 'Backend not reachable. Check your connection or API URL.'
        : ax?.message
          ? String(ax.message)
          : 'Unknown error'
    return `Failed to load Support Dashboard: ${msg}`
  })()

  const showFilteredData = async (filterType: string, category: string) => {
    setCurrentFilter({ type: filterType, category })
    setFilteredModalOpen(true)
    setFilteredLoading(true)
    setFilteredData(null)
    try {
      const res = await supportDashboardApi.getFiltered(filterType, category)
      setFilteredData({
        data: res.data || [],
        filterType: res.filterType || filterType,
        category: res.category || category,
        totalRecords: res.totalRecords || 0,
      })
    } catch (err) {
      setFilteredData({ data: [], filterType, category, totalRecords: 0 })
    } finally {
      setFilteredLoading(false)
    }
  }

  const openWeeklyModal = (weekData: WeekData) => {
    setCurrentWeek(weekData)
    setWeeklyModalOpen(true)
    setWeeklyView('boxes')
    setWeeklyData(null)
  }

  const loadWeeklyDetails = async (ticketType: string) => {
    if (!currentWeek) return
    setWeeklyLoading(true)
    setWeeklyData(null)
    setWeeklyView('table')
    try {
      const months = (currentWeek as { months?: string[] }).months?.join(',') ?? new Date().toLocaleString('default', { month: 'long' })
      const years = (currentWeek as { years?: string[] }).years?.join(',') ?? String(new Date().getFullYear())
      const res = await supportDashboardApi.getWeeklyDetails(currentWeek.weekNumber, months, years, ticketType)
      const tickets = (res.tickets || []).map((t: Record<string, unknown>) => ({
        ...t,
        type: t.type || (ticketType === 'response_delay' ? 'Resp.Delay' : ticketType === 'completion_delay' ? 'Comp.Delay' : t.type),
      }))
      setWeeklyData({
        tickets,
        weekDateRange: currentWeek.weekDateRange,
        ticketType: res.ticketType || ticketType,
        totalTickets: res.totalTickets ?? tickets.length,
      })
    } catch (err) {
      setWeeklyData({ tickets: [], weekDateRange: currentWeek.weekDateRange, ticketType })
    } finally {
      setWeeklyLoading(false)
    }
  }

  const showFeatureTickets = async (filterType: 'all' | 'pending') => {
    setFeatureModalOpen(true)
    setFeatureLoading(true)
    setFeatureData(null)
    try {
      const res = await supportDashboardApi.getFeatureTickets(filterType)
      setFeatureData({
        data: res.data || [],
        filterType: res.filterType || filterType,
        totalRecords: res.totalRecords || 0,
      })
    } catch (err) {
      setFeatureData({ data: [], filterType, totalRecords: 0 })
    } finally {
      setFeatureLoading(false)
    }
  }

  const weeks = data?.weeksData ?? []
  const countsChores = data?.counts?.chores ?? { '1-2': 0, '2-7': 0, '7+': 0, hold: 0 }
  const countsBugs = data?.counts?.bugs ?? { '1-2': 0, '2-7': 0, '7+': 0, hold: 0 }
  const topCompanies = data?.monthlyTopCompanies ?? { chores: [], bugs: [], period: '' }
  const stats = data?.statistics ?? { totalChores: 0, totalBugs: 0, onHoldChores: 0, onHoldBugs: 0 }
  const featureMetrics = data?.featureMetrics ?? { total: 0, pending: 0 }

  const filterLabels: Record<string, string> = {
    '1-2': '1-2 Days',
    '2-7': '2-7 Days',
    '7+': '7+ Days',
    hold: 'On Hold',
  }

  return (
    <SkeletonOverlay loading={loading && !data} minHeight={480}>
    <div
      className="support-dashboard-shell"
      style={{
        maxWidth: 1400,
        margin: '0 auto',
        minHeight: 400,
        padding: '8px 0',
        background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 120px)',
        borderRadius: 16,
      }}
    >
      {/* Header */}
      <div
        style={{
          background: 'linear-gradient(135deg, #2c5aa0, #1e4a8a)',
          color: '#fff',
          padding: '24px 28px',
          borderRadius: '12px 12px 0 0',
          marginBottom: 24,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <Title level={3} className="page-main-heading" style={{ margin: 0, color: '#fff', fontWeight: 700 }}>
              <CalendarOutlined style={{ marginRight: 8 }} />
              SUPPORT DASHBOARD
            </Title>
            <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 14 }}>
              {data?.summary?.lastUpdated ? `Last updated: ${data.summary.lastUpdated}` : 'Loading...'}
            </Text>
          </div>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void refetch()}
            style={{ background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.3)', color: '#fff' }}
          >
            Refresh
          </Button>
        </div>
      </div>

      {errorMessage && (
        <Alert
          type="error"
          message={errorMessage}
          showIcon
          action={<Button size="small" onClick={() => void refetch()}>Retry</Button>}
          style={{ marginBottom: 24, borderRadius: 12 }}
        />
      )}

      {/* Weekly Performance */}
      <Card
        title={
          <span>
            <CalendarOutlined style={{ marginRight: 8 }} />
            WEEKLY PERFORMANCE DATA
          </span>
        }
        style={{ marginBottom: 24, borderRadius: 12, border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
      >
        <Row gutter={[16, 16]}>
          {weeks.map((week, idx) => (
            <Col xs={24} sm={12} lg={6} key={week.weekNumber}>
              <div
                style={{
                  background: weekBoxColors[idx]?.bg || weekBoxColors[0].bg,
                  color: '#fff',
                  padding: 20,
                  borderRadius: 12,
                  cursor: 'pointer',
                  border: idx === 0 ? `3px solid ${weekBoxColors[0].border}` : undefined,
                  boxShadow: idx === 0 ? '0 0 15px rgba(255,193,7,0.3)' : undefined,
                }}
                onClick={() => openWeeklyModal(week)}
              >
                <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{week.stats?.totalTickets ?? 0}</div>
                <div style={{ fontSize: 13, opacity: 0.95 }}>
                  {idx === 0 ? 'Current Week' : 'Previous Week'}
                </div>
                <div style={{ fontSize: 12, opacity: 0.9, marginTop: 6 }}>{week.weekDateRange}</div>
                <div style={{ fontSize: 11, marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <span>Total: {week.stats?.totalTickets ?? 0}</span>
                  <span>Chores: {week.stats?.totalChores ?? 0}</span>
                  <span>Bugs: {week.stats?.totalBugs ?? 0}</span>
                  <span>Resp: {week.stats?.responseDelay ?? 0}</span>
                  <span>Comp: {week.stats?.completionDelay ?? 0}</span>
                </div>
              </div>
            </Col>
          ))}
        </Row>
      </Card>

      {/* Pending Chores & Bugs */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <Card
            title={
              <span style={{ color: '#52c41a' }}>
                <CheckSquareOutlined style={{ marginRight: 8 }} />
                PENDING CHORES
              </span>
            }
            style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
          >
            <Row gutter={[12, 12]}>
              {(['1-2', '2-7', '7+', 'hold'] as const).map((key) => (
                <Col span={12} key={key}>
                  <div
                    style={{
                      background: key === '1-2' ? '#d4edda' : key === '2-7' ? '#fff3cd' : key === '7+' ? '#f8d7da' : '#e2e3e5',
                      padding: 16,
                      borderRadius: 8,
                      textAlign: 'center',
                      cursor: 'pointer',
                    }}
                    onClick={() => showFilteredData(key, 'chores')}
                  >
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{countsChores[key] ?? 0}</div>
                    <div style={{ fontSize: 12 }}>{filterLabels[key]}</div>
                  </div>
                </Col>
              ))}
            </Row>
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <Text type="secondary">
                {stats.totalChores} pending chores ({stats.onHoldChores} on hold)
              </Text>
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={
              <span style={{ color: '#ff4d4f' }}>
                <BugOutlined style={{ marginRight: 8 }} />
                PENDING BUGS
              </span>
            }
            style={{ borderRadius: 12, border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
          >
            <Row gutter={[12, 12]}>
              {(['1-2', '2-7', '7+', 'hold'] as const).map((key) => (
                <Col span={12} key={key}>
                  <div
                    style={{
                      background: key === '1-2' ? '#d4edda' : key === '2-7' ? '#fff3cd' : key === '7+' ? '#f8d7da' : '#e2e3e5',
                      padding: 16,
                      borderRadius: 8,
                      textAlign: 'center',
                      cursor: 'pointer',
                    }}
                    onClick={() => showFilteredData(key, 'bugs')}
                  >
                    <div style={{ fontSize: 24, fontWeight: 700 }}>{countsBugs[key] ?? 0}</div>
                    <div style={{ fontSize: 12 }}>{filterLabels[key]}</div>
                  </div>
                </Col>
              ))}
            </Row>
            <div style={{ marginTop: 12, textAlign: 'center' }}>
              <Text type="secondary">
                {stats.totalBugs} pending bugs ({stats.onHoldBugs} on hold)
              </Text>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Feature metrics */}
      <Card
        title={
          <span>
            <RocketOutlined style={{ marginRight: 8 }} />
            FEATURE METRICS
          </span>
        }
        style={{ marginBottom: 24, borderRadius: 12, border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
      >
        <Row gutter={16}>
          <Col>
            <div
              style={{
                background: '#e6f7ff',
                padding: 16,
                borderRadius: 8,
                minWidth: 120,
                cursor: 'pointer',
              }}
              onClick={() => showFeatureTickets('all')}
            >
              <div style={{ fontSize: 24, fontWeight: 700, color: '#1890ff' }}>{featureMetrics.total}</div>
              <Text type="secondary">Total Features</Text>
            </div>
          </Col>
          <Col>
            <div
              style={{
                background: '#fff7e6',
                padding: 16,
                borderRadius: 8,
                minWidth: 120,
                cursor: 'pointer',
              }}
              onClick={() => showFeatureTickets('pending')}
            >
              <div style={{ fontSize: 24, fontWeight: 700, color: '#fa8c16' }}>{featureMetrics.pending}</div>
              <Text type="secondary">Pending Features</Text>
            </div>
          </Col>
        </Row>
      </Card>

      {/* Monthly Top Companies */}
      <Card
        title={
          <span>
            <FileTextOutlined style={{ marginRight: 8 }} />
            MONTHLY TOP COMPANIES — {topCompanies.period}
          </span>
        }
        style={{ marginBottom: 24, borderRadius: 12, border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}
      >
        <Row gutter={24}>
          <Col xs={24} md={12}>
            <div style={{ marginBottom: 8, fontWeight: 600, color: '#52c41a' }}>Top 5 Chores</div>
            {(topCompanies.chores || []).length === 0 ? (
              <Text type="secondary">No chore companies this month</Text>
            ) : (
              (topCompanies.chores || []).map((c: { company: string; requests: number }, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <span>{c.company}</span>
                  <span style={{ background: '#2c5aa0', color: '#fff', padding: '2px 10px', borderRadius: 12 }}>{c.requests}</span>
                </div>
              ))
            )}
          </Col>
          <Col xs={24} md={12}>
            <div style={{ marginBottom: 8, fontWeight: 600, color: '#ff4d4f' }}>Top 5 Bugs</div>
            {(topCompanies.bugs || []).length === 0 ? (
              <Text type="secondary">No bug companies this month</Text>
            ) : (
              (topCompanies.bugs || []).map((c: { company: string; requests: number }, i: number) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <span>{c.company}</span>
                  <span style={{ background: '#2c5aa0', color: '#fff', padding: '2px 10px', borderRadius: 12 }}>{c.requests}</span>
                </div>
              ))
            )}
          </Col>
        </Row>
      </Card>

      {/* Filtered Data Modal */}
      <Modal
        title={`${currentFilter?.category === 'chores' ? 'Chores' : 'Bugs'} — ${currentFilter ? filterLabels[currentFilter.type] : ''}`}
        open={filteredModalOpen}
        onCancel={() => setFilteredModalOpen(false)}
        footer={null}
        width={1000}
      >
        {filteredLoading ? (
          <ModalContentSkeleton rows={12} />
        ) : filteredData ? (
          <Table
            dataSource={filteredData.data as Record<string, unknown>[]}
            columns={[
              {
                title: 'Company',
                dataIndex: 'company',
                key: 'company',
                width: 140,
                ellipsis: false,
                render: (v: string) => <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v || '-'}</span>,
              },
              {
                title: 'Title & Description',
                key: 'titleDescription',
                ellipsis: false,
                render: renderModalTitleDescription,
              },
              {
                title: 'Req Per',
                dataIndex: 'requestedPerson',
                key: 'requestedPerson',
                width: 100,
                ellipsis: false,
                render: (v: string) => <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v || '-'}</span>,
              },
              {
                title: 'Pending Days',
                dataIndex: 'pendingDays',
                key: 'pendingDays',
                width: 100,
                ellipsis: false,
                render: (v: unknown) => <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v != null ? String(v) : '-'}</span>,
              },
              {
                title: 'Reference',
                dataIndex: 'referenceNo',
                key: 'referenceNo',
                width: 100,
                ellipsis: false,
                render: (ref: string, r: Record<string, unknown>) => {
                  const id = r.id as string | undefined
                  if (!id) return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{ref || '-'}</span>
                  const typeStr = String(r.type ?? '').toLowerCase()
                  const openTicketType = typeStr === 'bug' ? 'bug' : 'chore'
                  return (
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, height: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                      onClick={() => {
                        setFilteredModalOpen(false)
                        setFilteredData(null)
                        navigate(ROUTES.TICKETS + '?section=chores-bugs', {
                          state: { openTicketId: id, openTicketType },
                        })
                      }}
                    >
                      {ref || '-'}
                    </Button>
                  )
                },
              },
            ]}
            pagination={{ pageSize: 10 }}
            rowKey={(r) => String((r as { id?: string; referenceNo?: string }).id || (r as { referenceNo?: string }).referenceNo || Math.random())}
            size="small"
            scroll={{ x: 800 }}
          />
        ) : null}
      </Modal>

      {/* Weekly Details Modal */}
      <Modal
        title={`Weekly Details — ${currentWeek?.weekDateRange ?? ''}`}
        open={weeklyModalOpen}
        onCancel={() => { setWeeklyModalOpen(false); setWeeklyView('boxes'); setWeeklyData(null) }}
        footer={null}
        width={1100}
      >
        {currentWeek && (
          <>
            {/* 4 clickable stat boxes */}
            <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
              <Col span={12}>
                <div
                  style={{
                    background: 'linear-gradient(135deg, #d4edda, #c3e6cb)',
                    padding: 20,
                    borderRadius: 8,
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                  onClick={() => loadWeeklyDetails('total')}
                >
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#155724' }}>{currentWeek.stats?.totalTickets ?? 0}</div>
                  <Text style={{ fontSize: 12 }}>Total Tickets</Text>
                </div>
              </Col>
              <Col span={12}>
                <div
                  style={{
                    background: 'linear-gradient(135deg, #fff3cd, #ffeaa7)',
                    padding: 20,
                    borderRadius: 8,
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                  onClick={() => loadWeeklyDetails('pending')}
                >
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#856404' }}>
                    {(currentWeek.stats?.pendingChores ?? 0) + (currentWeek.stats?.pendingBugs ?? 0)}
                  </div>
                  <Text style={{ fontSize: 12 }}>Pending</Text>
                </div>
              </Col>
              <Col span={12}>
                <div
                  style={{
                    background: 'linear-gradient(135deg, #f8d7da, #f1b0b7)',
                    padding: 20,
                    borderRadius: 8,
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                  onClick={() => loadWeeklyDetails('response_delay')}
                >
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#721c24' }}>
                    {weeklyData?.ticketType === 'response_delay' ? (weeklyData.totalTickets ?? currentWeek.stats?.responseDelay ?? 0) : (currentWeek.stats?.responseDelay ?? 0)}
                  </div>
                  <Text style={{ fontSize: 12 }}>Response Delay</Text>
                </div>
              </Col>
              <Col span={12}>
                <div
                  style={{
                    background: 'linear-gradient(135deg, #f8d7da, #e98b95)',
                    padding: 20,
                    borderRadius: 8,
                    textAlign: 'center',
                    cursor: 'pointer',
                  }}
                  onClick={() => loadWeeklyDetails('completion_delay')}
                >
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#721c24' }}>
                    {weeklyData?.ticketType === 'completion_delay' ? (weeklyData.totalTickets ?? currentWeek.stats?.completionDelay ?? 0) : (currentWeek.stats?.completionDelay ?? 0)}
                  </div>
                  <Text style={{ fontSize: 12 }}>Completion Delay</Text>
                </div>
              </Col>
            </Row>

            {/* Table area - loads when a box is clicked */}
            {weeklyLoading ? (
              <ModalContentSkeleton rows={10} />
            ) : weeklyData && weeklyData.tickets.length > 0 ? (
              <Table
                dataSource={weeklyData.tickets as Record<string, unknown>[]}
                columns={[
                  { title: 'Type', dataIndex: 'type', key: 'type', width: 90 },
                  { title: 'Company', dataIndex: 'company', key: 'company', width: 120 },
                  {
                    title: 'Title & Description',
                    key: 'titleDescription',
                    width: 380,
                    render: renderModalTitleDescription,
                  },
                  {
                    title: 'Reference',
                    dataIndex: 'referenceNo',
                    key: 'referenceNo',
                    width: 100,
                    render: (ref: string, r: Record<string, unknown>) => {
                      const id = r.id as string | undefined
                      if (!id) return <span>{ref || '-'}</span>
                      const typeStr = String(r.type ?? '').toLowerCase()
                      const openTicketType = typeStr === 'bug' ? 'bug' : 'chore'
                      return (
                        <Button
                          type="link"
                          size="small"
                          style={{ padding: 0, height: 'auto' }}
                          onClick={() => {
                            setWeeklyModalOpen(false)
                            setWeeklyData(null)
                            navigate(ROUTES.TICKETS + '?section=chores-bugs', {
                              state: { openTicketId: id, openTicketType },
                            })
                          }}
                        >
                          {ref || '-'}
                        </Button>
                      )
                    },
                  },
                  {
                    title: 'Query Arrival',
                    dataIndex: 'queryArrival',
                    key: 'queryArrival',
                    width: 140,
                    render: (v: string) => formatDateWeekly(v),
                  },
                  ...(weeklyData.ticketType === 'response_delay'
                    ? [{ title: 'Response Delay Time', dataIndex: 'responseDelayTime', key: 'responseDelayTime', width: 150, render: (v: string) => v || '-' }]
                    : weeklyData.ticketType === 'completion_delay'
                      ? [{ title: 'Completion Delay Time', dataIndex: 'completionDelayTime', key: 'completionDelayTime', width: 150, render: (v: string) => v || '-' }]
                      : []),
                ]}
                pagination={{ pageSize: 10 }}
                rowKey={(r) => String((r as { referenceNo?: string; id?: string }).referenceNo || (r as { id?: string }).id || Math.random())}
                size="small"
              />
            ) : weeklyData && weeklyData.tickets.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 24, color: '#999' }}>
                No tickets found for this selection.
              </div>
            ) : null}
          </>
        )}
      </Modal>

      {/* Feature Tickets Modal — sorted by priority (red → yellow → green → no color) */}
      <Modal
        title={`Feature Tickets — ${featureData?.filterType === 'pending' ? 'Pending' : 'All'}`}
        open={featureModalOpen}
        onCancel={() => setFeatureModalOpen(false)}
        footer={null}
        width={900}
      >
        {featureLoading ? (
          <ModalContentSkeleton rows={10} />
        ) : featureData ? (
          <Table
            dataSource={featureData.data as Record<string, unknown>[]}
            onRow={(record) => {
              const p = (record.priority as string)?.toLowerCase() || ''
              const bg =
                p === 'high' || p === 'critical' || p === 'urgent'
                  ? 'rgba(255, 77, 79, 0.28)'
                  : p === 'medium'
                    ? 'rgba(250, 173, 20, 0.28)'
                    : p === 'low'
                      ? 'rgba(82, 196, 26, 0.25)'
                      : undefined
              return { style: bg ? { backgroundColor: bg } : undefined }
            }}
            columns={[
              {
                title: 'Company',
                dataIndex: 'company',
                key: 'company',
                width: 140,
                ellipsis: false,
                render: (v: string) => <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{v || '-'}</span>,
              },
              {
                title: 'Title & Description',
                key: 'titleDescription',
                ellipsis: false,
                render: renderModalTitleDescription,
              },
              {
                title: 'Reference',
                dataIndex: 'referenceNo',
                key: 'referenceNo',
                width: 100,
                ellipsis: false,
                render: (ref: string, r: Record<string, unknown>) => {
                  const id = r.id as string | undefined
                  if (!id) return <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{ref || '-'}</span>
                  return (
                    <Button
                      type="link"
                      size="small"
                      style={{ padding: 0, height: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                      onClick={() => {
                        setFeatureModalOpen(false)
                        setFeatureData(null)
                        navigate(ROUTES.TICKETS + '?type=feature', {
                          state: { openTicketId: id, openTicketType: 'feature' },
                        })
                      }}
                    >
                      {ref || '-'}
                    </Button>
                  )
                },
              },
            ]}
            pagination={{ pageSize: 10 }}
            rowKey={(r) => String((r as { id?: string; referenceNo?: string }).id || (r as { referenceNo?: string }).referenceNo || Math.random())}
            size="small"
            scroll={{ x: 600 }}
          />
        ) : null}
      </Modal>
    </div>
    </SkeletonOverlay>
  )
}
