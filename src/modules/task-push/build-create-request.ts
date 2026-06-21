// Pure builder for the SuiteFleet CREATE wire body — extracted from
// task-push/service.ts so it can be unit-tested without loading the DB layer
// (mirrors the cte-builder.ts pure-builder pattern). NO runtime imports: all
// dependencies are `import type` so the unit project never touches Supabase.

import type { DeliveryAddress, TaskCreateRequest } from "../integration";
import type { Task } from "../tasks/types";
import type { Uuid } from "../../shared/types";

export interface ConsigneePushSnapshot {
  readonly id: Uuid;
  readonly name: string;
  readonly phone: string;
  readonly email: string | null;
  readonly addressLine: string;
  readonly emirateOrRegion: string;
  readonly district: string;
  /**
   * Default delivery instructions captured on the consignee record
   * (consignees.delivery_notes) — set at consignee creation/edit. A1 fix
   * (plan #532 §Phase-3): seeds the SF wire `notes` field on the CREATE push
   * when the task carries no per-task note, so the creation-time note reaches
   * SuiteFleet instead of dead-ending on the consignee row. A per-task R3 note
   * (`tasks.notes`) always wins over this default.
   */
  readonly deliveryNotes: string | null;
}

/**
 * Cron-path TaskCreateRequest variant that omits shipFrom. SF auto-populates
 * shipFrom from the merchant master, so the cron/single push path never
 * constructs it.
 */
export type CronTaskCreateRequest = Omit<TaskCreateRequest, "shipFrom">;

/**
 * Map a Task + ConsigneeSnapshot + tenant customer_code into the
 * internal-language `TaskCreateRequest` the adapter expects (minus shipFrom —
 * see CronTaskCreateRequest above).
 *
 * Locked defaults (per Aqib Group-1):
 *   - countryCode = 'AE' (UAE pilot)
 *   - paymentMethod = 'PrePaid' (top-level, not nested — D8-3 fix)
 *   - itemQuantity = 1 (single bag per meal-plan delivery)
 *   - codAmount = 0, declaredValue = 0 (prepaid)
 *   - city = consignee.emirate_or_region (one-string-fits-both for the UAE
 *     pilot per option-1 lean in the C-3 deferred memo)
 *   - shipFrom OMITTED — SF auto-populates from merchant master
 *   - notes = per-task note (R3) first, else the consignee's default delivery
 *     note (A1 fix), else undefined
 */
export function buildTaskCreateRequest(
  tenantId: Uuid,
  task: Task,
  consignee: ConsigneePushSnapshot,
): CronTaskCreateRequest {
  const consigneeAddress: DeliveryAddress = {
    addressLine1: consignee.addressLine,
    city: consignee.emirateOrRegion,
    district: consignee.district,
    countryCode: "AE",
  };
  return {
    tenantId,
    customerOrderNumber: task.customerOrderNumber,
    referenceNumber: task.referenceNumber ?? undefined,
    kind: task.taskKind,
    consignee: {
      name: consignee.name,
      contactPhone: consignee.phone,
      address: consigneeAddress,
    },
    window: {
      date: task.deliveryDate,
      startTime: task.deliveryStartTime,
      endTime: task.deliveryEndTime,
    },
    paymentMethod: "PrePaid",
    codAmount: 0,
    declaredValue: 0,
    weightKg: task.weightKg !== null ? Number(task.weightKg) : 0,
    itemQuantity: 1,
    notes: task.notes ?? consignee.deliveryNotes ?? undefined,
    signatureRequired: task.signatureRequired,
    smsNotifications: task.smsNotifications,
    deliverToCustomerOnly: task.deliverToCustomerOnly,
  };
}
