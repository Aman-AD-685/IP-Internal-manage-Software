-- =============================================================================
-- Onboarding Payment Status — normalize reference_no to global ONB-0001, ONB-0002…
-- =============================================================================
-- WHY: Old app generated per-company refs (HIND-0001, DEVI-0001) so every company
--      restarted at 0001. New rule: one global sequence; next insert = max + 1.
--
-- RUN IN: Supabase SQL Editor (production or staging).
-- SAFE: Only updates public.onboarding_payment_status.reference_no.
--       Child tables use payment_status_id (UUID), not reference_no.
--
-- ORDER: Oldest timestamp first → ONB-0001, then ONB-0002, …
-- UNIQUE: two-step update (staging → final) to avoid unique collisions.
-- =============================================================================

BEGIN;

-- Preview (optional — run alone first)
-- SELECT id, reference_no AS old_ref, company_name, "timestamp",
--        'ONB-' || lpad(row_number() OVER (ORDER BY "timestamp" ASC NULLS LAST, id)::text, 4, '0') AS new_ref
-- FROM public.onboarding_payment_status
-- ORDER BY "timestamp" ASC NULLS LAST, id;

-- Step 1: temporary unique staging values
UPDATE public.onboarding_payment_status
SET reference_no = '__onb_fix__' || replace(id::text, '-', '');

-- Step 2: assign ONB-0001, ONB-0002… by creation time
WITH numbered AS (
  SELECT
    id,
    'ONB-' || lpad(
      (row_number() OVER (ORDER BY "timestamp" ASC NULLS LAST, id))::text,
      4,
      '0'
    ) AS new_reference_no
  FROM public.onboarding_payment_status
)
UPDATE public.onboarding_payment_status ops
SET reference_no = n.new_reference_no
FROM numbered n
WHERE ops.id = n.id;

COMMIT;

-- Verify
SELECT reference_no, company_name, "timestamp"
FROM public.onboarding_payment_status
ORDER BY reference_no;
