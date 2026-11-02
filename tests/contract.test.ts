// Frontend submitContact() against the real Edge Function handler: guards
// against the browser and server drifting apart on payload/response shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { submitContact, validate, LIMITS } from "../src/lib/contact.ts";
import { createHandler, LIMITS as SERVER } from "../supabase/functions/contact-submit/handler.ts";

const ORIGIN = "https://example-org.github.io";
const RID = "3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c";
const values = { name: "Ada Lovelace", email: "ada@example.com", message: "Please assemble my desk." };

function browserFetch(windmill: () => Response) {
  const handler = createHandler(
    { windmillUrl: "https://wm.example/run_wait_result", windmillToken: "t", allowedOrigins: [ORIGIN], upstreamTimeoutMs: 1000 },
    { fetch: (async (_u: string, init: RequestInit) => (JSON.parse(init.body as string), windmill())) as typeof fetch, log: () => {} },
  );
  // The browser adds Origin automatically; mimic that.
  return (async (url: string, init: RequestInit) =>
    handler(new Request(url, { ...init, headers: { ...(init.headers as Record<string, string>), Origin: ORIGIN } }))) as typeof fetch;
}

test("client and server agree on limits", () => {
  assert.equal(LIMITS.nameMin, SERVER.nameMin);
  assert.equal(LIMITS.nameMax, SERVER.nameMax);
  assert.equal(LIMITS.emailMax, SERVER.email);
  assert.equal(LIMITS.messageMin, SERVER.messageMin);
  assert.equal(LIMITS.messageMax, SERVER.messageMax);
});

test("confirmed storage is shown as success", async () => {
  const f = browserFetch(() => Response.json({ stored: true, request_id: RID }));
  const r = await submitContact("https://x.supabase.co/functions/v1/contact-submit", { request_id: RID, ...values, website: "" }, f);
  assert.deepEqual(r, { ok: true, requestId: RID });
});

test("Windmill failure is shown as failure", async () => {
  const f = browserFetch(() => new Response("boom", { status: 500 }));
  const r = await submitContact("https://x.supabase.co/functions/v1/contact-submit", { request_id: RID, ...values, website: "" }, f);
  assert.equal(r.ok, false);
});

test("anything the client accepts, the server accepts", async () => {
  const samples = [
    values,
    { name: "Al", email: "a@b.co", message: "x".repeat(10) },
    { name: "n".repeat(80), email: `${"e".repeat(64)}@example.com`, message: "m".repeat(1000) },
    { name: "  José  ", email: " jose@example.com ", message: "  Ten chars!  " },
  ];
  for (const v of samples) {
    assert.deepEqual(validate(v), {});
    const f = browserFetch(() => Response.json({ stored: true, request_id: RID }));
    const r = await submitContact("https://x.supabase.co/fn", { request_id: RID, ...v, website: "" }, f);
    assert.equal(r.ok, true, JSON.stringify(v));
  }
});
