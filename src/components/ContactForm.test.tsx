import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ContactForm } from "./ContactForm";

const ENDPOINT = "https://fn.example/functions/v1/contact-submit";

function setup(responses: Array<(body: Record<string, string>) => Response | Promise<Response>>) {
  let n = 0;
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const newRequestId = vi.fn(() => ids[newRequestId.mock.calls.length - 1]);
  const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => responses[n++](JSON.parse(init!.body as string)));
  const user = userEvent.setup();
  render(<ContactForm endpoint={ENDPOINT} fetchImpl={fetchImpl} newRequestId={newRequestId} />);
  const sent = () => fetchImpl.mock.calls.map(([, init]) => JSON.parse(init!.body as string));
  return { user, fetchImpl, newRequestId, sent };
}

async function fill(user: ReturnType<typeof userEvent.setup>, message = "My shelf needs assembling.") {
  await user.clear(screen.getByLabelText("Name"));
  await user.type(screen.getByLabelText("Name"), "Ada Lovelace");
  await user.clear(screen.getByLabelText("Email"));
  await user.type(screen.getByLabelText("Email"), "ada@example.com");
  await user.clear(screen.getByLabelText("Message"));
  await user.type(screen.getByLabelText("Message"), message);
}

const received = (b: Record<string, string>) => Response.json({ ok: true, status: "received", request_id: b.request_id });
const failed = () => Response.json({ ok: false, error: "submission_failed", retryable: true }, { status: 502 });

describe("ContactForm", () => {
  it("shows field errors and does not submit invalid data", async () => {
    const { user, fetchImpl } = setup([]);
    await user.type(screen.getByLabelText("Name"), "A");
    await user.type(screen.getByLabelText("Email"), "nope");
    await user.type(screen.getByLabelText("Message"), "short");
    await user.click(screen.getByRole("button", { name: "Contact Us" }));
    expect(screen.getByText(/Name must be 2–80/)).toBeInTheDocument();
    expect(screen.getByText(/valid email/)).toBeInTheDocument();
    expect(screen.getByText(/Message must be 10–1000/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("shows loading, then confirmed success, sending the expected payload", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { user, sent } = setup([async (b) => (await gate, received(b))]);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Contact Us" }));
    expect(await screen.findByRole("button", { name: /Sending/ })).toBeDisabled();
    release();
    expect(await screen.findByText("Message received")).toBeInTheDocument();
    expect(sent()[0]).toEqual({
      request_id: "11111111-1111-4111-8111-111111111111",
      name: "Ada Lovelace",
      email: "ada@example.com",
      message: "My shelf needs assembling.",
      website: "",
    });
    expect(screen.getByLabelText("Name")).toHaveValue("");
  });

  it("shows a truthful failure and reuses request_id when retrying unchanged data", async () => {
    const { user, sent, newRequestId } = setup([failed, received]);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Contact Us" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Message not sent");
    expect(screen.queryByText("Message received")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Contact Us" }));
    expect(await screen.findByText("Message received")).toBeInTheDocument();
    expect(sent()[0].request_id).toBe(sent()[1].request_id);
    expect(newRequestId).toHaveBeenCalledTimes(1);
  });

  it("uses a new request_id when data changes after a failure", async () => {
    const { user, sent } = setup([failed, received]);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Contact Us" }));
    await screen.findByRole("alert");
    await user.type(screen.getByLabelText("Message"), " Thanks!");
    await user.click(screen.getByRole("button", { name: "Contact Us" }));
    await screen.findByText("Message received");
    expect(sent()[0].request_id).not.toBe(sent()[1].request_id);
  });

  it("does not show success when the response request_id does not match", async () => {
    const { user } = setup([() => Response.json({ status: "received", request_id: "someone-else" })]);
    await fill(user);
    await user.click(screen.getByRole("button", { name: "Contact Us" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByText("Message received")).not.toBeInTheDocument();
  });

  it("includes a hidden honeypot field", () => {
    setup([]);
    const honeypot = document.querySelector<HTMLInputElement>('input[name="website"]')!;
    expect(honeypot).toHaveAttribute("tabindex", "-1");
    expect(honeypot.closest("[aria-hidden='true']")).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Website" })).not.toBeInTheDocument();
  });
});
