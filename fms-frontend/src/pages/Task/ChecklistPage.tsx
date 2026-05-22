import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Card,
  Typography,
  Form,
  Input,
  Select,
  DatePicker,
  Button,
  Table,
  Tag,
  message,
  Select as AntSelect,
  Space,
  Modal,
} from 'antd'
import { CheckSquareOutlined, PlusOutlined, UploadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAuth } from '../../hooks/useAuth'
import { useRole } from '../../hooks/useRole'
import {
  checklistApi,
  FREQUENCY_OPTIONS,
  type ChecklistTask,
  type ChecklistOccurrence,
} from '../../api/checklist'
import { TableWithSkeletonLoading } from '../../components/common/skeletons'
import { DEFAULT_INFINITE_CHUNK, useInfiniteScrollChunk } from '../../hooks/useInfiniteScrollChunk'
import { useContextMenu, buildChecklistRowMenu, useContextMenuTrigger, buildPageSurfaceMenu } from '../../contextMenu'
import { ContextMenuTarget } from '../../components/common/ContextMenuTarget'
import { OPEN_ACTION, buildOpenActionUrl } from '../../utils/openActions'
import { useDeepLinkAction } from '../../hooks/useDeepLinkAction'
import { useLocation } from 'react-router-dom'
import { ROUTES } from '../../utils/constants'
import { genericLogicalKey, sessionApiCacheGet } from '../../utils/sessionApiCache'

const { Title, Text } = Typography

type FilterType = 'today' | 'completed' | 'overdue' | 'upcoming'

const formatDate = (d: string) => dayjs(d).format('DD/MM/YYYY')
const formatDay = (d: string) => dayjs(d).format('dddd')

const isToday = (d: string) => dayjs(d).isSame(dayjs(), 'day')

export const ChecklistPage = () => {
  const location = useLocation()
  const { openMenu } = useContextMenu()
  const { user } = useAuth()
  const { isAdmin } = useRole()
  const [form] = Form.useForm()
  const [tasks, setTasks] = useState<ChecklistTask[]>([])
  const [occurrences, setOccurrences] = useState<ChecklistOccurrence[]>([])
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | undefined>(undefined)
  const initialChecklistUserSet = useRef(false)
  const [referenceNoFilter, setReferenceNoFilter] = useState<string>('__all__')
  const [filter, setFilter] = useState<FilterType>('today')
  const [loading, setLoading] = useState(false)
  const [submitLoading, setSubmitLoading] = useState<string | null>(null)
  const [addTaskModalOpen, setAddTaskModalOpen] = useState(false)
  const [departments, setDepartments] = useState<string[]>([])
  const [holidayModalOpen, setHolidayModalOpen] = useState(false)
  const [holidayUploadLoading, setHolidayUploadLoading] = useState(false)
  const today = new Date()
  const canUploadHolidays = today.getMonth() === 11 && today.getDate() >= 15

  const refNoParam = referenceNoFilter && referenceNoFilter !== '__all__' ? referenceNoFilter : undefined

  const effectiveUserId = selectedUserId ?? user?.id

  const loadChecklistData = useCallback(() => {
    const uid = selectedUserId ?? user?.id
    const tasksKey = genericLogicalKey('checklist:tasks', { user_id: uid, reference_no: refNoParam })
    const occKey = genericLogicalKey('checklist:occurrences', {
      filter,
      user_id: uid,
      reference_no: refNoParam,
    })
    const cachedTasks = sessionApiCacheGet<{ tasks: ChecklistTask[] }>(tasksKey)
    const cachedOcc = sessionApiCacheGet<{ occurrences: ChecklistOccurrence[] }>(occKey)
    if (cachedTasks?.tasks && cachedOcc?.occurrences) {
      setTasks(cachedTasks.tasks)
      setOccurrences(cachedOcc.occurrences)
      setLoading(false)
    } else {
      setLoading(true)
    }
    Promise.all([
      checklistApi.getTasks(uid, refNoParam),
      checklistApi.getOccurrences(filter, uid, refNoParam),
      checklistApi.getDepartments(),
      isAdmin ? checklistApi.getUsers() : Promise.resolve({ users: [] as { id: string; full_name: string }[] }),
    ])
      .then(([tasksRes, occRes, deptRes, usersRes]) => {
        setTasks(tasksRes.tasks || [])
        setOccurrences(occRes.occurrences || [])
        setDepartments(deptRes.departments || [])
        setUsers(usersRes.users || [])
      })
      .catch(() => message.error('Failed to load checklist'))
      .finally(() => setLoading(false))
  }, [selectedUserId, user?.id, refNoParam, filter, isAdmin])

  useEffect(() => {
    setReferenceNoFilter('__all__')
  }, [selectedUserId])

  // Default user filter to logged-in user (admins see their tasks first; can change to another user)
  useEffect(() => {
    if (user?.id && !initialChecklistUserSet.current) {
      setSelectedUserId(user.id)
      initialChecklistUserSet.current = true
    }
  }, [user?.id])

  // Single batch load when we have an effective user (avoids double load; ~1s target)
  useEffect(() => {
    if (!effectiveUserId) return
    loadChecklistData()
  }, [effectiveUserId, loadChecklistData])

  const referenceNoOptions = [
    { label: 'All', value: '__all__' },
    ...Array.from(new Set(tasks.map((t) => t.reference_no).filter(Boolean)))
      .sort()
      .map((ref) => ({ label: ref!, value: ref! })),
  ]

  const onFinish = (values: { task_name: string; department: string; frequency: string; start_date: dayjs.Dayjs | null }) => {
    if (!values.start_date) {
      message.error('Please select Day & Date')
      return
    }
    setLoading(true)
    checklistApi
      .createTask({
        task_name: values.task_name,
        department: values.department,
        frequency: values.frequency,
        start_date: values.start_date.format('YYYY-MM-DD'),
      })
      .then(() => {
        message.success('Task created')
        form.resetFields()
        setAddTaskModalOpen(false)
        loadChecklistData()
      })
      .catch((e: any) => message.error(e.response?.data?.detail || 'Failed to create task'))
      .finally(() => setLoading(false))
  }

  const handleComplete = (taskId: string, occurrenceDate: string) => {
    setSubmitLoading(`${taskId}-${occurrenceDate}`)
    checklistApi
      .completeTask(taskId, occurrenceDate)
      .then(() => {
        message.success('Marked as Completed')
        loadChecklistData()
      })
      .catch((e: any) => message.error(e.response?.data?.detail || 'Failed to complete'))
      .finally(() => setSubmitLoading(null))
  }

  const columns = [
    {
      title: 'Reference No',
      dataIndex: 'reference_no',
      key: 'reference_no',
      width: 120,
      render: (v: string) => v || '-',
    },
    {
      title: 'Date',
      dataIndex: 'occurrence_date',
      key: 'occurrence_date',
      width: 110,
      render: (d: string) => formatDate(d),
    },
    {
      title: 'Day',
      key: 'day',
      width: 100,
      render: (_: any, r: ChecklistOccurrence) => formatDay(r.occurrence_date),
    },
    {
      title: 'Task',
      dataIndex: 'task_name',
      key: 'task_name',
    },
    ...(isAdmin
      ? [
          {
            title: 'Doer',
            dataIndex: 'doer_name',
            key: 'doer_name',
            width: 140,
          },
        ]
      : []),
    {
      title: 'Department',
      dataIndex: 'department',
      key: 'department',
      width: 180,
    },
    {
      title: 'Status',
      key: 'status',
      width: 120,
      render: (_: any, r: ChecklistOccurrence) =>
        r.completed_at ? (
          <Tag color="green">Completed</Tag>
        ) : (
          <Tag color="default">Not Completed</Tag>
        ),
    },
    {
      title: 'Action',
      key: 'action',
      width: 100,
      render: (_: any, r: ChecklistOccurrence) => {
        if (r.completed_at) return null
        const canSubmit = r.doer_id === user?.id && isToday(r.occurrence_date)
        return canSubmit ? (
          <Button
            type="primary"
            size="small"
            loading={submitLoading === `${r.task_id}-${r.occurrence_date}`}
            onClick={() => handleComplete(r.task_id, r.occurrence_date)}
          >
            Submit
          </Button>
        ) : null
      },
    },
  ]

  const {
    visibleItems: visibleOccurrences,
    containerRef: checklistTableContainerRef,
    sentinelRef: checklistTableSentinelRef,
    total: totalOccurrences,
    visibleCount: visibleOccurrenceCount,
    hasMore: occurrencesHasMore,
  } = useInfiniteScrollChunk({ items: occurrences, chunkSize: DEFAULT_INFINITE_CHUNK, loading })

  const checklistCreateHref = buildOpenActionUrl(
    location.pathname,
    location.search,
    OPEN_ACTION.CHECKLIST_CREATE,
  )

  useDeepLinkAction(OPEN_ACTION.CHECKLIST_CREATE, () => setAddTaskModalOpen(true))

  const pageSurfaceMenu = useContextMenuTrigger(() =>
    buildPageSurfaceMenu({
      title: 'Checklist',
      pageUrl: ROUTES.CHECKLIST,
      onReloadData: loadChecklistData,
      onRefresh: () => window.location.reload(),
    }),
  )

  return (
    <div style={{ padding: 24 }} {...pageSurfaceMenu}>
      <Title level={4} className="page-main-heading">
        <CheckSquareOutlined style={{ marginRight: 8 }} />
        Checklist
      </Title>

      {/* Add Task button only - form opens in modal */}
      <div style={{ marginBottom: 24 }}>
        <ContextMenuTarget openHref={checklistCreateHref} openLabel="Add Task">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddTaskModalOpen(true)}>
            Add Task
          </Button>
        </ContextMenuTarget>
      </div>

      {/* Upload Holiday List - from Dec 15 for next year (Admin only) */}
      {isAdmin && canUploadHolidays && (
        <Card style={{ marginBottom: 24 }}>
          <Button
            icon={<UploadOutlined />}
            onClick={() => setHolidayModalOpen(true)}
          >
            Upload Holiday List
          </Button>
          <Text type="secondary" style={{ marginLeft: 12 }}>
            Available from Dec 15th. Upload holidays for next year.
          </Text>
        </Card>
      )}

      {/* User filter for Admin / Master Admin */}
      {isAdmin && users.length > 0 && (
        <Card style={{ marginBottom: 24 }}>
          <Space>
            <Text>Filter by User:</Text>
            <AntSelect
              placeholder="All users"
              allowClear
              style={{ width: 220 }}
              value={selectedUserId || undefined}
              onChange={setSelectedUserId}
              options={[
                { label: 'All Users', value: undefined },
                ...users.map((u) => ({ label: u.full_name, value: u.id })),
              ]}
            />
          </Space>
        </Card>
      )}

      {/* Task List with filter dropdown */}
      <Card
        title="Task List"
        extra={
          <Space wrap>
            <Text type="secondary">Reference No:</Text>
            <AntSelect
              value={referenceNoFilter}
              onChange={setReferenceNoFilter}
              style={{ width: 140 }}
              options={referenceNoOptions}
            />
            <Text type="secondary">Filter:</Text>
            <AntSelect
              value={filter}
              onChange={(v) => setFilter(v as FilterType)}
              style={{ width: 240 }}
              options={[
                { value: 'today', label: "Today's Tasks" },
                { value: 'completed', label: 'Completed' },
                { value: 'overdue', label: 'Not Completed (Date Crossed)' },
                { value: 'upcoming', label: 'Upcoming' },
              ]}
            />
          </Space>
        }
      >
        <TableWithSkeletonLoading loading={loading} columns={7} rows={12}>
          <div ref={checklistTableContainerRef}>
            <Table
              dataSource={visibleOccurrences}
              columns={columns}
              rowKey={(r) => `${r.task_id}-${r.occurrence_date}`}
              loading={false}
              pagination={false}
              onRow={(record) => ({
                onContextMenu: (e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const canComplete = !record.completed_at && record.doer_id === user?.id && isToday(record.occurrence_date)
                  openMenu({
                    x: e.clientX,
                    y: e.clientY,
                    ariaLabel: `Checklist: ${record.task_name || 'task'}`,
                    items: buildChecklistRowMenu({
                      taskUrl: `${ROUTES.CHECKLIST}?task=${record.task_id}`,
                      canComplete,
                      onOpen: () => message.info(record.task_name || 'Task'),
                      onComplete: () => handleComplete(record.task_id, record.occurrence_date),
                      onReload: loadChecklistData,
                    }),
                  })
                },
              })}
              summary={() => (
                <Table.Summary>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={columns.length}>
                      <div ref={checklistTableSentinelRef} style={{ height: 8, minHeight: 8 }} aria-hidden />
                      <Text type="secondary">
                        Showing {visibleOccurrenceCount} of {totalOccurrences} rows{occurrencesHasMore ? ' · scroll to load more' : ''}
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

      {/* Add Task Modal */}
      <Modal
        title="Add Task"
        open={addTaskModalOpen}
        onCancel={() => { setAddTaskModalOpen(false); form.resetFields() }}
        footer={null}
        width={480}
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item
            name="task_name"
            label="Name of Task"
            rules={[{ required: true, message: 'Enter task name' }]}
          >
            <Input placeholder="Task name" />
          </Form.Item>
          <Form.Item label="Doer Name">
            <Input disabled value={user?.full_name || ''} placeholder="Auto from logged-in user" />
          </Form.Item>
          <Form.Item
            name="department"
            label="Department"
            rules={[{ required: true }]}
          >
            <Select
              placeholder="Select department"
              options={departments.map((d) => ({ label: d, value: d }))}
            />
          </Form.Item>
          <Form.Item
            name="frequency"
            label="Frequency"
            rules={[{ required: true }]}
          >
            <Select
              placeholder="Select frequency (D, 2D, W, 2W, M, Q, F, Y)"
              options={FREQUENCY_OPTIONS.map((o) => ({ label: o.label, value: o.value }))}
            />
          </Form.Item>
          <Form.Item
            name="start_date"
            label="Day & Date (First date when task will occur)"
            rules={[{ required: true }]}
          >
            <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={loading}>
                Add Task
              </Button>
              <Button onClick={() => { setAddTaskModalOpen(false); form.resetFields() }}>
                Cancel
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Upload Holiday List"
        open={holidayModalOpen}
        onCancel={() => setHolidayModalOpen(false)}
        footer={null}
        width={520}
      >
        <HolidayUploadForm
          nextYear={today.getFullYear() + 1}
          onSuccess={() => {
            setHolidayModalOpen(false)
            message.success('Holiday list uploaded')
          }}
          onCancel={() => setHolidayModalOpen(false)}
          loading={holidayUploadLoading}
          setLoading={setHolidayUploadLoading}
        />
      </Modal>
    </div>
  )
}

function HolidayUploadForm({
  nextYear,
  onSuccess,
  onCancel,
  loading,
  setLoading,
}: {
  nextYear: number
  onSuccess: () => void
  onCancel: () => void
  loading: boolean
  setLoading: (v: boolean) => void
}) {
  const [year, setYear] = useState(nextYear)
  const [text, setText] = useState('')
  const handleSubmit = () => {
    const lines = text.split('\n').filter((s) => s.trim())
    const holidays = lines
      .map((line) => {
        const idx = line.indexOf(',')
        if (idx < 0) return null
        const dateStr = line.slice(0, idx).trim()
        const name = line.slice(idx + 1).trim()
        if (!dateStr || !name) return null
        return { holiday_date: dateStr, holiday_name: name }
      })
      .filter((h): h is { holiday_date: string; holiday_name: string } => h !== null)
    if (holidays.length === 0) {
      message.error('Enter holidays as: YYYY-MM-DD, Holiday Name (one per line)')
      return
    }
    setLoading(true)
    checklistApi
      .uploadHolidays(year, holidays)
      .then(onSuccess)
      .catch((e: any) => message.error(e.response?.data?.detail || 'Upload failed'))
      .finally(() => setLoading(false))
  }
  return (
    <div>
      <Space direction="vertical" style={{ width: '100%' }}>
        <div>
          <Text>Year:</Text>
          <Input
            type="number"
            value={year}
            onChange={(e) => setYear(parseInt(e.target.value) || nextYear)}
            style={{ width: 100, marginLeft: 8 }}
          />
        </div>
        <div>
          <Text>Holidays (one per line: YYYY-MM-DD, Holiday Name)</Text>
          <Input.TextArea
            rows={10}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"2027-01-01, New Year's Day\n2027-01-26, Republic Day"}
            style={{ marginTop: 8 }}
          />
        </div>
        <Space>
          <Button type="primary" onClick={handleSubmit} loading={loading}>
            Upload
          </Button>
          <Button onClick={onCancel}>Cancel</Button>
        </Space>
      </Space>
    </div>
  )
}
