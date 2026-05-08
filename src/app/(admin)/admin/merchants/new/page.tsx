// Day 18 / C1 — New merchant form (client component).
//
// useActionState binds to createMerchantAction — server-side action
// reads FormData, validates, calls createMerchant service fn, and
// returns a discriminated-union result the form renders inline.
//
// Permission gating is service-layer-only: ForbiddenError surfaces
// from createMerchant when the actor lacks merchant:create. No
// layout-level gate per the registered Phase-2 deferral
// (memory/followup_admin_middleware_phase2.md).
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

import { createMerchantAction, type CreateActionResult } from "../_actions";

export default function NewMerchantPage() {
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
    <main className="min-h-screen bg-surface-primary text-navy font-sans">
      <div className="mx-auto max-w-2xl px-12 py-16">
        <header className="mb-12">
          <p className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Transcorp · Admin
          </p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">New merchant</h1>
          <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
            Provision a new merchant tenant. The merchant lands in <em>provisioning</em> status —
            activate from the list once configuration is complete.
          </p>
        </header>

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
            placeholder="dmb"
            hint="3 lowercase letters (a-z). Forms part of the merchant URL prefix."
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
      </div>
    </main>
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
