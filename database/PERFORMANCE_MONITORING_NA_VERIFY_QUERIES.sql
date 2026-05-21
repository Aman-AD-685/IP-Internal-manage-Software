-- Performance Monitoring: Active / NA filter (run STEP 0 first if marked_na column missing).



-- =============================================================================

-- STEP 0 (REQUIRED FIRST) — fixes: column pm.marked_na does not exist (42703)

-- =============================================================================

ALTER TABLE public.performance_monitoring

  ADD COLUMN IF NOT EXISTS marked_na boolean NOT NULL DEFAULT false;



CREATE INDEX IF NOT EXISTS idx_performance_monitoring_marked_na

  ON public.performance_monitoring (marked_na)

  WHERE marked_na = true;



CREATE INDEX IF NOT EXISTS idx_performance_monitoring_marked_na_company

  ON public.performance_monitoring (company_id)

  WHERE marked_na = true;



SELECT column_name, data_type, column_default

FROM information_schema.columns

WHERE table_schema = 'public'

  AND table_name = 'performance_monitoring'

  AND column_name = 'marked_na';

-- Required: reload API schema so backend NA button works (run once after STEP 0)
NOTIFY pgrst, 'reload schema';

-- =============================================================================

-- ACTIVE list (app filter "Active" = exclude_na) — shown in Performance Monitoring

-- =============================================================================

SELECT

  pm.reference_no,

  c.name AS company_name,

  pm.response,

  pm.completion_status,

  pm.marked_na

FROM public.performance_monitoring pm

LEFT JOIN public.companies c ON c.id = pm.company_id

WHERE pm.company_id NOT IN (

  SELECT company_id FROM public.performance_monitoring WHERE marked_na = true

)

  AND (pm.completion_status = 'in_progress' OR pm.completion_status IS NULL)

ORDER BY pm.created_at DESC;



-- =============================================================================

-- NA list (app filter "NA" = only_na) — click row → Restore returns ticket to Active

-- =============================================================================

SELECT

  pm.id,

  pm.reference_no,

  c.name AS company_name,

  pm.company_id,

  pm.response,

  pm.completion_status,

  pm.marked_na,

  pm.created_at

FROM public.performance_monitoring pm

LEFT JOIN public.companies c ON c.id = pm.company_id

WHERE pm.company_id IN (

  SELECT company_id FROM public.performance_monitoring WHERE marked_na = true

)

ORDER BY c.name, pm.created_at DESC;



-- =============================================================================

-- MARK one ticket NA (app: open row → NA next to Training)

-- Replace reference_no with your SUCC- number.

-- =============================================================================

/*

UPDATE public.performance_monitoring

SET marked_na = true

WHERE reference_no = 'SUCC-0069'

  AND COALESCE(marked_na, false) = false;

*/



-- =============================================================================

-- RESTORE company to Active (app: filter NA → open row → Restore)

-- Clears NA on all responses for that company; ticket reappears under Active filter.

-- =============================================================================

/*

UPDATE public.performance_monitoring

SET marked_na = false

WHERE company_id = (

  SELECT company_id FROM public.performance_monitoring WHERE reference_no = 'SUCC-0069' LIMIT 1

)

  AND marked_na = true;

*/



-- Or restore by company name:

/*

UPDATE public.performance_monitoring pm

SET marked_na = false

FROM public.companies c

WHERE pm.company_id = c.id

  AND c.name ILIKE '%Pratishtha Spirits%'

  AND pm.marked_na = true;

*/



-- =============================================================================

-- After RESTORE — row should appear in ACTIVE query above with marked_na = false

-- =============================================================================

/*

SELECT pm.reference_no, c.name, pm.marked_na, pm.completion_status

FROM public.performance_monitoring pm

JOIN public.companies c ON c.id = pm.company_id

WHERE pm.reference_no = 'SUCC-0069';

*/


