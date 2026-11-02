# WEB-001 Handover Guide

## Architecture

```
Browser (GitHub Pages, React/TypeScript/Vite/Tailwind/shadcn site in src/)
  │  POST JSON {request_id, name, email, message, website}
  │  no keys, no tokens - only the public function URL
  ▼
Supabase Edge Function  contact-submit   (verify_jwt = false, public by design)
  │  origin allowlist · POST only · 8 KB cap · field + UUID validation · honeypot
  │  Authorization: Bearer <WINDMILL_WEBHOOK_TOKEN>   (Edge secret)
  ▼
Windmill flow  f/web001/contact_intake   (synchronous: run_wait_result)
  │  re-validates input · service key from Windmill secret variable
  │  POST /rest/v1/contact_submissions?on_conflict=request_id  (ignore duplicates)
  ▼
Postgres  public.contact_submissions   (RLS on, no policies, anon/authenticated revoked)
  ▲
  └─ returns {stored:true, request_id, duplicate} → Edge Function verifies → {ok:true}
```

## Where each secret lives

| Secret | Location | Never in |
|---|---|---|
| Windmill webhook token | Supabase Edge secret `WINDMILL_WEBHOOK_TOKEN` | Git, frontend, GitHub, logs |
| Windmill webhook URL | Supabase Edge secret `WINDMILL_WEBHOOK_URL` | frontend (CI check blocks `run_wait_result` in `dist/`) |
| Supabase service/secret key | Windmill secret variable `f/web001/supabase_service_key` | Git, frontend, Edge Function, GitHub |
| Function URL | GitHub Actions **variable** `VITE_CONTACT_FUNCTION_URL` | (public, safe) |

The frontend needs **no** Supabase key at all.

## Behaviour contract

| Situation | HTTP | Body |
|---|---|---|
| Stored (or duplicate of stored `request_id`) | 200 | `{ok:true, status:"received", request_id}` |
| Honeypot filled | 200 | same as success; nothing forwarded or stored |
| Validation failed | 400 | `{ok:false, error:"validation_failed", field, reason}` |
| Wrong method | 405 | `Allow: POST, OPTIONS` |
| Not `application/json` | 415 | |
| Body > 8 KB | 413 | |
| Origin not in `ALLOWED_ORIGINS` (or missing) | 403 | |
| Windmill error / timeout / unconfirmed result | 502 | `{ok:false, error:"submission_failed", retryable:true, request_id}` |
| Edge secrets missing | 500 | `server_misconfigured` |

Success is returned **only** when Windmill answers 2xx with `stored === true` and the same `request_id`. The browser in turn shows success **only** for HTTP 2xx with `status === "received"` and its own `request_id`.

Limits (identical in browser, Edge Function, Windmill and DB `CHECK`s; `tests/contract.test.ts` enforces browser = server): name 2–80 chars (single line), email ≤ 254 chars, message 10–1000 chars, `request_id` canonical UUID. Values are trimmed; the server also NFC-normalises.

**Idempotency:** `request_id` is the primary key; the flow inserts with `on conflict do nothing`, then confirms the row exists. Re-sending the same `request_id` (client retry, Windmill step retry ×2) never creates a second row and never overwrites the first.

## Frontend (Version A)

`src/App.tsx` (page), `src/components/ContactForm.tsx` (form states), `src/lib/contact.ts` (validation + submit), `src/components/ui/*` (shadcn/ui).

- Endpoint: `import.meta.env.VITE_CONTACT_FUNCTION_URL` (public). If unset, the form shows a "not configured" error - it never fakes success.
- `request_id = crypto.randomUUID()`; reused while retrying **unchanged** data (trimmed fingerprint), new id after any edit or after success.
- Body: `{request_id, name, email, message, website}`; `website` is a honeypot input hidden off-screen, `aria-hidden`, `tabIndex=-1`.
- States: field errors (`aria-invalid`, focus first invalid), loading (button disabled, "Sending…"), success, failure (`role="alert"`). Network errors / timeouts (20 s) / non-matching responses are failures.
- Base path: `vite.config.ts` uses `/web001-home-services-demo/` for `npm run build` and `/` for `npm run dev`; `VITE_BASE_PATH` overrides.
- Version B (Weekend Appointments callout) is **not** implemented.

## Logs

The Edge Function logs one JSON line per request: `event` (`stored`, `rejected`, `honeypot`, `upstream_failed`, `misconfigured`), `request_id`, and a reason code/field name. It never logs names, emails, messages, or the token.

## Repository layout

```
src/                                React app (Version A) + vitest tests
.github/workflows/deploy.yml        build → checks → Pages deploy
supabase/migrations/…sql            table, RLS, grants
supabase/functions/contact-submit/  index.ts (Deno entry), handler.ts (logic)
supabase/config.toml                verify_jwt = false for contact-submit
windmill/f/web001/contact_intake.flow/   wmill sync source (flow.yaml + script)
windmill/export/contact_intake.flow.json UI-importable flow (generated)
scripts/build-windmill-export.mjs   regenerates both Windmill files
scripts/check-dist.mjs              CI gate: base path + secret scan of dist/
scripts/smoke-contact.sh            live end-to-end smoke test
tests/                              node --test suites; tests/db/run.sh (Docker)
```

## Maintenance

- Change the Windmill script → `node scripts/build-windmill-export.mjs` → commit both outputs (CI fails if stale).
- Change limits → update `src/lib/contact.ts`, `handler.ts` `LIMITS`, the Windmill script, a **new** migration for the `CHECK`s (once the first one is applied), and tests.
- Rotate the Windmill token: create new token → `supabase secrets set WINDMILL_WEBHOOK_TOKEN=…` → test → delete old token.
- Rotate the Supabase secret key: create new key in Supabase → update Windmill variable → test → revoke old key.
