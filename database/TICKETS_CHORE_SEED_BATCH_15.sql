-- Bulk upload: 15 resolved chore tickets (visible in Register of Tickets).
--
-- Register of Tickets (app) shows rows where:
--   quality_solution IS NOT NULL   (solution submitted — required)
--   type = chore (or bug)
-- UI "Completed" filter: status_1 = yes AND status_4 = completed
--
-- This sheet provides company_id / page_id, so the script uses them DIRECTLY,
-- falling back to NAME match when an id is not found. Any missing page is
-- auto-created by name. Updates existing matching rows, then inserts missing.
-- Run entire script in Supabase SQL Editor.

BEGIN;

-- =============================================================================
-- created_by (auto-pick first user)
-- =============================================================================
CREATE TEMP TABLE seed_batch_15_config (
  created_by uuid NOT NULL
);

INSERT INTO seed_batch_15_config (created_by)
SELECT COALESCE(
  NULL::uuid,
  (SELECT id FROM public.user_profiles ORDER BY created_at ASC NULLS LAST LIMIT 1)
);

-- =============================================================================
-- Source data (your sheet — ids + names)
-- =============================================================================
CREATE TEMP TABLE seed_batch_15_src (
  company_id uuid NOT NULL,
  company_name text NOT NULL,
  user_name text,
  page_id uuid NOT NULL,
  page_name text NOT NULL,
  division text,
  communicated_through text,
  problem_text text NOT NULL,
  solution_text text,
  stage4_remarks text
);

INSERT INTO seed_batch_15_src (
  company_id, company_name, user_name, page_id, page_name, division,
  communicated_through, problem_text, solution_text, stage4_remarks
) VALUES
  ('e7bc5a03-0cd4-4c39-932f-0c3654a44c56', 'Dinesh Brothers Pvt. Ltd.', 'Rahul Kahitan', '553187fc-4a6d-48f1-a6ea-5c2c79ebfa88', 'Indent Register', 'All', 'phone', 'Can we reverse the short close Indent', 'Yes, go to indent register select on particular indent which you want to reverse then click on the reverse short close option then it will reflect on Pending Indent page.', 'This has been solved'),
  ('e11e234f-b740-4f85-aed6-2135bf37eec9', 'Ugen Ferro Alloys Pvt. Ltd.', 'Binod', 'a1b3e06b-5f95-4c0e-92db-7656847d9fe8', 'GRN Approval', 'All', 'phone', 'GRN is not showing in GRN Approval.', 'Earlier, indents could be created without selecting a department, and those were processed till GRN. However, now department-wise access has been implemented, so GRNs created without a department are not visible to the user. Please temporarily remove the department-specific access, approve the GRN, and then reassign the department-wise access again.', 'This has been solved'),
  ('0396d8f7-04e9-44b4-97ed-4de0bbbfd12c', 'Vighneshwar Ispat Pvt. Ltd.', 'Raju Sahu', '707a0e90-26ce-4d9f-b378-05bd39938ed5', 'Pending Indent RFQ', 'All', 'phone', 'How can I short close indent.', 'Go to Pending Indent(RFQ) select on particular indent which you want to short close then click on the short close option then it will reflect on Indent register with status.', 'This has been solved'),
  ('2e2ca46b-8a9a-4dd1-bbaa-905c9917aeec', 'Sky Steel & Power Pvt Ltd', 'Mansur ji', '872ad264-4c61-444f-b964-12f57ce50955', 'Quotation Comparison', 'All', 'phone', 'He wants to add a vendor in RFQ but vendor not appear in RFQ page', 'Go to QC page and add vendor from "add vendor to RFQ" option.', 'This has been solved'),
  ('c5307ba5-8403-4435-8eb8-15b33741e683', 'Bharat Hi-Tech (Cements) Pvt. Ltd', 'Kartik Mahato', '23419c42-406f-4da5-904e-bb2e7b893e85', 'Create Department', 'All', 'whatsapp', 'Please add Pipe & Fittings, IT, Civil, Media, Liner plate, Gift', 'Okay for this please check this video https://youtu.be/eP-DdplfTgU?si=rTFfRPDIlWBQNvHK and create department as per your requirement. If you face any problem please contact us.', 'This has been solved'),
  ('de61e340-fe65-47c9-bcd3-3b74aa37bada', 'Nirman TMT', 'Alok', '846df683-b7a1-420f-ab9a-ddc5af6f25d5', 'PO Register', 'All', 'whatsapp', 'PO NOT DELETED PLS RESOLVE', 'Guide him how he can delete the PO basically some network issue happening for that it face, after that he delete the PO and it is showing in register properly.', 'This has been solved'),
  ('2e2ca46b-8a9a-4dd1-bbaa-905c9917aeec', 'Sky Steel & Power Pvt Ltd', 'Mansur ji', '872ad264-4c61-444f-b964-12f57ce50955', 'Quotation Comparison', 'All', 'phone', 'He wants to add a item in PO', 'Go to PO''s to approve page click on action three dot and add item in PO', 'This has been solved'),
  ('242c3ae7-3b5b-47c0-a8cb-fd8eb47c6e77', 'Hi-Tech Power & Steel Ltd.', 'Dikesh ji', '553187fc-4a6d-48f1-a6ea-5c2c79ebfa88', 'Indent Register', 'All', 'whatsapp', 'CIVIL DEPARTMENT We haven''t ordered river sand anywhere; despite this, the need for it is still being seen here..', E'As discussed with you over the phone, regarding your concern that the order was not placed from your end, please coordinate internally with the indent creator who created the indent. Kindly discuss and verify the details internally first.\nIf any changes are required, such as changing the name or any other modifications, please let us know. We will help you with the necessary changes from our end. However, for now, please discuss this internally and update us accordingly.', 'This has been solved'),
  ('fa19aa20-32bb-4b8a-b19b-02b3f565df73', 'Super Iron Foundry Ltd', 'Mrinmoy', 'ab1a0e7b-d221-49dc-9826-8945c2d35187', 'GRN Register', 'All', 'whatsapp', 'G.R.N report download nahi ho raha hai Please solve the issue', 'As discussed with you over the phone, please try exporting GRN data for one division for 6 months. For multiple divisions, kindly export the data in 3-month intervals. Please ensure you select the correct date range while applying filters. If you face any issues, we will guide you.', 'This has been solved'),
  ('de61e340-fe65-47c9-bcd3-3b74aa37bada', 'Nirman TMT', 'OP Sahu', 'e2bb8faa-5fe5-4c11-b74c-ebf7164fd0d0', 'POs To Approve', 'All', 'whatsapp', 'Indent no 201 karnikripa SMS pl. Change item code 330435 instead of 302799', 'As discussed over the phone, regarding the item change request raised from your end, the PO has already been created, so the item cannot be changed directly in the existing PO. Please remove the item that you want to change from the PO which is currently pending for approval. After that, create a new indent for the required item. While approving the PO, you will get the "Add New Item" option. Using that option, add the new indent item into the PO. Once this process is completed, your PO will be updated and completed successfully.', 'This has been solved'),
  ('d7558ed1-f622-496d-9945-41e17c7d16ad', 'Orissa Concrete & Allied Industries Ltd(New)', 'Vedant Agrawal', '15d58f23-cd97-40c4-a647-c05e51f127f6', 'Issue', 'All', 'whatsapp', 'Doubt regarding item stock during issue creation', 'While creating the issue, you can view a separate stock column for the respective item. A detailed stock view is also available with stock location and brand details.', 'This has been solved'),
  ('e11e234f-b740-4f85-aed6-2135bf37eec9', 'Ugen Ferro Alloys Pvt. Ltd.', 'Manish ji', '92d8a292-f25c-4ce7-acc1-434df9725de6', 'Work Order Indents to Approve', 'All', 'phone', 'WRN is created but not showing in register', 'Please check WRN''s to Approve page, same process of GRN approval approve the WRN then it will showing in WRN register', 'This has been solved'),
  ('578211ea-fc0a-4b66-9198-6faed43dc542', 'Shakambari Overseas Trade Pvt. Ltd.', 'Sumit Dutta', 'ab1a0e7b-d221-49dc-9826-8945c2d35187', 'GRN Register', 'All', 'phone', 'Want to cancel a GRN for wrong entry', 'I checked the GRN date and it was 5/5/26 so i guide him to create purchase return for cancel GRN.', 'This has been solved'),
  ('2dee23a0-032c-4ebc-b8e6-da4ab3a0764f', 'Kedia Carbon Pvt. Ltd.', 'Karesh ji', 'd456671c-c9d8-4866-a09f-eb0544e93bce', 'Vendors', 'All', 'phone', 'Want to change vendor email', 'Go to vendor list click on Actions three dot then edit the vendor email', 'This has been solved'),
  ('94f359ca-9834-4082-9818-15f3c5fa4f2e', 'M/s. Singhal Enterprises (Jharsuguda) Pvt. Ltd', 'Bibhu Pradhan', 'db1c5093-7496-4317-bbe8-91e38461da8e', 'Physical Stock Taking', 'All', 'phone', 'After physical stock taking, the stock quantity was not changing.', 'There is an approval process in Physical Stock Taking. Once the physical stock taking is approved, the stock quantity will be updated accordingly.', 'This has been solved');

-- =============================================================================
-- Auto-create any page used here that is missing (by name)
-- =============================================================================
INSERT INTO public.pages (name)
SELECT DISTINCT s.page_name
FROM seed_batch_15_src s
WHERE NOT EXISTS (
  SELECT 1 FROM public.pages p
  WHERE lower(trim(p.name)) = lower(trim(s.page_name))
);

-- =============================================================================
-- Resolve effective company_id / page_id (prefer sheet id, fall back to name)
-- =============================================================================
CREATE TEMP TABLE seed_batch_15_rows AS
SELECT
  COALESCE(c_id.id, c_name.id) AS company_id,
  s.company_name,
  s.user_name,
  COALESCE(p_id.id, p_name.id) AS page_id,
  s.page_name AS page,
  s.division,
  NULL::uuid AS division_id,
  s.communicated_through,
  s.problem_text,
  s.solution_text,
  s.stage4_remarks
FROM seed_batch_15_src s
LEFT JOIN public.companies c_id
  ON c_id.id = s.company_id
LEFT JOIN public.companies c_name
  ON c_id.id IS NULL
 AND lower(trim(c_name.name)) = lower(trim(s.company_name))
LEFT JOIN public.pages p_id
  ON p_id.id = s.page_id
LEFT JOIN public.pages p_name
  ON p_id.id IS NULL
 AND lower(trim(p_name.name)) = lower(trim(s.page_name));

-- =============================================================================
-- Validate company / page resolved + created_by exists
-- =============================================================================
DO $$
DECLARE
  missing_count int;
  missing_list text;
  cfg uuid;
BEGIN
  SELECT created_by INTO cfg FROM seed_batch_15_config LIMIT 1;
  IF cfg IS NULL THEN
    RAISE EXCEPTION 'Batch 15 aborted: public.user_profiles is empty.';
  END IF;

  SELECT count(*) INTO missing_count
  FROM seed_batch_15_rows
  WHERE company_id IS NULL OR page_id IS NULL;

  IF missing_count > 0 THEN
    SELECT string_agg(company_name || ' | page=' || COALESCE(page, '?'), E'\n' ORDER BY company_name)
    INTO missing_list
    FROM seed_batch_15_rows
    WHERE company_id IS NULL OR page_id IS NULL;

    RAISE EXCEPTION E'Batch 15 aborted: % row(s) company/page not found by id or name.\n%\nRun: SELECT id, name FROM public.companies ORDER BY name;',
      missing_count, COALESCE(missing_list, '');
  END IF;

  RAISE NOTICE 'Batch 15: created_by = %', cfg;
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
  FROM seed_batch_15_rows s
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
  FROM seed_batch_15_config c
  INNER JOIN public.user_profiles u ON u.id = c.created_by
),
to_insert AS (
  SELECT s.*, ROW_NUMBER() OVER (ORDER BY s.company_name, s.problem_text) AS row_no
  FROM seed_batch_15_rows s
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
INNER JOIN seed_batch_15_rows s
  ON t.company_id = s.company_id
 AND lower(trim(COALESCE(t.description, ''))) = lower(trim(s.problem_text))
WHERE t.type = 'chore'
ORDER BY t.reference_no DESC;

COMMIT;

NOTIFY pgrst, 'reload schema';
