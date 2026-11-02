// Contact form validation and submission. The browser talks only to the
// public Supabase Edge Function; it never holds keys or calls Windmill/Postgres.

export const LIMITS = {
  nameMin: 2,
  nameMax: 80,
  emailMax: 254,
  messageMin: 10,
  messageMax: 1000,
} as const;

export type ContactValues = { name: string; email: string; message: string };
export type FieldErrors = Partial<Record<keyof ContactValues, string>>;

export type ContactPayload = ContactValues & { request_id: string; website: string };

export type SubmitResult = { ok: true; requestId: string } | { ok: false; error: string };

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export function normalize(values: ContactValues): ContactValues {
  return { name: values.name.trim(), email: values.email.trim(), message: values.message.trim() };
}

export function validate(values: ContactValues): FieldErrors {
  const { name, email, message } = normalize(values);
  const errors: FieldErrors = {};

  if (name.length < LIMITS.nameMin || name.length > LIMITS.nameMax) {
    errors.name = `Name must be ${LIMITS.nameMin}–${LIMITS.nameMax} characters.`;
  }
  if (!email) {
    errors.email = "Email is required.";
  } else if (email.length > LIMITS.emailMax) {
    errors.email = `Email must be at most ${LIMITS.emailMax} characters.`;
  } else if (!EMAIL_RE.test(email)) {
    errors.email = "Enter a valid email address.";
  }
  if (message.length < LIMITS.messageMin || message.length > LIMITS.messageMax) {
    errors.message = `Message must be ${LIMITS.messageMin}–${LIMITS.messageMax} characters.`;
  }
  return errors;
}

/** Stable key for "unchanged form data", used to reuse request_id on retry. */
export function fingerprint(values: ContactValues): string {
  const { name, email, message } = normalize(values);
  return JSON.stringify([name, email, message]);
}

export async function submitContact(
  endpoint: string | undefined,
  payload: ContactPayload,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000,
): Promise<SubmitResult> {
  if (!endpoint) {
    return { ok: false, error: "The contact form is not configured. Please try again later." };
  }

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return { ok: false, error: "We couldn't reach the server. Check your connection and try again." };
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // Non-JSON body: handled as failure below.
  }

  const data = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  if (response.ok && data.status === "received" && data.request_id === payload.request_id) {
    return { ok: true, requestId: payload.request_id };
  }

  if (response.status === 400) {
    return { ok: false, error: "The server rejected some of the details. Please review the form and try again." };
  }
  if (response.status === 429) {
    return { ok: false, error: "Too many attempts. Please wait a moment and try again." };
  }
  return { ok: false, error: "Your message was not confirmed as received. Please try again." };
}
