-- =============================================================================
-- ONE-SHOT FIX: EX-FE-0001 → next proper FE-xxxx (e.g. FE-0107 after FE-0106)
-- Run entire script in Supabase SQL Editor.
-- =============================================================================

BEGIN;

-- Step A: move wrong ref aside (unique constraint safe)
UPDATE public.tickets
SET reference_no = '__promote_fix__' || replace(id::text, '-', '')
WHERE type = 'feature'
  AND reference_no = 'EX-FE-0001';

-- Step B: assign next FE number from real FE-* sequence (ignores EX-FE wrong rows)
WITH legit_max AS (
  SELECT COALESCE(
    MAX((substring(reference_no FROM 'FE-(\d+)$'))::int),
    0
  ) AS m
  FROM public.tickets
  WHERE type = 'feature'
    AND reference_no ~* '^FE-\d+$'
),
to_fix AS (
  SELECT id
  FROM public.tickets
  WHERE reference_no LIKE '__promote_fix__%'
)
UPDATE public.tickets t
SET reference_no = 'FE-' || lpad((legit_max.m + 1)::text, 4, '0')
FROM to_fix f
CROSS JOIN legit_max
WHERE t.id = f.id;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- VERIFY (should show FE-0107 or next after your max FE-*)
SELECT reference_no, source_reference_no, title, company_name
FROM public.tickets
WHERE type = 'feature'
  AND (reference_no ~* '^FE-\d+$' OR source_reference_no IS NOT NULL)
ORDER BY reference_no DESC
LIMIT 10;
