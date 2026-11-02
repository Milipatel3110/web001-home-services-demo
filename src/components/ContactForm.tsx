import { useRef, useState, type FormEvent } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  LIMITS,
  fingerprint,
  normalize,
  submitContact,
  validate,
  type ContactValues,
  type FieldErrors,
} from "@/lib/contact";

type Status = { kind: "idle" } | { kind: "submitting" } | { kind: "success" } | { kind: "error"; message: string };

const EMPTY: ContactValues = { name: "", email: "", message: "" };

type Props = {
  endpoint?: string;
  fetchImpl?: typeof fetch;
  newRequestId?: () => string;
};

export function ContactForm({
  endpoint = import.meta.env.VITE_CONTACT_FUNCTION_URL,
  fetchImpl,
  newRequestId = () => crypto.randomUUID(),
}: Props) {
  const [values, setValues] = useState<ContactValues>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const honeypotRef = useRef<HTMLInputElement>(null);
  // Same request_id is reused while retrying unchanged data, so the server
  // can deduplicate; any edit to the data gets a fresh id.
  const pending = useRef<{ key: string; id: string } | null>(null);

  const submitting = status.kind === "submitting";

  function update(field: keyof ContactValues, value: string) {
    setValues((v) => ({ ...v, [field]: value }));
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
    if (status.kind === "success") setStatus({ kind: "idle" });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const fieldErrors = validate(values);
    setErrors(fieldErrors);
    const firstInvalid = (Object.keys(fieldErrors) as Array<keyof ContactValues>)[0];
    if (firstInvalid) {
      setStatus({ kind: "idle" });
      document.getElementById(`contact-${firstInvalid}`)?.focus();
      return;
    }

    const key = fingerprint(values);
    if (pending.current?.key !== key) pending.current = { key, id: newRequestId() };
    const requestId = pending.current.id;

    setStatus({ kind: "submitting" });
    const result = await submitContact(
      endpoint,
      { request_id: requestId, ...normalize(values), website: honeypotRef.current?.value ?? "" },
      fetchImpl,
    );

    if (result.ok) {
      pending.current = null;
      setValues(EMPTY);
      setStatus({ kind: "success" });
    } else {
      setStatus({ kind: "error", message: result.error });
    }
  }

  const describedBy = (field: keyof ContactValues) => (errors[field] ? `contact-${field}-error` : undefined);

  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-5" aria-busy={submitting}>
      <div className="grid gap-2">
        <Label htmlFor="contact-name">Name</Label>
        <Input
          id="contact-name"
          name="name"
          autoComplete="name"
          value={values.name}
          onChange={(e) => update("name", e.target.value)}
          aria-invalid={!!errors.name}
          aria-describedby={describedBy("name")}
          disabled={submitting}
          required
        />
        {errors.name && (
          <p id="contact-name-error" className="text-destructive text-sm">
            {errors.name}
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="contact-email">Email</Label>
        <Input
          id="contact-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={values.email}
          onChange={(e) => update("email", e.target.value)}
          aria-invalid={!!errors.email}
          aria-describedby={describedBy("email")}
          disabled={submitting}
          required
        />
        {errors.email && (
          <p id="contact-email-error" className="text-destructive text-sm">
            {errors.email}
          </p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="contact-message">Message</Label>
        <Textarea
          id="contact-message"
          name="message"
          rows={5}
          value={values.message}
          onChange={(e) => update("message", e.target.value)}
          aria-invalid={!!errors.message}
          aria-describedby={[describedBy("message"), "contact-message-hint"].filter(Boolean).join(" ")}
          disabled={submitting}
          required
        />
        <p id="contact-message-hint" className="text-muted-foreground text-xs">
          {values.message.trim().length}/{LIMITS.messageMax} characters (minimum {LIMITS.messageMin})
        </p>
        {errors.message && (
          <p id="contact-message-error" className="text-destructive text-sm">
            {errors.message}
          </p>
        )}
      </div>

      {/* Honeypot: hidden from people and assistive tech; bots tend to fill it. */}
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="contact-website">Website</label>
        <input ref={honeypotRef} id="contact-website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div aria-live="polite" className="empty:hidden">
        {status.kind === "success" && (
          <Alert className="border-green-600/40 text-green-800">
            <CheckCircle2 />
            <AlertTitle>Message received</AlertTitle>
            <AlertDescription>Thanks — your message was received. (This is a demo; no services are offered.)</AlertDescription>
          </Alert>
        )}
        {status.kind === "error" && (
          <Alert variant="destructive" role="alert">
            <AlertCircle />
            <AlertTitle>Message not sent</AlertTitle>
            <AlertDescription>{status.message}</AlertDescription>
          </Alert>
        )}
      </div>

      <Button type="submit" size="lg" disabled={submitting} className="w-full sm:w-auto sm:justify-self-start">
        {submitting ? (
          <>
            <Loader2 className="animate-spin" aria-hidden="true" />
            Sending…
          </>
        ) : (
          "Contact Us"
        )}
      </Button>
    </form>
  );
}
