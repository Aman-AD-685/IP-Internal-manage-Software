-- =============================================================================
-- Payment carry-forward (manual verification in Supabase SQL Editor)
-- App logic (India FY Apr–Mar): Overall KPI "Raised" = current-quarter invoiced
--   + unpaid invoices with invoice_date BEFORE current quarter start (excl. NA).
-- Overall "Received" = sum of payments whose payment date falls in current FY quarter.
-- =============================================================================

-- Replace with anchor date = "today" used for fiscal math (or parameterize in app).
-- Example: Q1 FY 2026-27 ⇒ quarter range 2026-04-01 .. 2026-06-30

-- 1) Unpaid backlog carried into Overall "raised" lens (not NA, no payment date)
--    (matches backend: invoice_date < quarter_start AND payment not saved)
/*
SELECT
  id,
  reference_no,
  company_name,
  invoice_date,
  invoice_amount,
  genre,
  payment_received_date,
  marked_na
FROM public.onboarding_client_payment
WHERE COALESCE(marked_na, false) IS NOT TRUE
  AND (payment_received_date IS NULL OR trim(payment_received_date::text) = '')
  AND invoice_date IS NOT NULL
  AND invoice_date < DATE '2026-04-01'   -- ← set to start of *current* FY quarter
ORDER BY invoice_date;
*/

-- 2) Cash collected in current FY quarter (uses receive row date, else payment_received_date)
--    Join receive table when present
/*
SELECT
  ocp.id,
  ocp.reference_no,
  ocp.company_name,
  ocp.invoice_date,
  ocp.invoice_amount,
  COALESCE(r.payment_date, ocp.payment_received_date::date) AS effective_pay_date,
  COALESCE(r.amount::numeric, NULLIF(trim(replace(ocp.invoice_amount::text, ',', '')), '')::numeric, 0)::bigint AS amount_used
FROM public.onboarding_client_payment ocp
LEFT JOIN public.onboarding_client_payment_receive r ON r.client_payment_id = ocp.id
WHERE COALESCE(ocp.marked_na, false) IS NOT TRUE
  AND COALESCE(r.payment_date, ocp.payment_received_date::date) IS NOT NULL
  AND COALESCE(r.payment_date, ocp.payment_received_date::date)
      BETWEEN DATE '2026-04-01' AND DATE '2026-06-30'  -- ← current FY quarter inclusive
ORDER BY effective_pay_date;
*/

-- 3) Support tickets still “open queue” by created_at before quarter (approximate;
--    production UI uses chores-bugs SLA rules—use app lists for exact pending set)
/*
SELECT id, reference_no, type, title, status, created_at
FROM public.tickets
WHERE type IN ('chore', 'bug')
  AND created_at < TIMESTAMPTZ '2026-04-01'
  AND lower(coalesce(status::text, '')) NOT IN ('closed', 'cancelled', 'resolved')
ORDER BY created_at DESC
LIMIT 500;
*/
