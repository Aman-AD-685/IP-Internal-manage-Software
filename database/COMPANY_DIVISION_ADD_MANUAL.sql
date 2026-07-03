-- =============================================================================
-- Add Company & Division (Support Tickets dropdowns)
-- Run in Supabase SQL Editor when adding manually (optional).
-- The app "Add Company & Division" button on Support ticket pages uses
-- POST /companies/with-divisions; this script is for bulk/manual adds.
--
-- Requires:
--   public.companies (id uuid PK, name text UNIQUE)
--   public.divisions (id uuid PK, company_id → companies(id), name text,
--                     UNIQUE(company_id, name) recommended)
-- =============================================================================

-- 1) Verify tables
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('companies', 'divisions')
ORDER BY table_name, ordinal_position;

-- 2) Add company (safe to re-run)
INSERT INTO public.companies (name)
VALUES ('Example Steel Pvt. Ltd.')
ON CONFLICT (name) DO NOTHING;

-- 3) Add division(s) for that company (safe to re-run if UNIQUE on company_id + name)
INSERT INTO public.divisions (company_id, name)
SELECT c.id, d.division_name
FROM public.companies c
CROSS JOIN (
  VALUES ('RM'), ('SMS'), ('PP')
) AS d(division_name)
WHERE c.name = 'Example Steel Pvt. Ltd.'
ON CONFLICT DO NOTHING;

-- If your divisions table has no UNIQUE(company_id, name), use this pattern instead:
-- INSERT INTO public.divisions (company_id, name)
-- SELECT c.id, 'RM'
-- FROM public.companies c
-- WHERE c.name = 'Example Steel Pvt. Ltd.'
--   AND NOT EXISTS (
--     SELECT 1 FROM public.divisions x
--     WHERE x.company_id = c.id AND lower(x.name) = lower('RM')
--   );

-- 4) Audit: company + divisions
SELECT c.id AS company_id, c.name AS company_name, d.id AS division_id, d.name AS division_name
FROM public.companies c
LEFT JOIN public.divisions d ON d.company_id = c.id
WHERE c.name = 'Example Steel Pvt. Ltd.'
ORDER BY d.name;

NOTIFY pgrst, 'reload schema';
