// Task-push module types.
//
// Day 8 / D8-4a: cron-driven bulk push of newly-generated tasks to
// SuiteFleet. The internal-language outcome union below is what the
// cron handler aggregates per-tenant.

import type { Uuid } from "@/shared/types";

/**
 * Per-tenant outcome of one cron push pass.
 *
 *   - 'pushed'          Normal completion. Some tasks may have failed
 *                       individually (failedToDLQ counter); some may
 *                       have been pre-flight-skipped for unknown
 *                       district (skippedDistrict counter); some may
 *                       have hit the AWB-exists branch (awbExists
 *                       counter — D8-4a leaves these unpushed and
 *                       routed to DLQ; D8-4b adds the reconcile GET).
 *
 *   - 'tenant_skipped'  Whole-tenant fail-closed. Currently only
 *                       fires for `reason='missing_customer_code'`
 *                       (D8-4a). Counterpart audit event:
 *                       `tenant.push_skipped` (systemOnly, single
 *                       per tenant per pass — explicitly NOT one per
 *                       task to keep the audit timeline interpretable).
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
    }
  | {
      readonly kind: "tenant_skipped";
      readonly tenantId: Uuid;
      readonly reason: "missing_customer_code";
      readonly skippedTaskCount: number;
    };
