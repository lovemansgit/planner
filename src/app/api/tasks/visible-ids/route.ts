// /api/tasks/visible-ids — Day 17 / Session B
//
// GET /api/tasks/visible-ids?status=...   task:read    (no audit, per R-4)
//
// Lightweight companion to the /tasks list view. Powers the
// "Select all X tasks" across-pages action: the operator's browser
// asks for every visible task ID matching the current filter so it
// can populate the Print Labels selection in one round-trip.
//
// Why a separate route from /api/tasks: that handler returns the full
// Task + packages payload, which is unnecessary (and over-the-wire
// expensive) for a select-all use case where only the IDs cross the
// boundary. This route is the minimal surface — IDs + total count.
//
// Tenant scope: identical to listTasks via the service layer's
// task:read permission gate; RLS does the actual filtering. Status
// filter validated through the same parser the page uses so an
// invalid status silently degrades to "no filter" rather than 4xx.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { listAllTaskIds, type TaskInternalStatus } from "@/modules/tasks";
import { buildRequestContext } from "@/shared/request-context";

import { errorResponse } from "../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Local validation set — keep the API route self-contained; the same
// vocabulary is the wire-level TaskInternalStatus union. Unknown
// values silently degrade to "no filter" rather than 4xx so that a
// stale bookmark with a renamed status doesn't break operator flow
// (matches the page-level parseStatusParam posture).
const VALID_STATUSES: ReadonlySet<string> = new Set([
  "CREATED",
  "ASSIGNED",
  "IN_TRANSIT",
  "DELIVERED",
  "FAILED",
  "CANCELED",
  "ON_HOLD",
] as const);

function parseStatus(raw: string | null): TaskInternalStatus | undefined {
  if (raw === null || !VALID_STATUSES.has(raw)) return undefined;
  return raw as TaskInternalStatus;
}

export async function GET(req: Request): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const url = new URL(req.url);
    const status = parseStatus(url.searchParams.get("status"));
    const ctx = await buildRequestContext("/api/tasks/visible-ids", requestId);
    const ids = await listAllTaskIds(ctx, { status });
    return NextResponse.json({ taskIds: ids, total: ids.length });
  } catch (e) {
    return errorResponse(e);
  }
}
