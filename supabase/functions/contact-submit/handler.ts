// contact-submit request handler. Runtime-agnostic (Deno in Supabase, Node in
// tests): everything environment-specific is injected through Config / Deps.
// Must stay erasable TypeScript (no enums, no parameter properties) so Node's
// type stripping can run it directly.

export type Config = {
  windmillUrl: string; // full run_wait_result webhook URL of f/web001/contact_intake
  windmillToken: string; // Edge secret, never logged or returned
  allowedOrigins: string[];
  upstreamTimeoutMs: number;
};

export type Deps = {
  fetch: typeof fetch;
  log: (event: string, fields: Record<string, unknown>) => void;
};

export const MAX_BODY_BYTES = 8 * 1024;
export const LIMITS = { nameMin: 2, nameMax: 80, email: 254, messageMin: 10, messageMax: 1000 } as const;

const ALLOWED_KEYS = new Set(["request_id", "name", "email", "message", "website"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
// C0 controls except \t \n \r, plus DEL and C1 controls.
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
const SINGLE_LINE_CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/;

export type Submission = { request_id: string; name: string; email: string; message: string };

type Validation =
  | { ok: true; value: Submission; honeypot: boolean }
  | { ok: false; field: string; reason: string };

export function loadConfig(get: (key: string) => string | undefined): Config {
  const windmillUrl = get("WINDMILL_WEBHOOK_URL") ?? "";
  const windmillToken = get("WINDMILL_WEBHOOK_TOKEN") ?? "";
  const allowedOrigins = (get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const timeout = Number(get("UPSTREAM_TIMEOUT_MS") ?? "15000");
  return {
    windmillUrl,
    windmillToken,
    allowedOrigins,
    upstreamTimeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 15000,
  };
}

export function validate(input: unknown): Validation {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, field: "body", reason: "must be a JSON object" };
  }
  const body = input as Record<string, unknown>;
  for (const key of Object.keys(body)) {
    if (!ALLOWED_KEYS.has(key)) return { ok: false, field: key, reason: "unexpected field" };
  }

  // Honeypot: real users never see or fill this field.
  const website = body.website;
  if (website !== undefined && typeof website !== "string") {
    return { ok: false, field: "website", reason: "must be a string" };
  }
  const honeypot = typeof website === "string" && website.trim() !== "";

  const str = (field: string): string | null =>
    typeof body[field] === "string" ? (body[field] as string).normalize("NFC").trim() : null;

  const request_id = str("request_id")?.toLowerCase() ?? null;
  if (!request_id || !UUID_RE.test(request_id)) {
    return { ok: false, field: "request_id", reason: "must be a UUID" };
  }

  const name = str("name");
  if (!name) return { ok: false, field: "name", reason: "required" };
  if (name.length < LIMITS.nameMin) return { ok: false, field: "name", reason: "too short" };
  if (name.length > LIMITS.nameMax) return { ok: false, field: "name", reason: "too long" };
  if (SINGLE_LINE_CONTROL_RE.test(name)) return { ok: false, field: "name", reason: "invalid characters" };

  const email = str("email");
  if (!email) return { ok: false, field: "email", reason: "required" };
  if (email.length > LIMITS.email || !EMAIL_RE.test(email)) {
    return { ok: false, field: "email", reason: "invalid" };
  }

  const message = str("message");
  if (!message) return { ok: false, field: "message", reason: "required" };
  if (message.length < LIMITS.messageMin) return { ok: false, field: "message", reason: "too short" };
  if (message.length > LIMITS.messageMax) return { ok: false, field: "message", reason: "too long" };
  if (CONTROL_RE.test(message)) return { ok: false, field: "message", reason: "invalid characters" };

  return { ok: true, value: { request_id, name, email, message }, honeypot };
}

async function readCapped(req: Request, max: number): Promise<string | null> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > max) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(buf);
}

// The browser shows success only for this exact shape with its own request_id.
const received = (request_id: string) => ({ ok: true, status: "received", request_id });

export function createHandler(config: Config, deps: Deps): (req: Request) => Promise<Response> {
  const allowed = new Set(config.allowedOrigins);

  const cors = (origin: string): Record<string, string> => ({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  });

  const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
    });

  return async (req: Request): Promise<Response> => {
    const origin = (req.headers.get("origin") ?? "").replace(/\/+$/, "");
    if (!origin || !allowed.has(origin)) {
      deps.log("rejected", { reason: "origin", method: req.method });
      return json(403, { ok: false, error: "origin_not_allowed" });
    }
    const corsHeaders = cors(origin);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (req.method !== "POST") {
      return json(405, { ok: false, error: "method_not_allowed" }, { ...corsHeaders, Allow: "POST, OPTIONS" });
    }

    const contentType = (req.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (contentType !== "application/json") {
      return json(415, { ok: false, error: "unsupported_media_type" }, corsHeaders);
    }

    let raw: string | null;
    try {
      raw = await readCapped(req, MAX_BODY_BYTES);
    } catch {
      return json(400, { ok: false, error: "invalid_body" }, corsHeaders);
    }
    if (raw === null) {
      deps.log("rejected", { reason: "too_large" });
      return json(413, { ok: false, error: "payload_too_large" }, corsHeaders);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return json(400, { ok: false, error: "invalid_json" }, corsHeaders);
    }

    const result = validate(parsed);
    if (!result.ok) {
      deps.log("rejected", { reason: "validation", field: result.field });
      return json(400, { ok: false, error: "validation_failed", field: result.field, reason: result.reason }, corsHeaders);
    }
    const { value } = result;

    if (result.honeypot) {
      // Look like a success so bots learn nothing; nothing is forwarded or stored.
      deps.log("honeypot", { request_id: value.request_id });
      return json(200, received(value.request_id), corsHeaders);
    }

    if (!config.windmillUrl || !config.windmillToken) {
      deps.log("misconfigured", { request_id: value.request_id });
      return json(500, { ok: false, error: "server_misconfigured", request_id: value.request_id }, corsHeaders);
    }

    const failure = (reason: string, extra: Record<string, unknown> = {}): Response => {
      deps.log("upstream_failed", { request_id: value.request_id, reason, ...extra });
      return json(502, { ok: false, error: "submission_failed", retryable: true, request_id: value.request_id }, corsHeaders);
    };

    let upstream: Response;
    try {
      upstream = await deps.fetch(config.windmillUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.windmillToken}` },
        body: JSON.stringify(value),
        signal: AbortSignal.timeout(config.upstreamTimeoutMs),
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "unknown";
      return failure(name === "TimeoutError" || name === "AbortError" ? "timeout" : "network");
    }

    if (!upstream.ok) {
      await upstream.body?.cancel();
      return failure("status", { status: upstream.status });
    }

    let out: unknown;
    try {
      out = await upstream.json();
    } catch {
      return failure("non_json");
    }

    // Only an explicit, matching confirmation counts as stored.
    const confirmed =
      typeof out === "object" &&
      out !== null &&
      (out as Record<string, unknown>).stored === true &&
      (out as Record<string, unknown>).request_id === value.request_id;
    if (!confirmed) return failure("unconfirmed");

    deps.log("stored", { request_id: value.request_id });
    return json(200, received(value.request_id), corsHeaders);
  };
}
