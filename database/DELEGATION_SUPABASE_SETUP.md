# Delegation Module – Supabase Setup

Follow these steps to set up the Delegation tasks feature in Supabase.

## 1. Base table (if not already created)

If you have not run the main delegation script before, run this first in **Supabase → SQL Editor**:

**File:** `DELEGATION_AND_PENDING_REMINDER.sql`

- Creates `delegation_tasks` and `pending_reminder_sent`
- Includes columns: `title`, `assignee_id`, `due_date`, `status`, `created_by`, `delegation_on`, `submission_date`, `has_document`, `document_url`, `submitted_by`, `reference_no`, `completed_at`

## 2. Add new columns (existing databases)

If `delegation_tasks` already exists but is missing newer columns, run:

**File:** `DELEGATION_TASKS_ADD_FIELDS.sql`

- Adds: `delegation_on`, `submission_date`, `has_document`, `document_url`, `submitted_by`, `reference_no`, `completed_at`
- Creates indexes and reloads schema cache

**Steps:**

1. Open **Supabase Dashboard** → your project.
2. Go to **SQL Editor** → **New query**.
3. Paste the full contents of `DELEGATION_TASKS_ADD_FIELDS.sql`.
4. Click **Run** (or Ctrl+Enter).
5. Confirm there are no errors.

## 2b. Shifted column (auto when Submission Date passes)

**File:** `DELEGATION_SHIFTED.sql`

Adds:

- `shift_count` — how many times the submission date was auto-advanced
- `shift_history` — JSON array of each shift (`from` / `to` / `shifted_on`)
- `last_assigned_date` — date after the latest shift

Backend auto-applies on `GET /delegation/tasks` for pending/in_progress rows where `submission_date < today` (bumps one day at a time until today).

## 3. RLS (Row Level Security)

The base script enables RLS on `delegation_tasks` with:

- **SELECT**: all authenticated users
- **INSERT**: all authenticated users
- **UPDATE**: all authenticated users

Application logic in the backend restricts:

- **List:** Regular users see only their assigned tasks; Admin/Master Admin see all (with optional user filter).
- **Update:** Only Master Admin can edit task fields; assignee or Admin can only set status to Completed/Cancelled (and upload document when completing if required).

## 4. Optional: Stricter RLS (by role)

If you want to enforce more in the database, you can replace the generic update policy with role-based policies using `auth.jwt() ->> 'user_role'` (if you store role in the JWT) or a custom `user_roles` table. The current app relies on the backend for role checks.

## 5. File upload (document on complete)

Document upload uses the same storage as ticket attachments. Ensure:

- Storage bucket exists (e.g. `ticket-attachments` or the one used by `/upload`).
- Backend env has `SUPABASE_STORAGE_JWT` set for uploads.

## 6. Quick checklist

- [ ] Run `DELEGATION_AND_PENDING_REMINDER.sql` (new project) **or** `DELEGATION_TASKS_ADD_FIELDS.sql` (existing table).
- [ ] Run `DELEGATION_SHIFTED.sql` (adds `shift_count`, `shift_history`, `last_assigned_date` for auto Submission Date roll-forward).
- [ ] No errors in SQL Editor; `NOTIFY pgrst, 'reload schema'` completed.
- [ ] Backend restarted after schema changes.
- [ ] Frontend: Status filter default is “Pending”; Admin/Master can use “Filter by user” and “All Tasks”.
- [ ] Master Admin can use “Edit” on a task; others can only “Complete” (with document upload if Document = Yes) or “Cancel”.
- [ ] Shifted column: overdue pending tasks advance Submission Date; hover count shows history (due_date left unchanged for KPI).
