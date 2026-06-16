import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'

export type GraphModalKey = 'checklist' | 'delegation' | 'supportFMS' | 'successKpi'

export interface WeeklyProgressPayload {
  weeks?: string[]
  checklist?: number[]
  delegation?: number[]
  supportFMS?: number[]
  successKpi?: number[]
}

interface Props {
  graphModal: GraphModalKey
  weeklyProgress: WeeklyProgressPayload
}

/** Lazy-loaded so the main KPI page can render without synchronously importing recharts. */
export default function DashboardKPIWeeklyBarChart({ graphModal, weeklyProgress }: Props) {
  const weeks = weeklyProgress.weeks ?? []
  const data = weeks.map((weekName, i) => ({
    name: weekName,
    percentage:
      graphModal === 'checklist'
        ? (weeklyProgress.checklist?.[i] ?? 0)
        : graphModal === 'delegation'
          ? (weeklyProgress.delegation?.[i] ?? 0)
          : graphModal === 'supportFMS'
            ? (weeklyProgress.supportFMS?.[i] ?? 0)
            : (weeklyProgress.successKpi?.[i] ?? 0),
  }))

  return (
    <div style={{ width: '100%', minHeight: 320 }}>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={data} margin={{ top: 16, right: 24, left: 0, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
          <Tooltip formatter={(value: number) => [`${value}%`, 'Weekly %']} labelFormatter={(label) => `${label}`} />
          <Bar
            dataKey="percentage"
            name="Weekly %"
            fill={
              graphModal === 'checklist'
                ? '#60A5FA'
                : graphModal === 'delegation'
                  ? '#22C55E'
                  : graphModal === 'supportFMS'
                    ? '#F59E0B'
                    : '#0EA5E9'
            }
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
