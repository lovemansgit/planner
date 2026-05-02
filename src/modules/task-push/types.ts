// Task-push module types.
//
// Day 8 / D8-4a: cron-driven bulk push of newly-generated tasks to
// SuiteFleet. The internal-language outcome union below is what the
// cron handler aggregates per-tenant.

import type { Uuid } from "@/shared/types";

/**
 * Per-tenant outcome of one cron push pass.
 *
 *   - 'pushed'          Normal completion. Counters:
 *                       - succeeded             clean first-attempt push
 *                       - failedToDLQ           non-AWB push failure → DLQ
 *                       - skippedDistrict       pre-flight unknown_district guard fired
 *                       - awbExists             SF returned 23505/AWB-exists AND the
 *                                               D8-4b reconcile branch could NOT close
 *                                               the loop (getTaskByAwb threw or parser
 *                                               rejected). DLQ row written; task stays
 *                                               unpushed; next cron pass re-attempts.
 *                       - awbExistsReconciled   SF returned 23505/AWB-exists AND the
 *                                               D8-4b reconcile branch successfully
 *                                               extracted the existing SF task id and
 *                                               marked the local task pushed. Distinct
 *                                               from `succeeded` so audit/forensics can
 *                                               isolate reconcile-path closures from
 *                                               clean first-attempt pushes — repeated
 *                                               reconciles for one tenant signal
 *                                               upstream duplicate-AWB exposure.
 *
 *   - 'tenant_skipped'  Whole-tenant fail-closed. Currently only
 *                       fires for `reason='missing_customer_code'`
 *                       (D8-4a). Counterpart audit event:
 *                       `tenant.push_skipped` (systemOnly, single
 *                       per tenant per pass — explicitly NOT one per
 *                       task to keep the audit timeline interpretable).
 *
 * Counter posture (reviewer-locked, D8-4b): two AWB counters
 * (`awbExists`, `awbExistsReconciled`) — NOT three. A reconcile-
 * attempt-and-failure (e.g. getTaskByAwb threw a network error or
 * the timeline parser rejected the response shape) counts as
 * `awbExists`. Adding a third counter for "reconcile attempted but
 * failed" would split forensic interpretation across three
 * categories without operational benefit — operators care about
 * "did the loop close (awbExistsReconciled++) or not (awbExists++)?"
 * and the failure_detail prefix `awb_exists_reconcile_failed:`
 * already distinguishes parse-only-era DLQ rows from
 * reconcile-attempted-and-failed rows in /admin/failed-pushes.
 */
export type PushTenantOutcome =
  | {
      readonly kind: "pushed";
      readonly tenantId: Uuid;
      readonly attemptedCount: number;
      readonly succeeded: number;
      readonly failedToDLQ: number;
      readonly skippedDistrict: number;
      readonly awbExists: number;
      readonly awbExistsReconciled: number;
    }
  | {
      readonly kind: "tenant_skipped";
      readonly tenantId: Uuid;
      readonly reason: "missing_customer_code";
      readonly skippedTaskCount: number;
    };
