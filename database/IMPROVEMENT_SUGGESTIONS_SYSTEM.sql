-- Improvement suggestions (header: Improvement + I-1 master admin board)
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.improvement_suggestions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_no text NOT NULL,
    suggestion_text text NOT NULL,
    created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    user_display_name text,
    status text NOT NULL DEFAULT 'not_done',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT improvement_suggestions_reference_no_key UNIQUE (reference_no),
    CONSTRAINT improvement_suggestions_status_check CHECK (status IN ('done', 'not_done'))
);

CREATE INDEX IF NOT EXISTS idx_improvement_suggestions_created_at
    ON public.improvement_suggestions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_improvement_suggestions_status
    ON public.improvement_suggestions (status);

COMMENT ON TABLE public.improvement_suggestions IS
    'User-submitted improvement ideas (Improvement button). Master Admin manages via I-1 board.';

ALTER TABLE public.improvement_suggestions ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all rows (I-1 board for master admin; optional future user history)
DROP POLICY IF EXISTS improvement_suggestions_select ON public.improvement_suggestions;
CREATE POLICY improvement_suggestions_select ON public.improvement_suggestions
    FOR SELECT TO authenticated
    USING (true);

-- Users insert their own rows only
DROP POLICY IF EXISTS improvement_suggestions_insert ON public.improvement_suggestions;
CREATE POLICY improvement_suggestions_insert ON public.improvement_suggestions
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = created_by);

-- Updates via backend service role; optional direct policy for master_admin role if you use custom claims
DROP POLICY IF EXISTS improvement_suggestions_update ON public.improvement_suggestions;
-- No client UPDATE policy — PATCH goes through FastAPI with service role.

-- Optional: verify
-- SELECT reference_no, suggestion_text, user_display_name, status, created_at
-- FROM public.improvement_suggestions ORDER BY created_at DESC LIMIT 20;

-- Delete one row by reference (example: IM-0001)
-- DELETE FROM public.improvement_suggestions WHERE reference_no = 'IM-0001';

-- Delete by id (replace with actual uuid from SELECT id, reference_no ...)
-- DELETE FROM public.improvement_suggestions WHERE id = '00000000-0000-0000-0000-000000000000';
