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

import { listAllTaskIds } from "@/modules/tasks";
import { buildRequestContext } from "@/shared/request-context";

import { parseCourierStatusParam } from "@/app/(app)/tasks/status";

import { errorResponse } from "../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// D56 Lane 3 — the across-pages select uses the SAME fine courier_status
// filter as the /tasks page (single param, single filter). Reuse the shared
// parser so the route and page never drift; unknown / stale-coarse values
// silently degrade to "no filter" (the All view) rather than 4xx.

export async function GET(req: Request): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const url = new URL(req.url);
    const status = parseCourierStatusParam(url.searchParams.get("status") ?? undefined);
    const ctx = await buildRequestContext("/api/tasks/visible-ids", requestId);
    const ids = await listAllTaskIds(ctx, { status });
    return NextResponse.json({ taskIds: ids, total: ids.length });
  } catch (e) {
    return errorResponse(e);
  }
}
