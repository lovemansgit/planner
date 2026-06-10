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
//
// Day-52 / R8 adds the History section below the delivery timeline:
// the task's audit history (this task's events + the subscription
// events that affected it). Two-level disclosure per the R8 rulings —
// the section is collapsed by default (ruling 4); expanded rows are
// headlines (event + actor + timestamp) with click-to-expand metadata
// detail (ruling 2); batches load via "Show more" (ruling 3). Fetches
// lazily on first expand via `getTaskHistoryAction`.
//
// Honesty constraint (followup_audit_failed_attempts.md): the audit
// layer records successful actions only, so all History copy frames
// the section as "what happened" — never as an attempt log.

"use client";

import { useEffect, useRef, useState } from "react";

import {
  getTaskHistoryAction,
  getTaskTimelineAction,
  type GetTaskTimelineActionResult,
} from "../_calendar-actions";
import type { AuditEventCursor } from "@/modules/audit";
import type { TaskHistoryEntry } from "@/modules/tasks";

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

          <HistorySection consigneeId={consigneeId} taskId={taskId} />
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

// -----------------------------------------------------------------------------
// History section — Day-52 / R8
// -----------------------------------------------------------------------------

/**
 * Operator-readable labels for the audit event types that can appear
 * in a task's history (this task's events + affecting subscription
 * events per ruling 1). `subscription.exception.created` is labelled
 * by its exception type — the type discriminator is what an operator
 * recognises ("Delivery skipped"), not the event id.
 *
 * Unknown event types render their raw id — visible drift is the
 * correct failure mode (same posture as ACTION_LABELS / OQ-6(a)).
 */
const HISTORY_EVENT_LABELS: Readonly<Record<string, string>> = {
  "task.created": "Task created",
  "task.updated": "Task updated",
  "task.completed": "Task completed",
  "task.note_added": "Driver note added",
  "task.note_pushed_to_external": "Driver note sent to SuiteFleet",
  "task.labels_printed": "Shipping label printed",
  "task.status_changed_via_webhook": "Status updated by SuiteFleet",
  "task.edit_applied_via_webhook": "Details updated by SuiteFleet",
  "task.pod_received_via_webhook": "Proof of delivery received",
  "subscription.paused": "Subscription paused",
  "subscription.resumed": "Subscription resumed",
  "subscription.auto_paused": "Subscription auto-paused after delivery failures",
  "subscription.pause_cancels_pushed": "Pause cancellations sent to SuiteFleet",
  "subscription.end_date.extended": "Subscription extended",
  "subscription.address_override.applied": "Address override applied",
};

const EXCEPTION_TYPE_LABELS: Readonly<Record<string, string>> = {
  skip: "Delivery skipped",
  address_override_one_off: "Address changed for one delivery",
  address_override_forward: "Address changed going forward",
  append_without_skip: "Delivery appended",
};

function historyEventLabel(entry: TaskHistoryEntry): string {
  if (entry.eventType === "subscription.exception.created") {
    const exceptionType = entry.metadata["type"];
    if (typeof exceptionType === "string" && EXCEPTION_TYPE_LABELS[exceptionType]) {
      return EXCEPTION_TYPE_LABELS[exceptionType];
    }
    return "Subscription exception recorded";
  }
  return HISTORY_EVENT_LABELS[entry.eventType] ?? entry.eventType;
}

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

type HistoryState =
  | { kind: "collapsed" }
  | { kind: "loading"; entries: readonly TaskHistoryEntry[] }
  | {
      kind: "loaded";
      entries: readonly TaskHistoryEntry[];
      nextCursor: AuditEventCursor | null;
    }
  | { kind: "error"; message: string; entries: readonly TaskHistoryEntry[] };

/**
 * Collapsible History section (ruling 4: collapsed by default under a
 * clear "History" heading). Fetches its first batch lazily when the
 * operator expands it; "Show more" appends older batches (ruling 3).
 */
function HistorySection({
  consigneeId,
  taskId,
}: {
  readonly consigneeId: string;
  readonly taskId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [history, setHistory] = useState<HistoryState>({ kind: "collapsed" });
  const [openEntryIds, setOpenEntryIds] = useState<ReadonlySet<string>>(new Set());

  async function fetchBatch(
    existing: readonly TaskHistoryEntry[],
    before?: AuditEventCursor,
  ) {
    setHistory({ kind: "loading", entries: existing });
    const result = await getTaskHistoryAction(consigneeId, taskId, before);
    if (result.kind === "success") {
      setHistory({
        kind: "loaded",
        entries: [...existing, ...result.page.entries],
        nextCursor: result.page.nextCursor,
      });
    } else {
      setHistory({ kind: "error", message: result.message, entries: existing });
    }
  }

  function handleToggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && history.kind === "collapsed") {
      void fetchBatch([]);
    }
  }

  function toggleEntry(id: string) {
    setOpenEntryIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <section className="mt-6 border-t border-stone-200 pt-5">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        className="flex w-full items-baseline justify-between text-left"
      >
        <span>
          <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-[color:var(--color-text-tertiary)]">
            History
          </span>
          <span className="mt-1 block text-xs text-[color:var(--color-text-secondary)]">
            Recorded actions for this task and its subscription
          </span>
        </span>
        <span
          aria-hidden="true"
          className="text-xs text-[color:var(--color-text-secondary)]"
        >
          {expanded ? "Hide" : "Show"}
        </span>
      </button>

      {expanded ? (
        <div className="mt-4">
          {history.kind === "error" ? (
            <p
              role="alert"
              className="rounded-sm border border-red/40 bg-red/10 px-3 py-2 text-sm text-red"
            >
              {history.message}
            </p>
          ) : null}

          {history.kind !== "collapsed" && history.entries.length > 0 ? (
            <ol className="space-y-3">
              {history.entries.map((entry) => {
                const isOpen = openEntryIds.has(entry.id);
                const metadataPairs = Object.entries(entry.metadata);
                return (
                  <li key={entry.id} className="border-l border-stone-200 pl-4">
                    <button
                      type="button"
                      onClick={() => toggleEntry(entry.id)}
                      aria-expanded={isOpen}
                      className="w-full text-left"
                    >
                      <p className="font-display text-sm text-navy">
                        {historyEventLabel(entry)}
                      </p>
                      <p className="mt-0.5 text-xs tabular-nums text-[color:var(--color-text-secondary)]">
                        {formatTimestamp(entry.occurredAt)}
                      </p>
                      <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[color:var(--color-text-tertiary)]">
                        {entry.actorLabel}
                      </p>
                    </button>
                    {isOpen ? (
                      <dl className="mt-2 space-y-1 border-t border-stone-200 pt-2">
                        {entry.actorKind === "system" ? (
                          <div className="flex gap-2 text-xs">
                            <dt className="shrink-0 text-[color:var(--color-text-tertiary)]">
                              recorded_by
                            </dt>
                            <dd className="break-all text-[color:var(--color-text-secondary)]">
                              {entry.actorId}
                            </dd>
                          </div>
                        ) : null}
                        {metadataPairs.length === 0 ? (
                          <p className="text-xs text-[color:var(--color-text-secondary)]">
                            No further detail recorded.
                          </p>
                        ) : (
                          metadataPairs.map(([key, value]) => (
                            <div key={key} className="flex gap-2 text-xs">
                              <dt className="shrink-0 text-[color:var(--color-text-tertiary)]">
                                {key}
                              </dt>
                              <dd className="break-all text-[color:var(--color-text-secondary)]">
                                {formatMetadataValue(value)}
                              </dd>
                            </div>
                          ))
                        )}
                      </dl>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : null}

          {history.kind === "loaded" && history.entries.length === 0 ? (
            <p className="text-sm text-[color:var(--color-text-secondary)]">
              No recorded actions yet.
            </p>
          ) : null}

          {history.kind === "loading" ? (
            <p className="mt-3 text-sm text-[color:var(--color-text-secondary)]">
              Loading history…
            </p>
          ) : null}

          {history.kind === "loaded" && history.nextCursor !== null ? (
            <button
              type="button"
              onClick={() => {
                if (history.kind === "loaded" && history.nextCursor !== null) {
                  void fetchBatch(history.entries, history.nextCursor);
                }
              }}
              className="mt-4 text-xs uppercase tracking-[0.1em] text-[color:var(--color-text-secondary)] transition-opacity duration-[120ms] ease-out hover:text-navy"
            >
              Show more
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
