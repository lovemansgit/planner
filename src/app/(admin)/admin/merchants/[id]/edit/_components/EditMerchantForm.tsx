// Day 25 / T3 — Edit merchant form (client component).
//
// useActionState binds to updateMerchantAction — server-side action
// reads FormData, validates via parseEditMerchantForm, calls
// updateMerchant service fn, and returns a discriminated-union result
// the form renders inline.
//
// Permission preflight handled by the parent server component at
// [id]/edit/page.tsx: an actor without merchant:update gets redirected
// to / before this form ever renders. The service-action's permission
// check still fires on submit (defense-in-depth — session could expire
// between render and submit); that path returns kind: "forbidden"
// which renders inline.
//
// Slug-change confirm modal (plan §6.4):
//   - When the operator's submitted slug differs from initial slug,
//     preventDefault, open a confirm dialog with break-glass copy.
//   - Cancel → close modal, no submit, slug-state preserved.
//   - Continue → close modal, re-trigger form submit programmatically.
//   - Per §9.2 ruling: modal re-fires every submit-with-different-slug,
//     including after a failed submit. Single rule:
//     formData.get("slug") !== initial.slug.
//
// On success: useEffect routes to /admin/merchants list (revalidatePath
// already flushed the list server-side).

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import type { Merchant } from "@/modules/merchants/types";

import {
  updateMerchantAction,
  type UpdateActionResult,
} from "../../../_actions";

interface EditMerchantFormProps {
  readonly initial: Merchant;
}

export function EditMerchantForm({ initial }: EditMerchantFormProps) {
  const router = useRouter();
  const boundAction = updateMerchantAction.bind(null, initial.tenantId);
  const [actionResult, formAction, isPending] = useActionState<
    UpdateActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  // Slug-change confirm modal state (plan §6.4).
  const [pendingSubmit, setPendingSubmit] = useState<FormData | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const confirmTriggerRef = useRef<HTMLButtonElement>(null);
  const confirmPanelRef = useRef<HTMLDivElement>(null);

  // Navigate after success outside the render path.
  useEffect(() => {
    if (actionResult.kind === "updated") {
      router.push("/admin/merchants");
    }
  }, [actionResult.kind, router]);

  // not_found auto-redirect after 3s — operator lands on refreshed list
  // (which will no longer show the missing row).
  useEffect(() => {
    if (actionResult.kind !== "not_found") return;
    const handle = setTimeout(() => router.push("/admin/merchants"), 3000);
    return () => clearTimeout(handle);
  }, [actionResult.kind, router]);

  // Confirm modal — click-outside (mousedown) close.
  useEffect(() => {
    if (pendingSubmit === null) return;
    function handleMousedown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (confirmPanelRef.current?.contains(target)) return;
      setPendingSubmit(null);
    }
    document.addEventListener("mousedown", handleMousedown);
    return () => document.removeEventListener("mousedown", handleMousedown);
  }, [pendingSubmit]);

  // Confirm modal — Escape close.
  useEffect(() => {
    if (pendingSubmit === null) return;
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setPendingSubmit(null);
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [pendingSubmit]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    const submittedSlug = String(formData.get("slug") ?? "").trim().toLowerCase();
    if (submittedSlug !== initial.slug && submittedSlug.length > 0) {
      event.preventDefault();
      setPendingSubmit(formData);
    }
    // Otherwise — let the form submit naturally to formAction.
  }

  function confirmSlugChange() {
    if (pendingSubmit === null) return;
    // useTransition-free submit: dispatch the bound action directly with
    // the captured FormData. useActionState's formAction signature is
    // (formData) => void; we invoke it with the stored payload.
    const data = pendingSubmit;
    setPendingSubmit(null);
    formAction(data);
  }

  const fieldErrors =
    actionResult.kind === "validation" ? actionResult.fieldErrors : {};
  const formError =
    actionResult.kind === "conflict"
      ? actionResult.message
      : actionResult.kind === "forbidden"
        ? actionResult.message
        : actionResult.kind === "not_found"
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

      <form
        ref={formRef}
        action={formAction}
        onSubmit={handleSubmit}
        className="space-y-8"
      >
        <Field
          label="Merchant name"
          name="name"
          defaultValue={initial.name}
          placeholder="Demo Bistro"
          error={fieldErrors.name}
          required
        />

        <Field
          label="Slug"
          name="slug"
          defaultValue={initial.slug}
          placeholder="demo-bistro"
          hint="Lowercase letters, numbers, and hyphens (1-60 characters). Changing breaks any saved URL that uses the current slug."
          error={fieldErrors.slug}
          required
        />

        <fieldset className="space-y-6 border-t border-[color:var(--color-border-strong)] pt-8">
          <legend className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            Pickup address
          </legend>
          <p className="text-xs text-[color:var(--color-text-secondary)]">
            Captured at merchant creation; surfaces as ship-from on every task. All three fields are
            required if any is provided.
          </p>

          <Field
            label="Address line"
            name="pickup_line"
            defaultValue={initial.pickupAddress?.line ?? ""}
            placeholder="Building 4, Sheikh Zayed Road"
            error={fieldErrors.pickup_line}
          />

          <Field
            label="District"
            name="pickup_district"
            defaultValue={initial.pickupAddress?.district ?? ""}
            placeholder="Al Quoz"
            error={fieldErrors.pickup_district}
          />

          <Field
            label="Emirate"
            name="pickup_emirate"
            defaultValue={initial.pickupAddress?.emirate ?? ""}
            placeholder="Dubai"
            error={fieldErrors.pickup_emirate}
          />
        </fieldset>

        <fieldset className="space-y-6 border-t border-[color:var(--color-border-strong)] pt-8">
          <legend className="text-xs uppercase tracking-[0.2em] text-[color:var(--color-text-secondary)]">
            SuiteFleet routing
          </legend>
          <p className="text-xs text-[color:var(--color-text-secondary)]">
            Required to route tasks to SuiteFleet outbound. Missing or invalid codes fail-close the
            cron push for this tenant.
          </p>

          <Field
            label="SuiteFleet customer code"
            name="suitefleet_customer_code"
            defaultValue={initial.suitefleetCustomerCode ?? ""}
            placeholder="000"
            hint="Numeric ID provided by Transcorp's SF vendor contact (e.g. 12345). Positive integer, no leading zeros."
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
            ref={confirmTriggerRef}
            type="submit"
            disabled={isPending}
            className="rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? "Updating…" : "UPDATE MERCHANT"}
          </button>
        </div>
      </form>

      {pendingSubmit !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Confirm slug change"
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/20 p-4"
        >
          <div
            ref={confirmPanelRef}
            className="w-full max-w-md rounded-sm border border-stone-200 border-t-[1px] border-t-amber bg-surface-primary p-6"
          >
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
              Slug change
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold text-navy">
              Confirm slug change
            </h2>
            <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
              Changing the slug will break any existing bookmarks or saved URLs that use the current
              slug. Continue?
            </p>

            <div className="mt-6 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setPendingSubmit(null)}
                className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:text-navy"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmSlugChange}
                className="rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

interface FieldProps {
  readonly label: string;
  readonly name: string;
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly error?: string;
  readonly required?: boolean;
}

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  hint,
  error,
  required,
}: FieldProps) {
  const id = `merchant-edit-${name}`;
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
        defaultValue={defaultValue}
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
