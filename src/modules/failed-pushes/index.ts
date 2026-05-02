// failed-pushes module — Day 5 / T-6 schema (0008) + T-7 service.
//
// Insert path only for Day 5; the cron's "first failure for a task"
// path. UPDATE (retry attempts), resolution, and list paths land
// Day 7+ when the cron's retry-with-audit-trail flow + post-MVP
// operator UI need them.
//
// The repository is internal — only the service layer is exported,
// so any caller reaches the DB through the audited / system-actor-
// gated surface.

export type { FailedPush, FailureReason, RecordFailedPushInput } from "./types";
export type { PushSingleTaskFn, RetryFailedPushResult } from "./service";

export {
  listUnresolvedFailedPushes,
  markFailedPushResolved,
  recordFailedPush,
  recordFailedPushAttempt,
  retryFailedPush,
} from "./service";
