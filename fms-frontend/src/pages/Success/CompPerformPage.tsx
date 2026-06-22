import { useState, useEffect, useMemo } from 'react'
import { Card, Typography, Select, Table, message, Modal, Alert, Descriptions, Space } from 'antd'
import { LineChartOutlined } from '@ant-design/icons'
import { API_BASE_URL } from '../../api/axios'
import { dashboardApi } from '../../api/dashboard'
import { storage } from '../../utils/storage'
import { sessionApiCacheGet } from '../../utils/sessionApiCache'
import { sortPerformanceRefOptions } from '../../utils/performanceRefs'
import { PerformanceTablePaginationBar } from '../../components/success/PerformanceTablePaginationBar'
import { TableWithSkeletonLoading } from '../../components/common/skeletons'
import { OperationsSectionTabs } from '../../components/common/OperationsSectionTabs'

const { Title } = Typography

const FETCH_TIMEOUT_MS = 15000

interface POCItem {
  id: string
  reference_no: string
  company_name: string
  message_owner: string
  response?: string
  contact?: string
  completion_status: string
  created_at: string
  total_percentage?: number | null
  has_training?: boolean
  feature_count?: number
  current_stage?: string
}

interface TicketDetails {
  id: string
  reference_no: string
  company_name: string
  message_owner: string
  response?: string
  contact?: string
  completion_status: string
  total_percentage?: number | null
  current_stage: string
  pending_features: string[]
  features_with_followups?: Array<{
    ticket_feature_id: string
    feature_name: string
    status: string
    followups: Array<Record<string, unknown>>
  }>
}

export const CompPerformPage = () => {
  const [items, setItems] = useState<POCItem[]>([])
  const [loading, setLoading] = useState(false)
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<POCItem | null>(null)
  const [detailsData, setDetailsData] = useState<TicketDetails | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [filterRef, setFilterRef] = useState<string>('')
  const [filterCompany, setFilterCompany] = useState<string>('')
  const [tablePage, setTablePage] = useState(1)
  const [tablePageSize, setTablePageSize] = useState(20)

  useEffect(() => {
    loadItems()
  }, [])

  useEffect(() => {
    setTablePage(1)
  }, [filterRef, filterCompany])

  const fetchWithTimeout = (url: string, options: RequestInit = {}) => {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id))
  }

  const getAuthHeaders = () => ({
    Authorization: `Bearer ${storage.getToken() ?? ''}`,
  })

  const loadItems = async (options?: { skipCache?: boolean }) => {
    setSetupError(null)
    const cacheKey = 'dashboard:success-performance-list:completed:exclude_na'
    const cached = !options?.skipCache
      ? sessionApiCacheGet<{ items?: POCItem[] }>(cacheKey)
      : null
    if (cached?.items?.length) {
      setItems(cached.items as POCItem[])
      setLoading(false)
    } else {
      setLoading(true)
    }
    try {
      const data = await dashboardApi.getSuccessPerformanceList('completed', options)
      setItems((data.items || []) as POCItem[])
    } catch (e) {
      setItems([])
      const ax = e as { response?: { status?: number; data?: { detail?: string } } }
      if (ax.response?.status === 503) {
        setSetupError(ax.response?.data?.detail || 'Database tables not set up.')
      } else {
        setSetupError('Failed to load. Run database/SUCCESS_PERFORMANCE_MONITORING.sql in Supabase.')
      }
    } finally {
      setLoading(false)
    }
  }

  const openViewDetails = async (record: POCItem) => {
    setSelectedItem(record)
    setDetailModalOpen(true)
    const cacheKey = `success:performance-details:${record.id}`
    const cached = sessionApiCacheGet<TicketDetails>(cacheKey)
    setDetailsData(cached ?? null)
    setDetailsLoading(!cached)
    try {
      const data = (await dashboardApi.getSuccessPerformanceDetails(record.id)) as TicketDetails
      setDetailsData(data)
    } catch (err) {
      const ax = err as { response?: { data?: { detail?: string } } }
      const detail = ax.response?.data?.detail
      if (!cached) {
        setDetailsData({
          id: record.id,
          reference_no: record.reference_no,
          company_name: record.company_name,
          message_owner: record.message_owner,
          response: record.response,
          contact: record.contact,
          completion_status: record.completion_status,
          total_percentage: record.total_percentage ?? undefined,
          current_stage: record.current_stage || '—',
          pending_features: [],
        })
        message.warning(detail ? String(detail).slice(0, 200) : 'Showing summary only; full details could not be loaded.')
      }
    } finally {
      setDetailsLoading(false)
    }
  }

  const tableColumns = [
    { title: 'Reference Number', dataIndex: 'reference_no', key: 'reference_no', width: 120 },
    { title: 'Company Name', dataIndex: 'company_name', key: 'company_name', width: 160 },
    { title: 'Response', dataIndex: 'response', key: 'response', ellipsis: true, render: (v: string) => (v ? String(v).slice(0, 40) + (String(v).length > 40 ? '...' : '') : '-') },
    { title: 'Contact', dataIndex: 'contact', key: 'contact', width: 120 },
    {
      title: 'Total Completion %',
      dataIndex: 'total_percentage',
      key: 'total_percentage',
      width: 120,
      render: (v: number | null | undefined) => (v != null ? `${Number(v)}%` : '-'),
    },
  ]

  const displayItems = items.filter((i) => {
    if (filterRef && !String(i.reference_no || '').toLowerCase().includes(filterRef.toLowerCase())) return false
    if (filterCompany && !String(i.company_name || '').toLowerCase().includes(filterCompany.toLowerCase())) return false
    return true
  })

  const totalTablePages = Math.max(1, Math.ceil(displayItems.length / tablePageSize) || 1)
  useEffect(() => {
    if (tablePage > totalTablePages) setTablePage(totalTablePages)
  }, [tablePage, totalTablePages])

  const pagedDisplayItems = useMemo(() => {
    const start = (tablePage - 1) * tablePageSize
    return displayItems.slice(start, start + tablePageSize)
  }, [displayItems, tablePage, tablePageSize])

  return (
    <div>
      <Space style={{ marginBottom: 24 }} wrap align="center">
        <Title level={4} className="page-main-heading" style={{ margin: 0 }}>
          <LineChartOutlined style={{ marginRight: 8 }} />
          Comp- Perform
        </Title>
        <OperationsSectionTabs module="success" />
      </Space>
      <Card style={{ marginBottom: 16 }}>
        <Typography.Text type="secondary">
          Companies where all features are completed. They no longer appear in Performance Monitoring.
        </Typography.Text>
      </Card>

      {setupError && (
        <Alert type="warning" message="Setup Required" description={setupError} showIcon style={{ marginBottom: 16 }} />
      )}

      <Card>
        <div style={{ marginBottom: 16, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <Select
            placeholder="Filter by Reference"
            value={filterRef || undefined}
            onChange={(v) => setFilterRef(v ?? '')}
            style={{ width: 200 }}
            allowClear
            showSearch
            optionFilterProp="label"
            options={sortPerformanceRefOptions([...new Set(items.map((i) => i.reference_no).filter(Boolean))] as string[]).map((r) => ({
              value: r,
              label: r,
            }))}
          />
          <Select
            placeholder="Filter by Company"
            value={filterCompany || undefined}
            onChange={(v) => setFilterCompany(v ?? '')}
            style={{ width: 240 }}
            allowClear
            showSearch
            optionFilterProp="label"
            options={[...new Set(items.map((i) => i.company_name).filter(Boolean))].sort().map((c) => ({ value: c, label: c }))}
          />
        </div>
        <TableWithSkeletonLoading loading={loading} columns={9} rows={12}>
          <Table
            dataSource={pagedDisplayItems}
            rowKey="id"
            loading={false}
            onRow={(record) => ({
              onClick: () => openViewDetails(record),
              style: { cursor: 'pointer' },
            })}
            columns={tableColumns}
            pagination={false}
          />
        </TableWithSkeletonLoading>
        <PerformanceTablePaginationBar
          page={tablePage}
          pageSize={tablePageSize}
          total={displayItems.length}
          onPageChange={setTablePage}
          onPageSizeChange={setTablePageSize}
        />
      </Card>

      <Modal
        title={`View Details - ${selectedItem?.reference_no || ''}`}
        open={detailModalOpen}
        onCancel={() => { setDetailModalOpen(false); setSelectedItem(null); setDetailsData(null) }}
        footer={null}
        width={640}
      >
        {selectedItem && (
          <>
            {detailsLoading ? (
              <p>Loading...</p>
            ) : detailsData ? (
              <>
                <Descriptions column={1} bordered size="small" style={{ marginBottom: 16 }}>
                  <Descriptions.Item label="Reference">{detailsData.reference_no}</Descriptions.Item>
                  <Descriptions.Item label="Company">{detailsData.company_name}</Descriptions.Item>
                  <Descriptions.Item label="Message Owner">{detailsData.message_owner === 'yes' ? 'Yes' : 'No'}</Descriptions.Item>
                  <Descriptions.Item label="Response">{detailsData.response || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Contact">{detailsData.contact || '-'}</Descriptions.Item>
                  <Descriptions.Item label="Total Completion %">{detailsData.total_percentage != null ? `${detailsData.total_percentage}%` : '-'}</Descriptions.Item>
                  <Descriptions.Item label="Status">
                    <strong>{detailsData.current_stage}</strong>
                  </Descriptions.Item>
                </Descriptions>
                {detailsData.features_with_followups && detailsData.features_with_followups.length > 0 && (
                  <Card size="small" title="Features & Followups">
                    {detailsData.features_with_followups.map((f) => (
                      <div key={f.ticket_feature_id} style={{ marginBottom: 8 }}>
                        <strong>{f.feature_name}</strong> – {f.status}
                        {f.followups && f.followups.length > 0 && (
                          <ul style={{ marginTop: 4, paddingLeft: 16 }}>
                            {f.followups.map((fu: Record<string, unknown>, idx: number) => (
                              <li key={idx}>
                                Prev: {fu.previous_percentage}% → +{fu.added_percentage}% = {fu.total_percentage}% ({fu.status}) {fu.remarks && `- ${fu.remarks}`}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                  </Card>
                )}
              </>
            ) : (
              <Descriptions column={1} bordered size="small">
                <Descriptions.Item label="Reference">{selectedItem.reference_no}</Descriptions.Item>
                <Descriptions.Item label="Company">{selectedItem.company_name}</Descriptions.Item>
                <Descriptions.Item label="Total Completion %">{selectedItem.total_percentage != null ? `${selectedItem.total_percentage}%` : '-'}</Descriptions.Item>
                <Descriptions.Item label="Status">Completed</Descriptions.Item>
              </Descriptions>
            )}
          </>
        )}
      </Modal>
    </div>
  )
}
