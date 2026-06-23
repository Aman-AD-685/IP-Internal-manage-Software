import { Button, Card, Col, Progress, Row, Space, Statistic, Typography } from 'antd'
import { CheckSquareOutlined, FileDoneOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { DashboardMyWork } from '../../types/dashboard'
import { ROUTES } from '../../utils/constants'

const { Text, Title } = Typography

interface MyWorkProps {
  myWork: DashboardMyWork
}

export function MyWork({ myWork }: MyWorkProps) {
  const navigate = useNavigate()
  return (
    <Card className="universal-dashboard-panel">
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div>
          <Text type="secondary">My Work</Text>
          <Title level={4}>Checklist & Delegation</Title>
        </div>
        <Progress percent={myWork.completedPct} strokeColor="#0f766e" />
        <Row gutter={[12, 12]}>
          <Col xs={12}>
            <Statistic title="Today pending Checklist" value={myWork.checklistDueToday} />
          </Col>
          <Col xs={12}>
            <Statistic title="Today pending Delegation" value={myWork.assignedToMe} />
          </Col>
        </Row>
        <Space wrap>
          <Button icon={<CheckSquareOutlined />} onClick={() => navigate(ROUTES.CHECKLIST)}>
            Checklist
          </Button>
          <Button icon={<FileDoneOutlined />} onClick={() => navigate(ROUTES.DELEGATION)}>
            Delegation
          </Button>
        </Space>
      </Space>
    </Card>
  )
}
