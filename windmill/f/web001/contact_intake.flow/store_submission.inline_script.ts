// Windmill step "store_submission" of flow f/web001/contact_intake (Bun).
// Idempotent insert into public.contact_submissions via PostgREST using the
// service-role/secret key, which Windmill injects from a secret variable.
// Throws on any failure so the synchronous webhook reports an error.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function main(
  request_id: string,
  name: string,
  email: string,
  message: string,
  supabase_url: string,
  supabase_service_key: string,
) {
  // Defense in depth: the Edge Function already validated, but this flow is
  // also reachable by anyone holding the webhook token.
  if (typeof request_id !== "string" || !UUID_RE.test(request_id)) throw new Error("invalid request_id");
  for (const [field, value, min, max] of [["name", name, 2, 80], ["email", email, 3, 254], ["message", message, 10, 1000]] as const) {
    if (typeof value !== "string" || value.trim().length < min || value.length > max) throw new Error(`invalid ${field}`);
  }
  if (!supabase_url || !supabase_service_key) throw new Error("supabase credentials not configured");

  const base = `${supabase_url.replace(/\/+$/, "")}/rest/v1/contact_submissions`;
  const headers: Record<string, string> = { apikey: supabase_service_key, "Content-Type": "application/json" };
  // Legacy service_role keys are JWTs and also go in Authorization;
  // new sb_secret_ keys must only be sent as apikey.
  if (supabase_service_key.startsWith("eyJ")) headers.Authorization = `Bearer ${supabase_service_key}`;

  const insert = await fetch(`${base}?on_conflict=request_id&select=request_id`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify({ request_id, name, email, message }),
  });
  if (!insert.ok) throw new Error(`insert failed: HTTP ${insert.status}`);
  const rows = (await insert.json()) as Array<{ request_id: string }>;
  if (rows.length === 1 && rows[0].request_id === request_id) {
    return { stored: true, request_id, duplicate: false };
  }

  // Conflict path returns no rows: confirm the existing row before reporting success.
  const check = await fetch(`${base}?request_id=eq.${request_id}&select=request_id`, { headers });
  if (!check.ok) throw new Error(`verify failed: HTTP ${check.status}`);
  const existing = (await check.json()) as Array<{ request_id: string }>;
  if (existing.length !== 1) throw new Error("insert not confirmed");
  return { stored: true, request_id, duplicate: true };
}
