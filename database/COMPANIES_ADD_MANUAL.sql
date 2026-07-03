-- =============================================================================
-- Add Company (Payment Management / Invoice dropdown)
-- Run in Supabase SQL Editor when adding companies manually (optional).
-- The app "Add Company" button inserts via API; this script is for bulk/manual adds.
-- Requires: public.companies (id uuid, name text UNIQUE)
-- =============================================================================

-- Verify table exists
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'companies'
ORDER BY ordinal_position;

-- Add one company (safe to re-run)
INSERT INTO public.companies (name)
VALUES ('Example Steel Pvt. Ltd.')
ON CONFLICT (name) DO NOTHING;

-- List companies added outside the master seed (optional audit)
SELECT id, name, created_at
FROM public.companies
ORDER BY name;

NOTIFY pgrst, 'reload schema';
