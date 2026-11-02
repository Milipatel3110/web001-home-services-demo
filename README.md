# web001-home-services-demo

WEB-001 home-services demo site. Version A one-page site (React/TypeScript/Vite/Tailwind/shadcn/ui), deployed to GitHub Pages by GitHub Actions; contact form → Supabase Edge Function → Windmill flow → Supabase Postgres.

- [Deployment steps](docs/DEPLOYMENT.md)
- [Handover guide](docs/HANDOVER.md) - architecture, secrets, behaviour contract
- [Operator quick start](docs/OPERATOR_QUICKSTART.md)
- [Evidence checklist T1–T8](docs/EVIDENCE_CHECKLIST.md)

```bash
npm ci && npm run dev                 # local dev (cp .env.example .env.local first)
npm run check                         # frontend (vitest) + backend/contract (node --test), Node >= 22.18
./tests/db/run.sh                     # migration test on disposable Postgres (Docker)
node scripts/build-windmill-export.mjs  # regenerate Windmill flow files
```
# web001-home-services-demo
