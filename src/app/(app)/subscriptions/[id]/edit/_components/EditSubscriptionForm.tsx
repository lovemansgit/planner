// Day 22 / Phase 1 forms lane — subscription edit form.
//
// Edit-only surface for the subscription scalar fields. Pause / Resume
// CTAs render alongside the form in PauseResumeActions.tsx; both
// surfaces live on the same page (/subscriptions/[id]/edit).

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";

import { FormError } from "@/components/forms/FormError";
import { FormField } from "@/components/forms/FormField";
import { FormSubmitButton } from "@/components/forms/FormSubmitButton";
import { TimeWindowPicker } from "@/components/forms/TimeWindowPicker";
import { WeekdaySelector, type Weekday } from "@/components/forms/WeekdaySelector";

import {
  editSubscriptionAction,
  type EditSubscriptionActionResult,
} from "../_actions";

interface EditSubscriptionFormProps {
  readonly subscriptionId: string;
  readonly defaults: {
    readonly startDate: string;
    readonly endDate: string | null;
    readonly daysOfWeek: ReadonlyArray<Weekday>;
    readonly deliveryWindowStart: string; // HH:MM
    readonly deliveryWindowEnd: string; // HH:MM
    readonly mealPlanName: string | null;
    readonly externalRef: string | null;
    readonly notesInternal: string | null;
  };
}

export function EditSubscriptionForm({
  subscriptionId,
  defaults,
}: EditSubscriptionFormProps) {
  const router = useRouter();
  const boundAction = editSubscriptionAction.bind(null, subscriptionId);
  const [actionResult, formAction, isPending] = useActionState<
    EditSubscriptionActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  useEffect(() => {
    if (actionResult.kind === "updated") {
      router.refresh();
    }
  }, [actionResult, router]);

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
      <FormError message={formError} className="mb-6" />

      {actionResult.kind === "updated" ? (
        <p
          role="status"
          className="mb-6 rounded-sm border border-green/40 bg-green/10 px-3 py-2 text-xs uppercase tracking-[0.14em] text-green"
        >
          Saved.
        </p>
      ) : null}

      <form action={formAction} className="space-y-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <FormField
            name="start_date"
            label="Start date"
            type="date"
            required
            defaultValue={defaults.startDate}
            error={fieldErrors.start_date}
          />
          <FormField
            name="end_date"
            label="End date"
            labelTrailing={
              <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                Optional
              </span>
            }
            type="date"
            defaultValue={defaults.endDate ?? ""}
            error={fieldErrors.end_date}
          />
        </div>

        <WeekdaySelector
          name="days_of_week"
          label="Delivery days"
          defaultSelected={defaults.daysOfWeek}
          error={fieldErrors.days_of_week}
        />

        <TimeWindowPicker
          startName="window_start"
          endName="window_end"
          label="Delivery window"
          defaultStart={defaults.deliveryWindowStart}
          defaultEnd={defaults.deliveryWindowEnd}
          error={fieldErrors.window}
          required
        />

        <FormField
          name="meal_plan_name"
          label="Plan name"
          labelTrailing={
            <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
              Optional
            </span>
          }
          defaultValue={defaults.mealPlanName ?? ""}
        />
        <FormField
          name="external_ref"
          label="Plan reference"
          labelTrailing={
            <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
              Optional
            </span>
          }
          defaultValue={defaults.externalRef ?? ""}
        />
        <FormField
          name="notes_internal"
          label="Internal notes"
          labelTrailing={
            <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
              Optional
            </span>
          }
          defaultValue={defaults.notesInternal ?? ""}
        />

        <div className="flex items-center justify-between gap-3 border-t border-stone-200 pt-8">
          <Link
            href="/subscriptions"
            className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:text-navy"
          >
            Cancel
          </Link>
          <FormSubmitButton pending={isPending} pendingLabel="Saving…">
            Save changes
          </FormSubmitButton>
        </div>
      </form>
    </>
  );
}
