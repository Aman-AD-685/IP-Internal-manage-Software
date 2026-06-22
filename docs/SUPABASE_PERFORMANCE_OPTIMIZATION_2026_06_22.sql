-- Supabase/Postgres performance optimization script for FMS.
-- Date: 2026-06-22
--
-- Run from Supabase SQL Editor during a low-traffic window.
-- This version intentionally does NOT use CREATE INDEX CONCURRENTLY because
-- Supabase SQL Editor can wrap a full script in a transaction block.
-- If a table is very large and you need zero-write-blocking index creation,
-- run an individual CREATE INDEX CONCURRENTLY statement separately, not this full batch.
-- These statements are additive and preserve business data/logic.

set statement_timeout = '15min';
set lock_timeout = '5s';

-- Optional but strongly recommended for text search filters using ILIKE.
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- Tickets: hot list/dashboard filters
-- ---------------------------------------------------------------------------

create index if not exists idx_tickets_type_created_at_desc
  on public.tickets (type, created_at desc);

create index if not exists idx_tickets_open_cb_created_active
  on public.tickets (type, created_at desc)
  where type in ('chore', 'bug')
    and quality_solution is null
    and repeat_of_ticket_id is null
    and coalesce(status_2, '') <> 'staging'
    and coalesce(status_2, '') <> 'na';

create index if not exists idx_tickets_type_status2_created_at_desc
  on public.tickets (type, status_2, created_at desc)
  where status_2 is not null;

create index if not exists idx_tickets_approval_queue_created_at_desc
  on public.tickets (approval_status, created_at desc)
  where type = 'feature'
    and coalesce(approval_status, '') in ('', 'unapproved', 'rejected', 'hold');

create index if not exists idx_tickets_live_status_created_at_desc
  on public.tickets (live_status, created_at desc)
  where live_status is not null;

create index if not exists idx_tickets_staging_open_created_at_desc
  on public.tickets (created_at desc)
  where (staging_planned is not null or status_2 = 'staging')
    and coalesce(live_review_status, '') <> 'completed';

create index if not exists idx_tickets_company_created_at_desc
  on public.tickets (company_id, created_at desc)
  where company_id is not null;

create index if not exists idx_tickets_reference_no_trgm
  on public.tickets using gin (reference_no gin_trgm_ops);

create index if not exists idx_tickets_company_name_trgm
  on public.tickets using gin (company_name gin_trgm_ops);

create index if not exists idx_tickets_submitted_by_trgm
  on public.tickets using gin (submitted_by gin_trgm_ops);

create index if not exists idx_tickets_customer_questions_trgm
  on public.tickets using gin (customer_questions gin_trgm_ops);

create index if not exists idx_tickets_title_trgm
  on public.tickets using gin (title gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Dashboard/detail and notifications
-- ---------------------------------------------------------------------------

create index if not exists idx_ticket_stage2_remarks_ticket_added_at
  on public.ticket_stage2_remarks (ticket_id, added_at);

create index if not exists idx_ticket_stage2_remarks_added_by_added_at
  on public.ticket_stage2_remarks (added_by, added_at desc);

create index if not exists idx_stage2_notification_seen_user_remark
  on public.stage2_remark_notification_seen (user_id, remark_id);

create index if not exists idx_ticket_responses_ticket_created_at
  on public.ticket_responses (ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- Client payment: open/completed lists, payment dashboards, ageing report
-- ---------------------------------------------------------------------------

create index if not exists idx_ocp_open_active_timestamp_desc
  on public.onboarding_client_payment (timestamp desc)
  where payment_received_date is null
    and coalesce(marked_na, false) = false;

create index if not exists idx_ocp_open_na_timestamp_desc
  on public.onboarding_client_payment (timestamp desc)
  where payment_received_date is null
    and marked_na = true;

create index if not exists idx_ocp_completed_genre_timestamp_desc
  on public.onboarding_client_payment (genre, timestamp desc)
  where payment_received_date is not null;

create index if not exists idx_ocp_invoice_date
  on public.onboarding_client_payment (invoice_date)
  where invoice_date is not null;

create index if not exists idx_ocp_payment_received_date
  on public.onboarding_client_payment (payment_received_date)
  where payment_received_date is not null;

create index if not exists idx_ocp_company_id_timestamp_desc
  on public.onboarding_client_payment (company_id, timestamp desc)
  where company_id is not null;

create index if not exists idx_ocp_receive_payment_date_client
  on public.onboarding_client_payment_receive (payment_date desc, client_payment_id);

create index if not exists idx_ocp_receive_client_payment_id
  on public.onboarding_client_payment_receive (client_payment_id);

create index if not exists idx_ocp_followups_client_no
  on public.onboarding_client_payment_followups (client_payment_id, followup_no);

create index if not exists idx_ocp_followup1_client
  on public.onboarding_client_payment_followup1 (client_payment_id);

create index if not exists idx_ocp_sent_client
  on public.onboarding_client_payment_sent (client_payment_id);

create index if not exists idx_ocp_intercept_tagged_user
  on public.onboarding_client_payment_intercept (tagged_user_id)
  where tagged_user_id is not null;

create index if not exists idx_ocp_intercept_tagged_user_2
  on public.onboarding_client_payment_intercept (tagged_user_2_id)
  where tagged_user_2_id is not null;

create index if not exists idx_ocp_intercept_pending_t1
  on public.onboarding_client_payment_intercept (created_at desc)
  where tagged_user_id is not null
    and payment_action_submitted_at is null;

create index if not exists idx_ocp_intercept_pending_t2
  on public.onboarding_client_payment_intercept (created_at desc)
  where payment_action_submitted_at is not null
    and payment_action_2_submitted_at is null;

-- ---------------------------------------------------------------------------
-- Checklist, delegation, KPI logs
-- ---------------------------------------------------------------------------

create index if not exists idx_checklist_tasks_department_doer
  on public.checklist_tasks (department, doer_id);

create index if not exists idx_checklist_completions_occurrence_task
  on public.checklist_completions (occurrence_date, task_id);

create index if not exists idx_delegation_tasks_status_due_date
  on public.delegation_tasks (status, due_date);

create index if not exists idx_delegation_tasks_delegation_on
  on public.delegation_tasks (delegation_on);

create index if not exists idx_kpi_daily_work_log_user_work_date
  on public.kpi_daily_work_log (user_id, work_date);

create index if not exists idx_adrija_social_kpi_day_work_date
  on public.onboarding_adrija_social_kpi_day (work_date);

-- ---------------------------------------------------------------------------
-- DB client and lead/client-to-lead surfaces
-- ---------------------------------------------------------------------------

create index if not exists idx_db_client_onb_status_updated_at
  on public.db_client_client_onb (status, updated_at desc);

create index if not exists idx_db_client_onb_reference_no_trgm
  on public.db_client_client_onb using gin (reference_no gin_trgm_ops);

create index if not exists idx_db_client_onb_company_name_trgm
  on public.db_client_client_onb using gin (company_name gin_trgm_ops);

-- Keep planner statistics fresh after adding indexes.
analyze public.tickets;
analyze public.onboarding_client_payment;
analyze public.onboarding_client_payment_receive;
analyze public.delegation_tasks;
analyze public.checklist_tasks;
analyze public.db_client_client_onb;

notify pgrst, 'reload schema';
