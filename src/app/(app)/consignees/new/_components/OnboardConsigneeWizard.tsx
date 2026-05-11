// Day 22 / Phase 1 forms lane — onboard-consignee 3-step wizard.
//
// useActionState binds to onboardConsigneeAction. All three steps live
// in a single <form>; only the active step is visible (others are
// hidden via the HTML `hidden` attribute, which preserves their values
// in FormData on submit). Submit only fires from Step 3.
//
// State model:
//   - currentStep: 1 | 2 | 3 (React useState; not persisted)
//   - All field values live in the DOM as uncontrolled inputs (default
//     values seeded from the previous server-action result on
//     re-render after a validation failure).
//
// On `created` action result: navigate to /consignees/[id] (the new
// consignee's detail page).
//
// Single-address MVP per brief v1.11 amendment §3.3.1:
//   - Step 1 — identity (name, phone, optional email + notes)
//   - Step 2 — single primary address (label + line + district +
//     emirate)
//   - Step 3 — subscription (start date + optional end date + days of
//     week + delivery window + optional plan name + notes)
//
// Multi-address + per-weekday rotation deferred to Phase 2 per
// memory/followup_multi_address_rotation_phase_2.md.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import { FormError } from "@/components/forms/FormError";
import { FormField } from "@/components/forms/FormField";
import { FormSubmitButton } from "@/components/forms/FormSubmitButton";
import { TimeWindowPicker } from "@/components/forms/TimeWindowPicker";
import { WeekdaySelector } from "@/components/forms/WeekdaySelector";

import {
  onboardConsigneeAction,
  type OnboardConsigneeActionResult,
} from "../_actions";
import { validateStep, type WizardStep } from "../_helpers";

type Step = 1 | 2 | 3;

const ADDRESS_LABEL_OPTIONS: ReadonlyArray<{ value: "home" | "office" | "other"; label: string }> = [
  { value: "home", label: "Home" },
  { value: "office", label: "Office" },
  { value: "other", label: "Other" },
];

export function OnboardConsigneeWizard() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [currentStep, setCurrentStep] = useState<Step>(1);
  // Day-22 PM §3.22 — client-side per-step validation errors. Set by
  // the Continue button when the operator tries to advance with
  // invalid fields. Cleared when (a) Continue succeeds, (b) operator
  // clicks Back, or (c) a new server-action result arrives (server
  // becomes authoritative).
  const [clientFieldErrors, setClientFieldErrors] = useState<Readonly<Record<string, string>>>({});

  const [actionResult, formAction, isPending] = useActionState<
    OnboardConsigneeActionResult | { readonly kind: "idle" },
    FormData
  >(onboardConsigneeAction, { kind: "idle" });

  // On success, navigate to the new consignee detail page so the
  // operator immediately sees the calendar (per brief §3.3.1).
  useEffect(() => {
    if (actionResult.kind === "created") {
      router.push(`/consignees/${actionResult.consigneeId}`);
    }
  }, [actionResult, router]);

  // Note: client-side fieldErrors are cleared by the Continue / Back
  // handlers themselves (on successful Continue advance + on every
  // Back click). The merge below puts server errors over client
  // errors on overlapping keys so server validation is authoritative
  // post-submit; non-overlapping client errors (operator hasn't
  // resubmitted yet) are still visible until the operator interacts
  // with that step's navigation.

  // Compute the step that should be displayed. When a validation
  // error lands, override the operator's chosen `currentStep` with
  // the step holding the first error so they can fix it inline.
  // Pure derivation avoids react-hooks/set-state-in-effect noise.
  const displayedStep = useMemo<Step>(() => {
    if (actionResult.kind !== "validation") return currentStep;
    const fields = actionResult.fieldErrors;
    const stepOneFields = ["name", "phone", "email"] as const;
    const stepTwoFields = [
      "address_label",
      "address_line",
      "address_district",
      "address_emirate",
    ] as const;
    if (stepOneFields.some((f) => fields[f])) return 1;
    if (stepTwoFields.some((f) => fields[f])) return 2;
    return 3;
  }, [actionResult, currentStep]);

  // Merge client + server errors. Server errors override on
  // overlapping keys because the server is authoritative post-submit
  // (e.g. service-layer phone normalisation rejecting a value that
  // passed the client E.164 shape check). Client errors fill in
  // step-1 / step-2 fields that haven't been server-validated yet.
  const fieldErrors = useMemo(() => {
    const server = actionResult.kind === "validation" ? actionResult.fieldErrors : {};
    return { ...clientFieldErrors, ...server };
  }, [actionResult, clientFieldErrors]);
  // Top-of-form error banner. Fires on conflict / forbidden, on
  // service-layer ValidationError mapped to `_form`, AND on any
  // field-level validation result so operators have a visible global
  // signal that something needs attention — the inline field errors
  // are small (text-xs text-red) and easy to miss when the wizard
  // jumps to a different step than the operator was viewing.
  const formError = useMemo(() => {
    if (actionResult.kind === "conflict") return actionResult.message;
    if (actionResult.kind === "forbidden") return actionResult.message;
    if (actionResult.kind === "internal_error") return actionResult.message;
    if (actionResult.kind === "validation") {
      if (fieldErrors._form) return fieldErrors._form;
      if (Object.keys(fieldErrors).length > 0) {
        return "Some fields need attention. Check the highlighted inputs and try again.";
      }
    }
    return null;
  }, [actionResult, fieldErrors]);

  return (
    <>
      <StepIndicator currentStep={displayedStep} />

      <FormError message={formError} className="mb-6" />

      <form ref={formRef} action={formAction} className="space-y-8">
        {/* Step 1 — identity */}
        <fieldset hidden={displayedStep !== 1} className="space-y-6">
          <legend className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
            Step 1 · Identity
          </legend>
          <FormField
            name="name"
            label="Full name"
            placeholder="Sarah Khouri"
            required
            error={fieldErrors.name}
            autoComplete="name"
          />
          <FormField
            name="phone"
            label="Primary phone"
            placeholder="+971501234567"
            hint="E.164 format (country code prefix, no spaces)."
            required
            error={fieldErrors.phone}
            inputMode="tel"
            autoComplete="tel"
          />
          <FormField
            name="email"
            label="Email"
            labelTrailing={
              <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                Optional
              </span>
            }
            type="email"
            placeholder="sarah@example.com"
            error={fieldErrors.email}
            autoComplete="email"
          />
          <FormField
            name="delivery_notes"
            label="Delivery notes"
            labelTrailing={
              <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                Optional
              </span>
            }
            placeholder="Gate code, building access, etc."
            hint="Visible to drivers."
          />
          <FormField
            name="external_ref"
            label="Merchant internal reference"
            labelTrailing={
              <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                Optional
              </span>
            }
            placeholder="ABC-123"
          />
          <FormField
            name="consignee_notes_internal"
            label="Internal notes"
            labelTrailing={
              <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                Optional
              </span>
            }
            placeholder="Operator-only context"
            hint="Not surfaced to drivers."
          />
        </fieldset>

        {/* Step 2 — primary address */}
        <fieldset hidden={displayedStep !== 2} className="space-y-6">
          <legend className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
            Step 2 · Primary delivery address
          </legend>
          <p className="text-xs text-[color:var(--color-text-secondary)]">
            One address per consignee at MVP. Per-weekday rotation between multiple addresses
            ships in Phase 2.
          </p>

          <div>
            <label
              htmlFor="address_label"
              className="mb-1 block text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]"
            >
              Address label
            </label>
            <select
              id="address_label"
              name="address_label"
              required
              defaultValue="home"
              aria-invalid={fieldErrors.address_label ? "true" : undefined}
              className="w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy transition-colors duration-[120ms] ease-out focus:border-navy focus:outline-none aria-[invalid=true]:border-red"
            >
              {ADDRESS_LABEL_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {fieldErrors.address_label ? (
              <p role="alert" className="mt-1 text-xs text-red">
                {fieldErrors.address_label}
              </p>
            ) : null}
          </div>

          <FormField
            name="address_line"
            label="Address line"
            placeholder="Building 4, Apt 12, Sheikh Zayed Road"
            required
            error={fieldErrors.address_line}
            autoComplete="street-address"
          />
          <FormField
            name="address_district"
            label="District / Area"
            placeholder="Al Quoz"
            required
            error={fieldErrors.address_district}
            autoComplete="address-level2"
          />
          <FormField
            name="address_emirate"
            label="Emirate"
            placeholder="Dubai"
            required
            error={fieldErrors.address_emirate}
            autoComplete="address-level1"
          />
        </fieldset>

        {/* Step 3 — subscription */}
        <fieldset hidden={displayedStep !== 3} className="space-y-6">
          <legend className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
            Step 3 · Subscription
          </legend>

          <div className="grid gap-6 sm:grid-cols-2">
            <FormField
              name="subscription_start_date"
              label="Start date"
              type="date"
              required
              error={fieldErrors.subscription_start_date}
            />
            <FormField
              name="subscription_end_date"
              label="End date"
              labelTrailing={
                <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                  Optional
                </span>
              }
              type="date"
              hint="Leave empty for an open-ended subscription."
              error={fieldErrors.subscription_end_date}
            />
          </div>

          <WeekdaySelector
            name="subscription_days_of_week"
            label="Delivery days"
            error={fieldErrors.subscription_days_of_week}
            hint="Pick the weekdays for recurring deliveries."
          />

          <TimeWindowPicker
            startName="subscription_delivery_window_start"
            endName="subscription_delivery_window_end"
            label="Delivery window"
            error={fieldErrors.subscription_delivery_window}
            hint="Window must be at least 30 minutes."
            required
          />

          <FormField
            name="subscription_meal_plan_name"
            label="Plan name"
            labelTrailing={
              <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                Optional
              </span>
            }
            placeholder="Vegetarian breakfast"
          />
          <FormField
            name="subscription_external_ref"
            label="Plan reference"
            labelTrailing={
              <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                Optional
              </span>
            }
            placeholder="PLAN-2026-Q2"
          />
          <FormField
            name="subscription_notes_internal"
            label="Internal notes"
            labelTrailing={
              <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                Optional
              </span>
            }
            placeholder="Subscription-specific context"
          />
        </fieldset>

        <div className="flex items-center justify-between gap-3 border-t border-stone-200 pt-8">
          <Link
            href="/consignees"
            className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:text-navy"
          >
            Cancel
          </Link>

          <div className="flex items-center gap-3">
            {displayedStep > 1 ? (
              <button
                type="button"
                onClick={() => {
                  setClientFieldErrors({});
                  setCurrentStep((s) => (s === 3 ? 2 : 1));
                }}
                disabled={isPending}
                className="rounded-sm border border-stone-200 bg-paper px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-navy transition-colors duration-[120ms] ease-out hover:border-navy disabled:cursor-not-allowed disabled:opacity-50"
              >
                Back
              </button>
            ) : null}
            {displayedStep < 3 ? (
              <button
                type="button"
                onClick={() => {
                  // Day-22 PM §3.22 — gate forward navigation on
                  // per-step client validation. Operators get inline
                  // errors immediately on Continue rather than after a
                  // server-action roundtrip at final submit.
                  const form = formRef.current;
                  if (!form) {
                    setCurrentStep((s) => (s === 1 ? 2 : 3));
                    return;
                  }
                  const result = validateStep(displayedStep as WizardStep, new FormData(form));
                  if (!result.ok) {
                    setClientFieldErrors(result.fieldErrors);
                    return;
                  }
                  setClientFieldErrors({});
                  setCurrentStep((s) => (s === 1 ? 2 : 3));
                }}
                disabled={isPending}
                className="rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Continue
              </button>
            ) : (
              <FormSubmitButton pending={isPending} pendingLabel="Onboarding…">
                Onboard consignee
              </FormSubmitButton>
            )}
          </div>
        </div>
      </form>
    </>
  );
}

function StepIndicator({ currentStep }: { currentStep: Step }) {
  const steps: ReadonlyArray<{ n: Step; label: string }> = [
    { n: 1, label: "Identity" },
    { n: 2, label: "Address" },
    { n: 3, label: "Subscription" },
  ];
  return (
    <ol className="mb-10 flex items-center gap-4 text-xs uppercase tracking-[0.14em]">
      {steps.map((s, idx) => {
        const isActive = s.n === currentStep;
        const isComplete = s.n < currentStep;
        return (
          <li key={s.n} className="flex items-center gap-3">
            <span
              className={
                isActive
                  ? "flex h-7 w-7 items-center justify-center rounded-full border border-navy bg-navy text-paper"
                  : isComplete
                    ? "flex h-7 w-7 items-center justify-center rounded-full border border-green bg-green text-paper"
                    : "flex h-7 w-7 items-center justify-center rounded-full border border-stone-200 text-[color:var(--color-text-tertiary)]"
              }
            >
              {s.n}
            </span>
            <span
              className={
                isActive
                  ? "text-navy"
                  : isComplete
                    ? "text-[color:var(--color-text-secondary)]"
                    : "text-[color:var(--color-text-tertiary)]"
              }
            >
              {s.label}
            </span>
            {idx < steps.length - 1 ? (
              <span className="ml-1 h-px w-6 bg-stone-200" aria-hidden="true" />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
