-- =============================================================================
-- Delete test / unwanted companies + divisions (Support ticket dropdowns)
-- Run in Supabase SQL Editor.
--
-- Targets (case-insensitive, extra spaces ignored):
--   Example Steel Pvt Ltd. / Example Steel Pvt. Ltd.
--   E1W
--   Company A, Company B, Company C  (demo fallback rows)
--
-- Order: preview → clear ticket links (if any) → divisions → companies
-- BACK UP first if unsure.
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS _delete_company_targets;
CREATE TEMP TABLE _delete_company_targets AS
SELECT
  c.id,
  c.name,
  lower(trim(regexp_replace(c.name, '\s+', ' ', 'g'))) AS norm_name
FROM public.companies c
WHERE lower(trim(regexp_replace(c.name, '\s+', ' ', 'g'))) = ANY (
  ARRAY[
    'example steel pvt ltd.',
    'example steel pvt. ltd.',
    'e1w',
    'company a',
    'company b',
    'company c'
  ]
);

-- ---------------------------------------------------------------------------
-- 1) PREVIEW — run this block alone first if you only want to inspect
-- ---------------------------------------------------------------------------
SELECT 'companies_to_delete' AS section, id, name FROM _delete_company_targets ORDER BY name;

SELECT
  'divisions_to_delete' AS section,
  d.id AS division_id,
  d.name AS division_name,
  c.name AS company_name
FROM public.divisions d
JOIN _delete_company_targets c ON c.id = d.company_id
ORDER BY c.name, d.name;

SELECT
  'tickets_linked' AS section,
  t.id,
  t.reference_no,
  t.company_id,
  t.company_name,
  t.division_id,
  t.division
FROM public.tickets t
WHERE t.company_id IN (SELECT id FROM _delete_company_targets)
   OR t.division_id IN (
     SELECT d.id FROM public.divisions d
     WHERE d.company_id IN (SELECT id FROM _delete_company_targets)
   )
ORDER BY t.reference_no
LIMIT 200;

-- ---------------------------------------------------------------------------
-- 2) Unlink tickets (so company delete is not blocked by FK)
--    Keeps ticket rows; clears company/division pointers only.
-- ---------------------------------------------------------------------------
UPDATE public.tickets t
SET
  division_id = NULL,
  division = NULL
WHERE t.division_id IN (
  SELECT d.id FROM public.divisions d
  WHERE d.company_id IN (SELECT id FROM _delete_company_targets)
);

UPDATE public.tickets t
SET
  company_id = NULL,
  company_name = NULL
WHERE t.company_id IN (SELECT id FROM _delete_company_targets);

-- If your tickets.company_id is NOT NULL, use instead:
--   DELETE FROM public.tickets
--   WHERE company_id IN (SELECT id FROM _delete_company_targets);

-- ---------------------------------------------------------------------------
-- 3) Delete divisions, then companies
-- ---------------------------------------------------------------------------
DELETE FROM public.divisions d
WHERE d.company_id IN (SELECT id FROM _delete_company_targets);

DELETE FROM public.companies c
WHERE c.id IN (SELECT id FROM _delete_company_targets);

-- ---------------------------------------------------------------------------
-- 4) Verify — should return 0 rows
-- ---------------------------------------------------------------------------
SELECT c.id, c.name
FROM public.companies c
WHERE lower(trim(regexp_replace(c.name, '\s+', ' ', 'g'))) = ANY (
  ARRAY[
    'example steel pvt ltd.',
    'example steel pvt. ltd.',
    'e1w',
    'company a',
    'company b',
    'company c'
  ]
);

COMMIT;
-- To abort instead of saving: ROLLBACK;

NOTIFY pgrst, 'reload schema';
