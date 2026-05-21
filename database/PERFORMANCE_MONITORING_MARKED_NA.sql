-- Mark Performance Monitoring responses as NA (not required).
-- Any row with marked_na = true excludes that company from all Success lists and KPI counts.
ALTER TABLE public.performance_monitoring
  ADD COLUMN IF NOT EXISTS marked_na boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_performance_monitoring_marked_na
  ON public.performance_monitoring (marked_na)
  WHERE marked_na = true;

CREATE INDEX IF NOT EXISTS idx_performance_monitoring_marked_na_company
  ON public.performance_monitoring (company_id)
  WHERE marked_na = true;

COMMENT ON COLUMN public.performance_monitoring.marked_na IS
  'When true, this response is not required; the company is hidden from Performance Monitoring / Comp-Perform / Success dashboards and excluded from Success KPI. Use app Restore or UPDATE marked_na=false for that company_id to undo.';

-- Required so Supabase API / PostgREST sees the new column (otherwise NA button stays disabled)
NOTIFY pgrst, 'reload schema';
