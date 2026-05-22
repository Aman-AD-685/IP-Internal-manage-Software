-- Bulk upload: Feature requests (6 rows) — Bihar Foundry + Brahmaputra Metallics
-- Visible in app: Tickets → Approval Status (section=approval-status, Pending filter)
--
-- App list requires: type=feature, approval_status IS NULL, not in active Staging
--   (staging_planned IS NULL OR live_review_status = completed)
--
-- Run entire script in Supabase SQL Editor. After run: hard-refresh browser (Ctrl+Shift+R).
--
-- Maps from spreadsheet:
--   Priority Red/Green → high / low
--   Status Pending → approval_status NULL (shown as Pending in Approval Status)
--   Stage 1 Pending → status_2 = pending
--   Channel MOM → communicated_through = mom
--   Why Feature (empty) → same as Problem text

BEGIN;

CREATE TEMP TABLE seed_feature_bihar_brahma_config (
  created_by uuid NOT NULL
);

INSERT INTO seed_feature_bihar_brahma_config (created_by)
SELECT COALESCE(
  (SELECT up.id FROM public.user_profiles up ORDER BY up.id LIMIT 1),
  (SELECT au.id FROM auth.users au ORDER BY au.created_at NULLS LAST LIMIT 1)
);

CREATE TEMP TABLE seed_feature_bihar_brahma_rows AS
SELECT *
FROM (
  VALUES
    ('Bihar Foundry & Casting Limited'::text, 'abd6873e-eb90-43e4-b861-d5f906f83d10'::uuid, 'Somnath Roy'::text, 'Quotation Comparison'::text, 'All'::text, 'feature'::text, 'mom'::text, 'Implement Reverse Auction'::text, ''::text, 'high'::text),
    ('Bihar Foundry & Casting Limited', 'abd6873e-eb90-43e4-b861-d5f906f83d10'::uuid, 'Somnath Roy', 'Create Item', 'All', 'feature', 'mom', 'Item creator should receive notification when item get approved but if and only if the Item Creator and Item Approver is different person.', '', 'low'),
    ('Brahmaputra Metallics Ltd.', 'd7def3ff-b59c-4925-a101-012697db0689'::uuid, 'Dilip Keshari', 'Reports', 'All', 'feature', 'mom', 'User wants to download excels directly instead of mail, communicate with them', '', 'high'),
    ('Bihar Foundry & Casting Limited', 'abd6873e-eb90-43e4-b861-d5f906f83d10'::uuid, 'Somnath Roy', 'Create Indent', 'All', 'feature', 'mom', 'Auto draft for Indent', '', 'high'),
    ('Bihar Foundry & Casting Limited', 'abd6873e-eb90-43e4-b861-d5f906f83d10'::uuid, 'Somnath Roy', 'Create Po', 'All', 'feature', 'mom', 'Auto draft for PO', '', 'high'),
    ('Bihar Foundry & Casting Limited', 'abd6873e-eb90-43e4-b861-d5f906f83d10'::uuid, 'Somnath Roy', 'Reorder level crossed', 'All', 'feature', 'mom', 'Once the reorder level is crossed, users should receive an option to select the item and directly create an indent for that item.', '', 'high')
) AS t(
  company_name, company_id, user_name, page, division, ticket_type, communicated_through, problem_text, why_feature_text, priority
);

INSERT INTO public.pages (name)
SELECT DISTINCT trim(s.page)
FROM seed_feature_bihar_brahma_rows s
WHERE trim(s.page) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.pages p
    WHERE lower(trim(p.name)) = lower(trim(s.page))
  );

CREATE TEMP TABLE seed_feature_bihar_brahma_resolved AS
SELECT
  s.company_name,
  COALESCE(c_id.id, c_name.id) AS company_id,
  s.user_name,
  s.page,
  p.id AS page_id,
  s.division,
  s.ticket_type,
  s.communicated_through,
  s.problem_text,
  s.why_feature_text,
  s.priority
FROM seed_feature_bihar_brahma_rows s
LEFT JOIN public.companies c_id ON c_id.id = s.company_id
LEFT JOIN public.companies c_name ON lower(trim(c_name.name)) = lower(trim(s.company_name))
LEFT JOIN public.pages p ON lower(trim(p.name)) = lower(trim(s.page));

DO $$
DECLARE
  cfg uuid;
  bad_company int;
  bad_page int;
  missing_pages text;
BEGIN
  SELECT created_by INTO cfg FROM seed_feature_bihar_brahma_config LIMIT 1;
  IF cfg IS NULL THEN
    RAISE EXCEPTION 'No user in user_profiles/auth.users.';
  END IF;

  SELECT count(*) INTO bad_company FROM seed_feature_bihar_brahma_resolved s WHERE s.company_id IS NULL;
  IF bad_company > 0 THEN
    RAISE EXCEPTION '% row(s): company not found.', bad_company;
  END IF;

  SELECT count(*) INTO bad_page FROM seed_feature_bihar_brahma_resolved s WHERE s.page_id IS NULL;
  IF bad_page > 0 THEN
    SELECT string_agg(DISTINCT s.page, ', ') INTO missing_pages
    FROM seed_feature_bihar_brahma_resolved s WHERE s.page_id IS NULL;
    RAISE EXCEPTION 'Page not found: %', COALESCE(missing_pages, '?');
  END IF;
END $$;

-- Repair existing rows so they match Approval Status (pending) filters
WITH repaired AS (
  UPDATE public.tickets t
  SET
    type = 'feature',
    status = 'open',
    status_2 = 'pending',
    priority = s.priority,
    company_id = s.company_id,
    company_name = s.company_name,
    page_id = s.page_id,
    page = s.page,
    division = s.division,
    user_name = s.user_name,
    communicated_through = s.communicated_through,
    submitted_by = s.user_name,
    title = LEFT(s.problem_text, 200),
    description = s.problem_text,
    customer_questions = s.problem_text,
    why_feature = COALESCE(NULLIF(trim(s.why_feature_text), ''), trim(s.problem_text)),
    approval_status = NULL,
    quality_solution = NULL,
    staging_planned = NULL,
    live_review_status = NULL,
    live_status = NULL,
    status_4 = NULL,
    updated_at = NOW()
  FROM seed_feature_bihar_brahma_resolved s
  WHERE lower(trim(t.description)) = lower(trim(s.problem_text))
    AND t.company_id = s.company_id
  RETURNING t.reference_no
)
SELECT count(*) AS repaired_count FROM repaired;

-- Empty string on approval_status hides rows (API uses IS NULL only)
UPDATE public.tickets
SET approval_status = NULL, updated_at = NOW()
WHERE company_id IN (
    'abd6873e-eb90-43e4-b861-d5f906f83d10',
    'd7def3ff-b59c-4925-a101-012697db0689'
  )
  AND type = 'feature'
  AND trim(coalesce(approval_status::text, '')) = '';

WITH ref_seed AS (
  SELECT COALESCE(MAX((substring(reference_no FROM 'FE-(\d+)'))::int), 0) AS max_no
  FROM public.tickets
  WHERE reference_no ~ '^FE-\d+$'
),
actor AS (
  SELECT c.created_by FROM seed_feature_bihar_brahma_config c
),
to_insert AS (
  SELECT
    s.*,
    ROW_NUMBER() OVER (ORDER BY s.company_name, s.page, s.problem_text) AS row_no,
    COALESCE(NULLIF(trim(s.why_feature_text), ''), trim(s.problem_text)) AS why_feature_final
  FROM seed_feature_bihar_brahma_resolved s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.type = 'feature'
      AND t.company_id = s.company_id
      AND lower(trim(t.description)) = lower(trim(s.problem_text))
  )
),
inserted AS (
  INSERT INTO public.tickets (
    reference_no,
    title,
    description,
    type,
    status,
    priority,
    company_id,
    company_name,
    page_id,
    page,
    division,
    user_name,
    communicated_through,
    submitted_by,
    customer_questions,
    why_feature,
    approval_status,
    status_2,
    quality_solution,
    staging_planned,
    live_review_status,
    live_status,
    status_4,
    created_by,
    created_at,
    updated_at,
    query_arrival_at
  )
  SELECT
    'FE-' || LPAD((ref_seed.max_no + ti.row_no)::text, 4, '0'),
    LEFT(ti.problem_text, 200),
    ti.problem_text,
    'feature',
    'open',
    ti.priority,
    ti.company_id,
    ti.company_name,
    ti.page_id,
    ti.page,
    ti.division,
    ti.user_name,
    ti.communicated_through,
    ti.user_name,
    ti.problem_text,
    ti.why_feature_final,
    NULL,
    'pending',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    actor.created_by,
    NOW(),
    NOW(),
    NOW()
  FROM to_insert ti
  CROSS JOIN ref_seed
  CROSS JOIN actor
  RETURNING reference_no
)
SELECT count(*) AS inserted_count FROM inserted;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Must match Approval Status → Pending (same rules as GET /tickets?section=approval-status)
-- =============================================================================
SELECT count(*) AS visible_in_approval_status_pending
FROM public.tickets t
WHERE t.type = 'feature'
  AND t.approval_status IS NULL
  AND (t.staging_planned IS NULL OR lower(coalesce(t.live_review_status::text, '')) = 'completed')
  AND (t.status_2 IS NULL OR lower(trim(t.status_2::text)) <> 'na')
  AND t.company_id IN (
    'abd6873e-eb90-43e4-b861-d5f906f83d10',
    'd7def3ff-b59c-4925-a101-012697db0689'
  );

SELECT reference_no, company_name, page, priority, approval_status, status_2,
       LEFT(description, 70) AS problem_preview, why_feature
FROM public.tickets
WHERE type = 'feature'
  AND company_id IN (
    'abd6873e-eb90-43e4-b861-d5f906f83d10',
    'd7def3ff-b59c-4925-a101-012697db0689'
  )
  AND approval_status IS NULL
ORDER BY created_at DESC
LIMIT 10;
