-- Bulk upload: 10 resolved chore tickets (visible in Register of Tickets).
--
-- Register of Tickets (app) shows rows where:
--   quality_solution IS NOT NULL   (solution submitted — required)
--   type = chore (or bug)
-- UI "Completed" filter: status_1 = yes AND status_4 = completed
--
-- Resolves company_id / page_id by NAME (not sheet UUIDs).
-- Updates existing matching rows, then inserts missing rows.
-- Run entire script in Supabase SQL Editor.

BEGIN;

-- =============================================================================
-- created_by (auto-pick first user)
-- =============================================================================
CREATE TEMP TABLE seed_batch_10_config (
  created_by uuid NOT NULL
);

INSERT INTO seed_batch_10_config (created_by)
SELECT COALESCE(
  NULL::uuid,
  (SELECT id FROM public.user_profiles ORDER BY created_at ASC NULLS LAST LIMIT 1)
);

-- =============================================================================
-- Pages used in this batch
-- =============================================================================
INSERT INTO public.pages (name)
SELECT v.page_name
FROM (
  VALUES
    ('Create Po'), ('Create PO'),
    ('PO Register'),
    ('GRN Approval'),
    ('Vendors'),
    ('Indent Register'),
    ('Users'),
    ('RFQ'),
    ('Dashboard')
) AS v(page_name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.pages p
  WHERE lower(trim(p.name)) = lower(trim(v.page_name))
);

-- =============================================================================
-- Source data (your sheet — names only)
-- =============================================================================
CREATE TEMP TABLE seed_batch_10_src (
  company_name text NOT NULL,
  user_name text,
  page_name text NOT NULL,
  division text,
  communicated_through text,
  problem_text text NOT NULL,
  solution_text text,
  stage4_remarks text
);

INSERT INTO seed_batch_10_src (
  company_name, user_name, page_name, division,
  communicated_through, problem_text, solution_text, stage4_remarks
) VALUES
  ('Balmukund Sponge Iron Pvt. Ltd.', 'Dipannita', 'Create Po', 'All', 'phone', 'How to put rate in foreign currency (USD) from out side india vendor.', 'Change the currency in create PO page with the exchange rate.', 'This has been solved'),
  ('Shakambari Overseas Trade Pvt. Ltd.', 'Suman Dey', 'PO Register', 'All', 'phone', 'Want to change one item in PO is this possible?', 'No this is not possible to change item after PO creation. Also you mentioned that PO has already been approved so item cannot be changed. Please create new Indent and PO.', 'This has been solved'),
  ('Kodarma Chemical Pvt. Ltd.', 'Pappu ji', 'PO Register', 'All', 'phone', 'Want to edit some details in PO', 'Only PO approver can edit the PO after approval so please contact with approver.', 'This has been solved'),
  ('Karni Kripa Power Pvt Ltd.', 'Harprasad Patre', 'GRN Approval', 'All', 'phone', 'OP sahu ji has given GRN approval access on my i''d then how can I edit or approved GRN.', 'Go to Transaction then right side has GRN Approval page. click on then actions three dot view slip and approve or unapprove the GRN. Also click Edit as per your requirement you can changed.', 'This has been solved'),
  ('Crescent Foundry Co Pvt.Ltd.', 'Sabbyasachi', 'Vendors', 'All', 'phone', 'Need vendor list in excel.', 'Go to ''Vendors'' then click on ''Export'', you will get the data in excel.', 'This has been solved'),
  ('Ugen Ferro Alloys Pvt. Ltd.', 'Binod', 'GRN Approval', 'All', 'phone', 'GRN is not showing in GRN Approval.', 'The user who could not see the GRNS for approvals has no access in thos departments for which GRNS has been made. User has to get access of those departments.', 'This has been solved'),
  ('Pratishtha Spirits Private Limited', 'Shashi ji', 'Indent Register', 'All', 'phone', 'Want to check in one report PO Qty, GRN Qty, Pending Qty and Vendor name', 'You can check Indent register export the report and then check the details. Here all your requirement is present.', 'This has been solved'),
  ('Bihar Foundry & Casting Limited', 'Somnath', 'Users', 'All', 'whatsapp', 'Create user I''D.', 'I''D has been created.', 'This has been solved'),
  ('Crescent Foundry Co Pvt.Ltd.', 'Deyotriyo', 'RFQ', 'All', 'whatsapp', 'Mail is delivering to vendor in spam folder.', 'Checked and problem is in user end.', 'This has been solved'),
  ('Brahmaputra Metallics Ltd.', 'Dilip Keshari', 'Dashboard', 'All', 'whatsapp', 'Create a new division in ERP (name:rolling mill project)', 'Division has been created and access has been provided in snrbml38@gmail.com this I''D.', 'This has been solved');

-- =============================================================================
-- Resolve company_id / page_id
-- =============================================================================
CREATE TEMP TABLE seed_batch_10_rows AS
WITH norm AS (
  SELECT
    r.*,
    lower(regexp_replace(regexp_replace(trim(r.company_name), '\s+', ' ', 'g'), '[.,&]', '', 'g')) AS company_norm,
    lower(regexp_replace(regexp_replace(trim(r.page_name), '\s+', ' ', 'g'), '[.,]', '', 'g')) AS page_norm
  FROM seed_batch_10_src r
)
SELECT
  COALESCE(c_exact.id, c_norm.id) AS company_id,
  r.company_name,
  r.user_name,
  COALESCE(p_exact.id, p_norm.id) AS page_id,
  r.page_name AS page,
  r.division,
  NULL::uuid AS division_id,
  r.communicated_through,
  r.problem_text,
  r.solution_text,
  r.stage4_remarks
FROM norm r
LEFT JOIN public.companies c_exact
  ON lower(trim(c_exact.name)) = lower(trim(r.company_name))
LEFT JOIN public.companies c_norm
  ON c_exact.id IS NULL
 AND lower(regexp_replace(regexp_replace(trim(c_norm.name), '\s+', ' ', 'g'), '[.,&]', '', 'g')) = r.company_norm
LEFT JOIN public.pages p_exact
  ON lower(trim(p_exact.name)) = lower(trim(r.page_name))
LEFT JOIN public.pages p_norm
  ON p_exact.id IS NULL
 AND lower(regexp_replace(regexp_replace(trim(p_norm.name), '\s+', ' ', 'g'), '[.,]', '', 'g')) = r.page_norm;

-- =============================================================================
-- Validate names resolved
-- =============================================================================
DO $$
DECLARE
  missing_count int;
  missing_list text;
  cfg uuid;
BEGIN
  SELECT created_by INTO cfg FROM seed_batch_10_config LIMIT 1;
  IF cfg IS NULL THEN
    RAISE EXCEPTION 'Batch 10 aborted: public.user_profiles is empty.';
  END IF;

  SELECT count(*) INTO missing_count
  FROM seed_batch_10_rows
  WHERE company_id IS NULL OR page_id IS NULL;

  IF missing_count > 0 THEN
    SELECT string_agg(company_name || ' | page=' || COALESCE(page, '?'), E'\n' ORDER BY company_name)
    INTO missing_list
    FROM seed_batch_10_rows
    WHERE company_id IS NULL OR page_id IS NULL;

    RAISE EXCEPTION E'Batch 10 aborted: % row(s) company/page not found by name.\n%\nRun: SELECT name FROM public.companies ORDER BY name;',
      missing_count, COALESCE(missing_list, '');
  END IF;

  RAISE NOTICE 'Batch 10: created_by = %', cfg;
END $$;

-- =============================================================================
-- STEP A — Fix existing tickets (same company + problem) so Register shows them
-- =============================================================================
WITH fixed AS (
  UPDATE public.tickets t
  SET
    company_name = s.company_name,
    page_id = s.page_id,
    page = s.page,
    division = s.division,
    user_name = s.user_name,
    communicated_through = s.communicated_through,
    submitted_by = COALESCE(t.submitted_by, s.user_name),
    customer_questions = s.problem_text,
    quality_of_response = s.solution_text,
    quality_solution = s.solution_text,
    remarks = s.stage4_remarks,
    status = 'resolved',
    status_1 = 'yes',
    actual_1 = COALESCE(t.actual_1, NOW()),
    status_4 = 'completed',
    actual_4 = COALESCE(t.actual_4, NOW()),
    query_arrival_at = COALESCE(t.query_arrival_at, NOW()),
    query_response_at = COALESCE(t.query_response_at, NOW()),
    updated_at = NOW()
  FROM seed_batch_10_rows s
  WHERE t.type = 'chore'
    AND t.company_id = s.company_id
    AND lower(trim(COALESCE(t.description, ''))) = lower(trim(s.problem_text))
  RETURNING t.reference_no
)
SELECT count(*) AS updated_existing_count FROM fixed;

-- =============================================================================
-- STEP B — Insert rows that do not exist yet
-- =============================================================================
WITH ref_seed AS (
  SELECT COALESCE(MAX((substring(reference_no FROM 'CH-(\d+)'))::int), 0) AS max_no
  FROM public.tickets
  WHERE reference_no ~ '^CH-\d+$'
),
actor AS (
  SELECT c.created_by
  FROM seed_batch_10_config c
  INNER JOIN public.user_profiles u ON u.id = c.created_by
),
to_insert AS (
  SELECT s.*, ROW_NUMBER() OVER (ORDER BY s.company_name, s.problem_text) AS row_no
  FROM seed_batch_10_rows s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.tickets t
    WHERE t.type = 'chore'
      AND t.company_id = s.company_id
      AND lower(trim(COALESCE(t.description, ''))) = lower(trim(s.problem_text))
  )
),
inserted AS (
  INSERT INTO public.tickets (
    reference_no, title, description, type, status, priority,
    company_id, company_name, page_id, page, division_id, division,
    user_name, communicated_through, submitted_by,
    customer_questions, quality_of_response, quality_solution, remarks,
    query_arrival_at, query_response_at,
    status_1, actual_1, status_4, actual_4,
    created_by, created_at, updated_at
  )
  SELECT
    'CH-' || LPAD((ref_seed.max_no + ti.row_no)::text, 4, '0'),
    LEFT(ti.problem_text, 200),
    ti.problem_text,
    'chore',
    'resolved',
    'medium',
    ti.company_id,
    ti.company_name,
    ti.page_id,
    ti.page,
    ti.division_id,
    ti.division,
    ti.user_name,
    ti.communicated_through,
    ti.user_name,
    ti.problem_text,
    ti.solution_text,
    ti.solution_text,
    ti.stage4_remarks,
    NOW(),
    NOW(),
    'yes',
    NOW(),
    'completed',
    NOW(),
    actor.created_by,
    NOW(),
    NOW()
  FROM to_insert ti
  CROSS JOIN ref_seed
  CROSS JOIN actor
  RETURNING reference_no, company_name, page
)
SELECT count(*) AS inserted_new_count FROM inserted;

-- =============================================================================
-- STEP C — Verify: rows visible in Register of Tickets API rules
-- =============================================================================
SELECT
  t.reference_no,
  t.company_name,
  t.page,
  t.user_name,
  t.status_1,
  t.status_4,
  (t.quality_solution IS NOT NULL) AS visible_in_register,
  LEFT(t.description, 60) AS problem_preview
FROM public.tickets t
INNER JOIN seed_batch_10_rows s
  ON t.company_id = s.company_id
 AND lower(trim(COALESCE(t.description, ''))) = lower(trim(s.problem_text))
WHERE t.type = 'chore'
ORDER BY t.reference_no DESC;

COMMIT;

NOTIFY pgrst, 'reload schema';
