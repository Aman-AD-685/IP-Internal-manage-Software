import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Table, Card, Typography, Tag, Select, Space, Input } from 'antd'
import { PhoneOutlined, MailOutlined, MessageOutlined, LinkOutlined } from '@ant-design/icons'
import { ticketsApi } from '../../api/tickets'
import {
  formatDateTable,
  formatReplySla,
  getStagingCurrentStage,
  TICKET_EXPORT_COLUMNS,
  buildTicketExportRow,
  truncateTitleDescCell,
  TICKET_TABLE_QA_PREVIEW_MAX_CHARS,
} from '../../utils/helpers'
import type { Ticket } from '../../api/tickets'
import { StagingDetailDrawer } from '../../components/tickets/StagingDetailDrawer'
import { PriorityColoredReference } from '../../components/tickets/PriorityColoredReference'
import { TicketPriorityFilter } from '../../components/tickets/TicketPriorityFilter'
import { PrintExport } from '../../components/common/PrintExport'
import { TableWithSkeletonLoading } from '../../components/common/skeletons'
import { TextCellTooltip, tableCellEllipsisStyle } from '../../components/common/TextCellTooltip'
import { SupportSectionTabs } from '../../components/tickets/SupportSectionTabs'
import { useRole } from '../../hooks/useRole'
import { dateRangeToIsoBounds, fetchAllTicketsPages } from '../../utils/ticketExportByDateRange'
import { TICKET_CHANGED_EVENT } from '../../utils/ticketRealtime'

const { Option } = Select

const { Title } = Typography
const STAGING_CHUNK = 15

const getTypeColor = (type: string) => (type === 'chore' ? 'green' : type === 'bug' ? 'red' : 'blue')
const getCommIcon = (v: string) => {
  if (v === 'phone') return <PhoneOutlined title="Phone" />
  if (v === 'mail') return <MailOutlined title="Mail" />
  if (v === 'whatsapp') return <MessageOutlined title="WhatsApp" />
  return '-'
}
const truncate = (text: string | undefined, len = 40) => {
  if (!text) return '-'
  return text.length > len ? `${text.slice(0, len)}...` : text
}

const wrapStyle = { whiteSpace: 'normal' as const, wordBreak: 'break-word' as const }

/** Columns up to and including Reference No (tickets with Stage 2 Status = Staging) */
const stagingTicketColumns = [
  {
    title: 'Reference No',
    dataIndex: 'reference_no',
    key: 'reference_no',
    width: 100,
    render: (v: string, r: Ticket) => (
      <PriorityColoredReference referenceNo={v} priority={r.priority} />
    ),
  },
  {
    title: 'Company Name',
    dataIndex: 'company_name',
    key: 'company_name',
    width: 140,
    ellipsis: false,
    render: (v: string) => <span style={wrapStyle}>{v?.trim() ? v : '-'}</span>,
  },
  {
    title: 'User Name',
    dataIndex: 'user_name',
    key: 'user_name',
    width: 100,
    ellipsis: true,
    render: (v: string) => v || '-',
  },
  {
    title: 'Page',
    dataIndex: 'page_name',
    key: 'page_name',
    width: 100,
    ellipsis: true,
    render: (v: string) => v || '-',
  },
  {
    title: 'Division',
    dataIndex: 'division_name',
    key: 'division_name',
    width: 100,
    ellipsis: true,
    render: (v: string) => v || '-',
  },
  {
    title: 'Other Division',
    dataIndex: 'division_other',
    key: 'division_other',
    width: 110,
    ellipsis: true,
    render: (_: unknown, r: Ticket) => (r.division_name === 'Other' ? (r.division_other || '-') : ''),
  },
  {
    title: 'Attachment',
    dataIndex: 'attachment_url',
    key: 'attachment_url',
    width: 100,
    render: (v: string) => {
      if (!v || !v.trim()) return '-'
      const url = v.trim()
      const handleClick = (e: React.MouseEvent) => {
        e.preventDefault()
        e.stopPropagation()
        if (url.startsWith('http://') || url.startsWith('https://')) {
          window.open(url, '_blank', 'noopener,noreferrer')
        }
      }
      return (
        <a href={url.startsWith('http') ? url : '#'} target="_blank" rel="noopener noreferrer" onClick={handleClick}>
          <LinkOutlined /> View
        </a>
      )
    },
  },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
      width: 200,
      ellipsis: false,
      render: (v: string) => {
        const raw = (v && v.trim()) || ''
        if (!raw) return <span style={wrapStyle}>-</span>
        return (
          <TextCellTooltip tooltip={raw}>
            <span style={{ ...wrapStyle, ...tableCellEllipsisStyle }}>{raw}</span>
          </TextCellTooltip>
        )
      },
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      width: 220,
      ellipsis: false,
      render: (v: string) => {
        const raw = (v && v.trim()) || ''
        if (!raw) return <span style={wrapStyle}>-</span>
        return (
          <TextCellTooltip tooltip={raw}>
            <span style={{ ...wrapStyle, ...tableCellEllipsisStyle }}>{raw}</span>
          </TextCellTooltip>
        )
      },
    },
  {
    title: 'Type of Request',
    dataIndex: 'type',
    key: 'type',
    width: 100,
    render: (v: string) => (
      <Tag color={getTypeColor(v)}>{v === 'chore' ? 'Chores' : v === 'bug' ? 'Bug' : 'Feature'}</Tag>
    ),
  },
  {
    title: 'CT',
    dataIndex: 'communicated_through',
    key: 'communicated_through',
    width: 70,
    render: (v: string) => getCommIcon(v),
  },
  {
    title: 'Submitted By',
    dataIndex: 'submitted_by',
    key: 'submitted_by',
    width: 110,
    ellipsis: true,
    render: (v: string) => v || '-',
  },
  {
    title: 'Query Arrival',
    dataIndex: 'query_arrival_at',
    key: 'query_arrival_at',
    width: 140,
    render: (v: string) => formatDateTable(v),
  },
  {
    title: 'Quality of Response',
    dataIndex: 'quality_of_response',
    key: 'quality_of_response',
    width: 140,
    ellipsis: false,
    render: (v: string) => (
      <span style={wrapStyle} title={v?.trim() ? String(v) : undefined}>
        {truncateTitleDescCell(v || undefined, TICKET_TABLE_QA_PREVIEW_MAX_CHARS)}
      </span>
    ),
  },
  {
    title: 'Customer Questions',
    dataIndex: 'customer_questions',
    key: 'customer_questions',
    width: 140,
    ellipsis: false,
    render: (v: string) => (
      <span style={wrapStyle} title={v?.trim() ? String(v) : undefined}>
        {truncateTitleDescCell(v || undefined, TICKET_TABLE_QA_PREVIEW_MAX_CHARS)}
      </span>
    ),
  },
  {
    title: 'Query Response',
    dataIndex: 'query_response_at',
    key: 'query_response_at',
    width: 140,
    render: (v: string) => formatDateTable(v),
  },
  {
    title: 'Reply Status',
    key: 'reply_status',
    width: 180,
    ellipsis: false,
    render: (_: unknown, r: Ticket) => {
      const sla = formatReplySla(r.query_arrival_at, r.query_response_at)
      return (
        <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
          <Tag color={sla.status === 'on-time' ? 'green' : 'red'}>{sla.text}</Tag>
        </span>
      )
    },
  },
  {
    title: 'Current Stage',
    key: 'current_stage',
    width: 140,
    ellipsis: false,
    render: (_: unknown, r: Ticket) => {
      const stage = getStagingCurrentStage(r)
      return <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{stage.stageLabel}</span>
    },
  },
  {
    title: 'Planned',
    key: 'staging_planned',
    width: 120,
    ellipsis: false,
    render: (_: unknown, r: Ticket) => {
      const stage = getStagingCurrentStage(r)
      return <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{stage.planned}</span>
    },
  },
  {
    title: 'Actual',
    key: 'staging_actual',
    width: 120,
    ellipsis: false,
    render: (_: unknown, r: Ticket) => {
      const stage = getStagingCurrentStage(r)
      return <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{stage.actual}</span>
    },
  },
  {
    title: 'Status',
    key: 'staging_status',
    width: 100,
    ellipsis: false,
    render: (_: unknown, r: Ticket) => {
      const stage = getStagingCurrentStage(r)
      return <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{stage.status}</span>
    },
  },
  {
    title: 'Time Delay',
    key: 'staging_time_delay',
    width: 100,
    ellipsis: false,
    render: (_: unknown, r: Ticket) => {
      const stage = getStagingCurrentStage(r)
      return <span style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>{stage.timeDelay}</span>
    },
  },
]

export const StagingList = () => {
  const { isUser, canEditSectionByKey } = useRole()
  const scopeHint = isUser
    ? 'Includes staging tickets you submitted, created within the selected date range.'
    : 'Includes all staging tickets created within the selected date range.'
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [total, setTotal] = useState(0)
  const [drawerTicketId, setDrawerTicketId] = useState<string | null>(null)
  /** Stage filter: applies to table, Export and Print */
  const [stageFilter, setStageFilter] = useState<string>('')
  const [referenceFilter, setReferenceFilter] = useState('')
  const [referenceFilterInput, setReferenceFilterInput] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [allStagingTicketsForStageFilter, setAllStagingTicketsForStageFilter] = useState<Ticket[]>([])
  const listFetchGeneration = useRef(0)
  const listPageRef = useRef(0)
  const listExhaustedRef = useRef(false)
  const ticketsRef = useRef<Ticket[]>([])
  const totalRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const tableSentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    ticketsRef.current = tickets
  }, [tickets])
  useEffect(() => {
    totalRef.current = total
  }, [total])

  const fetchStagingTickets = useCallback(async () => {
    const gen = ++listFetchGeneration.current
    listPageRef.current = 0
    listExhaustedRef.current = false
    setLoading(ticketsRef.current.length === 0)
    try {
      const response = await ticketsApi.list({
        section: 'staging',
        page: 1,
        limit: STAGING_CHUNK,
        ...(referenceFilter && { reference_filter: referenceFilter }),
        ...(priorityFilter && { priority: priorityFilter }),
        sort_by: 'created_at',
        sort_order: 'desc',
      })
      if (gen !== listFetchGeneration.current) return
      const raw = response && typeof response === 'object' ? (response as { data?: Ticket[] }).data : undefined
      setTickets(Array.isArray(raw) ? raw : [])
      setTotal((response as { total?: number })?.total ?? 0)
      listPageRef.current = 1
    } catch (error) {
      console.error('Failed to fetch staging tickets:', error)
    } finally {
      if (gen === listFetchGeneration.current) setLoading(false)
    }
  }, [referenceFilter, priorityFilter])

  const fetchStagingTicketsMore = useCallback(async () => {
    if (loading || loadingMoreRef.current || listExhaustedRef.current) return
    if (totalRef.current > 0 && ticketsRef.current.length >= totalRef.current) return
    const nextPage = listPageRef.current + 1
    if (nextPage < 2) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const response = await ticketsApi.list({
        section: 'staging',
        page: nextPage,
        limit: STAGING_CHUNK,
        ...(referenceFilter && { reference_filter: referenceFilter }),
        ...(priorityFilter && { priority: priorityFilter }),
        sort_by: 'created_at',
        sort_order: 'desc',
      })
      const raw = response && typeof response === 'object' ? (response as { data?: Ticket[] }).data : undefined
      const newRows = Array.isArray(raw) ? raw : []
      if (newRows.length === 0) {
        listExhaustedRef.current = true
        return
      }
      setTickets((prev) => [...prev, ...newRows])
      listPageRef.current = nextPage
    } catch (error) {
      console.error('Failed to load more staging tickets:', error)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [loading, referenceFilter, priorityFilter])

  /** Fetches all staging tickets across pages (section: staging, fixed sort). Used for stage filter and export. */
  const fetchAllStagingPages = useCallback(async (): Promise<Ticket[]> => {
    const allTickets: Ticket[] = []
    let currentPage = 1
    const limit = 100
    let hasMore = true
    while (hasMore) {
      const response = await ticketsApi.list({
        section: 'staging',
        page: currentPage,
        limit,
        ...(referenceFilter && { reference_filter: referenceFilter }),
        ...(priorityFilter && { priority: priorityFilter }),
        sort_by: 'created_at',
        sort_order: 'desc',
      })
      const raw = response && typeof response === 'object' ? (response as { data?: Ticket[] }).data : undefined
      const pageTickets: Ticket[] = Array.isArray(raw) ? raw : []
      allTickets.push(...pageTickets)
      hasMore = pageTickets.length === limit
      currentPage++
    }
    return allTickets
  }, [referenceFilter, priorityFilter])

  const fetchAllStagingTicketsForStageFilter = useCallback(async () => {
    const gen = ++listFetchGeneration.current
    setLoading(ticketsRef.current.length === 0)
    try {
      const allTickets = await fetchAllStagingPages()
      if (gen !== listFetchGeneration.current) return
      setAllStagingTicketsForStageFilter(allTickets)
      const filtered = stageFilter
        ? allTickets.filter((t) => getStagingCurrentStage(t).stageLabel === stageFilter)
        : allTickets
      setTickets(filtered.slice(0, STAGING_CHUNK))
      setTotal(filtered.length)
    } catch (error) {
      console.error('Failed to fetch all staging tickets for stage filter:', error)
    } finally {
      if (gen === listFetchGeneration.current) setLoading(false)
    }
  }, [fetchAllStagingPages, stageFilter])

  useEffect(() => {
    if (stageFilter) {
      void fetchAllStagingTicketsForStageFilter()
      return
    }
    setAllStagingTicketsForStageFilter([])
    void fetchStagingTickets()
  }, [stageFilter, referenceFilter, priorityFilter, fetchAllStagingTicketsForStageFilter, fetchStagingTickets])

  useEffect(() => {
    const onTicketChanged = () => {
      if (stageFilter) {
        void fetchAllStagingTicketsForStageFilter()
      } else {
        void fetchStagingTickets()
      }
    }
    window.addEventListener(TICKET_CHANGED_EVENT, onTicketChanged)
    return () => window.removeEventListener(TICKET_CHANGED_EVENT, onTicketChanged)
  }, [stageFilter, fetchAllStagingTicketsForStageFilter, fetchStagingTickets])

  const tryLoadMoreTickets = useCallback(() => {
    if (loading) return
    if (stageFilter) {
      const filtered = stageFilter
        ? allStagingTicketsForStageFilter.filter((t) => getStagingCurrentStage(t).stageLabel === stageFilter)
        : allStagingTicketsForStageFilter
      if (ticketsRef.current.length >= filtered.length) return
      const next = Math.min(filtered.length, ticketsRef.current.length + STAGING_CHUNK)
      setTickets(filtered.slice(0, next))
      return
    }
    void fetchStagingTicketsMore()
  }, [loading, stageFilter, allStagingTicketsForStageFilter, fetchStagingTicketsMore])

  useEffect(() => {
    if (loading) return
    const root = tableContainerRef.current?.querySelector('.ant-table-body') as HTMLElement | null
    const target = tableSentinelRef.current
    if (!target) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        tryLoadMoreTickets()
      },
      { root: root ?? null, rootMargin: '160px', threshold: 0 },
    )
    io.observe(target)
    return () => io.disconnect()
  }, [loading, tryLoadMoreTickets, tickets.length, total, stageFilter, allStagingTicketsForStageFilter.length])

  const stagingStageLabels = ['Stage 1: Staging Planned', 'Stage 2: Live Planned', 'Stage 3: Review Planned']
  const ticketsForDisplay = tickets
  const stagedFilteredCount = useMemo(() => {
    if (!stageFilter) return total
    return allStagingTicketsForStageFilter.filter((t) => getStagingCurrentStage(t).stageLabel === stageFilter).length
  }, [allStagingTicketsForStageFilter, stageFilter, total])
  const getStageForExport = (t: Record<string, unknown>) => getStagingCurrentStage(t as Parameters<typeof getStagingCurrentStage>[0])
  const exportColumns = [...TICKET_EXPORT_COLUMNS]
  const fetchExportRowsByDateRange = useCallback(
    async (dateFrom: string, dateTo: string) => {
      const bounds = dateRangeToIsoBounds(dateFrom, dateTo)
      const allTickets = await fetchAllTicketsPages({
        section: 'staging',
        sort_by: 'created_at',
        sort_order: 'desc',
        date_from: bounds.date_from,
        date_to: bounds.date_to,
        ...(isUser ? { mine_only: true } : {}),
      })
      return allTickets.map((t) =>
        buildTicketExportRow(t as unknown as Record<string, unknown>, getStageForExport),
      )
    },
    [isUser],
  )

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-start', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 10 }}>
        <Title level={2} className="page-main-heading" style={{ margin: 0 }}>
          Staging
        </Title>
        <SupportSectionTabs />
      </div>
      <div className="page-toolbar-row" style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
        <PrintExport
          pageTitle="Staging"
          dateRangeExport={{
            columns: exportColumns,
            filename: 'staging_tickets',
            scopeHint,
            fetchRows: fetchExportRowsByDateRange,
          }}
        />
      </div>
      <Card>
        <Space style={{ marginBottom: 16 }} wrap>
          <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
            Tickets in Staging workflow (Stage 1–3). All columns up to Reference No. Click a row to open staging details.
          </Typography.Paragraph>
          <Input
            placeholder="Reference Filter"
            style={{ width: 160 }}
            value={referenceFilterInput}
            onChange={(e) => setReferenceFilterInput(e.target.value)}
            onPressEnter={() => {
              setReferenceFilter(referenceFilterInput)
            }}
            allowClear
          />
          <TicketPriorityFilter value={priorityFilter} onChange={setPriorityFilter} />
          <Select
            placeholder="Stage"
            style={{ width: 180 }}
            value={stageFilter || undefined}
            onChange={(v) => {
              setStageFilter(v ?? '')
            }}
            allowClear
            aria-label="Stage filter"
          >
            {stagingStageLabels.map((label) => (
              <Option key={label} value={label}>{label}</Option>
            ))}
          </Select>
        </Space>
        <TableWithSkeletonLoading loading={loading} columns={10} rows={12}>
          <div ref={tableContainerRef}>
            <Table
              columns={stagingTicketColumns}
              dataSource={ticketsForDisplay}
              rowKey="id"
              virtual
              loading={false}
              scroll={{ x: 2600, y: 600 }}
              onRow={(record) => ({
                onClick: () => {
                  if (!record?.id) return
                  setDrawerTicketId(record.id)
                },
                style: { cursor: 'pointer' },
              })}
              pagination={false}
              summary={() => (
                <Table.Summary>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={stagingTicketColumns.length}>
                      <div ref={tableSentinelRef} style={{ height: 8, minHeight: 8 }} aria-hidden />
                      <Typography.Text type="secondary">
                        Showing {ticketsForDisplay.length} of {stagedFilteredCount} tickets
                        {ticketsForDisplay.length < stagedFilteredCount ? ' · scroll to load more' : ''}
                      </Typography.Text>
                      {loadingMore ? <span style={{ marginLeft: 8 }}>Loading...</span> : null}
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
            />
          </div>
        </TableWithSkeletonLoading>
      </Card>
      <StagingDetailDrawer
        ticketId={drawerTicketId}
        open={!!drawerTicketId}
        onClose={() => {
          setDrawerTicketId(null)
        }}
        onUpdate={() => {
          setDrawerTicketId(null)
          void fetchStagingTickets()
        }}
        readOnly={!canEditSectionByKey('staging')}
      />
    </div>
  )
}
