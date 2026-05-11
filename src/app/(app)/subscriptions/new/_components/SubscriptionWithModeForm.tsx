// Day 22 / Phase 1 forms lane — /subscriptions/new mode-aware form.
//
// Mode toggle per Day-19 §J-4:
//   - "Subscription" → recurring delivery rule (createSubscription).
//   - "Single ad-hoc task" → 1+ one-off tasks (createTask, looped).
//
// Same URL in both modes (/subscriptions/new). H1 shifts client-side
// to "New ad-hoc task" when single-task is selected per §J-4.
//
// Cadence preset chips per OQ-2 ruling — sentence-case three-letter
// labels. Picking a chip remounts the WeekdaySelector with new
// defaults (key={cadenceKey}). Operator can edit the WeekdaySelector
// freely after a chip pick; the chip row reflects the resulting state
// via detectPreset.
//
// SubscriptionPreviewCard renders the hero numeral live as the
// operator edits dates / weekdays / mode.

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useMemo, useState } from "react";

import { FormError } from "@/components/forms/FormError";
import { FormField } from "@/components/forms/FormField";
import { FormSubmitButton } from "@/components/forms/FormSubmitButton";
import { TimeWindowPicker } from "@/components/forms/TimeWindowPicker";
import {
  WeekdaySelector,
  weekdaysToIsoOrdinals,
  type Weekday,
} from "@/components/forms/WeekdaySelector";

import {
  createSubscriptionFormAction,
  type CreateSubscriptionFormResult,
} from "../_actions";
import {
  CADENCE_PRESETS,
  detectPreset,
  type SubscriptionFormMode,
} from "../_helpers";
import { SubscriptionPreviewCard } from "./SubscriptionPreviewCard";

type Mode = SubscriptionFormMode;

interface ConsigneeOption {
  readonly id: string;
  readonly name: string;
}

interface SubscriptionWithModeFormProps {
  readonly consignees: ReadonlyArray<ConsigneeOption>;
  readonly preselectedConsigneeId: string | null;
  readonly initialMode?: Mode;
}

const TODAY_ISO = new Date().toISOString().slice(0, 10);

export function SubscriptionWithModeForm({
  consignees,
  preselectedConsigneeId,
  initialMode = "subscription",
}: SubscriptionWithModeFormProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [cadenceKey, setCadenceKey] = useState<string>("mon-fri");
  const [selectedWeekdays, setSelectedWeekdays] = useState<ReadonlyArray<Weekday>>(
    CADENCE_PRESETS[0].weekdays,
  );
  const [startDate, setStartDate] = useState<string>(TODAY_ISO);
  const [endDate, setEndDate] = useState<string>("");
  const [isRange, setIsRange] = useState<boolean>(false);

  const [actionResult, formAction, isPending] = useActionState<
    CreateSubscriptionFormResult | { readonly kind: "idle" },
    FormData
  >(createSubscriptionFormAction, { kind: "idle" });

  // Navigate on success.
  useEffect(() => {
    if (actionResult.kind === "subscription_created") {
      router.push(`/consignees/${actionResult.consigneeId}`);
    } else if (actionResult.kind === "single_task_created") {
      router.push(`/tasks?consignee=${actionResult.consigneeId}`);
    }
  }, [actionResult, router]);

  const fieldErrors = useMemo(
    () =>
      actionResult.kind === "validation" ? actionResult.fieldErrors : {},
    [actionResult],
  );
  const formError = useMemo(() => {
    if (actionResult.kind === "conflict") return actionResult.message;
    if (actionResult.kind === "forbidden") return actionResult.message;
    if (actionResult.kind === "not_found") return actionResult.message;
    if (actionResult.kind === "internal_error") return actionResult.message;
    if (actionResult.kind === "validation" && fieldErrors._form) return fieldErrors._form;
    if (actionResult.kind === "partial_single_task") {
      return `Created ${actionResult.createdTaskIds.length} of intended tasks before failing on ${actionResult.failedDate}: ${actionResult.message}`;
    }
    return null;
  }, [actionResult, fieldErrors]);

  const isoWeekdaysForPreview = useMemo(
    () => new Set(weekdaysToIsoOrdinals(selectedWeekdays)),
    [selectedWeekdays],
  );

  const detectedPreset = detectPreset(new Set(selectedWeekdays));
  const previewEndDate = isRange && endDate.length > 0 ? endDate : null;

  // Mode-conditional page header per Day-19 §J-4 ruling. The H1 +
  // breadcrumb eyebrow + subtitle all shift when the operator picks
  // single-task mode, so the URL stays at /subscriptions/new while the
  // surface reads as a different operation.
  const eyebrowText = mode === "subscription" ? "Subscriptions" : "Tasks";
  const h1Text = mode === "subscription" ? "New subscription" : "New ad-hoc task";
  const subtitleText =
    mode === "subscription"
      ? "Recurring delivery rule for an existing consignee."
      : "One-off ad-hoc tasks for an existing consignee.";

  return (
    <>
      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
          {eyebrowText}
        </p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-tight">{h1Text}</h1>
        <p className="mt-3 max-w-prose text-sm text-[color:var(--color-text-secondary)]">
          {subtitleText}
        </p>
      </header>

      <ModeToggle mode={mode} onChange={setMode} />

      <FormError message={formError} className="mt-6" />

      <form action={formAction} className="mt-8 space-y-8">
        <input type="hidden" name="mode" value={mode} />
        {mode === "single-task" ? (
          <input type="hidden" name="is_range" value={isRange ? "on" : "off"} />
        ) : null}

        {/* Consignee picker — both modes */}
        <div>
          <label
            htmlFor="consignee_id"
            className="mb-1 block text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]"
          >
            Consignee
          </label>
          <select
            id="consignee_id"
            name="consignee_id"
            required
            defaultValue={preselectedConsigneeId ?? ""}
            aria-invalid={fieldErrors.consignee_id ? "true" : undefined}
            className="w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-sm text-navy transition-colors duration-[120ms] ease-out focus:border-navy focus:outline-none aria-[invalid=true]:border-red"
          >
            <option value="" disabled>
              Pick a consignee
            </option>
            {consignees.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {fieldErrors.consignee_id ? (
            <p role="alert" className="mt-1 text-xs text-red">
              {fieldErrors.consignee_id}
            </p>
          ) : null}
        </div>

        {/* Subscription mode — cadence + dates + window + plan */}
        {mode === "subscription" ? (
          <>
            <fieldset className="space-y-6 border-t border-stone-200 pt-6">
              <legend className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
                Cadence
              </legend>

              <div className="flex flex-wrap gap-2">
                {CADENCE_PRESETS.map((preset) => {
                  const isActive = detectedPreset === preset.key;
                  return (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => {
                        setCadenceKey(preset.key);
                        setSelectedWeekdays(preset.weekdays);
                      }}
                      className={
                        isActive
                          ? "rounded-sm border border-navy bg-navy px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-paper transition-colors duration-[120ms] ease-out"
                          : "rounded-sm border border-stone-200 bg-paper px-3 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-navy transition-colors duration-[120ms] ease-out hover:border-navy"
                      }
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>

              {/* WeekdaySelector with controlled re-mount on cadence pick */}
              <div
                key={cadenceKey}
                onClick={(e) => {
                  // Capture clicks on the underlying weekday checkboxes
                  // to update local state for the live preview. The
                  // form still submits via FormData on its own.
                  if (e.target instanceof HTMLInputElement) {
                    const all = (e.currentTarget.querySelectorAll(
                      'input[type="checkbox"]',
                    ) as NodeListOf<HTMLInputElement>);
                    const next: Weekday[] = [];
                    all.forEach((el) => {
                      if (el.checked) next.push(el.value as Weekday);
                    });
                    setSelectedWeekdays(next);
                  }
                }}
              >
                <WeekdaySelector
                  name="days_of_week"
                  defaultSelected={selectedWeekdays}
                  error={fieldErrors.days_of_week}
                />
              </div>
            </fieldset>

            <fieldset className="space-y-6 border-t border-stone-200 pt-6">
              <legend className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
                Window
              </legend>
              <div className="grid gap-6 sm:grid-cols-2">
                <FormField
                  name="start_date"
                  label="Start date"
                  type="date"
                  required
                  defaultValue={startDate}
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
                  hint="Leave empty for an open-ended subscription."
                  defaultValue={endDate}
                  error={fieldErrors.end_date}
                />
              </div>
              {/* Native date input doesn't bubble React onChange on
                  defaultValue path; mirror via a hidden change listener
                  on the form root via the parent wrapper below. */}
              <DateChangeListener
                onStart={setStartDate}
                onEnd={setEndDate}
              />
              <TimeWindowPicker
                startName="window_start"
                endName="window_end"
                label="Delivery window"
                error={fieldErrors.window}
                required
                hint="Window must be at least 30 minutes."
              />
            </fieldset>

            <fieldset className="space-y-6 border-t border-stone-200 pt-6">
              <legend className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
                Plan details
              </legend>
              <FormField
                name="meal_plan_name"
                label="Plan name"
                labelTrailing={
                  <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                    Optional
                  </span>
                }
                placeholder="Vegetarian breakfast"
              />
              <FormField
                name="external_ref"
                label="Plan reference"
                labelTrailing={
                  <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                    Optional
                  </span>
                }
                placeholder="PLAN-2026-Q2"
              />
              <FormField
                name="notes_internal"
                label="Internal notes"
                labelTrailing={
                  <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                    Optional
                  </span>
                }
              />
            </fieldset>
          </>
        ) : null}

        {/* Single-task mode — date or date-range + window + notes */}
        {mode === "single-task" ? (
          <>
            <fieldset className="space-y-6 border-t border-stone-200 pt-6">
              <legend className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
                Schedule
              </legend>

              <label className="inline-flex items-center gap-2 text-sm text-navy">
                <input
                  type="checkbox"
                  checked={isRange}
                  onChange={(e) => setIsRange(e.target.checked)}
                  className="h-4 w-4 border-stone-200"
                />
                Schedule across a date range (one task per day)
              </label>

              <div className="grid gap-6 sm:grid-cols-2">
                <FormField
                  name="start_date"
                  label={isRange ? "From" : "Delivery date"}
                  type="date"
                  required
                  defaultValue={startDate}
                  error={fieldErrors.start_date}
                />
                {isRange ? (
                  <FormField
                    name="end_date"
                    label="Until"
                    type="date"
                    required
                    defaultValue={endDate}
                    error={fieldErrors.end_date}
                  />
                ) : null}
              </div>

              <DateChangeListener
                onStart={setStartDate}
                onEnd={setEndDate}
              />

              <TimeWindowPicker
                startName="window_start"
                endName="window_end"
                label="Delivery window"
                error={fieldErrors.window}
                required
                hint="Window must be at least 30 minutes."
              />
            </fieldset>

            <fieldset className="space-y-6 border-t border-stone-200 pt-6">
              <legend className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)]">
                Order details
              </legend>
              <FormField
                name="customer_order_number"
                label="Customer order number prefix"
                labelTrailing={
                  <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                    Optional
                  </span>
                }
                hint="Auto-generated if left empty (AD-HOC-{date}-{uuid8})."
              />
              <FormField
                name="notes"
                label="Notes"
                labelTrailing={
                  <span className="text-[10px] uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
                    Optional
                  </span>
                }
                placeholder="Driver-visible note attached to the task"
              />
            </fieldset>
          </>
        ) : null}

        {/* Live preview */}
        <SubscriptionPreviewCard
          mode={mode}
          startDate={startDate}
          endDate={mode === "subscription" ? (endDate.length > 0 ? endDate : null) : previewEndDate}
          isoWeekdays={mode === "subscription" ? isoWeekdaysForPreview : undefined}
        />

        <div className="flex items-center justify-between gap-3 border-t border-stone-200 pt-8">
          <Link
            href="/subscriptions"
            className="text-xs uppercase tracking-[0.14em] text-[color:var(--color-text-secondary)] transition-colors duration-[120ms] ease-out hover:text-navy"
          >
            Cancel
          </Link>
          <FormSubmitButton
            pending={isPending}
            pendingLabel={mode === "subscription" ? "Creating subscription…" : "Creating tasks…"}
          >
            {mode === "subscription" ? "Create subscription" : "Create tasks"}
          </FormSubmitButton>
        </div>
      </form>
    </>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  readonly mode: Mode;
  readonly onChange: (m: Mode) => void;
}) {
  return (
    <fieldset className="rounded-sm border border-stone-200 p-2">
      <legend className="sr-only">Form mode</legend>
      <div role="radiogroup" className="flex gap-1">
        {(["subscription", "single-task"] as const).map((m) => {
          const isActive = mode === m;
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(m)}
              className={
                isActive
                  ? "flex-1 rounded-sm bg-navy px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-paper transition-colors duration-[120ms] ease-out"
                  : "flex-1 rounded-sm bg-paper px-4 py-2 text-xs font-medium uppercase tracking-[0.14em] text-navy transition-colors duration-[120ms] ease-out hover:bg-ivory"
              }
            >
              {m === "subscription" ? "Recurring subscription" : "Single ad-hoc task"}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Mirrors the date-input values into React state so the live preview
 * stays in sync. Uncontrolled inputs don't fire React onChange on the
 * defaultValue path, so we attach a delegated change listener via
 * useEffect on document. Scoped to the parent form via closest('form').
 */
function DateChangeListener({
  onStart,
  onEnd,
}: {
  readonly onStart: (v: string) => void;
  readonly onEnd: (v: string) => void;
}) {
  useEffect(() => {
    const handler = (ev: Event) => {
      const target = ev.target as HTMLInputElement | null;
      if (!target || target.type !== "date") return;
      if (target.name === "start_date") onStart(target.value);
      else if (target.name === "end_date") onEnd(target.value);
    };
    document.addEventListener("change", handler);
    return () => document.removeEventListener("change", handler);
  }, [onStart, onEnd]);
  return null;
}
