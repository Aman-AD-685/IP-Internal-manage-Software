-- =============================================================================
-- Payment Ageing: FULL canonicalize invoice company_name spellings
-- Run in Supabase SQL Editor (optional — app also merges at report time via
-- letter-compact + keyword match). Safe to re-run.
--
-- Does NOT merge Orissa (base) with Orissa (Raipur) — separate companies.
-- =============================================================================

-- Preview distinct spellings (optional):
-- SELECT company_name, COUNT(*) AS invoices, MAX(invoice_date) AS latest
-- FROM public.onboarding_client_payment
-- WHERE COALESCE(marked_na, false) = false
-- GROUP BY company_name
-- ORDER BY company_name;

-- ---------------------------------------------------------------------------
-- 1) Dadiji Steel / Steels + Trade / Trading
-- ---------------------------------------------------------------------------
UPDATE public.onboarding_client_payment
SET company_name = 'Dadiji Steel Manufacture & Trading Pvt Ltd'
WHERE company_name ILIKE '%Dadiji%Steel%Manufacture%Trade%'
  AND company_name IS DISTINCT FROM 'Dadiji Steel Manufacture & Trading Pvt Ltd';

-- ---------------------------------------------------------------------------
-- 2) Black Rock / BlackRock Steel & Power
-- ---------------------------------------------------------------------------
UPDATE public.onboarding_client_payment
SET company_name = 'BlackRock Steel & Power Pvt. Ltd'
WHERE (
    REPLACE(LOWER(company_name), ' ', '') LIKE '%blackrocksteel%power%'
    OR company_name ILIKE '%Black Rock%Steel%Power%'
    OR company_name ILIKE '%BlackRock%Steel%Power%'
  )
  AND company_name IS DISTINCT FROM 'BlackRock Steel & Power Pvt. Ltd';

-- ---------------------------------------------------------------------------
-- 3) Kodarma Chemical / Chemicals (NOT Petrochemicals)
-- ---------------------------------------------------------------------------
UPDATE public.onboarding_client_payment
SET company_name = 'Kodarma Chemical Pvt. Ltd.'
WHERE company_name ILIKE 'Kodarma Chemical%'
  AND company_name NOT ILIKE '%Petro%'
  AND company_name IS DISTINCT FROM 'Kodarma Chemical Pvt. Ltd.';

-- ---------------------------------------------------------------------------
-- 4) Kodarma Petrochemicals / Petrohemicals typo
-- ---------------------------------------------------------------------------
UPDATE public.onboarding_client_payment
SET company_name = 'Kodarma Petrochemicals Pvt. Ltd.'
WHERE company_name ILIKE 'Kodarma Petro%chemical%'
  AND company_name IS DISTINCT FROM 'Kodarma Petrochemicals Pvt. Ltd.';

-- ---------------------------------------------------------------------------
-- 5) Odissa / Orissa Concrete (base only — NOT Raipur)
-- ---------------------------------------------------------------------------
UPDATE public.onboarding_client_payment
SET company_name = 'Orissa Concrete & Allied Industries Ltd'
WHERE (
    company_name ILIKE '%Odissa Concrete%Allied%'
    OR company_name ILIKE '%Orissa Concrete%Allied%'
  )
  AND company_name NOT ILIKE '%Raipur%'
  AND company_name IS DISTINCT FROM 'Orissa Concrete & Allied Industries Ltd';

-- ---------------------------------------------------------------------------
-- 6) Odissa/Orissa Concrete (Raipur) — separate company
-- ---------------------------------------------------------------------------
UPDATE public.onboarding_client_payment
SET company_name = 'Orissa Concrete & Allied Industries Ltd. (Raipur)'
WHERE (
    company_name ILIKE '%Odissa Concrete%Allied%Raipur%'
    OR company_name ILIKE '%Orissa Concrete%Allied%Raipur%'
  )
  AND company_name IS DISTINCT FROM 'Orissa Concrete & Allied Industries Ltd. (Raipur)';

-- ---------------------------------------------------------------------------
-- 7) Optional: spot remaining near-duplicates by letter-compact key
--    (review only — do not auto-update blindly)
-- ---------------------------------------------------------------------------
-- SELECT
--   regexp_replace(lower(company_name), '[^a-z0-9]', '', 'g') AS compact_key,
--   array_agg(DISTINCT company_name ORDER BY company_name) AS spellings,
--   COUNT(*) AS invoice_rows
-- FROM public.onboarding_client_payment
-- WHERE COALESCE(marked_na, false) = false
--   AND company_name IS NOT NULL
-- GROUP BY 1
-- HAVING COUNT(DISTINCT company_name) > 1
-- ORDER BY COUNT(DISTINCT company_name) DESC, compact_key;

NOTIFY pgrst, 'reload schema';
