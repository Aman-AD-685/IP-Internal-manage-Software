-- Bulk upload: Chores (15 rows) — Bihar Foundry + Brahmaputra Metallics
-- Visible in app: Tickets → Chores & Bugs (section=chores-bugs)
--
-- App list requires: type=chore, quality_solution IS NULL, status_2=pending (or filter),
--   staging_planned IS NULL, status_2 <> na
--
-- Run entire script in Supabase SQL Editor. After run: hard-refresh browser (Ctrl+Shift+R).

BEGIN;

CREATE TEMP TABLE seed_bihar_brahma_config (
  created_by uuid NOT NULL
);

INSERT INTO seed_bihar_brahma_config (created_by)
SELECT COALESCE(
  (SELECT up.id FROM public.user_profiles up ORDER BY up.id LIMIT 1),
  (SELECT au.id FROM auth.users au ORDER BY au.created_at NULLS LAST LIMIT 1)
);

CREATE TEMP TABLE seed_bihar_brahma_rows AS
SELECT *
FROM (
  VALUES
    ('Bihar Foundry & Casting Limited'::text, 'abd6873e-eb90-43e4-b861-d5f906f83d10'::uuid, 'Somnath Roy'::text, 'Create Po'::text, 'All'::text, 'chore'::text, 'mom'::text, 'A "Secondary PO Number" or "Manual Serial Number" text field must be added to PO creation so the plant can match physical records with the system.'::text, 'medium'::text),
    ('Bihar Foundry & Casting Limited', 'abd6873e-eb90-43e4-b861-d5f906f83d10'::uuid, 'Somnath Roy', 'Create Po', 'All', 'chore', 'mom', 'Enable tollerance entry in PO creation same as Bhagwati.', 'medium'),
    ('Bihar Foundry & Casting Limited', 'abd6873e-eb90-43e4-b861-d5f906f83d10'::uuid, 'Somnath Roy', 'GRN Entry', 'All', 'chore', 'mom', 'The GRN slip preview must reflect the freight by the same vendor, so users can verify the amount before submission.', 'low'),
    ('Bihar Foundry & Casting Limited', 'abd6873e-eb90-43e4-b861-d5f906f83d10'::uuid, 'Somnath Roy', 'Issue', 'All', 'chore', 'mom', 'Provide real-time stock visibility across all divisions directly within the Issue section-->Either they could use the issue approval or a Stk - All Stk option could be given for them.', 'medium'),
    ('Bihar Foundry & Casting Limited', 'abd6873e-eb90-43e4-b861-d5f906f83d10'::uuid, 'Somnath Roy', 'Pending PO (GRN)', 'All', 'chore', 'mom', 'Add a universal filter of ''Partially Received'' in Pending PO (GRN) and Pending Indent (RFQ)', 'medium'),
    ('Bihar Foundry & Casting Limited', 'abd6873e-eb90-43e4-b861-d5f906f83d10'::uuid, 'Somnath Roy', 'Pending Indent RFQ', 'All', 'chore', 'mom', 'If dual UOM is enabled and UOM get shifted in RFQ/QC/PO then quantity should be automatically change as per the calculation.', 'low'),
    ('Bihar Foundry & Casting Limited', 'abd6873e-eb90-43e4-b861-d5f906f83d10'::uuid, 'Somnath Roy', 'PO Register', 'All', 'chore', 'mom', 'Add General & Commercial T & C', 'high'),
    ('Bihar Foundry & Casting Limited', 'abd6873e-eb90-43e4-b861-d5f906f83d10'::uuid, 'Somnath Roy', 'POs To Approve', 'All', 'chore', 'mom', 'Enable remarks option in PO unapproving via mobile.', 'medium'),
    ('Brahmaputra Metallics Ltd.', 'd7def3ff-b59c-4925-a101-012697db0689'::uuid, 'Dilip Keshari', 'Division', 'All', 'chore', 'mom', 'Either Segregation of Spares and Consumables in division-wise stock report or seggregation of division during export of stock movement report (all divisions)--> Communicate with their team and tag all the items first with the Item type', 'medium'),
    ('Brahmaputra Metallics Ltd.', 'd7def3ff-b59c-4925-a101-012697db0689'::uuid, 'Dilip Keshari', 'GRN Register', 'All', 'chore', 'mom', 'Add a universal filter of MSME in GRN Register to filter all the MSME vendors.', 'high'),
    ('Brahmaputra Metallics Ltd.', 'd7def3ff-b59c-4925-a101-012697db0689'::uuid, 'Dilip Keshari', 'Reports', 'All', 'chore', 'mom', 'Reports are time taking--> Monitor next 1 week that each and every report''s required time between requested and received.', 'low'),
    ('Brahmaputra Metallics Ltd.', 'd7def3ff-b59c-4925-a101-012697db0689'::uuid, 'Dilip Keshari', 'Create Item', 'All', 'chore', 'mom', 'Enable a item description field in item creation, then follow for 1 month for the quantum.', 'low'),
    ('Bihar Foundry & Casting Limited', 'abd6873e-eb90-43e4-b861-d5f906f83d10'::uuid, 'Somnath Roy', 'Dashboard', 'All', 'chore', 'mom', 'Add Exceptions Part', 'high'),
    ('Bihar Foundry & Casting Limited', 'abd6873e-eb90-43e4-b861-d5f906f83d10'::uuid, 'Somnath Roy', 'Work Order Indents to Approve', 'All', 'chore', 'mom', 'Update the ''Prepared By'' name, ''Approved By'' date, and logo same as the Indent format in WO Indent Approval View slip', 'high')
) AS t(
  company_name, company_id, user_name, page, division, ticket_type, communicated_through, problem_text, priority
);

INSERT INTO public.pages (name)
SELECT DISTINCT trim(s.page)
FROM seed_bihar_brahma_rows s
WHERE trim(s.page) <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.pages p
    WHERE lower(trim(p.name)) = lower(trim(s.page))
  );

CREATE TEMP TABLE seed_bihar_brahma_resolved AS
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
  s.priority
FROM seed_bihar_brahma_rows s
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
  SELECT created_by INTO cfg FROM seed_bihar_brahma_config LIMIT 1;
  IF cfg IS NULL THEN
    RAISE EXCEPTION 'No user in user_profiles/auth.users.';
  END IF;

  SELECT count(*) INTO bad_company FROM seed_bihar_brahma_resolved s WHERE s.company_id IS NULL;
  IF bad_company > 0 THEN
    RAISE EXCEPTION '% row(s): company not found.', bad_company;
  END IF;

  SELECT count(*) INTO bad_page FROM seed_bihar_brahma_resolved s WHERE s.page_id IS NULL;
  IF bad_page > 0 THEN
    SELECT string_agg(DISTINCT s.page, ', ') INTO missing_pages
    FROM seed_bihar_brahma_resolved s WHERE s.page_id IS NULL;
    RAISE EXCEPTION 'Page not found: %', COALESCE(missing_pages, '?');
  END IF;
END $$;

-- Repair rows from a previous bulk run that do not match app filters (empty quality_solution, wrong stage, etc.)
WITH repaired AS (
  UPDATE public.tickets t
  SET
    type = 'chore',
    status = 'open',
    status_1 = 'no',
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
    quality_solution = NULL,
    quality_of_response = NULL,
    staging_planned = NULL,
    live_review_status = NULL,
    live_status = NULL,
    status_4 = NULL,
    updated_at = NOW()
  FROM seed_bihar_brahma_resolved s
  WHERE lower(trim(t.description)) = lower(trim(s.problem_text))
    AND t.company_id = s.company_id
  RETURNING t.reference_no
)
SELECT count(*) AS repaired_count FROM repaired;

-- API uses quality_solution IS NULL only — empty string hides rows in Chores & Bugs
UPDATE public.tickets
SET quality_solution = NULL, updated_at = NOW()
WHERE company_id IN (
    'abd6873e-eb90-43e4-b861-d5f906f83d10',
    'd7def3ff-b59c-4925-a101-012697db0689'
  )
  AND type = 'chore'
  AND quality_solution IS NOT NULL
  AND trim(quality_solution::text) = '';

WITH ref_seed AS (
  SELECT COALESCE(MAX((substring(reference_no FROM 'CH-(\d+)'))::int), 0) AS max_no
  FROM public.tickets
  WHERE reference_no ~ '^CH-\d+$'
),
actor AS (
  SELECT c.created_by FROM seed_bihar_brahma_config c
),
to_insert AS (
  SELECT s.*, ROW_NUMBER() OVER (ORDER BY s.company_name, s.page, s.problem_text) AS row_no
  FROM seed_bihar_brahma_resolved s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.type = 'chore'
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
    quality_solution,
    quality_of_response,
    staging_planned,
    live_review_status,
    live_status,
    status_1,
    status_2,
    status_4,
    created_by,
    created_at,
    updated_at,
    query_arrival_at
  )
  SELECT
    'CH-' || LPAD((ref_seed.max_no + ti.row_no)::text, 4, '0'),
    LEFT(ti.problem_text, 200),
    ti.problem_text,
    'chore',
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
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    'no',
    'pending',
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
-- Must match Chores & Bugs open queue (same rules as GET /tickets?section=chores-bugs)
-- =============================================================================
SELECT count(*) AS visible_in_chores_bugs_queue
FROM public.tickets t
WHERE t.type IN ('chore', 'bug')
  AND t.quality_solution IS NULL
  AND (t.staging_planned IS NULL OR lower(coalesce(t.live_review_status::text, '')) = 'completed')
  AND (t.status_2 IS NULL OR lower(trim(t.status_2::text)) <> 'staging')
  AND (t.status_2 IS NULL OR lower(trim(t.status_2::text)) <> 'na')
  AND t.company_id IN (
    'abd6873e-eb90-43e4-b861-d5f906f83d10',
    'd7def3ff-b59c-4925-a101-012697db0689'
  );

SELECT reference_no, company_name, page, priority, status_1, status_2, user_name,
       LEFT(description, 60) AS problem_preview
FROM public.tickets
WHERE company_id IN (
  'abd6873e-eb90-43e4-b861-d5f906f83d10',
  'd7def3ff-b59c-4925-a101-012697db0689'
)
  AND type = 'chore'
ORDER BY created_at DESC
LIMIT 20;
