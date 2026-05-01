// task-generation module — Day 7 / C-2.
//
// Public surface: the cron-driven nightly batch generator.
// Internal-only: the repository (DB queries) per plan §3.4.

export { generateTasksForWindow } from "./service";
export type {
  GenerateForWindowInput,
  GenerateForWindowResult,
  TaskGenerationRun,
  TaskGenerationRunStatus,
} from "./types";
