-- Optional indexes for Success Performance list filters (run in Supabase SQL Editor)

CREATE INDEX IF NOT EXISTS idx_performance_monitoring_completion_created
ON public.performance_monitoring (completion_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_performance_monitoring_marked_na
ON public.performance_monitoring (marked_na)
WHERE marked_na = true;

CREATE INDEX IF NOT EXISTS idx_success_click_events_clicked_at
ON public.success_followup_click_events (clicked_at DESC);
