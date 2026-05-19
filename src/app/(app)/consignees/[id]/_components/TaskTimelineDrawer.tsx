// Day-22 / PR-B — Task timeline drawer (client component).
//
// Renders the state-transition history for a single task per brief
// §3.3.6: Created → Assigned → In transit → Delivered / Failed / Skipped.
// Sourced from local DB cached webhook_events per §3.3.8 (no live SF
// fetch). Read-only; no mutation surface.
//
// Triggered from DayActionPopover (action 8) — receives taskId +
// consigneeId via props, fetches timeline data on mount via the
// `getTaskTimelineAction` server action. Per R-4 read-not-audited
// convention, no audit emit.
//
// Visual treatment per brief §3.3.11 brand pass: hairline 1px stone-200
// dividers between entries, sentence-case action labels, ink body copy
// on paper surface, navy accent bar on the latest entry. Drawer slides
// in from right; closes on Escape, click-outside, or explicit Close.

"use client";

import { useEffect, useRef, useState } from "react";

import {
  getTaskTimelineAction,
  type GetTaskTimelineActionResult,
} from "../_calendar-actions";

interface TaskTimelineDrawerProps {
  readonly consigneeId: string;
  readonly taskId: string;
  readonly deliveryDate: string;
  readonly onClose: () => void;
}

/**
 * Human-readable label map for SF action codes + the synthetic
 * TASK_CREATED entry. Day-31 A1 (plan #306 final lane shape item 4):
 * the map keys against EXACTLY the 8 SF action strings confirmed on
 * real wire by the MPL-80355079 + MPL-38610276 end-to-end tests, plus
 * the TASK_CREATED synthetic source. Granular labels — NOT collapsed
 * to internal-status buckets (Love decision, explicit). Surfaces A
 * (parser KNOWN_ACTIONS) + B (mapper ACTION_TO_INTERNAL_STATUS)
 * confirmed correct by both real tests and are NOT modified here.
 *
 * Wire-vocabulary correction vs prior map: the previous entry used
 * `TASK_STATUS_UPDATED_TO_ASSIGNED` (drawer-only vocabulary); the
 * real wire emits `TASK_HAS_BEEN_ASSIGNED` (matches parser + mapper).
 *
 * Codes not in this map render their raw SF code per OQ-6(a) ruling
 * — visible drift is the correct failure mode.
 */
const ACTION_LABELS: Readonly<Record<string, string>> = {
  TASK_CREATED: "Created",
  TASK_HAS_BEEN_ORDERED: "Ordered",
  TASK_HAS_BEEN_UPDATED: "Updated",
  TASK_HAS_BEEN_ASSIGNED: "Assigned to driver",
  TASK_STATUS_UPDATED_TO_PICKED_UP: "Picked up",
  TASK_STATUS_UPDATED_TO_ARRIVED_ON_DC: "Arrived at DC",
  TASK_STATUS_UPDATED_TO_OUT_FOR_DELIVERY: "Out for delivery",
  TASK_STATUS_UPDATED_TO_IN_TRANSIT: "In transit",
  TASK_STATUS_UPDATED_TO_DELIVERED: "Delivered",
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TaskTimelineDrawer({
  consigneeId,
  taskId,
  deliveryDate,
  onClose,
}: TaskTimelineDrawerProps) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "loaded"; result: GetTaskTimelineActionResult }
  >({ kind: "loading" });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void getTaskTimelineAction(consigneeId, taskId).then((result) => {
      if (!cancelled) setState({ kind: "loaded", result });
    });
    return () => {
      cancelled = true;
    };
  }, [consigneeId, taskId]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
  }, [onClose]);

  useEffect(() => {
    function handleMousedown(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", handleMousedown);
    return () => document.removeEventListener("mousedown", handleMousedown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Timeline for delivery on ${deliveryDate}`}
      className="fixed inset-0 z-[60] flex justify-end bg-navy/20"
    >
      <div
        ref={panelRef}
        className="flex h-full w-full max-w-md flex-col bg-surface-primary border-l border-stone-200"
      >
        <div className="flex items-baseline justify-between border-b border-stone-200 px-6 py-5">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
              Timeline
            </p>
            <h2 className="mt-1 font-display text-lg font-semibold text-navy">
              Delivery on {deliveryDate}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] transition-opacity duration-[120ms] ease-out hover:text-navy"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {state.kind === "loading" ? (
            <p className="text-sm text-[color:var(--color-text-secondary)]">
              Loading timeline…
            </p>
          ) : state.result.kind === "success" ? (
            <TimelineEntries entries={state.result.timeline.entries} />
          ) : (
            <p
              role="alert"
              className="rounded-sm border border-red/40 bg-red/10 px-3 py-2 text-sm text-red"
            >
              {state.result.message}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineEntries({
  entries,
}: {
  readonly entries: readonly { timestamp: string; action: string; source: string }[];
}) {
  if (entries.length === 0) {
    return (
      <p className="text-sm text-[color:var(--color-text-secondary)]">
        No timeline events recorded yet.
      </p>
    );
  }
  return (
    <ol className="space-y-4">
      {entries.map((entry, index) => {
        const label = ACTION_LABELS[entry.action] ?? entry.action;
        const isLatest = index === entries.length - 1;
        return (
          <li
            key={`${entry.timestamp}-${entry.action}-${index}`}
            className={
              isLatest
                ? "border-l-2 border-green pl-4"
                : "border-l border-stone-200 pl-4"
            }
          >
            <p
              className={
                isLatest
                  ? "font-display text-sm font-semibold text-navy"
                  : "font-display text-sm text-navy"
              }
            >
              {label}
            </p>
            <p className="mt-0.5 text-xs tabular-nums text-[color:var(--color-text-secondary)]">
              {formatTimestamp(entry.timestamp)}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[color:var(--color-text-tertiary)]">
              {entry.source === "task_created" ? "System" : "SuiteFleet webhook"}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
