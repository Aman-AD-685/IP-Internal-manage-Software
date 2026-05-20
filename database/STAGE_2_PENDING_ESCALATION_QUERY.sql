-- =============================================================================
-- Stage 2 pending tickets — Reference No & Time Delay (matches escalation email)
-- Run in Supabase SQL Editor.
--
-- Logic mirrors:
--   backend/app/reminder_utils.py  → get_chores_bugs_stage (stage_num = 2)
--   backend/app/escalation_email_service.py → _pending_since_iso, _format_delay
--
-- Time delay anchor for Stage 2 escalation rows:
--   COALESCE(query_arrival_at, created_at) → hours since → "Xd Yh" / "Xh" / "Xm"
--
-- Optional: add   AND lower(trim(coalesce(t.status_2::text, ''))) = 'pending'
--   to match Chores & Bugs UI filter "Stage 2 status = Pending" only.
-- =============================================================================

WITH base AS (
  SELECT
    t.id,
    t.reference_no,
    t.type,
    t.status_1,
    t.status_2,
    t.status_3,
    t.status_4,
    t.status,
    t.resolved_at,
    t.quality_solution,
    t.live_review_status,
    t.staging_planned,
    t.company_name,
    COALESCE(t.query_arrival_at, t.created_at) AS pending_since,
    CASE
      WHEN t.status_1 IS NULL THEN 1
      WHEN lower(trim(coalesce(t.status_1::text, ''))) = 'yes' THEN 4
      WHEN lower(trim(coalesce(t.status_1::text, ''))) = 'no'
           AND (t.status_2 IS NULL OR trim(coalesce(t.status_2::text, '')) = '') THEN 2
      WHEN lower(trim(coalesce(t.status_2::text, ''))) = 'completed'
           AND (t.status_3 IS NULL OR trim(coalesce(t.status_3::text, '')) = '') THEN 3
      WHEN lower(trim(coalesce(t.status_2::text, ''))) = 'completed' THEN 4
      ELSE 2
    END AS stage_num
  FROM public.tickets t
  WHERE t.type IN ('chore', 'bug')
    AND t.quality_solution IS NULL
    -- Open ticket (escalation _is_open_ticket)
    AND lower(coalesce(t.status_4::text, '')) NOT IN ('completed', 'complete', 'done')
    AND t.resolved_at IS NULL
    AND lower(coalesce(t.status::text, '')) NOT IN (
      'completed', 'resolved', 'closed', 'cancelled', 'fixed'
    )
    AND NOT (
      lower(coalesce(t.live_review_status::text, '')) = 'completed'
      AND (t.staging_planned IS NULL OR trim(coalesce(t.staging_planned::text, '')) = '')
    )
    -- Exclude Demo C (escalation emails)
    AND lower(
          regexp_replace(replace(trim(coalesce(t.company_name::text, '')), '_', ' '), '\s+', ' ', 'g')
        ) NOT IN ('demo c', 'democ')
),
hours AS (
  SELECT
    b.*,
    GREATEST(
      0,
      EXTRACT(EPOCH FROM (timezone('UTC', now()) - timezone('UTC', b.pending_since))) / 3600.0
    ) AS hours_pending
  FROM base b
  WHERE b.stage_num = 2
    AND b.pending_since IS NOT NULL
)
SELECT
  COALESCE(NULLIF(trim(h.reference_no::text), ''), left(h.id::text, 8)) AS reference_no,
  CASE
    WHEN h.hours_pending < 1 THEN (floor(h.hours_pending * 60)::int::text || 'm')
    WHEN h.hours_pending < 24 THEN (floor(h.hours_pending)::int::text || 'h')
    WHEN (floor(h.hours_pending) % 24)::int = 0
      THEN (floor(h.hours_pending / 24)::int::text || 'd')
    ELSE
      (floor(h.hours_pending / 24)::int::text || 'd '
       || (floor(h.hours_pending) % 24)::int::text || 'h')
  END AS time_delay,
  h.hours_pending,
  h.status_2 AS stage_2_status,
  h.pending_since,
  h.company_name
FROM hours h
ORDER BY h.hours_pending DESC;


-- -----------------------------------------------------------------------------
-- Variant: Chores & Bugs list filter — Stage 2 column = "pending" only
-- (UI status_2_filter=pending) + same time_delay formula
-- -----------------------------------------------------------------------------
/*
WITH base AS (
  SELECT
    t.reference_no,
    t.id,
    t.status_2,
    t.company_name,
    COALESCE(t.query_arrival_at, t.created_at) AS pending_since
  FROM public.tickets t
  WHERE t.type IN ('chore', 'bug')
    AND t.quality_solution IS NULL
    AND lower(trim(coalesce(t.status_2::text, ''))) = 'pending'
    AND lower(coalesce(t.status_4::text, '')) NOT IN ('completed', 'complete', 'done')
    AND t.resolved_at IS NULL
    AND lower(
          regexp_replace(replace(trim(coalesce(t.company_name::text, '')), '_', ' '), '\s+', ' ', 'g')
        ) NOT IN ('demo c', 'democ')
),
hours AS (
  SELECT
    b.*,
    GREATEST(
      0,
      EXTRACT(EPOCH FROM (timezone('UTC', now()) - timezone('UTC', b.pending_since))) / 3600.0
    ) AS hours_pending
  FROM base b
  WHERE b.pending_since IS NOT NULL
)
SELECT
  COALESCE(NULLIF(trim(reference_no::text), ''), left(id::text, 8)) AS reference_no,
  CASE
    WHEN hours_pending < 1 THEN (floor(hours_pending * 60)::int::text || 'm')
    WHEN hours_pending < 24 THEN (floor(hours_pending)::int::text || 'h')
    WHEN (floor(hours_pending) % 24)::int = 0
      THEN (floor(hours_pending / 24)::int::text || 'd')
    ELSE
      (floor(hours_pending / 24)::int::text || 'd '
       || (floor(hours_pending) % 24)::int::text || 'h')
  END AS time_delay,
  hours_pending
FROM hours
ORDER BY hours_pending DESC;
*/
