-- Verification queries for NA-marked raised invoices (dashboard + Client Payment KPIs exclude these).
-- Prerequisite: run database/CLIENT_PAYMENT_MARKED_NA.sql so column marked_na exists.
-- Note: invoice_amount is stored as text (digits only in the app).

-- 1) Count and amount by NA flag
SELECT
  marked_na,
  COUNT(*) AS row_count,
  COALESCE(SUM((NULLIF(trim(invoice_amount), ''))::numeric), 0) AS amount_sum
FROM public.onboarding_client_payment
GROUP BY marked_na
ORDER BY marked_na;

-- 2) Open (unpaid) rows only — aligns with dashboard "Total Due" first number (all-time, excl. NA)
SELECT
  COUNT(*) AS open_rows,
  COALESCE(SUM((NULLIF(trim(invoice_amount), ''))::numeric), 0) AS open_unpaid_total
FROM public.onboarding_client_payment
WHERE payment_received_date IS NULL
  AND COALESCE(marked_na, false) = false;

-- 3) Gross raised (all rows, paid + unpaid) excluding NA
SELECT
  COALESCE(SUM((NULLIF(trim(invoice_amount), ''))::numeric), 0) AS gross_raised_excl_na
FROM public.onboarding_client_payment
WHERE COALESCE(marked_na, false) = false;

-- 4) NA-marked rows (should match "NA only" filter on Client Payment)
SELECT reference_no, company_name, invoice_amount, marked_na
FROM public.onboarding_client_payment
WHERE COALESCE(marked_na, false) = true;
