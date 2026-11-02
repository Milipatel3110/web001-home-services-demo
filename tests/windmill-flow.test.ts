// Tests the Windmill step against a fake PostgREST that enforces the
// request_id primary key the same way `on conflict do nothing` does.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { main } from "../windmill/f/web001/contact_intake.flow/store_submission.inline_script.ts";

const URL_ = "https://proj.supabase.co";
const KEY = "sb_secret_TESTKEY";
const RID = "3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c";
const args = [RID, "Ada", "ada@example.com", "Hello, please help."] as const;

const realFetch = globalThis.fetch;
let table: Map<string, Record<string, string>>;
let requests: Array<{ url: string; method: string; headers: Record<string, string> }>;
let failNext: number[];

beforeEach(() => {
  table = new Map();
  requests = [];
  failNext = [];
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const headers = (init.headers ?? {}) as Record<string, string>;
    requests.push({ url, method, headers });
    const forced = failNext.shift();
    if (forced) return new Response("err", { status: forced });
    if (headers.apikey !== KEY && headers.apikey !== "eyJ.jwt.key") return new Response("no key", { status: 401 });
    if (method === "POST") {
      const row = JSON.parse(init.body as string);
      if (table.has(row.request_id)) return Response.json([], { status: 201 });
      table.set(row.request_id, row);
      return Response.json([{ request_id: row.request_id }], { status: 201 });
    }
    const id = new URL(url).searchParams.get("request_id")?.replace(/^eq\./, "") ?? "";
    return Response.json(table.has(id) ? [{ request_id: id }] : []);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("first submission is stored", async () => {
  assert.deepEqual(await main(...args, URL_, KEY), { stored: true, request_id: RID, duplicate: false });
  assert.equal(table.size, 1);
  assert.match(requests[0].url, /on_conflict=request_id/);
  assert.match(requests[0].headers.Prefer, /resolution=ignore-duplicates/);
  assert.equal(requests[0].headers.Authorization, undefined, "sb_secret keys must not be sent as Bearer");
});

test("duplicate request_id is idempotent: one row, still stored:true", async () => {
  await main(...args, URL_, KEY);
  const second = await main(RID, "Other", "x@example.com", "changed message", URL_, KEY);
  assert.deepEqual(second, { stored: true, request_id: RID, duplicate: true });
  assert.equal(table.size, 1);
  assert.equal(table.get(RID)?.name, "Ada", "original row is not overwritten");
});

test("legacy JWT service_role key is also sent as Bearer", async () => {
  await main(...args, URL_, "eyJ.jwt.key");
  assert.equal(requests[0].headers.Authorization, "Bearer eyJ.jwt.key");
});

test("database error throws (flow fails, Edge Function reports failure)", async () => {
  failNext = [500];
  await assert.rejects(main(...args, URL_, KEY), /insert failed: HTTP 500/);
  assert.equal(table.size, 0);
});

test("retry after a transient failure stores exactly once", async () => {
  failNext = [503];
  await assert.rejects(main(...args, URL_, KEY));
  assert.equal((await main(...args, URL_, KEY)).stored, true);
  assert.equal(table.size, 1);
});

test("empty insert result without an existing row is not reported as stored", async () => {
  globalThis.fetch = (async () => Response.json([], { status: 201 })) as typeof fetch;
  await assert.rejects(main(...args, URL_, KEY), /not confirmed/);
});

test("invalid input and missing credentials are rejected before any DB call", async () => {
  await assert.rejects(main("nope", "Ada", "a@b.co", "long enough", URL_, KEY), /request_id/);
  await assert.rejects(main(RID, "A", "a@b.co", "long enough", URL_, KEY), /name/);
  await assert.rejects(main(RID, "Ada", "a@b.co", "short", URL_, KEY), /message/);
  await assert.rejects(main(RID, "Ada", "a@b.co", "m".repeat(1001), URL_, KEY), /message/);
  await assert.rejects(main(...args, URL_, ""), /credentials/);
  assert.equal(requests.length, 0);
});

test("flow.yaml and importable JSON export are in sync with the script", () => {
  execFileSync(process.execPath, [new URL("../scripts/build-windmill-export.mjs", import.meta.url).pathname, "--check"], {
    stdio: "pipe",
  });
});
