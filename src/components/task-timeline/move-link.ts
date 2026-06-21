// Move-to-date timeline link — pure render logic (D56).
//
// The move-to-date workflow cancels the original delivery and creates a new
// one at the chosen date (PR #537 / brief §3.1.6). Two typed per-task audit
// events carry the link both directions:
//   - task.moved_in  (on the NEW task)       → "Moved from [old date] / replaces AWB [old AWB]"
//   - task.moved_out (on the CANCELLED task) → "Moved to [new date] / see AWB [new AWB]"
//
// This module is import-light (no React, no db) — mirrors partial-state.ts —
// so the drawer renders the returned headline/sub-line and the logic is
// unit-tested without a React harness (this repo has none).
//
// The new task's AWB is NOT known when the move is recorded (SuiteFleet
// assigns it after the asynchronous push); getTaskHistory resolves it at read
// time from the moved task row. Before SF assigns it, moved_to_awb is absent
// and the sub-line degrades to a clear pending state.

export interface MoveLink {
  readonly headline: string;
  readonly subline: string | null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Render the move-to-date link for a task-history entry, or null if the entry
 * is not a move event. Both framings per Love's ruling: a friendly date
 * headline + a precise AWB sub-line.
 */
export function moveLinkFor(entry: {
  readonly eventType: string;
  readonly metadata: Record<string, unknown>;
}): MoveLink | null {
  if (entry.eventType === "task.moved_in") {
    const fromDate = strOrNull(entry.metadata["moved_from_delivery_date"]);
    const fromAwb = strOrNull(entry.metadata["moved_from_awb"]);
    return {
      headline: fromDate ? `Moved from ${fromDate}` : "Moved from an earlier delivery",
      subline: fromAwb ? `replaces AWB ${fromAwb}` : null,
    };
  }
  if (entry.eventType === "task.moved_out") {
    const toDate = strOrNull(entry.metadata["moved_to_delivery_date"]);
    const toAwb = strOrNull(entry.metadata["moved_to_awb"]);
    return {
      headline: toDate ? `Moved to ${toDate}` : "Moved to a later delivery",
      subline: toAwb
        ? `see AWB ${toAwb}`
        : "AWB pending — not yet sent to SuiteFleet",
    };
  }
  return null;
}
