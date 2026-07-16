import { ArrowDownOutlined, ArrowRightOutlined, ArrowUpOutlined } from '@ant-design/icons'
import { Space, Typography } from 'antd'
import {
  KPI_THRESHOLD_COLORS,
  kpiTrendFromSeries,
  type KpiTrendDirection,
} from '../../utils/kpiThresholds'

const { Text } = Typography

const ARROW: Record<KpiTrendDirection, typeof ArrowUpOutlined> = {
  up: ArrowUpOutlined,
  down: ArrowDownOutlined,
  flat: ArrowRightOutlined,
}

const COLOR: Record<KpiTrendDirection, string> = {
  up: KPI_THRESHOLD_COLORS.high,
  down: KPI_THRESHOLD_COLORS.low,
  flat: KPI_THRESHOLD_COLORS.neutral,
}

/** ↑ ↓ → vs previous week (from series). */
export function KpiTrendArrow({ series }: { series?: number[] | null }) {
  if (!series || series.length < 2) return null
  const { direction, delta } = kpiTrendFromSeries(series)
  const Icon = ARROW[direction]
  const color = COLOR[direction]
  const sign = delta > 0 ? '+' : ''
  return (
    <Space size={4} style={{ color, fontSize: 13 }}>
      <Icon />
      <Text style={{ color, fontSize: 12 }}>
        {sign}
        {delta} pts
      </Text>
    </Space>
  )
}
