// Day 22 / Phase 1 forms lane — edit-subscription server actions.
//
// Three actions:
//   - editSubscriptionAction      (calls updateSubscription)
//   - pauseSubscriptionAction     (calls pauseSubscription with bounded
//                                  pause input per brief §3.1.7)
//   - resumeSubscriptionAction    (calls resumeSubscription)

"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import {
  pauseSubscription,
  resumeSubscription,
  updateSubscription,
} from "@/modules/subscriptions";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import { parseEditSubscriptionForm } from "./_helpers";

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export type EditSubscriptionActionResult =
  | { readonly kind: "updated"; readonly subscriptionId: string }
  | {
      readonly kind: "validation";
      readonly fieldErrors: Readonly<Record<string, string>>;
    }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

export async function editSubscriptionAction(
  subscriptionId: string,
  _prevState: EditSubscriptionActionResult | { kind: "idle" },
  formData: FormData,
): Promise<EditSubscriptionActionResult> {
  const requestId = randomUUID();
  const parsed = parseEditSubscriptionForm(formData);
  if (!parsed.ok) {
    return { kind: "validation", fieldErrors: parsed.fieldErrors };
  }

  try {
    const ctx = await buildRequestContext(
      `/subscriptions/${subscriptionId}/edit`,
      requestId,
    );
    await updateSubscription(ctx, subscriptionId as Uuid, parsed.value);
    revalidatePath(`/subscriptions/${subscriptionId}`, "page");
    revalidatePath(`/subscriptions/${subscriptionId}/edit`, "page");
    return { kind: "updated", subscriptionId };
  } catch (err) {
    return mapError(err, "edit");
  }
}

// ---------------------------------------------------------------------------
// Pause
// ---------------------------------------------------------------------------

export type PauseSubscriptionActionResult =
  | { readonly kind: "paused"; readonly newEndDate: string; readonly canceledTasks: number }
  | { readonly kind: "validation"; readonly message: string }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

export async function pauseSubscriptionAction(
  subscriptionId: string,
  _prevState: PauseSubscriptionActionResult | { kind: "idle" },
  formData: FormData,
): Promise<PauseSubscriptionActionResult> {
  const requestId = randomUUID();
  const trimmed = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" ? v.trim() : "";
  };

  const pauseStart = trimmed("pause_start");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pauseStart)) {
    return { kind: "validation", message: "Pause start date is required (YYYY-MM-DD)." };
  }
  const pauseEnd = trimmed("pause_end");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pauseEnd)) {
    return { kind: "validation", message: "Pause end date is required (YYYY-MM-DD)." };
  }
  if (pauseEnd <= pauseStart) {
    return { kind: "validation", message: "Pause end must be after pause start." };
  }
  const reason = trimmed("reason");
  const idempotencyKey = trimmed("idempotency_key") || randomUUID();

  try {
    const ctx = await buildRequestContext(
      `/subscriptions/${subscriptionId}/edit`,
      requestId,
    );
    const result = await pauseSubscription(ctx, subscriptionId as Uuid, {
      pause_start: pauseStart,
      pause_end: pauseEnd,
      reason: reason.length > 0 ? reason : undefined,
      idempotency_key: idempotencyKey,
    });
    revalidatePath(`/subscriptions/${subscriptionId}`, "page");
    revalidatePath(`/subscriptions/${subscriptionId}/edit`, "page");
    revalidatePath("/tasks", "page");
    return {
      kind: "paused",
      newEndDate: result.new_end_date,
      canceledTasks: result.canceled_task_count,
    };
  } catch (err) {
    const mapped = mapError(err, "pause");
    if (mapped.kind === "validation") {
      return { kind: "validation", message: mapped.fieldErrors._form ?? "Pause failed." };
    }
    return mapped as PauseSubscriptionActionResult;
  }
}

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------

export type ResumeSubscriptionActionResult =
  | { readonly kind: "resumed"; readonly newEndDate: string | null; readonly restoredTasks: number }
  | { readonly kind: "already_active" }
  | { readonly kind: "conflict"; readonly message: string }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string };

export async function resumeSubscriptionAction(
  subscriptionId: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _prevState: ResumeSubscriptionActionResult | { kind: "idle" },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData,
): Promise<ResumeSubscriptionActionResult> {
  const requestId = randomUUID();
  try {
    const ctx = await buildRequestContext(
      `/subscriptions/${subscriptionId}/edit`,
      requestId,
    );
    const result = await resumeSubscription(ctx, subscriptionId as Uuid, {
      idempotency_key: randomUUID(),
    });
    revalidatePath(`/subscriptions/${subscriptionId}`, "page");
    revalidatePath(`/subscriptions/${subscriptionId}/edit`, "page");
    revalidatePath("/tasks", "page");
    if (result.status === "already_active") {
      return { kind: "already_active" };
    }
    return {
      kind: "resumed",
      newEndDate: result.new_end_date,
      restoredTasks: result.restored_task_count,
    };
  } catch (err) {
    if (err instanceof ConflictError) return { kind: "conflict", message: err.message };
    if (err instanceof ForbiddenError) {
      return { kind: "forbidden", message: "You don't have permission to resume subscriptions." };
    }
    if (err instanceof NotFoundError) {
      return { kind: "not_found", message: "Subscription not found." };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Shared error mapper for edit + pause paths.
// ---------------------------------------------------------------------------

function mapError(
  err: unknown,
  op: "edit" | "pause",
): EditSubscriptionActionResult {
  if (err instanceof ConflictError) {
    return { kind: "conflict", message: err.message };
  }
  if (err instanceof ForbiddenError) {
    return {
      kind: "forbidden",
      message: `You don't have permission to ${op} this subscription.`,
    };
  }
  if (err instanceof NotFoundError) {
    return { kind: "not_found", message: "Subscription not found." };
  }
  if (err instanceof ValidationError) {
    return { kind: "validation", fieldErrors: { _form: err.message } };
  }
  throw err;
}
