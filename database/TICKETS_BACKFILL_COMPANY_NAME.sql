-- Backfill tickets.company_name from companies master (run once in Supabase SQL Editor)
-- Fixes similar-ticket panel showing "—" when company_id is set but company_name is empty.

-- 1) Preview rows that will be updated
SELECT
  t.reference_no,
  t.company_id,
  t.company_name AS current_name,
  c.name AS resolved_name
FROM public.tickets t
JOIN public.companies c ON c.id = t.company_id
WHERE t.company_id IS NOT NULL
  AND (
    t.company_name IS NULL
    OR trim(t.company_name) = ''
    OR lower(trim(t.company_name)) IN (
      'null', 'none', '-', 'unknown', 'n/a', 'na', 'test', 'sample',
      'demo', 'demo_c', 'demo c', 'company a', 'company b', 'company c'
    )
  )
ORDER BY t.reference_no
LIMIT 100;

-- 2) Backfill from companies table
UPDATE public.tickets t
SET company_name = c.name
FROM public.companies c
WHERE t.company_id = c.id
  AND (
    t.company_name IS NULL
    OR trim(t.company_name) = ''
    OR lower(trim(t.company_name)) IN (
      'null', 'none', '-', 'unknown', 'n/a', 'na', 'test', 'sample',
      'demo', 'demo_c', 'demo c', 'company a', 'company b', 'company c'
    )
  );

-- 3) Verify a specific ticket (example: BU-0040)
SELECT reference_no, company_id, company_name, title
FROM public.tickets
WHERE reference_no = 'BU-0040';

-- 4) Count remaining tickets still missing company name despite company_id
SELECT count(*) AS still_missing
FROM public.tickets
WHERE company_id IS NOT NULL
  AND (company_name IS NULL OR trim(company_name) = '');

NOTIFY pgrst, 'reload schema';
