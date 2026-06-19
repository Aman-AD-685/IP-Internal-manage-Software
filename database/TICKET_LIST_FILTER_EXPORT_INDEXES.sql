-- Ticket list filters + Print/Export performance
-- Safe to run multiple times in Supabase SQL Editor.
-- No schema changes; only indexes for current Support Ticket filters.

CREATE INDEX IF NOT EXISTS idx_tickets_company_created_at_desc
  ON public.tickets (company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_type_status2_created_at_desc
  ON public.tickets (type, status_2, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_type_approval_created_at_desc
  ON public.tickets (type, approval_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_priority_created_at_desc
  ON public.tickets (priority, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tickets_reference_no_created_at_desc
  ON public.tickets (reference_no, created_at DESC);

NOTIFY pgrst, 'reload schema';
