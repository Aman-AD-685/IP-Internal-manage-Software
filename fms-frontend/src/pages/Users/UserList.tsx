import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Table,
  Card,
  Typography,
  Tag,
  Input,
  Space,
  Dropdown,
  Button,
  Modal,
  Form,
  Select,
  Switch,
  Checkbox,
  message,
} from 'antd'
import { SearchOutlined, MoreOutlined, EditOutlined, StopOutlined } from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { usersApi } from '../../api/users'
import { authApi } from '../../api/auth'
import { dashboardKpiApi } from '../../api/dashboardKpi'
import { permissionsApi, type PermissionCatalogRow } from '../../api/permissions'
import type { User } from '../../types/auth'
import type { SectionPermission, RoleOption } from '../../api/users'
import { PrintExport } from '../../components/common/PrintExport'
import { TableWithSkeletonLoading } from '../../components/common/skeletons'
import { formatDate, normalizeUserSectionPermissions } from '../../utils/helpers'
import { useRole } from '../../hooks/useRole'
import { useAuth } from '../../hooks/useAuth'
import { sessionApiCacheClearLogicalPrefix } from '../../utils/sessionApiCache'
import { ROLE_DISPLAY_NAMES, SECTION_LABELS, PERMISSION_SECTION_KEYS } from '../../utils/constants'

const { Title } = Typography
const USERS_CHUNK = 15

export const UserList = () => {
  const { isMasterAdmin } = useRole()
  const { refreshUser } = useAuth()
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [users, setUsers] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState('')
  const listFetchGeneration = useRef(0)
  const listPageRef = useRef(0)
  const listExhaustedRef = useRef(false)
  const usersRef = useRef<User[]>([])
  const totalRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const tableContainerRef = useRef<HTMLDivElement>(null)
  const tableSentinelRef = useRef<HTMLDivElement>(null)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [deactivateModalOpen, setDeactivateModalOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [roles, setRoles] = useState<RoleOption[]>([])
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const isKpiPermissionRow = (key: string) =>
    key === 'dashboard_kpi' || key.startsWith('dashboard_kpi_person_')

  const [permissionRows, setPermissionRows] = useState<PermissionCatalogRow[]>(() =>
    PERMISSION_SECTION_KEYS.map((key) => ({
      key,
      label: SECTION_LABELS[key] || key,
      group: isKpiPermissionRow(key) ? 'dashboard_kpi' : 'app',
    })),
  )

  const permissionSectionKeys = permissionRows.map((r) => r.key)

  const refreshKpiVisibilityCaches = useCallback(async () => {
    sessionApiCacheClearLogicalPrefix('checklist:users')
    dashboardKpiApi.clearActivePersonsCache()
    const me = await authApi.getCurrentUser()
    if (me.data) refreshUser(normalizeUserSectionPermissions(me.data))
  }, [refreshUser])

  useEffect(() => {
    if (!isMasterAdmin) return
    let cancelled = false
    void permissionsApi
      .getSectionCatalog()
      .then((catalog) => {
        if (cancelled || !catalog.rows?.length) return
        setPermissionRows(
          catalog.rows.filter(
            (r) => r.group !== 'dashboard_kpi' || isKpiPermissionRow(r.key),
          ),
        )
      })
      .catch((e) => console.error('Failed to load permission catalog', e))
    return () => {
      cancelled = true
    }
  }, [isMasterAdmin])

  useEffect(() => {
    usersRef.current = users
  }, [users])
  useEffect(() => {
    totalRef.current = total
  }, [total])

  const fetchUsers = useCallback(async () => {
    const gen = ++listFetchGeneration.current
    listPageRef.current = 0
    listExhaustedRef.current = false
    setLoading(true)
    setUsers([])
    try {
      const response = await usersApi.list({
        page: 1,
        limit: USERS_CHUNK,
        ...(search && { search }),
      })
      if (gen !== listFetchGeneration.current) return
      // Backend returns { data: User[], total: number, page, limit } directly
      if (response && Array.isArray(response.data)) {
        setUsers(response.data)
        setTotal(typeof response.total === 'number' ? response.total : response.data.length)
        listPageRef.current = 1
      } else {
        setUsers([])
        setTotal(0)
        listExhaustedRef.current = true
      }
    } catch (error: any) {
      console.error('Failed to fetch users:', error)
      const status = error?.response?.status
      const detail = error?.response?.data?.detail
      if (status === 403 || (typeof detail === 'string' && detail.toLowerCase().includes('permission'))) {
        message.warning('Only Admin or Master Admin can view the user list.')
      } else {
        const msg = typeof detail === 'string' ? detail : 'Failed to load users. Check that you are Admin or Master Admin.'
        message.error(msg)
      }
    } finally {
      if (gen === listFetchGeneration.current) setLoading(false)
    }
  }, [search])

  const fetchUsersMore = useCallback(async () => {
    if (loadingMoreRef.current || listExhaustedRef.current || loading) return
    if (totalRef.current > 0 && usersRef.current.length >= totalRef.current) return
    const nextPage = listPageRef.current + 1
    if (nextPage < 2) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const response = await usersApi.list({
        page: nextPage,
        limit: USERS_CHUNK,
        ...(search && { search }),
      })
      const newRows = Array.isArray(response?.data) ? response.data : []
      if (newRows.length === 0) {
        listExhaustedRef.current = true
        return
      }
      setUsers((prev) => [...prev, ...newRows])
      listPageRef.current = nextPage
    } catch (error) {
      console.error('Failed to fetch more users:', error)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [search, loading])

  useEffect(() => {
    void fetchUsers()
  }, [fetchUsers])

  useEffect(() => {
    if (loading) return
    const root = tableContainerRef.current?.querySelector('.ant-table-body') as HTMLElement | null
    const target = tableSentinelRef.current
    if (!target) return
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return
        void fetchUsersMore()
      },
      { root: root ?? null, rootMargin: '160px', threshold: 0 },
    )
    io.observe(target)
    return () => io.disconnect()
  }, [loading, fetchUsersMore, users.length, total])

  const openEditModal = async (user: User) => {
    setSelectedUser(user)
    setEditModalOpen(true)
    const userWithExtra = user as User & { display_name?: string; role_id?: string }
    form.resetFields()
    form.setFieldsValue({
      full_name: user.full_name,
      display_name: userWithExtra.display_name ?? user.full_name,
      is_active: user.is_active,
      role_id: userWithExtra.role_id,
    })
    try {
      const [rolesData, perms, catalog] = await Promise.all([
        usersApi.listRoles(),
        usersApi.getSectionPermissions(user.id),
        permissionsApi.getSectionCatalog().catch(() => null),
      ])
      if (rolesData.length) setRoles(rolesData)
      const keys =
        catalog?.section_keys?.length ? catalog.section_keys : permissionSectionKeys
      if (catalog?.rows?.length) {
        setPermissionRows(
          catalog.rows.filter(
            (r) => r.group !== 'dashboard_kpi' || isKpiPermissionRow(r.key),
          ),
        )
      }
      const permissionsInitial = keys.map((key) => {
        const p = perms.find((x: SectionPermission) => x.section_key === key)
        return {
          section_key: key,
          can_view: p?.can_view === true,
          can_edit: p?.can_edit === true,
        }
      })
      form.setFieldsValue({
        full_name: user.full_name,
        display_name: userWithExtra.display_name ?? user.full_name,
        is_active: user.is_active,
        role_id: userWithExtra.role_id,
        permissions: permissionsInitial,
      })
    } catch (e) {
      console.error(e)
      if (roles.length === 0) {
        const rolesRes = await usersApi.listRoles()
        const rolesData = (rolesRes?.data as { data?: RoleOption[] } | undefined)?.data
        if (rolesData) setRoles(rolesData)
      }
      form.setFieldsValue({
        permissions: permissionSectionKeys.map((key) => ({
          section_key: key,
          can_view: false,
          can_edit: false,
        })),
      })
    }
  }

  const openDeactivateModal = (user: User) => {
    setSelectedUser(user)
    setDeactivateModalOpen(true)
  }

  const handleEditSave = async () => {
    if (!selectedUser) return
    try {
      await form.validateFields()
      setSaving(true)
      const { full_name, display_name, role_id, is_active, permissions } = form.getFieldsValue()
      await usersApi.update(selectedUser.id, {
        full_name: full_name ?? selectedUser.full_name,
        display_name: display_name ?? (selectedUser as User & { display_name?: string }).display_name,
        ...(role_id && { role_id }),
        is_active: is_active ?? selectedUser.is_active,
      })
      if (isMasterAdmin) {
        const rows = Array.isArray(permissions) ? permissions : []
        const keys = permissionRows.map((r) => r.key)
        const normalized = keys.map((key, idx) => {
          const row = rows.find((r: SectionPermission) => r?.section_key === key) ?? rows[idx]
          return {
            section_key: key,
            can_view: Boolean(row?.can_view),
            can_edit: Boolean(row?.can_edit),
          }
        })
        await usersApi.updateSectionPermissions(selectedUser.id, normalized)
      }
      message.success('User updated')
      setEditModalOpen(false)
      setSelectedUser(null)
      fetchUsers()
      void refreshKpiVisibilityCaches()
    } catch (e) {
      message.error((e as Error).message || 'Failed to update user')
    } finally {
      setSaving(false)
    }
  }

  const handleDeactivate = async () => {
    if (!selectedUser) return
    try {
      setSaving(true)
      await usersApi.update(selectedUser.id, { is_active: false })
      message.success('User deactivated')
      setDeactivateModalOpen(false)
      setSelectedUser(null)
      fetchUsers()
      void refreshKpiVisibilityCaches()
    } catch (e) {
      message.error((e as Error).message || 'Failed to deactivate user')
    } finally {
      setSaving(false)
    }
  }

  const getRoleColor = (role: string) => {
    const colors: Record<string, string> = {
      user: 'blue',
      admin: 'orange',
      master_admin: 'red',
      approver: 'purple',
    }
    return colors[role] || 'default'
  }

  const getRoleDisplayName = (role: string) => ROLE_DISPLAY_NAMES[role] || role

  const actionMenuItems = (user: User): MenuProps['items'] => {
    if (!isMasterAdmin) return []
    return [
      {
        key: 'edit',
        icon: <EditOutlined />,
        label: 'Edit',
        onClick: () => openEditModal(user),
      },
      {
        key: 'deactivate',
        icon: <StopOutlined />,
        label: 'Deactivate User',
        onClick: () => openDeactivateModal(user),
        disabled: !user.is_active,
      },
    ]
  }

  const columns = [
    {
      title: 'Name',
      dataIndex: 'full_name',
      key: 'full_name',
    },
    {
      title: 'Email',
      dataIndex: 'email',
      key: 'email',
    },
    {
      title: 'User ID name',
      dataIndex: 'display_name',
      key: 'display_name',
      render: (_: unknown, record: User & { display_name?: string }) =>
        record.display_name || record.full_name || '-',
    },
    {
      title: 'Role',
      dataIndex: 'role',
      key: 'role',
      render: (role: string) => (
        <Tag color={getRoleColor(role)}>{getRoleDisplayName(role)}</Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'red'}>
          {active ? 'Active' : 'Inactive'}
        </Tag>
      ),
    },
    {
      title: 'Created',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (date: string) => formatDate(date),
    },
    ...(isMasterAdmin
      ? [
          {
            title: '',
            key: 'actions',
            width: 56,
            render: (_: unknown, record: User) => (
              <Dropdown
                menu={{ items: actionMenuItems(record) }}
                trigger={['click']}
                placement="bottomRight"
              >
                <Button type="text" size="small" icon={<MoreOutlined />} />
              </Dropdown>
            ),
          },
        ]
      : []),
  ]

  const exportColumns = [
    { key: 'id', label: 'User ID' },
    { key: 'full_name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'display_name', label: 'User ID name' },
    { key: 'role', label: 'Role' },
    { key: 'is_active', label: 'Active' },
    { key: 'created_at', label: 'Created' },
  ]
  const exportRows = users.map((u) => ({
    id: u.id,
    full_name: u.full_name,
    email: u.email,
    display_name: (u as User & { display_name?: string }).display_name ?? u.full_name ?? '-',
    role: u.role ?? '-',
    is_active: u.is_active ? 'Yes' : 'No',
    created_at: u.created_at ? formatDate(u.created_at) : '-',
  }))

  return (
    <div>
      <div className="page-toolbar-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'nowrap', gap: 6, marginBottom: 8 }}>
        <Title level={2} className="page-main-heading" style={{ margin: 0, fontSize: 15 }}>Users</Title>
        <PrintExport pageTitle="Users" exportData={{ columns: exportColumns, rows: exportRows }} exportFilename="users" />
      </div>
      <Card>
        <Space style={{ marginBottom: 16 }}>
          <Input
            placeholder="Search users..."
            prefix={<SearchOutlined />}
            style={{ width: 250 }}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            allowClear
          />
        </Space>

        <TableWithSkeletonLoading loading={loading} columns={6} rows={12}>
          <div ref={tableContainerRef}>
            <Table
              columns={columns}
              dataSource={users}
              rowKey="id"
              loading={false}
              pagination={false}
              summary={() => (
                <Table.Summary>
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={columns.length}>
                      <div ref={tableSentinelRef} style={{ height: 8, minHeight: 8 }} aria-hidden />
                      <Typography.Text type="secondary">
                        Showing {users.length} of {total} users{users.length < total ? ' · scroll to load more' : ''}
                      </Typography.Text>
                      {loadingMore ? <span style={{ marginLeft: 8 }}>Loading...</span> : null}
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                </Table.Summary>
              )}
            />
          </div>
        </TableWithSkeletonLoading>
      </Card>

      <Modal
        title="Edit User"
        open={editModalOpen}
        onCancel={() => { setEditModalOpen(false); setSelectedUser(null) }}
        onOk={handleEditSave}
        confirmLoading={saving}
        width={680}
        destroyOnClose
        styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
      >
        {selectedUser && (
          <Form form={form} layout="vertical">
            <Form.Item name="full_name" label="Full name" rules={[{ required: true }]}>
              <Input />
            </Form.Item>
            <Form.Item name="display_name" label="User ID name">
              <Input placeholder="Display name for listing" />
            </Form.Item>
            {isMasterAdmin && (
              <Form.Item name="role_id" label="Role">
                <Select
                  placeholder="Select role"
                  options={roles.map((r) => ({
                    value: r.id,
                    label: ROLE_DISPLAY_NAMES[r.name] || r.name,
                  }))}
                  allowClear
                />
              </Form.Item>
            )}
            <Form.Item name="is_active" label="Active" valuePropName="checked">
              <Switch />
            </Form.Item>
            {isMasterAdmin && (
              <>
                <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
                  Section permissions (View / Edit)
                </Typography.Text>
                {permissionRows.map((row, idx) => {
                  const isKpiSub = row.group === 'dashboard_kpi' && row.key !== 'dashboard_kpi'
                  const showKpiGroupTitle = row.key === 'dashboard_kpi'
                  return (
                    <div key={row.key}>
                      {showKpiGroupTitle && (
                        <Typography.Text
                          type="secondary"
                          style={{ display: 'block', marginTop: idx > 0 ? 12 : 0, marginBottom: 4 }}
                        >
                          Dashboard KPI — page and person dashboards
                        </Typography.Text>
                      )}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 16,
                          marginBottom: 8,
                          paddingLeft: isKpiSub ? 16 : 0,
                        }}
                      >
                        <span style={{ width: isKpiSub ? 248 : 264, flexShrink: 0 }}>
                          {row.label}
                        </span>
                        <Form.Item
                          name={['permissions', idx, 'can_view']}
                          valuePropName="checked"
                          noStyle
                        >
                          <Checkbox>View</Checkbox>
                        </Form.Item>
                        <Form.Item
                          name={['permissions', idx, 'can_edit']}
                          valuePropName="checked"
                          noStyle
                        >
                          <Checkbox>Edit</Checkbox>
                        </Form.Item>
                        <Form.Item name={['permissions', idx, 'section_key']} hidden initialValue={row.key}>
                          <Input type="hidden" />
                        </Form.Item>
                      </div>
                    </div>
                  )
                })}
              </>
            )}
          </Form>
        )}
      </Modal>

      <Modal
        title="Deactivate User"
        open={deactivateModalOpen}
        onCancel={() => { setDeactivateModalOpen(false); setSelectedUser(null) }}
        onOk={handleDeactivate}
        confirmLoading={saving}
        okText="Deactivate"
        okButtonProps={{ danger: true }}
      >
        {selectedUser && (
          <p>
            Deactivate user <strong>{selectedUser.full_name}</strong> ({selectedUser.email})? They
            will no longer be able to sign in.
          </p>
        )}
      </Modal>
    </div>
  )
}
