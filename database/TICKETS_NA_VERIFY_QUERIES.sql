-- Support tickets NA (status_2 = 'na'): hidden from default lists/KPI; visible when Status filter = NA.
-- No new column required if status_2 already allows 'na'. If updates fail, widen the check constraint.

-- STEP 0: allow NA in status_2 (skip if your DB already accepts it)
-- ALTER TABLE public.tickets DROP CONSTRAINT IF EXISTS tickets_status_2_check;
-- ALTER TABLE public.tickets ADD CONSTRAINT tickets_status_2_check
--   CHECK (status_2 IS NULL OR status_2 IN (
--     'pending', 'completed', 'staging', 'hold', 'na', 'rejected'
--   ));

-- Chores/bugs marked NA (Stage 2)
SELECT id, reference_no, type, status_2, actual_2, company_name
FROM public.tickets
WHERE type IN ('chore', 'bug')
  AND lower(trim(coalesce(status_2::text, ''))) = 'na'
ORDER BY updated_at DESC NULLS LAST
LIMIT 50;

-- Features marked NA (Stage 1)
SELECT id, reference_no, type, status_2, actual_1, company_name, approval_status
FROM public.tickets
WHERE type = 'feature'
  AND lower(trim(coalesce(status_2::text, ''))) = 'na'
ORDER BY updated_at DESC NULLS LAST
LIMIT 50;

-- Count NA rows in open chores queue (for manual check after marking NA)
SELECT count(*) AS na_in_open_queue
FROM public.tickets
WHERE type IN ('chore', 'bug')
  AND quality_solution IS NULL
  AND lower(trim(coalesce(status_2::text, ''))) = 'na';
