-- =============================================================================
-- Global System Lock (Master Admin only)
-- Blocks all User & Admin access while locked. Master Admin retains full access.
-- Run in Supabase SQL Editor, then: NOTIFY pgrst, 'reload schema';
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.system_lock_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  is_locked boolean NOT NULL DEFAULT false,
  reason text,
  locked_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  locked_at timestamptz,
  unlocked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.system_lock_settings (id, is_locked)
VALUES (1, false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.system_lock_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('SYSTEM_LOCK_ENABLED', 'SYSTEM_LOCK_DISABLED')),
  performed_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  performer_email text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_lock_audit_created_at
  ON public.system_lock_audit (created_at DESC);

COMMENT ON TABLE public.system_lock_settings IS
  'Singleton row (id=1): when is_locked=true, all non–master_admin users are blocked from the app.';
COMMENT ON TABLE public.system_lock_audit IS
  'Audit trail for system lock enable/disable by Master Admin.';

-- Client JWT cannot read/write lock tables — FastAPI service role only.
ALTER TABLE public.system_lock_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_lock_audit ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- VERIFY: current lock state
-- -----------------------------------------------------------------------------
SELECT
  is_locked,
  reason,
  locked_by,
  locked_at,
  unlocked_at,
  updated_at
FROM public.system_lock_settings
WHERE id = 1;

-- -----------------------------------------------------------------------------
-- VERIFY: recent audit (last 20)
-- -----------------------------------------------------------------------------
SELECT action, performer_email, reason, created_at
FROM public.system_lock_audit
ORDER BY created_at DESC
LIMIT 20;

NOTIFY pgrst, 'reload schema';
