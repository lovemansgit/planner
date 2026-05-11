// Day 18 / C1 — New merchant form (client component).
//
// useActionState binds to createMerchantAction — server-side action
// reads FormData, validates, calls createMerchant service fn, and
// returns a discriminated-union result the form renders inline.
//
// Permission preflight is handled by the parent server component at
// new/page.tsx: an actor without merchant:create gets redirected to /
// before this form ever renders. This component is therefore reached
// only by transcorp-staff actors with the create permission. The
// service-action's permission check still fires on submit
// (defense-in-depth — session could expire between page render and
// submit); that path returns kind: "forbidden" which renders inline.
//
// On success: redirect to /admin/merchants (operator returns to
// the list view; revalidatePath in the action ensures the new row
// is visible). The redirect flips on the `created` result kind in
// a useEffect — avoids the React 19 "redirect during render" warning
// useActionState would otherwise emit.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { createMerchantAction, type CreateActionResult } from "../../_actions";

export function CreateMerchantForm() {
  const router = useRouter();
  const [actionResult, formAction, isPending] = useActionState<
    CreateActionResult | { readonly kind: "idle" },
    FormData
  >(createMerchantAction, { kind: "idle" });

  // Navigate after success outside the render path. Server-side
  // revalidatePath has already flushed the list; the operator lands
  // on the refreshed list view.
  useEffect(() => {
    if (actionResult.kind === "created") {
      router.push("/admin/merchants");
    }
  }, [actionResult.kind, router]);

  const fieldErrors =
    actionResult.kind === "validation" ? actionResult.fieldErrors : {};
  const formError =
    actionResult.kind === "conflict"
      ? actionResult.message
      : actionResult.kind === "forbidden"
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
        <Field
          label="Merchant name"
          name="name"
          placeholder="Demo Bistro"
          error={fieldErrors.name}
          required
        />

        <Field
          label="Slug"
          name="slug"
          placeholder="demo-bistro"
          hint="Lowercase letters, numbers, and hyphens (1-60 characters). Forms part of the merchant URL prefix."
          error={fieldErrors.slug}
          required
        />

        <fieldset className="space-y-6 border-t border-[color:var(--color-border-strong)] pt-8">
          <legend className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Pickup address
          </legend>
          <p className="text-xs text-[color:var(--color-text-secondary)]">
            Captured at merchant creation; surfaces as ship-from on every task.
          </p>

          <Field
            label="Address line"
            name="pickup_line"
            placeholder="Building 4, Sheikh Zayed Road"
            error={fieldErrors.pickup_line}
            required
          />

          <Field
            label="District"
            name="pickup_district"
            placeholder="Al Quoz"
            error={fieldErrors.pickup_district}
            required
          />

          <Field
            label="Emirate"
            name="pickup_emirate"
            placeholder="Dubai"
            error={fieldErrors.pickup_emirate}
            required
          />
        </fieldset>

        <fieldset className="space-y-6 border-t border-[color:var(--color-border-strong)] pt-8">
          <legend className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            SuiteFleet routing
          </legend>
          <p className="text-xs text-[color:var(--color-text-secondary)]">
            Required to route tasks to SuiteFleet outbound (per brief §5.3 Gate 2). Missing or
            invalid codes fail-close the cron push for this tenant.
          </p>

          <Field
            label="SuiteFleet customer code"
            name="suitefleet_customer_code"
            placeholder="588"
            hint="Numeric ID provided by Transcorp's SF vendor contact (e.g. 588). Positive integer, no leading zeros."
            error={fieldErrors.suitefleet_customer_code}
            required
          />
        </fieldset>

        <div className="flex items-center justify-end gap-3 border-t border-[color:var(--color-border-strong)] pt-8">
          <Link
            href="/admin/merchants"
            className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:text-navy"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Creating…" : "Create merchant"}
          </button>
        </div>
      </form>
    </>
  );
}

interface FieldProps {
  readonly label: string;
  readonly name: string;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
}

function Field({ label, name, placeholder, hint, error, required }: FieldProps) {
  const id = `merchant-${name}`;
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]"
      >
        {label}
      </label>
      <input
        id={id}
        name={name}
        type="text"
        placeholder={placeholder}
        required={required}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        className="w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy placeholder:text-[color:var(--color-text-tertiary)] focus:border-navy focus:outline-none aria-[invalid=true]:border-red"
      />
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
