import { useState, useEffect, useMemo } from 'react'
import { Card, Typography, Button, Table, Space, Modal, Form, Input, Select, message, DatePicker } from 'antd'
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
  const [filterCompany, setFilterCompany] = useState<string | undefined>(undefined)
  const [filterStage, setFilterStage] = useState<string | undefined>(undefined)
  const [filterReferenceNo, setFilterReferenceNo] = useState<string | undefined>(undefined)
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

  const companyOptions = useMemo(() => {
    const names = Array.from(new Set(leads.map((l) => l.company_name).filter(Boolean))) as string[]
    return names.sort().map((c) => ({ label: c, value: c }))
  }, [leads])

  const referenceOptions = useMemo(() => {
    const refs = Array.from(new Set(leads.map((l) => l.reference_no).filter(Boolean))) as string[]
    refs.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    return refs.map((r) => ({ label: r, value: r }))
  }, [leads])

  const filteredLeads = useMemo(() => {
    let result = leads
    if (filterCompany && filterCompany.trim()) {
      const search = filterCompany.trim().toLowerCase()
      result = result.filter((l) => (l.company_name || '').toLowerCase().includes(search))
    }
    if (filterStage && filterStage.trim()) {
      result = result.filter((l) => (l.stage || '').trim() === filterStage.trim())
    }
    if (filterReferenceNo && filterReferenceNo.trim()) {
      const search = filterReferenceNo.trim().toLowerCase()
      result = result.filter((l) => (l.reference_no || '').toLowerCase().includes(search))
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
  }, [leads, filterCompany, filterStage, filterReferenceNo, filterDateRange])

  const hasLeadFilters = Boolean(
    filterCompany || filterStage || filterReferenceNo || filterDateRange?.[0] || filterDateRange?.[1],
  )

  const clearLeadFilters = () => {
    setFilterCompany(undefined)
    setFilterStage(undefined)
    setFilterReferenceNo(undefined)
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

  const stageOptions = stages.length > 0
    ? stages.map((s) => ({ label: s, value: s }))
    : [
        'Lead', 'Contacted', 'Brochure', 'Demo Schedule', 'Demo Completed',
        'Quotation', 'PO', 'Implementation Invoice', 'Account Setup', 'Item Setup',
        'Training', 'First Invoice', 'First Invoice Payment',
      ].map((s) => ({ label: s, value: s }))

  return (
    <div style={{ padding: 24 }}>
      <Space
        style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}
        wrap
        align="center"
      >
        <Space wrap align="center">
          <Title level={4} className="page-main-heading" style={{ margin: 0 }}>
            {isClosedLeads ? 'Closed Leads' : 'Lead'}
          </Title>
          <OperationsSectionTabs module="client-to-lead" />
        </Space>
        {!isClosedLeads && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalOpen(true)}>
            Add Lead Details
          </Button>
        )}
      </Space>

      <Card>
        <Space wrap size="middle" style={{ marginBottom: 16 }}>
          <Select
            placeholder="Company"
            allowClear
            showSearch
            optionFilterProp="label"
            options={companyOptions}
            value={filterCompany}
            onChange={setFilterCompany}
            style={{ minWidth: 180 }}
          />
          <Select
            placeholder="Stage"
            allowClear
            showSearch
            optionFilterProp="label"
            options={stageOptions}
            value={filterStage}
            onChange={setFilterStage}
            style={{ minWidth: 180 }}
          />
          <Select
            placeholder="Reference No"
            allowClear
            showSearch
            optionFilterProp="label"
            options={referenceOptions}
            value={filterReferenceNo}
            onChange={setFilterReferenceNo}
            style={{ minWidth: 140 }}
          />
          <RangePicker
            value={filterDateRange}
            onChange={(dates) => setFilterDateRange(dates as [Dayjs | null, Dayjs | null] | null)}
            allowClear
          />
          <Button onClick={clearLeadFilters}>
            Clear filters
          </Button>
        </Space>

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
            columns={[
              {
                title: 'Reference No',
                dataIndex: 'reference_no',
                key: 'reference_no',
                width: 120,
                ellipsis: false,
                render: (v: string) => wrapRender(v),
              },
              {
                title: 'Company',
                dataIndex: 'company_name',
                key: 'company_name',
                width: 180,
                ellipsis: false,
                render: (v: string) => wrapRender(v),
              },
              {
                title: 'Stage',
                dataIndex: 'stage',
                key: 'stage',
                width: 140,
                ellipsis: false,
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
            ]}
            pagination={false}
            summary={() => (
              <Table.Summary>
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0} colSpan={5}>
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
