// GET /api/admin/tasks/[id]/pod/[index]   task:read_all → POD photo bytes
//
// Cross-tenant Transcorp-admin sibling of /api/tasks/[id]/pod/[index]
// (Day-56, plan #532 §Phase-4 / A3). The operator route is single-tenant
// (assertTenantScoped + withTenant) and 404s when an admin views another
// merchant's task, so the /admin/tasks POD cell shipped raw S3 URLs and broke.
// This route is the cross-tenant-gated variant the POD memo always named
// (followup_pod_broken_image_pre_existing.md deferred item 2;
// followup_admin_pod_proxy_cross_tenant.md).
//
// Same posture as the operator route — captured-first, then the vendor URL
// fetched SERVER-side (immune to browser response policy), H3 placeholder on
// vendor-expiry, 502 on upstream error — but gated on `task:read_all` (the
// boundary listAllTasks trusts for cross-tenant task data) and reading under
// withServiceRole so an admin can resolve ANY merchant's POD. The operator
// browser never sees the SF host or the signed URL — only this Planner path.
//
// Status mapping:
//   captured copy exists  → 200, stored bytes, longer private cache
//   200 image/*           → 200, bytes streamed, short private cache
//   S3 403 (sig expired)  → 200 styled SVG placeholder +
//                           X-Planner-Pod-State: expired-at-vendor (H3)
//   anything else         → 502 upstream error
//   fetch threw           → 502 upstream error

import "server-only";

import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createSupabasePodObjectStore,
  getCapturedPodPhotoForAdmin,
  podExpiredPlaceholderSvg,
} from "@/modules/pod-capture";
import { getPodPhotoSourceUrlForAdmin } from "@/modules/tasks";
import { classifyPodUpstreamResponse } from "@/modules/tasks/pod-proxy";
import { buildRequestContext } from "@/shared/request-context";
import { ValidationError } from "@/shared/errors";
import { logger } from "@/shared/logger";
import type { Uuid } from "@/shared/types";

import { errorResponse } from "../../../../../_lib/error-response";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// Node runtime — withServiceRole + the S3 fetch require Node sockets.
export const runtime = "nodejs";

const log = logger.with({ component: "admin_pod_proxy_route" });

const IdParamSchema = z.string().uuid({ message: "id must be a uuid" });
// SF tasks carry a handful of photos; 50 is a generous structural bound
// that keeps the path namespace from accepting arbitrary integers.
const IndexParamSchema = z.coerce.number().int().min(0).max(50);

type RouteContext = { params: Promise<{ id: string; index: string }> };

export async function GET(_req: Request, { params }: RouteContext): Promise<Response> {
  const requestId = randomUUID();
  try {
    const { id: rawId, index: rawIndex } = await params;
    const idResult = IdParamSchema.safeParse(rawId);
    if (!idResult.success) {
      throw new ValidationError(`id must be a uuid, got '${rawId}'`);
    }
    const indexResult = IndexParamSchema.safeParse(rawIndex);
    if (!indexResult.success) {
      throw new ValidationError(`index must be a small non-negative integer, got '${rawIndex}'`);
    }

    const ctx = await buildRequestContext(
      `/api/admin/tasks/${idResult.data}/pod/${indexResult.data}`,
      requestId,
    );

    // Captured-first (cross-tenant): the durable copy outlives the vendor's
    // 7-day TTL and skips the upstream round-trip. Gated on task:read_all.
    const captured = await getCapturedPodPhotoForAdmin(
      ctx,
      idResult.data as Uuid,
      indexResult.data,
      { store: createSupabasePodObjectStore({ fetch: globalThis.fetch }) },
    );
    if (captured !== null) {
      return new NextResponse(captured.bytes, {
        status: 200,
        headers: {
          "Content-Type": captured.contentType,
          "Cache-Control": "private, max-age=86400",
          "X-Planner-Pod-State": "captured",
        },
      });
    }

    const sourceUrl = await getPodPhotoSourceUrlForAdmin(
      ctx,
      idResult.data as Uuid,
      indexResult.data,
    );

    let upstream: Response;
    try {
      upstream = await fetch(sourceUrl, { redirect: "follow" });
    } catch (fetchErr) {
      log.warn({
        operation: "admin_pod_proxy_fetch",
        error_code: "upstream_unreachable",
        task_id: idResult.data,
        photo_index: indexResult.data,
        request_id: requestId,
        message: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
      });
      return NextResponse.json(
        { error: "pod photo upstream unreachable" },
        { status: 502 },
      );
    }

    const contentType = upstream.headers.get("content-type");
    const klass = classifyPodUpstreamResponse(upstream.status, contentType);

    if (klass === "expired") {
      // H3: past-TTL pre-signed URL with no captured copy — vendor-dead.
      // Serve the styled placeholder image (an <img> cannot render an error
      // body); the header keeps the state machine-distinguishable.
      log.info({
        operation: "admin_pod_proxy_fetch",
        error_code: "expired_at_vendor",
        task_id: idResult.data,
        photo_index: indexResult.data,
        request_id: requestId,
      });
      return new NextResponse(podExpiredPlaceholderSvg(), {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml",
          "Cache-Control": "private, max-age=3600",
          "X-Planner-Pod-State": "expired-at-vendor",
        },
      });
    }
    if (klass === "upstream_error") {
      log.warn({
        operation: "admin_pod_proxy_fetch",
        error_code: "upstream_error",
        task_id: idResult.data,
        photo_index: indexResult.data,
        request_id: requestId,
        upstream_status: upstream.status,
        upstream_content_type: contentType,
      });
      return NextResponse.json(
        { error: "pod photo upstream error" },
        { status: 502 },
      );
    }

    const bytes = await upstream.arrayBuffer();
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType ?? "image/jpeg",
        // Cross-tenant authorized bytes (task:read_all); short private cache.
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
