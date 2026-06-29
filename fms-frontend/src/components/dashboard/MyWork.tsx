import { Button, Card, Col, Progress, Row, Space, Statistic, Typography } from 'antd'
import { CheckSquareOutlined, FileDoneOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { DashboardAttendanceLeaveUserSummary } from '../../api/dashboard'
import type { DashboardMyWork } from '../../types/dashboard'
import { ROUTES } from '../../utils/constants'

const { Text, Title } = Typography

interface MyWorkProps {
  myWork: DashboardMyWork
  selectedUser?: { id: string; full_name: string }
  attendanceSummary?: DashboardAttendanceLeaveUserSummary
  onOpenAttendanceSummary?: (kind: 'attendance' | 'leave') => void
}

export function MyWork({ myWork, selectedUser, attendanceSummary, onOpenAttendanceSummary }: MyWorkProps) {
  const navigate = useNavigate()
  const checklistHref = selectedUser?.id
    ? `${ROUTES.CHECKLIST}?userId=${encodeURIComponent(selectedUser.id)}`
    : ROUTES.CHECKLIST
  const delegationHref = selectedUser?.id
    ? `${ROUTES.DELEGATION}?assignee_id=${encodeURIComponent(selectedUser.id)}`
    : ROUTES.DELEGATION

  return (
    <Card className="universal-dashboard-panel universal-dashboard-work-panel">
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Text type="secondary">My Work</Text>
          <Title level={4}>
            Checklist & Delegation{selectedUser?.full_name ? ` - ${selectedUser.full_name}` : ''}
          </Title>
        </div>
        <Progress percent={myWork.completedPct} strokeColor="#7C5DB0" />
        <Row gutter={[12, 12]} className="universal-dashboard-work-stats">
          <Col xs={12}>
            <Statistic title="Today pending Checklist" value={myWork.checklistDueToday} />
          </Col>
          <Col xs={12}>
            <Statistic title="Today pending Delegation" value={myWork.assignedToMe} />
          </Col>
          <Col xs={12}>
            <button
              type="button"
              className="universal-dashboard-work-stat-button"
              onClick={() => onOpenAttendanceSummary?.('attendance')}
              disabled={!attendanceSummary}
            >
              <Statistic title="Attendance Present" value={attendanceSummary?.attendance.present ?? 0} />
              <Text type="secondary">Working {attendanceSummary?.attendance.workingDays ?? 0}</Text>
            </button>
          </Col>
          <Col xs={12}>
            <button
              type="button"
              className="universal-dashboard-work-stat-button"
              onClick={() => onOpenAttendanceSummary?.('leave')}
              disabled={!attendanceSummary}
            >
              <Statistic title="Absent" value={attendanceSummary?.attendance.absent ?? 0} />
              <Text type="secondary">Leave {attendanceSummary?.leave.days ?? 0}</Text>
            </button>
          </Col>
        </Row>
        <Space wrap>
          <Button type="primary" icon={<CheckSquareOutlined />} onClick={() => navigate(checklistHref)}>
            Checklist
          </Button>
          <Button icon={<FileDoneOutlined />} onClick={() => navigate(delegationHref)}>
            Delegation
          </Button>
        </Space>
      </Space>
    </Card>
  )
}
