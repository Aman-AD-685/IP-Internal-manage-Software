import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ContextMenuTarget } from './ContextMenuTarget'
import { Button, Space, Modal, Form, DatePicker, Typography } from 'antd'
import { PrinterOutlined, DownloadOutlined } from '@ant-design/icons'
import { message } from 'antd'
import dayjs, { type Dayjs } from 'dayjs'

const { RangePicker } = DatePicker
const { Text } = Typography

export interface ExportColumn {
  key: string
  label: string
}

export interface DateRangeExportConfig {
  columns: ExportColumn[]
  /** Load ticket rows for inclusive calendar date range (YYYY-MM-DD). */
  fetchRows: (dateFrom: string, dateTo: string) => Promise<Record<string, unknown>[]>
  filename: string
  /** e.g. "your support tickets" */
  scopeHint?: string
}

export interface PrintExportProps {
  pageTitle: string
  /** Legacy: export current rows without date modal (non–Support pages). */
  exportData?: {
    columns: ExportColumn[]
    rows: Record<string, unknown>[]
  }
  exportFilename?: string
  /** @deprecated Use dateRangeExport for Support ticket sections */
  onExportClick?: (event?: React.MouseEvent<HTMLButtonElement>) => void
  /** When set, Export and Print ask for a date range and load tickets for that period. */
  dateRangeExport?: DateRangeExportConfig
}

function escapeCsvCell(value: unknown): string {
  if (value == null) return ''
  let s = String(value)
  if (/^[=+\-@]/.test(s)) s = "'" + s
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function downloadCsv(columns: ExportColumn[], rows: Record<string, unknown>[], filename: string) {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(',')
  const lines = rows.map((row) => columns.map((col) => escapeCsvCell(row[col.key])).join(','))
  const csv = [header, ...lines].join('\r\n')
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.csv`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

function printRowsTable(pageTitle: string, columns: ExportColumn[], rows: Record<string, unknown>[]) {
  const head = columns.map((c) => `<th>${escapeHtml(c.label)}</th>`).join('')
  const body = rows
    .map(
      (row) =>
        `<tr>${columns.map((c) => `<td>${escapeHtml(String(row[c.key] ?? ''))}</td>`).join('')}</tr>`,
    )
    .join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${escapeHtml(pageTitle)}</title>
<style>
  body{font-family:Segoe UI,system-ui,sans-serif;padding:24px;color:#111}
  h1{font-size:18px;margin:0 0 8px}
  .meta{color:#555;font-size:12px;margin-bottom:16px}
  table{border-collapse:collapse;width:100%;font-size:11px}
  th,td{border:1px solid #ccc;padding:6px 8px;text-align:left;vertical-align:top}
  th{background:#f1f5f9}
</style></head><body>
<h1>${escapeHtml(pageTitle)}</h1>
<p class="meta">Printed ${escapeHtml(new Date().toLocaleString())} · ${rows.length} row(s)</p>
<table><thead><tr>${head}</tr></thead><tbody>${body || '<tr><td colspan="' + columns.length + '">No rows</td></tr>'}</tbody></table>
</body></html>`
  const w = window.open('', '_blank')
  if (!w) {
    message.error('Allow pop-ups to print this report')
    return
  }
  w.document.write(html)
  w.document.close()
  w.focus()
  w.print()
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function PrintExport({
  pageTitle,
  exportData,
  exportFilename,
  onExportClick,
  dateRangeExport,
}: PrintExportProps) {
  const location = useLocation()
  const pageHref = location.pathname + location.search
  const [rangeModalOpen, setRangeModalOpen] = useState(false)
  const [rangeModalMode, setRangeModalMode] = useState<'export' | 'print'>('export')
  const [rangeLoading, setRangeLoading] = useState(false)
  const [form] = Form.useForm<{ range: [Dayjs, Dayjs] }>()

  const useDateRange = Boolean(dateRangeExport)

  const handleLegacyPrint = () => {
    const prevTitle = document.title
    document.title = `${pageTitle} - ${new Date().toLocaleDateString()}`
    window.print()
    document.title = prevTitle
  }

  const openRangeModal = (mode: 'export' | 'print') => {
    setRangeModalMode(mode)
    const end = dayjs().endOf('day')
    const start = dayjs().subtract(30, 'day').startOf('day')
    form.setFieldsValue({ range: [start, end] })
    setRangeModalOpen(true)
  }

  const runDateRangeAction = async () => {
    if (!dateRangeExport) return
    let values: { range?: [Dayjs, Dayjs] }
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    const [from, to] = values.range ?? []
    if (!from || !to) {
      message.warning('Select a date range')
      return
    }
    const dateFrom = from.format('YYYY-MM-DD')
    const dateTo = to.format('YYYY-MM-DD')
    if (to.isBefore(from, 'day')) {
      message.warning('End date must be on or after start date')
      return
    }

    setRangeLoading(true)
    try {
      const rows = await dateRangeExport.fetchRows(dateFrom, dateTo)
      if (!rows.length) {
        message.warning('No tickets found in the selected date range')
        return
      }
      setRangeModalOpen(false)
      if (rangeModalMode === 'export') {
        downloadCsv(dateRangeExport.columns, rows, dateRangeExport.filename)
        message.success(`Exported ${rows.length} ticket(s)`)
      } else {
        printRowsTable(pageTitle, dateRangeExport.columns, rows)
      }
    } catch {
      message.error('Failed to load tickets for export')
    } finally {
      setRangeLoading(false)
    }
  }

  const handlePrint = () => {
    if (useDateRange) {
      openRangeModal('print')
      return
    }
    handleLegacyPrint()
  }

  const handleExport = async () => {
    if (useDateRange) {
      openRangeModal('export')
      return
    }
    if (onExportClick) {
      await onExportClick()
    }
    if (!exportData || !exportData.columns.length || !exportData.rows.length) {
      message.warning('No data to export')
      return
    }
    const name = exportFilename || pageTitle.replace(/\s+/g, '_')
    downloadCsv(exportData.columns, exportData.rows, name)
    message.success('Export downloaded')
  }

  const canExport = useDateRange || (exportData && exportData.columns.length > 0)

  return (
    <>
      <Space className="no-print" size="middle" style={{ marginBottom: 16 }}>
        <ContextMenuTarget openHref={pageHref} openLabel={`Print ${pageTitle}`}>
          <Button type="default" icon={<PrinterOutlined />} onClick={handlePrint}>
            Print
          </Button>
        </ContextMenuTarget>
        {canExport && (
          <ContextMenuTarget openHref={pageHref} openLabel={`Export ${pageTitle}`}>
            <Button type="default" icon={<DownloadOutlined />} onClick={() => void handleExport()}>
              Export
            </Button>
          </ContextMenuTarget>
        )}
      </Space>

      <Modal
        title={rangeModalMode === 'export' ? 'Export — select date range' : 'Print — select date range'}
        open={rangeModalOpen}
        onCancel={() => setRangeModalOpen(false)}
        onOk={() => void runDateRangeAction()}
        okText={rangeModalMode === 'export' ? 'Export' : 'Print'}
        confirmLoading={rangeLoading}
        destroyOnClose
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          {dateRangeExport?.scopeHint ??
            'Includes all tickets you can access in this section, created within the selected dates.'}
        </Text>
        <Form form={form} layout="vertical">
          <Form.Item
            name="range"
            label="Date range"
            rules={[{ required: true, message: 'Select from and to dates' }]}
          >
            <RangePicker style={{ width: '100%' }} format="YYYY-MM-DD" allowClear={false} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}
