// Task-push module types.
//
// Day 8 / D8-5: single-task push to SuiteFleet (post-Day-14-cutover
// surface). The legacy PushTenantOutcome (cron-loop bulk variant)
// retired alongside pushTasksForTenant per memory/plans/day-14-cron-decoupling.md
// §1.3 retirement table; only SinglePushOutcome below remains as the
// canonical task-push outcome shape.

import type { FailureReason } from "../failed-pushes/types";

/**
 * Day 8 / D8-5 — single-task push outcome from `pushSingleTask`.
 *
 * Reused by the operator-driven DLQ retry path (
 * src/modules/failed-pushes/service.ts retryFailedPush). The cron's
 * bulk loop emits the per-iteration counter rollup
 * (PushTenantOutcome.pushed); this single-task variant carries the
 * outcome of one push attempt for direct return through the retry
 * route + into the failed_push.retried audit metadata.
 *
 * The discriminant kinds match the cron's per-iteration semantics:
 *   - 'succeeded'              clean first-attempt push
 *   - 'awb_reconciled'         SF returned 23505/AWB-exists but
 *                              getTaskByAwb succeeded; loop closed
 *                              cleanly (counter analog: cron's
 *                              awbExistsReconciled)
 *   - 'awb_exists'             SF returned 23505/AWB-exists AND
 *                              reconcile failed; DLQ row written
 *                              with the load-bearing
 *                              `awb_exists_reconcile_failed:` prefix
 *                              (counter analog: cron's awbExists)
 *   - 'failed_to_dlq'          non-AWB push failure → DLQ
 *   - 'skipped_district'       pre-flight unknown_district guard fired
 *   - 'tenant_skipped'         tenant-level config gap (e.g. missing
 *                              customer_code). pushSingleTask returns
 *                              this without emitting tenant.push_skipped
 *                              (that event is for the cron's bulk-pass
 *                              scope; for single-task retries the
 *                              operator-layer `failed_push.retried`
 *                              event carries the outcome instead)
 *   - 'task_already_pushed'    task already has pushed_to_external_at
 *                              set; idempotent no-op
 *   - 'task_not_found'         task id resolved to no row in this tenant
 *   - 'past_dated_no_push'     Day-32 PR-A / F-5: pushSingleTask guard
 *                              fired because task.delivery_date <
 *                              CURRENT_DATE at push-time (Dubai-local
 *                              via Postgres clock). Adapter NOT
 *                              invoked; failed_pushes row written via
 *                              W1 with failure_reason='past_dated'.
 */
export type SinglePushOutcome =
  | {
      readonly kind: "succeeded";
      readonly externalId: string;
      readonly trackingNumber: string;
    }
  | {
      readonly kind: "awb_reconciled";
      readonly externalId: string;
      readonly awb: string;
      readonly priorFailedPushResolved: boolean;
    }
  | {
      readonly kind: "awb_exists";
      readonly awb: string;
      readonly reconcileErrorMessage: string;
    }
  | {
      readonly kind: "failed_to_dlq";
      // Day-32 PR-A / F-5: 'past_dated' carries its own outcome kind
      // (past_dated_no_push) and never flows through this branch. Use
      // Exclude so future FailureReason additions auto-narrow correctly
      // here unless they explicitly route through failed_to_dlq.
      readonly failureReason: Exclude<FailureReason, "past_dated">;
      readonly httpStatus?: number;
      readonly failureDetail: string;
    }
  | {
      readonly kind: "skipped_district";
      readonly district: string;
    }
  | {
      readonly kind: "tenant_skipped";
      readonly reason: "missing_customer_code";
    }
  | {
      readonly kind: "task_already_pushed";
      readonly externalId: string;
    }
  | {
      readonly kind: "task_not_found";
    }
  | {
      readonly kind: "past_dated_no_push";
      readonly deliveryDate: string;
    };
