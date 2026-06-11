// POD photo proxy — pure seams. Day-53 PM, Love-ruled UAT-blocking
// (memory/decision_d53_pm_uat_calls.md ruling 4; grounding in
// memory/followup_pod_broken_image_pre_existing.md shape (e)).
//
// SF delivers POD photos as S3 pre-signed URLs (SigV4, X-Amz-Expires
// 604800 = 7 days, minted ~1s before the DELIVERED webhook lands —
// verified on real rows Day-53). Stored verbatim in tasks.pod_photos
// and rendered directly, they break two ways: the browser can refuse
// the S3 response even within TTL (observed ERR_BLOCKED_BY_RESPONSE,
// Day-33), and S3 hard-403s after TTL ("Request has expired" XML —
// probed server-side Day-53). The smallest Planner-only fix: operator
// surfaces render a same-origin authenticated proxy path; the route
// fetches the stored URL SERVER-side (immune to browser policy) and
// streams the bytes. Past-TTL rows are vendor-dead (only SF can
// re-sign) and surface as 410 — durable ingest-time capture is the
// flagged post-UAT follow-on, not this fix.
//
// Import-light (no db, no server-only): podProxyPhotoPaths is consumed
// by client components; classifyPodUpstreamResponse by the route.

/**
 * Map stored POD photos to their same-origin proxy paths by index.
 * Null/empty pass through unchanged so the pod-state surfacing
 * contract (null/[] → muted) is preserved.
 */
export function podProxyPhotoPaths(
  taskId: string,
  photos: readonly string[] | null,
): readonly string[] | null {
  if (photos === null) return null;
  return photos.map((_, index) => `/api/tasks/${taskId}/pod/${index}`);
}

export type PodUpstreamClass = "ok" | "expired" | "upstream_error";

/**
 * Classify the S3 fetch outcome. 403 is the observed expired-signature
 * shape (AccessDenied "Request has expired"); a 200 whose body is not
 * image bytes is S3's error envelope, never renderable.
 */
export function classifyPodUpstreamResponse(
  status: number,
  contentType: string | null,
): PodUpstreamClass {
  if (status === 200 && contentType !== null && contentType.startsWith("image/")) {
    return "ok";
  }
  if (status === 403) return "expired";
  return "upstream_error";
}
