-- Delegation: Shifted count + history when Submission Date passes
-- Run in Supabase → SQL Editor, then refresh the app.

ALTER TABLE public.delegation_tasks
  ADD COLUMN IF NOT EXISTS shift_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.delegation_tasks
  ADD COLUMN IF NOT EXISTS shift_history jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.delegation_tasks
  ADD COLUMN IF NOT EXISTS last_assigned_date date;

COMMENT ON COLUMN public.delegation_tasks.shift_count IS
  'How many times submission_date was auto-advanced after it passed.';

COMMENT ON COLUMN public.delegation_tasks.shift_history IS
  'JSON array of {from,to,shifted_on} (YYYY-MM-DD) for each auto-shift.';

COMMENT ON COLUMN public.delegation_tasks.last_assigned_date IS
  'Submission date after the latest auto-shift (same as current submission_date when shifted).';

-- Backfill: treat existing submission_date as last assigned when never shifted
UPDATE public.delegation_tasks
SET last_assigned_date = submission_date::date
WHERE last_assigned_date IS NULL
  AND submission_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delegation_tasks_submission_pending
  ON public.delegation_tasks (submission_date)
  WHERE status IN ('pending', 'in_progress')
    AND submission_date IS NOT NULL;

NOTIFY pgrst, 'reload schema';
