// Day-22 §3.22 fixup — /tasks AWB search filter helper.
//
// Operators paste partial AWB fragments to find a specific task in
// the list (e.g. last 6 digits of an MPL-... AWB). Case-insensitive
// substring match against task.externalTrackingNumber. Tasks with
// null AWB (pre-push state) are excluded when a query is active —
// they have no AWB to match.
//
// v1 client-side filter scope: works against the current page's
// initialTasks only (not across pages). Server-side AWB search would
// require a new query-param + service-layer support; deferred to
// Phase 2 per PR #238 §3.22 follow-up.

import type { Task } from "@/modules/tasks/types";

/**
 * Filter the visible task list by an AWB substring.
 *
 *   - Empty / whitespace-only query → return rows unchanged.
 *   - Case-insensitive substring match against
 *     `task.externalTrackingNumber`.
 *   - Tasks with null externalTrackingNumber are excluded once a
 *     query is active (no AWB to match against — would otherwise
 *     leak unrelated pre-push tasks into the result set).
 *
 * Pure helper; exported for unit-test coverage. Pattern mirrors
 * `src/app/(app)/consignees/_helpers.ts` filterConsigneesByQuery.
 */
export function filterTasksByAwb(
  rows: readonly Task[],
  query: string,
): readonly Task[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return rows;
  const needle = trimmed.toLowerCase();
  return rows.filter((t) => {
    if (t.externalTrackingNumber === null) return false;
    return t.externalTrackingNumber.toLowerCase().includes(needle);
  });
}
