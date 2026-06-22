import { Button, Card, Col, Empty, Modal, Row, Space, Table, Typography } from 'antd'
import {
  BankOutlined,
  CustomerServiceOutlined,
  DatabaseOutlined,
  DollarOutlined,
  ReadOutlined,
  RiseOutlined,
  TeamOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { ReactNode, UIEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { dashboardApi } from '../../api/dashboard'
import type {
  DashboardOperationDetailRow,
  DashboardOperationDetailsResponse,
  DashboardOperations,
  DashboardPermissions,
  DashboardSupportDetailRow,
  DashboardSupportDetailsResponse,
  DashboardUserContext,
} from '../../types/dashboard'
import { usePermissions } from '../../hooks/usePermissions'
import { ROUTES } from '../../utils/constants'
import { OperationTile, type OperationMetric } from './OperationTile'

const { Text, Title } = Typography
const SUPPORT_DETAIL_BATCH_SIZE = 7

interface OperationsOverviewProps {
  operations: DashboardOperations
  user: DashboardUserContext
}

interface OperationConfig {
  key: keyof DashboardOperations
  permissionKey: keyof DashboardPermissions
  label: string
  color: string
  route: string
  icon: ReactNode
  metrics: (operations: DashboardOperations) => OperationMetric[]
}

const OPERATION_CONFIG: OperationConfig[] = [
  {
    key: 'support',
    permissionKey: 'support',
    label: 'Support',
    color: '#2563eb',
    route: ROUTES.TICKETS,
    icon: <CustomerServiceOutlined />,
    metrics: (ops) => [
      { label: 'Open Chores', value: ops.support?.openChores ?? 0 },
      { label: 'Pending Bug', value: ops.support?.openBugs ?? 0 },
      { label: 'Open Feature', value: ops.support?.openFeatures ?? 0 },
      { label: 'Response Delay', value: ops.support?.delayedResponse ?? 0 },
      { label: 'Completion Delay', value: ops.support?.delayedCompletion ?? 0 },
    ],
  },
  {
    key: 'success',
    permissionKey: 'success',
    label: 'Success',
    color: '#0d9488',
    route: ROUTES.SUCCESS_PERFORMANCE,
    icon: <RiseOutlined />,
    metrics: (ops) => [
      { label: 'Active', value: ops.success?.active ?? 0 },
      { label: 'Completed', value: ops.success?.completed ?? 0 },
      { label: 'Low Performance', value: ops.success?.lowPerformance ?? 0 },
    ],
  },
  {
    key: 'clientToLead',
    permissionKey: 'clientToLead',
    label: 'Client to Lead',
    color: '#db2777',
    route: ROUTES.LEADS,
    icon: <TeamOutlined />,
    metrics: (ops) => [
      { label: 'New', value: ops.clientToLead?.newLeads ?? 0 },
      { label: 'Follow-up', value: ops.clientToLead?.followUpDue ?? 0 },
      { label: 'Closed', value: ops.clientToLead?.closed ?? 0 },
    ],
  },
  {
    key: 'onboarding',
    permissionKey: 'onboarding',
    label: 'Onboarding',
    color: '#7c3aed',
    route: ROUTES.ONBOARDING_PAYMENT_STATUS,
    icon: <BankOutlined />,
    metrics: (ops) => [
      { label: 'Active', value: ops.onboarding?.active ?? 0 },
      { label: 'Stuck', value: ops.onboarding?.stuckStage ?? 0 },
      { label: 'Pending Setup', value: ops.onboarding?.pendingSetup ?? 0 },
    ],
  },
  {
    key: 'training',
    permissionKey: 'training',
    label: 'Training',
    color: '#d97706',
    route: ROUTES.TRAINING_CLIENT,
    icon: <ReadOutlined />,
    metrics: (ops) => [
      { label: 'Scheduled', value: ops.training?.scheduled ?? 0 },
      { label: 'Pending', value: ops.training?.pending ?? 0 },
      { label: 'Completed', value: ops.training?.completed ?? 0 },
    ],
  },
  {
    key: 'clientPayment',
    permissionKey: 'clientPayment',
    label: 'Client Payment',
    color: '#ea580c',
    route: ROUTES.CLIENT_PAYMENT,
    icon: <DollarOutlined />,
    metrics: (ops) => [
      { label: 'Pending', value: ops.clientPayment?.pending ?? 0 },
      { label: 'Ageing Risk', value: ops.clientPayment?.ageingRisk ?? 0 },
      { label: 'Completed', value: ops.clientPayment?.completedRegister ?? 0 },
    ],
  },
  {
    key: 'dbClient',
    permissionKey: 'dbClient',
    label: 'DB Client',
    color: '#b45309',
    route: ROUTES.DB_CLIENT_CLIENT_ONB,
    icon: <DatabaseOutlined />,
    metrics: (ops) => [
      { label: 'Active', value: ops.dbClient?.active ?? 0 },
      { label: 'Inactive', value: ops.dbClient?.inactive ?? 0 },
      { label: 'Missing Follow-up', value: ops.dbClient?.missingFollowUp ?? 0 },
    ],
  },
]

export function OperationsOverview({ operations, user }: OperationsOverviewProps) {
  const navigate = useNavigate()
  const { can } = usePermissions(user)
  const [supportOpen, setSupportOpen] = useState(false)
  const [supportLoading, setSupportLoading] = useState(false)
  const [supportDetails, setSupportDetails] = useState<DashboardSupportDetailsResponse | null>(null)
  const [operationDetails, setOperationDetails] = useState<DashboardOperationDetailsResponse | null>(null)
  const [operationModalOpen, setOperationModalOpen] = useState(false)
  const [operationLoading, setOperationLoading] = useState(false)
  const [activeSupportSection, setActiveSupportSection] = useState<keyof DashboardSupportDetailsResponse>('chores')
  const [supportVisibleRows, setSupportVisibleRows] = useState(SUPPORT_DETAIL_BATCH_SIZE)
  const [operationVisibleRows, setOperationVisibleRows] = useState(SUPPORT_DETAIL_BATCH_SIZE)
  const visible = OPERATION_CONFIG.filter((item) => can(item.permissionKey) && operations[item.key] != null)
  const prefetchedSectionsRef = useRef<Set<string>>(new Set())

  const openSupportDetails = () => {
    setOperationModalOpen(false)
    setOperationDetails(null)
    setActiveSupportSection('chores')
    setSupportVisibleRows(SUPPORT_DETAIL_BATCH_SIZE)
    setSupportOpen(true)
    setSupportLoading(true)
    dashboardApi
      .getSupportDetails()
      .then(setSupportDetails)
      .finally(() => setSupportLoading(false))
  }

  const openOperationDetails = (section: string) => {
    setSupportOpen(false)
    setSupportDetails(null)
    setOperationDetails(null)
    setOperationVisibleRows(SUPPORT_DETAIL_BATCH_SIZE)
    setOperationModalOpen(true)
    setOperationLoading(true)
    dashboardApi
      .getOperationDetails(section)
      .then(setOperationDetails)
      .finally(() => setOperationLoading(false))
  }

  useEffect(() => {
    setSupportVisibleRows(SUPPORT_DETAIL_BATCH_SIZE)
  }, [activeSupportSection, supportOpen])

  useEffect(() => {
    setOperationVisibleRows(SUPPORT_DETAIL_BATCH_SIZE)
  }, [operationDetails?.section, operationModalOpen])

  useEffect(() => {
    const hasSuccess = visible.some((item) => item.key === 'success')
    if (!hasSuccess || prefetchedSectionsRef.current.has('success')) return
    prefetchedSectionsRef.current.add('success')
    const timer = window.setTimeout(() => {
      dashboardApi.getOperationDetails('success').catch(() => {
        prefetchedSectionsRef.current.delete('success')
      })
    }, 100)
    return () => window.clearTimeout(timer)
  }, [visible])

  const supportColumns = [
    {
      title: 'Reference No',
      dataIndex: 'referenceNo',
      key: 'referenceNo',
      fixed: 'left' as const,
      width: 140,
      render: (value: string, row: DashboardSupportDetailRow | DashboardOperationDetailRow) => {
        const targetUrl = 'targetUrl' in row ? row.targetUrl : `/tickets/${row.id}`
        return <Typography.Link onClick={() => targetUrl && navigate(targetUrl)}>{value}</Typography.Link>
      },
    },
    { title: 'Title', dataIndex: 'title', key: 'title', width: 220 },
    { title: 'Type', dataIndex: 'type', key: 'type', width: 100 },
    { title: 'Company', dataIndex: 'company', key: 'company', width: 180 },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 140 },
    { title: 'Reason', dataIndex: 'reason', key: 'reason', width: 220 },
  ]

  const operationColumns = [
    {
      title: 'Reference No',
      dataIndex: 'referenceNo',
      key: 'referenceNo',
      fixed: 'left' as const,
      width: 140,
      render: (value: string, row: DashboardOperationDetailRow) => (
        <Typography.Link onClick={() => row.targetUrl && navigate(row.targetUrl)}>{value}</Typography.Link>
      ),
    },
    { title: 'Company', dataIndex: 'company', key: 'company', width: 220 },
    { title: 'Response', dataIndex: 'response', key: 'response', width: 150 },
    { title: 'Contact', dataIndex: 'contact', key: 'contact', width: 150 },
    {
      title: 'Total Completion %',
      dataIndex: 'totalCompletionPct',
      key: 'totalCompletionPct',
      width: 170,
      render: (value: number | null) => (value == null ? '—' : `${value}%`),
    },
    { title: 'Current Stage', dataIndex: 'currentStage', key: 'currentStage', width: 320 },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 140 },
  ]

  const detailSections: Array<{ key: keyof DashboardSupportDetailsResponse; title: string; buttonLabel: string }> = [
    { key: 'chores', title: 'Chores - Till date open', buttonLabel: 'Chores' },
    { key: 'bugs', title: 'Bug - Till date pending', buttonLabel: 'Bug' },
    { key: 'features', title: 'Feature - Till date open', buttonLabel: 'Feature' },
    { key: 'responseDelay', title: 'Response Delay - Previous week', buttonLabel: 'Response Delay' },
    { key: 'completionDelay', title: 'Completion Delay - Previous week', buttonLabel: 'Completion Delay' },
  ]
  const activeDetailSection = detailSections.find((section) => section.key === activeSupportSection) ?? detailSections[0]
  const activeRows = supportDetails?.[activeDetailSection.key] ?? []
  const operationRows = operationDetails?.rows ?? []
  const visibleSupportRows = activeRows.slice(0, supportVisibleRows)
  const visibleOperationRows = operationRows.slice(0, operationVisibleRows)
  const hasMoreSupportRows = supportVisibleRows < activeRows.length
  const hasMoreOperationRows = operationVisibleRows < operationRows.length

  const handleSupportScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (!hasMoreSupportRows) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) {
      setSupportVisibleRows((count) => Math.min(count + SUPPORT_DETAIL_BATCH_SIZE, activeRows.length))
    }
  }

  const handleOperationScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (!hasMoreOperationRows) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 60) {
      setOperationVisibleRows((count) => Math.min(count + SUPPORT_DETAIL_BATCH_SIZE, operationRows.length))
    }
  }

  return (
    <Card className="universal-dashboard-panel">
      <div className="universal-dashboard-section-heading">
        <div>
          <Text type="secondary">Operations Overview</Text>
          <Title level={4}>Accessible sections</Title>
        </div>
      </div>
      {visible.length === 0 ? (
        <Empty description="No operations sections are enabled for this user." />
      ) : (
        <Row gutter={[16, 16]}>
          {visible.map((item) => (
            <Col xs={24} md={12} xl={8} key={item.key}>
              <OperationTile
                title={item.label}
                accent={item.color}
                icon={item.icon}
                metrics={item.metrics(operations)}
                onClick={item.key === 'support' ? openSupportDetails : () => openOperationDetails(String(item.key))}
              />
            </Col>
          ))}
        </Row>
      )}
      <Modal
        title={
          <div className="support-details-modal-title">
            <span>Support Details</span>
            <Space wrap size={[8, 8]}>
              {detailSections.map((section) => (
                <Button
                  key={section.key}
                  size="small"
                  type={activeSupportSection === section.key ? 'primary' : 'default'}
                  onClick={() => setActiveSupportSection(section.key)}
                >
                  {section.buttonLabel}
                </Button>
              ))}
            </Space>
          </div>
        }
        open={supportOpen}
        onCancel={() => setSupportOpen(false)}
        footer={null}
        width={1100}
      >
        <Title level={5}>{activeDetailSection.title}</Title>
        <div className="support-details-infinite-scroll" onScroll={handleSupportScroll}>
          <Table<DashboardSupportDetailRow>
            rowKey="id"
            loading={supportLoading}
            size="small"
            columns={supportColumns}
            dataSource={visibleSupportRows}
            pagination={false}
            scroll={{ x: 1000 }}
            locale={{ emptyText: supportLoading ? 'Loading Support data...' : 'No Support data found' }}
          />
          {hasMoreSupportRows && (
            <Text type="secondary" className="support-details-load-hint">
              Scroll to load more ({visibleSupportRows.length}/{activeRows.length})
            </Text>
          )}
        </div>
      </Modal>
      <Modal
        title={operationDetails?.title || 'Preview'}
        open={operationModalOpen}
        onCancel={() => setOperationModalOpen(false)}
        footer={null}
        width={1100}
      >
        <div className="support-details-infinite-scroll" onScroll={handleOperationScroll}>
          <Table<DashboardOperationDetailRow>
            rowKey="id"
            loading={operationLoading}
            size="small"
            columns={operationColumns}
            dataSource={visibleOperationRows}
            pagination={false}
            scroll={{ x: 1300 }}
            locale={{ emptyText: operationLoading ? 'Loading preview data...' : 'No preview data found' }}
          />
          {hasMoreOperationRows && (
            <Text type="secondary" className="support-details-load-hint">
              Scroll to load more ({visibleOperationRows.length}/{operationRows.length})
            </Text>
          )}
        </div>
      </Modal>
    </Card>
  )
}
