# FMS - Final Setup & Verification Guide

## Your .env is Updated

- Set **SUPABASE_DB_URL** in `backend/.env` from Supabase → Settings → Database → Connection string (URI).
- URL-encode special characters in the password (e.g. `@` → `%40`). Never commit real passwords.

---

## DNS Error Fix: Run SQL Manually in Supabase

The error `could not translate host name` means your network cannot reach Supabase's database host. **Use Supabase SQL Editor instead** – no external connection needed.

### Step 1: Run Database Migrations (Manual)

1. Go to **Supabase Dashboard** → Your project
2. Click **SQL Editor** in the left sidebar
3. Click **New query**
4. Open `database/RUN_IN_SUPABASE.sql` in your project
5. **Copy the entire file content**
6. **Paste** into the SQL Editor
7. Click **Run** (or Ctrl+Enter)
8. You should see **Success. No rows returned** (or similar)

### Step 2: Verify Database

In SQL Editor, run:

```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' ORDER BY table_name;
```

You should see: `companies`, `divisions`, `pages`, `ticket_responses`, `tickets`, etc.

---

## Step 3: Start & Test the Application

### Start Backend

```powershell
cd "c:\Support FMS to APPLICATION\backend"
$env:PYTHONIOENCODING="utf-8"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Verify:** Open http://127.0.0.1:8000/health → Should show `{"status":"ok"}`

### Start Frontend (New Terminal)

```powershell
cd "c:\Support FMS to APPLICATION\fms-frontend"
npm run dev
```

**Verify:** Open http://localhost:3002

---

## Step 4: Full Verification Checklist

| # | Test | How | Pass |
|---|------|-----|------|
| 1 | SQL ran successfully | Supabase SQL Editor → Run RUN_IN_SUPABASE.sql | ☐ |
| 2 | Tables exist | Run `SELECT table_name...` in SQL Editor | ☐ |
| 3 | Backend health | http://127.0.0.1:8000/health | ☐ |
| 4 | Frontend loads | http://localhost:3002 | ☐ |
| 5 | Register | Create new account | ☐ |
| 6 | Login | Sign in with new account | ☐ |
| 7 | Dashboard | See metric cards | ☐ |
| 8 | Add New ticket | Click Add New → Fill form → Submit | ☐ |
| 9 | All Tickets | Support → All Tickets → Table loads | ☐ |
| 10 | Ticket Detail | Click a row → Drawer opens | ☐ |

---

## Summary

1. **Run** `database/RUN_IN_SUPABASE.sql` in Supabase SQL Editor
2. **Start** backend and frontend
3. **Test** Register → Login → Add ticket → All Tickets

Your `.env` is configured. The app uses Supabase API (SUPABASE_URL, keys) for normal operation – the direct DB URL is only for migrations. Since DNS blocks the direct connection, use the manual SQL method above.
