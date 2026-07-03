import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Button,
  Card,
  Checkbox,
  Collapse,
  Modal,
  Space,
  Table,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ReloadOutlined } from '@ant-design/icons'
import { apiClient } from '../../api/axios'
import { API_ENDPOINTS } from '../../utils/constants'
import { TableWithSkeletonLoading } from '../../components/common/skeletons'
import { exportRowsToCsv, type ExportColumn } from '../../utils/exportCsv'
import { PaymentAmountKpiCards, type PaymentAmountKpis } from '../../components/onboarding/PaymentAmountKpiCards'
import { OperationsSectionTabs } from '../../components/common/OperationsSectionTabs'

const { Title, Text, Link } = Typography

/** Table-only DDL (Supabase). */
const SQL_SETUP_HREF = '/SUPABASE_PAYMENT_AGEING_REPORT.sql'
/** Full script: create tables + load 69 companies (run once). */
const SQL_FULL_HREF = '/SUPABASE_PAYMENT_AGEING_FULL_SETUP.sql'

type AgeingRow = {
  company_id: string | null
  company_name: string
  amount_incl_gst: number
  quarter_days: (number | null)[]
  median_value: number | null
  last_quarter_days: number | null
  received_amount: number
  /** ISO date; used server-side for bucket weighting (optional on older API). */
  first_invoice_date?: string | null
}

export type AgeingSummaryRow = {
  days: string
  median: number
  received: number
  due_excs_for_wk: number
  fy_24_25_q4_to_be: number
  to_be_pct: number
  received_pct: number
  fy_24_25_q1: number
  fy_24_25_q2: number
  fy_24_25_q4_received: number
  fy_24_25_q3: number
}

type ReportPayload = {
  quarter_labels: string[]
  rows: AgeingRow[]
  summary: {
    rows: AgeingSummaryRow[]
    locked?: boolean
    totals: {
      median: number
      received: number
      due_excs_for_wk: number
      fy_24_25_q4_to_be: number
      to_be_pct: number
      received_pct: number
      fy_24_25_q1: number
      fy_24_25_q2: number
      fy_24_25_q4_received: number
      fy_24_25_q3: number
    }
  }
  kpis?: PaymentAmountKpis
}

const fmt = (n: number) => n.toLocaleString('en-IN')
const fmtPct = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0.00')

/** Blank cells stay empty in the grid (no em-dash placeholder). */
function formatDaysCell(v: number | null | undefined): string {
  if (v === null || v === undefined) return ''
  return String(v)
}

function buildFilters(values: (string | number | null | undefined)[]) {
  const uniq = [...new Set(values.map((v) => (v === null || v === undefined ? '' : String(v))).filter(Boolean))]
  uniq.sort()
  return uniq.map((v) => ({ text: v, value: v }))
}

export function PaymentAgeingReportPage() {
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ReportPayload | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [selectedExportColumns, setSelectedExportColumns] = useState<string[]>([])

  const load = useCallback(() => {
    setLoading(true)
    apiClient
      .get<ReportPayload>(API_ENDPOINTS.CLIENT_PAYMENT.PAYMENT_AGEING_REPORT)
      .then((r) => setData(r.data))
      .catch(() => {
        message.error(
          <>
            Could not load Payment Ageing Report. Run the SQL in Supabase:{' '}
            <Link href={SQL_SETUP_HREF} target="_blank" rel="noopener noreferrer">
              SUPABASE_PAYMENT_AGEING_REPORT.sql
            </Link>{' '}
            or full setup{' '}
            <Link href={SQL_FULL_HREF} target="_blank" rel="noopener noreferrer">
              SUPABASE_PAYMENT_AGEING_FULL_SETUP.sql
            </Link>
          </>
        )
        setData(null)
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [load])

  const columns: ColumnsType<AgeingRow> = useMemo(() => {
    if (!data?.quarter_labels?.length) {
      return [
        { title: 'Company Name', dataIndex: 'company_name', key: 'company_name', width: 240 },
        { title: 'Loading...', key: 'loading', render: () => '' },
      ]
    }

    const base: ColumnsType<AgeingRow> = [
      {
        title: 'Company Name',
        dataIndex: 'company_name',
        key: 'company_name',
        width: 1,
        ellipsis: true,
        onCell: () => ({ style: { maxWidth: 130 } }),
        filters: buildFilters((data?.rows || []).map((r) => r.company_name)),
        onFilter: (value, record) => record.company_name === value,
        filterSearch: true,
      },
      {
        title: 'Amount (Incl GST)',
        dataIndex: 'amount_incl_gst',
        key: 'amount_incl_gst',
        width: 120,
        align: 'right',
        render: (v: number) => fmt(v),
        filters: buildFilters((data?.rows || []).map((r) => fmt(r.amount_incl_gst))),
        onFilter: (value, record) => fmt(record.amount_incl_gst) === value,
      },
    ]

    data.quarter_labels.forEach((label, idx) => {
      base.push({
        title: (
          <span>
            {label}
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>
              Days
            </Text>
          </span>
        ),
        key: `q${idx}`,
        width: 96,
        align: 'center',
        render: (_: unknown, record: AgeingRow) => formatDaysCell(record.quarter_days[idx]),
        filters: buildFilters((data?.rows || []).map((r) => formatDaysCell(r.quarter_days[idx]))),
        onFilter: (value, record) => formatDaysCell(record.quarter_days[idx]) === value,
      })
    })

    base.push({
      title: 'Median',
      dataIndex: 'median_value',
      key: 'median_value',
      width: 40,
      align: 'center',
      render: (v: number | null | undefined) => formatDaysCell(v),
      filters: buildFilters((data?.rows || []).map((r) => formatDaysCell(r.median_value))),
      onFilter: (value, record) => formatDaysCell(record.median_value) === value,
    })

    return base
  }, [data])

  const summaryTableColumns: ColumnsType<AgeingSummaryRow> = [
    { title: 'Days', dataIndex: 'days', key: 'days', width: 95, fixed: 'left' },
    { title: 'Median', dataIndex: 'median', key: 'median', width: 85, align: 'right', render: (v: number) => fmt(v) },
    { title: 'Received', dataIndex: 'received', key: 'received', width: 90, align: 'right', render: (v: number) => fmt(v) },
    { title: 'Due/Excs for Wk', dataIndex: 'due_excs_for_wk', key: 'due', width: 105, align: 'right', render: (v: number) => fmt(v) },
    { title: 'To be %', dataIndex: 'to_be_pct', key: 'tbp', width: 75, align: 'right', render: (v: number) => fmtPct(v) },
    { title: 'Received %', dataIndex: 'received_pct', key: 'rcp', width: 90, align: 'right', render: (v: number) => fmtPct(v) },
  ]

  const summaryTotals = data?.summary?.totals
  const kpis = data?.kpis
  const exportColumns = useMemo<ExportColumn<AgeingRow>[]>(() => {
    const cols: ExportColumn<AgeingRow>[] = [
      { key: 'company_name', label: 'Company Name', getValue: (r) => r.company_name || '' },
      { key: 'amount_incl_gst', label: 'Amount (Incl GST)', getValue: (r) => r.amount_incl_gst },
    ]
    ;(data?.quarter_labels || []).forEach((label, idx) => {
      cols.push({
        key: `q${idx}`,
        label: `${label} (Days)`,
        getValue: (r) => (r.quarter_days[idx] == null ? '' : r.quarter_days[idx]),
      })
    })
    cols.push({ key: 'median_value', label: 'Median', getValue: (r) => r.median_value ?? '' })
    return cols
  }, [data?.quarter_labels])
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
      filename: `payment-ageing-report-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`,
      columns: cols,
      rows: data?.rows || [],
    })
    setExportOpen(false)
    message.success('Export started')
  }

  return (
    <div style={{ padding: 16 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Space direction="vertical" size="small" style={{ width: '100%' }}>
          <OperationsSectionTabs module="client-payment" />
          <Title level={4} className="page-main-heading" style={{ margin: 0 }}>
            Payment Ageing Report
          </Title>
        </Space>

        <PaymentAmountKpiCards kpis={kpis ?? null} />

        <Space>
          <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>
            Refresh
          </Button>
          <Button onClick={openExport}>Export</Button>
        </Space>

        <Card size="small">
          <style>
            {`
              .payment-ageing-compact-table .ant-table,
              .payment-ageing-compact-table .ant-table-container table {
                width: max-content !important;
                min-width: 0 !important;
              }
              .payment-ageing-compact-table .ant-table-thead > tr > th,
              .payment-ageing-compact-table .ant-table-tbody > tr > td {
                padding-left: 8px !important;
                padding-right: 8px !important;
                white-space: nowrap;
              }
            `}
          </style>
          <TableWithSkeletonLoading loading={loading} columns={12} rows={14}>
            <Table<AgeingRow>
              className="payment-ageing-compact-table"
              rowKey={(r) => `${r.company_id ?? ''}::${r.company_name || ''}`}
              loading={false}
              columns={columns}
              dataSource={data?.rows || []}
              scroll={{ x: 'max-content' }}
              pagination={{ pageSize: 100, showSizeChanger: true, pageSizeOptions: ['50', '100', '200'] }}
              size="small"
            />
          </TableWithSkeletonLoading>
        </Card>

        <Collapse
          defaultActiveKey={['summary']}
          items={[
            {
              key: 'summary',
              label: 'Ageing summary (by median days)',
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  {data?.summary?.rows?.length ? (
                    <Table<AgeingSummaryRow>
                      size="small"
                      pagination={false}
                      rowKey="days"
                      tableLayout="fixed"
                      scroll={{ x: 540 }}
                      columns={summaryTableColumns}
                      dataSource={data.summary.rows}
                      summary={() =>
                        summaryTotals ? (
                          <Table.Summary fixed>
                            <Table.Summary.Row>
                              <Table.Summary.Cell index={0}>
                                <Text strong>Total</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={1}>
                                <Text strong>{fmt(summaryTotals.median)}</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={2}>
                                <Text strong>{fmt(summaryTotals.received)}</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={3}>
                                <Text strong>{fmt(summaryTotals.due_excs_for_wk)}</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={4}>
                                <Text strong>{fmtPct(summaryTotals.to_be_pct)}</Text>
                              </Table.Summary.Cell>
                              <Table.Summary.Cell index={5}>
                                <Text strong>{fmtPct(summaryTotals.received_pct)}</Text>
                              </Table.Summary.Cell>
                            </Table.Summary.Row>
                          </Table.Summary>
                        ) : null
                      }
                    />
                  ) : (
                    <Text type="secondary">No summary data.</Text>
                  )}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {data?.summary?.locked
                      ? 'Summary amounts appear after the current quarter ends (e.g. Q2 after 30 Sep). Until then all buckets show 0.'
                      : 'Percent columns are share of row Median / Received vs report totals. Only companies with a valid Median (payment in at least 2 quarters) are included.'}
                  </Text>
                </Space>
              ),
            },
          ]}
        />
      </Space>

      <Modal
        title="Export Payment Ageing"
        open={exportOpen}
        onCancel={() => setExportOpen(false)}
        onOk={handleExport}
        okText="Export"
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary">Select columns to include in export.</Text>
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
