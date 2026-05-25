-- Mark a checklist occurrence as NA (not applicable): hides that date from lists and removes completion row.
-- Run in Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.checklist_occurrence_na (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.checklist_tasks(id) ON DELETE CASCADE,
  occurrence_date date NOT NULL,
  marked_by uuid,
  marked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, occurrence_date)
);

CREATE INDEX IF NOT EXISTS idx_checklist_occurrence_na_task_date
  ON public.checklist_occurrence_na (task_id, occurrence_date);

COMMENT ON TABLE public.checklist_occurrence_na IS
  'Per-date NA for checklist tasks. That occurrence no longer appears; completion data for that date is removed.';

-- Whole-task NA: one Mark NA per checklist task hides all dates (today, overdue, upcoming).
ALTER TABLE public.checklist_tasks
  ADD COLUMN IF NOT EXISTS na_from_date date;

ALTER TABLE public.checklist_tasks
  ADD COLUMN IF NOT EXISTS marked_na boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.checklist_tasks.marked_na IS
  'When true, this checklist task is fully NA — no dates appear in Task List; all completion rows removed.';

COMMENT ON COLUMN public.checklist_tasks.na_from_date IS
  'Legacy stop date; marked_na=true is preferred for whole-task NA.';

UPDATE public.checklist_tasks t
SET marked_na = true,
    na_from_date = COALESCE(t.na_from_date, sub.min_d, CURRENT_DATE)
FROM (
  SELECT task_id, MIN(occurrence_date) AS min_d
  FROM public.checklist_occurrence_na
  GROUP BY task_id
) sub
WHERE t.id = sub.task_id AND COALESCE(t.marked_na, false) = false;

UPDATE public.checklist_tasks
SET marked_na = true
WHERE na_from_date IS NOT NULL AND COALESCE(marked_na, false) = false;

ALTER TABLE public.checklist_occurrence_na ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_occurrence_na TO authenticated;
GRANT ALL ON public.checklist_occurrence_na TO service_role;

DROP POLICY IF EXISTS checklist_occurrence_na_service_all ON public.checklist_occurrence_na;
CREATE POLICY checklist_occurrence_na_service_all ON public.checklist_occurrence_na
  FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
