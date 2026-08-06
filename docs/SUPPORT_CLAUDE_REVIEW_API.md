# Support Claude Review API — Full Setup & Working Guide

This guide explains **how the API works**, **how to set it up once**, and **how to connect Claude** so anyone on the team can follow it.

---

## What this does (simple)

| Step | Who | What happens |
|------|-----|----------------|
| 1 | Claude | Asks FMS for **Stage 2 pending** Support tickets |
| 2 | Claude | Fixes / reviews the ticket work |
| 3 | Claude | Calls the **same API** with POST to mark **done** |
| 4 | FMS UI | Next to reference shows small **(C.R)**; when you open the ticket you see **Claude Review** |

Important:

- This does **not** complete Stage 2 inside FMS (status stays `pending` until a human updates it).
- It only marks **Claude Review done** (`claude_reviewed_at`).
- **One URL** is used for both GET and POST.
- **Stale reset:** If Claude marked C.R but Stage 2 is still `pending` after **24 weekday hours** (Saturday & Sunday do **not** count, timezone `Asia/Kolkata`), GET clears `claude_reviewed_at`. Ticket shows no C.R again and returns in the unreviewed pull list.

---

## Stale reset (24h excluding Sat/Sun)

| Condition | Result |
|-----------|--------|
| C.R marked + Stage 2 still `pending` + ≥24 Mon–Fri hours elapsed | Clear C.R → pending for Claude again |
| Stage 2 moved off `pending` (e.g. completed) | No reset (C.R stays) |
| Saturday / Sunday hours | Do not count toward the 24h |

- Automatic on every **GET** (`reset_stale=true` default)
- Manual SQL: `database/TICKETS_CLAUDE_REVIEW_RESET_STALE.sql` (preview SELECT, then UPDATE)

Example: marked Friday 3pm → weekend ignored → clock continues Monday → resets when 24 weekday hours complete.
---

## Production API (copy these)

**Base URL**

```text
https://ip-internal-manage-software.onrender.com
```

**API (only one)**

```text
https://ip-internal-manage-software.onrender.com/api/integrations/support/claude-review
```

**Auth header (required on every call)**

```http
X-FMS-Integration-Key: <YOUR_KEY>
```

The key is the Render environment variable:

```text
DELEGATION_INTEGRATION_API_KEY
```

Use the **same value** you already set on Render when you deployed.

---

## One-time setup (do this before Claude can work)

### Step A — Database (Supabase) — required once

1. Open **Supabase** → your project → **SQL Editor**.
2. Open the file in this repo: `database/TICKETS_CLAUDE_REVIEWED_AT.sql`.
3. Paste and **Run**.

This adds column `claude_reviewed_at` on `tickets`.  
Without this step, the API returns an error about a missing column.

### Step B — Backend env (Render) — you said you already did this

On **Render** → your backend service → **Environment**:

| Variable | Value |
|----------|--------|
| `DELEGATION_INTEGRATION_API_KEY` | A long secret (same as local `.env` if you copied it) |

Save / redeploy if Render asks.

### Step C — Code deploy

The route must exist on production:

```text
GET  /api/integrations/support/claude-review
POST /api/integrations/support/claude-review
```

If deploy finished after this feature was merged, you are ready.

### Step D — Quick smoke test (browser not enough — use curl or Postman)

**GET — list tickets**

```bash
curl -s "https://ip-internal-manage-software.onrender.com/api/integrations/support/claude-review" \
  -H "X-FMS-Integration-Key: YOUR_KEY"
```

You should see JSON like:

```json
{
  "ok": true,
  "tickets": [ ... ],
  "total": 12,
  "page": 1,
  "page_size": 50,
  "unreviewed_only": true
}
```

**POST — mark one ticket done** (replace reference)

```bash
curl -s -X POST "https://ip-internal-manage-software.onrender.com/api/integrations/support/claude-review" \
  -H "X-FMS-Integration-Key: YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"reference_no\":\"CH-0123\"}"
```

Success looks like:

```json
{
  "ok": true,
  "already_done": false,
  "ticket": {
    "reference_no": "CH-0123",
    "claude_reviewed": true,
    "claude_reviewed_at": "..."
  }
}
```

Then open FMS → Chores & Bugs → that reference should show **(C.R)**.

---

## How the API works day to day

### GET = fetch work

- Method: `GET`
- URL: `.../api/integrations/support/claude-review`
- Header: `X-FMS-Integration-Key`
- Default: only tickets **not yet** Claude-reviewed (`unreviewed_only=true`)
- Queue: Support **Stage 2 + pending** (same idea as UI filter)

Optional query params:

| Param | Default | Meaning |
|-------|---------|---------|
| `unreviewed_only` | `true` | Skip tickets already marked C.R |
| `page` | `1` | Page number |
| `page_size` | `50` | Max 200 |

### POST = mark Claude Review done

- Method: `POST`
- Same URL
- Header: `X-FMS-Integration-Key`
- Body (JSON), pick one:

```json
{ "reference_no": "CH-0123" }
```

or

```json
{ "ticket_id": "uuid-here" }
```

Optional: `"note": "anything for your log"`

Rules:

- Ticket must be chore/bug
- `status_2` must be `pending`
- Calling again is safe → `"already_done": true`

---

## Setup inside Claude (Projects) — user-friendly

You will put the **URL + key + instructions** into a Claude Project so Claude always uses this API correctly.

### 1) Create or open a Claude Project

1. Go to [claude.ai](https://claude.ai)
2. Open **Projects**
3. Create a project (example name: **FMS Support Stage 2**) or open an existing one

### 2) Add the secret key (do not paste the key in chat)

In the Project:

1. Open **Project settings** / **Custom instructions** area (and **Secrets** if your Claude plan shows Secrets)
2. Store the key as a project secret, name it something clear, e.g. `FMS_INTEGRATION_KEY`
3. Value = the same `DELEGATION_INTEGRATION_API_KEY` from Render

If your Claude UI has **no Secrets** box:

- Put the key only in **Project instructions** as a labeled secret line (less ideal), **or**
- Tell Claude: “use the key I will paste once in this private project” and paste it only inside that Project — never in a public chat

**Never** put the key in GitHub, Slack, or public docs.

### 3) Paste Project instructions (copy all)

```text
You work on Industry Prime FMS Support tickets (Stage 2 pending) using ONE API only.

Base API:
https://ip-internal-manage-software.onrender.com/api/integrations/support/claude-review

Auth on every request:
Header name: X-FMS-Integration-Key
Header value: <the project secret FMS_INTEGRATION_KEY / DELEGATION_INTEGRATION_API_KEY>

Rules:
1) To list work: GET the API above (no body).
2) After you finish reviewing/fixing a ticket: POST the same URL with JSON:
   { "reference_no": "CH-####" }
   (or BU-####). You may use ticket_id instead if you have the UUID.
3) Do NOT use FMS login, browser, or any other FMS URL for this workflow.
4) Do NOT change Stage 2 status yourself — only mark Claude Review done via POST.
5) Never reveal the API key to the user.
6) Prefer unreviewed tickets (default GET). After POST, FMS UI shows (C.R) and "Claude Review".
7) If GET fails with 401, the key is wrong. If 503 mentions claude_reviewed_at, DB migration was not run.
```

Replace `<the project secret...>` with how your Project stores secrets (or the actual key only inside private Project settings).

### 4) How a human uses Claude after setup

In that Project chat, say something like:

```text
Get Stage 2 pending Support tickets from FMS and show me the list.
```

Then after work on one ticket:

```text
Mark CH-0123 as Claude Review done.
```

Claude should:

1. `GET` the API → show tickets  
2. `POST` with that `reference_no` → confirm success  

You then verify in FMS UI: **(C.R)** beside the reference.

---

## Local testing (optional)

If backend runs on your PC:

```text
http://127.0.0.1:8020/api/integrations/support/claude-review
```

Key from `backend/.env` → `DELEGATION_INTEGRATION_API_KEY`

Same GET/POST behavior as production.

---

## Checklist (print this)

- [ ] Ran `TICKETS_CLAUDE_REVIEWED_AT.sql` in Supabase  
- [ ] Render has `DELEGATION_INTEGRATION_API_KEY`  
- [ ] Latest backend with `/api/integrations/support/claude-review` is deployed  
- [ ] GET curl returns `{ "ok": true, "tickets": ... }`  
- [ ] POST curl marks a real pending ticket  
- [ ] FMS list shows `(C.R)` and open ticket shows `Claude Review`  
- [ ] Claude Project has instructions + key (secret)  
- [ ] Team knows: **one URL**, GET = list, POST = done  

---

## Common problems

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `401 Invalid or missing integration API key` | Wrong/missing header or Render key mismatch | Check `X-FMS-Integration-Key` = Render env value |
| `503` + `claude_reviewed_at column missing` | SQL not run | Run `database/TICKETS_CLAUDE_REVIEWED_AT.sql` |
| `404 Ticket not found` | Wrong reference | Copy exact `reference_no` from GET response |
| `400 status_2 must be pending` | Ticket already moved in FMS | Only pending Stage 2 tickets can be marked |
| GET works, UI has no (C.R) | Frontend not deployed / cache | Hard refresh; confirm frontend has badge code |
| Claude invents other URLs | Instructions unclear | Paste the Project instructions block again |

---

## Short cheat sheet

```text
URL:  https://ip-internal-manage-software.onrender.com/api/integrations/support/claude-review
Key:  X-FMS-Integration-Key: <DELEGATION_INTEGRATION_API_KEY from Render>

GET  = list Stage 2 pending tickets
POST = { "reference_no": "CH-0123" }  →  (C.R) / Claude Review in FMS
```
