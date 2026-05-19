-- Soumya Dashboard KPI: ticket SLA fields + weekly trend snapshots.
-- Run once in Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- Tickets: Soumya SLA / deadline tracking (chores & bugs + optional feature)
-- ---------------------------------------------------------------------------
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS stage2_entry_at timestamptz,
  ADD COLUMN IF NOT EXISTS committed_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_priority text,
  ADD COLUMN IF NOT EXISTS deadline_email_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS ack_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS interrupted_by_urgent boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.tickets.stage2_entry_at IS 'When ticket entered Stage 2 (development).';
COMMENT ON COLUMN public.tickets.committed_deadline IS 'Soumya committed deadline for Support to close.';
COMMENT ON COLUMN public.tickets.closed_at IS 'When ticket was fully closed (Stage 4 completed).';
COMMENT ON COLUMN public.tickets.sla_priority IS 'P1, P2, or P3 for Soumya SLA dashboard.';
COMMENT ON COLUMN public.tickets.deadline_email_sent_at IS 'When deadline reminder email was sent to Support.';
COMMENT ON COLUMN public.tickets.ack_received_at IS 'When Support acknowledged the deadline email.';

-- Backfill from existing SLA columns where possible
UPDATE public.tickets
SET stage2_entry_at = COALESCE(stage2_entry_at, actual_1::timestamptz)
WHERE type IN ('chore', 'bug')
  AND LOWER(COALESCE(status_1::text, '')) = 'no'
  AND actual_1 IS NOT NULL;

UPDATE public.tickets
SET closed_at = COALESCE(closed_at, actual_4::timestamptz)
WHERE type IN ('chore', 'bug')
  AND LOWER(COALESCE(status_4::text, '')) = 'completed'
  AND actual_4 IS NOT NULL;

-- Backfill Soumya committed deadline for deadline-adherence KPI (when column is empty)
UPDATE public.tickets
SET committed_deadline = actual_3::timestamptz + interval '2 hours'
WHERE type IN ('chore', 'bug')
  AND committed_deadline IS NULL
  AND LOWER(COALESCE(status_3::text, '')) = 'completed'
  AND actual_3 IS NOT NULL;

UPDATE public.tickets
SET committed_deadline = COALESCE(query_arrival_at, created_at) + interval '1 day'
WHERE type IN ('chore', 'bug')
  AND committed_deadline IS NULL
  AND COALESCE(query_arrival_at, created_at) IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_stage2_open
  ON public.tickets (stage2_entry_at)
  WHERE type IN ('chore', 'bug') AND LOWER(COALESCE(status_2::text, '')) IN ('pending', 'hold', 'staging');

CREATE INDEX IF NOT EXISTS idx_tickets_soumya_closed
  ON public.tickets (closed_at)
  WHERE closed_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Weekly snapshots for trend lines (Cards 3 & 6)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.soumya_sla_weekly_snapshots (
  week_start date PRIMARY KEY,
  escalation_count integer NOT NULL DEFAULT 0,
  sla_breach_count integer NOT NULL DEFAULT 0,
  avg_resolution_hours numeric,
  deadline_adherence_pct numeric,
  ack_avg_hours numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.soumya_sla_weekly_snapshots IS 'Soumya Dashboard weekly KPI history for trend charts.';
