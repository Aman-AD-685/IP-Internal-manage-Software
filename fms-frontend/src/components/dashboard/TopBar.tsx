import { Card, Space, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import type { DashboardUserContext } from '../../types/dashboard'

const { Text, Title } = Typography

interface TopBarProps {
  user: DashboardUserContext
}

const roleColor: Record<DashboardUserContext['role'], string> = {
  user: 'default',
  admin: 'blue',
  master_admin: 'gold',
}

export function TopBar({ user }: TopBarProps) {
  return (
    <Card className="universal-dashboard-topbar">
      <div className="universal-dashboard-topbar-content">
        <Space direction="vertical" size={2}>
          <Text type="secondary">{dayjs().format('dddd, DD MMM YYYY')}</Text>
          <Space wrap>
            <Title level={3}>Good day, {user.name}</Title>
            <Tag color={roleColor[user.role]}>{user.role.replace('_', ' ').toUpperCase()}</Tag>
          </Space>
          <Text type="secondary">Your dashboard shows only the data allowed by your role and permissions.</Text>
        </Space>
      </div>
    </Card>
  )
}
