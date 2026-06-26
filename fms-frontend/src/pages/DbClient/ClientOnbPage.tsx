import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Card,
  Typography,
  Form,
  Input,
  Button,
  Table,
  message,
  Modal,
  Space,
  DatePicker,
  Tag,
  Segmented,
  Select,
} from 'antd'
import { PlusOutlined, EditOutlined, CopyOutlined } from '@ant-design/icons'
import type { AxiosError } from 'axios'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { dbClientOnbApi, type ClientOnbRecord } from '../../api/dbClientOnb'
import { useRole } from '../../hooks/useRole'
import { CLIENT_ONB_ADD_STATUS_SQL } from './clientOnbAddStatusSql'
import { TableWithSkeletonLoading } from '../../components/common/skeletons'
import { OperationsSectionTabs } from '../../components/common/OperationsSectionTabs'
import { useSearchParams } from 'react-router-dom'

const { Title } = Typography
const { TextArea } = Input

function formatTs(v: string | null | undefined) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('DD-MMM-YYYY HH:mm') : String(v)
}

function formatDate(v: string | null | undefined) {
  if (!v) return '—'
  const d = dayjs(String(v).slice(0, 10))
  return d.isValid() ? d.format('DD-MMM-YYYY') : String(v)
}

function normalizeStatus(s: string | null | undefined): 'active' | 'inactive' {
  return (s || 'active').toLowerCase() === 'inactive' ? 'inactive' : 'active'
}

export type ClientOnbPageMode = 'active' | 'inactive'

const REQ = { required: true, whitespace: true, message: 'Required' } as const

type FormValues = {
  organization_name?: string
  company_name?: string
  contact_person?: string
  mobile_no?: string
  email_id?: string
  paid_divisions?: string
  division_abbreviation?: string
  name_of_divisions_cost_details?: string
  amount_paid_per_division?: string
  total_amount_paid_per_month?: string
  payment_frequency?: string
  client_since?: Dayjs
  client_till?: Dayjs
  client_duration?: string
  total_amount_paid_till_date?: string
  tds_percent?: string
  client_location_city?: string
  client_location_state?: string
  remarks?: string
  whatsapp_group_details?: string
}

type InactiveFollowValues = {
  last_contacted_on?: Dayjs
  remarks_2?: string
  follow_up_needed?: string
}

function toPayload(values: FormValues): Record<string, string | null | undefined> {
  const since = values.client_since?.isValid() ? values.client_since.format('YYYY-MM-DD') : null
  const till = values.client_till?.isValid() ? values.client_till.format('YYYY-MM-DD') : null
  return {
    organization_name: values.organization_name?.trim() || null,
    company_name: values.company_name?.trim() || null,
    contact_person: values.contact_person?.trim() || null,
    mobile_no: values.mobile_no?.trim() || null,
    email_id: values.email_id?.trim() || null,
    paid_divisions: values.paid_divisions?.trim() || null,
    division_abbreviation: values.division_abbreviation?.trim() || null,
    name_of_divisions_cost_details: values.name_of_divisions_cost_details?.trim() || null,
    amount_paid_per_division: values.amount_paid_per_division?.trim() || null,
    total_amount_paid_per_month: values.total_amount_paid_per_month?.trim() || null,
    payment_frequency: values.payment_frequency?.trim() || null,
    client_since: since,
    client_till: till,
    client_duration: values.client_duration?.trim() || null,
    total_amount_paid_till_date: values.total_amount_paid_till_date?.trim() || null,
    tds_percent: values.tds_percent?.trim() || null,
    client_location_city: values.client_location_city?.trim() || null,
    client_location_state: values.client_location_state?.trim() || null,
    remarks: values.remarks?.trim() || null,
    whatsapp_group_details: values.whatsapp_group_details?.trim() || null,
  }
}

export function ClientOnbPage({ mode = 'active' }: { mode?: ClientOnbPageMode }) {
  const [searchParams] = useSearchParams()
  const isInactivePage = mode === 'inactive'
  const { canEditSectionByKey, isMasterAdmin } = useRole()
  const canEdit = canEditSectionByKey('db_client')
  const [form] = Form.useForm<FormValues>()
  const [records, setRecords] = useState<ClientOnbRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<ClientOnbRecord | null>(null)
  const [submitLoading, setSubmitLoading] = useState(false)

  const [statusModalRow, setStatusModalRow] = useState<ClientOnbRecord | null>(null)
  const [statusDraft, setStatusDraft] = useState<'active' | 'inactive'>('active')
  const [statusSaving, setStatusSaving] = useState(false)
  const [inactiveDetailRow, setInactiveDetailRow] = useState<ClientOnbRecord | null>(null)
  const [inactiveFollowForm] = Form.useForm<InactiveFollowValues>()
  const [inactiveDetailSaving, setInactiveDetailSaving] = useState(false)
  const [statusColumnOk, setStatusColumnOk] = useState<boolean | null>(null)
  const [statusColumnHint, setStatusColumnHint] = useState('')
  const openedDeepLinkRef = useRef('')

  const runStatusColumnCheck = useCallback(() => {
    dbClientOnbApi
      .checkStatusColumn()
      .then((r) => {
        setStatusColumnOk(r.ok === true)
        setStatusColumnHint(r.hint || '')
      })
      .catch(() => {
        setStatusColumnOk(false)
        setStatusColumnHint('Could not verify the database.')
      })
  }, [])

  useEffect(() => {
    runStatusColumnCheck()
  }, [runStatusColumnCheck])

  const activeRecords = useMemo(
    () => records.filter((r) => normalizeStatus(r.status) === 'active'),
    [records]
  )
  const inactiveRecords = useMemo(
    () => records.filter((r) => normalizeStatus(r.status) === 'inactive'),
    [records]
  )

  const loadRecords = useCallback(() => {
    setLoading(true)
    dbClientOnbApi
      .list()
      .then((r) => setRecords(r.items || []))
      .catch(() => {
        setRecords([])
        message.warning('Could not load Client ONB. Create table in Supabase (see docs/SUPABASE_DB_CLIENT_CLIENT_ONB.sql).')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    loadRecords()
  }, [loadRecords])

  const populateEditFormFromRow = useCallback(
    (row: ClientOnbRecord) => {
      form.setFieldsValue({
        organization_name: row.organization_name ?? undefined,
        company_name: row.company_name ?? undefined,
        contact_person: row.contact_person ?? undefined,
        mobile_no: row.mobile_no ?? undefined,
        email_id: row.email_id ?? undefined,
        paid_divisions: row.paid_divisions ?? undefined,
        division_abbreviation: row.division_abbreviation ?? undefined,
        name_of_divisions_cost_details: row.name_of_divisions_cost_details ?? undefined,
        amount_paid_per_division: row.amount_paid_per_division ?? undefined,
        total_amount_paid_per_month: row.total_amount_paid_per_month ?? undefined,
        payment_frequency: row.payment_frequency ?? undefined,
        client_since: row.client_since ? dayjs(String(row.client_since).slice(0, 10)) : undefined,
        client_till: row.client_till ? dayjs(String(row.client_till).slice(0, 10)) : undefined,
        client_duration: row.client_duration ?? undefined,
        total_amount_paid_till_date: row.total_amount_paid_till_date ?? undefined,
        tds_percent: row.tds_percent ?? undefined,
        client_location_city: row.client_location_city ?? undefined,
        client_location_state: row.client_location_state ?? undefined,
        remarks: row.remarks ?? undefined,
        whatsapp_group_details: row.whatsapp_group_details ?? undefined,
      })
    },
    [form]
  )

  const openAdd = useCallback(() => {
    setEditing(null)
    form.resetFields()
    setModalOpen(true)
  }, [form])

  const openEdit = useCallback((row: ClientOnbRecord) => {
    setEditing(row)
    setModalOpen(true)
  }, [])

  const openStatusModal = useCallback((row: ClientOnbRecord) => {
    setStatusModalRow(row)
    setStatusDraft(normalizeStatus(row.status))
  }, [])

  const openInactiveDetail = useCallback((row: ClientOnbRecord) => {
    setInactiveDetailRow(row)
    setStatusDraft(normalizeStatus(row.status))
  }, [])

  useEffect(() => {
    const target = (searchParams.get('open') || searchParams.get('reference') || '').trim()
    if (!target || openedDeepLinkRef.current === target || statusModalRow || inactiveDetailRow) return
    const openRow = (row: ClientOnbRecord) => {
      openedDeepLinkRef.current = target
      if (normalizeStatus(row.status) === 'inactive') openInactiveDetail(row)
      else openStatusModal(row)
    }
    const local = records.find((row) => row.id === target || row.reference_no === target)
    if (local) {
      openRow(local)
      return
    }
    if (!searchParams.get('open')) return
    dbClientOnbApi
      .get(target)
      .then((row) => {
        if (!row?.id) return
        setRecords((prev) => (prev.some((item) => item.id === row.id) ? prev : [row, ...prev]))
        openRow(row)
      })
      .catch(() => message.warning('Could not open DB Client row from dashboard.'))
  }, [inactiveDetailRow, openInactiveDetail, openStatusModal, records, searchParams, statusModalRow])

  const handleSubmit = () => {
    form.validateFields().then((values) => {
      const payload = toPayload(values)
      setSubmitLoading(true)
      const done = () => {
        message.success(editing ? 'Updated' : 'Saved')
        setModalOpen(false)
        setEditing(null)
        form.resetFields()
        loadRecords()
      }
      const fail = () => message.error('Save failed')

      if (editing) {
        dbClientOnbApi
          .update(editing.id, payload)
          .then(done)
          .catch(fail)
          .finally(() => setSubmitLoading(false))
      } else {
        dbClientOnbApi
          .create(payload)
          .then(done)
          .catch(fail)
          .finally(() => setSubmitLoading(false))
      }
    })
  }

  const saveStatus = () => {
    if (!statusModalRow) return
    if (statusDraft === normalizeStatus(statusModalRow.status)) {
      setStatusModalRow(null)
      return
    }
    setStatusSaving(true)
    dbClientOnbApi
      .setStatus(statusModalRow.id, statusDraft)
      .then(() => {
        message.success('Status updated')
        setStatusModalRow(null)
        loadRecords()
        runStatusColumnCheck()
      })
      .catch((err: AxiosError<{ detail?: string }>) => {
        const d = err.response?.data?.detail
        const text = typeof d === 'string' ? d : err.message || 'Could not update status'
        message.error(text.length > 220 ? `${text.slice(0, 220)}…` : text)
      })
      .finally(() => setStatusSaving(false))
  }

  const saveInactiveDetail = () => {
    if (!inactiveDetailRow) return
    inactiveFollowForm.validateFields().then((values) => {
      const id = inactiveDetailRow.id
      setInactiveDetailSaving(true)
      const statusPromise =
        statusDraft !== normalizeStatus(inactiveDetailRow.status)
          ? dbClientOnbApi.setStatus(id, statusDraft)
          : Promise.resolve(null)
      const followPayload = {
        last_contacted_on: values.last_contacted_on?.isValid()
          ? values.last_contacted_on.format('YYYY-MM-DD')
          : null,
        remarks_2: values.remarks_2?.trim() || null,
        follow_up_needed: values.follow_up_needed ?? null,
      }
      Promise.all([statusPromise, dbClientOnbApi.patchFollowUp(id, followPayload)])
        .then(() => {
          message.success('Saved')
          setInactiveDetailRow(null)
          inactiveFollowForm.resetFields()
          loadRecords()
          runStatusColumnCheck()
        })
        .catch((err: AxiosError<{ detail?: string }>) => {
          const d = err.response?.data?.detail
          const text = typeof d === 'string' ? d : err.message || 'Save failed'
          message.error(text.length > 220 ? `${text.slice(0, 220)}…` : text)
        })
        .finally(() => setInactiveDetailSaving(false))
    })
  }

  const columns: ColumnsType<ClientOnbRecord> = useMemo(
    () => [
      { title: 'Reference', dataIndex: 'reference_no', key: 'reference_no', width: 100, fixed: 'left' },
      {
        title: 'Status',
        key: 'status',
        width: 100,
        render: (_: unknown, row: ClientOnbRecord) => {
          const v = normalizeStatus(row.status)
          return <Tag color={v === 'active' ? 'green' : 'default'}>{v === 'active' ? 'Active' : 'Inactive'}</Tag>
        },
      },
      { title: 'Organization Name', dataIndex: 'organization_name', key: 'organization_name', width: 140, ellipsis: true },
      { title: 'Company Name', dataIndex: 'company_name', key: 'company_name', width: 140, ellipsis: true },
      { title: 'Contact Person', dataIndex: 'contact_person', key: 'contact_person', width: 120, ellipsis: true },
      { title: 'Mobile No.', dataIndex: 'mobile_no', key: 'mobile_no', width: 110 },
      { title: 'Email ID', dataIndex: 'email_id', key: 'email_id', width: 160, ellipsis: true },
      { title: 'Paid Divisions', dataIndex: 'paid_divisions', key: 'paid_divisions', width: 120, ellipsis: true },
      { title: 'Division Abbreviation', dataIndex: 'division_abbreviation', key: 'division_abbreviation', width: 130, ellipsis: true },
      { title: 'Name of Divisions & Cost Details', dataIndex: 'name_of_divisions_cost_details', key: 'name_of_divisions_cost_details', width: 200, ellipsis: true },
      { title: 'Amount Paid / Division', dataIndex: 'amount_paid_per_division', key: 'amount_paid_per_division', width: 140, ellipsis: true },
      { title: 'Total Amount Paid / Month', dataIndex: 'total_amount_paid_per_month', key: 'total_amount_paid_per_month', width: 160, ellipsis: true },
      { title: 'Payment Frequency', dataIndex: 'payment_frequency', key: 'payment_frequency', width: 130, ellipsis: true },
      { title: 'Client Since', dataIndex: 'client_since', key: 'client_since', width: 120, render: (v) => formatDate(v) },
      { title: 'Client Till', dataIndex: 'client_till', key: 'client_till', width: 120, render: (v) => formatDate(v) },
      { title: 'Client Duration', dataIndex: 'client_duration', key: 'client_duration', width: 120, ellipsis: true },
      { title: 'Total Amount Paid Till Date', dataIndex: 'total_amount_paid_till_date', key: 'total_amount_paid_till_date', width: 170, ellipsis: true },
      { title: 'TDS %', dataIndex: 'tds_percent', key: 'tds_percent', width: 72 },
      { title: 'City', dataIndex: 'client_location_city', key: 'client_location_city', width: 110, ellipsis: true },
      { title: 'State', dataIndex: 'client_location_state', key: 'client_location_state', width: 110, ellipsis: true },
      { title: 'Remarks', dataIndex: 'remarks', key: 'remarks', width: 160, ellipsis: true },
      ...(isInactivePage
        ? [
            {
              title: 'Last contacted',
              dataIndex: 'last_contacted_on',
              key: 'last_contacted_on',
              width: 118,
              render: (v: string | null | undefined) => formatDate(v),
            },
            { title: 'Remarks 2', dataIndex: 'remarks_2', key: 'remarks_2', width: 140, ellipsis: true },
            { title: 'Follow up?', dataIndex: 'follow_up_needed', key: 'follow_up_needed', width: 88 },
          ]
        : []),
      { title: 'WhatsApp Group', dataIndex: 'whatsapp_group_details', key: 'whatsapp_group_details', width: 160, ellipsis: true },
      ...(isMasterAdmin
        ? [
            {
              title: '',
              key: 'actions',
              width: 88,
              fixed: 'right' as const,
              render: (_: unknown, row: ClientOnbRecord) => (
                <Button
                  type="link"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={(e) => {
                    e.stopPropagation()
                    openEdit(row)
                  }}
                >
                  Edit
                </Button>
              ),
            },
          ]
        : []),
    ],
    [isInactivePage, isMasterAdmin, openEdit]
  )

  const tableProps = useMemo(
    () => ({
      rowKey: 'id' as const,
      columns,
      loading: false as const,
      scroll: { x: (isInactivePage ? 3400 : 2900) as const },
      pagination: { pageSize: 20, showSizeChanger: true as const },
      size: 'small' as const,
      onRow: (record: ClientOnbRecord) => ({
        onClick: () => (isInactivePage ? openInactiveDetail(record) : openStatusModal(record)),
        style: { cursor: 'pointer' as const },
      }),
    }),
    [columns, isInactivePage, openInactiveDetail, openStatusModal]
  )

  const listForPage = isInactivePage ? inactiveRecords : activeRecords

  const copyMigrationSql = () => {
    void navigator.clipboard.writeText(CLIENT_ONB_ADD_STATUS_SQL).then(
      () => message.success('SQL copied — paste into Supabase → SQL Editor → Run'),
      () => message.error('Could not copy')
    )
  }

  return (
    <div style={{ padding: 24 }}>
      {statusColumnOk === false && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="Supabase is missing the status column (Active / Inactive will fail until this is fixed)"
          description={
            <div>
              <Typography.Paragraph style={{ marginBottom: 8 }}>
                {statusColumnHint || 'Run the migration script once in the Supabase SQL Editor, then refresh this page.'}
              </Typography.Paragraph>
              <Space wrap>
                <Button type="primary" icon={<CopyOutlined />} onClick={copyMigrationSql}>
                  Copy fix SQL
                </Button>
                <Typography.Text type="secondary">Repo file: docs/SUPABASE_DB_CLIENT_CLIENT_ONB_ADD_STATUS.sql</Typography.Text>
              </Space>
            </div>
          }
        />
      )}
      <Card>
        <Space align="center" style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }} wrap>
          <Space wrap align="center">
            <Title level={4} className="page-main-heading" style={{ margin: 0 }}>
              {isInactivePage ? 'Inactive clients' : 'Client ONB'}
            </Title>
            <OperationsSectionTabs module="db-client" />
          </Space>
          {canEdit && !isInactivePage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>
              Add Client ONB
            </Button>
          )}
        </Space>
        <TableWithSkeletonLoading loading={loading} columns={12} rows={12}>
          <Table<ClientOnbRecord> {...tableProps} dataSource={listForPage} />
        </TableWithSkeletonLoading>
      </Card>

      <Modal
        title="Active or Inactive"
        open={!!statusModalRow}
        onCancel={() => setStatusModalRow(null)}
        onOk={saveStatus}
        confirmLoading={statusSaving}
        okText="Save"
        destroyOnClose
      >
        {statusModalRow && (
          <>
            <Typography.Paragraph>
              <strong>Organization:</strong> {statusModalRow.organization_name || '—'}
              <br />
              <strong>Company:</strong> {statusModalRow.company_name || '—'}
              <br />
              <strong>Reference:</strong> {statusModalRow.reference_no}
            </Typography.Paragraph>
            <Segmented
              block
              value={statusDraft}
              onChange={(v) => setStatusDraft(v as 'active' | 'inactive')}
              options={[
                { label: 'Active', value: 'active' },
                { label: 'Inactive', value: 'inactive' },
              ]}
            />
          </>
        )}
      </Modal>

      <Modal
        title={
          inactiveDetailRow
            ? `Inactive client — ${inactiveDetailRow.reference_no || inactiveDetailRow.id}`
            : 'Inactive client'
        }
        open={!!inactiveDetailRow}
        onCancel={() => {
          setInactiveDetailRow(null)
          inactiveFollowForm.resetFields()
        }}
        afterOpenChange={(open) => {
          if (!open || !inactiveDetailRow?.id) return
          const row = records.find((r) => r.id === inactiveDetailRow.id) ?? inactiveDetailRow
          queueMicrotask(() => {
            setStatusDraft(normalizeStatus(row.status))
            inactiveFollowForm.setFieldsValue({
              last_contacted_on: row.last_contacted_on
                ? dayjs(String(row.last_contacted_on).slice(0, 10))
                : undefined,
              remarks_2: row.remarks_2 ?? '',
              follow_up_needed: row.follow_up_needed || undefined,
            })
          })
        }}
        onOk={saveInactiveDetail}
        confirmLoading={inactiveDetailSaving}
        okText="Save"
        destroyOnClose
        width={560}
      >
        {inactiveDetailRow && (
          <>
            <Typography.Paragraph style={{ marginBottom: 12 }}>
              <strong>Organization:</strong> {inactiveDetailRow.organization_name || '—'}
              <br />
              <strong>Company:</strong> {inactiveDetailRow.company_name || '—'}
            </Typography.Paragraph>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
              Status
            </Typography.Text>
            <Segmented
              block
              value={statusDraft}
              onChange={(v) => setStatusDraft(v as 'active' | 'inactive')}
              options={[
                { label: 'Active', value: 'active' },
                { label: 'Inactive', value: 'inactive' },
              ]}
            />
            <Form form={inactiveFollowForm} layout="vertical" style={{ marginTop: 16 }} preserve={false}>
              <Form.Item name="last_contacted_on" label="Last contacted on">
                <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" allowClear />
              </Form.Item>
              <Form.Item name="remarks_2" label="Remarks 2">
                <TextArea rows={3} allowClear />
              </Form.Item>
              <Form.Item name="follow_up_needed" label="Do we need to follow up?">
                <Select
                  allowClear
                  placeholder="Select"
                  options={[
                    { value: 'Yes', label: 'Yes' },
                    { value: 'No', label: 'No' },
                  ]}
                />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>

      <Modal
        title={editing ? 'Edit Client ONB' : 'Add Client ONB'}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false)
          setEditing(null)
          form.resetFields()
        }}
        afterOpenChange={(open) => {
          if (!open || !editing?.id) return
          const row = records.find((r) => r.id === editing.id) ?? editing
          queueMicrotask(() => populateEditFormFromRow(row))
        }}
        width={720}
        destroyOnClose
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setModalOpen(false)
              setEditing(null)
              form.resetFields()
            }}
          >
            Cancel
          </Button>,
          ...(!editing && canEdit
            ? [<Button key="create" type="primary" loading={submitLoading} onClick={handleSubmit}>Create</Button>]
            : []),
          ...(editing && isMasterAdmin
            ? [<Button key="save" type="primary" loading={submitLoading} onClick={handleSubmit}>Save</Button>]
            : []),
        ]}
      >
        {editing && (
          <Space direction="vertical" style={{ marginBottom: 16, width: '100%' }} size="small">
            <Input addonBefore="Timestamp (auto)" value={formatTs(editing.timestamp)} disabled />
            <Input addonBefore="Reference (auto)" value={editing.reference_no} disabled />
          </Space>
        )}
        {!editing && (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
            Timestamp and reference number are generated automatically when you create the record. The client starts as <strong>Active</strong>.
            All fields are required.
          </Typography.Paragraph>
        )}
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="organization_name" label="Organization Name" rules={!editing ? [REQ] : undefined}>
            <Input placeholder="Organization name" />
          </Form.Item>
          <Form.Item name="company_name" label="Company Name" rules={!editing ? [REQ] : undefined}>
            <Input placeholder="Company name" />
          </Form.Item>
          <Form.Item name="contact_person" label="Contact Person" rules={!editing ? [REQ] : undefined}>
            <Input />
          </Form.Item>
          <Form.Item name="mobile_no" label="Mobile No." rules={!editing ? [REQ] : undefined}>
            <Input />
          </Form.Item>
          <Form.Item
            name="email_id"
            label="Email ID"
            rules={!editing ? [REQ, { type: 'email' as const, message: 'Enter a valid email' }] : undefined}
          >
            <Input type="email" />
          </Form.Item>
          <Form.Item name="paid_divisions" label="Paid Divisions" rules={!editing ? [REQ] : undefined}>
            <Input />
          </Form.Item>
          <Form.Item name="division_abbreviation" label="Division Abbreviation" rules={!editing ? [REQ] : undefined}>
            <Input />
          </Form.Item>
          <Form.Item name="name_of_divisions_cost_details" label="Name of Divisions & Cost Details" rules={!editing ? [REQ] : undefined}>
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="amount_paid_per_division" label="Amount Paid per Division" rules={!editing ? [REQ] : undefined}>
            <Input />
          </Form.Item>
          <Form.Item name="total_amount_paid_per_month" label="Total Amount Paid per Month" rules={!editing ? [REQ] : undefined}>
            <Input />
          </Form.Item>
          <Form.Item name="payment_frequency" label="Payment Frequency" rules={!editing ? [REQ] : undefined}>
            <Input />
          </Form.Item>
          <Form.Item name="client_since" label="Client Since" rules={!editing ? [REQ] : undefined}>
            <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
          </Form.Item>
          <Form.Item name="client_till" label="Client Till" rules={!editing ? [REQ] : undefined}>
            <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
          </Form.Item>
          <Form.Item name="client_duration" label="Client Duration" rules={!editing ? [REQ] : undefined}>
            <Input placeholder="e.g. 12 months" />
          </Form.Item>
          <Form.Item name="total_amount_paid_till_date" label="Total Amount Paid Till Date" rules={!editing ? [REQ] : undefined}>
            <Input />
          </Form.Item>
          <Form.Item name="tds_percent" label="TDS %" rules={!editing ? [REQ] : undefined}>
            <Input />
          </Form.Item>
          <Form.Item name="client_location_city" label="Client Location (City)" rules={!editing ? [REQ] : undefined}>
            <Input />
          </Form.Item>
          <Form.Item name="client_location_state" label="Client Location (State)" rules={!editing ? [REQ] : undefined}>
            <Input />
          </Form.Item>
          <Form.Item name="remarks" label="Remarks" rules={!editing ? [REQ] : undefined}>
            <TextArea rows={2} />
          </Form.Item>
          <Form.Item name="whatsapp_group_details" label="WhatsApp Group Details" rules={!editing ? [REQ] : undefined}>
            <TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
