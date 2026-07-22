-- =============================================================================
-- Bot protect event log (Master Admin Settings)
-- Run in Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.bot_protect_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  event_type text NOT NULL,
  page text,
  email text,
  user_id uuid,
  client_ip text,
  user_agent text,
  strike_count integer,
  account_deactivated boolean NOT NULL DEFAULT false,
  detail text
);

CREATE INDEX IF NOT EXISTS idx_bot_protect_events_created_at
  ON public.bot_protect_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_protect_events_email
  ON public.bot_protect_events (email);

COMMENT ON TABLE public.bot_protect_events IS
  'Audit of bot/automation blocks and strikes; visible to Master Admin in Settings.';

ALTER TABLE public.bot_protect_events ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';
