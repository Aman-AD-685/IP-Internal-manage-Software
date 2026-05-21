# Day-by-day engineering journal

This folder is the **training dataset** for the pre-push reviewer. The agent reads recent days before audits and appends after meaningful work.

## File naming

- One file per day: `YYYY-MM-DD.md`
- Template: [_template.md](_template.md)

## Who writes entries

| When | Who |
|------|-----|
| End of session / after push | Cursor agent (mandatory append) |
| Anytime | You (add bullets under **User feedback** or **Work completed**) |
| Start of day | Optional: run `scripts/summarize-day.ps1` for git facts |

## How it trains the reviewer

1. **Same day** — latest journal + [memory.md](../memory.md) inform pre-push audits.
2. **Weekly** — agent distills recurring lessons from last 7 days into `memory.md` → **Training synthesis**.
3. **Never forget** — rejected suggestions in journal → copied to `memory.md` so the same bad advice is not repeated.

## Privacy

Do not put passwords, API keys, or customer PII in journal files. Reference ticket IDs and module names only.
