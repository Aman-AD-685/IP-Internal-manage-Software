-- =============================================================================
-- Payment Ageing: canonicalize known duplicate invoice company_name spellings
-- Run in Supabase SQL Editor (optional — app also merges at report time).
-- Preview first, then UPDATE.
-- =============================================================================

-- Preview near-duplicates (same after lower/trim; still useful for manual review):
-- SELECT company_name, COUNT(*) AS invoices, MAX(invoice_date) AS latest
-- FROM public.onboarding_client_payment
-- WHERE COALESCE(marked_na, false) = false
-- GROUP BY company_name
-- ORDER BY company_name;

-- Dadiji Steel / Steels + Trade / Trading
UPDATE public.onboarding_client_payment
SET company_name = 'Dadiji Steel Manufacture & Trading Pvt Ltd'
WHERE company_name ILIKE '%Dadiji%Steel%Manufacture%Trade%'
  AND company_name IS DISTINCT FROM 'Dadiji Steel Manufacture & Trading Pvt Ltd';

-- Kodarma Chemical / Chemicals (NOT Petrochemicals)
UPDATE public.onboarding_client_payment
SET company_name = 'Kodarma Chemical Pvt. Ltd.'
WHERE company_name ILIKE 'Kodarma Chemical%'
  AND company_name NOT ILIKE '%Petro%'
  AND company_name IS DISTINCT FROM 'Kodarma Chemical Pvt. Ltd.';

-- Kodarma Petrochemicals / Petrohemicals typo
UPDATE public.onboarding_client_payment
SET company_name = 'Kodarma Petrochemicals Pvt. Ltd.'
WHERE company_name ILIKE 'Kodarma Petro%chemical%'
  AND company_name IS DISTINCT FROM 'Kodarma Petrochemicals Pvt. Ltd.';

-- Odissa / Orissa Concrete (base only — NOT Raipur; Raipur is a separate company)
UPDATE public.onboarding_client_payment
SET company_name = 'Orissa Concrete & Allied Industries Ltd'
WHERE (
    company_name ILIKE '%Odissa Concrete%Allied%'
    OR company_name ILIKE '%Orissa Concrete%Allied%'
  )
  AND company_name NOT ILIKE '%Raipur%'
  AND company_name IS DISTINCT FROM 'Orissa Concrete & Allied Industries Ltd';

-- Odissa/Orissa Concrete (Raipur) — keep as its own canonical name
UPDATE public.onboarding_client_payment
SET company_name = 'Orissa Concrete & Allied Industries Ltd. (Raipur)'
WHERE (
    company_name ILIKE '%Odissa Concrete%Allied%Raipur%'
    OR company_name ILIKE '%Orissa Concrete%Allied%Raipur%'
  )
  AND company_name IS DISTINCT FROM 'Orissa Concrete & Allied Industries Ltd. (Raipur)';

NOTIFY pgrst, 'reload schema';
