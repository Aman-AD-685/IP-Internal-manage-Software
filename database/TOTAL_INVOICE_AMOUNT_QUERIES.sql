-- =============================================================================
-- Total invoice amount — raised invoices (Client Payment)
-- Stored in public.onboarding_client_payment; invoice_amount is TEXT.
-- Link to Support tickets is typically onboarding_client_payment.reference_no = tickets.reference_no
-- Optional: marked_na excludes rows from Payment KPIs (see CLIENT_PAYMENT_MARKED_NA.sql)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Grand total — every raised invoice row
-- -----------------------------------------------------------------------------
SELECT COALESCE(SUM(v.amt), 0)::bigint AS total_invoice_amount_all_rows
FROM public.onboarding_client_payment ocp,
LATERAL (
  SELECT CASE
    WHEN ocp.invoice_amount IS NULL THEN 0::numeric
    WHEN trim(ocp.invoice_amount::text) = '' THEN 0::numeric
    WHEN trim(regexp_replace(ocp.invoice_amount::text, ',', '', 'g')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN trim(regexp_replace(ocp.invoice_amount::text, ',', '', 'g'))::numeric
    ELSE 0::numeric
  END AS amt
) v;


-- -----------------------------------------------------------------------------
-- Total excluding NA-marked (matches "raised" KPI spirit)
-- Remove the marked_na line if that column does not exist yet.
-- -----------------------------------------------------------------------------
SELECT COALESCE(SUM(v.amt), 0)::bigint AS total_invoice_amount_excl_na
FROM public.onboarding_client_payment ocp,
LATERAL (
  SELECT CASE
    WHEN COALESCE(ocp.marked_na, false) THEN 0::numeric
    WHEN ocp.invoice_amount IS NULL THEN 0::numeric
    WHEN trim(ocp.invoice_amount::text) = '' THEN 0::numeric
    WHEN trim(regexp_replace(ocp.invoice_amount::text, ',', '', 'g')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN trim(regexp_replace(ocp.invoice_amount::text, ',', '', 'g'))::numeric
    ELSE 0::numeric
  END AS amt
) v;


-- -----------------------------------------------------------------------------
-- Total only where reference_no matches an existing ticket
-- -----------------------------------------------------------------------------
SELECT COALESCE(SUM(v.amt), 0)::bigint AS total_invoice_amount_linked_tickets
FROM public.onboarding_client_payment ocp
INNER JOIN public.tickets t
  ON trim(lower(coalesce(ocp.reference_no, ''))) = trim(lower(coalesce(t.reference_no, '')))
  AND trim(lower(coalesce(ocp.reference_no, ''))) <> ''
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN ocp.invoice_amount IS NULL THEN 0::numeric
    WHEN trim(ocp.invoice_amount::text) = '' THEN 0::numeric
    WHEN trim(regexp_replace(ocp.invoice_amount::text, ',', '', 'g')) ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN trim(regexp_replace(ocp.invoice_amount::text, ',', '', 'g'))::numeric
    ELSE 0::numeric
  END AS amt
) v;
