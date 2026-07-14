import type { CSSProperties, ReactNode } from 'react'
import { Card, Col, Row, Skeleton, Space } from 'antd'

const overlayStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 4,
  background: 'var(--skeleton-overlay-bg, var(--ant-color-bg-container, #ffffff))',
  borderRadius: 8,
  padding: 16,
  overflow: 'hidden',
}

/** Replaces `<Spin spinning>` — skeleton overlay on top of content area */
export function SkeletonOverlay({
  loading,
  children,
  rows = 8,
  minHeight,
}: {
  loading: boolean
  children: ReactNode
  rows?: number
  minHeight?: number
}) {
  return (
    <div style={{ position: 'relative', minHeight: loading ? minHeight : undefined }}>
      {children}
      {loading ? (
        <div aria-busy aria-label="Loading" style={overlayStyle}>
          <Skeleton active title={{ width: '35%' }} paragraph={{ rows }} />
        </div>
      ) : null}
    </div>
  )
}

/** Chart / lazy chunk placeholder */
export const ChartAreaSkeleton = ({ height = 320 }: { height?: number }) => (
  <div style={{ width: '100%', minHeight: height, padding: 12 }}>
    <Skeleton active title={{ width: '28%' }} paragraph={false} />
    <Skeleton.Input active block style={{ width: '100%', height: height - 52, marginTop: 12, borderRadius: 8 }} />
  </div>
)

/** Soumya KPI dashboard first paint */
export const SoumyaDashboardSkeleton = () => (
  <div className="soumya-dash">
    <Skeleton active title={{ width: 240 }} paragraph={{ rows: 1 }} style={{ marginBottom: 16 }} />
    <Space wrap style={{ marginBottom: 16 }}>
      <Skeleton.Input active style={{ width: 100, height: 32 }} />
      <Skeleton.Input active style={{ width: 80, height: 32 }} />
      <Skeleton.Input active style={{ width: 120, height: 32 }} />
    </Space>
    <Row gutter={[16, 16]}>
      {[0, 1, 2, 3, 4].map((i) => (
        <Col xs={24} sm={12} md={8} lg={8} key={i}>
          <Card size="small">
            <Skeleton active paragraph={{ rows: 3 }} title={{ width: '55%' }} />
          </Card>
        </Col>
      ))}
    </Row>
    <Card size="small" style={{ marginTop: 20 }}>
      <Skeleton active title={{ width: '22%' }} paragraph={{ rows: 10 }} />
    </Card>
  </div>
)

/** Infinite scroll / load-more rows under a table */
export const TableLoadMoreSkeleton = ({ rows = 3, columns = 6 }: { rows?: number; columns?: number }) => (
  <div className="table-load-more-skeleton" style={{ padding: '8px 0' }}>
    {Array.from({ length: rows }).map((_, i) => (
      <div
        key={i}
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          padding: '10px 12px',
          borderBottom: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
        }}
      >
        {Array.from({ length: columns }).map((_, j) => (
          <Skeleton.Input
            key={j}
            active
            size="small"
            style={{ flex: j === 0 ? 0.6 : 1, minWidth: 36, height: 14 }}
          />
        ))}
      </div>
    ))}
  </div>
)

/** Team KPI card row on main dashboard */
export const KpiTeamRowSkeleton = () => (
  <Row gutter={[16, 16]}>
    {[0, 1, 2, 3, 4].map((i) => (
      <Col xs={24} sm={12} md={6} key={i}>
        <Card>
          <Skeleton active title={{ width: '70%' }} paragraph={{ rows: 3 }} />
        </Card>
      </Col>
    ))}
  </Row>
)

/** Four success metric cards */
export const SuccessCardsRowSkeleton = () => (
  <Row gutter={[20, 20]}>
    {[0, 1, 2, 3].map((i) => (
      <Col xs={24} sm={12} md={12} lg={6} key={i}>
        <Card>
          <Skeleton active title={{ width: '60%' }} paragraph={{ rows: 2 }} />
        </Card>
      </Col>
    ))}
  </Row>
)

/** KPI overview — two progress ring placeholders */
export const KpiRingsSkeleton = () => (
  <Row gutter={[16, 16]} className="universal-dashboard-kpi-rings" style={{ minHeight: 140 }}>
    {[0, 1].map((i) => (
      <Col xs={12} key={i} style={{ textAlign: 'center' }}>
        <Skeleton.Avatar active size={88} shape="circle" />
        <Skeleton.Input active size="small" style={{ width: 64, marginTop: 12, display: 'block', marginInline: 'auto' }} />
      </Col>
    ))}
  </Row>
)

/** Support FMS — three small KPI tiles on Dashboard KPI page */
export const SupportFmsTilesSkeleton = () => (
  <Card className="kpi-section-card kpi-section-card--support-fms" style={{ marginTop: 16 }}>
    <Row gutter={[16, 16]}>
      {(['Response Delay', 'Completion Delay', 'Pending Chores & Bugs'] as const).map((label) => (
        <Col xs={24} md={8} key={label}>
          <Card size="small" title={label} className="kpi-support-card">
            <Skeleton active paragraph={{ rows: 2 }} title={false} />
          </Card>
        </Col>
      ))}
    </Row>
  </Card>
)

/** Full-page shell while auth or route data loads */
export const PageSkeleton = () => (
  <div style={{ minHeight: '100vh', padding: 24, maxWidth: 1400, margin: '0 auto' }}>
    <Skeleton.Input active style={{ width: 200, height: 32, marginBottom: 24 }} />
    <Row gutter={[16, 16]}>
      {[0, 1, 2, 3].map((i) => (
        <Col xs={24} sm={12} lg={6} key={i}>
          <Card size="small">
            <Skeleton active paragraph={{ rows: 2 }} title={{ width: '60%' }} />
          </Card>
        </Col>
      ))}
    </Row>
    <Card size="small" style={{ marginTop: 24 }} styles={{ body: { padding: 16 } }}>
      <Skeleton active title={{ width: '28%' }} paragraph={{ rows: 12 }} />
    </Card>
  </div>
)

/** Modal / drawer body placeholder */
export const ModalContentSkeleton = ({ rows = 10 }: { rows?: number }) => (
  <div style={{ padding: '8px 0' }}>
    <Skeleton active title={{ width: '40%' }} paragraph={{ rows }} />
  </div>
)

/** Lead / detail-style first load */
export const DetailPageSkeleton = () => (
  <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Skeleton.Input active style={{ width: 280, height: 36 }} />
      <Card>
        <Skeleton active title paragraph={{ rows: 6 }} />
      </Card>
      <Card>
        <Skeleton active title paragraph={{ rows: 4 }} />
      </Card>
    </Space>
  </div>
)

/** KPI / dashboard block (tiles + optional table area) */
export const DashboardBlockSkeleton = () => (
  <div style={{ marginTop: 16 }}>
    <Row gutter={[12, 12]}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Col xs={24} sm={12} md={8} key={i}>
          <Card size="small">
            <Skeleton active paragraph={{ rows: 3 }} title={{ width: '50%' }} />
          </Card>
        </Col>
      ))}
    </Row>
    <Card size="small" style={{ marginTop: 16 }}>
      <Skeleton active paragraph={{ rows: 8 }} title={{ width: '30%' }} />
    </Card>
  </div>
)

/**
 * Full-area table skeleton (header row + body rows). Wrap Ant Design Table and set Table `loading={false}`.
 * Avoids `loading={{ indicator: <Skeleton/> }}` which centers a small block and overlaps real columns.
 */
export function TableWithSkeletonLoading({
  loading,
  children,
  columns = 8,
  rows = 12,
}: {
  loading: boolean
  children: ReactNode
  /** Visual column placeholders (approximate your table width). */
  columns?: number
  rows?: number
}) {
  const rowCells = (height: number) =>
    Array.from({ length: columns }).map((_, j) => (
      <Skeleton.Input
        key={j}
        active
        size="small"
        style={{
          flex: j === 0 ? 1.15 : 1,
          minWidth: 40,
          height,
          maxWidth: '100%',
        }}
      />
    ))

  return (
    <div style={{ position: 'relative', width: '100%', minHeight: loading ? 280 : undefined }}>
      {children}
      {loading ? (
        <div
          aria-busy
          aria-label="Loading table"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 6,
            background: 'var(--ant-color-bg-container, #ffffff)',
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.06)',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'center',
              padding: '14px 12px',
              borderBottom: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
              background: 'var(--ant-color-fill-alter, #fafafa)',
            }}
          >
            {rowCells(16)}
          </div>
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'center',
                padding: '11px 12px',
                borderBottom: '1px solid var(--ant-color-border-secondary, #f0f0f0)',
              }}
            >
              {rowCells(14)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
