import { PageSkeleton } from './skeletons'
import { Skeleton } from 'antd'

interface LoadingSpinnerProps {
  fullPage?: boolean
  size?: 'small' | 'default' | 'large'
  tip?: string
}

/** Skeleton-only loading — no dot/spin animation */
export const LoadingSpinner = ({ fullPage = false, size = 'default' }: LoadingSpinnerProps) => {
  if (fullPage) {
    return <PageSkeleton />
  }

  const rows = size === 'large' ? 6 : size === 'small' ? 2 : 4
  return (
    <div style={{ padding: 16, width: '100%' }} aria-busy aria-label="Loading">
      <Skeleton active title={{ width: '40%' }} paragraph={{ rows }} />
    </div>
  )
}
