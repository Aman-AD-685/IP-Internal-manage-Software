# Email Confirmation Setup (Custom SMTP)

After registration, users receive a **confirmation link** in their email (sent via your Custom SMTP in Supabase). Clicking the link activates their account.

---

## 1. Supabase Dashboard

### Auth → URL Configuration

1. Go to **Supabase** → your project → **Authentication** → **URL Configuration**
2. **Site URL:** Your frontend base URL, e.g. `https://ip-internal-manage-software.vercel.app`
3. **Redirect URLs:** Add:
   - `http://localhost:3000/confirmation-success` (local dev)
   - `https://ip-internal-manage-software.vercel.app/confirmation-success` (production)
   - Or `https://*.vercel.app/confirmation-success` to allow preview URLs
   - `http://localhost:3001/reset-password` (local dev — Vite port)
   - `https://ip-internal-manage-software.vercel.app/reset-password` (production)
   - `https://industryprime.vercel.app/reset-password` (production alternate)
   - Or `https://*.vercel.app/reset-password` for preview URLs

### Auth → Providers → Email

- Ensure **Confirm email** is **enabled** (so confirmation emails are sent)
- Custom SMTP should already be configured if you've set it up

---

## 2. Backend .env

Add or update:

```
FRONTEND_URL=https://ip-internal-manage-software.vercel.app
```

For local dev:

```
FRONTEND_URL=http://localhost:3001
```

On **Render**: Add `FRONTEND_URL` in your service's Environment variables.

---

## 3. Flow

1. User registers → backend calls `sign_up` → Supabase sends confirmation email (Custom SMTP)
2. User clicks link in email → Supabase confirms → redirects to `/confirmation-success`
3. User logs in

---

## Password reset (Forgot password)

1. Login → **Forgot password?** → enter email → **Send reset link**
2. User clicks **Reset Password** in email → lands on `/reset-password`
3. Enter **New password** + **Confirm password** → **Update password**
4. Sign in with the new password

**Supabase Redirect URLs** must include `/reset-password` (see section 1 above).

**Backend `FRONTEND_URL`** must match your deployed frontend (used in the reset email link).

---

## Email link vs OTP

- **Confirmation link (used):** Native Supabase flow, works with Custom SMTP, one-click verify.
- **OTP:** Would require custom implementation; not built into Supabase signup.

---

## Not Receiving Confirmation Email?

### Common causes

1. **Confirm email is disabled**  
   Supabase → Auth → Providers → Email → Enable **Confirm email**.

2. **Redirect URLs not allowed**  
   Supabase → Auth → URL Configuration → Add your frontend URL + `/confirmation-success` to **Redirect URLs**.

3. **Default SMTP (rate limits)**  
   Without Custom SMTP, Supabase uses default mail (limited). Configure Custom SMTP under Project Settings → Auth → SMTP.

4. **Emails going to spam**  
   Ask users to check spam/junk. With Custom SMTP using your domain, deliverability improves.

5. **Fallback to create_user**  
   If `sign_up` fails (e.g. Supabase misconfigured), backend uses `create_user` which does **not** send email (auto-confirms). Check backend logs for `sign_up failed` / `create_user OK`.

### Resend confirmation

- After registration, the success screen shows: **"Didn't receive the email? Resend"**.
- This calls `POST /auth/resend-confirmation` with the registered email.
- User can click it if they didn’t get the first email.
