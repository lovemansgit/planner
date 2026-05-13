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

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

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

          <Field
            label="Full name"
            name="name"
            placeholder="Fatima Al Mansouri"
            error={fieldErrors.name}
            required
          />

          <Field
            label="Primary phone"
            name="phone"
            placeholder="+971501234567"
            hint="E.164 format. UAE numbers auto-convert from local format on save."
            error={fieldErrors.phone}
            required
          />

          <Field
            label="Email"
            name="email"
            type="email"
            placeholder="fatima@example.com"
            error={fieldErrors.email}
          />

          <Field
            label="Delivery notes"
            name="delivery_notes"
            placeholder="Gate code 4221; leave at door if absent"
            hint="Operator → driver context. Visible on every delivery for this consignee."
            multiline
          />

          <Field
            label="Merchant internal reference"
            name="external_ref"
            placeholder="MPL-A1029"
            hint="Optional. Cross-reference to the merchant's own customer ID."
          />

          <Field
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

          <div>
            <label
              htmlFor="consignee-address_label"
              className="mb-1 block text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]"
            >
              Address label
            </label>
            <select
              id="consignee-address_label"
              name="address_label"
              defaultValue="home"
              aria-invalid={fieldErrors.address_label ? "true" : undefined}
              className="w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy focus:border-navy focus:outline-none aria-[invalid=true]:border-red"
            >
              <option value="home">Home</option>
              <option value="office">Office</option>
              <option value="other">Other</option>
            </select>
            {fieldErrors.address_label ? (
              <p role="alert" className="mt-1 text-xs text-red">
                {fieldErrors.address_label}
              </p>
            ) : null}
          </div>

          <Field
            label="Address line"
            name="address_line"
            placeholder="Villa 14, Street 22, Jumeirah"
            error={fieldErrors.address_line}
            required
          />

          <Field
            label="District / area"
            name="address_district"
            placeholder="Jumeirah 1"
            error={fieldErrors.address_district}
            required
          />

          <Field
            label="Emirate"
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
          <button
            type="submit"
            disabled={isPending}
            className="rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Creating…" : "Create consignee"}
          </button>
        </div>
      </form>
    </>
  );
}

interface FieldProps {
  readonly label: string;
  readonly name: string;
  readonly type?: string;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
  readonly multiline?: boolean;
}

function Field({
  label,
  name,
  type = "text",
  placeholder,
  hint,
  error,
  required,
  multiline,
}: FieldProps) {
  const id = `consignee-${name}`;
  const baseClass =
    "w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy placeholder:text-[color:var(--color-text-tertiary)] focus:border-navy focus:outline-none aria-[invalid=true]:border-red";
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]"
      >
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          name={name}
          placeholder={placeholder}
          required={required}
          rows={3}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={baseClass}
        />
      ) : (
        <input
          id={id}
          name={name}
          type={type}
          placeholder={placeholder}
          required={required}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={baseClass}
        />
      )}
      {hint && !error ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-[color:var(--color-text-tertiary)]">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red">
          {error}
        </p>
      ) : null}
    </div>
  );
}
