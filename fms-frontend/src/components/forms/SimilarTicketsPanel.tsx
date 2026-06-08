import { Button, Spin, Tag, Typography } from 'antd'
import { LinkOutlined, EyeInvisibleOutlined } from '@ant-design/icons'
import { useEffect, useState, type ReactNode } from 'react'
import type { SimilarTicketMatch, SimilarTicketsResponse } from '../../api/tickets'
import './similar-tickets-panel.css'

const { Text } = Typography

interface SimilarTicketsPanelProps {
  result: SimilarTicketsResponse | null
  loading?: boolean
  error?: string | null
  query?: string
  scopeReady?: boolean
  scopeHint?: string
  selectedTicketId?: string | null
  onSelectTicket?: (item: SimilarTicketMatch) => void
  onViewTicket?: (item: SimilarTicketMatch) => void
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightTitle(title: string, query: string): ReactNode {
  const q = query.trim()
  if (!q || !title) return title

  const tokens = q
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2)
  if (tokens.length === 0) return title

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi')
  const parts = title.split(pattern)

  return parts.map((part, index) => {
    const lowerPart = part.toLowerCase()
    const isMatch = tokens.some((t) => lowerPart === t.toLowerCase())
    return isMatch ? (
      <mark key={`${part}-${index}`} className="similar-tickets-highlight">
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    )
  })
}

function typeLabel(item: SimilarTicketMatch): string {
  if (item.type_label) return item.type_label
  if (item.type === 'feature') return 'Feature'
  if (item.type === 'bug') return 'Bug'
  return 'Chores'
}

function scoreBadgeColor(score: number): string {
  if (score >= 90) return 'blue'
  return 'default'
}

function TicketRow({
  item,
  query,
  selected,
  onSelectTicket,
  onViewTicket,
}: {
  item: SimilarTicketMatch
  query: string
  selected?: boolean
  onSelectTicket?: (item: SimilarTicketMatch) => void
  onViewTicket?: (item: SimilarTicketMatch) => void
}) {
  const companyName = item.company_name?.trim() || '—'

  const handleSelect = () => onSelectTicket?.(item)

  return (
    <div
      className={`similar-tickets-row${onSelectTicket ? ' similar-tickets-row--clickable' : ''}${selected ? ' similar-tickets-row--selected' : ''}`}
      role={onSelectTicket ? 'option' : undefined}
      aria-selected={onSelectTicket ? selected : undefined}
      tabIndex={onSelectTicket ? 0 : undefined}
      onClick={onSelectTicket ? handleSelect : undefined}
      onKeyDown={
        onSelectTicket
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleSelect()
              }
            }
          : undefined
      }
    >
      <div className="similar-tickets-row__ref">{item.reference_no}</div>
      <div className="similar-tickets-row__title" title={item.title}>
        {highlightTitle(item.title, query)}
      </div>
      <div className="similar-tickets-row__company" title={companyName}>
        {companyName}
      </div>
      <div className="similar-tickets-row__type">{typeLabel(item)}</div>
      <div className="similar-tickets-row__actions">
        <Tag color={scoreBadgeColor(item.match_score)}>{item.match_score}%</Tag>
        {onViewTicket ? (
          <Button
            type="link"
            size="small"
            icon={<LinkOutlined />}
            onClick={(e) => {
              e.stopPropagation()
              onViewTicket(item)
            }}
            style={{ padding: 0, height: 'auto' }}
          >
            View
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function ColumnHeaders() {
  return (
    <div className="similar-tickets-row similar-tickets-row--header" aria-hidden="true">
      <div>Ref No</div>
      <div>Title</div>
      <div>Company Name</div>
      <div>Type</div>
      <div>Match</div>
    </div>
  )
}

function TicketSection({
  title,
  items,
  query,
  selectedTicketId,
  onSelectTicket,
  onViewTicket,
}: {
  title: string
  items: SimilarTicketMatch[]
  query: string
  selectedTicketId?: string | null
  onSelectTicket?: (item: SimilarTicketMatch) => void
  onViewTicket?: (item: SimilarTicketMatch) => void
}) {
  if (items.length === 0) return null

  return (
    <>
      <div className="similar-tickets-panel__section-title">{title}</div>
      {items.map((item) => (
        <TicketRow
          key={item.id}
          item={item}
          query={query}
          selected={selectedTicketId === item.id}
          onSelectTicket={onSelectTicket}
          onViewTicket={onViewTicket}
        />
      ))}
    </>
  )
}

export function SimilarTicketsPanel({
  result,
  loading,
  error,
  query = '',
  scopeReady = true,
  scopeHint,
  selectedTicketId,
  onSelectTicket,
  onViewTicket,
}: SimilarTicketsPanelProps) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setDismissed(false)
  }, [query, result?.repeat_count])

  if (!scopeReady) {
    return (
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary">
          {scopeHint || 'Enter at least 3 characters in Title to search all companies.'}
        </Text>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="similar-tickets-loading">
        <Spin size="small" />{' '}
        <Text type="secondary">Searching similar titles across all companies…</Text>
      </div>
    )
  }

  if (error) {
    return (
      <div className="similar-tickets-error">
        <Text type="warning">{error}</Text>
      </div>
    )
  }

  const similar = result?.similar ?? []
  const nearSimilar = result?.nearSimilar ?? []
  const hasResults = similar.length > 0 || nearSimilar.length > 0

  if (!hasResults) {
    return null
  }

  const totalCount = similar.length + nearSimilar.length

  if (dismissed) {
    return (
      <div className="similar-tickets-collapsed">
        <Text type="secondary">
          {totalCount} similar ticket{totalCount === 1 ? '' : 's'} found
        </Text>
        <Button type="link" size="small" onClick={() => setDismissed(false)}>
          Show similar tickets
        </Button>
      </div>
    )
  }

  return (
    <div className="similar-tickets-panel" role="listbox" aria-label="Similar ticket suggestions">
      <div className="similar-tickets-panel__header">
        <Text strong className="similar-tickets-panel__header-title">
          Similar ticket suggestions
        </Text>
        <Button
          type="text"
          size="small"
          icon={<EyeInvisibleOutlined />}
          onClick={() => setDismissed(true)}
          aria-label="Hide similar tickets"
        >
          Hide
        </Button>
      </div>
      <div className="similar-tickets-panel__scroll">
        <ColumnHeaders />
        <TicketSection
          title="Similar Tickets"
          items={similar}
          query={query}
          selectedTicketId={selectedTicketId}
          onSelectTicket={onSelectTicket}
          onViewTicket={onViewTicket}
        />
        <TicketSection
          title="Near Similar Tickets"
          items={nearSimilar}
          query={query}
          selectedTicketId={selectedTicketId}
          onSelectTicket={onSelectTicket}
          onViewTicket={onViewTicket}
        />
      </div>
    </div>
  )
}
