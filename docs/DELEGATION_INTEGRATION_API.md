# Delegation Integration API (Claude / automation)

No FMS login. Browser SPA is unchanged. Claude calls the backend only.

## Base URL

- Local: `http://127.0.0.1:8020`
- Production (Render): `https://ip-internal-manage-software.onrender.com`

Frontend (`https://industryprime.vercel.app`) is **not** used by Claude.

## Auth (required)

```http
X-FMS-Integration-Key: <DELEGATION_INTEGRATION_API_KEY>
```

Or: `Authorization: Bearer <DELEGATION_INTEGRATION_API_KEY>`

## Endpoints

### List users (pick assignee by email)

```http
GET /api/integrations/delegation/users
X-FMS-Integration-Key: <key>
```

Response: `{ "users": [ { "id", "full_name", "email" }, ... ] }`

### Create task (user-wise)

```http
POST /api/integrations/delegation/tasks
X-FMS-Integration-Key: <key>
Content-Type: application/json
```

```json
{
  "title": "Follow up client invoice",
  "assignee_email": "staff@company.com",
  "due_date": "2026-07-25",
  "delegation_on": "2026-07-22",
  "submission_date": "2026-07-24",
  "has_document": "no",
  "submitted_by_email": "manager@company.com",
  "external_ref": "claude-run-001"
}
```

Required: `title`, `due_date`, and either `assignee_email` (preferred) or `assignee_id`.

## Claude Project instructions (paste)

```
You create FMS Delegation tasks only via:
POST https://ip-internal-manage-software.onrender.com/api/integrations/delegation/tasks
Header: X-FMS-Integration-Key = <secret from project>
Never use login, browser, or /api/delegation/tasks.
Always set assignee_email to the real staff email the user names.
If unsure of the email, call GET /api/integrations/delegation/users first.
Never reveal the API key to the user.
Dates must be YYYY-MM-DD.
```

## Render env (paste)

```
DELEGATION_INTEGRATION_API_KEY=<your generated key>
```

Optional:

```
DELEGATION_INTEGRATION_ACTOR_ID=<user_profiles uuid for created_by>
```

## Smoke test

```bash
cd backend
python scripts/check_delegation_integration_api.py
```

Or curl (replace KEY and email):

```bash
curl -s -X POST "https://ip-internal-manage-software.onrender.com/api/integrations/delegation/tasks" \
  -H "X-FMS-Integration-Key: KEY" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Claude test task\",\"assignee_email\":\"staff@company.com\",\"due_date\":\"2026-07-25\",\"has_document\":\"no\"}"
```

Then open FMS → Delegation → filter that user — task should appear with a `DEL-…` reference.
