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
// Slug is intentionally NOT editable here. Slug is set at creation
// only — a UI-driven rename of the internal-tenant slug ("transcorp")
// would silently break sysadmin role assignment + the user-creation
// UI's internal-vs-merchant classification (string-literal coupling at
// src/modules/identity/service.ts:428 + src/app/(admin)/admin/users/new/page.tsx:40,71).
// Typo recovery is direct-DB by Transcorp staff, deliberately not a
// UI affordance. See memory/followup_internal_tenant_identity_string_literal.md
// for the correctness-debt followup that moves identity off the string
// literal to a tenants.is_internal_tenant flag.
//
// On success: useEffect routes to /admin/merchants list (revalidatePath
// already flushed the list server-side).

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import type { Region } from "@/modules/credentials";
import type { Merchant } from "@/modules/merchants/types";

import {
  updateMerchantAction,
  type UpdateActionResult,
} from "../../../_actions";

interface EditMerchantFormProps {
  readonly initial: Merchant;
  /**
   * Active regions for the SF region picker. Sourced from
   * `listRegions(ctx, { onlyActive: true })` at the parent server
   * component. If the merchant's current `suitefleetRegionId` points
   * at a region not in this list (deactivated since the merchant was
   * assigned), it's surfaced as a sticky read-only display below the
   * picker rather than dropped — the operator can see the misalignment
   * and pick a replacement explicitly.
   */
  readonly activeRegions: readonly Region[];
}

export function EditMerchantForm({ initial, activeRegions }: EditMerchantFormProps) {
  const router = useRouter();
  const boundAction = updateMerchantAction.bind(null, initial.tenantId);
  const [actionResult, formAction, isPending] = useActionState<
    UpdateActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

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

      <form action={formAction} className="space-y-8">
        <Field
          label="Merchant name"
          name="name"
          defaultValue={initial.name}
          placeholder="Demo Bistro"
          error={fieldErrors.name}
          required
        />

        <div>
          <p className="mb-1 block text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]">
            Slug
          </p>
          <p className="rounded-sm border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-sm text-[color:var(--color-text-secondary)]">
            {initial.slug}
          </p>
          <p className="mt-1 text-xs text-[color:var(--color-text-tertiary)]">
            Slug is set at creation and not editable here. Contact Transcorp
            staff if a slug needs to be corrected.
          </p>
        </div>

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

          <RegionPicker
            currentRegionId={initial.suitefleetRegionId}
            activeRegions={activeRegions}
            error={fieldErrors.suitefleet_region_id}
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
            {isPending ? "Updating…" : "UPDATE MERCHANT"}
          </button>
        </div>
      </form>
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

interface RegionPickerProps {
  readonly currentRegionId: string;
  readonly activeRegions: readonly Region[];
  readonly error?: string;
}

function RegionPicker({ currentRegionId, activeRegions, error }: RegionPickerProps) {
  const id = "merchant-edit-suitefleet_region_id";
  // If the merchant's current region is INACTIVE, listRegions(onlyActive)
  // will not return it. Surface a sticky <option> for the current value
  // so the picker doesn't silently drop the assignment + so the operator
  // sees the misalignment.
  const currentInList = activeRegions.some((r) => r.id === currentRegionId);
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)]"
      >
        SuiteFleet region
      </label>
      <select
        id={id}
        name="suitefleet_region_id"
        defaultValue={currentRegionId}
        required
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? `${id}-error` : `${id}-hint`}
        className="w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy focus:border-navy focus:outline-none aria-[invalid=true]:border-red"
      >
        {!currentInList ? (
          <option value={currentRegionId} disabled>
            (Current region is inactive — pick a replacement)
          </option>
        ) : null}
        {activeRegions.map((r) => (
          <option key={r.id} value={r.id}>
            {r.displayName} ({r.clientId})
          </option>
        ))}
      </select>
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red">
          {error}
        </p>
      ) : (
        <p
          id={`${id}-hint`}
          className="mt-1 text-xs text-[color:var(--color-text-tertiary)]"
        >
          Determines which SuiteFleet region the merchant routes to + which authentication method
          applies to the credentials. Changing this is a routing change — credentials remain bound
          to the merchant.
        </p>
      )}
    </div>
  );
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
