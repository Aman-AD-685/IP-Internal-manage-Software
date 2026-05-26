-- Per-user "seen" state for Stage 2 remark bell notifications (badge clears after opening dropdown).
-- Run in Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.stage2_remark_notification_seen (
  user_id uuid NOT NULL,
  remark_id uuid NOT NULL REFERENCES public.ticket_stage2_remarks(id) ON DELETE CASCADE,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, remark_id)
);

CREATE INDEX IF NOT EXISTS idx_stage2_remark_seen_user
  ON public.stage2_remark_notification_seen (user_id);

COMMENT ON TABLE public.stage2_remark_notification_seen IS
  'Tracks which Stage 2 remark notifications each user has opened in the bell dropdown.';

ALTER TABLE public.stage2_remark_notification_seen ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.stage2_remark_notification_seen TO authenticated;
GRANT ALL ON public.stage2_remark_notification_seen TO service_role;

DROP POLICY IF EXISTS stage2_remark_seen_service_all ON public.stage2_remark_notification_seen;
CREATE POLICY stage2_remark_seen_service_all ON public.stage2_remark_notification_seen
  FOR ALL TO service_role USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
