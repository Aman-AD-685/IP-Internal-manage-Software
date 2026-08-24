import { useState, useEffect, useRef, useCallback, useMemo, type Key } from 'react'
import {
  Card,
  Typography,
  Form,
  Input,
  DatePicker,
  Button,
  Table,
  Tag,
  message,
  Select,
  Space,
  Modal,
  Upload,
  Popover,
} from 'antd'
import { PlusOutlined, CheckOutlined, CloseOutlined, EditOutlined, InboxOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAuth } from '../../hooks/useAuth'
import { useRole } from '../../hooks/useRole'
import { delegationApi, type DelegationTask } from '../../api/delegation'
import { uploadAttachment } from '../../api/upload'
import { PrintExport } from '../../components/common/PrintExport'
import { TableWithSkeletonLoading } from '../../components/common/skeletons'
import { SectionEmptyState } from '../../components/common/SectionEmptyState'
import { DEFAULT_INFINITE_CHUNK, useInfiniteScrollChunk } from '../../hooks/useInfiniteScrollChunk'
import { useContextMenu, buildDelegationRowMenu, useContextMenuTrigger, buildPageSurfaceMenu } from '../../contextMenu'
import { ContextMenuTarget } from '../../components/common/ContextMenuTarget'
import { OPEN_ACTION, buildOpenActionUrl } from '../../utils/openActions'
import { genericLogicalKey, sessionApiCacheGet } from '../../utils/sessionApiCache'
import { useDeepLinkAction } from '../../hooks/useDeepLinkAction'
import { useLocation } from 'react-router-dom'
import { ROUTES } from '../../utils/constants'
import { BulkActionBar } from '../../components/common/BulkActionBar'
import { getStatusTagColor } from '../../utils/statusColors'
import { AuthHoneypotField, useAuthFormOpenedMs, withAuthBotFields } from '../../components/auth/AuthBotFields'

const { Title, Text } = Typography
const { Dragger } = Upload
const { RangePicker } = DatePicker

export const DelegationPage = () => {
  const location = useLocation()
  const { openMenu } = useContextMenu()
  const { user } = useAuth()
  const { isAdmin, isApprover, isMasterAdmin } = useRole()
  const canManage = isAdmin || isApprover || isMasterAdmin
  const [form] = Form.useForm()
  const [editForm] = Form.useForm()
  const [tasks, setTasks] = useState<DelegationTask[]>([])
  const [users, setUsers] = useState<{ id: string; full_name: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const formOpenedMs = useAuthFormOpenedMs(modalOpen)
  const [statusFilter, setStatusFilter] = useState<string>('pending')
  const [userFilter, setUserFilter] = useState<string | undefined>(undefined)
  const [delegationOnRangeFilter, setDelegationOnRangeFilter] = useState<[dayjs.Dayjs | null, dayjs.Dayjs | null] | null>(null)
  const initialUserFilterSet = useRef(false)
  const loadGenRef = useRef(0)
  const [referenceNoFilter, setReferenceNoFilter] = useState<string>('__all__')
  const [completeModalTask, setCompleteModalTask] = useState<DelegationTask | null>(null)
  const [completeDocumentUrl, setCompleteDocumentUrl] = useState<string | null>(null)
  const [uploadingDoc, setUploadingDoc] = useState(false)
  const [editModalTask, setEditModalTask] = useState<DelegationTask | null>(null)
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])
  const [bulkLoading, setBulkLoading] = useState(false)

  // Default task filter to logged-in user (so first load shows "my tasks"); admins can change to another user or All
  useEffect(() => {
    if (canManage && user?.id && !initialUserFilterSet.current) {
      const assigneeFromUrl = new URLSearchParams(location.search).get('assignee_id')?.trim()
      setUserFilter(assigneeFromUrl || user.id)
      initialUserFilterSet.current = true
    }
  }, [canManage, location.search, user?.id])

  const mergeUsers = useCallback(
    (incoming: { id: string; full_name: string }[]) => {
      setUsers((prev) => {
        const map = new Map<string, string>()
        for (const u of prev) {
          if (u?.id) map.set(u.id, u.full_name || u.id)
        }
        for (const u of incoming) {
          if (!u?.id) continue
          const next = (u.full_name || '').trim()
          const prevName = map.get(u.id)
          const looksLikeId = !next || next === u.id || /^[0-9a-f-]{36}$/i.test(next)
          if (!looksLikeId) map.set(u.id, next)
          else if (!prevName) map.set(u.id, next || u.id)
        }
        if (user?.id) {
          map.set(user.id, user.full_name || user.email || map.get(user.id) || 'You')
        }
        return Array.from(map.entries())
          .map(([id, full_name]) => ({ id, full_name }))
          .sort((a, b) => a.full_name.localeCompare(b.full_name))
      })
    },
    [user?.id, user?.full_name, user?.email],
  )

  const loadUsers = useCallback(() => {
    delegationApi
      .getUsers()
      .then((usersRes) => {
        const loaded = usersRes.users || []
        if (loaded.length) mergeUsers(loaded)
        else if (user?.id) mergeUsers([{ id: user.id, full_name: user.full_name || user.email || 'You' }])
      })
      .catch(() => {
        if (user?.id) mergeUsers([{ id: user.id, full_name: user.full_name || user.email || 'You' }])
      })
  }, [mergeUsers, user?.id, user?.full_name, user?.email])

  const loadTasks = useCallback(() => {
    const params: { status?: string; assignee_id?: string } = {}
    params.status = statusFilter
    if (canManage) {
      if (userFilter === '__all__') params.assignee_id = '__all__'
      else if (userFilter) params.assignee_id = userFilter
    }
    const cacheKey = genericLogicalKey('delegation:tasks', params)
    const cached = sessionApiCacheGet<{ tasks: DelegationTask[] }>(cacheKey)
    if (cached?.tasks) {
      setTasks(cached.tasks)
      setLoading(false)
    } else {
      setLoading(true)
    }
    const gen = ++loadGenRef.current
    delegationApi
      .getTasks(params)
      .then((tasksRes) => {
        if (gen !== loadGenRef.current) return
        const next = tasksRes.tasks || []
        setTasks(next)
        // Keep filter names even if /delegation/users failed or lagged.
        mergeUsers(
          next.flatMap((t) => {
            const rows: { id: string; full_name: string }[] = []
            if (t.assignee_id) {
              rows.push({ id: t.assignee_id, full_name: t.assignee_name || t.assignee_id })
            }
            if (t.submitted_by) {
              rows.push({ id: t.submitted_by, full_name: t.submitted_by_name || t.submitted_by })
            }
            return rows
          }),
        )
      })
      .catch(() => {
        if (gen !== loadGenRef.current) return
        message.error('Failed to load delegation tasks')
      })
      .finally(() => {
        if (gen === loadGenRef.current) setLoading(false)
      })
  }, [statusFilter, userFilter, canManage, mergeUsers])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  useEffect(() => {
    if (!canManage || userFilter !== undefined) loadTasks()
  }, [loadTasks, canManage, userFilter])

  // Refetch when user returns to the tab (admin may have assigned meanwhile).
  // Debounce: focus + visibilitychange often fire together → one load, one toast.
  useEffect(() => {
    let timer: number | null = null
    const schedule = () => {
      if (timer != null) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        loadTasks()
        loadUsers()
      }, 400)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') schedule()
    }
    window.addEventListener('focus', schedule)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (timer != null) window.clearTimeout(timer)
      window.removeEventListener('focus', schedule)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [loadTasks, loadUsers])

  const userFilterOptions = useMemo(() => {
    const opts = [{ value: '__all__', label: 'All' }, ...users.map((u) => ({ value: u.id, label: u.full_name || u.id }))]
    // Selected UUID must always have a label (Ant Design otherwise shows raw id).
    if (userFilter && userFilter !== '__all__' && !opts.some((o) => o.value === userFilter)) {
      opts.push({
        value: userFilter,
        label: user?.id === userFilter ? user.full_name || user.email || 'You' : userFilter,
      })
    }
    return opts
  }, [users, userFilter, user?.id, user?.full_name, user?.email])

  const displayTasks = useMemo(() => {
    let rows = [...tasks]
    if (referenceNoFilter && referenceNoFilter !== '__all__') {
      rows = rows.filter((t) => t.reference_no === referenceNoFilter)
    }
    if (delegationOnRangeFilter?.[0] && delegationOnRangeFilter?.[1]) {
      const start = delegationOnRangeFilter[0].startOf('day')
      const end = delegationOnRangeFilter[1].endOf('day')
      rows = rows.filter((t) => {
        const d = t.delegation_on ? dayjs(t.delegation_on) : null
        return !!d?.isValid() && (d.isAfter(start) || d.isSame(start)) && (d.isBefore(end) || d.isSame(end))
      })
    }
    // Recently added first based on Delegation On date.
    rows.sort((a, b) => {
      const ta = a.delegation_on ? dayjs(a.delegation_on).valueOf() : 0
      const tb = b.delegation_on ? dayjs(b.delegation_on).valueOf() : 0
      return tb - ta
    })
    return rows
  }, [tasks, referenceNoFilter, delegationOnRangeFilter])

  const hasDelegationClientFilters =
    referenceNoFilter !== '__all__' || Boolean(delegationOnRangeFilter?.[0] && delegationOnRangeFilter?.[1])

  const clearDelegationClientFilters = useCallback(() => {
    setReferenceNoFilter('__all__')
    setDelegationOnRangeFilter(null)
  }, [])

  const delegationEmptyContent = useMemo(() => {
    if (loading) return undefined
    if (tasks.length > 0 && displayTasks.length === 0 && hasDelegationClientFilters) {
      return (
        <SectionEmptyState
          variant="no-filter-results"
          title="No delegation tasks match your reference or date filters."
          primaryAction={{ label: 'Clear filters', onClick: clearDelegationClientFilters }}
        />
      )
    }
    return (
      <SectionEmptyState
        variant="no-data"
        title={`No ${statusFilter} delegation tasks.`}
        description="Add a task or change the status filter above."
        primaryAction={{ label: 'Add Delegation Task', onClick: () => setModalOpen(true) }}
      />
    )
  }, [
    loading,
    tasks.length,
    displayTasks.length,
    hasDelegationClientFilters,
    clearDelegationClientFilters,
    statusFilter,
  ])

  const delegationExportData = useMemo(() => {
    const fmt = (d: string | undefined) => (d ? dayjs(d).format('DD/MM/YYYY') : '')
    const rows = displayTasks.map((t) => ({
      reference_no: t.reference_no || '',
      task_name: t.title || '',
      delegation_on: fmt(t.delegation_on),
      submission_date: fmt(t.submission_date),
      shifted: String(t.shift_count || 0),
      last_assigned_date: fmt(t.last_assigned_date || t.submission_date),
      document: t.has_document ? t.has_document.charAt(0).toUpperCase() + t.has_document.slice(1) : '',
      submitted_attachment: t.document_url || '',
      submitted_by: t.assignee_name || t.submitted_by_name || (t.assignee_id ? String(t.assignee_id).slice(0, 8) : ''),
      status: t.status || 'pending',
    }))
    return {
      columns: [
        { key: 'reference_no', label: 'Reference No' },
        { key: 'task_name', label: 'Task Name' },
        { key: 'delegation_on', label: 'Delegation On' },
        { key: 'submission_date', label: 'Submission Date' },
        { key: 'shifted', label: 'Shifted' },
        { key: 'last_assigned_date', label: 'Last Assigned Date' },
        { key: 'document', label: 'Document' },
        { key: 'submitted_attachment', label: 'Submitted Attachment' },
        { key: 'submitted_by', label: 'Submitted By' },
        { key: 'status', label: 'Status' },
      ],
      rows,
    }
  }, [displayTasks])

  const delegationExportFilename = useMemo(() => {
    const parts = ['delegation', statusFilter]
    if (referenceNoFilter && referenceNoFilter !== '__all__') parts.push(referenceNoFilter.replace(/[^a-zA-Z0-9_-]+/g, '_'))
    if (canManage && userFilter && userFilter !== '__all__') {
      const u = users.find((x) => x.id === userFilter)
      if (u?.full_name) parts.push(u.full_name.replace(/\s+/g, '_').slice(0, 40))
    }
    return parts.join('_')
  }, [statusFilter, referenceNoFilter, userFilter, canManage, users])

  const referenceNoOptions = [
    { value: '__all__', label: 'All' },
    ...Array.from(new Set(tasks.map((t) => t.reference_no).filter(Boolean)))
      .sort()
      .map((ref) => ({ value: ref!, label: ref! })),
  ]

  const onFinish = (values: {
    title: string
    delegation_on?: dayjs.Dayjs | null
    submission_date?: dayjs.Dayjs | null
    has_document?: 'yes' | 'no'
    submitted_by?: string
  }) => {
    if (!values.submission_date) {
      message.error('Please select submission date')
      return
    }
    const submitterId = values.submitted_by || user?.id
    if (!submitterId) {
      message.error('Unable to detect user. Please refresh and try again.')
      return
    }
    setLoading(true)
    const bot = withAuthBotFields(values as unknown as Record<string, unknown>, formOpenedMs)
    delegationApi
      .createTask({
        title: values.title,
        assignee_id: submitterId,
        due_date: values.submission_date.format('YYYY-MM-DD'),
        submission_date: values.submission_date.format('YYYY-MM-DD'),
        delegation_on: values.delegation_on?.format('YYYY-MM-DD'),
        has_document: values.has_document,
        submitted_by: submitterId,
        website: bot.website,
        form_opened_ms: bot.form_opened_ms,
      })
      .then(() => {
        message.success('Delegation task created')
        form.resetFields()
        setModalOpen(false)
        loadTasks()
      })
      .catch((e) => message.error(e?.response?.data?.detail || 'Failed to create'))
      .finally(() => setLoading(false))
  }

  const openCreateModal = useCallback(() => {
    form.resetFields()
    form.setFieldsValue({ submitted_by: user?.id })
    setModalOpen(true)
  }, [form, user?.id])

  const delegationCreateHref = buildOpenActionUrl(
    location.pathname,
    location.search,
    OPEN_ACTION.DELEGATION_CREATE,
  )

  useDeepLinkAction(OPEN_ACTION.DELEGATION_CREATE, openCreateModal)

  const canActOnTask = (task: DelegationTask) =>
    !!user?.id && (task.assignee_id === user.id || isAdmin)

  /** Bulk complete without per-row doc upload — only tasks that don't require a new upload. */
  const canBulkCompleteTask = (task: DelegationTask) =>
    canActOnTask(task) &&
    task.status !== 'completed' &&
    task.status !== 'cancelled' &&
    (task.has_document !== 'yes' || !!task.document_url)

  const canBulkCancelTask = (task: DelegationTask) =>
    canActOnTask(task) && task.status !== 'completed' && task.status !== 'cancelled'

  const selectedTasks = useMemo(() => {
    const keySet = new Set(selectedRowKeys.map(String))
    return displayTasks.filter((t) => keySet.has(t.id))
  }, [displayTasks, selectedRowKeys])

  const eligibleBulkComplete = useMemo(
    () => selectedTasks.filter(canBulkCompleteTask),
    [selectedTasks, user?.id, isAdmin],
  )
  const eligibleBulkCancel = useMemo(
    () => selectedTasks.filter(canBulkCancelTask),
    [selectedTasks, user?.id, isAdmin],
  )

  useEffect(() => {
    setSelectedRowKeys([])
  }, [statusFilter, userFilter, referenceNoFilter])

  const runBulkStatus = (status: 'completed' | 'cancelled', ids: string[]) => {
    if (ids.length === 0) {
      message.warning(status === 'completed' ? 'No selected tasks can be completed in bulk (doc may be required)' : 'No selected tasks can be cancelled')
      return
    }
    setBulkLoading(true)
    delegationApi
      .bulkUpdate(ids, status)
      .then((res) => {
        const nOk = res.ok?.length ?? 0
        const nFail = res.failed?.length ?? 0
        if (nOk) message.success(`${status === 'completed' ? 'Completed' : 'Cancelled'} ${nOk}`)
        if (nFail) message.warning(`${nFail} failed`)
        setSelectedRowKeys([])
        loadTasks()
      })
      .catch((e) => message.error(e?.response?.data?.detail || 'Bulk update failed'))
      .finally(() => setBulkLoading(false))
  }

  const openCompleteModal = (task: DelegationTask) => {
    if (task.has_document === 'yes') {
      setCompleteModalTask(task)
      setCompleteDocumentUrl(null)
    } else {
      doComplete(task.id, undefined)
    }
  }

  const doComplete = (taskId: string, document_url?: string) => {
    setLoading(true)
    delegationApi
      .updateTask(taskId, { status: 'completed', ...(document_url && { document_url }) })
      .then(() => {
        message.success('Marked as completed')
        setCompleteModalTask(null)
        setCompleteDocumentUrl(null)
        loadTasks()
      })
      .catch((e) => message.error(e?.response?.data?.detail || 'Failed to update'))
      .finally(() => setLoading(false))
  }

  const handleCompleteWithDoc = () => {
    if (!completeModalTask) return
    if (!completeDocumentUrl) {
      message.error('Please upload the document before completing.')
      return
    }
    doComplete(completeModalTask.id, completeDocumentUrl)
  }

  const markCancel = (task: DelegationTask) => {
    delegationApi
      .updateTask(task.id, { status: 'cancelled' })
      .then(() => {
        message.success('Task cancelled')
        loadTasks()
      })
      .catch((e) => message.error(e?.response?.data?.detail || 'Failed to cancel'))
  }

  const openEditModal = (task: DelegationTask) => {
    setEditModalTask(task)
    editForm.setFieldsValue({
      title: task.title,
      delegation_on: task.delegation_on ? dayjs(task.delegation_on) : null,
      submission_date: task.submission_date ? dayjs(task.submission_date) : null,
      due_date: task.due_date ? dayjs(task.due_date) : null,
      has_document: task.has_document,
      submitted_by: task.submitted_by,
      assignee_id: task.assignee_id,
    })
  }

  const onEditFinish = (values: Record<string, unknown>) => {
    if (!editModalTask) return
    const payload: Record<string, string> = {}
    if (values.title != null) payload.title = String(values.title)
    const due = (values.due_date as dayjs.Dayjs)?.format('YYYY-MM-DD')
    if (due) payload.due_date = due
    const delOn = (values.delegation_on as dayjs.Dayjs)?.format('YYYY-MM-DD')
    if (delOn) payload.delegation_on = delOn
    const subDate = (values.submission_date as dayjs.Dayjs)?.format('YYYY-MM-DD')
    if (subDate) payload.submission_date = subDate
    if (values.has_document != null) payload.has_document = String(values.has_document)
    if (values.submitted_by != null) payload.submitted_by = String(values.submitted_by)
    if (values.assignee_id != null) payload.assignee_id = String(values.assignee_id)
    if (Object.keys(payload).length === 0) return
    setLoading(true)
    delegationApi
      .updateTask(editModalTask.id, payload)
      .then(() => {
        message.success('Task updated')
        setEditModalTask(null)
        loadTasks()
      })
      .catch((e) => message.error(e?.response?.data?.detail || 'Failed to update'))
      .finally(() => setLoading(false))
  }

  const columns = [
    { title: 'Reference No', dataIndex: 'reference_no', key: 'reference_no', render: (v: string) => v || '-' },
    { title: 'Task Name', dataIndex: 'title', key: 'title', render: (t: string) => t || '-' },
    {
      title: 'Delegation On',
      dataIndex: 'delegation_on',
      key: 'delegation_on',
      render: (d: string) => (d ? dayjs(d).format('DD/MM/YYYY') : '-'),
    },
    {
      title: 'Submission Date',
      dataIndex: 'submission_date',
      key: 'submission_date',
      render: (d: string) => (d ? dayjs(d).format('DD/MM/YYYY') : '-'),
    },
    {
      title: 'Shifted',
      dataIndex: 'shift_count',
      key: 'shift_count',
      width: 100,
      render: (_: unknown, r: DelegationTask) => {
        const count = Number(r.shift_count || 0)
        if (count <= 0) {
          return <Text type="secondary">0</Text>
        }
        const history = Array.isArray(r.shift_history) ? r.shift_history : []
        const lastAssigned =
          r.last_assigned_date ||
          r.submission_date ||
          (history.length ? history[history.length - 1]?.to : undefined)
        const content = (
          <div style={{ maxWidth: 280 }}>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              Shift dates ({count})
            </Text>
            {history.length === 0 ? (
              <Text type="secondary">No shift history stored.</Text>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 200, overflow: 'auto' }}>
                {history.map((h, i) => (
                  <li key={`${h.from}-${h.to}-${i}`}>
                    {dayjs(h.from).format('DD/MM/YYYY')} → {dayjs(h.to).format('DD/MM/YYYY')}
                    {h.shifted_on ? (
                      <Text type="secondary"> ({dayjs(h.shifted_on).format('DD/MM/YYYY')})</Text>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
              Last assigned date:{' '}
              <Text strong>{lastAssigned ? dayjs(lastAssigned).format('DD/MM/YYYY') : '—'}</Text>
            </Text>
          </div>
        )
        return (
          <Popover content={content} title="Shift history" trigger="hover">
            <Button type="link" size="small" style={{ padding: 0, fontWeight: 600 }}>
              {count}
            </Button>
          </Popover>
        )
      },
    },
    {
      title: 'Document',
      dataIndex: 'has_document',
      key: 'has_document',
      render: (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1) : '-'),
    },
    {
      title: 'Submitted Attachment',
      dataIndex: 'document_url',
      key: 'document_url',
      render: (url: string) => {
        if (!url) return '-'
        return (
          <a href={url} target="_blank" rel="noopener noreferrer">
            View document
          </a>
        )
      },
    },
    {
      title: 'Submitted By',
      dataIndex: 'assignee_name',
      key: 'submitted_by',
      render: (n: string, r: DelegationTask) => n || r.submitted_by_name || r.assignee_id?.slice(0, 8) || '-',
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (s: string) => <Tag color={getStatusTagColor(s)}>{s || 'pending'}</Tag>,
    },
    {
      title: 'Actual',
      dataIndex: 'completed_at',
      key: 'completed_at',
      render: (d: string) => (d ? dayjs(d).format('DD/MM/YYYY HH:mm') : '-'),
    },
    {
      title: 'Action',
      key: 'action',
      render: (_: unknown, r: DelegationTask) => {
        const canAct = canActOnTask(r)
        if (!canAct) return null
        if (r.status === 'completed') return null
        return (
          <Space size="small">
            <Button
              type="link"
              size="small"
              icon={<CheckOutlined />}
              onClick={() => openCompleteModal(r)}
            >
              Complete
            </Button>
            <Button type="link" size="small" danger icon={<CloseOutlined />} onClick={() => markCancel(r)}>
              Cancel
            </Button>
            {isMasterAdmin && (
              <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditModal(r)}>
                Edit
              </Button>
            )}
          </Space>
        )
      },
    },
  ]

  const handleRowContextMenu = useCallback(
    (record: DelegationTask, e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const canAct = canActOnTask(record)
      const taskUrl = `${ROUTES.DELEGATION}?task=${encodeURIComponent(record.id)}`
      openMenu({
        x: e.clientX,
        y: e.clientY,
        ariaLabel: `Actions for ${record.title || 'delegation task'}`,
        items: buildDelegationRowMenu({
          taskUrl,
          canAct,
          isMasterAdmin,
          onOpen: () => {
            if (isMasterAdmin) openEditModal(record)
            else message.info(record.title || 'Task')
          },
          onComplete: () => openCompleteModal(record),
          onEdit: () => openEditModal(record),
          onCancel: () => markCancel(record),
          onReload: loadTasks,
          onPrint: () => window.print(),
          onExport: () => {
            const line = [record.reference_no, record.title, record.status].filter(Boolean).join(' · ')
            void navigator.clipboard?.writeText(line)
            message.success('Task summary copied')
          },
        }),
      })
    },
    [openMenu, isMasterAdmin, loadTasks, canActOnTask],
  )

  const {
    visibleItems: visibleDisplayTasks,
    containerRef: delegationTableContainerRef,
    sentinelRef: delegationTableSentinelRef,
    total: totalDisplayTasks,
    visibleCount: visibleDisplayTaskCount,
    hasMore: displayTasksHasMore,
  } = useInfiniteScrollChunk({ items: displayTasks, chunkSize: DEFAULT_INFINITE_CHUNK, loading })

  const pageSurfaceMenu = useContextMenuTrigger(() =>
    buildPageSurfaceMenu({
      title: 'Delegation',
      pageUrl: ROUTES.DELEGATION,
      onReloadData: loadTasks,
      onRefresh: () => window.location.reload(),
    }),
  )

  return (
    <div style={{ padding: 24 }} {...pageSurfaceMenu}>
      <Card>
        <div className="page-toolbar-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', gap: 6, marginBottom: 8 }}>
          <Title level={4} className="page-main-heading" style={{ margin: 0, fontSize: 15 }}>
            Delegation
          </Title>
          <Space wrap={false} size={4}>
            <Select
              placeholder="Status"
              style={{ width: 130 }}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'pending', label: 'Pending' },
                { value: 'completed', label: 'Completed' },
                { value: 'all', label: 'All Tasks' },
              ]}
            />
            <Select
              placeholder="Reference No"
              style={{ width: 150 }}
              value={referenceNoFilter}
              onChange={setReferenceNoFilter}
              options={referenceNoOptions}
            />
            <RangePicker
              style={{ width: 240 }}
              value={delegationOnRangeFilter as [dayjs.Dayjs, dayjs.Dayjs] | null}
              onChange={(v) => setDelegationOnRangeFilter((v as [dayjs.Dayjs | null, dayjs.Dayjs | null]) ?? null)}
              allowClear
              format="DD/MM/YYYY"
            />
            {canManage && (
              <Select
                placeholder="Filter by user"
                showSearch
                optionFilterProp="label"
                style={{ width: 200 }}
                value={userFilter ?? '__all__'}
                onChange={(v) => setUserFilter(v == null || v === '' ? '__all__' : v)}
                options={userFilterOptions}
              />
            )}
            <ContextMenuTarget
              openHref={delegationCreateHref}
              openLabel="Add Task"
            >
              <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
                Add Task
              </Button>
            </ContextMenuTarget>
            <PrintExport
              pageTitle="Delegation"
              exportData={delegationExportData}
              exportFilename={delegationExportFilename}
            />
          </Space>
        </div>
        <TableWithSkeletonLoading loading={loading} columns={7} rows={12}>
          <BulkActionBar
            count={selectedRowKeys.length}
            onClear={() => setSelectedRowKeys([])}
            eligibilityHint={
              selectedRowKeys.length
                ? `${eligibleBulkComplete.length} completable · ${eligibleBulkCancel.length} cancellable`
                : undefined
            }
          >
            <Button
              type="primary"
              size="small"
              icon={<CheckOutlined />}
              loading={bulkLoading}
              disabled={eligibleBulkComplete.length === 0}
              onClick={() => runBulkStatus('completed', eligibleBulkComplete.map((t) => t.id))}
            >
              Mark Complete
            </Button>
            <Button
              danger
              size="small"
              icon={<CloseOutlined />}
              loading={bulkLoading}
              disabled={eligibleBulkCancel.length === 0}
              onClick={() => runBulkStatus('cancelled', eligibleBulkCancel.map((t) => t.id))}
            >
              Cancel Selected
            </Button>
          </BulkActionBar>
          <div ref={delegationTableContainerRef}>
            <Table
              dataSource={visibleDisplayTasks}
              columns={columns}
              rowKey="id"
              loading={false}
              pagination={false}
              locale={{ emptyText: delegationEmptyContent }}
              rowSelection={{
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys),
                getCheckboxProps: (r: DelegationTask) => ({
                  disabled: !canBulkCancelTask(r),
                }),
              }}
              onRow={(record) => ({
                onContextMenu: (e) => handleRowContextMenu(record, e),
              })}
              summary={() => (
                <Table.Summary>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={columns.length + 1}>
                      <div ref={delegationTableSentinelRef} style={{ height: 8, minHeight: 8 }} aria-hidden />
                      <Text type="secondary">
                        Showing {visibleDisplayTaskCount} of {totalDisplayTasks} rows{displayTasksHasMore ? ' · scroll to load more' : ''}
                      </Text>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
              style={{ marginTop: 16 }}
            />
          </div>
        </TableWithSkeletonLoading>
      </Card>

      <Modal
        title="Add Delegation Task"
        open={modalOpen}
        destroyOnClose
        onCancel={() => setModalOpen(false)}
        footer={null}
      >
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <AuthHoneypotField />
          <Form.Item name="title" label="Task Name" rules={[{ required: true, message: 'Please enter task name' }]}>
            <Input placeholder="Enter task name" />
          </Form.Item>
          <Form.Item name="delegation_on" label="Delegation On" rules={[{ required: true, message: 'Please select date' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="submission_date" label="Submission Date" rules={[{ required: true, message: 'Please select date' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="has_document" label="Document" rules={[{ required: true, message: 'Please select' }]}>
            <Select placeholder="Select Yes or No" options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
          </Form.Item>
          <Form.Item name="submitted_by" label="Submitted By" rules={[{ required: true, message: 'Please select who submitted' }]}>
            <Select
              placeholder="Select who submitted"
              options={users.map((u) => ({ value: u.id, label: u.full_name }))}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={loading}>
                Create
              </Button>
              <Button onClick={() => setModalOpen(false)}>Cancel</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="Upload document to complete"
        open={!!completeModalTask}
        onCancel={() => { setCompleteModalTask(null); setCompleteDocumentUrl(null) }}
        onOk={handleCompleteWithDoc}
        okText="Complete"
        okButtonProps={{ disabled: !completeDocumentUrl }}
      >
        <p>This task requires a document. Please upload it before completing.</p>
        <Dragger
          multiple={false}
          maxCount={1}
          showUploadList={{ showRemoveIcon: true }}
          disabled={uploadingDoc}
          accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.txt,.doc,.docx,.xls,.xlsx"
          beforeUpload={(file) => {
            const maxMb = 10
            if (file.size > maxMb * 1024 * 1024) {
              message.error(`File too large. Max size: ${maxMb} MB`)
              return false
            }
            setUploadingDoc(true)
            uploadAttachment(file)
              .then((res) => {
                setCompleteDocumentUrl(res.url)
                message.success(`${file.name} uploaded`)
              })
              .catch((e) => message.error(e?.response?.data?.detail || 'Upload failed'))
              .finally(() => setUploadingDoc(false))
            return false
          }}
          onRemove={() => setCompleteDocumentUrl(null)}
        >
          <p className="ant-upload-drag-icon">
            <InboxOutlined style={{ fontSize: 48, color: '#1890ff' }} />
          </p>
          <p className="ant-upload-text">Click or drag file to upload</p>
        </Dragger>
      </Modal>

      {isMasterAdmin && (
        <Modal
          title="Edit Task"
          open={!!editModalTask}
          destroyOnClose
          onCancel={() => setEditModalTask(null)}
          footer={null}
        >
          <Form form={editForm} layout="vertical" onFinish={onEditFinish}>
            <Form.Item name="title" label="Task Name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="delegation_on" label="Delegation On">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="submission_date" label="Submission Date">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="due_date" label="Due Date">
              <DatePicker style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="has_document" label="Document">
              <Select options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
            </Form.Item>
            <Form.Item name="submitted_by" label="Submitted By">
              <Select options={users.map((u) => ({ value: u.id, label: u.full_name }))} showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item name="assignee_id" label="Assignee">
              <Select options={users.map((u) => ({ value: u.id, label: u.full_name }))} showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" loading={loading}>Save</Button>
              <Button style={{ marginLeft: 8 }} onClick={() => setEditModalTask(null)}>Cancel</Button>
            </Form.Item>
          </Form>
        </Modal>
      )}
    </div>
  )
}
