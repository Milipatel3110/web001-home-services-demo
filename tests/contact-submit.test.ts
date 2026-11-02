// Run: node --test tests/   (Node >= 22.18 strips TS types natively)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHandler, loadConfig, MAX_BODY_BYTES } from "../supabase/functions/contact-submit/handler.ts";

const ORIGIN = "https://example-org.github.io";
const URL_ = "https://example.supabase.co/functions/v1/contact-submit";
const WINDMILL = "https://windmill.example/api/w/ws/jobs/run_wait_result/f/web001/contact_intake";
const TOKEN = "test-windmill-token-SECRET";
const RID = "3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c";

const valid = () => ({ request_id: RID, name: "Ada Lovelace", email: "ada@example.com", message: "Leaky tap\nin kitchen" });

type Call = { url: string; init: RequestInit };

function setup(upstream: (call: Call) => Promise<Response> | Response = () => Response.json({ stored: true, request_id: RID })) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const handler = createHandler(
    loadConfig((k) => ({ WINDMILL_WEBHOOK_URL: WINDMILL, WINDMILL_WEBHOOK_TOKEN: TOKEN, ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:5173/` })[k]),
    {
      fetch: (async (url: string, init: RequestInit) => {
        const call = { url, init };
        calls.push(call);
        return upstream(call);
      }) as typeof fetch,
      log: (event, fields) => logs.push(JSON.stringify({ event, ...fields })),
    },
  );
  return { handler, calls, logs };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request(URL_, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("valid submission is forwarded with bearer token and confirmed", async () => {
  const { handler, calls, logs } = setup();
  const res = await handler(post(valid()));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, status: "received", request_id: RID });
  assert.equal(res.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, WINDMILL);
  assert.equal((calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(JSON.parse(calls[0].init.body as string), valid());
  const allLogs = logs.join("\n");
  assert.ok(!allLogs.includes(TOKEN), "token must never be logged");
  assert.ok(!allLogs.includes("ada@example.com") && !allLogs.includes("Leaky"), "PII must not be logged");
});

test("fields are trimmed and request_id lowercased before forwarding", async () => {
  const { handler, calls } = setup();
  const res = await handler(post({ ...valid(), request_id: RID.toUpperCase(), name: "  Ada  " }));
  assert.equal(res.status, 200);
  const sent = JSON.parse(calls[0].init.body as string);
  assert.equal(sent.request_id, RID);
  assert.equal(sent.name, "Ada");
});

test("origin allowlist: missing or foreign origin is rejected, trailing slash tolerated", async () => {
  const { handler, calls } = setup();
  assert.equal((await handler(post(valid(), { origin: "https://evil.example" }))).status, 403);
  const noOrigin = new Request(URL_, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(valid()) });
  assert.equal((await handler(noOrigin)).status, 403);
  assert.equal((await handler(post(valid(), { origin: "http://localhost:5173" }))).status, 200);
  assert.equal(calls.length, 1);
});

test("CORS preflight from allowed origin returns 204", async () => {
  const { handler } = setup();
  const res = await handler(new Request(URL_, { method: "OPTIONS", headers: { origin: ORIGIN } }));
  assert.equal(res.status, 204);
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /POST/);
});

test("only POST is accepted", async () => {
  const { handler } = setup();
  for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    const res = await handler(new Request(URL_, { method, headers: { origin: ORIGIN } }));
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get("allow"), "POST, OPTIONS");
  }
});

test("non-JSON content type is rejected", async () => {
  const { handler } = setup();
  assert.equal((await handler(post(valid(), { "content-type": "text/plain" }))).status, 415);
});

test("oversized body is rejected by declared length and by streamed length", async () => {
  const { handler, calls } = setup();
  const big = { ...valid(), message: "x".repeat(MAX_BODY_BYTES) };
  assert.equal((await handler(post(big))).status, 413);
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode(JSON.stringify(big)));
      c.close();
    },
  });
  const chunked = new Request(URL_, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit);
  assert.equal((await handler(chunked)).status, 413);
  assert.equal(calls.length, 0);
});

test("malformed JSON and non-object bodies are rejected", async () => {
  const { handler } = setup();
  assert.equal((await handler(post("{not json"))).status, 400);
  for (const body of ["[]", "null", "\"x\"", "42"]) {
    assert.equal((await handler(post(body))).status, 400, body);
  }
});

test("field validation", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["request_id", { request_id: "not-a-uuid" }],
    ["request_id", { request_id: "00000000-0000-0000-0000-000000000000" }],
    ["request_id", { request_id: 123 }],
    ["request_id", { request_id: undefined }],
    ["name", { name: "   " }],
    ["name", { name: "A" }],
    ["name", { name: "a".repeat(81) }],
    ["name", { name: "Ada\nInjected: header" }],
    ["email", { email: "not-an-email" }],
    ["email", { email: "a@b" }],
    ["email", { email: `${"a".repeat(250)}@example.com` }],
    ["message", { message: "" }],
    ["message", { message: "too short" }],
    ["message", { message: "m".repeat(1001) }],
    ["message", { message: "bad\u0000byte" }],
    ["is_admin", { is_admin: true }],
    ["website", { website: 1 }],
  ];
  const { handler, calls } = setup();
  for (const [field, patch] of cases) {
    const res = await handler(post({ ...valid(), ...patch }));
    assert.equal(res.status, 400, `${field} ${JSON.stringify(patch).slice(0, 60)}`);
    assert.equal((await res.json()).field, field);
  }
  assert.equal(calls.length, 0);
});

test("boundary lengths are accepted", async () => {
  const { handler } = setup();
  const res = await handler(post({ ...valid(), name: "n".repeat(80), message: "m".repeat(1000) }));
  assert.equal(res.status, 200);
});

test("honeypot: filled field returns fake success and never reaches Windmill", async () => {
  const { handler, calls, logs } = setup();
  const res = await handler(post({ ...valid(), website: "http://spam.example" }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, status: "received", request_id: RID });
  assert.equal(calls.length, 0);
  assert.ok(logs.some((l) => l.includes("honeypot")));
});

test("empty honeypot is treated as a normal submission", async () => {
  const { handler, calls } = setup();
  assert.equal((await handler(post({ ...valid(), website: "" }))).status, 200);
  assert.equal(calls.length, 1);
  assert.ok(!("website" in JSON.parse(calls[0].init.body as string)));
});

const upstreamFailures: Array<[string, () => Response | Promise<Response>]> = [
  ["HTTP 500 from Windmill", () => new Response("job failed", { status: 500 })],
  ["HTTP 401 (bad token)", () => new Response("unauthorized", { status: 401 })],
  ["non-JSON 200", () => new Response("ok", { status: 200 })],
  ["stored:false", () => Response.json({ stored: false, request_id: RID })],
  ["stored as string", () => Response.json({ stored: "true", request_id: RID })],
  ["mismatched request_id", () => Response.json({ stored: true, request_id: "11111111-1111-4111-8111-111111111111" })],
  ["missing fields", () => Response.json({})],
  ["network error", () => Promise.reject(new TypeError("fetch failed"))],
  ["timeout", () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
];

for (const [label, upstream] of upstreamFailures) {
  test(`upstream failure is never reported as success: ${label}`, async () => {
    const { handler, logs } = setup(upstream);
    const res = await handler(post(valid()));
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.equal(body.retryable, true);
    assert.equal(body.request_id, RID);
    assert.ok(!JSON.stringify(body).includes(TOKEN));
    assert.ok(logs.some((l) => l.includes("upstream_failed")));
  });
}

test("retry with the same request_id after a failure succeeds (client retry path)", async () => {
  let attempt = 0;
  const { handler, calls } = setup(() =>
    ++attempt === 1 ? new Response("boom", { status: 500 }) : Response.json({ stored: true, request_id: RID, duplicate: false }),
  );
  assert.equal((await handler(post(valid()))).status, 502);
  assert.equal((await handler(post(valid()))).status, 200);
  assert.equal(JSON.parse(calls[0].init.body as string).request_id, JSON.parse(calls[1].init.body as string).request_id);
});

test("real timeout aborts a hanging upstream", async () => {
  const handler = createHandler(
    { windmillUrl: WINDMILL, windmillToken: TOKEN, allowedOrigins: [ORIGIN], upstreamTimeoutMs: 50 },
    {
      fetch: ((_url: string, init: RequestInit) =>
        new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as typeof fetch,
      log: () => {},
    },
  );
  assert.equal((await handler(post(valid()))).status, 502);
});

test("missing secrets fail closed with 500", async () => {
  const handler = createHandler(loadConfig((k) => (k === "ALLOWED_ORIGINS" ? ORIGIN : undefined)), {
    fetch: (() => assert.fail("must not call upstream")) as typeof fetch,
    log: () => {},
  });
  assert.equal((await handler(post(valid()))).status, 500);
});
