-- Claude Review stale reset (24 weekday hours; Sat/Sun excluded).
-- IST (Asia/Kolkata) for weekend boundaries.
-- Run SELECT (preview) first, then UPDATE when ready.
-- Also auto-runs on GET /api/integrations/support/claude-review.

-- ---------------------------------------------------------------------------
-- PREVIEW: tickets that will lose (C.R) / Claude Review
-- ---------------------------------------------------------------------------
WITH hours AS (
  SELECT
    t.id,
    t.reference_no,
    t.type,
    t.status_2,
    t.claude_reviewed_at,
    (
      SELECT COUNT(*)::int
      FROM generate_series(
        date_trunc('hour', t.claude_reviewed_at AT TIME ZONE 'Asia/Kolkata'),
        date_trunc('hour', (now() AT TIME ZONE 'Asia/Kolkata')) - interval '1 hour',
        interval '1 hour'
      ) AS h(ts)
      WHERE EXTRACT(DOW FROM h.ts) NOT IN (0, 6)  -- 0=Sun, 6=Sat
    ) AS weekday_hours
  FROM public.tickets t
  WHERE t.type IN ('chore', 'bug')
    AND LOWER(COALESCE(t.status_2::text, '')) = 'pending'
    AND t.quality_solution IS NULL
    AND t.claude_reviewed_at IS NOT NULL
    AND t.repeat_of_ticket_id IS NULL
    AND (t.staging_planned IS NULL OR LOWER(COALESCE(t.live_review_status::text, '')) = 'completed')
)
SELECT id, reference_no, type, status_2, claude_reviewed_at, weekday_hours
FROM hours
WHERE weekday_hours >= 24
ORDER BY claude_reviewed_at;

-- ---------------------------------------------------------------------------
-- RESET: clear Claude Review so ticket is pullable again as pending
-- ---------------------------------------------------------------------------
WITH due AS (
  SELECT t.id
  FROM public.tickets t
  WHERE t.type IN ('chore', 'bug')
    AND LOWER(COALESCE(t.status_2::text, '')) = 'pending'
    AND t.quality_solution IS NULL
    AND t.claude_reviewed_at IS NOT NULL
    AND t.repeat_of_ticket_id IS NULL
    AND (t.staging_planned IS NULL OR LOWER(COALESCE(t.live_review_status::text, '')) = 'completed')
    AND (
      SELECT COUNT(*)::int
      FROM generate_series(
        date_trunc('hour', t.claude_reviewed_at AT TIME ZONE 'Asia/Kolkata'),
        date_trunc('hour', (now() AT TIME ZONE 'Asia/Kolkata')) - interval '1 hour',
        interval '1 hour'
      ) AS h(ts)
      WHERE EXTRACT(DOW FROM h.ts) NOT IN (0, 6)
    ) >= 24
)
UPDATE public.tickets t
SET
  claude_reviewed_at = NULL,
  updated_at = now()
FROM due
WHERE t.id = due.id
RETURNING t.id, t.reference_no, t.status_2, t.claude_reviewed_at;
