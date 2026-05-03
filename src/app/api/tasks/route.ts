// /api/tasks — collection routes (GET only).
//
// GET /api/tasks    task:read    (no audit, per R-4)
//
// Per the Day-5 design call (memory/decision_task_module_no_user_create_delete.md):
// no POST endpoint. Tasks are created by the cron and the migration-
// import flow (Transcorp Systems Team only); user-facing creation is
// not in pilot scope.
//
// Auth (Day 10): buildRequestContext resolves the Supabase Auth session
// to a per-tenant RequestContext; UnauthorizedError surfaces as 401 via
// errorResponse. Posture A graceful migration keeps the demo-context
// fallthrough behind ALLOW_DEMO_AUTH=true (Preview-only) until the
// post-soak Posture B follow-up retires it.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { listTasks } from "@/modules/tasks";
import { buildRequestContext } from "@/shared/request-context";

import { errorResponse } from "../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// -----------------------------------------------------------------------------
// GET /api/tasks
// -----------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const ctx = await buildRequestContext("/api/tasks", requestId);
    const rows = await listTasks(ctx);
    return NextResponse.json({ tasks: rows });
  } catch (e) {
    return errorResponse(e);
  }
}
