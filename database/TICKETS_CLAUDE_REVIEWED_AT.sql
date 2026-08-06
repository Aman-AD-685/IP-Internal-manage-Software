-- Claude Review badge on Support tickets (Stage 2 pending workflow).
-- Run once in Supabase SQL Editor.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS claude_reviewed_at timestamptz;

COMMENT ON COLUMN public.tickets.claude_reviewed_at IS
  'When Claude marked Stage 2 review done via integration API; UI shows (C.R) / Claude Review.';

CREATE INDEX IF NOT EXISTS idx_tickets_claude_reviewed_at
  ON public.tickets (claude_reviewed_at)
  WHERE claude_reviewed_at IS NOT NULL;

NOTIFY pgrst, 'reload schema';
