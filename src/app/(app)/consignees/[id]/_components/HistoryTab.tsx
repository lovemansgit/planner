// Day 22 / §3.3.7 — consignee unified timeline (server component).
//
// Reads consignee_timeline_events via getConsigneeTimeline. The view
// UNIONs three event kinds — CRM state transitions, subscription
// exceptions (skip / pause / address overrides), and terminal task
// statuses (DELIVERED / FAILED / SKIPPED / CANCELED). Rendered
// chronologically newest-first.
//
// Replaces the Day-17 CRM-only History tab (getConsigneeCrmHistory).
// The CRM transition rows preserve the original badge → arrow → badge
// treatment; new event kinds get their own kind-specific copy with the
// same hairline-bordered, sentence-cased visual posture.
//
// Pagination: server-side LIMIT 50 (default in selectTimelineForConsignee).
// "Load more" deferred to Phase 2 if pilot data exceeds the page size.

import type { TimelineEvent } from "@/modules/consignees";

import { CrmStateBadge } from "./CrmStateBadge";

interface HistoryTabProps {
  readonly events: readonly TimelineEvent[];
}

export function HistoryTab({ events }: HistoryTabProps) {
  if (events.length === 0) {
    return (
      <div className="border-t border-stone-200 py-12 text-center">
        <p className="text-sm text-[color:var(--color-text-secondary)]">
          No events recorded for this consignee yet.
        </p>
      </div>
    );
  }

  return (
    <ol className="border-t border-stone-200">
      {events.map((event, idx) => (
        <li
          key={`${event.kind}-${event.eventAt}-${idx}`}
          className="flex flex-col gap-2 border-b border-stone-200 py-4 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="flex-1">
            <TimelineEventBody event={event} />
          </div>
          <div className="text-right text-xs text-[color:var(--color-text-tertiary)]">
            <p className="font-mono tabular-nums">{formatTimestamp(event.eventAt)}</p>
            {"actor" in event && event.actor ? (
              <p className="mt-0.5 truncate" title={event.actor}>
                {actorAnchor(event.actor)}
              </p>
            ) : (
              <p className="mt-0.5 italic">system</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function TimelineEventBody({ event }: { readonly event: TimelineEvent }) {
  switch (event.kind) {
    case "crm_state":
      return (
        <>
          <div className="flex items-center gap-2 text-sm">
            {event.fromState === null ? (
              <>
                <span className="text-[color:var(--color-text-secondary)]">Created as</span>
                <CrmStateBadge state={event.toState} />
              </>
            ) : (
              <>
                <CrmStateBadge state={event.fromState} />
                <span className="text-[color:var(--color-text-tertiary)]">→</span>
                <CrmStateBadge state={event.toState} />
              </>
            )}
          </div>
          {event.reason ? (
            <p className="mt-2 max-w-prose text-sm text-[color:var(--color-text-secondary)]">
              {event.reason}
            </p>
          ) : null}
        </>
      );

    case "subscription_exception": {
      const summary = formatSubscriptionException(event);
      return (
        <>
          <p className="text-sm text-navy">{summary}</p>
          {event.reason ? (
            <p className="mt-2 max-w-prose text-sm text-[color:var(--color-text-secondary)]">
              {event.reason}
            </p>
          ) : null}
        </>
      );
    }

    case "task_status":
      return (
        <p className="text-sm text-navy">
          Delivery on{" "}
          <span className="font-mono tabular-nums">{event.deliveryDate}</span>{" "}
          <span className="text-[color:var(--color-text-tertiary)]">→</span>{" "}
          <span className={taskStatusToneClass(event.internalStatus)}>{event.internalStatus}</span>
        </p>
      );
  }
}

function formatSubscriptionException(event: Extract<TimelineEvent, { kind: "subscription_exception" }>): string {
  const start = event.startDate;
  const end = event.endDate;
  const comp = event.compensatingDate;
  switch (event.type) {
    case "pause_window":
      return end
        ? `Subscription paused ${start} to ${end}`
        : `Subscription paused from ${start}`;
    case "skip":
      return comp
        ? `Skip applied for ${start}; compensating date ${comp}`
        : `Skip applied for ${start}`;
    case "address_override_one_off":
      return `One-off address override on ${start}`;
    case "address_override_forward":
      return end
        ? `Forward address override from ${start} to ${end}`
        : `Forward address override from ${start}`;
    case "append_without_skip":
      return `Compensating delivery appended on ${start}`;
  }
}

function taskStatusToneClass(status: Extract<TimelineEvent, { kind: "task_status" }>["internalStatus"]): string {
  switch (status) {
    case "DELIVERED":
      return "text-green font-medium";
    case "FAILED":
      return "text-red font-medium";
    case "SKIPPED":
      return "text-[color:var(--color-text-secondary)] font-medium";
    case "CANCELED":
      return "text-[color:var(--color-text-tertiary)] font-medium";
  }
}

/** First 8 chars of the actor uuid; placeholder for Phase 2 display-name lookup. */
function actorAnchor(actorUuid: string): string {
  return actorUuid.slice(0, 8);
}

/** ISO timestamp → "YYYY-MM-DD HH:MM" UTC. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return `${date} ${time}`;
}
