-- Speed up Chores & Bugs open queue + dashboard pending counts (run once in Supabase SQL Editor).
-- Safe to re-run (IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS idx_tickets_type_created_at
  ON public.tickets (type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_open_queue_chore_bug
  ON public.tickets (type, status_2, status_4)
  WHERE type IN ('chore', 'bug') AND quality_solution IS NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_open_queue_feature
  ON public.tickets (type, approval_status, status_2)
  WHERE type = 'feature';

NOTIFY pgrst, 'reload schema';
