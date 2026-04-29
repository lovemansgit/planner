// /api/tasks — collection routes (GET only).
//
// GET /api/tasks    task:read    (no audit, per R-4)
//
// Per the Day-5 design call (memory/decision_task_module_no_user_create_delete.md):
// no POST endpoint. Tasks are created by the cron and the migration-
// import flow (Transcorp Systems Team only); user-facing creation is
// not in pilot scope.
//
// Auth wiring is deferred — every request goes through the demo
// context (first tenant in DB, full Tenant Admin permission set).
// When real auth lands, only `buildDemoContext` is replaced; this
// file's permission gates and error mappings are unaffected.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { listTasks } from "@/modules/tasks";
import { buildDemoContext } from "@/shared/demo-context";

import { errorResponse } from "../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// -----------------------------------------------------------------------------
// GET /api/tasks
// -----------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const ctx = await buildDemoContext("/api/tasks", requestId);
    const rows = await listTasks(ctx);
    return NextResponse.json({ tasks: rows });
  } catch (e) {
    return errorResponse(e);
  }
}
