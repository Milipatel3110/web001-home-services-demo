// Supabase Edge Function entry point. Deployed with verify_jwt = false
// (see supabase/config.toml); all request checks live in handler.ts.
import { createHandler, loadConfig } from "./handler.ts";

const handler = createHandler(loadConfig((k) => Deno.env.get(k)), {
  fetch,
  // Structured, PII-free logs: request_id and reason codes only.
  log: (event, fields) => console.log(JSON.stringify({ fn: "contact-submit", event, ...fields })),
});

Deno.serve(handler);
