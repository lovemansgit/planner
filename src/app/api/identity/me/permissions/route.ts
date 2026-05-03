// /api/identity/me/permissions — stub route per the Day-2 brief §4.2:
// "requirePermission middleware in use on at least one stub route."
//
// Demonstrates the requirePermission integration end-to-end:
//   1. Construct a RequestContext (anonymous for now — see below).
//   2. Call requirePermission(ctx, "user:read").
//   3. Return 200 with the actor's effective permission set on success,
//      or 403 + structured ForbiddenError on failure.
//
// Authentication middleware that constructs a real RequestContext from
// a Supabase JWT in the Authorization header lands in a later commit.
// Until then, every request gets an anonymous actor with an empty
// permission set, so requirePermission always throws and the handler
// always returns 403. This is intentional — an unauthenticated request
// SHOULD 403 here. When auth wires in, the only line of code that
// changes is `buildContext()`; the gate, the success path, and the
// error shape all stay put.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { requirePermission } from "@/modules/identity";
import { ForbiddenError } from "@/shared/errors";
import type { RequestContext } from "@/shared/tenant-context";

// Pings + auth checks must run on every request, not at build time.
// Without these, Next.js 16 would attempt to statically pre-render and
// the route would freeze at deploy time.
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Placeholder UUID for the anonymous actor. Replaced when auth wires in;
// kept as the all-zeros UUID so any audit emit firing on this path is
// visibly synthetic rather than masquerading as a real user.
const ANONYMOUS_PLACEHOLDER_UUID = "00000000-0000-0000-0000-000000000000";

function buildContext(path: string): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: ANONYMOUS_PLACEHOLDER_UUID,
      tenantId: ANONYMOUS_PLACEHOLDER_UUID,
      permissions: new Set(),
    },
    tenantId: ANONYMOUS_PLACEHOLDER_UUID,
    requestId: randomUUID(),
    path,
  };
}

export async function GET(): Promise<NextResponse> {
  const ctx = buildContext("/api/identity/me/permissions");

  try {
    requirePermission(ctx, "user:read");
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: 403 });
    }
    throw e;
  }

  return NextResponse.json({
    permissions: Array.from(ctx.actor.permissions),
  });
}
