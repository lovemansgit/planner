// Day 17 / Session A — CRM history tab (server component).
//
// Reads consignee_crm_events newest-first via the new
// getConsigneeCrmHistory service fn. Renders a chronological list:
// from-state → to-state badges with arrow, reason text, actor uuid
// (display-name resolution is Phase 2 — first iteration shows the
// uuid prefix as an actor anchor), and occurred_at timestamp.
//
// Initial-create rows (`from_state IS NULL`) render as "Created as
// {to_state}" per CRM plan §3.3 initial-create handling — distinct
// from "Transitioned from null to X" because null-from is the
// onboarding event, not a transition.
//
// Pagination: server-side LIMIT 50 (default in selectCrmHistoryForConsignee).
// "Load more" deferred to Phase 2 if pilot operator data exceeds the
// initial page size; current cap is the seeded ~5 events per consignee
// max in the demo dataset.

import type { ConsigneeCrmEvent } from "@/modules/consignees";

import { CrmStateBadge } from "./CrmStateBadge";

interface HistoryTabProps {
  readonly events: readonly ConsigneeCrmEvent[];
}

export function HistoryTab({ events }: HistoryTabProps) {
  if (events.length === 0) {
    return (
      <div className="border-t border-stone-200 py-12 text-center">
        <p className="text-sm text-[color:var(--color-text-secondary)]">
          No CRM state changes recorded for this consignee.
        </p>
      </div>
    );
  }

  return (
    <ol className="border-t border-stone-200">
      {events.map((event) => (
        <li
          key={event.id}
          className="flex flex-col gap-2 border-b border-stone-200 py-4 sm:flex-row sm:items-start sm:justify-between"
        >
          <div className="flex-1">
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
          </div>
          <div className="text-right text-xs text-[color:var(--color-text-tertiary)]">
            <p className="font-mono tabular-nums">
              {formatTimestamp(event.occurredAt)}
            </p>
            <p className="mt-0.5 truncate" title={event.actor}>
              {actorAnchor(event.actor)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** First 8 chars of the actor uuid; placeholder for Phase 2 display-name lookup. */
function actorAnchor(actorUuid: string): string {
  return actorUuid.slice(0, 8);
}

/** ISO timestamp → "Mon DD, HH:MM" in operator's UTC framing. */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // YYYY-MM-DD HH:MM (UTC) — terse + tabular-friendly.
  const date = d.toISOString().slice(0, 10);
  const time = d.toISOString().slice(11, 16);
  return `${date} ${time}`;
}
