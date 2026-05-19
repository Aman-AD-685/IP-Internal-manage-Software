-- Soumya Dashboard / delay leaderboard — tickets with resolved company name
-- Run in Supabase SQL Editor (read-only check) or use as view for reporting.

SELECT
  t.id,
  t.reference_no,
  t.title,
  t.type,
  t.priority,
  t.company_id,
  COALESCE(NULLIF(TRIM(c.name), ''), NULLIF(TRIM(t.company_name), '')) AS company_name,
  t.query_arrival_at,
  t.created_at,
  t.status_1,
  t.status_2,
  t.status_4,
  t.stage2_entry_at,
  t.committed_deadline
FROM public.tickets t
LEFT JOIN public.companies c ON c.id = t.company_id
WHERE LOWER(COALESCE(t.type, '')) IN ('chore', 'bug')
  AND LOWER(COALESCE(NULLIF(TRIM(c.name), ''), NULLIF(TRIM(t.company_name), ''), '')) NOT IN (
    'demo c', 'demo_c', 'democ', 'demo', 'test', 'sample', 'na', 'none'
  )
ORDER BY t.created_at DESC;

-- Optional: backfill tickets.company_name from companies (one-time fix for null names)
-- UPDATE public.tickets t
-- SET company_name = c.name
-- FROM public.companies c
-- WHERE t.company_id = c.id
--   AND (t.company_name IS NULL OR TRIM(t.company_name) = '')
--   AND c.name IS NOT NULL;
