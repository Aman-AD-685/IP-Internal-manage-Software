-- When I-1 marks a suggestion Done, store completion time for Timestamp column.
-- Run in Supabase SQL Editor after IMPROVEMENT_SUGGESTIONS_SYSTEM.sql.

ALTER TABLE public.improvement_suggestions
    ADD COLUMN IF NOT EXISTS done_at timestamptz;

COMMENT ON COLUMN public.improvement_suggestions.done_at IS
    'Set when status becomes done; cleared when reverted to not_done.';

-- Backfill rows already marked done (use last update as best estimate)
UPDATE public.improvement_suggestions
SET done_at = updated_at
WHERE status = 'done' AND done_at IS NULL;

NOTIFY pgrst, 'reload schema';
