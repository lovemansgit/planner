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
  TaskInternalStatus,
  TaskKind,
  TaskPackage,
  TaskPackageStatus,
  UpdateTaskPatch,
} from "./types";

export {
  BulkValidationError,
  bulkCreateTasks,
  createTask,
  getTask,
  listTasks,
  updateTask,
  type BulkCreateResult,
  type BulkValidationFailure,
} from "./service";
