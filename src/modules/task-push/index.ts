// task-push module — Day 8 / D8-4a.
//
// Cron-driven per-tenant bulk push of newly-generated tasks to the
// last-mile adapter (SuiteFleet in pilot). Single-loop posture
// (createBulk deferred to Day 9+ revisit per Love's confirmation).
// 5 req/sec throttle at the service layer. Two fail-closed guards:
// per-task `unknown_district`, per-tenant `missing_customer_code`.
//
// Public surface is the service-layer entry point only — the cron
// handler at src/app/api/cron/generate-tasks/route.ts is the
// canonical caller.

export type { PushTenantOutcome, SinglePushOutcome } from "./types";
export { pushTasksForTenant, pushSingleTask } from "./service";
