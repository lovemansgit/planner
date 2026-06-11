// Shared task-timeline server actions — Day-53 EVE relocation.
//
// Moved VERBATIM from src/app/(app)/consignees/[id]/_calendar-actions.ts
// (Action 8 + the Day-52 R8 history sibling) so the TaskTimelineDrawer
// and its data layer are importable outside consignees/[id]/** —
// unblocks R6-part-2's /tasks AWB→drawer entry point
// (memory/followup_r6_part2_awb_drawer.md). Zero behavior change; the
// permission gates stay in the service layer (task:view_timeline).

"use server";

import { randomUUID } from "node:crypto";

import type { AuditEventCursor } from "@/modules/audit";
import {
  getTaskHistory,
  getTaskTimeline,
  type TaskHistoryPage,
  type TaskTimeline,
} from "@/modules/tasks";
import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/shared/errors";
import { buildRequestContext } from "@/shared/request-context";
import type { Uuid } from "@/shared/types";

// -----------------------------------------------------------------------------
// Action 8 — Fetch task timeline (read-only, drawer)
// -----------------------------------------------------------------------------
//
// Lightweight server-action wrapper so the timeline drawer (client
// component) can fetch on open without a separate route handler. Per
// R-4 read-not-audited convention, no audit emit; the service-layer
// `getTaskTimeline` is the permission gate.

export type GetTaskTimelineActionResult =
  | { readonly kind: "success"; readonly timeline: TaskTimeline }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string }
  | { readonly kind: "validation"; readonly message: string };

export async function getTaskTimelineAction(
  consigneeId: string,
  taskId: string,
): Promise<GetTaskTimelineActionResult> {
  const requestId = randomUUID();

  try {
    const ctx = await buildRequestContext(`/consignees/${consigneeId}`, requestId);
    const timeline = await getTaskTimeline(ctx, taskId as Uuid);
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

// -----------------------------------------------------------------------------
// Day-52 / R8 — Fetch task audit history (read-only, drawer History section)
// -----------------------------------------------------------------------------
//
// Sibling to getTaskTimelineAction for the drawer's collapsible History
// section. Batched per the R8 ruling: first call omits `before`, the
// "Show more" control passes the page's nextCursor back. Per R-4
// read-not-audited convention, no audit emit; the service-layer
// `getTaskHistory` is the permission gate (task:view_timeline,
// ruling 5 — same gate as the drawer).

export type GetTaskHistoryActionResult =
  | { readonly kind: "success"; readonly page: TaskHistoryPage }
  | { readonly kind: "forbidden"; readonly message: string }
  | { readonly kind: "not_found"; readonly message: string }
  | { readonly kind: "validation"; readonly message: string };

export async function getTaskHistoryAction(
  consigneeId: string,
  taskId: string,
  before?: AuditEventCursor,
): Promise<GetTaskHistoryActionResult> {
  const requestId = randomUUID();

  try {
    const ctx = await buildRequestContext(`/consignees/${consigneeId}`, requestId);
    const page = await getTaskHistory(ctx, taskId as Uuid, before ? { before } : undefined);
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
