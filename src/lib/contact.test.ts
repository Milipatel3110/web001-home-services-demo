import { describe, expect, it, vi } from "vitest";

import { fingerprint, submitContact, validate, type ContactPayload } from "./contact";

const valid = { name: "Ada Lovelace", email: "ada@example.com", message: "Please fix my door hinge." };
const payload: ContactPayload = { request_id: "3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c", ...valid, website: "" };
const fetchReturning = (res: Response) => vi.fn<typeof fetch>().mockResolvedValue(res);

describe("validate", () => {
  it("accepts valid input and boundary lengths", () => {
    expect(validate(valid)).toEqual({});
    expect(validate({ name: "Al", email: "a@b.co", message: "x".repeat(10) })).toEqual({});
    expect(validate({ name: "n".repeat(80), email: valid.email, message: "m".repeat(1000) })).toEqual({});
  });

  it.each([
    ["name", { name: "A" }],
    ["name", { name: "  A  " }],
    ["name", { name: "n".repeat(81) }],
    ["email", { email: "" }],
    ["email", { email: "not-an-email" }],
    ["email", { email: "a@b" }],
    ["email", { email: `${"a".repeat(245)}@example.com` }],
    ["message", { message: "too short" }],
    ["message", { message: "m".repeat(1001) }],
  ])("rejects invalid %s", (field, patch) => {
    expect(Object.keys(validate({ ...valid, ...patch }))).toEqual([field]);
  });
});

describe("fingerprint", () => {
  it("ignores surrounding whitespace but detects edits", () => {
    expect(fingerprint(valid)).toBe(fingerprint({ ...valid, name: ` ${valid.name} ` }));
    expect(fingerprint(valid)).not.toBe(fingerprint({ ...valid, message: valid.message + "!" }));
  });
});

describe("submitContact", () => {
  it("posts JSON to the endpoint and succeeds only on received + matching id", async () => {
    const fetchImpl = fetchReturning(Response.json({ status: "received", request_id: payload.request_id }));
    await expect(submitContact("https://fn.example/contact-submit", payload, fetchImpl)).resolves.toEqual({
      ok: true,
      requestId: payload.request_id,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://fn.example/contact-submit");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual(payload);
    expect(new Headers(init?.headers).get("authorization")).toBeNull();
  });

  it.each([
    ["mismatched request_id", Response.json({ status: "received", request_id: "other" })],
    ["wrong status", Response.json({ status: "queued", request_id: payload.request_id })],
    ["2xx without body", new Response(null, { status: 200 })],
    ["server error with received body", Response.json({ status: "received", request_id: payload.request_id }, { status: 500 })],
    ["502 failure", Response.json({ ok: false, retryable: true }, { status: 502 })],
    ["400 validation", Response.json({ ok: false }, { status: 400 })],
  ])("reports failure for %s", async (_label, res) => {
    const result = await submitContact("https://fn.example", payload, fetchReturning(res));
    expect(result.ok).toBe(false);
  });

  it("reports network errors and missing configuration as failures", async () => {
    const failing = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));
    expect((await submitContact("https://fn.example", payload, failing)).ok).toBe(false);
    const unused = vi.fn<typeof fetch>();
    expect((await submitContact(undefined, payload, unused)).ok).toBe(false);
    expect(unused).not.toHaveBeenCalled();
  });
});
