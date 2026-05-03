// /api/tasks/[id]/asset-tracking — read-through asset-tracking lookup.
//
// GET /api/tasks/:id/asset-tracking   asset_tracking:read
//
// Returns the cached asset-tracking records for the task's AWB,
// filtered to packages whose internal `task_id` matches the path
// segment (a single AWB may carry packages from multiple tasks on
// split-shipment merchants). Cache miss / TTL expiry triggers an
// outbound SuiteFleet GET behind the scenes; the cache is upserted
// and the fresh rows are returned. See
// memory/decision_bag_tracking_mvp.md for the full architecture.
//
// Same demo-context + Zod-at-boundary pattern as the existing tasks
// + consignees + subscriptions routes. Returns 404 when the task is
// missing or RLS-hidden — same observable state from the caller's
// viewpoint per R-3.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getAssetTrackingForTask } from "@/modules/asset-tracking";
import { buildDemoContext } from "@/shared/demo-context";
import { ValidationError } from "@/shared/errors";

import { errorResponse } from "../../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const IdParamSchema = z.string().uuid({ message: "id must be a uuid" });

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const { id: rawId } = await params;
    const id = parseId(rawId);
    const ctx = await buildDemoContext(`/api/tasks/${id}/asset-tracking`, requestId);
    const rows = await getAssetTrackingForTask(ctx, id);
    return NextResponse.json({ assetTracking: rows });
  } catch (e) {
    return errorResponse(e);
  }
}

function parseId(raw: string): string {
  const result = IdParamSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(`id must be a uuid, got '${raw}'`);
  }
  return result.data;
}
