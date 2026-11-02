# WEB-001 Operator Quick Start

**Site:** `https://<gh-user>.github.io/web001-home-services-demo/`

## View submissions
Supabase Dashboard → SQL Editor:
```sql
select created_at, name, email, message, request_id
from contact_submissions order by created_at desc limit 50;
```
(Table Editor works too. The table is not readable from the public API by design.)

## Is the form working?
1. Submit the contact form on the live site → you should see the success message.
2. Run the query above → newest row present.
3. Or run `scripts/smoke-contact.sh` (see DEPLOYMENT.md §5) → all PASS.

## Something is wrong

| Symptom | Where to look | Likely cause / fix |
|---|---|---|
| Form shows error, nothing stored | Supabase → Edge Functions → contact-submit → Logs: `upstream_failed` | Windmill down, token expired/rotated, or flow error. Check Windmill → Runs for `f/web001/contact_intake`. |
| `reason:"status","status":401` in logs | Windmill token | Create new token, `supabase secrets set WINDMILL_WEBHOOK_TOKEN=…` |
| Windmill run failed `insert failed: HTTP 401` | Windmill variable `f/web001/supabase_service_key` | Key rotated/revoked - update variable |
| Form error, logs show `rejected` `origin` | `ALLOWED_ORIGINS` secret | Must equal the site origin exactly, e.g. `https://<gh-user>.github.io` |
| `misconfigured` in logs | Edge secrets | `WINDMILL_WEBHOOK_URL` / `WINDMILL_WEBHOOK_TOKEN` not set |
| Site 404 / unstyled | GitHub → Actions | Failed deploy; open run log. "outside base" error = `vite.config.ts` `base` wrong |

Users may safely press "Try again": the same `request_id` is reused, so a submission is never stored twice.

## Do not
- Paste the Supabase secret/service key or the Windmill token into chat, tickets, GitHub, or the site.
- Add RLS policies or grants for `anon` on `contact_submissions`.
- Turn "Verify JWT" on for contact-submit (the public form would stop working) - it is off on purpose.
