-- =============================================================================
-- App release broadcast — prompts all users to refresh when a new build is live.
-- Run once in Supabase SQL Editor. Backend reads via service_role.
--
-- On each production deploy (after Vercel build):
--   1. Use the git commit short SHA from the deploy (first 8 chars of full SHA, e.g. ec0a03d).
--   2. Run: SELECT * FROM bump_app_release('ec0a03d');
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.app_release_broadcast (
  id integer PRIMARY KEY CHECK (id = 1),
  release_key text NOT NULL,
  title text NOT NULL DEFAULT 'New features are live',
  message text NOT NULL DEFAULT 'A new version of Industry Prime is available. Refresh to load the latest features.',
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_release_broadcast IS
  'Singleton row (id=1). When release_key differs from the user''s loaded JS bundle, show refresh prompt.';

INSERT INTO public.app_release_broadcast (id, release_key, title, message)
VALUES (
  1,
  'dev-local',
  'New features are live',
  'A new version of Industry Prime is available. Refresh to load the latest features.'
)
ON CONFLICT (id) DO NOTHING;

-- Optional: helper to bump release on deploy
CREATE OR REPLACE FUNCTION public.bump_app_release(
  new_release_key text,
  new_title text DEFAULT 'New features are live',
  new_message text DEFAULT 'A new version of Industry Prime is available. Refresh to load the latest features.'
)
RETURNS public.app_release_broadcast
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.app_release_broadcast;
BEGIN
  IF new_release_key IS NULL OR trim(new_release_key) = '' THEN
    RAISE EXCEPTION 'new_release_key is required';
  END IF;
  UPDATE public.app_release_broadcast
  SET
    release_key = trim(new_release_key),
    title = COALESCE(new_title, title),
    message = COALESCE(new_message, message),
    is_active = true,
    updated_at = now()
  WHERE id = 1
  RETURNING * INTO row;
  IF row IS NULL THEN
    INSERT INTO public.app_release_broadcast (id, release_key, title, message)
    VALUES (1, trim(new_release_key), new_title, new_message)
    RETURNING * INTO row;
  END IF;
  RETURN row;
END;
$$;

COMMENT ON FUNCTION public.bump_app_release IS
  'Call after each production deploy: SELECT * FROM bump_app_release(''ec0a03d'');';

-- Example after deploy (replace with your Vercel git commit short SHA):
-- SELECT * FROM bump_app_release('ec0a03d');

NOTIFY pgrst, 'reload schema';
