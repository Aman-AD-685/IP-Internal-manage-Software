import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Alert, Card, Col, Row, Spin, Typography } from 'antd'
import type { AxiosError } from 'axios'
import { apiClient } from '../../api/axios'
import { API_ENDPOINTS } from '../../utils/constants'

const { Text } = Typography

/** Render proxy drops connections around 30s; keep under that for a clear timeout vs opaque network error. */
const PAYMENT_KPI_TIMEOUT_MS = 28_000

export type KpiPair = { received: number; raised: number }

export type PaymentAmountKpis = {
  quarter_period_label: string
  month_period_label: string
  quarterly_genre_q: KpiPair
  monthly_genre_m: KpiPair
  overall_in_quarter: KpiPair
  monthly_in_quarter: KpiPair
  half_yearly_in_quarter?: KpiPair
  lifetime_raised_excl_na?: number
  na_marked_unpaid_invoice_total?: number
  kpi_scope_note?: string
  overall_carried_unpaid_prior_quarters?: number
}

const fmt = (n: number) => n.toLocaleString('en-IN')

type SummaryBody = {
  kpis?: PaymentAmountKpis
  lifetime_raised_excl_na?: number
  na_marked_unpaid_invoice_total?: number
  kpi_scope_note?: string
}

function mergeKpiBody(body: SummaryBody | undefined): PaymentAmountKpis | null {
  const k = body?.kpis
  if (!k) return null
  return {
    ...k,
    lifetime_raised_excl_na:
      typeof body?.lifetime_raised_excl_na === 'number'
        ? body.lifetime_raised_excl_na
        : k.lifetime_raised_excl_na,
    na_marked_unpaid_invoice_total:
      typeof body?.na_marked_unpaid_invoice_total === 'number'
        ? body.na_marked_unpaid_invoice_total
        : k.na_marked_unpaid_invoice_total,
    kpi_scope_note: body?.kpi_scope_note ?? k.kpi_scope_note,
  }
}

function apiErrorDetail(err: unknown): string {
  const ax = err as AxiosError<{ detail?: string | { msg?: string } }>
  const d = ax.response?.data?.detail
  if (typeof d === 'string' && d.trim()) return d.trim()
  if (d && typeof d === 'object' && 'msg' in d && typeof d.msg === 'string') return d.msg
  if (ax.code === 'ECONNABORTED') {
    return 'Request timed out — payment totals are still loading on the server. Redeploy the latest backend on Render, then retry.'
  }
  if (!ax.response && (ax.code === 'ERR_NETWORK' || ax.message === 'Network Error')) {
    return 'Could not reach the API (connection closed). Confirm VITE_API_BASE_URL points to your Render backend and redeploy Render with the latest payment-summary optimizations.'
  }
  if (ax.response?.status === 404) {
    return 'payment-summary route not found — redeploy the backend on Render (latest main.py).'
  }
  if (ax.response?.status === 500) return 'Server error while building payment totals.'
  return ax.message || 'Network error'
}

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
  kpis?: PaymentAmountKpis | null
  loadFromApi?: boolean
  refreshKey?: number | string
}

export function PaymentAmountKpiCards({ kpis: kpisProp, loadFromApi, refreshKey }: Props) {
  const [kpisFetched, setKpisFetched] = useState<PaymentAmountKpis | null>(null)
  const [loading, setLoading] = useState(Boolean(loadFromApi && !kpisProp))
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!loadFromApi) return
    setLoading(true)
    setLoadError(null)
    setKpisFetched(null)

    const reqOpts = {
      params: { _: refreshKey ?? Date.now() },
      timeout: PAYMENT_KPI_TIMEOUT_MS,
    }

    let lastErr: unknown = null
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await apiClient.get<SummaryBody>(API_ENDPOINTS.CLIENT_PAYMENT.PAYMENT_SUMMARY, reqOpts)
        const merged = mergeKpiBody(r.data)
        if (merged) {
          setKpisFetched(merged)
          return
        }
        lastErr = new Error('payment-summary returned no kpis')
      } catch (e) {
        lastErr = e
        if (attempt === 0) {
          await new Promise((r) => setTimeout(r, 800))
        }
      }
    }

    setLoadError(
      `${apiErrorDetail(lastErr)} If this persists after redeploying Render, open /onboarding/client-payment/payment-summary while logged in.`,
    )
  }, [loadFromApi, refreshKey])

  useEffect(() => {
    void load().finally(() => setLoading(false))
  }, [load, refreshKey])

  const kpis = kpisProp ?? kpisFetched
  const lifetimeRaised = kpis?.lifetime_raised_excl_na
  const naUnpaidExcluded = kpis?.na_marked_unpaid_invoice_total

  if (loadFromApi && loading) {
    return (
      <div style={{ marginBottom: 24, textAlign: 'center', padding: '32px 0' }}>
        <Spin tip="Loading payment totals…" />
      </div>
    )
  }

  if (loadFromApi && loadError && !kpis) {
    return (
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 24 }}
        message="Payment summary unavailable"
        description={loadError}
      />
    )
  }

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} md={8}>
        <KpiSummaryCard
          heading="Quarterly amount"
          period={
            kpis
              ? `${kpis.quarter_period_label} · genre Q · raised & received both use invoices dated this FY quarter`
              : '—'
          }
          pair={kpis?.quarterly_genre_q ?? { received: 0, raised: 0 }}
        />
      </Col>
      <Col xs={24} md={8}>
        <KpiSummaryCard
          heading="Monthly amount"
          period={
            kpis
              ? `${kpis.month_period_label} · genre M · received = payments recorded for invoices dated this month`
              : '—'
          }
          pair={kpis?.monthly_genre_m ?? { received: 0, raised: 0 }}
        />
      </Col>
      <Col xs={24} md={8}>
        <KpiSummaryCard
          heading="Overall"
          period={
            kpis
              ? `${kpis.quarter_period_label} · Raised = invoiced this FY quarter (NA-marked invoices excluded); Received = payments on those same invoices`
              : '—'
          }
          pair={kpis?.overall_in_quarter ?? { received: 0, raised: 0 }}
          extra={
            kpis ? (
              <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
                Monthly-genre invoices this quarter — received / raised (same FY quarter invoice cohort):{' '}
                {fmt(kpis.monthly_in_quarter.received)} / {fmt(kpis.monthly_in_quarter.raised)}
                {kpis.half_yearly_in_quarter ? (
                  <>
                    <br />
                    Half-yearly-genre — received / raised (same cohort): {fmt(kpis.half_yearly_in_quarter.received)} /{' '}
                    {fmt(kpis.half_yearly_in_quarter.raised)}
                  </>
                ) : null}
                {typeof kpis.overall_carried_unpaid_prior_quarters === 'number' &&
                kpis.overall_carried_unpaid_prior_quarters > 0 ? (
                  <>
                    <br />
                    Prior-period unpaid carried into Overall raised: ₹
                    {fmt(kpis.overall_carried_unpaid_prior_quarters)}
                  </>
                ) : null}
              </Text>
            ) : null
          }
        />
      </Col>
      {(kpis && (typeof lifetimeRaised === 'number' || (naUnpaidExcluded ?? 0) > 0)) || kpis?.kpi_scope_note ? (
        <Col span={24}>
          {typeof lifetimeRaised === 'number' ? (
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
              <Text strong style={{ color: 'inherit' }}>
                Lifetime invoiced (all dates, excl. NA):
              </Text>{' '}
              ₹{fmt(lifetimeRaised)}
              {(naUnpaidExcluded ?? 0) > 0 ? (
                <>
                  {' '}
                  ·{' '}
                  <Text strong style={{ color: 'inherit' }}>
                    Unpaid marked NA (excluded from amounts above):
                  </Text>{' '}
                  ₹{fmt(naUnpaidExcluded ?? 0)}
                </>
              ) : null}
            </Text>
          ) : null}
          {kpis?.kpi_scope_note ? (
            <Text type="secondary" style={{ fontSize: 11, display: 'block' }}>
              {kpis.kpi_scope_note}
            </Text>
          ) : null}
        </Col>
      ) : null}
    </Row>
  )
}
