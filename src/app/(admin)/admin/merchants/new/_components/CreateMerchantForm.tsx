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
//
// Phase 10 · Batch B4 — fields adopt the shipped Field/Select kit: the local
// input-rendering Field becomes a form-local TextField over <Field> (sentence-
// case labels + help/error a11y) + a native input on the recipe surface
// (inputClass). The Day-30 / Fix-A4 value-preservation (defaultValue echoed from
// submittedValues) is carried through unchanged.

"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { Button } from "@/components/Button";
import { Field } from "@/components/Field";
import { inputClass } from "@/components/form-field-recipe";

import { createMerchantAction, type CreateActionResult } from "../../_actions";

// B+ floating card surface (Phase 9 · Gap C/D), mirroring DetailView /
// CredentialsForm so every merchant form reads on the same warm-white float.
const FORM_CARD = "rounded-2xl bg-[color:var(--color-b-card)] p-8 shadow-b-card";

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

  const fieldErrors = actionResult.kind === "validation" ? actionResult.fieldErrors : {};

  // Day-30 / Fix-A4 (Aqib UAT 2026-05-18) — preserve submitted values
  // across validation / conflict / forbidden round-trips. React 19
  // server actions reset uncontrolled inputs on submit by default;
  // echoing `defaultValue` from the action result is the canonical
  // preservation path. Empty fallback ({}) covers idle (first render)
  // and `created` (post-success, form unmounts via the useEffect above).
  const submittedValues: Readonly<Record<string, string>> =
    actionResult.kind === "validation" ||
    actionResult.kind === "conflict" ||
    actionResult.kind === "forbidden"
      ? actionResult.submittedValues
      : {};

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
          className="mb-6 rounded-[10px] border border-red/40 bg-red/10 px-3.5 py-2.5 text-sm text-red"
        >
          {formError}
        </p>
      ) : null}

      {/*
        Day-30 / Fix-A4 (Aqib UAT 2026-05-18) — form value preservation.
        Each TextField below receives `defaultValue` from `submittedValues`
        (echoed back by createMerchantAction on validation / conflict /
        forbidden). React 19's `<form action={formAction}>` calls
        form.reset() after the action completes; reset restores each
        input to its `defaultValue` (HTML semantic), so populating
        defaultValue from the action's submittedValues preserves the
        operator's input. No form remount needed.
      */}
      <div className={FORM_CARD}>
        <form action={formAction} className="space-y-8">
          <TextField
            label="Merchant name"
            name="name"
            placeholder="Demo Bistro"
            error={fieldErrors.name}
            defaultValue={submittedValues.name}
            required
          />

          <TextField
            label="Slug"
            name="slug"
            placeholder="demo-bistro"
            hint="Lowercase letters, numbers, and hyphens (1-60 characters). Forms part of the merchant URL prefix."
            error={fieldErrors.slug}
            defaultValue={submittedValues.slug}
            required
          />

          <fieldset className="space-y-6 border-t border-[color:var(--color-border-strong)] pt-8">
            <legend className="font-b-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
              Pickup address
            </legend>
            <p className="text-xs text-[color:var(--color-text-secondary)]">
              Captured at merchant creation; surfaces as ship-from on every task.
            </p>

            <TextField
              label="Address line"
              name="pickup_line"
              placeholder="Building 4, Sheikh Zayed Road"
              error={fieldErrors.pickup_line}
              defaultValue={submittedValues.pickup_line}
              required
            />

            <TextField
              label="District"
              name="pickup_district"
              placeholder="Al Quoz"
              error={fieldErrors.pickup_district}
              defaultValue={submittedValues.pickup_district}
              required
            />

            <TextField
              label="City"
              name="pickup_emirate"
              placeholder="Dubai"
              error={fieldErrors.pickup_emirate}
              defaultValue={submittedValues.pickup_emirate}
              required
            />
          </fieldset>

          <fieldset className="space-y-6 border-t border-[color:var(--color-border-strong)] pt-8">
            <legend className="font-b-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
              SuiteFleet routing
            </legend>
            <p className="text-xs text-[color:var(--color-text-secondary)]">
              Required to route tasks to SuiteFleet outbound (per brief §5.3 Gate 2). Missing or
              invalid codes fail-close the cron push for this tenant.
            </p>

            <TextField
              label="SuiteFleet customer code"
              name="suitefleet_customer_code"
              placeholder="000"
              hint="Numeric ID provided by Transcorp's SF vendor contact (e.g. 12345). Positive integer, no leading zeros."
              error={fieldErrors.suitefleet_customer_code}
              defaultValue={submittedValues.suitefleet_customer_code}
              required
            />
          </fieldset>

          <div className="flex items-center justify-end gap-3 border-t border-[color:var(--color-border-strong)] pt-8">
            <Button href="/admin/merchants" variant="ghost">
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={isPending}>
              {isPending ? "Creating…" : "Create merchant"}
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}

interface TextFieldProps {
  readonly label: string;
  readonly name: string;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
  /**
   * Day-30 / Fix-A4 — preserved across server-action round-trips via
   * the parent's `submittedValues` (echoed back from createMerchantAction
   * on validation / conflict / forbidden). React 19's
   * `<form action={formAction}>` calls form.reset() after the action
   * returns; HTML's form.reset() semantic restores each <input> to its
   * `defaultValue` attribute, so populating defaultValue from
   * submittedValues preserves the operator's input. No form remount,
   * no `key=` on the <form>. See the inline comment block above the
   * <form> element for the same mechanism stated at the call site.
   */
  readonly defaultValue?: string;
}

// Composes the shipped <Field> over a native input on the B+ recipe surface.
// A shared TextInput primitive is the deferred form-kit follow-up; kept
// form-local per B4 scope (no new kit components).
function TextField({
  label,
  name,
  placeholder,
  hint,
  error,
  required,
  defaultValue,
}: TextFieldProps) {
  const id = `merchant-${name}`;
  const describedBy = error ? `${id}-error` : hint ? `${id}-help` : undefined;
  return (
    <Field label={label} htmlFor={id} help={hint} error={error}>
      <input
        id={id}
        name={name}
        type="text"
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={inputClass(Boolean(error))}
      />
    </Field>
  );
}
