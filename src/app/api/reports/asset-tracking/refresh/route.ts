// /api/reports/asset-tracking/refresh — manual "now" override (Day-54
// P3, Love's constraint 4 on top of the 30-minute poll).
//
// POST, no body. Two modes by actor surface:
//   - tenant operator (asset_tracking:read + tenant dark switch ON):
//     refreshes their own tenant.
//   - Transcorp staff (asset_tracking:read_all) with ?merchant=<slug>:
//     refreshes that one merchant.
//
// Bounded by construction — the underlying sweep is the SAME machine
// the 30-minute poll runs (in-motion scoping, 200-AWB cap, 10-AWB
// chunks), so the button cannot fan out beyond one poll tick's load.
// Refusals (dark tenant, unknown merchant) surface as 403/404 via the
// shared error mapper.

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  refreshMerchantAssetTracking,
  refreshTenantAssetTracking,
} from "@/modules/asset-tracking/report-service";
import { buildRequestContext } from "@/shared/request-context";

import { errorResponse } from "../../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 300;

export async function POST(req: Request): Promise<NextResponse> {
  const requestId = randomUUID();
  try {
    const url = new URL(req.url);
    const merchantSlug = url.searchParams.get("merchant");
    const ctx = await buildRequestContext("/api/reports/asset-tracking/refresh", requestId);
    const summary =
      merchantSlug !== null && merchantSlug.length > 0
        ? await refreshMerchantAssetTracking(ctx, merchantSlug)
        : await refreshTenantAssetTracking(ctx);
    return NextResponse.json({ refresh: summary });
  } catch (e) {
    return errorResponse(e);
  }
}
