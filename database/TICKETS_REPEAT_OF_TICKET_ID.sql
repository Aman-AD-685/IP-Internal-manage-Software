-- Repeat ticket link: child tickets created via Similar Ticket Suggestions
-- Run once in Supabase SQL Editor after deploy.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS repeat_of_ticket_id uuid REFERENCES public.tickets (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_repeat_of_ticket_id
  ON public.tickets (repeat_of_ticket_id)
  WHERE repeat_of_ticket_id IS NOT NULL;

COMMENT ON COLUMN public.tickets.repeat_of_ticket_id IS
  'Points to the original ticket when a new ticket was created from Similar Ticket Suggestions (Use).';

-- Helps global title ILIKE + recent-first scans (Support similar-title search)
CREATE INDEX IF NOT EXISTS idx_tickets_created_at_desc
  ON public.tickets (created_at DESC);

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification: children of a parent ticket
-- ---------------------------------------------------------------------------
-- SELECT reference_no, company_name, title, type, created_at
-- FROM public.tickets
-- WHERE repeat_of_ticket_id = '<parent-uuid>'
-- ORDER BY created_at DESC;

-- ---------------------------------------------------------------------------
-- Verification: child count for one parent (list "Repeated" column)
-- ---------------------------------------------------------------------------
-- SELECT
--   p.reference_no AS parent_ref,
--   count(c.id) AS child_count
-- FROM public.tickets p
-- LEFT JOIN public.tickets c ON c.repeat_of_ticket_id = p.id
-- WHERE p.reference_no = 'CH-0543'
-- GROUP BY p.reference_no;

-- ---------------------------------------------------------------------------
-- Verification: all parents with at least one child
-- ---------------------------------------------------------------------------
-- SELECT
--   p.reference_no,
--   p.title,
--   p.company_name,
--   count(c.id) AS repeated_count
-- FROM public.tickets p
-- JOIN public.tickets c ON c.repeat_of_ticket_id = p.id
-- GROUP BY p.id, p.reference_no, p.title, p.company_name
-- ORDER BY repeated_count DESC
-- LIMIT 50;

-- ---------------------------------------------------------------------------
-- Verification: ticket created from similar suggestion (parent + child)
-- ---------------------------------------------------------------------------
-- SELECT
--   child.reference_no AS child_ref,
--   child.company_name AS child_company,
--   parent.reference_no AS parent_ref,
--   parent.title AS parent_title
-- FROM public.tickets child
-- JOIN public.tickets parent ON parent.id = child.repeat_of_ticket_id
-- ORDER BY child.created_at DESC
-- LIMIT 20;
