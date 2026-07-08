import { Button, Card, Empty, Modal, Space, Table, Tag, Typography } from 'antd'
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
import type { ReactNode, UIEvent, WheelEvent } from 'react'
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
const UNIVERSAL_TILE_ACCENT = '#8B7FC9'
const UNIVERSAL_TILE_ACCENT_END = '#6B5DB0'
const UNIVERSAL_TILE_TINT = 'rgba(139, 127, 201, 0.12)'

const extraValue = (row: DashboardOperationDetailRow, key: string) => {
  const value = row.extra?.[key]
  return value == null || value === '' ? '—' : String(value)
}

const formatInrAmount = (value: number | undefined) => `₹${Number(value || 0).toLocaleString('en-IN')}`
const DASHBOARD_RETURN_TO = `${ROUTES.DASHBOARD}#accessible-sections`

const supportTicketUrl = (row: DashboardSupportDetailRow) => {
  const params = new URLSearchParams()
  const type = String(row.type || '').toLowerCase()
  if (type === 'feature') params.set('type', 'feature')
  else params.set('section', 'chores-bugs')
  params.set('open', row.id)
  if (type) params.set('ticketType', type)
  params.set('returnTo', DASHBOARD_RETURN_TO)
  return `${ROUTES.TICKETS}?${params.toString()}`
}

interface OperationsOverviewProps {
  operations: DashboardOperations
  user: DashboardUserContext
}

interface OperationConfig {
  key: keyof DashboardOperations
  permissionKey: keyof DashboardPermissions
  label: string
  color: string
  colorEnd: string
  tint: string
  route: string
  icon: ReactNode
  metrics: (operations: DashboardOperations) => OperationMetric[]
}

const OPERATION_CONFIG: OperationConfig[] = [
  {
    key: 'support',
    permissionKey: 'support',
    label: 'Support',
    color: UNIVERSAL_TILE_ACCENT,
    colorEnd: UNIVERSAL_TILE_ACCENT_END,
    tint: UNIVERSAL_TILE_TINT,
    route: ROUTES.TICKETS,
    icon: <CustomerServiceOutlined />,
    metrics: (ops) => [
      { label: 'Open Chores', value: ops.support?.openChores ?? 0 },
      { label: 'Pending Bug', value: ops.support?.openBugs ?? 0 },
      { label: 'Open Feature', value: ops.support?.openFeatures ?? 0 },
      { label: 'Pending Feature Approval', value: ops.support?.pendingFeatureApprovals ?? 0 },
      { label: 'Response Delay', value: ops.support?.delayedResponse ?? 0 },
      { label: 'Completion Delay', value: ops.support?.delayedCompletion ?? 0 },
    ],
  },
  {
    key: 'clientToLead',
    permissionKey: 'clientToLead',
    label: 'Client to Lead',
    color: UNIVERSAL_TILE_ACCENT,
    colorEnd: UNIVERSAL_TILE_ACCENT_END,
    tint: UNIVERSAL_TILE_TINT,
    route: ROUTES.LEADS,
    icon: <TeamOutlined />,
    metrics: (ops) => [
      { label: 'Open', value: ops.clientToLead?.newLeads ?? 0 },
      { label: 'Closed', value: ops.clientToLead?.closed ?? 0 },
      { label: 'Total', value: ops.clientToLead?.followUpDue ?? 0 },
    ],
  },
  {
    key: 'success',
    permissionKey: 'success',
    label: 'Success',
    color: UNIVERSAL_TILE_ACCENT,
    colorEnd: UNIVERSAL_TILE_ACCENT_END,
    tint: UNIVERSAL_TILE_TINT,
    route: ROUTES.SUCCESS_PERFORMANCE,
    icon: <RiseOutlined />,
    metrics: (ops) => [
      { label: 'Active', value: ops.success?.active ?? 0 },
      { label: 'Completed', value: ops.success?.completed ?? 0 },
      { label: 'Low Performance', value: ops.success?.lowPerformance ?? 0 },
    ],
  },
  {
    key: 'onboarding',
    permissionKey: 'onboarding',
    label: 'Onboarding',
    color: UNIVERSAL_TILE_ACCENT,
    colorEnd: UNIVERSAL_TILE_ACCENT_END,
    tint: UNIVERSAL_TILE_TINT,
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
    color: UNIVERSAL_TILE_ACCENT,
    colorEnd: UNIVERSAL_TILE_ACCENT_END,
    tint: UNIVERSAL_TILE_TINT,
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
    color: UNIVERSAL_TILE_ACCENT,
    colorEnd: UNIVERSAL_TILE_ACCENT_END,
    tint: UNIVERSAL_TILE_TINT,
    route: ROUTES.CLIENT_PAYMENT,
    icon: <DollarOutlined />,
    metrics: (ops) => [
      { label: 'Pending', value: ops.clientPayment?.pending ?? 0 },
      { label: 'Total Pending Amount', value: formatInrAmount(ops.clientPayment?.totalPendingAmount) },
      { label: 'Ageing Risk', value: ops.clientPayment?.ageingRisk ?? 0 },
      { label: 'Completed', value: ops.clientPayment?.completedRegister ?? 0 },
    ],
  },
  {
    key: 'dbClient',
    permissionKey: 'dbClient',
    label: 'DB Client',
    color: UNIVERSAL_TILE_ACCENT,
    colorEnd: UNIVERSAL_TILE_ACCENT_END,
    tint: UNIVERSAL_TILE_TINT,
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
        const targetUrl = 'targetUrl' in row
          ? row.targetUrl
          : supportTicketUrl(row)
        return <Typography.Link onClick={() => targetUrl && navigate(targetUrl)}>{value}</Typography.Link>
      },
    },
    { title: 'Title', dataIndex: 'title', key: 'title', width: 220 },
    { title: 'Type', dataIndex: 'type', key: 'type', width: 100 },
    { title: 'Company', dataIndex: 'company', key: 'company', width: 180 },
    { title: 'Current Stage', dataIndex: 'currentStage', key: 'currentStage', width: 150 },
    {
      title: 'Status',
      dataIndex: 'stageStatus',
      key: 'stageStatus',
      width: 140,
      render: (value: string) => {
        const displayStatus = (value || 'Pending').trim() || 'Pending'
        const status = displayStatus.toLowerCase()
        const statusColors: Record<string, string> = {
          pending: 'orange',
          completed: 'green',
          staging: 'blue',
          hold: 'default',
          na: 'default',
          rejected: 'red',
          unapproved: 'default',
        }
        return <Tag color={statusColors[status] ?? 'default'}>{displayStatus}</Tag>
      },
    },
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

  const clientToLeadColumns = [
    {
      title: 'Reference No',
      key: 'referenceNo',
      fixed: 'left' as const,
      width: 150,
      render: (_: unknown, row: DashboardOperationDetailRow) => (
        <Typography.Link onClick={() => row.targetUrl && navigate(row.targetUrl)}>
          {extraValue(row, 'clientTrainingRef')}
        </Typography.Link>
      ),
    },
    { title: 'Company', dataIndex: 'company', key: 'company', width: 260 },
    { title: 'Stage', dataIndex: 'currentStage', key: 'currentStage', width: 200 },
    { title: 'Assigned POC', dataIndex: 'contact', key: 'contact', width: 220 },
  ]

  const onboardingColumns = [
    {
      title: 'Reference',
      dataIndex: 'referenceNo',
      key: 'referenceNo',
      fixed: 'left' as const,
      width: 150,
      render: (value: string, row: DashboardOperationDetailRow) => (
        <Typography.Link onClick={() => row.targetUrl && navigate(row.targetUrl)}>{value}</Typography.Link>
      ),
    },
    { title: 'Company', dataIndex: 'company', key: 'company', width: 240 },
    { title: 'Payment Received Date', key: 'paymentReceivedDate', width: 190, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'paymentReceivedDate') },
    { title: 'POC', key: 'poc', width: 180, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'poc') },
    { title: 'POC Contact', key: 'pocContact', width: 160, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'pocContact') },
  ]

  const trainingColumns = [
    {
      title: 'Reference No',
      key: 'referenceNo',
      fixed: 'left' as const,
      width: 150,
      render: (_: unknown, row: DashboardOperationDetailRow) => (
        <Typography.Link onClick={() => row.targetUrl && navigate(row.targetUrl)}>
          {extraValue(row, 'clientTrainingRef')}
        </Typography.Link>
      ),
    },
    { title: 'Company Name', key: 'companyName', width: 220, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'companyName') },
    { title: 'Point of Contact', key: 'pointOfContact', width: 180, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'pointOfContact') },
    { title: 'Onb Ref', key: 'onbRef', width: 150, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'onbRef') },
    { title: 'Expected Day 0', key: 'expectedDay0', width: 180, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'expectedDay0') },
    { title: 'Trainer', key: 'trainer', width: 170, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'trainer') },
    { title: 'Training Feedback', key: 'trainingFeedback', width: 260, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'trainingFeedback') },
  ]

  const clientPaymentColumns = [
    {
      title: 'Reference',
      dataIndex: 'referenceNo',
      key: 'referenceNo',
      fixed: 'left' as const,
      width: 150,
      render: (value: string, row: DashboardOperationDetailRow) => (
        <Typography.Link onClick={() => row.targetUrl && navigate(row.targetUrl)}>{value}</Typography.Link>
      ),
    },
    { title: 'Company Name', dataIndex: 'company', key: 'company', width: 220 },
    { title: 'Invoice Date', key: 'invoiceDate', width: 160, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'invoiceDate') },
    { title: 'Invoice Amount', key: 'invoiceAmount', width: 160, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'invoiceAmount') },
    { title: 'Invoice Number', key: 'invoiceNumber', width: 170, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'invoiceNumber') },
    { title: 'Stage', key: 'stage', width: 160, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'stage') },
    { title: 'Aging (days)', key: 'agingDays', width: 140, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'agingDays') },
    { title: 'Genre', key: 'genre', width: 120, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'genre') },
  ]

  const dbClientColumns = [
    {
      title: 'Reference',
      dataIndex: 'referenceNo',
      key: 'referenceNo',
      fixed: 'left' as const,
      width: 150,
      render: (value: string, row: DashboardOperationDetailRow) => (
        <Typography.Link onClick={() => row.targetUrl && navigate(row.targetUrl)}>{value}</Typography.Link>
      ),
    },
    { title: 'Status', dataIndex: 'status', key: 'status', width: 120 },
    { title: 'Organization Name', key: 'organizationName', width: 220, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'organizationName') },
    { title: 'Company Name', dataIndex: 'company', key: 'company', width: 220 },
    { title: 'Contact Person', key: 'contactPerson', width: 180, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'contactPerson') },
    { title: 'Mobile No.', key: 'mobileNo', width: 150, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'mobileNo') },
    { title: 'Email ID', key: 'emailId', width: 220, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'emailId') },
    { title: 'Paid Divisions', key: 'paidDivisions', width: 160, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'paidDivisions') },
    { title: 'Division Abbreviation', key: 'divisionAbbreviation', width: 190, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'divisionAbbreviation') },
    { title: 'Name of Divisions & Cost Details', key: 'nameOfDivisionsCostDetails', width: 280, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'nameOfDivisionsCostDetails') },
    { title: 'Amount Paid / Division', key: 'amountPaidPerDivision', width: 200, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'amountPaidPerDivision') },
    { title: 'Total Amount Paid / Month', key: 'totalAmountPaidPerMonth', width: 230, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'totalAmountPaidPerMonth') },
    { title: 'Payment Frequency', key: 'paymentFrequency', width: 180, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'paymentFrequency') },
    { title: 'Client Since', key: 'clientSince', width: 150, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'clientSince') },
    { title: 'Client Till', key: 'clientTill', width: 150, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'clientTill') },
    { title: 'Client Duration', key: 'clientDuration', width: 170, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'clientDuration') },
    { title: 'Total Amount Paid Till Date', key: 'totalAmountPaidTillDate', width: 240, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'totalAmountPaidTillDate') },
    { title: 'TDS %', key: 'tdsPercent', width: 110, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'tdsPercent') },
    { title: 'City', key: 'city', width: 140, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'city') },
    { title: 'State', key: 'state', width: 140, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'state') },
    { title: 'Remarks', key: 'remarks', width: 220, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'remarks') },
    { title: 'WhatsApp Group', key: 'whatsappGroup', width: 180, render: (_: unknown, row: DashboardOperationDetailRow) => extraValue(row, 'whatsappGroup') },
  ]

  const detailSections: Array<{ key: keyof DashboardSupportDetailsResponse; title: string; buttonLabel: string }> = [
    { key: 'chores', title: 'Chores - Till date open', buttonLabel: 'Chores' },
    { key: 'bugs', title: 'Bug - Till date pending', buttonLabel: 'Bug' },
    { key: 'features', title: 'Feature - Till date open', buttonLabel: 'Feature' },
    { key: 'pendingFeatureApprovals', title: 'Pending Feature Approval', buttonLabel: 'Pending Feature Approval' },
    { key: 'responseDelay', title: 'Response Delay - Previous week', buttonLabel: 'Response Delay' },
    { key: 'completionDelay', title: 'Completion Delay - Previous week', buttonLabel: 'Completion Delay' },
  ]
  const activeDetailSection = detailSections.find((section) => section.key === activeSupportSection) ?? detailSections[0]
  const activeRows = supportDetails?.[activeDetailSection.key] ?? []
  const operationRows = operationDetails?.rows ?? []
  const operationColumnBySection = {
    clientToLead: clientToLeadColumns,
    onboarding: onboardingColumns,
    training: trainingColumns,
    clientPayment: clientPaymentColumns,
    dbClient: dbClientColumns,
  } as const
  const operationScrollBySection: Record<string, number> = {
    clientToLead: 830,
    onboarding: 920,
    training: 1310,
    clientPayment: 1280,
    dbClient: 4200,
  }
  const sectionKey = operationDetails?.section || ''
  const activeOperationColumns = operationColumnBySection[sectionKey as keyof typeof operationColumnBySection] || operationColumns
  const operationScrollX = operationScrollBySection[sectionKey] || 1300
  const visibleSupportRows = activeRows.slice(0, supportVisibleRows)
  const visibleOperationRows = operationRows.slice(0, operationVisibleRows)
  const hasMoreSupportRows = supportVisibleRows < activeRows.length
  const hasMoreOperationRows = operationVisibleRows < operationRows.length

  const loadMoreSupportRows = () => {
    setSupportVisibleRows((count) => Math.min(count + SUPPORT_DETAIL_BATCH_SIZE, activeRows.length))
  }

  const loadMoreOperationRows = () => {
    setOperationVisibleRows((count) => Math.min(count + SUPPORT_DETAIL_BATCH_SIZE, operationRows.length))
  }

  const shouldLoadMoreFromScroll = (el: HTMLDivElement) => {
    const isNearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 60
    const hasNoScrollableOverflow = el.scrollHeight <= el.clientHeight + 1
    return isNearBottom || hasNoScrollableOverflow
  }

  const handleSupportScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (!hasMoreSupportRows) return
    if (shouldLoadMoreFromScroll(el)) {
      loadMoreSupportRows()
    }
  }

  const handleOperationScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (!hasMoreOperationRows) return
    if (shouldLoadMoreFromScroll(el)) {
      loadMoreOperationRows()
    }
  }

  const handleSupportWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY > 0 && hasMoreSupportRows && shouldLoadMoreFromScroll(event.currentTarget)) {
      loadMoreSupportRows()
    }
  }

  const handleOperationWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (event.deltaY > 0 && hasMoreOperationRows && shouldLoadMoreFromScroll(event.currentTarget)) {
      loadMoreOperationRows()
    }
  }

  return (
    <Card id="accessible-sections" className="universal-dashboard-panel">
      {visible.length === 0 ? (
        <Empty description="No operations sections are enabled for this user." />
      ) : (
        <div className="universal-dashboard-operations-grid">
          {visible.map((item) => (
            <div key={item.key}>
              <OperationTile
                tileKey={String(item.key)}
                title={item.label}
                accent={item.color}
                accentEnd={item.colorEnd}
                tint={item.tint}
                icon={item.icon}
                metrics={item.metrics(operations)}
                onClick={item.key === 'support' ? openSupportDetails : () => openOperationDetails(String(item.key))}
              />
            </div>
          ))}
        </div>
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
        <div className="support-details-infinite-scroll" onScroll={handleSupportScroll} onWheel={handleSupportWheel}>
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
        <div className="support-details-infinite-scroll" onScroll={handleOperationScroll} onWheel={handleOperationWheel}>
          <Table<DashboardOperationDetailRow>
            rowKey="id"
            loading={operationLoading}
            size="small"
            columns={activeOperationColumns}
            dataSource={visibleOperationRows}
            pagination={false}
            scroll={{ x: operationScrollX }}
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
