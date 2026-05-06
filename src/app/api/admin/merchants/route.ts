// /api/admin/merchants — collection routes (POST + GET).
//
// POST /api/admin/merchants     merchant:create     → merchant.created
// GET  /api/admin/merchants     merchant:read_all   (no audit, per R-4)
//
// Day-16 Block 4-F Commit 4 — admin merchant management routes.
// Greenfield introduction of the /api/admin/ directory; first
// transcorp_staff cross-tenant API surface in the codebase.
//
// Auth posture per Block 4-F §A Option A ruling:
//   SERVICE-LAYER-ONLY enforcement. No middleware infrastructure.
//   Service D's requirePermission(merchant:*) is the gate;
//   ForbiddenError → 403 at errorResponse handles non-staff actors.
//   The merchant:* permission family is systemOnly (per
//   identity/permissions.ts:526-560) and granted exclusively to the
//   transcorp-sysadmin role (per identity/roles.ts:183-190 ALL set).
//   Plus three compensating defense vectors documented in
//   memory/followup_admin_middleware_phase2.md (Phase 2 hardening
//   adds uniform middleware across all authenticated routes).
//
// Body shape (POST) per merged plan §6.1 row 8 (snake_case at the wire):
//   {
//     slug: <string>,
//     name: <string>,
//     pickup_address: { line: <string>, district: <string>, emirate: <string> }
//   }
//
// Wire-to-service mapping: snake_case `pickup_address` → camelCase
// `pickupAddress`; inner keys (line, district, emirate) are single
// words and pass through unchanged (matches Block 4-D §A Option C
// nested audit body shape per Block 4-D Service D commit 8c52cfb).
//
// Query params (GET) per merged plan §6.1 row 9:
//   - status: optional, 4-state enum
//   (slug filter is NOT supported — ListMerchantsFilters at
//   merchants/types.ts:133-135 declares status only; reviewer's
//   drafting text mention of a slug filter is plan-vs-prompt drift,
//   surfaced in commit message)
//
// POST success: 201 with CreateMerchantResult JSON
//   { status: 'created', tenantId }
// GET success: 200 with { merchants: Merchant[] } JSON
//
// Errors:
//   - 400 ValidationError (input shape, slug regex/length per
//                          Service D requireValidSlug, malformed JSON,
//                          invalid status query param)
//   - 403 ForbiddenError (lacks merchant:create / merchant:read_all)
//   - 409 ConflictError (slug UNIQUE collision via 23505 mapping)

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { createMerchant, listMerchants } from "@/modules/merchants";
import type {
  CreateMerchantInput,
  ListMerchantsFilters,
  TenantStatus,
} from "@/modules/merchants";
import { buildRequestContext } from "@/shared/request-context";
import { ValidationError } from "@/shared/errors";

import { errorResponse } from "../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * The 4 tenant-status states per migration 0001 CHECK constraint +
 * brief v1.3 §3.1.1. Mirrors `TenantStatus` from
 * `src/modules/merchants/types.ts:39`. Lowercase per the prod canon.
 */
const TenantStatusEnum = z.enum([
  "provisioning",
  "active",
  "suspended",
  "inactive",
]);

/**
 * POST body schema. `pickup_address` is nested per Block 4-D §A
 * Option C ruling. Inner fields all required + non-empty;
 * Service D's `requireValidSlug` runs deeper slug validation
 * (lowercase, [a-z0-9-]+, ≤60 chars) — route boundary catches
 * missing/empty only per defense-in-depth: route = first-line
 * shape; service = business rules.
 */
const PickupAddressSchema = z.object({
  line: z.string().min(1),
  district: z.string().min(1),
  emirate: z.string().min(1),
});

const CreateMerchantBodySchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  pickup_address: PickupAddressSchema,
});

// -----------------------------------------------------------------------------
// POST /api/admin/merchants
// -----------------------------------------------------------------------------

export async function POST(req: Request): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const body = parseCreateBody(await req.json().catch(() => undefined));

    const ctx = await buildRequestContext("/api/admin/merchants", requestId);

    const serviceInput: CreateMerchantInput = {
      slug: body.slug,
      name: body.name,
      pickupAddress: {
        line: body.pickup_address.line,
        district: body.pickup_address.district,
        emirate: body.pickup_address.emirate,
      },
    };

    const result = await createMerchant(ctx, serviceInput);
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}

// -----------------------------------------------------------------------------
// GET /api/admin/merchants
// -----------------------------------------------------------------------------

export async function GET(req: Request): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const filters = parseQueryFilters(req);

    const ctx = await buildRequestContext("/api/admin/merchants", requestId);
    const merchants = await listMerchants(ctx, filters);
    return NextResponse.json({ merchants }, { status: 200 });
  } catch (e) {
    return errorResponse(e);
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function parseCreateBody(body: unknown): z.infer<typeof CreateMerchantBodySchema> {
  if (body === undefined || body === null) {
    throw new ValidationError(
      "merchants endpoint requires a body: { slug, name, pickup_address: { line, district, emirate } }",
    );
  }
  const parsed = CreateMerchantBodySchema.safeParse(body);
  if (!parsed.success) {
    throw new ValidationError(`merchants body invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

/**
 * Parse `?status=...` query param. Empty string treated as absent
 * per WATCH 4 (a stray ?status= with no value should be a no-op,
 * not a 400). Invalid enum value → ValidationError 400.
 */
function parseQueryFilters(req: Request): ListMerchantsFilters {
  const url = new URL(req.url);
  const rawStatus = url.searchParams.get("status");
  if (rawStatus === null || rawStatus === "") {
    return {};
  }
  const parsed = TenantStatusEnum.safeParse(rawStatus);
  if (!parsed.success) {
    throw new ValidationError(
      `status query param invalid: must be one of provisioning | active | suspended | inactive; got '${rawStatus}'`,
    );
  }
  return { status: parsed.data as TenantStatus };
}
