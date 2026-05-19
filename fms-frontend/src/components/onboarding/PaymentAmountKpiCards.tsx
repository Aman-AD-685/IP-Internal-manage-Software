import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Card, Col, Row, Typography } from 'antd'
import { apiClient } from '../../api/axios'
import { API_ENDPOINTS } from '../../utils/constants'

const { Text } = Typography

export type KpiPair = { received: number; raised: number }

export type PaymentAmountKpis = {
  quarter_period_label: string
  month_period_label: string
  quarterly_genre_q: KpiPair
  monthly_genre_m: KpiPair
  overall_in_quarter: KpiPair
  monthly_in_quarter: KpiPair
  half_yearly_in_quarter?: KpiPair
}

const fmt = (n: number) => n.toLocaleString('en-IN')

function KpiSummaryCard({
  heading,
  period,
  pair,
  extra,
}: {
  heading: string
  period: string
  pair: KpiPair
  extra?: ReactNode
}) {
  return (
    <Card size="small" style={{ height: '100%' }}>
      <Text strong style={{ display: 'block', marginBottom: 4 }}>
        {heading}
      </Text>
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
        {period}
      </Text>
      <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>
        {fmt(pair.received)} / {fmt(pair.raised)}
      </div>
      <Text type="secondary" style={{ fontSize: 11 }}>
        Total received / Total raised (₹)
      </Text>
      {extra ? <div style={{ marginTop: 10 }}>{extra}</div> : null}
    </Card>
  )
}

type Props = {
  /** When provided, cards render from this data (no fetch). */
  kpis?: PaymentAmountKpis | null
  /** Fetch KPIs from payment-ageing-report API when true and kpis not passed. */
  loadFromApi?: boolean
  /** Change to refetch KPIs (e.g. after marking invoice NA). */
  refreshKey?: number | string
}

export function PaymentAmountKpiCards({ kpis: kpisProp, loadFromApi, refreshKey }: Props) {
  const [kpisFetched, setKpisFetched] = useState<PaymentAmountKpis | null>(null)

  const load = useCallback(() => {
    if (!loadFromApi) return
    apiClient
      .get<{ kpis?: PaymentAmountKpis }>(API_ENDPOINTS.CLIENT_PAYMENT.PAYMENT_AGEING_REPORT)
      .then((r) => {
        const k = r.data?.kpis
        if (k) setKpisFetched(k)
      })
      .catch(() => setKpisFetched(null))
  }, [loadFromApi])

  useEffect(() => {
    load()
  }, [load, refreshKey])

  const kpis = kpisProp ?? kpisFetched

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={8}>
        <KpiSummaryCard
          heading="Quarterly amount"
          period={kpis ? `${kpis.quarter_period_label} · genre Q (quarterly raises)` : '—'}
          pair={kpis?.quarterly_genre_q ?? { received: 0, raised: 0 }}
        />
      </Col>
      <Col xs={24} md={8}>
        <KpiSummaryCard
          heading="Monthly amount"
          period={kpis ? `${kpis.month_period_label} · genre M (monthly raises)` : '—'}
          pair={kpis?.monthly_genre_m ?? { received: 0, raised: 0 }}
        />
      </Col>
      <Col xs={24} md={8}>
        <KpiSummaryCard
          heading="Overall"
          period={kpis ? `${kpis.quarter_period_label} · all genres in this FY quarter` : '—'}
          pair={kpis?.overall_in_quarter ?? { received: 0, raised: 0 }}
          extra={
            kpis ? (
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                Monthly raises in this quarter: {fmt(kpis.monthly_in_quarter.received)} /{' '}
                {fmt(kpis.monthly_in_quarter.raised)} (received / raised)
                {kpis.half_yearly_in_quarter ? (
                  <>
                    <br />
                    Half-yearly raises in this quarter: {fmt(kpis.half_yearly_in_quarter.received)} /{' '}
                    {fmt(kpis.half_yearly_in_quarter.raised)} (received / raised)
                  </>
                ) : null}
              </Text>
            ) : null
          }
        />
      </Col>
    </Row>
  )
}
