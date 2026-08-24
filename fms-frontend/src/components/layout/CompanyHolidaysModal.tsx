import { Modal, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { checklistApi } from '../../api/checklist'

type HolidayRow = {
  key: string
  holiday_date: string
  holiday_name: string
  year: number
}

interface CompanyHolidaysModalProps {
  open: boolean
  onClose: () => void
}

export function CompanyHolidaysModal({ open, onClose }: CompanyHolidaysModalProps) {
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState<HolidayRow[]>([])

  const years = useMemo(() => {
    const y = dayjs().year()
    return [y, y + 1]
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    Promise.all(years.map((year) => checklistApi.getHolidays(year).then((res) => ({ year, holidays: res.holidays ?? [] }))))
      .then((results) => {
        if (cancelled) return
        const next: HolidayRow[] = []
        for (const { year, holidays } of results) {
          for (const h of holidays) {
            next.push({
              key: `${year}-${h.holiday_date}`,
              holiday_date: h.holiday_date,
              holiday_name: h.holiday_name,
              year,
            })
          }
        }
        next.sort((a, b) => a.holiday_date.localeCompare(b.holiday_date))
        setRows(next)
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, years])

  const columns: ColumnsType<HolidayRow> = [
    {
      title: 'Date',
      dataIndex: 'holiday_date',
      key: 'holiday_date',
      width: 140,
      render: (value: string) => dayjs(value).format('DD MMM YYYY (ddd)'),
    },
    {
      title: 'Holiday',
      dataIndex: 'holiday_name',
      key: 'holiday_name',
    },
    {
      title: 'Year',
      dataIndex: 'year',
      key: 'year',
      width: 80,
    },
  ]

  return (
    <Modal
      title="Company holidays"
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      destroyOnClose
    >
      <Table
        size="small"
        rowKey="key"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
        scroll={{ y: 360 }}
        locale={{ emptyText: 'No holidays uploaded for this year yet.' }}
      />
    </Modal>
  )
}
