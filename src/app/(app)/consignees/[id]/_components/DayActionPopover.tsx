// Click-into-day popover (client component).
//
// Day-17 PR #177 shipped action 1 (skip-default). Day-22 / PR-B
// extends to the full 7-action surface per brief §3.3.3 lines 500-508:
//   1. skip-default (existing)
//   2. skip-with-override (move-to-date / skip-without-append)
//   3. pause-from-this-date
//   4. change-address-one-off
//   5. change-address-forward
//   6. cancel-no-append (D1 ruling: reuses subscription:override_skip_rules)
//   7. add-note-to-driver
//   8. view-task-timeline (opens TaskTimelineDrawer)
//
// Architectural patterns:
// - Direct imports from sub-modules — NOT @/modules/<module> barrel
//   (Turbopack bundling discipline from PR #174 fix)
// - useActionState for server-action submissions
// - Click-outside + Escape close, 120ms transition timing
// - State-machine `mode` switches between menu + per-action panels
//
// Permission gating per brief §3.3.10 rule 1: HIDE action buttons the
// actor lacks the perm for. Status eligibility filters further (skip /
// pause / address / cancel / note are hidden for terminal statuses).
// View-timeline (action 8) is read-only — available in any state.
//
// Cut-off semantics live in the service layer; UI surfaces the
// resulting ValidationError as inline text inside the action panel.

"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";

import type { TaskInternalStatus, TaskOutboundSyncState } from "@/modules/tasks/types";
import type { ConsigneeAddressRow } from "@/modules/subscription-addresses";

import {
  addNoteToDriverAction,
  cancelNoAppendAction,
  changeAddressForwardAction,
  changeAddressOneOffAction,
  pauseFromDateAction,
  skipDeliveryAction,
  skipWithOverrideAction,
  type CalendarPopoverActionResult,
  type SkipDeliveryActionResult,
} from "../_calendar-actions";

import { AddressIndicator } from "./AddressIndicator";
import { TaskTimelineDrawer } from "./TaskTimelineDrawer";

// -----------------------------------------------------------------------------
// Props + types
// -----------------------------------------------------------------------------

export interface CalendarActionPermissions {
  readonly canSkip: boolean;
  readonly canSkipOverride: boolean;
  readonly canPause: boolean;
  readonly canChangeAddressOneOff: boolean;
  readonly canChangeAddressForward: boolean;
  readonly canAddNote: boolean;
  readonly canViewTimeline: boolean;
}

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
  readonly permissions: CalendarActionPermissions;
  /** Day-22 / PR-B — addresses for the change-address actions (4 + 5). */
  readonly availableAddresses: readonly ConsigneeAddressRow[];
  /** Day-20 §3.3.3 — Home/Office/Other label, rendered below status pill in day cell. */
  readonly addressLabel: "home" | "office" | "other" | null;
  /**
   * Day-29 §D(2) Phase-1 (plan-PR #302 §6.3): per-task outbound sync
   * lifecycle marker. Non-'synced' values surface a pending/failed
   * badge on the calendar trigger AND a "SuiteFleet sync" row inside
   * the open popover dialog. Honours the product-owner-locked UI
   * requirement: skip commits must NOT silently optimistic-success;
   * the operator sees the in-flight SF state.
   */
  readonly outboundSyncState: TaskOutboundSyncState;
  /**
   * Day-30 / Fix-A2 (Aqib UAT 2026-05-18): true iff this task has an
   * unresolved failed_pushes row visible to the operator (gated on
   * the new `failed_pushes:read` permission upstream). When true,
   * surface a "Failed push" badge so the merchant operator sees the
   * push-failure state instead of the local `internal_status`
   * ("Created"). False both when there is no failure AND when the
   * operator lacks the read permission — the badge omits silently.
   */
  readonly failedPush: boolean;
}

type PopoverMode =
  | "menu"
  | "skip"
  | "skip-override"
  | "pause"
  | "addr-one-off"
  | "addr-forward"
  | "cancel-no-append"
  | "add-note";

/**
 * Status states where mutation actions (skip / pause / address /
 * cancel / note) are operationally meaningful. SKIPPED + CANCELED +
 * DELIVERED + FAILED are terminal-ish; IN_TRANSIT is past cut-off.
 * CREATED + ASSIGNED + ON_HOLD are the eligible states.
 *
 * Note: view-timeline (action 8) is read-only — runs in ANY state,
 * including terminal ones. Gating happens at the button level.
 */
const MUTATION_ELIGIBLE_STATUSES: ReadonlySet<TaskInternalStatus> = new Set([
  "CREATED",
  "ASSIGNED",
  "ON_HOLD",
]);

interface ActionDescriptor {
  readonly mode: Exclude<PopoverMode, "menu">;
  readonly label: string;
  readonly description: string;
  readonly visible: boolean;
}

function buildActions(
  permissions: CalendarActionPermissions,
  subscriptionId: string | null,
  internalStatus: TaskInternalStatus,
): readonly ActionDescriptor[] {
  const mutationEligible =
    subscriptionId !== null && MUTATION_ELIGIBLE_STATUSES.has(internalStatus);
  // Action 6 (cancel-no-append) reuses subscription:override_skip_rules per D1.
  const canCancelNoAppend = permissions.canSkipOverride;
  return [
    {
      mode: "skip",
      label: "Skip this delivery",
      description: "Apply default skip rules with tail-end reinsertion.",
      visible: permissions.canSkip && mutationEligible,
    },
    {
      mode: "skip-override",
      label: "Skip with override",
      description: "Move the skip to a specific date or skip without tail-end append.",
      visible: permissions.canSkipOverride && mutationEligible,
    },
    {
      mode: "pause",
      label: "Pause from this date",
      description: "Cancel deliveries in a window; subscription end date extends.",
      visible: permissions.canPause && mutationEligible,
    },
    {
      mode: "addr-one-off",
      label: "Change address (this delivery only)",
      description: "Override the address for just this delivery.",
      visible: permissions.canChangeAddressOneOff && mutationEligible,
    },
    {
      mode: "addr-forward",
      label: "Change address (from this delivery onwards)",
      description: "Override the address from this date forward.",
      visible: permissions.canChangeAddressForward && mutationEligible,
    },
    {
      mode: "cancel-no-append",
      label: "Cancel delivery (no append)",
      description: "Cancel this delivery; subscription count reduces by one.",
      visible: canCancelNoAppend && mutationEligible,
    },
    {
      mode: "add-note",
      label: "Add note to driver",
      description: "Append a driver-facing instruction to this delivery.",
      visible: permissions.canAddNote && mutationEligible,
    },
  ];
}

// -----------------------------------------------------------------------------
// Inline result banner shared across action forms
// -----------------------------------------------------------------------------

function ResultBanner({
  result,
}: {
  readonly result: CalendarPopoverActionResult | SkipDeliveryActionResult | { kind: "idle" } | null;
}) {
  if (result === null || result.kind === "idle") return null;
  if (result.kind === "success" || result.kind === "idempotent_replay") return null;
  const message = "message" in result ? result.message : "";
  return (
    <p
      role="alert"
      className="mb-3 rounded-sm border border-red/40 bg-red/10 px-2 py-1.5 text-xs text-red"
    >
      {message}
    </p>
  );
}

// -----------------------------------------------------------------------------
// Action 1 — Skip default
// -----------------------------------------------------------------------------

function SkipDefaultPanel({
  consigneeId,
  subscriptionId,
  deliveryDate,
  onSuccess,
}: {
  readonly consigneeId: string;
  readonly subscriptionId: string;
  readonly deliveryDate: string;
  readonly onSuccess: () => void;
}) {
  const boundAction = skipDeliveryAction.bind(null, consigneeId, subscriptionId, deliveryDate);
  const [actionResult, formAction, isPending] = useActionState<
    SkipDeliveryActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  useEffect(() => {
    if (actionResult.kind === "success" || actionResult.kind === "idempotent_replay") {
      onSuccess();
    }
  }, [actionResult.kind, onSuccess]);

  return (
    <form action={formAction} className="mt-4">
      <p className="mb-3 text-xs text-[color:var(--color-text-secondary)]">
        Reinsert this delivery at the tail end of the subscription. The
        subscription end date will extend by one eligible day.
      </p>
      <ResultBanner result={actionResult} />
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

// -----------------------------------------------------------------------------
// Action 2 — Skip with override
// -----------------------------------------------------------------------------

function SkipOverridePanel({
  consigneeId,
  subscriptionId,
  deliveryDate,
  onSuccess,
}: {
  readonly consigneeId: string;
  readonly subscriptionId: string;
  readonly deliveryDate: string;
  readonly onSuccess: () => void;
}) {
  const boundAction = skipWithOverrideAction.bind(
    null,
    consigneeId,
    subscriptionId,
    deliveryDate,
  );
  const [actionResult, formAction, isPending] = useActionState<
    CalendarPopoverActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });
  const [overrideKind, setOverrideKind] = useState<"move_to_date" | "skip_without_append">(
    "move_to_date",
  );

  useEffect(() => {
    if (actionResult.kind === "success" || actionResult.kind === "idempotent_replay") {
      onSuccess();
    }
  }, [actionResult.kind, onSuccess]);

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Override
        </legend>
        <label className="flex items-start gap-2 text-xs text-navy">
          <input
            type="radio"
            name="override_kind"
            value="move_to_date"
            checked={overrideKind === "move_to_date"}
            onChange={() => setOverrideKind("move_to_date")}
            className="mt-0.5"
          />
          <span>Move this delivery to a specific date.</span>
        </label>
        <label className="flex items-start gap-2 text-xs text-navy">
          <input
            type="radio"
            name="override_kind"
            value="skip_without_append"
            checked={overrideKind === "skip_without_append"}
            onChange={() => setOverrideKind("skip_without_append")}
            className="mt-0.5"
          />
          <span>Skip without tail-end append (reduces subscription count).</span>
        </label>
      </fieldset>

      {overrideKind === "move_to_date" ? (
        <label className="block">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
            Target date
          </span>
          <input
            type="date"
            name="target_date_override"
            required
            className="mt-1 w-full rounded-sm border border-stone-200 bg-paper px-2 py-1.5 text-sm text-navy focus:border-navy focus:outline-none"
          />
        </label>
      ) : null}

      <ResultBanner result={actionResult} />
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Applying…" : "Apply override"}
      </button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Action 3 — Pause from this date
// -----------------------------------------------------------------------------

function PausePanel({
  consigneeId,
  subscriptionId,
  deliveryDate,
  onSuccess,
}: {
  readonly consigneeId: string;
  readonly subscriptionId: string;
  readonly deliveryDate: string;
  readonly onSuccess: () => void;
}) {
  const boundAction = pauseFromDateAction.bind(
    null,
    consigneeId,
    subscriptionId,
    deliveryDate,
  );
  const [actionResult, formAction, isPending] = useActionState<
    CalendarPopoverActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  useEffect(() => {
    if (actionResult.kind === "success" || actionResult.kind === "idempotent_replay") {
      onSuccess();
    }
  }, [actionResult.kind, onSuccess]);

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <p className="text-xs text-[color:var(--color-text-secondary)]">
        Pause window starts {deliveryDate}. Deliveries in the window will cancel; the subscription
        end date extends to compensate.
      </p>
      <label className="block">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Pause until
        </span>
        <input
          type="date"
          name="pause_end"
          required
          min={deliveryDate}
          className="mt-1 w-full rounded-sm border border-stone-200 bg-paper px-2 py-1.5 text-sm text-navy focus:border-navy focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Reason (optional)
        </span>
        <textarea
          name="reason"
          rows={2}
          maxLength={500}
          className="mt-1 w-full rounded-sm border border-stone-200 bg-paper px-2 py-1.5 text-sm text-navy focus:border-navy focus:outline-none"
        />
      </label>
      <ResultBanner result={actionResult} />
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Applying…" : "Apply pause"}
      </button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Actions 4 + 5 — Change address (one-off / forward)
// -----------------------------------------------------------------------------

function ChangeAddressPanel({
  consigneeId,
  subscriptionId,
  deliveryDate,
  scope,
  availableAddresses,
  onSuccess,
}: {
  readonly consigneeId: string;
  readonly subscriptionId: string;
  readonly deliveryDate: string;
  readonly scope: "one-off" | "forward";
  readonly availableAddresses: readonly ConsigneeAddressRow[];
  readonly onSuccess: () => void;
}) {
  const action = scope === "one-off" ? changeAddressOneOffAction : changeAddressForwardAction;
  const boundAction = action.bind(null, consigneeId, subscriptionId, deliveryDate);
  const [actionResult, formAction, isPending] = useActionState<
    CalendarPopoverActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  useEffect(() => {
    if (actionResult.kind === "success" || actionResult.kind === "idempotent_replay") {
      onSuccess();
    }
  }, [actionResult.kind, onSuccess]);

  if (availableAddresses.length === 0) {
    return (
      <p className="mt-4 text-xs text-[color:var(--color-text-secondary)]">
        No alternative addresses on file. Add a second address from the consignee form first.
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <fieldset className="space-y-2">
        <legend className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Address
        </legend>
        {availableAddresses.map((addr) => (
          <label
            key={addr.id}
            className="flex items-start gap-2 rounded-sm border border-stone-200 bg-paper px-3 py-2 text-xs text-navy transition-colors duration-[120ms] ease-out hover:border-navy"
          >
            <input
              type="radio"
              name="address_override_id"
              value={addr.id}
              required
              className="mt-0.5"
            />
            <span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.1em] text-[color:var(--color-text-tertiary)]">
                {addr.label}
                {addr.isPrimary ? " · primary" : ""}
              </span>
              <span className="block">
                {addr.line}, {addr.district}
              </span>
            </span>
          </label>
        ))}
      </fieldset>
      <ResultBanner result={actionResult} />
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending
          ? "Saving…"
          : scope === "one-off"
            ? "Override for this delivery"
            : "Override from this date forward"}
      </button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Action 6 — Cancel delivery (no append)
// -----------------------------------------------------------------------------

function CancelNoAppendPanel({
  consigneeId,
  subscriptionId,
  deliveryDate,
  onSuccess,
}: {
  readonly consigneeId: string;
  readonly subscriptionId: string;
  readonly deliveryDate: string;
  readonly onSuccess: () => void;
}) {
  const boundAction = cancelNoAppendAction.bind(
    null,
    consigneeId,
    subscriptionId,
    deliveryDate,
  );
  const [actionResult, formAction, isPending] = useActionState<
    CalendarPopoverActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  useEffect(() => {
    if (actionResult.kind === "success" || actionResult.kind === "idempotent_replay") {
      onSuccess();
    }
  }, [actionResult.kind, onSuccess]);

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <p className="text-xs text-[color:var(--color-text-secondary)]">
        This delivery will be skipped without a tail-end compensating insert. The total subscription
        count drops by one. The end date does not move.
      </p>
      <ResultBanner result={actionResult} />
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-sm border border-red bg-red px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Cancelling…" : "Cancel delivery"}
      </button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// Action 7 — Add note to driver
// -----------------------------------------------------------------------------

function AddNotePanel({
  consigneeId,
  taskId,
  onSuccess,
}: {
  readonly consigneeId: string;
  readonly taskId: string;
  readonly onSuccess: () => void;
}) {
  const boundAction = addNoteToDriverAction.bind(null, consigneeId, taskId);
  const [actionResult, formAction, isPending] = useActionState<
    CalendarPopoverActionResult | { readonly kind: "idle" },
    FormData
  >(boundAction, { kind: "idle" });

  useEffect(() => {
    if (actionResult.kind === "success" || actionResult.kind === "idempotent_replay") {
      onSuccess();
    }
  }, [actionResult.kind, onSuccess]);

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <label className="block">
        <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
          Note for driver
        </span>
        <textarea
          name="note"
          rows={3}
          required
          maxLength={1000}
          placeholder="e.g. gate code 4521; call on arrival"
          className="mt-1 w-full rounded-sm border border-stone-200 bg-paper px-2 py-1.5 text-sm text-navy focus:border-navy focus:outline-none"
        />
      </label>
      <ResultBanner result={actionResult} />
      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-sm border border-green bg-green px-4 py-2 text-xs font-medium uppercase tracking-[0.1em] text-paper transition-opacity duration-[120ms] ease-out hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save note"}
      </button>
    </form>
  );
}

// -----------------------------------------------------------------------------
// DayActionPopover (default export — wires everything together)
// -----------------------------------------------------------------------------

/**
 * Day-29 §D(2) Phase-1 — copy + classes for the outbound_sync_state
 * UI badge. Returns null for 'synced' (no badge rendered). Plain stone
 * palette per the existing AddressIndicator pattern; pending uses the
 * stone-100 fill, failed uses the warning-tinted fill.
 */
function outboundSyncStateBadge(
  state: TaskOutboundSyncState,
): { readonly label: string; readonly classes: string } | null {
  switch (state) {
    case "pending_cancel":
      return {
        label: "SF cancel pending",
        classes: "bg-stone-100 text-stone-700",
      };
    case "pending_reschedule":
      // Phase 2 — defensive render; Phase 1 code does not write this state.
      return {
        label: "SF reschedule pending",
        classes: "bg-stone-100 text-stone-700",
      };
    case "failed":
      return {
        label: "SF sync failed — see ops",
        classes: "bg-amber-50 text-amber-900",
      };
    case "synced":
      return null;
  }
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
  permissions,
  availableAddresses,
  addressLabel,
  outboundSyncState,
  failedPush,
}: DayActionPopoverProps) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PopoverMode>("menu");
  const [timelineOpen, setTimelineOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  function openPopover() {
    setOpen(true);
    setMode("menu");
  }
  function closePopover() {
    setOpen(false);
    setMode("menu");
  }

  // Click-outside close (mousedown-based; matches UserMenu pattern).
  // Disabled when timeline drawer is open (drawer owns dismissal).
  useEffect(() => {
    if (!open || timelineOpen) return;
    function handleMousedown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", handleMousedown);
    return () => document.removeEventListener("mousedown", handleMousedown);
  }, [open, timelineOpen]);

  // Escape close.
  useEffect(() => {
    if (!open || timelineOpen) return;
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [open, timelineOpen]);

  const actions = useMemo(
    () => buildActions(permissions, subscriptionId, internalStatus),
    [permissions, subscriptionId, internalStatus],
  );
  const visibleActions = actions.filter((a) => a.visible);
  const showTimelineButton = permissions.canViewTimeline;

  // Day-22 / PR-B fix-up — empty-state diagnostic discrimination. Mirrors
  // the same boolean derived inside buildActions; duplicated here to keep
  // the empty-state copy keyed on root cause without changing buildActions'
  // signature. `hasAnyMutationPerm` is the OR of every permission flag that
  // can light a menu action (canSkipOverride covers both action 2 and the
  // D1-reused action 6 cancel-no-append).
  const mutationEligible =
    subscriptionId !== null && MUTATION_ELIGIBLE_STATUSES.has(internalStatus);
  const hasAnyMutationPerm =
    permissions.canSkip ||
    permissions.canSkipOverride ||
    permissions.canPause ||
    permissions.canChangeAddressOneOff ||
    permissions.canChangeAddressForward ||
    permissions.canAddNote;

  // Time window (HH:MM-HH:MM). Slice to mm precision; deliveryStartTime
  // arrives as HH:MM:SS from postgres-js.
  const timeWindow = `${deliveryStartTime.slice(0, 5)}–${deliveryEndTime.slice(0, 5)}`;

  // Day-29 §D(2) Phase-1 — outbound sync state badge derivation. null
  // when 'synced'; explicit copy + classes for pending / failed.
  const syncBadge = outboundSyncStateBadge(outboundSyncState);

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
        <AddressIndicator label={addressLabel} />
        {syncBadge !== null ? (
          <span
            className={`mt-0.5 block truncate rounded-sm px-1 py-px text-[8px] font-medium uppercase tracking-[0.08em] ${syncBadge.classes}`}
          >
            {syncBadge.label}
          </span>
        ) : null}
        {/*
          Day-30 / Fix-A2 — "Failed push" badge. Distinct from the
          outboundSyncState badge (which tracks operator-initiated
          cancel/reschedule lifecycle): this badge tracks the cron's
          INITIAL createTask push failure, surfaced from the
          failed_pushes DLQ via the parent's failedPushTaskIds set.
          Same warning palette as 'failed' outbound-sync.
        */}
        {failedPush ? (
          <span
            className="mt-0.5 block truncate rounded-sm bg-amber-50 px-1 py-px text-[8px] font-medium uppercase tracking-[0.08em] text-amber-900"
          >
            Failed push — see ops
          </span>
        ) : null}
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
            <h2 className="mt-1 font-display text-lg font-semibold text-navy">{deliveryDate}</h2>

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
              {syncBadge !== null ? (
                <div className="flex items-center justify-between">
                  <dt className="text-[color:var(--color-text-secondary)]">SuiteFleet sync</dt>
                  <dd>
                    <span
                      className={`inline-flex items-center rounded-sm px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] ${syncBadge.classes}`}
                    >
                      {syncBadge.label}
                    </span>
                  </dd>
                </div>
              ) : null}
              {/*
                Day-30 / Fix-A2 — "Failed push" row inside the open
                popover dialog. Mirrors the trigger-side badge above
                but in dl form. Same warning palette as the SuiteFleet
                sync 'failed' state.
              */}
              {failedPush ? (
                <div className="flex items-center justify-between">
                  <dt className="text-[color:var(--color-text-secondary)]">SuiteFleet push</dt>
                  <dd>
                    <span className="inline-flex items-center rounded-sm bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-amber-900">
                      Failed — see ops
                    </span>
                  </dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between">
                <dt className="text-[color:var(--color-text-secondary)]">Task ID</dt>
                <dd className="font-mono text-xs text-[color:var(--color-text-tertiary)]">
                  {taskId.slice(0, 8)}
                </dd>
              </div>
            </dl>

            {mode === "menu" ? (
              <div className="mt-5 space-y-2">
                {visibleActions.length === 0 ? (
                  <p className="text-xs text-[color:var(--color-text-secondary)]">
                    {!mutationEligible
                      ? showTimelineButton
                        ? "This delivery is past the action window or already complete. View task timeline below for full history."
                        : "This delivery is past the action window or already complete."
                      : !hasAnyMutationPerm
                        ? "Your role does not include calendar mutation permissions. Contact your ops manager if you need access."
                        : null}
                  </p>
                ) : null}
                {visibleActions.map((action) => (
                  <button
                    key={action.mode}
                    type="button"
                    onClick={() => setMode(action.mode)}
                    className="block w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-left transition-colors duration-[120ms] ease-out hover:border-navy"
                  >
                    <span className="block text-xs font-medium text-navy">{action.label}</span>
                    <span className="mt-0.5 block text-[10px] text-[color:var(--color-text-secondary)]">
                      {action.description}
                    </span>
                  </button>
                ))}
                {showTimelineButton ? (
                  <button
                    type="button"
                    onClick={() => setTimelineOpen(true)}
                    className="block w-full rounded-sm border border-stone-200 bg-paper px-3 py-2 text-left transition-colors duration-[120ms] ease-out hover:border-navy"
                  >
                    <span className="block text-xs font-medium text-navy">View task timeline</span>
                    <span className="mt-0.5 block text-[10px] text-[color:var(--color-text-secondary)]">
                      Full state-transition history sourced from cached webhooks.
                    </span>
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setMode("menu")}
                  className="mt-5 text-[10px] uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] transition-opacity duration-[120ms] ease-out hover:text-navy"
                >
                  ← Back to actions
                </button>

                {mode === "skip" && subscriptionId !== null ? (
                  <SkipDefaultPanel
                    consigneeId={consigneeId}
                    subscriptionId={subscriptionId}
                    deliveryDate={deliveryDate}
                    onSuccess={closePopover}
                  />
                ) : null}
                {mode === "skip-override" && subscriptionId !== null ? (
                  <SkipOverridePanel
                    consigneeId={consigneeId}
                    subscriptionId={subscriptionId}
                    deliveryDate={deliveryDate}
                    onSuccess={closePopover}
                  />
                ) : null}
                {mode === "pause" && subscriptionId !== null ? (
                  <PausePanel
                    consigneeId={consigneeId}
                    subscriptionId={subscriptionId}
                    deliveryDate={deliveryDate}
                    onSuccess={closePopover}
                  />
                ) : null}
                {mode === "addr-one-off" && subscriptionId !== null ? (
                  <ChangeAddressPanel
                    consigneeId={consigneeId}
                    subscriptionId={subscriptionId}
                    deliveryDate={deliveryDate}
                    scope="one-off"
                    availableAddresses={availableAddresses}
                    onSuccess={closePopover}
                  />
                ) : null}
                {mode === "addr-forward" && subscriptionId !== null ? (
                  <ChangeAddressPanel
                    consigneeId={consigneeId}
                    subscriptionId={subscriptionId}
                    deliveryDate={deliveryDate}
                    scope="forward"
                    availableAddresses={availableAddresses}
                    onSuccess={closePopover}
                  />
                ) : null}
                {mode === "cancel-no-append" && subscriptionId !== null ? (
                  <CancelNoAppendPanel
                    consigneeId={consigneeId}
                    subscriptionId={subscriptionId}
                    deliveryDate={deliveryDate}
                    onSuccess={closePopover}
                  />
                ) : null}
                {mode === "add-note" ? (
                  <AddNotePanel
                    consigneeId={consigneeId}
                    taskId={taskId}
                    onSuccess={closePopover}
                  />
                ) : null}
              </>
            )}

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={closePopover}
                className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] transition-opacity duration-[120ms] ease-out hover:text-navy"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {timelineOpen ? (
        <TaskTimelineDrawer
          consigneeId={consigneeId}
          taskId={taskId}
          deliveryDate={deliveryDate}
          onClose={() => setTimelineOpen(false)}
        />
      ) : null}
    </>
  );
}
