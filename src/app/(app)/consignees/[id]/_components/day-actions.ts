// Calendar day-popover — action model.
//
// Extracted from DayActionPopover.tsx so the action set + #430 grouping is
// unit-testable in node (the component itself pulls a client/server graph
// that isn't node-loadable). Pure data + a builder; no React, no I/O.

import type { TaskInternalStatus } from "@/modules/tasks";

export interface CalendarActionPermissions {
  readonly canSkip: boolean;
  readonly canSkipOverride: boolean;
  readonly canPause: boolean;
  readonly canChangeAddressOneOff: boolean;
  readonly canChangeAddressForward: boolean;
  readonly canAddNote: boolean;
  readonly canViewTimeline: boolean;
}

/** The popover's mutation action modes (everything except the "menu" root). */
export type ActionMode =
  | "skip"
  | "skip-override"
  | "pause"
  | "addr-one-off"
  | "addr-forward"
  | "cancel-no-append"
  | "add-note";

/**
 * #430 click-reduction — the menu groups its actions under always-visible
 * section headers (no collapsing, no added click). "View" is the read-only
 * timeline (rendered separately); "Edit delivery" is the note + address
 * overrides; "Reschedule" is skip / pause / cancel.
 */
export type ActionGroup = "edit" | "reschedule";

export interface ActionDescriptor {
  readonly mode: ActionMode;
  readonly label: string;
  readonly description: string;
  readonly visible: boolean;
  readonly group: ActionGroup;
}

/**
 * Status states where mutation actions (skip / pause / address /
 * cancel / note) are operationally meaningful. SKIPPED + CANCELED +
 * DELIVERED + FAILED are terminal-ish; IN_TRANSIT is past cut-off.
 * CREATED + ASSIGNED + ON_HOLD are the eligible states.
 *
 * Note: view-timeline is read-only — runs in ANY state, including
 * terminal ones. Gating happens at the button level.
 */
export const MUTATION_ELIGIBLE_STATUSES: ReadonlySet<TaskInternalStatus> = new Set([
  "CREATED",
  "ASSIGNED",
  "ON_HOLD",
]);

export function buildActions(
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
      group: "reschedule",
    },
    {
      mode: "skip-override",
      label: "Skip with override",
      description: "Move the skip to a specific date or skip without tail-end append.",
      visible: permissions.canSkipOverride && mutationEligible,
      group: "reschedule",
    },
    {
      mode: "pause",
      label: "Pause from this date",
      description: "Cancel deliveries in a window; subscription end date extends.",
      visible: permissions.canPause && mutationEligible,
      group: "reschedule",
    },
    {
      mode: "addr-one-off",
      label: "Change address (this delivery only)",
      description: "Override the address for just this delivery.",
      visible: permissions.canChangeAddressOneOff && mutationEligible,
      group: "edit",
    },
    {
      mode: "addr-forward",
      label: "Change address (from this delivery onwards)",
      description: "Override the address from this date forward.",
      visible: permissions.canChangeAddressForward && mutationEligible,
      group: "edit",
    },
    {
      mode: "cancel-no-append",
      label: "Cancel delivery (no append)",
      description: "Cancel this delivery; subscription count reduces by one.",
      visible: canCancelNoAppend && mutationEligible,
      group: "reschedule",
    },
    {
      mode: "add-note",
      label: "Add note to driver",
      description: "Append a driver-facing instruction to this delivery.",
      visible: permissions.canAddNote && mutationEligible,
      group: "edit",
    },
  ];
}
