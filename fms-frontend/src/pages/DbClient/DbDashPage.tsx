import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Empty, Row, Select, Table, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ComposableMap,
  Geographies,
  Geography,
  Marker,
  ZoomableGroup,
} from 'react-simple-maps'
import { dbClientOnbApi, type ClientOnbRecord } from '../../api/dbClientOnb'
import { DashboardBlockSkeleton } from '../../components/common/skeletons'
import './db-dash.css'

const { Title, Text } = Typography

type OrgAgg = {
  organization_name: string
  total_amount_paid_per_month: number
}

type CompanyRow = {
  id: string
  organization_name: string
  company_name: string
  contact_person: string
  mobile_no: string
  email_id: string
  payment_frequency: string
  division_abbreviation: string
  paid_divisions: string
  total_amount_paid_per_month: number
  amount_paid_per_division: number
}

type MapPoint = {
  key: string
  country: string
  state: string
  count: number
  lat: number
  lon: number
}

const parseAmount = (v: string | null | undefined): number => {
  if (!v) return 0
  const cleaned = String(v).replace(/[^0-9.-]/g, '')
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

const normalizeStatus = (s: string | null | undefined): 'active' | 'inactive' =>
  (s || 'active').toLowerCase() === 'inactive' ? 'inactive' : 'active'

const STATE_TO_COORD: Record<string, { lat: number; lon: number; country: string }> = {
  'west bengal': { lat: 22.99, lon: 87.86, country: 'India' },
  odisha: { lat: 20.95, lon: 85.1, country: 'India' },
  chhattisgarh: { lat: 21.28, lon: 81.86, country: 'India' },
  jharkhand: { lat: 23.61, lon: 85.28, country: 'India' },
  'uttar pradesh': { lat: 26.85, lon: 80.95, country: 'India' },
  assam: { lat: 26.14, lon: 91.77, country: 'India' },
  maharashtra: { lat: 19.75, lon: 75.71, country: 'India' },
  telangana: { lat: 17.98, lon: 79.59, country: 'India' },
  telengana: { lat: 17.98, lon: 79.59, country: 'India' },
  bihar: { lat: 25.61, lon: 85.14, country: 'India' },
  alipurduar: { lat: 26.49, lon: 89.53, country: 'India' },
  kodarma: { lat: 24.47, lon: 85.59, country: 'India' },
  'paschim bardhaman': { lat: 23.53, lon: 87.27, country: 'India' },
}

const WORLD_TOPO_JSON = 'https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json'

export function DbDashPage() {
  const [rows, setRows] = useState<ClientOnbRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [organizationFilter, setOrganizationFilter] = useState<string | undefined>()
  const [companyFilter, setCompanyFilter] = useState<string | undefined>()
  const [divisionFilter, setDivisionFilter] = useState<string | undefined>()
  const [mapScale, setMapScale] = useState(1)
  const [mapCenter, setMapCenter] = useState<[number, number]>([78, 22])

  useEffect(() => {
    setLoading(true)
    setError(null)
    dbClientOnbApi
      .list()
      .then((r) => setRows(r.items || []))
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : 'Could not load DB Client dashboard data.'
        setError(msg)
        setRows([])
      })
      .finally(() => setLoading(false))
  }, [])

  const normalizedRows = useMemo(
    () =>
      rows.map((r) => ({
        ...r,
        organization_name: (r.organization_name || '').trim(),
        company_name: (r.company_name || '').trim(),
        division_abbreviation: (r.division_abbreviation || '').trim(),
        payment_frequency: (r.payment_frequency || '').trim(),
      })),
    [rows]
  )

  const filteredRows = useMemo(() => {
    return normalizedRows.filter((r) => {
      if (organizationFilter && r.organization_name !== organizationFilter) return false
      if (companyFilter && r.company_name !== companyFilter) return false
      if (divisionFilter && !r.division_abbreviation.toLowerCase().includes(divisionFilter.toLowerCase())) {
        return false
      }
      return true
    })
  }, [normalizedRows, organizationFilter, companyFilter, divisionFilter])

  const stats = useMemo(() => {
    const active = filteredRows.filter((r) => normalizeStatus(r.status) === 'active')
    const inactive = filteredRows.filter((r) => normalizeStatus(r.status) === 'inactive')
    const orgSet = new Set(
      filteredRows.map((r) => (r.organization_name || '').trim()).filter(Boolean)
    )
    const companySet = new Set(filteredRows.map((r) => (r.company_name || '').trim()).filter(Boolean))
    const stateSet = new Set(
      filteredRows.map((r) => (r.client_location_state || '').trim()).filter(Boolean)
    )
    const totalMonthly = filteredRows.reduce(
      (sum, r) => sum + parseAmount(r.total_amount_paid_per_month),
      0
    )
    const totalPaidDivisions = filteredRows.reduce((sum, r) => sum + parseAmount(r.paid_divisions), 0)
    const avgPricePerDivision = totalPaidDivisions > 0 ? totalMonthly / totalPaidDivisions : 0
    return {
      totalRows: filteredRows.length,
      activeRows: active.length,
      inactiveRows: inactive.length,
      totalOrganizations: orgSet.size,
      totalCompanies: companySet.size,
      totalStates: stateSet.size,
      totalMonthly,
      totalPaidDivisions,
      avgPricePerDivision,
    }
  }, [filteredRows])

  const topOrganizations = useMemo<OrgAgg[]>(() => {
    const map = new Map<string, number>()
    filteredRows.forEach((r) => {
      const org = (r.organization_name || '').trim() || 'Unknown'
      const amt = parseAmount(r.total_amount_paid_per_month)
      map.set(org, (map.get(org) || 0) + amt)
    })
    return Array.from(map.entries())
      .map(([organization_name, total_amount_paid_per_month]) => ({
        organization_name,
        total_amount_paid_per_month,
      }))
      .sort((a, b) => b.total_amount_paid_per_month - a.total_amount_paid_per_month)
      .slice(0, 10)
  }, [filteredRows])

  const top5ForBar = topOrganizations.slice(0, 5)

  const paymentMethodData = useMemo(() => {
    const m = new Map<string, number>()
    filteredRows.forEach((r) => {
      const k = (r.payment_frequency || 'Unknown').trim() || 'Unknown'
      m.set(k, (m.get(k) || 0) + 1)
    })
    return Array.from(m.entries()).map(([name, value]) => ({ name, value }))
  }, [filteredRows])

  const divisionData = useMemo(() => {
    const m = new Map<string, number>()
    filteredRows.forEach((r) => {
      const parts = (r.division_abbreviation || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
      if (parts.length === 0) {
        m.set('Others', (m.get('Others') || 0) + 1)
        return
      }
      parts.forEach((p) => m.set(p, (m.get(p) || 0) + 1))
    })
    return Array.from(m.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
  }, [filteredRows])

  const companiesByStateData = useMemo(() => {
    const m = new Map<string, number>()
    filteredRows.forEach((r) => {
      const st = (r.client_location_state || '').trim() || 'Unknown'
      m.set(st, (m.get(st) || 0) + 1)
    })
    return Array.from(m.entries())
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
  }, [filteredRows])

  const mapPoints = useMemo<MapPoint[]>(() => {
    const keyToCount = new Map<string, number>()
    filteredRows.forEach((r) => {
      const stateRaw = (r.client_location_state || '').trim()
      if (!stateRaw) return
      const key = stateRaw.toLowerCase()
      keyToCount.set(key, (keyToCount.get(key) || 0) + 1)
    })
    const pts: MapPoint[] = []
    keyToCount.forEach((count, key) => {
      const coord = STATE_TO_COORD[key]
      if (!coord) return
      pts.push({
        key,
        state: key,
        country: coord.country,
        count,
        lat: coord.lat,
        lon: coord.lon,
      })
    })
    return pts.sort((a, b) => b.count - a.count)
  }, [filteredRows])

  const pieColors = ['#2ecc71', '#ff9f43', '#6c5ce7', '#00cec9', '#ff6b6b', '#feca57', '#54a0ff', '#5f27cd']

  const zoomIn = () => setMapScale((s) => Math.min(6, Number((s * 1.2).toFixed(3))))
  const zoomOut = () => setMapScale((s) => Math.max(1, Number((s / 1.2).toFixed(3))))
  const resetZoom = () => {
    setMapScale(1)
    setMapCenter([78, 22])
  }

  const companyRows = useMemo<CompanyRow[]>(
    () =>
      filteredRows.map((r) => ({
        id: r.id,
        organization_name: r.organization_name || '-',
        company_name: r.company_name || '-',
        contact_person: r.contact_person || '-',
        mobile_no: r.mobile_no || '-',
        email_id: r.email_id || '-',
        payment_frequency: r.payment_frequency || '-',
        division_abbreviation: r.division_abbreviation || '-',
        paid_divisions: r.paid_divisions || '-',
        total_amount_paid_per_month: parseAmount(r.total_amount_paid_per_month),
        amount_paid_per_division: parseAmount(r.amount_paid_per_division),
      })),
    [filteredRows]
  )

  const orgOptions = useMemo(
    () =>
      Array.from(new Set(normalizedRows.map((r) => r.organization_name).filter(Boolean)))
        .sort()
        .map((v) => ({ value: v, label: v })),
    [normalizedRows]
  )
  const companyOptions = useMemo(
    () =>
      Array.from(new Set(normalizedRows.map((r) => r.company_name).filter(Boolean)))
        .sort()
        .map((v) => ({ value: v, label: v })),
    [normalizedRows]
  )
  const divisionOptions = useMemo(() => {
    const set = new Set<string>()
    normalizedRows.forEach((r) => {
      r.division_abbreviation
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .forEach((x) => set.add(x))
    })
    return Array.from(set)
      .sort()
      .map((v) => ({ value: v, label: v }))
  }, [normalizedRows])

  const tableColumns: ColumnsType<CompanyRow> = [
    { title: 'Organization', dataIndex: 'organization_name', key: 'organization_name', width: 170, ellipsis: true },
    { title: 'Company', dataIndex: 'company_name', key: 'company_name', width: 170, ellipsis: true },
    { title: 'Contact', dataIndex: 'contact_person', key: 'contact_person', width: 120, ellipsis: true },
    { title: 'Mobile No', dataIndex: 'mobile_no', key: 'mobile_no', width: 110 },
    { title: 'Email', dataIndex: 'email_id', key: 'email_id', width: 180, ellipsis: true },
    { title: 'Frequency', dataIndex: 'payment_frequency', key: 'payment_frequency', width: 100 },
    { title: 'Division', dataIndex: 'division_abbreviation', key: 'division_abbreviation', width: 130, ellipsis: true },
    { title: 'Total Division', dataIndex: 'paid_divisions', key: 'paid_divisions', width: 90, align: 'right' },
    {
      title: 'Total Monthly Payment',
      dataIndex: 'total_amount_paid_per_month',
      key: 'total_amount_paid_per_month',
      width: 130,
      align: 'right',
      render: (v: number) => v.toLocaleString('en-IN'),
    },
    {
      title: 'Avg Division Price',
      dataIndex: 'amount_paid_per_division',
      key: 'amount_paid_per_division',
      width: 120,
      align: 'right',
      render: (v: number) => v.toLocaleString('en-IN'),
    },
  ]

  const topColumns: ColumnsType<OrgAgg> = [
    {
      title: 'Organization',
      dataIndex: 'organization_name',
      key: 'organization_name',
      ellipsis: true,
    },
    {
      title: 'Total Amount Paid / Month',
      dataIndex: 'total_amount_paid_per_month',
      key: 'total_amount_paid_per_month',
      align: 'right',
      render: (v: number) => v.toLocaleString('en-IN'),
    },
  ]

  return (
    <div className="db-dash-page industrial-page industrial-dashboard">
      <Card className="db-dash-main">
        <div className="db-dash-title-bar">
          <Title level={4} className="page-main-heading" style={{ margin: 0 }}>
            ACTIVE CLIENT DATABASE
          </Title>
        </div>

        {error ? (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 16 }}
            message="Could not load dashboard data"
            description={error}
          />
        ) : null}

        {loading ? (
          <DashboardBlockSkeleton />
        ) : rows.length === 0 ? (
          <div style={{ marginTop: 24 }}>
            <Empty description="No records found." />
          </div>
        ) : (
          <>
            <Row gutter={[8, 8]} style={{ marginTop: 12 }}>
              <Col xs={24} md={12}>
                <Row gutter={[8, 8]}>
                  <Col span={12}>
                    <div className="kpi-tile kpi-orange"><Text>Organizations</Text><div>{stats.totalOrganizations}</div></div>
                  </Col>
                  <Col span={12}>
                    <div className="kpi-tile kpi-blue"><Text>Total Amt Received Month</Text><div>{stats.totalMonthly.toLocaleString('en-IN')}</div></div>
                  </Col>
                  <Col span={12}>
                    <div className="kpi-tile kpi-yellow"><Text>Company Name</Text><div>{stats.totalCompanies}</div></div>
                  </Col>
                  <Col span={12}>
                    <div className="kpi-tile kpi-amber"><Text>Avg Price Per Divisions</Text><div>{Math.round(stats.avgPricePerDivision).toLocaleString('en-IN')}</div></div>
                  </Col>
                  <Col span={12}>
                    <div className="kpi-tile kpi-indigo"><Text>State Covered</Text><div>{stats.totalStates}</div></div>
                  </Col>
                  <Col span={12}>
                    <div className="kpi-tile kpi-red"><Text>No. of Paid Division</Text><div>{stats.totalPaidDivisions}</div></div>
                  </Col>
                </Row>
              </Col>
              <Col xs={24} md={12}>
                <Card size="small" title="Top 5 Organization" className="db-dash-panel">
                  <ResponsiveContainer width="100%" height={170}>
                    <BarChart data={top5ForBar} layout="vertical" margin={{ left: 10, right: 16 }}>
                      <XAxis type="number" hide />
                      <YAxis type="category" width={90} dataKey="organization_name" tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => Number(v).toLocaleString('en-IN')} />
                      <Bar dataKey="total_amount_paid_per_month" fill="#77b255">
                        {top5ForBar.map((_, i) => <Cell key={String(i)} fill="#77b255" />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
            </Row>

            <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
              <Col xs={24} md={12}>
                <Card size="small" title="Map" className="db-dash-panel">
                  <div className="db-dash-map-box">
                    <div className="world-map-toolbar">
                      <Button size="small" onClick={zoomOut}>-</Button>
                      <Button size="small" onClick={zoomIn}>+</Button>
                      <Button size="small" onClick={resetZoom}>Reset</Button>
                      <Text type="secondary">Zoom: {(mapScale * 100).toFixed(0)}%</Text>
                    </div>
                    <div className="world-map-svg" role="img" aria-label="World map with client points">
                      <ComposableMap projection="geoMercator" projectionConfig={{ scale: 120 }}>
                        <ZoomableGroup
                          center={mapCenter}
                          zoom={mapScale}
                          onMoveEnd={(position) => {
                            if (position.coordinates) {
                              setMapCenter(position.coordinates as [number, number])
                            }
                            if (typeof position.zoom === 'number') setMapScale(position.zoom)
                          }}
                        >
                          <Geographies geography={WORLD_TOPO_JSON}>
                            {({ geographies }) =>
                              geographies.map((geo) => (
                                <Geography
                                  key={geo.rsmKey}
                                  geography={geo}
                                  fill="#c8d8ea"
                                  stroke="#ffffff"
                                  strokeWidth={0.4}
                                />
                              ))
                            }
                          </Geographies>
                          {mapPoints.map((p) => (
                            <Marker key={p.key} coordinates={[p.lon, p.lat]}>
                              <circle
                                r={Math.min(2 + p.count * 0.35, 7)}
                                fill="#d63031"
                                fillOpacity={0.85}
                                stroke="#fff"
                                strokeWidth={0.8}
                              >
                                <title>{`${p.country} - ${p.state.toUpperCase()} (${p.count})`}</title>
                              </circle>
                            </Marker>
                          ))}
                        </ZoomableGroup>
                      </ComposableMap>
                    </div>
                    <Text className="db-dash-map-caption">Country-State markers for client footprint ({stats.totalStates} states)</Text>
                  </div>
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card size="small" title="No of Companies (State-wise)" className="db-dash-panel">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={companiesByStateData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-12} textAnchor="end" height={48} />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#2e78c7" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
            </Row>

            <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
              <Col xs={24} md={12}>
                <Card size="small" title="Payment Method" className="db-dash-panel">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={paymentMethodData}
                        dataKey="value"
                        nameKey="name"
                        cx="45%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={78}
                        paddingAngle={3}
                        label
                      >
                        {paymentMethodData.map((_, i) => (
                          <Cell key={`pm-${String(i)}`} fill={pieColors[i % pieColors.length]} />
                        ))}
                      </Pie>
                      <Legend verticalAlign="middle" align="right" layout="vertical" />
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
              <Col xs={24} md={12}>
                <Card size="small" title="Division Segregation" className="db-dash-panel">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={divisionData}
                        dataKey="value"
                        nameKey="name"
                        cx="45%"
                        cy="50%"
                        innerRadius={35}
                        outerRadius={78}
                        paddingAngle={3}
                        label
                      >
                        {divisionData.map((_, i) => (
                          <Cell key={`dv-${String(i)}`} fill={pieColors[(i + 2) % pieColors.length]} />
                        ))}
                      </Pie>
                      <Legend verticalAlign="middle" align="right" layout="vertical" />
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </Card>
              </Col>
            </Row>

            <Row gutter={[8, 8]} style={{ marginTop: 8 }}>
              <Col span={24}>
                <div className="db-dash-filter-row">
                  <Select allowClear placeholder="ORGANIZATION..." value={organizationFilter} onChange={setOrganizationFilter} options={orgOptions} style={{ minWidth: 210 }} />
                  <Select allowClear placeholder="COMPANY..." value={companyFilter} onChange={setCompanyFilter} options={companyOptions} style={{ minWidth: 210 }} />
                  <Select allowClear placeholder="DIVISION..." value={divisionFilter} onChange={setDivisionFilter} options={divisionOptions} style={{ minWidth: 210 }} />
                </div>
                <Card size="small" className="db-dash-panel">
                  <Table<CompanyRow>
                    className="db-dash-table"
                    rowKey="id"
                    columns={tableColumns}
                    dataSource={companyRows}
                    size="small"
                    pagination={{ pageSize: 10 }}
                    scroll={{ x: 1300 }}
                    rowClassName={(_, index) => (index % 2 === 0 ? 'table-row-even' : 'table-row-odd')}
                  />
                </Card>
              </Col>
            </Row>

            <Card size="small" style={{ marginTop: 8 }} className="db-dash-panel" title="Organization Name - Total Amount Paid Per Month">
              <Table<OrgAgg>
                className="db-dash-table"
                rowKey="organization_name"
                columns={topColumns}
                dataSource={topOrganizations}
                size="small"
                pagination={{ pageSize: 15 }}
                rowClassName={(_, index) => (index % 2 === 0 ? 'table-row-even' : 'table-row-odd')}
              />
            </Card>
          </>
        )}
      </Card>
    </div>
  )
}
