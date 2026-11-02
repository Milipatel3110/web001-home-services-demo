# WEB-001 Deployment Steps

Do these in order. Placeholders: `<ref>` Supabase project ref, `<ws>` Windmill workspace id, `<windmill-host>`, `<gh-user>` GitHub owner.
Nothing here has been executed by the implementer; every step is a manual cloud action.

## 0. Local verification

```bash
npm ci
npm run check                                   # vitest (frontend) + node --test (backend, contract)
VITE_CONTACT_FUNCTION_URL=https://<ref>.supabase.co/functions/v1/contact-submit npm run build
cp dist/index.html dist/404.html
VITE_CONTACT_FUNCTION_URL=https://<ref>.supabase.co/functions/v1/contact-submit npm run check:dist -- /web001-home-services-demo/
./tests/db/run.sh                               # optional, needs Docker
```
Local dev: `cp .env.example .env.local`, set `VITE_CONTACT_FUNCTION_URL`, add `http://localhost:5173` to `ALLOWED_ORIGINS` temporarily, `npm run dev`.

## 1. Supabase - database

1. Dashboard → New project (note `<ref>`).
2. Apply migration - either:
   - CLI: `npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push`, or
   - Dashboard → SQL Editor → paste `supabase/migrations/20261102000000_contact_submissions.sql` → Run.
3. Verify: Table Editor → `contact_submissions` shows **RLS enabled**, 0 policies.
4. Project Settings → API Keys: copy the **secret** key (`sb_secret_…`; or legacy `service_role`). It goes **only** into Windmill (step 2).

## 2. Windmill - flow

1. Create folder `web001` (Home → New folder).
2. Variables → New variable:
   - `f/web001/supabase_url` = `https://<ref>.supabase.co` (not secret)
   - `f/web001/supabase_service_key` = secret key from 1.4 - **tick "Secret"**
3. Flows → New flow → `…` / Import → paste `windmill/export/contact_intake.flow.json` → save at path **`f/web001/contact_intake`**.
   (Or with the CLI: `wmill sync push` from the `windmill/` directory.)
4. Confirm step inputs `supabase_url` / `supabase_service_key` show the `$var:f/web001/…` references, then Test flow with a fresh UUID. Expected result: `{"stored":true,"request_id":"…","duplicate":false}`; running again with the same UUID → `duplicate:true`. Delete the test row afterwards if desired.
5. Token: create a token used only by the Edge Function. Prefer, in this order: a token **scoped** to running `f/web001/contact_intake` (if your Windmill version offers token scopes); otherwise a dedicated low-privilege user that can only run flows in folder `web001`. Set an expiry and record it.
6. Webhook URL (synchronous): `https://<windmill-host>/api/w/<ws>/jobs/run_wait_result/f/web001/contact_intake`
   Check: `curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"request_id":"<uuid>","name":"t","email":"t@example.com","message":"t"}' <url>` → `{"stored":true,…}`.

## 3. Supabase - Edge Function

1. Secrets (Dashboard → Edge Functions → Secrets, or CLI). With the CLI, avoid shell history:
   Create `supabase/.env.secrets` in an editor (gitignored by `.env.*`):
   ```
   WINDMILL_WEBHOOK_URL=https://<windmill-host>/api/w/<ws>/jobs/run_wait_result/f/web001/contact_intake
   WINDMILL_WEBHOOK_TOKEN=<token from 2.5>
   ALLOWED_ORIGINS=https://<gh-user>.github.io
   ```
   then:
   ```bash
   npx supabase secrets set --env-file supabase/.env.secrets && rm supabase/.env.secrets
   npx supabase secrets list   # shows names/digests only
   ```
   `ALLOWED_ORIGINS` is scheme+host only (no path). Add `,http://localhost:5173` only while testing locally.
2. Deploy: `npx supabase functions deploy contact-submit --no-verify-jwt`
   Dashboard check: Edge Functions → contact-submit → "Verify JWT" is **off** (intentional).
3. Function URL: `https://<ref>.supabase.co/functions/v1/contact-submit`.

## 4. GitHub Pages

1. Create repo **`web001-home-services-demo`** (ask owner before making it public).
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Settings → Secrets and variables → Actions → **Variables** tab → `VITE_CONTACT_FUNCTION_URL` = function URL from 3.3. (Variable, not secret - it is public.)
4. Push to `main` (or Actions → "Deploy to GitHub Pages" → Run workflow).
5. Site: `https://<gh-user>.github.io/web001-home-services-demo/`.

## 5. Verify

```bash
ENDPOINT=https://<ref>.supabase.co/functions/v1/contact-submit \
ORIGIN=https://<gh-user>.github.io \
SUPABASE_URL=https://<ref>.supabase.co ANON_KEY=<publishable/anon key> \
./scripts/smoke-contact.sh
```
Then work through `docs/EVIDENCE_CHECKLIST.md`.

## Rollback

- Site: Actions → re-run the last good "Deploy to GitHub Pages" run (or revert commit and push).
- Function: redeploy previous commit's `supabase/functions/contact-submit`.
- Emergency stop of submissions: delete/rotate the Windmill token (function returns 502, nothing stored, no false success).
