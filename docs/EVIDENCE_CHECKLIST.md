# WEB-001 Evidence Checklist (T1–T8)

> The T-numbering below is the implementer's mapping. Align titles with the SOW's T1–T8 wording before sign-off.
> Mark an item ✅ only with the evidence attached. "Not run" is an acceptable, honest state.

| # | Test | How | Evidence to attach | Status |
|---|---|---|---|---|
| T1 | **Build & deploy** - locked install, build, automated checks, Pages deploy | Push to `main` or run workflow manually | Actions run URL (green), both `push` and `workflow_dispatch` runs | ☐ |
| T2 | **Site served under base path** - assets load, deep-link refresh works | Open `https://<gh-user>.github.io/web001-home-services-demo/`, DevTools → Network (no 404s), refresh on a sub-route | Screenshot of page + Network tab | ☐ |
| T3 | **Valid submission end-to-end** | Submit form on live site; query `contact_submissions` | Screenshot of success UI + SQL row with the same `request_id` (from Network tab payload) | ☐ |
| T4 | **Validation** - invalid email/empty fields/oversized/GET rejected server-side | `scripts/smoke-contact.sh` + one bad submit in UI | Smoke output lines T4; Network tab 400 response | ☐ |
| T5 | **Duplicate `request_id`** - stored once, both responses success | Smoke script T5; SQL `count(*)` for that id = 1 | Smoke output + SQL result | ☐ |
| T6 | **Failure & retry** - backend failure is shown as error, never as success; retry stores once | Temporarily set `WINDMILL_WEBHOOK_TOKEN` to an invalid value → submit (expect error UI, 502, no row) → restore token → "Try again" (expect success, 1 row, same `request_id`) | Screenshots of error + success, function log `upstream_failed`, SQL row | ☐ |
| T7 | **Security** - anon cannot read/insert table; foreign origin 403; honeypot not stored; no privileged keys in bundle/Git/logs | Smoke script T7 lines; CI "Automated checks" step; `git grep -nE 'sb_secret_|service_role'` shows only docs/tests; review function logs | Smoke output, CI log, grep output, log screenshot (no PII/tokens) | ☐ |
| T8 | **Handover** - docs delivered; Version A live; Version B change delivered separately | Review `docs/`; screenshot Version A, later Version B | Links to docs; screenshots + commit SHAs | ☐ |

## Automated evidence available locally (no cloud)

| Check | Command | Covers |
|---|---|---|
| Frontend tests (26: validation, states, retry id reuse, honeypot, content) | `npm test` | T3, T4, T6 UI logic |
| Browser↔server contract (4) | `node --test tests/contract.test.ts` | T3, T4 |
| Edge Function unit tests (24) | `node --test tests/contact-submit.test.ts` | T4, T6, T7 logic |
| Windmill step tests (8) | `node --test tests/windmill-flow.test.ts` | T5, T6 logic, export in sync |
| dist gate tests (5) | `node --test tests/check-dist.test.mjs` | T2, T7 gate |
| Migration on real Postgres 16 | `./tests/db/run.sh` (Docker) | T5, T7 database layer |

Local results do not substitute for T1–T8 cloud evidence.
