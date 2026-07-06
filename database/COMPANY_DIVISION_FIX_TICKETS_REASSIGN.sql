-- =============================================================================
-- FIX: Tickets wrongly linked to demo company "Company A" (or B/C)
--
-- Problem: company_id = 2142d04b-... (Company A) but company_name shows real client
--          e.g. BIHAR FOUNDRY, Flexicom Industries Pvt. Ltd., etc.
--
-- This script REASSIGNS company_id from tickets.company_name → public.companies
-- BEFORE deleting test companies (E1W, Company A/B/C, Example Steel).
--
-- Run in Supabase SQL Editor. BACK UP first.
-- If you are still inside the delete script transaction: ROLLBACK; first.
-- =============================================================================

-- Still in an open transaction from delete preview? Undo everything:
-- ROLLBACK;

-- Demo / test company IDs to fix away from (adjust if your preview shows different UUIDs)
DROP TABLE IF EXISTS _demo_company_ids;
CREATE TEMP TABLE _demo_company_ids AS
SELECT c.id, c.name
FROM public.companies c
WHERE lower(trim(regexp_replace(c.name, '\s+', ' ', 'g'))) = ANY (
  ARRAY['company a', 'company b', 'company c']
);

-- ---------------------------------------------------------------------------
-- 1) PREVIEW — tickets on demo company_id but company_name is NOT the demo name
-- ---------------------------------------------------------------------------
SELECT
  t.reference_no,
  t.company_id AS wrong_company_id,
  dc.name AS wrong_company_master_name,
  t.company_name AS ticket_company_name,
  c_match.id AS should_be_company_id,
  c_match.name AS should_be_company_name
FROM public.tickets t
JOIN _demo_company_ids dc ON dc.id = t.company_id
LEFT JOIN public.companies c_match
  ON lower(trim(regexp_replace(c_match.name, '\s+', ' ', 'g')))
   = lower(trim(regexp_replace(t.company_name, '\s+', ' ', 'g')))
WHERE t.company_name IS NOT NULL
  AND trim(t.company_name) <> ''
  AND lower(trim(regexp_replace(t.company_name, '\s+', ' ', 'g')))
      <> lower(trim(regexp_replace(dc.name, '\s+', ' ', 'g')))
ORDER BY t.reference_no;

-- Count: how many will be fixed vs still unmatched
SELECT
  count(*) FILTER (WHERE c_match.id IS NOT NULL) AS will_reassign,
  count(*) FILTER (WHERE c_match.id IS NULL) AS unmatched_no_master_row
FROM public.tickets t
JOIN _demo_company_ids dc ON dc.id = t.company_id
LEFT JOIN public.companies c_match
  ON lower(trim(regexp_replace(c_match.name, '\s+', ' ', 'g')))
   = lower(trim(regexp_replace(t.company_name, '\s+', ' ', 'g')))
WHERE t.company_name IS NOT NULL
  AND trim(t.company_name) <> ''
  AND lower(trim(regexp_replace(t.company_name, '\s+', ' ', 'g')))
      <> lower(trim(regexp_replace(dc.name, '\s+', ' ', 'g')));

-- ---------------------------------------------------------------------------
-- 2) REASSIGN company_id from company_name (exact normalized name match)
-- ---------------------------------------------------------------------------
BEGIN;

UPDATE public.tickets t
SET company_id = c_match.id
FROM _demo_company_ids dc
JOIN public.companies c_match
  ON lower(trim(regexp_replace(c_match.name, '\s+', ' ', 'g')))
   = lower(trim(regexp_replace(t.company_name, '\s+', ' ', 'g')))
WHERE t.company_id = dc.id
  AND t.company_name IS NOT NULL
  AND trim(t.company_name) <> ''
  AND lower(trim(regexp_replace(t.company_name, '\s+', ' ', 'g')))
      <> lower(trim(regexp_replace(dc.name, '\s+', ' ', 'g')));

-- Optional: set division_id when division text matches a row for the new company
UPDATE public.tickets t
SET division_id = d.id
FROM public.divisions d
WHERE t.company_id = d.company_id
  AND t.division_id IS NULL
  AND t.division IS NOT NULL
  AND trim(t.division) <> ''
  AND lower(trim(t.division)) = lower(trim(d.name));

-- ---------------------------------------------------------------------------
-- 3) VERIFY — should be 0 or only rows where company_name really is "Company A"
-- ---------------------------------------------------------------------------
SELECT
  'still_wrong' AS section,
  t.reference_no,
  t.company_id,
  t.company_name
FROM public.tickets t
JOIN _demo_company_ids dc ON dc.id = t.company_id
WHERE lower(trim(regexp_replace(coalesce(t.company_name, ''), '\s+', ' ', 'g')))
      <> lower(trim(regexp_replace(dc.name, '\s+', ' ', 'g')))
ORDER BY t.reference_no
LIMIT 200;

-- Unmatched names (add these companies to master first, then re-run step 2)
SELECT DISTINCT trim(t.company_name) AS unmatched_company_name
FROM public.tickets t
JOIN _demo_company_ids dc ON dc.id = t.company_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.companies c
  WHERE lower(trim(regexp_replace(c.name, '\s+', ' ', 'g')))
      = lower(trim(regexp_replace(t.company_name, '\s+', ' ', 'g')))
)
ORDER BY 1;

COMMIT;
-- ROLLBACK;  -- use instead of COMMIT to undo

NOTIFY pgrst, 'reload schema';
