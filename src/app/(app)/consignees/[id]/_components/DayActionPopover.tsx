// Day 17 / Session A — click-into-day popover (client component).
//
// Third React client component in the codebase (after UserMenu in
// PR #168 and CrmStateModal in PR #174). Same architectural patterns:
// - Direct imports from sub-modules — NOT @/modules/<module> barrel
//   (Turbopack bundling discipline from PR #174 fix)
// - useActionState for server-action submissions
// - Click-outside + Escape close, 120ms transition timing
// - Action result drives modal state via key-based form remount
//   (avoids setState-in-effect lint rule)
//
// SCOPE-LOCKED per Day-17 reviewer ruling: ONLY the Skip-default
// action is wired in this PR. The popover layout reserves visual
// space for the other 6 actions (target_date_override, skip-without-
// append, pause, address one-off, address forward, cancel) — those
// ship in follow-up PRs per
// `memory/followup_calendar_popover_action_expansion.md`.
//
// Permission gate per brief §3.3.10 rule 1: HIDE Skip button if
// actor lacks subscription:skip. Visible-but-disabled would read
// as broken; hidden reads as "not available".
//
// Status eligibility: Skip is hidden for terminal statuses
// (DELIVERED, FAILED, CANCELED, SKIPPED) — those tasks can't be
// skipped a second time. Surfaces as "Action not available" message
// when no actions are visible.

"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import type { TaskInternalStatus } from "@/modules/tasks/types";

import {
  skipDeliveryAction,
  type SkipDeliveryActionResult,
} from "../_calendar-actions";

interface DayActionPopoverProps {
  readonly consigneeId: string;
  readonly subscriptionId: string | null;
  readonly taskId: string;
  readonly deliveryDate: string;
  readonly deliveryStartTime: string;
  readonly deliveryEndTime: string;
  readonly internalStatus: TaskInternalStatus;
  readonly statusLabel: string;
  readonly statusClasses: string;
  readonly canSkip: boolean;
}

interface PopoverFormProps {
  readonly consigneeId: string;
  readonly subscriptionId: string;
  readonly taskId: string;
  readonly deliveryDate: string;
  readonly onSuccess: () => void;
}

/**
 * Status states where Skip-default is operationally meaningful.
 * SKIPPED + CANCELED already terminal-ish; DELIVERED / FAILED past;
 * IN_TRANSIT past the cutoff per brief §3.1.8. CREATED + ASSIGNED +
 * ON_HOLD are the eligible states.
 */
const SKIP_ELIGIBLE_STATUSES: ReadonlySet<TaskInternalStatus> = new Set([
  "CREATED",
  "ASSIGNED",
  "ON_HOLD",
]);

function PopoverForm({
  consigneeId,
  subscriptionId,
  taskId: _taskId,
  deliveryDate,
  onSuccess,
}: PopoverFormProps) {
  // Bind consigneeId + subscriptionId + deliveryDate; useActionState
  // contract handles prevState + formData. taskId not currently used
  // by the action (skip operates on the subscription + date) but
  // accepted in the prop shape for future per-task actions.
  const boundAction = skipDeliveryAction.bind(
    null,
    consigneeId,
    subscriptionId,
    deliveryDate,
  );
  const [actionResult, formAction, isPending] = useActionState<
    SkipDeliveryActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  useEffect(() => {
    if (actionResult.kind === "success" || actionResult.kind === "idempotent_replay") {
      onSuccess();
    }
  }, [actionResult.kind, onSuccess]);

  const errorMessage =
    actionResult.kind === "conflict" ||
    actionResult.kind === "validation" ||
    actionResult.kind === "forbidden" ||
    actionResult.kind === "not_found"
      ? actionResult.message
      : null;

  return (
    <form action={formAction} className="mt-4">
      <p className="mb-3 text-xs text-[color:var(--color-text-secondary)]">
        Reinsert this delivery at the tail end of the subscription. The
        subscription end date will extend by one eligible day.
      </p>
      {errorMessage ? (
        <p
          role="alert"
          className="mb-3 rounded-sm border border-red/40 bg-red/10 px-2 py-1.5 text-xs text-red"
        >
          {errorMessage}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Skipping…" : "Skip delivery"}
      </button>
    </form>
  );
}

export function DayActionPopover({
  consigneeId,
  subscriptionId,
  taskId,
  deliveryDate,
  deliveryStartTime,
  deliveryEndTime,
  internalStatus,
  statusLabel,
  statusClasses,
  canSkip,
}: DayActionPopoverProps) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function openPopover() {
    setOpen(true);
    setFormKey((k) => k + 1);
  }
  function closePopover() {
    setOpen(false);
  }

  // Click-outside close (mousedown-based; matches UserMenu pattern).
  useEffect(() => {
    if (!open) return;
    function handleMousedown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleMousedown);
    return () => document.removeEventListener("mousedown", handleMousedown);
  }, [open]);

  // Escape close.
  useEffect(() => {
    if (!open) return;
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [open]);

  const skipAvailable =
    canSkip &&
    subscriptionId !== null &&
    SKIP_ELIGIBLE_STATUSES.has(internalStatus);

  // Time window (HH:MM-HH:MM). Slice to mm precision; deliveryStartTime
  // arrives as HH:MM:SS from postgres-js.
  const timeWindow = `${deliveryStartTime.slice(0, 5)}–${deliveryEndTime.slice(0, 5)}`;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openPopover}
        className={`block w-full rounded-sm px-1.5 py-1 text-left text-[10px] font-medium uppercase tracking-[0.1em] transition-opacity duration-[120ms] ease-out hover:opacity-80 ${statusClasses}`}
      >
        <span className="block truncate">{statusLabel}</span>
        <span className="block tabular-nums opacity-70">{timeWindow}</span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Delivery on ${deliveryDate}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/20 p-4"
        >
          <div
            ref={panelRef}
            className="w-full max-w-sm rounded-sm border border-stone-200 border-t-[1px] border-t-green bg-surface-primary p-6"
          >
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
              Delivery
            </p>
            <h2 className="mt-1 font-display text-lg font-semibold text-navy">
              {deliveryDate}
            </h2>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-[color:var(--color-text-secondary)]">Status</dt>
                <dd>
                  <span
                    className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${statusClasses}`}
                  >
                    {statusLabel}
                  </span>
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[color:var(--color-text-secondary)]">Window</dt>
                <dd className="tabular-nums text-navy">{timeWindow}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-[color:var(--color-text-secondary)]">Task ID</dt>
                <dd className="font-mono text-xs text-[color:var(--color-text-tertiary)]">
                  {taskId.slice(0, 8)}
                </dd>
              </div>
            </dl>

            {skipAvailable ? (
              <PopoverForm
                key={formKey}
                consigneeId={consigneeId}
                subscriptionId={subscriptionId}
                taskId={taskId}
                deliveryDate={deliveryDate}
                onSuccess={closePopover}
              />
            ) : (
              <p className="mt-4 text-xs text-[color:var(--color-text-secondary)]">
                {canSkip
                  ? "No actions available for this delivery state."
                  : "You don't have permission to modify this delivery."}
              </p>
            )}

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={closePopover}
                className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] hover:text-navy"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
