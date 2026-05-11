// Day 22 / Phase 1 forms lane — /subscriptions/new server actions.
//
// One server-action entry point dispatches by the form's `mode` field
// (subscription | single-task) per Day-19 §J-4 ruling: URL stays
// /subscriptions/new in both cases; H1 shifts client-side based on the
// selected radio.
//
// Subscription mode → createSubscription service fn (one row).
// Single-task mode  → createTask service fn (1..N rows, one per
//                     calendar day in the inclusive date range per
//                     OQ-3 ruling).
//
// Single-task date-range loops createTask sequentially. Partial failure
// surfaces as a `partial_single_task` result the form renders inline —
// operator sees how many landed before the failure and can retry the
// remainder. A bulkCreateTasks dual-actor variant is a Phase-2 follow-up
// (Day-19 §J-5 left bulkCreateTasks system-only); v1 sequential loop
// keeps the audit trail per-task.

"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { createSubscription } from "@/modules/subscriptions";
import { createTask } from "@/modules/tasks/service";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import { parseSubscriptionForm } from "./_helpers";

export type CreateSubscriptionFormResult =
  | {
      readonly kind: "subscription_created";
      readonly subscriptionId: string;
      readonly consigneeId: string;
    }
  | {
      readonly kind: "single_task_created";
      readonly taskIds: ReadonlyArray<string>;
      readonly consigneeId: string;
    }
  | {
      readonly kind: "partial_single_task";
      readonly createdTaskIds: ReadonlyArray<string>;
      readonly failedDate: string;
      readonly message: string;
    }
  | {
      readonly kind: "validation";
      readonly fieldErrors: Readonly<Record<string, string>>;
    }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

type Mode = "subscription" | "single-task";

function readMode(formData: FormData): Mode {
  return formData.get("mode") === "single-task" ? "single-task" : "subscription";
}

export async function createSubscriptionFormAction(
  _prevState: CreateSubscriptionFormResult | { kind: "idle" },
  formData: FormData,
): Promise<CreateSubscriptionFormResult> {
  const mode = readMode(formData);
  return mode === "subscription"
    ? handleSubscriptionMode(formData)
    : handleSingleTaskMode(formData);
}

async function handleSubscriptionMode(
  formData: FormData,
): Promise<CreateSubscriptionFormResult> {
  const requestId = randomUUID();
  const parsed = parseSubscriptionForm(formData);
  if (!parsed.ok) {
    return { kind: "validation", fieldErrors: parsed.fieldErrors };
  }

  try {
    const ctx = await buildRequestContext("/subscriptions/new", requestId);
    const sub = await createSubscription(ctx, parsed.value);
    revalidatePath("/subscriptions", "page");
    revalidatePath(`/consignees/${sub.consigneeId}`, "page");
    return {
      kind: "subscription_created",
      subscriptionId: sub.id,
      consigneeId: sub.consigneeId,
    };
  } catch (err) {
    return mapServiceError(err, "subscription");
  }
}

async function handleSingleTaskMode(
  formData: FormData,
): Promise<CreateSubscriptionFormResult> {
  const requestId = randomUUID();
  const trimmed = (key: string): string => {
    const v = formData.get(key);
    return typeof v === "string" ? v.trim() : "";
  };

  const fieldErrors: Record<string, string> = {};

  const consigneeId = trimmed("consignee_id");
  if (consigneeId.length === 0) {
    fieldErrors.consignee_id = "Pick a consignee.";
  }

  const startDate = trimmed("start_date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    fieldErrors.start_date = "Start date is required (YYYY-MM-DD).";
  }

  const endDateRaw = trimmed("end_date");
  const isRange = trimmed("is_range") === "on";
  const endDate =
    isRange && endDateRaw.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(endDateRaw)
      ? endDateRaw
      : null;
  if (isRange && endDate === null) {
    fieldErrors.end_date = "End date is required when scheduling a range.";
  }
  if (endDate !== null && endDate < startDate) {
    fieldErrors.end_date = "End date must be on or after start date.";
  }

  const windowStart = trimmed("window_start");
  const windowEnd = trimmed("window_end");
  if (!/^\d{2}:\d{2}$/.test(windowStart) || !/^\d{2}:\d{2}$/.test(windowEnd)) {
    fieldErrors.window = "Delivery window start and end are required (HH:MM).";
  } else if (windowStart >= windowEnd) {
    fieldErrors.window = "Delivery window end must be after start.";
  }

  const notes = trimmed("notes");
  const customerOrderNumberRaw = trimmed("customer_order_number");

  if (Object.keys(fieldErrors).length > 0) {
    return { kind: "validation", fieldErrors };
  }

  // Build the inclusive date list. v1 single-task mode applies no
  // weekday filter — every day in [startDate, endDate] generates one
  // ad-hoc task. Operators wanting weekday cadence should use
  // subscription mode instead.
  const dates = enumerateDates(startDate, endDate);

  const createdTaskIds: string[] = [];
  try {
    const ctx = await buildRequestContext("/subscriptions/new", requestId);

    for (const date of dates) {
      const orderNumber =
        customerOrderNumberRaw.length > 0
          ? `${customerOrderNumberRaw}-${date}`
          : `AD-HOC-${date}-${randomUUID().slice(0, 8).toUpperCase()}`;
      try {
        const task = await createTask(ctx, {
          consigneeId: consigneeId as Uuid,
          createdVia: "manual_admin",
          customerOrderNumber: orderNumber,
          deliveryDate: date,
          deliveryStartTime: `${windowStart}:00`,
          deliveryEndTime: `${windowEnd}:00`,
          notes: notes.length > 0 ? notes : undefined,
          packages: [{ position: 1 }],
        });
        createdTaskIds.push(task.id);
      } catch (err) {
        // Partial-failure surface: report what landed + which date
        // failed + the underlying error message. Operator decides
        // whether to retry.
        const message =
          err instanceof ValidationError
            ? err.message
            : err instanceof ConflictError
              ? err.message
              : err instanceof ForbiddenError
                ? "Permission denied mid-batch."
                : err instanceof NotFoundError
                  ? "Consignee not found mid-batch."
                  : "Unexpected error mid-batch.";
        return {
          kind: "partial_single_task",
          createdTaskIds,
          failedDate: date,
          message,
        };
      }
    }

    revalidatePath("/tasks", "page");
    revalidatePath(`/consignees/${consigneeId}`, "page");
    return {
      kind: "single_task_created",
      taskIds: createdTaskIds,
      consigneeId,
    };
  } catch (err) {
    return mapServiceError(err, "task");
  }
}

function enumerateDates(start: string, end: string | null): string[] {
  if (end === null || end === start) return [start];
  const out: string[] = [];
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [start];
  for (let t = startMs; t <= endMs; t += 86400000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

function mapServiceError(
  err: unknown,
  resource: "subscription" | "task",
): CreateSubscriptionFormResult {
  if (err instanceof ConflictError) {
    return { kind: "conflict", message: err.message };
  }
  if (err instanceof ForbiddenError) {
    return {
      kind: "forbidden",
      message: `You don't have permission to create ${resource === "subscription" ? "subscriptions" : "tasks"}.`,
    };
  }
  if (err instanceof NotFoundError) {
    return {
      kind: "not_found",
      message: resource === "subscription" ? "Consignee not found." : "Resource not found.",
    };
  }
  if (err instanceof ValidationError) {
    return { kind: "validation", fieldErrors: { _form: err.message } };
  }
  throw err;
}
