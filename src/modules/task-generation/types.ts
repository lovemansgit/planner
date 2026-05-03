// Task-generation module domain types.
//
// camelCase TypeScript at the module boundary; the repository layer maps
// to/from snake_case columns in 0012_task_generation_runs.sql.

import type { IsoTimestamp, Uuid } from "@/shared/types";

/**
 * Five-state lifecycle of a task_generation_runs row. Mirrors the
 * `task_generation_runs_status_check` CHECK in 0012.
 *
 * - 'running' is the only non-terminal state. Transitions to one of the
 *   four terminal states before the cron handler returns. A row stuck
 *   in 'running' (completed_at IS NULL) indicates the handler crashed
 *   mid-flight.
 * - 'completed' and 'capped' are the two outcomes for a run that
 *   reached the projection step.
 * - 'skipped_already_run' fires when a prior row exists for the same
 *   (tenant, window). Captured here for the rare case where the
 *   service layer chooses to record the skipped attempt; the default
 *   path does NOT write a second row (returns the existing row).
 * - 'failed' covers any unrecoverable error before completion. Under
 *   the current single-tx project+generate+finalise design, partial-
 *   success is structurally impossible — an error rolls back every
 *   INSERT inside the block — so there is no 'failed_partial' state.
 *   If a future multi-tx emission design lands, that commit adds it.
 */
export type TaskGenerationRunStatus =
  | "running"
  | "completed"
  | "capped"
  | "skipped_already_run"
  | "failed";

export interface TaskGenerationRun {
  readonly id: Uuid;
  readonly tenantId: Uuid;
  readonly windowStart: IsoTimestamp;
  readonly windowEnd: IsoTimestamp;
  readonly status: TaskGenerationRunStatus;
  /** Cap in effect at run time; recorded so historical capped runs stay interpretable. */
  readonly capThreshold: number;
  readonly projectedCount: number | null;
  readonly subscriptionsWalked: number | null;
  readonly tasksCreated: number | null;
  readonly tasksSkippedExisting: number | null;
  readonly errorText: string | null;
  readonly startedAt: IsoTimestamp;
  readonly completedAt: IsoTimestamp | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/**
 * Service-layer input for one cron invocation. The cron handler
 * computes the window from the schedule (16:00–17:00 Asia/Dubai by
 * default per memory/decision_daily_cutoff_and_throughput.md) and
 * derives `targetDate` as the next-day calendar date.
 *
 * `capThreshold` is required so the value the run is gated against is
 * recorded in the row (per cap_threshold column in 0012). The cron
 * handler passes the canonical value from the throughput memo.
 */
export interface GenerateForWindowInput {
  readonly tenantId: Uuid;
  readonly windowStart: IsoTimestamp;
  readonly windowEnd: IsoTimestamp;
  /** YYYY-MM-DD calendar date the generated tasks are for (typically window-day + 1). */
  readonly targetDate: string;
  readonly capThreshold: number;
}

/**
 * Discriminated-union result shape. The cron handler switches on
 * `kind` and rolls the result into its summary payload.
 */
export type GenerateForWindowResult =
  | {
      readonly kind: "completed";
      readonly run: TaskGenerationRun;
      readonly subscriptionsWalked: number;
      readonly tasksCreated: number;
      readonly tasksSkippedExisting: number;
    }
  | {
      readonly kind: "capped";
      readonly run: TaskGenerationRun;
      readonly projectedCount: number;
      readonly capThreshold: number;
    }
  | {
      readonly kind: "skipped_already_run";
      readonly existingRun: TaskGenerationRun;
    }
  | {
      readonly kind: "failed";
      readonly run: TaskGenerationRun;
      readonly errorText: string;
    };
