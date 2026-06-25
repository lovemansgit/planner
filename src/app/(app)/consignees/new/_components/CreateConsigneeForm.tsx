// Day-25 / brief v1.12 §3.3.1 — flat consignee form.
//
// Single-page form with two visually-distinct sections (Identity +
// Address). Mirrors the /admin/merchants/new aesthetic per plan §3.1.
// Submit invokes createConsigneeAction; on success the operator lands
// on /consignees/[id]?created=1 where the Toast primitive (PR #248)
// renders "Consignee created" via the existing ?created=1 query
// pattern.
//
// Subscription creation moves to its own surface — the operator clicks
// the Create-subscription CTA on the Overview-tab empty state after
// consignee creation.
//
// Phase 10 · Batch B4 — fields adopt the shipped Field/Select kit: the local
// TextField composes <Field> (sentence-case label + help/error a11y) over a
// native control on the recipe surface (inputClass/textareaClass), and the
// address-label <select> becomes <Select>. Pure presentation — every name,
// hint, required flag, option, error branch, and the action wiring is preserved.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { inputClass, textareaClass } from "@/components/form-field-recipe";
import { Select } from "@/components/Select";

import { createConsigneeAction, type CreateConsigneeActionResult } from "../_actions";

export function CreateConsigneeForm() {
  const router = useRouter();
  const [actionResult, formAction, isPending] = useActionState<
    CreateConsigneeActionResult | { readonly kind: "idle" },
    FormData
  >(createConsigneeAction, { kind: "idle" });

  useEffect(() => {
    if (actionResult.kind === "created") {
      router.push(`/consignees/${actionResult.consigneeId}?created=1`);
    }
  }, [actionResult, router]);

  const fieldErrors =
    actionResult.kind === "validation" ? actionResult.fieldErrors : {};
  const formError =
    actionResult.kind === "conflict"
      ? actionResult.message
      : actionResult.kind === "forbidden"
        ? actionResult.message
        : actionResult.kind === "internal_error"
          ? actionResult.message
          : actionResult.kind === "validation" && fieldErrors._form
            ? fieldErrors._form
            : null;

  return (
    <>
      {formError ? (
        <p
          role="alert"
          className="mb-6 rounded-sm border border-red/40 bg-red/10 px-3 py-2 text-sm text-red"
        >
          {formError}
        </p>
      ) : null}

      <form action={formAction} className="space-y-8">
        <fieldset className="space-y-6">
          <legend className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Identity
          </legend>

          <TextField
            label="Full name"
            name="name"
            placeholder="Fatima Al Mansouri"
            error={fieldErrors.name}
            required
          />

          <TextField
            label="Primary phone"
            name="phone"
            placeholder="+971501234567"
            hint="E.164 format. UAE numbers auto-convert from local format on save."
            error={fieldErrors.phone}
            required
          />

          <TextField
            label="Email"
            name="email"
            type="email"
            placeholder="fatima@example.com"
            error={fieldErrors.email}
          />

          <TextField
            label="Delivery notes"
            name="delivery_notes"
            placeholder="Gate code 4221; leave at door if absent"
            hint="Operator → driver context. Visible on every delivery for this consignee."
            multiline
          />

          <TextField
            label="Merchant internal reference"
            name="external_ref"
            placeholder="MPL-A1029"
            hint="Optional. Cross-reference to the merchant's own customer ID."
          />

          <TextField
            label="Internal notes"
            name="notes_internal"
            hint="Operator-only. Not visible to drivers."
            multiline
          />
        </fieldset>

        <fieldset className="space-y-6 border-t border-[color:var(--color-border-strong)] pt-8">
          <legend className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Delivery address
          </legend>
          <p className="text-xs text-[color:var(--color-text-secondary)]">
            Single primary address for v1. Add more from the consignee detail page after onboarding.
          </p>

          <Field
            label="Address label"
            htmlFor="consignee-address_label"
            error={fieldErrors.address_label}
          >
            <Select
              id="consignee-address_label"
              name="address_label"
              defaultValue="home"
              invalid={Boolean(fieldErrors.address_label)}
              aria-describedby={
                fieldErrors.address_label ? "consignee-address_label-error" : undefined
              }
            >
              <option value="home">Home</option>
              <option value="office">Office</option>
              <option value="other">Other</option>
            </Select>
          </Field>

          <TextField
            label="Address line"
            name="address_line"
            placeholder="Villa 14, Street 22, Jumeirah"
            error={fieldErrors.address_line}
            required
          />

          <TextField
            label="District / area"
            name="address_district"
            placeholder="Jumeirah 1"
            error={fieldErrors.address_district}
            required
          />

          <TextField
            label="City"
            name="address_emirate"
            placeholder="Dubai"
            error={fieldErrors.address_emirate}
            required
          />
        </fieldset>

        <div className="flex items-center justify-end gap-3 border-t border-[color:var(--color-border-strong)] pt-8">
          <Link
            href="/consignees"
            className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:text-navy"
          >
            Cancel
          </Link>
          <Button type="submit" variant="primary" disabled={isPending}>
            {isPending ? "Creating…" : "Create consignee"}
          </Button>
        </div>
      </form>
    </>
  );
}

interface TextFieldProps {
  readonly label: string;
  readonly name: string;
  readonly type?: string;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
  readonly multiline?: boolean;
}

// Composes the shipped <Field> wrapper over a native control on the B+ recipe
// surface. A shared TextInput primitive is the documented form-kit follow-up;
// kept form-local here per Batch B4 scope (no new kit components).
function TextField({
  label,
  name,
  type = "text",
  placeholder,
  hint,
  error,
  required,
  multiline,
}: TextFieldProps) {
  const id = `consignee-${name}`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-help` : undefined;
  return (
    <Field label={label} htmlFor={id} help={hint} error={error}>
      {multiline ? (
        <textarea
          id={id}
          name={name}
          placeholder={placeholder}
          required={required}
          rows={3}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={textareaClass(Boolean(error))}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          placeholder={placeholder}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={inputClass(Boolean(error))}
        />
      )}
    </Field>
  );
}
