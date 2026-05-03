// /api/subscriptions — collection routes (POST + GET).
//
// POST /api/subscriptions    subscription:create  → subscription.created
// GET  /api/subscriptions    subscription:read    (no audit, per R-4)
//
// Auth wiring is deferred — every request goes through the demo
// context (first tenant in DB, full Tenant Admin permission set).
// When real auth lands, only `buildDemoContext` is replaced; this
// file's permission gates, audit emits, and error mappings are
// unaffected.
//
// Validation: Zod schemas at the boundary catch shape errors before
// the service layer. The service layer still validates business rules
// (trimmed non-empty strings, ISO 1-7 daysOfWeek domain) — boundary
// alone is not trusted.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { createSubscription, listSubscriptions } from "@/modules/subscriptions";
import { CreateSubscriptionBodySchema } from "@/modules/subscriptions/schemas";
import { buildDemoContext } from "@/shared/demo-context";
import { ValidationError } from "@/shared/errors";

import { errorResponse } from "../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// -----------------------------------------------------------------------------
// POST /api/subscriptions
// -----------------------------------------------------------------------------

export async function POST(req: Request): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const body = (await req.json().catch(() => null)) as unknown;
    const parsed = CreateSubscriptionBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(`request body invalid: ${parsed.error.message}`);
    }

    const ctx = await buildDemoContext("/api/subscriptions", requestId);
    const created = await createSubscription(ctx, parsed.data);
    return NextResponse.json(created, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

// -----------------------------------------------------------------------------
// GET /api/subscriptions
// -----------------------------------------------------------------------------

export async function GET(): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const ctx = await buildDemoContext("/api/subscriptions", requestId);
    const rows = await listSubscriptions(ctx);
    return NextResponse.json({ subscriptions: rows });
  } catch (e) {
    return errorResponse(e);
  }
}
