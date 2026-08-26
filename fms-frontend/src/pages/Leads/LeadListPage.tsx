import { useState, useEffect, useMemo } from 'react'
import { Card, Typography, Button, Table, Space, Modal, Form, Input, Select, message, DatePicker } from 'antd'
import type { FilterValue } from 'antd/es/table/interface'
import type { Dayjs } from 'dayjs'
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate, useSearchParams } from 'react-router-dom'
import dayjs from 'dayjs'
import { ROUTES } from '../../utils/constants'
import { leadsApi, type Lead } from '../../api/leads'
import { TableWithSkeletonLoading } from '../../components/common/skeletons'
import { SectionEmptyState } from '../../components/common/SectionEmptyState'
import { DEFAULT_INFINITE_CHUNK, useInfiniteScrollChunk } from '../../hooks/useInfiniteScrollChunk'
import { OperationsSectionTabs } from '../../components/common/OperationsSectionTabs'

const { Title, Text } = Typography
const { RangePicker } = DatePicker

const wrapRender = (v: string | undefined) => (
  <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', display: 'block' }}>{v || '—'}</span>
)

const columnFilterPass = () => true
function filterValues(tableFilters: Record<string, FilterValue | null> | undefined, key: string): string[] {
  const raw = tableFilters?.[key]
  if (raw == null) return []
  return (Array.isArray(raw) ? raw : [raw]).map(String)
}

export const LeadListPage = () => {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const statusFilter = searchParams.get('status') // 'Closed' for Closed Leads section
  const isClosedLeads = statusFilter === 'Closed'

  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [submitLoading, setSubmitLoading] = useState(false)
  const [stages, setStages] = useState<string[]>([])
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([])
  const [form] = Form.useForm()
  const [filterCompanies, setFilterCompanies] = useState<string[]>([])
  const [filterStages, setFilterStages] = useState<string[]>([])
  const [filterReferenceNos, setFilterReferenceNos] = useState<string[]>([])
  const [filterDateRange, setFilterDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null)

  const loadLeads = () => {
    setLoading(true)
    const listStatus = isClosedLeads ? 'Closed' : 'Open'
    leadsApi
      .list({ status: listStatus })
      .then((res) => setLeads(res.leads || []))
      .catch(() => message.error('Failed to load leads'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadLeads()
    leadsApi.getStages().then((res) => setStages(res.stages || []))
    leadsApi.getUsers().then((res) => setUsers(res.users || []))
  }, [statusFilter])

  const companyColumnFilters = useMemo(() => {
    const names = Array.from(new Set(leads.map((l) => l.company_name).filter(Boolean))) as string[]
    return names.sort().map((c) => ({ text: c, value: c }))
  }, [leads])

  const referenceColumnFilters = useMemo(() => {
    const refs = Array.from(new Set(leads.map((l) => l.reference_no).filter(Boolean))) as string[]
    refs.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    return refs.map((r) => ({ text: r, value: r }))
  }, [leads])

  const stageOptions = stages.length > 0
    ? stages.map((s) => ({ label: s, value: s }))
    : [
        'Lead', 'Contacted', 'Brochure', 'Demo Schedule', 'Demo Completed',
        'Quotation', 'PO', 'Implementation Invoice', 'Account Setup', 'Item Setup',
        'Training', 'First Invoice', 'First Invoice Payment',
      ].map((s) => ({ label: s, value: s }))

  const stageColumnFilters = useMemo(
    () => stageOptions.map((o) => ({ text: o.label, value: o.value })),
    [stageOptions],
  )

  const filteredLeads = useMemo(() => {
    let result = leads
    if (filterCompanies.length) {
      const set = new Set(filterCompanies.map((c) => c.toLowerCase()))
      result = result.filter((l) => set.has((l.company_name || '').toLowerCase()))
    }
    if (filterStages.length) {
      const set = new Set(filterStages.map((s) => s.trim()))
      result = result.filter((l) => set.has((l.stage || '').trim()))
    }
    if (filterReferenceNos.length) {
      const set = new Set(filterReferenceNos.map((r) => r.toLowerCase()))
      result = result.filter((l) => set.has((l.reference_no || '').toLowerCase()))
    }
    if (filterDateRange?.[0] || filterDateRange?.[1]) {
      result = result.filter((l) => {
        const created = l.created_at ? dayjs(l.created_at) : null
        if (!created) return false
        if (filterDateRange[0] && created.isBefore(filterDateRange[0], 'day')) return false
        if (filterDateRange[1] && created.isAfter(filterDateRange[1], 'day')) return false
        return true
      })
    }
    return result
  }, [leads, filterCompanies, filterStages, filterReferenceNos, filterDateRange])

  const hasLeadFilters = Boolean(
    filterCompanies.length ||
      filterStages.length ||
      filterReferenceNos.length ||
      filterDateRange?.[0] ||
      filterDateRange?.[1],
  )

  const clearLeadFilters = () => {
    setFilterCompanies([])
    setFilterStages([])
    setFilterReferenceNos([])
    setFilterDateRange(null)
  }

  const leadEmptyContent = useMemo(() => {
    if (loading) return undefined
    if (leads.length > 0 && filteredLeads.length === 0 && hasLeadFilters) {
      return (
        <SectionEmptyState
          variant="no-filter-results"
          title={`No ${isClosedLeads ? 'closed' : 'open'} leads match your filters.`}
          primaryAction={{ label: 'Clear filters', onClick: clearLeadFilters }}
        />
      )
    }
    return (
      <SectionEmptyState
        variant="no-data"
        title={isClosedLeads ? 'No closed leads yet.' : 'No open leads yet.'}
        description="Add lead details to start tracking the pipeline."
        primaryAction={{ label: 'Add Lead Details', onClick: () => setAddModalOpen(true) }}
      />
    )
  }, [loading, leads.length, filteredLeads.length, hasLeadFilters, isClosedLeads])

  const {
    visibleItems: visibleLeads,
    containerRef: leadTableContainerRef,
    sentinelRef: leadTableSentinelRef,
    total: totalLeads,
    visibleCount: visibleLeadCount,
    hasMore: leadHasMore,
  } = useInfiniteScrollChunk({ items: filteredLeads, chunkSize: DEFAULT_INFINITE_CHUNK, loading })

  const handleAddLead = () => {
    form.validateFields().then((values) => {
      setSubmitLoading(true)
      leadsApi
        .create({
          company_name: (values.company_name || '').trim() || undefined,
          stage: values.stage,
          assigned_poc_id: values.assigned_poc_id,
        })
        .then((lead) => {
          message.success('Lead created')
          setAddModalOpen(false)
          form.resetFields()
          navigate(ROUTES.LEAD_DETAIL.replace(':id', lead.reference_no))
        })
        .catch(() => message.error('Failed to create lead'))
        .finally(() => setSubmitLoading(false))
    }).catch(() => {
      message.warning('Please fill all required fields: Company Name, Stage, and Assigned POC.')
    })
  }

  const columns = useMemo(
    () => [
      {
        title: 'Reference No',
        dataIndex: 'reference_no',
        key: 'reference_no',
        width: 120,
        ellipsis: false,
        filters: referenceColumnFilters,
        filterSearch: true,
        filterMultiple: true,
        filteredValue: filterReferenceNos.length ? filterReferenceNos : null,
        onFilter: columnFilterPass,
        render: (v: string) => wrapRender(v),
      },
      {
        title: 'Company',
        dataIndex: 'company_name',
        key: 'company_name',
        width: 180,
        ellipsis: false,
        filters: companyColumnFilters,
        filterSearch: true,
        filterMultiple: true,
        filteredValue: filterCompanies.length ? filterCompanies : null,
        onFilter: columnFilterPass,
        render: (v: string) => wrapRender(v),
      },
      {
        title: 'Stage',
        dataIndex: 'stage',
        key: 'stage',
        width: 140,
        ellipsis: false,
        filters: stageColumnFilters,
        filterSearch: true,
        filterMultiple: true,
        filteredValue: filterStages.length ? filterStages : null,
        onFilter: columnFilterPass,
        render: (v: string) => wrapRender(v),
      },
      {
        title: 'Assigned POC',
        dataIndex: 'assigned_poc_name',
        key: 'assigned_poc',
        width: 140,
        ellipsis: false,
        render: (v: string) => wrapRender(v),
      },
    ],
    [
      referenceColumnFilters,
      filterReferenceNos,
      companyColumnFilters,
      filterCompanies,
      stageColumnFilters,
      filterStages,
    ],
  )

  return (
    <div>
      <div
        className="page-toolbar-row"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'nowrap',
          gap: 6,
          marginBottom: 4,
          width: '100%',
        }}
      >
        <Space wrap={false} align="center" size={6}>
          <Title level={4} className="page-main-heading" style={{ margin: 0, fontSize: 15 }}>
            {isClosedLeads ? 'Closed Leads' : 'Lead'}
          </Title>
          <OperationsSectionTabs module="client-to-lead" />
        </Space>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, marginLeft: 'auto' }}>
          <RangePicker
            size="small"
            placeholder={['From', 'To']}
            style={{ width: 190 }}
            allowEmpty={[true, true]}
            value={filterDateRange}
            onChange={(dates) => setFilterDateRange(dates as [Dayjs | null, Dayjs | null] | null)}
            allowClear
          />
          {!isClosedLeads && (
            <Button size="small" type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
              Add Lead
            </Button>
          )}
        </div>
      </div>

      <Card bodyStyle={{ padding: '4px 8px' }}>
        <TableWithSkeletonLoading loading={loading} columns={5} rows={12}>
          <div ref={leadTableContainerRef}>
            <Table
              loading={false}
              locale={{ emptyText: leadEmptyContent }}
              dataSource={visibleLeads}
              rowKey="id"
              onRow={(record) => ({
                onClick: () => navigate(ROUTES.LEAD_DETAIL.replace(':id', record.reference_no)),
                style: { cursor: 'pointer' },
              })}
              columns={columns}
              onChange={(_, tableFilters) => {
                setFilterReferenceNos(filterValues(tableFilters, 'reference_no'))
                setFilterCompanies(filterValues(tableFilters, 'company_name'))
                setFilterStages(filterValues(tableFilters, 'stage'))
              }}
              pagination={false}
              summary={() => (
                <Table.Summary>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={columns.length}>
                      <div ref={leadTableSentinelRef} style={{ height: 8, minHeight: 8 }} aria-hidden />
                      <Text type="secondary">
                        Showing {visibleLeadCount} of {totalLeads} leads{leadHasMore ? ' · scroll to load more' : ''}
                      </Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
              size="small"
            />
          </div>
        </TableWithSkeletonLoading>
      </Card>

      <Modal
        title="Add Lead Details"
        open={addModalOpen}
        onOk={handleAddLead}
        onCancel={() => { setAddModalOpen(false); form.resetFields() }}
        confirmLoading={submitLoading}
        destroyOnClose
        width={480}
        afterOpenChange={(open) => { if (open) form.resetFields() }}
      >
        <Form form={form} layout="vertical" initialValues={{ company_name: '', stage: undefined, assigned_poc_id: undefined }}>
          <Form.Item
            name="company_name"
            label="Company Name"
            rules={[{ required: true, message: 'Company Name is required' }]}
          >
            <Input placeholder="Enter company name" maxLength={200} />
          </Form.Item>
          <Form.Item
            name="stage"
            label="Stage"
            rules={[{ required: true, message: 'Please select Stage' }]}
          >
            <Select
              placeholder="Select stage"
              options={stageOptions}
              showSearch
              optionFilterProp="label"
              allowClear={false}
            />
          </Form.Item>
          <Form.Item
            name="assigned_poc_id"
            label="Assigned POC"
            rules={[{ required: true, message: 'Please select Assigned POC' }]}
          >
            <Select
              placeholder="Select user"
              options={users.map((u) => ({ label: u.full_name || u.id, value: u.id }))}
              showSearch
              optionFilterProp="label"
              allowClear={false}
            />
          </Form.Item>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Reference number and timestamp will be auto-generated on submit. Status will be set to Open.
          </Text>
        </Form>
      </Modal>
    </div>
  )
}
