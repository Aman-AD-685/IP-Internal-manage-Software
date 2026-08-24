import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, DatePicker, Modal, Select, Space, Table, Typography, message } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import type { ColumnsType } from 'antd/es/table'
import { apiClient } from '../../api/axios'
import { API_ENDPOINTS } from '../../utils/constants'
import { normalizeCompanyDedupeKey } from '../../utils/companiesDedupe'
import './PendingPaymentDetailsPage.css'
import { TableWithSkeletonLoading } from '../../components/common/skeletons'
import { exportRowsToCsv, type ExportColumn } from '../../utils/exportCsv'
import { OperationsSectionTabs } from '../../components/common/OperationsSectionTabs'

const { Title } = Typography
const { RangePicker } = DatePicker
const REFRESH_INTERVAL_MS = 30000

type PendingPaymentRow = {
  id: string
  reference_no?: string
  company_name?: string
  invoice_date?: string | null
  invoice_amount?: string | number | null
  invoice_number?: string | null
  genre?: string | null
  stage?: string | null
  status?: string | null
  aging_days?: number | null
}


function fmtINR(n: number): string {
  try {
    return new Intl.NumberFormat('en-IN').format(n)
  } catch {
    return String(n)
  }
}

function parseNum(v: string | number | null | undefined): number {
  if (v == null) return 0
  const s = String(v).trim()
  if (!s) return 0
  const cleaned = s.replace(/,/g, '')
  const num = Number(cleaned)
  return Number.isFinite(num) ? num : 0
}

function getCurrentQuarterRange(): [Dayjs, Dayjs] {
  const now = dayjs()
  const qStartMonth = Math.floor(now.month() / 3) * 3
  const start = now.month(qStartMonth).startOf('month').startOf('day')
  const end = start.add(2, 'month').endOf('month').endOf('day')
  return [start, end]
}

export function PendingPaymentDetailsPage() {
  const [loading, setLoading] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [rows, setRows] = useState<PendingPaymentRow[]>([])
  const inFlightRef = useRef(false)

  // Default: current quarter date range.
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>(getCurrentQuarterRange())
  const [companyFilter, setCompanyFilter] = useState<string>('')
  const [exportOpen, setExportOpen] = useState(false)
  const [selectedExportColumns, setSelectedExportColumns] = useState<string[]>([])

  const fetchRows = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    // Prevent overlapping requests when interval + visibility trigger fire together.
    setLoading(true)
    setSetupError(null)
    try {
      const res = await apiClient.get<{ items: PendingPaymentRow[] }>(API_ENDPOINTS.CLIENT_PAYMENT.LIST_OPEN)
      setRows(Array.isArray(res.data?.items) ? res.data.items : [])
    } catch (e: any) {
      const detail = e?.response?.data?.detail
      setSetupError(detail || 'Could not load pending payment details.')
      setRows([])
    } finally {
      setLoading(false)
      inFlightRef.current = false
    }
  }, [])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  useEffect(() => {
    // Real-time feel: poll + refresh when tab becomes visible.
    const id = window.setInterval(() => {
      // Avoid hammering while user is typing/filtering; keep it simple.
      fetchRows()
    }, REFRESH_INTERVAL_MS)

    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchRows()
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [fetchRows])

  const companyOptions = useMemo(() => {
    // Deduplicate using normalized key to avoid "double" near-identical entries.
    const map = new Map<string, PendingPaymentRow>()
    for (const r of rows) {
      const name = (r.company_name || '').trim()
      if (!name) continue
      const k = normalizeCompanyDedupeKey(name)
      const prev = map.get(k)
      if (!prev) {
        map.set(k, r)
      } else {
        // Prefer shorter display name.
        const prevLen = String(prev.company_name || '').trim().length
        const curLen = name.length
        if (curLen < prevLen) map.set(k, r)
      }
    }
    const out = [...map.values()]
      .map((r) => ({ key: String(r.company_name || '').trim(), label: String(r.company_name || '').trim() }))
      .filter((x) => x.key)
    out.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))
    return out
  }, [rows])

  const filteredRows = useMemo(() => {
    const [from, to] = dateRange
    const fromD = from.startOf('day')
    const toD = to.endOf('day')

    return rows.filter((r) => {
      const invRaw = r.invoice_date || null
      const fallbackRaw = (r as any).timestamp || null
      const inv = dayjs(invRaw || fallbackRaw)
      if (!inv.isValid()) return false
      if (inv.isBefore(fromD) || inv.isAfter(toD)) return false

      if (companyFilter) {
        const cn = (r.company_name || '').trim()
        if (cn !== companyFilter) return false
      }

      return true
    })
  }, [rows, dateRange, companyFilter])

  const totalDue = useMemo(() => {
    return filteredRows.reduce((sum, r) => sum + parseNum(r.invoice_amount), 0)
  }, [filteredRows])

  const columns: ColumnsType<PendingPaymentRow> = [
    {
      title: 'Reference No',
      dataIndex: 'reference_no',
      key: 'reference_no',
      width: 200,
      ellipsis: true,
      render: (v) => v || '-',
    },
    {
      title: 'Company Name',
      dataIndex: 'company_name',
      key: 'company_name',
      width: 260,
      ellipsis: true,
      render: (v) => v || '-',
    },
    {
      title: 'Invoice Date',
      dataIndex: 'invoice_date',
      key: 'invoice_date',
      width: 150,
      render: (v) => (v ? dayjs(v).isValid() ? dayjs(v).format('MMM D, YYYY') : '-' : '-'),
    },
    {
      title: 'Invoice Amount',
      dataIndex: 'invoice_amount',
      key: 'invoice_amount',
      width: 160,
      align: 'right',
      render: (v) => `₹${fmtINR(parseNum(v))}`,
    },
    {
      title: 'Genre',
      dataIndex: 'genre',
      key: 'genre',
      width: 100,
      render: (v) => String(v || '-'),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 140,
      render: (v) => String(v || '-'),
    },
    {
      title: 'Overdue',
      dataIndex: 'aging_days',
      key: 'aging_days',
      width: 110,
      align: 'center',
      render: (v) => (v != null ? String(v) : '0'),
    },
  ]

  const tableData = filteredRows
  const exportColumns: ExportColumn<PendingPaymentRow>[] = [
    { key: 'reference_no', label: 'Reference No', getValue: (r) => r.reference_no || '-' },
    { key: 'company_name', label: 'Company Name', getValue: (r) => r.company_name || '-' },
    { key: 'invoice_date', label: 'Invoice Date', getValue: (r) => (r.invoice_date ? (dayjs(r.invoice_date).isValid() ? dayjs(r.invoice_date).format('MMM D, YYYY') : '-') : '-') },
    { key: 'invoice_amount', label: 'Invoice Amount', getValue: (r) => parseNum(r.invoice_amount) },
    { key: 'genre', label: 'Genre', getValue: (r) => String(r.genre || '-') },
    { key: 'status', label: 'Status', getValue: (r) => String(r.status || '-') },
    { key: 'aging_days', label: 'Overdue', getValue: (r) => (r.aging_days != null ? r.aging_days : 0) },
  ]
  const exportOptions = exportColumns.map((c) => ({ label: c.label, value: c.key }))

  const openExport = () => {
    setSelectedExportColumns(exportColumns.map((c) => c.key))
    setExportOpen(true)
  }

  const handleExport = () => {
    const cols = exportColumns.filter((c) => selectedExportColumns.includes(c.key))
    if (!cols.length) {
      message.warning('Select at least one column to export')
      return
    }
    exportRowsToCsv({
      filename: `pending-payment-details-${dayjs().format('YYYYMMDD-HHmm')}.csv`,
      columns: cols,
      rows: tableData,
    })
    setExportOpen(false)
    message.success('Export started')
  }

  return (
    <div className="ppd-page">
      <div className="page-toolbar-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 8, width: '100%' }}>
        <OperationsSectionTabs module="client-payment" />
        <Button icon={<DownloadOutlined />} onClick={openExport} aria-label="Export" title="Export" />
      </div>

      <div className="ppd-controls">
        <div className="ppd-control ppd-control--company">
          <div className="ppd-control-label">Company Name</div>
          <Select
            showSearch
            placeholder="Select company"
            value={companyFilter || undefined}
            options={companyOptions.map((c) => ({ value: c.key, label: c.label }))}
            onChange={(v) => setCompanyFilter(v || '')}
            allowClear
            filterOption={(input, opt) => (opt?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())}
          />
        </div>

        <div className="ppd-control ppd-control--range">
          <div className="ppd-control-label">Select date range</div>
          <RangePicker
            value={dateRange}
            onChange={(vals) => {
              if (!vals || !vals[0] || !vals[1]) return
              setDateRange([vals[0].startOf('day'), vals[1].endOf('day')])
            }}
            format="MMM D, YYYY"
            allowClear={false}
          />
        </div>

        <div className="ppd-top-right">
          <div className="ppd-kpi">
            <div className="ppd-kpi-label">Total Due</div>
            <div className="ppd-kpi-value">₹{fmtINR(totalDue)}</div>
          </div>
        </div>
      </div>

      {setupError && <Alert type="warning" message={setupError} showIcon style={{ marginBottom: 12 }} />}

      <div className="ppd-table-wrap">
        <TableWithSkeletonLoading loading={loading} columns={10} rows={14}>
          <Table
            rowKey={(r) => String(r.id)}
            columns={columns}
            dataSource={tableData}
            loading={false}
            pagination={false}
            size="small"
            className="ppd-table"
          />
        </TableWithSkeletonLoading>
      </div>

      <Modal
        title="Export Pending Payment Details"
        open={exportOpen}
        onCancel={() => setExportOpen(false)}
        onOk={handleExport}
        okText="Export"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text type="secondary">Select columns to include in export.</Typography.Text>
          <Checkbox.Group
            style={{ width: '100%' }}
            value={selectedExportColumns}
            options={exportOptions}
            onChange={(vals) => setSelectedExportColumns(vals as string[])}
          />
        </Space>
      </Modal>
    </div>
  )
}

