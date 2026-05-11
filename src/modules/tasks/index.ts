// tasks module — plan §3.3 / §4.5 (task lifecycle) + §4.6 (nightly batch).
//
// Day 5 / T-3: service-layer surface for the tasks module. Bimodal
// design originally captured in
// memory/decision_task_module_no_user_create_delete.md, AMENDED on
// Day 19 by memory/decision_task_module_amendment_v1.md (Phase 1
// merchant CRUD lane) — see plan-PR §K:
//
//   - createTask is now DUAL-ACTOR. The single fn dispatches on
//     ctx.actor.kind: system actors bypass via assertSystemActor (cron
//     + migration-import flow continue as before); user actors require
//     the new task:create permission for ad-hoc operator-initiated
//     task creation. NOT a separate createTaskAsUser fn — one wire
//     path, one place for SF push to live.
//
//   - bulkCreateTasks remains SYSTEM-ONLY (cron + import flows).
//
//   - getTask, listTasks, updateTask are user-flow methods gated on
//     existing task:read / task:update permissions. Day-19 §A5 also
//     extends the UpdateTaskPatch surface with addressId + cutoff
//     guard for the operator edit-task flow.
//
// No deleteTask method — no MVP caller. If a future requirement
// surfaces (GDPR erasure, manual cleanup), it lands then with
// explicit scope and an audit event added in the same PR.
//
// The repository (T-2) is internal — only the service layer is
// exported, so any caller reaches the DB through the audited /
// permission-gated surface.

export type {
  CreateTaskInput,
  CreateTaskPackageInput,
  Task,
  TaskCreationSource,
  TaskInternalStatus,
  TaskKind,
  TaskPackage,
  TaskPackageStatus,
  UpdateTaskPatch,
} from "./types";

export {
  BulkValidationError,
  bulkCreateTasks,
  countTasks,
  createTask,
  getConsigneeTaskCountByDayBucket,
  getConsigneeTasksForDateRange,
  getTask,
  getTasksForSubscription,
  listAllTaskIds,
  listTasks,
  printLabelsForTasks,
  updateTask,
  PRINT_LABELS_FORMAT,
  PRINT_LABELS_MAX_TASKS_PER_REQUEST,
  type BulkCreateResult,
  type BulkValidationFailure,
  type ListTasksOpts,
  type PrintLabelsForTasksResult,
} from "./service";

export type { DayBucketCount } from "./repository";

// Day-16 — repository-layer helpers exposed for cross-module callers
// that need to UPDATE tasks transactionally inside a multi-table
// service-layer tx. These bypass the tasks module's service-layer
// audit/permission gates because they're called BY an already-
// permissioned + already-audited service in another module — the
// calling service owns the audit-emit posture for the cross-module
// operation.
//
// Current callers:
//   - subscriptions/service.ts:pauseSubscription (step 9 CANCELED
//     bulk-flip per merged plan §4.1; step 12 restore-tasks on
//     early-manual-resume per §4.2). subscription-exceptions module
//     also imports findTaskBySubscriptionAndDate + markTaskSkipped
//     directly from ./repository — that module is not in MODULES
//     for the lint zone (no boundary enforced today; revisit if
//     subscription-exceptions joins MODULES).
export {
  findTaskBySubscriptionAndDate,
  markTaskSkipped,
  markTasksCanceledInWindow,
  markTasksRestoredInWindow,
} from "./repository";
