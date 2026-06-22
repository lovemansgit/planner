// Item 3 (22 Jun 2026) — cross-tenant admin variants of the task-timeline
// server actions, for the Transcorp admin task drawer (/admin/tasks/[id]).
//
// Identical RESULT shapes to ./actions (the drawer renders them the same),
// but the service calls are the cross-tenant getAdminTaskTimeline /
// getAdminTaskHistory (gate `task:read_all`, read inside withServiceRole)
// instead of the tenant-scoped operator pair. No consigneeId arg: the
// admin surface is cross-tenant by definition and resolves the task's
// owning tenant from the task row itself. Per the R-4 read-not-audited
// convention these emit no audit event; the service layer is the gate.

"use server";

import { randomUUID } from "node:crypto";

import type { AuditEventCursor } from "@/modules/audit";
import { getAdminTaskHistory, getAdminTaskTimeline } from "@/modules/tasks";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

import type {
  GetTaskHistoryActionResult,
  GetTaskTimelineActionResult,
} from "./actions";

export async function getAdminTaskTimelineAction(
  taskId: string,
): Promise<GetTaskTimelineActionResult> {
  const requestId = randomUUID();

  try {
    const ctx = await buildRequestContext(`/admin/tasks/${taskId}`, requestId);
    const timeline = await getAdminTaskTimeline(ctx, taskId as Uuid);
    return { kind: "success", timeline };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return {
        kind: "forbidden",
        message: "You don't have permission to view the task timeline.",
      };
    }
    if (err instanceof NotFoundError) {
      return { kind: "not_found", message: "Task not found." };
    }
    if (err instanceof ValidationError) {
      return { kind: "validation", message: err.message };
    }
    throw err;
  }
}

export async function getAdminTaskHistoryAction(
  taskId: string,
  before?: AuditEventCursor,
): Promise<GetTaskHistoryActionResult> {
  const requestId = randomUUID();

  try {
    const ctx = await buildRequestContext(`/admin/tasks/${taskId}`, requestId);
    const page = await getAdminTaskHistory(ctx, taskId as Uuid, before ? { before } : undefined);
    return { kind: "success", page };
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return {
        kind: "forbidden",
        message: "You don't have permission to view the task history.",
      };
    }
    if (err instanceof NotFoundError) {
      return { kind: "not_found", message: "Task not found." };
    }
    if (err instanceof ValidationError) {
      return { kind: "validation", message: err.message };
    }
    throw err;
  }
}
