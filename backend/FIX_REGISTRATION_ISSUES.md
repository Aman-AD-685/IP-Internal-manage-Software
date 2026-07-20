# Fix Registration Issues - ID Not Stored & No Email

## Problems
1. User ID not being stored in database
2. No confirmation email received

## Root Causes
1. **Using ANON_KEY instead of SERVICE_ROLE_KEY** - ANON_KEY has limited permissions
2. **Email confirmation disabled** in Supabase Auth settings
3. **Missing error handling** - errors might be silently failing

---

## Step-by-Step Fix

### Step 1: Get Supabase Service Role Key

1. Go to **Supabase Dashboard**
2. Click **Settings** → **API**
3. Find **service_role** key (NOT anon key)
4. Copy it (keep it secret!)

### Step 2: Update Backend Environment Variables

Create/update `backend/.env`:

```env
SUPABASE_URL=https://odsydofrnpijlgsyndtx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
SUPABASE_ANON_KEY=your_anon_public_jwt_here
```

**Important**: Use `SERVICE_ROLE_KEY` for backend operations (it has admin permissions)

### Step 3: Update Supabase Client to Use Service Role Key

Update `backend/app/supabase_client.py` to use SERVICE_ROLE_KEY for admin operations.

### Step 4: Enable Email Confirmation in Supabase

1. Go to **Supabase Dashboard** → **Authentication** → **Settings**
2. Under **Email Auth**, ensure:
   - ✅ **Enable email confirmations** is checked
   - ✅ **Enable email signup** is checked
3. Under **Email Templates**, check **Confirm signup** template exists
4. Under **URL Configuration**:
   - **Site URL**: `http://localhost:3001`
   - **Redirect URLs**: Add:
     - `http://localhost:3001/confirmation-success`
     - `http://localhost:3001/auth/confirm`
     - `http://127.0.0.1:3001/confirmation-success`
     - `http://127.0.0.1:3001/auth/confirm`

### Step 5: Test Email Delivery

1. Go to **Supabase Dashboard** → **Authentication** → **Users**
2. Try registering a user
3. Check if user appears in `auth.users`
4. Check **Logs** → **Auth Logs** for email sending status

---

## Quick Fix Script

Run this to check current Supabase configuration:

```sql
-- Check if email confirmation is required
SELECT 
    name,
    raw_base_config->>'enable_signup' as enable_signup,
    raw_base_config->>'enable_email_confirmations' as email_confirmations
FROM auth.config;
```

---

## Backend Code Updates Needed

1. Use SERVICE_ROLE_KEY for admin operations
2. Add better error logging
3. Verify user creation succeeded
4. Check email sending status
