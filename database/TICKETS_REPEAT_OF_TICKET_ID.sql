-- Support form: repeat ticket link + global title similarity index hints
-- Run once in Supabase SQL Editor after deploy.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS repeat_of_ticket_id uuid REFERENCES public.tickets (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_repeat_of_ticket_id
  ON public.tickets (repeat_of_ticket_id)
  WHERE repeat_of_ticket_id IS NOT NULL;

COMMENT ON COLUMN public.tickets.repeat_of_ticket_id IS
  'When user confirms a repeat issue on Support submit, points to the prior similar ticket.';

-- Helps global title ILIKE + recent-first scans (Support similar-title search, target <500ms)
CREATE INDEX IF NOT EXISTS idx_tickets_created_at_desc
  ON public.tickets (created_at DESC);

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification: global similar title search (all companies)
-- ---------------------------------------------------------------------------
-- SELECT reference_no, company_name, title, type, created_at
-- FROM public.tickets
-- WHERE title ILIKE '%your phrase%'
-- ORDER BY created_at DESC
-- LIMIT 20;
