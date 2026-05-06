// tasks module — plan §3.3 / §4.5 (task lifecycle) + §4.6 (nightly batch).
//
// Day 5 / T-3: service-layer surface for the tasks module. Bimodal
// design captured in
// memory/decision_task_module_no_user_create_delete.md:
//
//   - createTask, bulkCreateTasks are SYSTEM-ONLY (no user-facing
//     permission in the catalogue; the cron and the migration-import
//     flow are the legitimate callers).
//
//   - getTask, listTasks, updateTask are user-flow methods gated on
//     existing task:read / task:update permissions.
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
  getTask,
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
