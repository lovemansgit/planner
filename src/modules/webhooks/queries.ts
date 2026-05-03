// Webhook configuration page queries (Day 9 / P4a).
//
// Read-only aggregations powering the /admin/webhook-config page:
//   - Tier-2 credential mismatch count over the last 24 hours,
//     sourced from `audit_events` filtered to webhook.auth_failed
//   - Whether Tier 2 is configured for the requesting tenant,
//     sourced from `tenant_suitefleet_webhook_credentials` row presence
//
// Tier-1 success counts, last-received-at, 401-by-reason breakdowns are
// NOT implemented here — receiver-side persistence doesn't exist for
// those signals (D8-8 deliberately observation-only). Adding them
// would require schema (T3) work; deferred to a future commit.
//
// Permission gating:
//   - Both queries require `webhook_config:read`
//   - Tenant Admin: TENANT_SCOPED auto-pickup
//   - Ops Manager: explicit-list addition (see roles.ts)
//   - CS Agent: NOT included (admin-tier visibility)
//
// RLS posture:
//   - audit_events RLS filters on app.current_tenant_id
//   - tenant_suitefleet_webhook_credentials RLS filters on app.current_tenant_id
//   - Both wrapped in withTenant — RLS engages, cross-tenant rows invisible
//   - Defence-in-depth: explicit `tenant_id = $1` in WHERE alongside RLS
//
// Read-not-audited per R-4 — listing config is operator-routine, not a
// state change. No audit emit on this path.

import { sql as sqlTag } from "drizzle-orm";

import { requirePermission } from "../identity";
import { withTenant } from "../../shared/db";
import { ValidationError } from "../../shared/errors";
import type { RequestContext } from "../../shared/tenant-context";
import type { Uuid } from "../../shared/types";

/**
 * Narrow `ctx.tenantId` from `Uuid | null` to `Uuid`. Mirrors the
 * `assertTenantScoped` pattern used in failed-pushes/service.ts for
 * the same purpose. Throws `ValidationError` when null — webhook-
 * config queries are tenant-scoped read paths and have no
 * cross-tenant variant.
 */
function assertTenantScoped(
  ctx: RequestContext,
  forOperation: string,
): asserts ctx is RequestContext & { tenantId: Uuid } {
  if (!ctx.tenantId) {
    throw new ValidationError(`${forOperation} requires a tenant context`);
  }
}

// =============================================================================
// Tier-2 mismatch count (last 24h)
// =============================================================================

export interface Tier2MismatchSummary {
  /** Total count of webhook.auth_failed audit events for this tenant in the last 24h. */
  readonly count: number;
}

/**
 * Count Tier-2 credential mismatches for the requesting tenant over
 * the last 24 hours. Returns 0 when no mismatches occurred OR Tier 2
 * is not configured for the tenant (no creds row → no possible
 * mismatch).
 *
 * The page UX distinguishes "no mismatches because Tier 2 not configured"
 * from "no mismatches because all attempts succeeded" by querying
 * `tier2CredentialsConfigured` separately and combining at the render layer.
 */
export async function countTier2MismatchesLast24h(
  ctx: RequestContext,
): Promise<Tier2MismatchSummary> {
  requirePermission(ctx, "webhook_config:read");
  assertTenantScoped(ctx, "webhook_config:countTier2Mismatches");
  const tenantId: Uuid = ctx.tenantId;
  return withTenant(tenantId, async (tx) => {
    const result = await tx.execute<{ count: number | string }>(sqlTag`
      SELECT COUNT(*)::int AS count
      FROM audit_events
      WHERE tenant_id = ${tenantId}
        AND event_type = 'webhook.auth_failed'
        AND created_at >= now() - interval '24 hours'
    `);
    const rows = result as unknown as ReadonlyArray<{ count: number | string }>;
    const raw = rows[0]?.count ?? 0;
    const count = typeof raw === "string" ? parseInt(raw, 10) : raw;
    return { count };
  });
}

// =============================================================================
// Tier-2 configured (creds row presence)
// =============================================================================

/**
 * Returns true when a row exists in `tenant_suitefleet_webhook_credentials`
 * for the requesting tenant. False when no row exists (Tier 1 only —
 * default for production merchants per the P2 reshape).
 *
 * RLS isolates rows by tenant; the query returns at most 1 row even if
 * cross-tenant rows existed in the table. Defence-in-depth: explicit
 * `tenant_id = $1` alongside RLS.
 */
export async function tier2CredentialsConfigured(
  ctx: RequestContext,
): Promise<boolean> {
  requirePermission(ctx, "webhook_config:read");
  assertTenantScoped(ctx, "webhook_config:tier2CredentialsConfigured");
  const tenantId: Uuid = ctx.tenantId;
  return withTenant(tenantId, async (tx) => {
    const result = await tx.execute<{ configured: boolean }>(sqlTag`
      SELECT EXISTS (
        SELECT 1
        FROM tenant_suitefleet_webhook_credentials
        WHERE tenant_id = ${tenantId}
      ) AS configured
    `);
    const rows = result as unknown as ReadonlyArray<{ configured: boolean }>;
    return rows[0]?.configured ?? false;
  });
}

// =============================================================================
// Webhook URL builder (pure derivation — no DB)
// =============================================================================

/**
 * Build the per-tenant webhook URL using the PUBLIC_BASE_URL env var
 * with a fallback to the current production alias. The page renders
 * an inline note alerting operators that the URL reflects the current
 * deploy environment — copying a Preview-deploy URL into the SF
 * portal would route webhooks to a non-production receiver.
 *
 * Pure derivation; safe to call without DB / RLS context. Lives in
 * the queries module rather than inline in the route file so unit
 * tests can pin the URL shape without booting the page.
 */
export function buildWebhookUrl(tenantId: Uuid, baseUrl: string): string {
  const normalised = baseUrl.replace(/\/+$/, "");
  return `${normalised}/api/webhooks/suitefleet/${tenantId}`;
}

const FALLBACK_BASE_URL = "https://planner-olive-sigma.vercel.app";

/**
 * Resolve the public base URL from env. Returns the configured
 * PUBLIC_BASE_URL or the current Production alias as fallback.
 */
export function resolvePublicBaseUrl(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.PUBLIC_BASE_URL ?? FALLBACK_BASE_URL;
}
