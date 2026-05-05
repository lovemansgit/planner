// task-push module — Day 8 / D8-5 (post-Day-14-cutover surface).
//
// Single-task push to the last-mile adapter (SuiteFleet in pilot)
// with 5 req/sec throttle, two fail-closed guards (`unknown_district`,
// `missing_customer_code`), and the D8-4b reconcile branch for
// AwbExists 4xx recovery.
//
// pushTasksForTenant (cron-loop bulk variant) RETIRED at Day-14
// cutover per memory/plans/day-14-cron-decoupling.md §1.3 retirement
// table — its 458-line body deleted from service.ts when the
// materialization-cron handler replaced inline SF push with QStash
// decoupling. pushSingleTask remains as the only post-cutover caller
// of markTaskPushed; it has TWO callers post-cutover:
//   1. /admin/failed-pushes retry UI (DLQ replay path, pre-existing)
//   2. /api/queue/push-task (Day-14 QStash consumer, new)

export type { SinglePushOutcome } from "./types";
export { pushSingleTask } from "./service";
