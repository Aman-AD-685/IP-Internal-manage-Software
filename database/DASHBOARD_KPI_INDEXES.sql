-- Dashboard KPI + I-1 performance indexes (run once in Supabase SQL Editor).
-- Safe to re-run (IF NOT EXISTS). Pair with TICKETS_OPEN_QUEUE_INDEXES.sql.

CREATE INDEX IF NOT EXISTS idx_tickets_type_actual_2
  ON public.tickets (type, actual_2)
  WHERE type IN ('chore', 'bug');

CREATE INDEX IF NOT EXISTS idx_improvement_suggestions_created_at
  ON public.improvement_suggestions (created_at DESC);

NOTIFY pgrst, 'reload schema';
