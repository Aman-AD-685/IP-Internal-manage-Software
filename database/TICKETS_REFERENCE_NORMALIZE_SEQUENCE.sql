-- =============================================================================
-- Normalize Support ticket reference_no into a clean per-type sequence
-- Format: EX-CH-0001, EX-BU-0001, EX-FE-0001 (numbered by created_at, then id)
-- Table: public.tickets
--
-- WHY two UPDATE steps?  reference_no must stay UNIQUE — you cannot swap two rows
-- in one UPDATE without violating the unique index between statement checks.
--
-- BEFORE running on production:
--   1) Preview with the SELECT at the bottom.
--   2) If other rows store tickets.reference_no (onboarding payments, emails),
--      plan to update those or accept broken links unless you migrate them too.
--
-- BACKUP recommended: export tickets (id, type, reference_no, created_at) first.
-- =============================================================================

BEGIN;

-- Phase 1: move existing references out of the way (one unique placeholder per row)
UPDATE public.tickets
SET reference_no = '__staging__' || replace(id::text, '-', '');

-- Phase 2: assign sequential refs per ticket type (chore → EX-CH-, bug → EX-BU-, feature → EX-FE-)
WITH numbered AS (
  SELECT
    t.id,
    'EX-CH-' || lpad(row_number() OVER (
      PARTITION BY t.type ORDER BY t.created_at ASC NULLS LAST, t.id
    )::text, 4, '0') AS new_reference_no
  FROM public.tickets t
  WHERE t.type = 'chore'
  UNION ALL
  SELECT
    t.id,
    'EX-BU-' || lpad(row_number() OVER (
      PARTITION BY t.type ORDER BY t.created_at ASC NULLS LAST, t.id
    )::text, 4, '0')
  FROM public.tickets t
  WHERE t.type = 'bug'
  UNION ALL
  SELECT
    t.id,
    'EX-FE-' || lpad(row_number() OVER (
      PARTITION BY t.type ORDER BY t.created_at ASC NULLS LAST, t.id
    )::text, 4, '0')
  FROM public.tickets t
  WHERE t.type = 'feature'
)
UPDATE public.tickets t
SET reference_no = n.new_reference_no
FROM numbered n
WHERE t.id = n.id;

COMMIT;


-- -----------------------------------------------------------------------------
-- OPTIONAL: remap Client Payment rows that store the same ticket reference_no
-- (only if onboarding_client_payment.reference_no matched old ticket refs)
-- Run AFTER the above if you maintain those strings in sync manually.
--
-- WARNING: uncomment and adjust OLD→NEW mapping if you use exact old references;
-- safest is usually to leave payment refs as historically recorded unless you map them.
--
-- CREATE TEMP TABLE ticket_ref_migration AS
-- SELECT id AS ticket_id,
--        reference_no AS new_ref,
--        NULL::text AS old_ref -- fill from backup if mapping
-- FROM public.tickets;
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- PREVIEW ONLY (same numbering rules — run before COMMIT/BEGIN transaction)
-- -----------------------------------------------------------------------------
/*
SELECT
  t.id,
  t.type,
  t.reference_no AS current_reference_no,
  CASE t.type
    WHEN 'chore' THEN 'EX-CH-' || lpad(row_number() OVER (
      PARTITION BY t.type ORDER BY t.created_at ASC NULLS LAST, t.id
    )::text, 4, '0')
    WHEN 'bug' THEN 'EX-BU-' || lpad(row_number() OVER (
      PARTITION BY t.type ORDER BY t.created_at ASC NULLS LAST, t.id
    )::text, 4, '0')
    WHEN 'feature' THEN 'EX-FE-' || lpad(row_number() OVER (
      PARTITION BY t.type ORDER BY t.created_at ASC NULLS LAST, t.id
    )::text, 4, '0')
  END AS proposed_reference_no,
  t.created_at
FROM public.tickets t
ORDER BY t.type, t.created_at ASC NULLS LAST, t.id;
*/
