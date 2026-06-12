// R6.3 (Day-53 R6-part-2) — task-timeline partial-state banner.
//
// A task with no AWB yet (`externalTrackingNumber === null`) has not been
// pushed to SuiteFleet, so its SF-sourced timeline is empty/pending. When
// the drawer is opened for such a task (e.g. from the /tasks AWB cell), it
// renders a banner explaining the empty state instead of looking broken.
//
// The copy is Love-ruled verbatim — do NOT paraphrase.

export const TASK_AWAITING_PUSH_BANNER =
  "Task not yet pushed to SuiteFleet — AWB will be assigned once dispatch completes.";

/**
 * Whether the drawer should show the partial-state banner. True only when
 * the caller explicitly passes a `null` AWB (the task has no tracking
 * number yet). Callers that don't opt in (`awb === undefined`, e.g. the
 * consignee-calendar entry point) get no banner — preserving their
 * existing behaviour.
 */
export function isAwaitingPush(awb: string | null | undefined): boolean {
  return awb === null;
}
