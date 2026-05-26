import { Fragment } from 'react'
import { Alert, Typography } from 'antd'
import { CheckSquareOutlined } from '@ant-design/icons'
import {
  resolveChecklistCronUrl,
  resolveCronRunAllEmailsUrl,
  resolveDelegationCronUrl,
} from '../../api/axios'

const { Title, Paragraph, Text } = Typography

/** Per-user checklist & delegation reminders; timing via cron-job.org. */
export function ChecklistDelegationEmailSettings() {
  const checklistUrl = resolveChecklistCronUrl()
  const delegationUrl = resolveDelegationCronUrl()
  const allUrl = resolveCronRunAllEmailsUrl()

  return (
    <Fragment>
      <Title level={4}>
        <CheckSquareOutlined style={{ marginRight: 8 }} />
        Checklist &amp; Delegation email reminders
      </Title>
      <Paragraph type="secondary">
        <Text strong>User-wise delivery:</Text> each person with tasks due today (checklist) or overdue delegation work gets{' '}
        <Text strong>one email to their own login address</Text>. Configure send times on{' '}
        <Text strong>cron-job.org</Text> (see URLs below).
      </Paragraph>
      <Alert
        type="info"
        showIcon
        style={{ maxWidth: 900, marginBottom: 12 }}
        message="cron-job.org URLs"
        description={
          <div>
            <div style={{ marginBottom: 8 }}>
              <Text strong>All modules (one job)</Text> — <Text code copyable>{allUrl}</Text>
            </div>
            <div>
              <Text strong>Checklist only</Text> — <Text code copyable>{checklistUrl}</Text>
            </div>
            <div style={{ marginTop: 8 }}>
              <Text strong>Delegation only</Text> — <Text code copyable>{delegationUrl}</Text>
            </div>
            <p style={{ margin: '8px 0 0' }}>
              Header: <Text code>X-Cron-Secret</Text> = <Text code>FEATURE_APPROVAL_CRON_SECRET</Text>. Details:{' '}
              <Text code>database/CRON_JOB_ORG_SETUP.md</Text>
            </p>
          </div>
        }
      />
      <Alert
        type="success"
        showIcon
        style={{ maxWidth: 900 }}
        message="How it works"
        description={
          <ul style={{ marginBottom: 0, paddingLeft: 20 }}>
            <li>Checklist: emails go to each <Text strong>doer</Text> with incomplete checklist items due today.</li>
            <li>Delegation: emails go to each <Text strong>assignee</Text> with pending/overdue delegation tasks.</li>
            <li>At most one reminder per user per day (dedup in Supabase).</li>
            <li>
              No emails on <Text strong>Sundays</Text> or dates in{' '}
              <Text strong>Checklist → Upload Holiday List</Text> (same 7 holidays as checklist).
            </li>
          </ul>
        }
      />
    </Fragment>
  )
}
