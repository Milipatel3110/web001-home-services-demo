#!/usr/bin/env node
// Post-build gate for GitHub Pages. Fails the deploy if:
//   - dist/index.html is missing or references root-absolute assets outside the Pages base path
//   - any built file contains privileged key material or server-only endpoints
// Usage: node scripts/check-dist.mjs [distDir] [basePath]
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const dist = process.argv[2] ?? "dist";
const base = process.argv[3] ?? "/web001-home-services-demo/";
const errors = [];
const warnings = [];

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function jwtRole(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return payload.role;
  } catch {
    return undefined;
  }
}

const indexPath = join(dist, "index.html");
if (!existsSync(indexPath)) {
  errors.push(`${indexPath} not found - did the build run?`);
} else {
  const html = readFileSync(indexPath, "utf8");
  for (const [, attr, url] of html.matchAll(/\b(src|href)=["'](\/[^"']*)["']/g)) {
    if (!url.startsWith("//") && !url.startsWith(base)) {
      errors.push(`index.html ${attr}="${url}" is outside base ${base} - build with VITE_BASE_PATH=${base}`);
    }
  }
  if (!/<script[^>]+src=/.test(html)) errors.push("index.html has no <script src> - unexpected build output");
}

const forbidden = [
  [/sb_secret_[A-Za-z0-9_-]{20,}/, "Supabase secret key (sb_secret_...)"],
  [/service_role/i, "the string 'service_role'"],
  [/SUPABASE_SERVICE/i, "a SUPABASE_SERVICE* variable name"],
  [/run_wait_result/, "a Windmill webhook URL (must only be called from the Edge Function)"],
  [/WINDMILL_(WEBHOOK_)?TOKEN/i, "a Windmill token variable name"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
];

if (existsSync(dist)) {
  const textExt = /\.(html|js|mjs|cjs|css|json|map|txt|xml|svg|webmanifest)$/i;
  let endpointFound = false;
  const endpoint = process.env.VITE_CONTACT_FUNCTION_URL;
  for (const file of walk(dist).filter((f) => textExt.test(f))) {
    const text = readFileSync(file, "utf8");
    const rel = relative(dist, file);
    for (const [re, label] of forbidden) {
      if (re.test(text)) errors.push(`${rel} contains ${label}`);
    }
    for (const [token] of text.matchAll(/eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g)) {
      const role = jwtRole(token);
      if (role && role !== "anon") errors.push(`${rel} contains a JWT with role '${role}'`);
    }
    if (endpoint && text.includes(endpoint)) endpointFound = true;
  }
  if (!endpoint) warnings.push("VITE_CONTACT_FUNCTION_URL not set - contact form endpoint not verified in bundle");
  else if (!endpointFound) errors.push(`VITE_CONTACT_FUNCTION_URL (${endpoint}) not found in bundle - contact form is not wired to it`);
}

for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  console.error(`dist check FAILED:\n  - ${errors.join("\n  - ")}`);
  process.exit(1);
}
console.log(`dist check passed (base ${base}, no privileged material found)`);
