import { Space } from 'antd'
import { lastNWeeks, kpiThresholdPillStyle } from '../../utils/kpiThresholds'
import { KpiSparkline } from './KpiSparkline'
import { KpiTrendArrow } from './KpiTrendArrow'

/** Trend arrow + sparkline + threshold pill under a KPI ring. */
export function KpiCardInsights({
  percent,
  weekSeries,
}: {
  percent?: number | null
  weekSeries?: number[] | null
}) {
  const series = lastNWeeks(weekSeries, 4)
  const pill = kpiThresholdPillStyle(percent)
  return (
    <Space direction="vertical" align="center" size={4} style={{ width: '100%' }}>
      <KpiTrendArrow series={series.length >= 2 ? series : weekSeries} />
      <KpiSparkline values={series} />
      <div className="kpi-performance-pill" style={{ background: pill.background, color: pill.color }}>
        {pill.label}
      </div>
    </Space>
  )
}
