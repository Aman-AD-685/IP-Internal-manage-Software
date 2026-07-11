import { useState, useEffect, useMemo, useRef } from 'react'
import { Typography, Card, Table, message, Button, Modal, Form, Select, Space, Drawer, Descriptions, Input } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { CheckCircleOutlined, FormOutlined, EditOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {
  trainingApi,
  type TrainingClientRecord,
  type TrainingStatusResponse,
  type TrainingStagesConfigResponse,
  type TrainingUser,
} from '../../api/training'
import { TableWithSkeletonLoading } from '../../components/common/skeletons'
import { DEFAULT_INFINITE_CHUNK, useInfiniteScrollChunk } from '../../hooks/useInfiniteScrollChunk'
import { useSearchParams } from 'react-router-dom'

const { Title } = Typography

const YES_NO_NA = [{ value: 'Yes' }, { value: 'No' }, { value: 'NA' }]

const DAY0_FIELDS: { key: string; label: string }[] = [
  { key: 'confirm_share_live_credentials', label: 'Confirm to share live ID, Password.' },
  { key: 'google_meet_test_run', label: 'Test run for meeting in Google Meet (for Day 1).' },
  { key: 'hardware_requirements_ok', label: 'Check hardware requirements (Microphone, Speaker).' },
  { key: 'network_connection_ok', label: 'Define good network connection.' },
  { key: 'identify_training_members', label: 'Identify members to attend the training.' },
  { key: 'check_master_data', label: 'Check all master data given by company.' },
  { key: 'final_followup_doubts_documented', label: 'Final follow up for customer to note down doubts & should be present in documented manner through Day 1 Training.' },
  { key: 'tasks_completed_before_day1', label: 'Tasks should be completed before Day 1.' },
  { key: 'min_one_item', label: 'Minimum 1 item' },
  { key: 'min_two_vendors', label: 'Minimum 2 Vendors' },
  { key: 'min_one_indent', label: 'Minimum 1 Indent' },
  { key: 'min_two_rfq', label: 'Minimum 2 RFQ' },
  { key: 'min_two_qc', label: 'Minimum 2 QC' },
  { key: 'meeting_link_day1_created', label: 'Create & Schedule Meeting Link for Day 1.' },
  { key: 'how_to_videos_shared', label: 'Share How To Videos on; Negotiation, Create Vendor, Item Group, Set Reorder Level, Brand, Tag Vendor.' },
]

function resolveTrainerDisplayName(
  client: TrainingClientRecord | null | undefined,
  day0: Record<string, string> | null | undefined,
): string {
  const fromClient = (client?.trainer_name || '').trim()
  if (fromClient) return fromClient
  const fromDay0 = (day0?.trainer_name || '').trim()
  if (fromDay0) return fromDay0
  const fromDay0Id = (day0?.trainer_user_id || '').trim()
  return fromDay0Id || '—'
}

export function ClientTrainingPage() {
  const [searchParams] = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<TrainingClientRecord[]>([])
  const [selectedClient, setSelectedClient] = useState<TrainingClientRecord | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [day0ModalOpen, setDay0ModalOpen] = useState(false)
  const [day0Form] = Form.useForm()
  const [day0Loading, setDay0Loading] = useState(false)
  const [day0Summary, setDay0Summary] = useState<Record<string, string> | null>(null)
  const [day0Editable48h, setDay0Editable48h] = useState(false)
  const [day0SubmittedAt, setDay0SubmittedAt] = useState<string | null>(null)
  const [day0SummaryLoading, setDay0SummaryLoading] = useState(false)
  const [stagesConfig, setStagesConfig] = useState<TrainingStagesConfigResponse | null>(null)
  const [trainingStatus, setTrainingStatus] = useState<TrainingStatusResponse | null>(null)
  const [stageModalOpen, setStageModalOpen] = useState(false)
  const [stageModalKey, setStageModalKey] = useState<string | null>(null)
  const [stageForm] = Form.useForm()
  const [stageLoading, setStageLoading] = useState(false)
  const [day0Users, setDay0Users] = useState<TrainingUser[]>([])
  const [searchText, setSearchText] = useState('')
  const [filterRef, setFilterRef] = useState<string | undefined>(undefined)
  const [filterCompany, setFilterCompany] = useState<string | undefined>(undefined)
  const [filterOnbRef, setFilterOnbRef] = useState<string | undefined>(undefined)
  const [filterPoc, setFilterPoc] = useState<string | undefined>(undefined)
  const [filterTrainer, setFilterTrainer] = useState<string | undefined>(undefined)
  const openedDeepLinkRef = useRef('')

  const refreshClients = (paymentStatusId?: string) => {
    setLoading(true)
    return trainingApi
      .listClients()
      .then((r) => {
        const nextItems = r.items || []
        setItems(nextItems)
        if (paymentStatusId) {
          const updated = nextItems.find((i) => i.payment_status_id === paymentStatusId)
          if (updated) setSelectedClient(updated)
        }
        return nextItems
      })
      .finally(() => setLoading(false))
  }

  const applyDay0Response = (res: { data?: Record<string, string>; editable_48h?: boolean; submitted_at?: string | null }) => {
    const data = res.data || {}
    setDay0Summary(data)
    setDay0Editable48h(res.editable_48h ?? false)
    setDay0SubmittedAt(res.submitted_at ?? null)
    const trainerName = (data.trainer_name || '').trim()
    if (trainerName) {
      setSelectedClient((prev) =>
        prev ? { ...prev, trainer_name: trainerName, trainer_user_id: data.trainer_user_id || prev.trainer_user_id } : prev,
      )
    }
  }

  useEffect(() => {
    trainingApi.getStagesConfig().then(setStagesConfig).catch(() => setStagesConfig(null))
  }, [])

  useEffect(() => {
    setLoading(true)
    trainingApi
      .listClients()
      .then((r) => setItems(r.items || []))
      .catch(() => {
        setItems([])
        message.warning('Could not load clients.')
      })
      .finally(() => setLoading(false))
  }, [])

  const openDetails = (client: TrainingClientRecord) => {
    setSelectedClient(client)
    setDetailOpen(true)
    setDay0Summary(null)
    setDay0Editable48h(false)
    setDay0SubmittedAt(null)
    setTrainingStatus(null)
    setDay0SummaryLoading(true)
    Promise.all([
      trainingApi.getDay0Checklist(client.payment_status_id),
      trainingApi.getTrainingStatus(client.payment_status_id),
    ])
      .then(([day0Res, status]) => {
        applyDay0Response(day0Res)
        setTrainingStatus(status)
      })
      .catch(() => {
        setDay0Summary(null)
        setDay0Editable48h(false)
        setDay0SubmittedAt(null)
        setTrainingStatus(null)
      })
      .finally(() => setDay0SummaryLoading(false))
  }

  useEffect(() => {
    const target = (searchParams.get('open') || searchParams.get('reference') || '').trim()
    if (!target || openedDeepLinkRef.current === target || detailOpen || !items.length) return
    const record = items.find(
      (row) =>
        row.payment_status_id === target ||
        row.client_reference_no === target ||
        row.onboarding_reference_no === target,
    )
    if (!record) return
    openedDeepLinkRef.current = target
    openDetails(record)
  }, [detailOpen, items, searchParams])

  const openDay0Checklist = () => {
    if (!selectedClient) return
    setDay0ModalOpen(true)
    day0Form.resetFields()
    setDay0Loading(true)
    Promise.allSettled([
      trainingApi.getDay0Checklist(selectedClient.payment_status_id),
      trainingApi.listUsers(),
    ])
      .then(([checklistRes, usersRes]) => {
        if (checklistRes.status === 'rejected') {
          message.error('Could not load Day 0 Checklist.')
          return
        }
        if (usersRes.status === 'rejected') {
          message.warning('Trainer list could not be loaded.')
          setDay0Users([])
        } else {
          setDay0Users(usersRes.value?.users || [])
        }
        const res = checklistRes.value
        const data = res.data || {}
        if (Object.keys(data).length > 0) {
          day0Form.setFieldsValue(data)
        } else {
          DAY0_FIELDS.forEach((f) => day0Form.setFieldValue(f.key, 'Yes'))
        }
      })
      .finally(() => setDay0Loading(false))
  }

  const setDay0FormAll = (value: 'Yes' | 'NA') => {
    DAY0_FIELDS.forEach((f) => day0Form.setFieldValue(f.key, value))
  }

  const skipDay0AndSubmit = () => {
    if (!selectedClient) return
    const data: Record<string, string> = {}
    DAY0_FIELDS.forEach((f) => { data[f.key] = 'NA' })
    const trainerId = day0Form.getFieldValue('trainer_user_id')
    if (trainerId != null && trainerId !== '') data.trainer_user_id = String(trainerId)
    setDay0FormAll('NA')
    setDay0Loading(true)
    trainingApi
      .saveDay0Checklist(selectedClient.payment_status_id, data)
      .then(() => {
        message.success('Day 0 Checklist saved (skipped).')
        setDay0ModalOpen(false)
        trainingApi.getDay0Checklist(selectedClient.payment_status_id).then(applyDay0Response)
        trainingApi.getTrainingStatus(selectedClient.payment_status_id).then(setTrainingStatus)
        refreshClients(selectedClient.payment_status_id)
      })
      .catch((err) => message.error(err?.response?.data?.detail || 'Could not save.'))
      .finally(() => setDay0Loading(false))
  }

  const handleDay0Submit = () => {
    if (!selectedClient) return
    day0Form
      .validateFields()
      .then((values) => {
        const data = values as Record<string, string>
        setDay0Loading(true)
        trainingApi
          .saveDay0Checklist(selectedClient.payment_status_id, data)
          .then(() => {
            message.success('Day 0 Checklist saved.')
            setDay0ModalOpen(false)
            trainingApi.getDay0Checklist(selectedClient.payment_status_id).then(applyDay0Response)
            trainingApi.getTrainingStatus(selectedClient.payment_status_id).then(setTrainingStatus)
            refreshClients(selectedClient.payment_status_id)
          })
          .catch((err) => message.error(err?.response?.data?.detail || 'Could not save.'))
          .finally(() => setDay0Loading(false))
      })
      .catch(() => {})
  }

  const openStageModal = (stageKey: string) => {
    if (!selectedClient) return
    setStageModalKey(stageKey)
    setStageModalOpen(true)
    setStageLoading(true)
    stageForm.resetFields()
    trainingApi
      .getStage(selectedClient.payment_status_id, stageKey)
      .then((res) => {
        const data = res.data || {}
        const fields = stagesConfig?.stages[stageKey]?.fields || []
        const values: Record<string, string> = {}
        fields.forEach(([key]) => { values[key] = data[key] || 'Yes' })
        stageForm.setFieldsValue(values)
      })
      .catch(() => message.error('Could not load checklist.'))
      .finally(() => setStageLoading(false))
  }

  const setStageFormAll = (value: 'Yes' | 'NA') => {
    const stageKey = stageModalKey
    if (!stageKey || !stagesConfig?.stages[stageKey]?.fields) return
    const fields = stagesConfig.stages[stageKey].fields
    const values: Record<string, string> = {}
    fields.forEach(([key]) => { values[key] = value })
    setTimeout(() => stageForm.setFieldsValue(values), 0)
  }

  const skipStageAndSubmit = () => {
    if (!selectedClient || !stageModalKey || !stagesConfig?.stages[stageModalKey]?.fields) return
    const fields = stagesConfig.stages[stageModalKey].fields
    const data: Record<string, string> = {}
    fields.forEach(([key]) => { data[key] = 'NA' })
    setStageFormAll('NA')
    setStageLoading(true)
    trainingApi
      .saveStage(selectedClient.payment_status_id, stageModalKey, data)
      .then(() => {
        message.success('Stage saved (skipped).')
        setStageModalOpen(false)
        setStageModalKey(null)
        trainingApi.getTrainingStatus(selectedClient.payment_status_id).then(setTrainingStatus)
        setLoading(true)
        trainingApi.listClients().then((r) => setItems(r.items || [])).finally(() => setLoading(false))
      })
      .catch((err) => message.error(err?.response?.data?.detail || 'Could not save.'))
      .finally(() => setStageLoading(false))
  }

  const handleStageSubmit = () => {
    if (!selectedClient || !stageModalKey) return
    stageForm
      .validateFields()
      .then((values) => {
        const data = values as Record<string, string>
        setStageLoading(true)
        trainingApi
          .saveStage(selectedClient.payment_status_id, stageModalKey, data)
          .then(() => {
            message.success('Checklist saved.')
            setStageModalOpen(false)
            setStageModalKey(null)
            trainingApi.getTrainingStatus(selectedClient.payment_status_id).then(setTrainingStatus)
            setLoading(true)
            trainingApi.listClients().then((r) => setItems(r.items || [])).finally(() => setLoading(false))
          })
          .catch((err) => message.error(err?.response?.data?.detail || 'Could not save.'))
          .finally(() => setStageLoading(false))
      })
      .catch(() => {})
  }

  const columns = [
    { title: 'Reference No', dataIndex: 'client_reference_no', key: 'client_reference_no', width: 100, fixed: 'left' as const },
    { title: 'Company Name', dataIndex: 'company_name', key: 'company_name', width: 140, fixed: 'left' as const, render: (v: string) => v || '—' },
    { title: 'Point of Contact', dataIndex: 'poc_name', key: 'poc_name', width: 120, render: (v: string) => v || '—' },
    { title: 'Onb Ref', dataIndex: 'onboarding_reference_no', key: 'onb_ref', width: 100, render: (v: string) => v || '—' },
    { title: 'Expected Day 0', dataIndex: 'expected_day0', key: 'expected_day0', width: 140, render: (v: string) => (v ? dayjs(v).format('DD-MMM-YYYY HH:mm') : '—') },
    { title: 'Trainer', dataIndex: 'trainer_name', key: 'trainer_name', width: 100, render: (v: string) => v || '—' },
    { title: "Day '0' Checklist", key: 'day0_checklist', width: 110, render: (_: unknown, r: TrainingClientRecord) => r.day0_skipped ? 'Skip' : r.day0_submitted_at ? 'Done' : '—' },
    { title: "Status Day '0'", key: 'status_day0', width: 120, render: (_: unknown, r: TrainingClientRecord) => r.day0_skipped ? 'Skip' : (r.day0_status === 'pending' ? 'Pending' : r.day0_status === 'delayed' ? `Done, ${r.day0_delay_text || ''}` : r.day0_completed_in_text ? `Done in ${r.day0_completed_in_text}` : 'Done') },
    { title: "Day '0' Completed", key: 'day0_completed', width: 120, render: (_: unknown, r: TrainingClientRecord) => r.day0_skipped ? 'Skip' : (r.day0_submitted_at ? dayjs(r.day0_submitted_at).format('DD-MMM-YYYY HH:mm') : '—') },
    { title: "Day '0' delay", key: 'day0_delay', width: 100, render: (_: unknown, r: TrainingClientRecord) => r.day0_skipped ? 'Skip' : (r.day0_status === 'delayed' ? (r.day0_delay_text || '—') : '—') },
    { title: "DAY 1(-2 hour) Checklist", key: 'day1_minus2', width: 150, render: (_: unknown, r: TrainingClientRecord) => r.day1_minus2_skipped ? 'Skip' : r.day1_minus2_submitted_at ? 'Done' : '—' },
    { title: "Day '1' Planed", key: 'day1_planed', width: 120, render: (_: unknown, r: TrainingClientRecord) => r.day1_skipped ? 'Skip' : (r.day1_planed_iso || r.day0_submitted_at ? dayjs(r.day1_planed_iso || r.day0_submitted_at).format('DD-MMM-YYYY HH:mm') : '—') },
    { title: "Day '1' Completed", key: 'day1_completed', width: 120, render: (_: unknown, r: TrainingClientRecord) => r.day1_skipped ? 'Skip' : (r.day1_submitted_at ? dayjs(r.day1_submitted_at).format('DD-MMM-YYYY HH:mm') : '—') },
    { title: "Status Day '1'", key: 'status_day1', width: 100, render: (_: unknown, r: TrainingClientRecord) => r.day1_skipped ? 'Skip' : r.day1_submitted_at ? 'Done' : 'Pending' },
    { title: "Day '1' delay", key: 'day1_delay', width: 100, render: (_: unknown, r: TrainingClientRecord) => r.day1_skipped ? 'Skip' : (r.day1_delay_text || '—') },
    { title: "Day '1' Checklist", key: 'day1_checklist', width: 110, render: (_: unknown, r: TrainingClientRecord) => r.day1_skipped ? 'Skip' : r.day1_submitted_at ? 'Done' : '—' },
    { title: "DAY 1 (+1day) Checklist", key: 'day1_plus1', width: 150, render: (_: unknown, r: TrainingClientRecord) => r.day1_plus1_skipped ? 'Skip' : r.day1_plus1_submitted_at ? 'Done' : '—' },
    { title: "Day '2' Planed", key: 'day2_planed', width: 120, render: (_: unknown, r: TrainingClientRecord) => r.day2_skipped ? 'Skip' : (r.day2_planed_iso ? dayjs(r.day2_planed_iso).format('DD-MMM-YYYY HH:mm') : '—') },
    { title: "Day '2' Completed", key: 'day2_completed', width: 120, render: (_: unknown, r: TrainingClientRecord) => r.day2_skipped ? 'Skip' : (r.day2_submitted_at ? dayjs(r.day2_submitted_at).format('DD-MMM-YYYY HH:mm') : '—') },
    { title: "Status Day '2'", key: 'status_day2', width: 100, render: (_: unknown, r: TrainingClientRecord) => r.day2_skipped ? 'Skip' : r.day2_submitted_at ? 'Done' : 'Pending' },
    { title: "Day '2' delay", key: 'day2_delay', width: 100, render: (_: unknown, r: TrainingClientRecord) => r.day2_skipped ? 'Skip' : (r.day2_delay_text || '—') },
    { title: "Day '2' Checklist", key: 'day2_checklist', width: 110, render: (_: unknown, r: TrainingClientRecord) => r.day2_skipped ? 'Skip' : r.day2_submitted_at ? 'Done' : '—' },
    { title: "Day '3' Planed", key: 'day3_planed', width: 120, render: (_: unknown, r: TrainingClientRecord) => r.day3_skipped ? 'Skip' : (r.day3_planed_iso ? dayjs(r.day3_planed_iso).format('DD-MMM-YYYY HH:mm') : '—') },
    { title: "Day '3' Completed", key: 'day3_completed', width: 120, render: (_: unknown, r: TrainingClientRecord) => r.day3_skipped ? 'Skip' : (r.day3_submitted_at ? dayjs(r.day3_submitted_at).format('DD-MMM-YYYY') : '—') },
    { title: "Status Day '3'", key: 'status_day3', width: 100, render: (_: unknown, r: TrainingClientRecord) => r.day3_skipped ? 'Skip' : r.day3_submitted_at ? 'Done' : 'Pending' },
    { title: "Day '3' delay", key: 'day3_delay', width: 90, render: (_: unknown, r: TrainingClientRecord) => r.day3_skipped ? 'Skip' : '—' },
    { title: "Day '3' Checklist", key: 'day3_checklist', width: 110, render: (_: unknown, r: TrainingClientRecord) => r.day3_skipped ? 'Skip' : r.day3_submitted_at ? 'Done' : '—' },
    { title: "Training Completion Day '1'", key: 'completion_day1', width: 150, render: () => '—' },
    { title: "Training Completion Day '2'", key: 'completion_day2', width: 150, render: () => '—' },
    { title: "Training Completion Day '3'", key: 'completion_day3', width: 150, render: () => '—' },
    { title: "Task Update Status (After 7 Days)", key: 'task_7days_1', width: 180, render: () => '—' },
    { title: "Task Update Status (After 7 Days)", key: 'task_7days_2', width: 180, render: () => '—' },
    { title: "Task Update Status (After 7 Days)", key: 'task_7days_3', width: 180, render: () => '—' },
    { title: 'Training Feedback', key: 'feedback', width: 120, render: (_: unknown, r: TrainingClientRecord) => r.feedback_skipped ? 'Skip' : r.feedback_submitted_at ? 'Done' : '—' },
  ]

  const displayItems = useMemo(() => {
    return items.filter((r) => {
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase()
        const ref = (r.client_reference_no || '').toLowerCase()
        const company = (r.company_name || '').toLowerCase()
        const onb = (r.onboarding_reference_no || '').toLowerCase()
        const poc = (r.poc_name || '').toLowerCase()
        const trainer = (r.trainer_name || '').toLowerCase()
        if (!ref.includes(q) && !company.includes(q) && !onb.includes(q) && !poc.includes(q) && !trainer.includes(q)) return false
      }
      if (filterRef && (r.client_reference_no || '').toLowerCase() !== filterRef.toLowerCase()) return false
      if (filterCompany && (r.company_name || '').toLowerCase() !== filterCompany.toLowerCase()) return false
      if (filterOnbRef && (r.onboarding_reference_no || '').toLowerCase() !== filterOnbRef.toLowerCase()) return false
      if (filterPoc && (r.poc_name || '').toLowerCase() !== filterPoc.toLowerCase()) return false
      if (filterTrainer && (r.trainer_name || '').toLowerCase() !== filterTrainer.toLowerCase()) return false
      return true
    })
  }, [items, searchText, filterRef, filterCompany, filterOnbRef, filterPoc, filterTrainer])

  const refOptions = useMemo(() => [...new Set(items.map((r) => r.client_reference_no).filter(Boolean))].sort().map((v) => ({ value: v!, label: v! })), [items])
  const companyOptions = useMemo(() => [...new Set(items.map((r) => r.company_name).filter(Boolean))].sort().map((v) => ({ value: v!, label: v! })), [items])
  const onbRefOptions = useMemo(() => [...new Set(items.map((r) => r.onboarding_reference_no).filter(Boolean))].sort().map((v) => ({ value: v!, label: v! })), [items])
  const pocOptions = useMemo(() => [...new Set(items.map((r) => r.poc_name).filter(Boolean))].sort().map((v) => ({ value: v!, label: v! })), [items])
  const trainerOptions = useMemo(() => [...new Set(items.map((r) => r.trainer_name).filter(Boolean))].sort().map((v) => ({ value: v!, label: v! })), [items])

  const clearFilters = () => {
    setSearchText('')
    setFilterRef(undefined)
    setFilterCompany(undefined)
    setFilterOnbRef(undefined)
    setFilterPoc(undefined)
    setFilterTrainer(undefined)
  }

  const {
    visibleItems: visibleDisplayItems,
    containerRef: trainingTableContainerRef,
    sentinelRef: trainingTableSentinelRef,
    total: totalDisplayItems,
    visibleCount: visibleDisplayCount,
    hasMore: displayItemsHasMore,
  } = useInfiniteScrollChunk({ items: displayItems, chunkSize: DEFAULT_INFINITE_CHUNK, loading })

  return (
    <div style={{ padding: 24 }}>
      <Title level={4} className="page-main-heading" style={{ margin: '0 0 24px' }}>
        Client Training
      </Title>
      <Card title="Clients">
        <div style={{ marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input
            placeholder="Search (Ref, Company, Onb Ref, POC, Trainer)"
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
            style={{ width: 280 }}
          />
          <Select
            placeholder="Filter by Reference No"
            value={filterRef}
            onChange={(v) => setFilterRef(v)}
            style={{ width: 160 }}
            allowClear
            showSearch
            optionFilterProp="label"
            options={refOptions}
          />
          <Select
            placeholder="Filter by Company"
            value={filterCompany}
            onChange={(v) => setFilterCompany(v)}
            style={{ width: 180 }}
            allowClear
            showSearch
            optionFilterProp="label"
            options={companyOptions}
          />
          <Select
            placeholder="Filter by Onb Ref"
            value={filterOnbRef}
            onChange={(v) => setFilterOnbRef(v)}
            style={{ width: 140 }}
            allowClear
            showSearch
            optionFilterProp="label"
            options={onbRefOptions}
          />
          <Select
            placeholder="Filter by POC"
            value={filterPoc}
            onChange={(v) => setFilterPoc(v)}
            style={{ width: 140 }}
            allowClear
            showSearch
            optionFilterProp="label"
            options={pocOptions}
          />
          <Select
            placeholder="Filter by Trainer"
            value={filterTrainer}
            onChange={(v) => setFilterTrainer(v)}
            style={{ width: 140 }}
            allowClear
            showSearch
            optionFilterProp="label"
            options={trainerOptions}
          />
          <Button onClick={clearFilters}>Clear filters</Button>
        </div>
        <TableWithSkeletonLoading loading={loading} columns={12} rows={12}>
          <div ref={trainingTableContainerRef}>
            <Table
              dataSource={visibleDisplayItems}
              columns={columns}
              rowKey="payment_status_id"
              loading={false}
              pagination={false}
              summary={() => (
                <Table.Summary>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={columns.length}>
                      <div ref={trainingTableSentinelRef} style={{ height: 8, minHeight: 8 }} aria-hidden />
                      <Typography.Text type="secondary">
                        Showing {visibleDisplayCount} of {totalDisplayItems} rows{displayItemsHasMore ? ' · scroll to load more' : ''}
                      </Typography.Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
              scroll={{ x: 4000 }}
              locale={{ emptyText: loading ? undefined : 'No clients. Submit Final Setup in Onboarding (Payment Status) for a company to appear here.' }}
              onRow={(record) => ({
                onClick: () => openDetails(record),
                style: { cursor: 'pointer' },
              })}
            />
          </div>
        </TableWithSkeletonLoading>

        <Drawer
          title={selectedClient ? `${selectedClient.client_reference_no} – ${selectedClient.company_name}` : 'Client Details'}
          open={detailOpen}
          onClose={() => { setDetailOpen(false); setSelectedClient(null) }}
          width={520}
        >
          {selectedClient && (
            <>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Company">{selectedClient.company_name}</Descriptions.Item>
                <Descriptions.Item label="Reference No">{selectedClient.client_reference_no}</Descriptions.Item>
                <Descriptions.Item label="Onb Ref">{selectedClient.onboarding_reference_no || '—'}</Descriptions.Item>
                <Descriptions.Item label="Timestamp">{selectedClient.timestamp ? dayjs(selectedClient.timestamp).format('DD-MMM-YYYY HH:mm') : '—'}</Descriptions.Item>
                <Descriptions.Item label="Point of Contact">{selectedClient.poc_name || '—'}</Descriptions.Item>
                <Descriptions.Item label="Trainer">{resolveTrainerDisplayName(selectedClient, day0Summary)}</Descriptions.Item>
                <Descriptions.Item label="Expected Day 0">{selectedClient.expected_day0 ? dayjs(selectedClient.expected_day0).format('DD-MMM-YYYY HH:mm') : '—'}</Descriptions.Item>
                <Descriptions.Item label="Status Day 0">{selectedClient.day0_status === 'pending' ? 'Pending' : selectedClient.day0_status === 'delayed' ? `Done, ${selectedClient.day0_delay_text || ''}` : selectedClient.day0_completed_in_text ? `Done in ${selectedClient.day0_completed_in_text}` : 'Done'}</Descriptions.Item>
                {selectedClient.day0_status === 'delayed' && selectedClient.day0_delay_text != null && <Descriptions.Item label="Day 0 delay">{selectedClient.day0_delay_text}</Descriptions.Item>}
              </Descriptions>

              <div style={{ marginTop: 16 }}>
                {day0SummaryLoading ? (
                  <Typography.Text type="secondary">Loading…</Typography.Text>
                ) : selectedClient?.day0_skipped ? (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <CheckCircleOutlined style={{ color: '#52c41a' }} />
                      <span>Day 0 Checklist</span>
                      <Typography.Text type="secondary">Skip</Typography.Text>
                    </div>
                  </div>
                ) : day0Summary && Object.keys(day0Summary).length > 0 ? (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                      <Space>
                        <CheckCircleOutlined style={{ color: '#52c41a' }} />
                        <span>Day 0 Checklist</span>
                        {day0SubmittedAt && <span style={{ color: '#888', fontSize: 12 }}>{dayjs(day0SubmittedAt).format('DD-MMM-YYYY HH:mm')}</span>}
                      </Space>
                      {day0Editable48h ? (
                        <Button type="link" size="small" icon={<EditOutlined />} onClick={openDay0Checklist}>Edit</Button>
                      ) : (
                        <Button type="link" size="small" onClick={openDay0Checklist}>View</Button>
                      )}
                    </div>
                    <Descriptions column={1} size="small" bordered contentStyle={{ minWidth: 56, whiteSpace: 'nowrap' }}>
                      {DAY0_FIELDS.map((f) => (
                        <Descriptions.Item key={f.key} label={f.label}>
                          <span style={{ whiteSpace: 'nowrap' }}>{day0Summary[f.key] || '—'}</span>
                        </Descriptions.Item>
                      ))}
                    </Descriptions>
                  </div>
                ) : (
                  <Button type="primary" block icon={<FormOutlined />} onClick={openDay0Checklist} size="large">
                    Day 0 Checklist
                  </Button>
                )}
              </div>

              {stagesConfig && trainingStatus && (
                <>
                  {stagesConfig.order.map((sk) => {
                    const st = trainingStatus.stages[sk]
                    const title = stagesConfig.stages[sk]?.title || sk
                    const stageSkipped =
                      (sk === 'day1_minus2' && selectedClient.day1_minus2_skipped) ||
                      (sk === 'day1' && selectedClient.day1_skipped) ||
                      (sk === 'day1_plus1' && selectedClient.day1_plus1_skipped) ||
                      (sk === 'day2' && selectedClient.day2_skipped) ||
                      (sk === 'day3' && selectedClient.day3_skipped) ||
                      (sk === 'feedback' && selectedClient.feedback_skipped)
                    if (st?.submitted_at) {
                      return (
                        <div key={sk} style={{ marginTop: 16 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                            <Space>
                              <CheckCircleOutlined style={{ color: '#52c41a' }} />
                              <span>{title}</span>
                              {stageSkipped ? (
                                <Typography.Text type="secondary">Skip</Typography.Text>
                              ) : (
                                <span style={{ color: '#888', fontSize: 12 }}>{dayjs(st.submitted_at).format('DD-MMM-YYYY HH:mm')}</span>
                              )}
                            </Space>
                            {!stageSkipped && (st.editable_48h ? (
                              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openStageModal(sk)}>Edit</Button>
                            ) : (
                              <Button type="link" size="small" onClick={() => openStageModal(sk)}>View</Button>
                            ))}
                          </div>
                          {stageSkipped ? null : st.data && Object.keys(st.data).length > 0 && (
                            <Descriptions column={1} size="small" bordered contentStyle={{ minWidth: 56, whiteSpace: 'nowrap' }}>
                              {stagesConfig.stages[sk]?.fields?.map(([key, label]) => (
                                <Descriptions.Item key={key} label={label}>
                                  <span style={{ whiteSpace: 'nowrap' }}>{st.data[key] || '—'}</span>
                                </Descriptions.Item>
                              ))}
                            </Descriptions>
                          )}
                        </div>
                      )
                    }
                    return null
                  })}
                  {trainingStatus?.next_stage && stagesConfig?.stages[trainingStatus.next_stage] && (
                    <div style={{ marginTop: 16 }}>
                      <Button
                        type="primary"
                        block
                        icon={<FormOutlined />}
                        onClick={() => openStageModal(trainingStatus.next_stage!)}
                        size="large"
                      >
                        {stagesConfig.stages[trainingStatus.next_stage].title}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </Drawer>

        <Modal
          title={selectedClient ? `Day 0 Checklist – ${selectedClient.company_name}` : 'Day 0 Checklist'}
          open={day0ModalOpen}
          onCancel={() => setDay0ModalOpen(false)}
          onOk={handleDay0Submit}
          confirmLoading={day0Loading}
          destroyOnClose
          width={640}
        >
          <Space style={{ marginBottom: 16 }} wrap>
            <Typography.Text strong>Set all:</Typography.Text>
            <Button onClick={() => setDay0FormAll('Yes')}>Yes</Button>
            <Button onClick={() => setDay0FormAll('NA')}>NA</Button>
            <Button type="default" onClick={skipDay0AndSubmit} loading={day0Loading}>Skip stage & go to next</Button>
          </Space>
          <Form form={day0Form} layout="vertical">
            <Form.Item
              name="trainer_user_id"
              label="Trainer"
              styles={{ label: { height: 'auto', lineHeight: '22px' } }}
            >
              <Select
                placeholder="Select trainer (all users)"
                allowClear
                showSearch
                optionFilterProp="label"
                options={day0Users.map((u) => ({ value: u.id, label: u.full_name || u.id }))}
              />
            </Form.Item>
            {DAY0_FIELDS.map((f) => (
              <Form.Item key={f.key} name={f.key} label={f.label} rules={[{ required: true }]}>
                <Select placeholder="Yes / No / NA" options={YES_NO_NA} />
              </Form.Item>
            ))}
          </Form>
        </Modal>

        <Modal
          title={selectedClient && stageModalKey && stagesConfig?.stages[stageModalKey]
            ? `${stagesConfig.stages[stageModalKey].title} – ${selectedClient.company_name}`
            : 'Checklist'}
          open={stageModalOpen}
          onCancel={() => { setStageModalOpen(false); setStageModalKey(null) }}
          onOk={handleStageSubmit}
          confirmLoading={stageLoading}
          destroyOnClose
          width={640}
        >
          {stageModalKey && stagesConfig?.stages[stageModalKey] && (
            <>
              <Space style={{ marginBottom: 16 }} wrap>
                <Typography.Text strong>Set all:</Typography.Text>
                <Button onClick={() => setStageFormAll('Yes')}>Yes</Button>
                <Button onClick={() => setStageFormAll('NA')}>NA</Button>
                <Button type="default" onClick={skipStageAndSubmit} loading={stageLoading}>Skip stage & go to next</Button>
              </Space>
              <Form form={stageForm} layout="vertical">
                {stagesConfig.stages[stageModalKey].fields.map(([key, label]) => (
                  <Form.Item key={key} name={key} label={label} rules={[{ required: true }]}>
                    <Select placeholder="Yes / No / NA" options={YES_NO_NA} />
                  </Form.Item>
                ))}
              </Form>
            </>
          )}
        </Modal>
      </Card>
    </div>
  )
}
