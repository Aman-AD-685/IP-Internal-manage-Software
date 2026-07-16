import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts'
import { kpiThresholdColor } from '../../utils/kpiThresholds'

/** Tiny 4-week sparkline for KPI cards (no axes). */
export function KpiSparkline({
  values,
  color,
  height = 40,
}: {
  values?: number[] | null
  /** Override stroke; default = threshold colour of last point */
  color?: string
  height?: number
}) {
  if (!values?.length) return null
  const data = values.map((v, i) => ({ i, v }))
  const stroke = color || kpiThresholdColor(values[values.length - 1])
  return (
    <div style={{ width: '100%', maxWidth: 160, height, margin: '0 auto' }} aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
          <YAxis domain={[0, 100]} hide />
          <Line
            type="monotone"
            dataKey="v"
            stroke={stroke}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
