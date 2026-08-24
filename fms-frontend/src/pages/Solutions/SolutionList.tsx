import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Skeleton } from 'antd'
import { Table, Card, Typography, Tag } from 'antd'
import { solutionsApi } from '../../api/solutions'
import { PrintExport } from '../../components/common/PrintExport'
import { TableWithSkeletonLoading } from '../../components/common/skeletons'
import { formatDate } from '../../utils/helpers'
import type { Solution } from '../../api/solutions'

const { Title } = Typography

export const SolutionList = () => {
  const { ticketId } = useParams<{ ticketId: string }>()
  const { data: solutions = [], isLoading: loading } = useQuery<Solution[]>({
    queryKey: ['solutions', ticketId],
    queryFn: async () => {
      if (!ticketId) return []
      const response = await solutionsApi.list(ticketId)
      return Array.isArray(response) ? response : []
    },
    enabled: !!ticketId,
    placeholderData: (prev) => prev,
  })

  const columns = [
    {
      title: 'Solution',
      dataIndex: 'solution_number',
      key: 'solution_number',
      render: (num: number) => `Solution ${num}`,
    },
    {
      title: 'Title',
      dataIndex: 'title',
      key: 'title',
    },
    {
      title: 'Status',
      dataIndex: 'is_selected',
      key: 'is_selected',
      render: (selected: boolean) => (
        <Tag color={selected ? 'green' : 'default'}>
          {selected ? 'Selected' : 'Not Selected'}
        </Tag>
      ),
    },
    {
      title: 'Quality Score',
      dataIndex: 'quality_score',
      key: 'quality_score',
      render: (score?: number) => score ? `${score}/10` : '-',
    },
    {
      title: 'Proposed',
      dataIndex: 'proposed_at',
      key: 'proposed_at',
      render: (date: string) => formatDate(date),
    },
  ]

  const exportColumns = [
    { key: 'solution_number', label: 'Solution' },
    { key: 'title', label: 'Title' },
    { key: 'is_selected', label: 'Selected' },
    { key: 'quality_score', label: 'Quality Score' },
    { key: 'proposed_at', label: 'Proposed' },
  ]
  const exportRows = solutions.map((s) => ({
    solution_number: `Solution ${s.solution_number}`,
    title: s.title ?? '-',
    is_selected: s.is_selected ? 'Yes' : 'No',
    quality_score: s.quality_score != null ? `${s.quality_score}/10` : '-',
    proposed_at: formatDate(s.proposed_at ?? ''),
  }))

  return (
    <div>
      <div className="page-toolbar-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', gap: 6, marginBottom: 8 }}>
        <Title level={2} className="page-main-heading" style={{ margin: 0, fontSize: 15 }}>Solutions</Title>
        <PrintExport pageTitle="Solutions" exportData={{ columns: exportColumns, rows: exportRows }} exportFilename="solutions" />
      </div>
      <Card>
        {loading ? (
          <Skeleton active paragraph={{ rows: 8 }} />
        ) : (
        <TableWithSkeletonLoading loading={false} columns={5} rows={8}>
          <Table columns={columns} dataSource={solutions} rowKey="id" loading={false} pagination={false} />
        </TableWithSkeletonLoading>
        )}
      </Card>
    </div>
  )
}
