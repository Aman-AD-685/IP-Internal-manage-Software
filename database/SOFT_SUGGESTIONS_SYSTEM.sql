-- Soft suggestions (sidebar: S - Sugg / Sugg Details → Move to Support ticket)
-- Run in Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS public.soft_suggestions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reference_no text NOT NULL,
    suggestion_text text NOT NULL,
    attach_link text,
    page_id uuid REFERENCES public.pages (id) ON DELETE SET NULL,
    page_name text,
    ticket_type text NOT NULL DEFAULT 'chore',
    created_by uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    user_display_name text,
    status text NOT NULL DEFAULT 'open',
    support_ticket_id uuid REFERENCES public.tickets (id) ON DELETE SET NULL,
    support_ticket_ref text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT soft_suggestions_reference_no_key UNIQUE (reference_no),
    CONSTRAINT soft_suggestions_ticket_type_check CHECK (ticket_type IN ('chore', 'bug', 'feature')),
    CONSTRAINT soft_suggestions_status_check CHECK (status IN ('open', 'moved'))
);

CREATE INDEX IF NOT EXISTS idx_soft_suggestions_created_at
    ON public.soft_suggestions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_soft_suggestions_status
    ON public.soft_suggestions (status);

COMMENT ON TABLE public.soft_suggestions IS
    'Sidebar S-Sugg submissions; Move to Soft creates a Support ticket and links support_ticket_id.';

ALTER TABLE public.soft_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS soft_suggestions_select ON public.soft_suggestions;
CREATE POLICY soft_suggestions_select ON public.soft_suggestions
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS soft_suggestions_insert ON public.soft_suggestions;
CREATE POLICY soft_suggestions_insert ON public.soft_suggestions
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = created_by);

-- Verify
-- SELECT reference_no, suggestion_text, page_name, ticket_type, user_display_name, status, support_ticket_ref
-- FROM public.soft_suggestions ORDER BY created_at DESC;

-- Delete one row (example SS-0001)
-- DELETE FROM public.soft_suggestions WHERE reference_no = 'SS-0001';

-- ---------------------------------------------------------------------------
-- User-wise access (Edit User → Section permissions)
-- ---------------------------------------------------------------------------
-- soft_sugg          → View: "S - Sugg" button + submit form
-- soft_sugg_details  → View: "Sugg Details" board (read-only except Move to Soft if Edit checked)
-- soft_sugg_details  → Edit: can use "Move to Soft" only (not other columns)
-- Master Admin       → full edit on all columns in Sugg Details (API role check)
