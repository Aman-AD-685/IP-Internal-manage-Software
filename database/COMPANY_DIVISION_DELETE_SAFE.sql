-- =============================================================================
-- SAFE DELETE test companies (after COMPANY_DIVISION_FIX_TICKETS_REASSIGN.sql)
--
-- Deletes ONLY rows with no remaining ticket links:
--   Example Steel Pvt Ltd., E1W, Company A, Company B, Company C
-- =============================================================================

BEGIN;

DROP TABLE IF EXISTS _delete_company_targets;
CREATE TEMP TABLE _delete_company_targets AS
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

-- Must be empty before delete (reassign tickets first!)
SELECT
  'BLOCKER_tickets_still_linked' AS section,
  t.reference_no,
  t.company_id,
  t.company_name
FROM public.tickets t
WHERE t.company_id IN (SELECT id FROM _delete_company_targets);

-- Only unlink tickets that truly belong to test names (rare after reassign)
UPDATE public.tickets t
SET company_id = NULL, company_name = NULL, division_id = NULL, division = NULL
WHERE t.company_id IN (SELECT id FROM _delete_company_targets)
  AND lower(trim(regexp_replace(coalesce(t.company_name, ''), '\s+', ' ', 'g'))) = ANY (
    ARRAY['company a', 'company b', 'company c', 'e1w', 'example steel pvt ltd.', 'example steel pvt. ltd.']
  );

DELETE FROM public.divisions d
WHERE d.company_id IN (SELECT id FROM _delete_company_targets);

DELETE FROM public.companies c
WHERE c.id IN (SELECT id FROM _delete_company_targets)
  AND NOT EXISTS (
    SELECT 1 FROM public.tickets t WHERE t.company_id = c.id
  );

SELECT id, name FROM public.companies
WHERE id IN (SELECT id FROM _delete_company_targets);
-- ^ should return 0 rows if delete succeeded

COMMIT;

NOTIFY pgrst, 'reload schema';
