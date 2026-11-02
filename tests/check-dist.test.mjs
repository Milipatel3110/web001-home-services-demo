import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const script = new URL("../scripts/check-dist.mjs", import.meta.url).pathname;
const BASE = "/web001-home-services-demo/";
const ENDPOINT = "https://proj.supabase.co/functions/v1/contact-submit";

function build(files) {
  const dir = mkdtempSync(join(tmpdir(), "dist-"));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}
const run = (dir) =>
  spawnSync(process.execPath, [script, dir, BASE], { env: { ...process.env, VITE_CONTACT_FUNCTION_URL: ENDPOINT }, encoding: "utf8" });
const html = (src) => `<html><head><script type="module" src="${src}"></script></head></html>`;
const jwt = (role) =>
  ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify({ role, iss: "supabase" })).toString("base64url"), "c2lnbmF0dXJlc2lnbmF0dXJl"].join(".");

test("passes a correct build", () => {
  const r = run(build({ "index.html": html(`${BASE}assets/a.js`), "assets/a.js": `fetch("${ENDPOINT}")` }));
  assert.equal(r.status, 0, r.stderr);
});

test("fails when assets are not under the Pages base path", () => {
  const r = run(build({ "index.html": html("/assets/a.js"), "assets/a.js": `"${ENDPOINT}"` }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /outside base/);
});

test("fails on leaked secrets and server-only endpoints", () => {
  for (const leak of ["sb_secret_abcdefghijklmnopqrstuvwxyz", jwt("service_role"), "https://wm/api/w/x/jobs/run_wait_result/f/a"]) {
    const r = run(build({ "index.html": html(`${BASE}assets/a.js`), "assets/a.js": `"${ENDPOINT}";"${leak}"` }));
    assert.notEqual(r.status, 0, leak);
  }
});

test("allows the public anon JWT", () => {
  const r = run(build({ "index.html": html(`${BASE}assets/a.js`), "assets/a.js": `"${ENDPOINT}";"${jwt("anon")}"` }));
  assert.equal(r.status, 0, r.stderr);
});

test("fails when the contact endpoint is not wired into the bundle", () => {
  const r = run(build({ "index.html": html(`${BASE}assets/a.js`), "assets/a.js": "console.log(1)" }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not found in bundle/);
});
