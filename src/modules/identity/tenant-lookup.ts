// Tenant existence lookup for the webhook receiver hardening (D8-8).
//
// Webhook receivers run without tenant context bound (they ARE the
// boundary that resolves a tenant from the URL). To enforce that an
// inbound webhook's path-embedded tenant UUID corresponds to a real,
// non-deactivated tenant, we run a service-role lookup here.
//
// Status policy: 'provisioning' and 'active' both accept webhooks.
// 'suspended' and 'inactive' deny. Reasoning:
//   - 'provisioning' tenants may be in operator-side onboarding;
//     webhook configuration validation can fire test events before
//     status flips to 'active'.
//   - 'active' is the steady-state operational status.
//   - 'suspended' is a deliberate operator-initiated lockdown; webhooks
//     are dropped at the receiver layer to prevent accidental state
//     mutation while suspended.
//   - 'inactive' is terminal; webhooks are dropped.
//
// Returned shape is a boolean rather than the row itself — the
// receiver only needs the gate decision, and exposing more data here
// would invite scope creep (the receiver is not the place to grow
// tenant-attribute access).

import { sql as sqlTag } from "drizzle-orm";

import { withServiceRole } from "../../shared/db";
import type { Uuid } from "../../shared/types";

const ACCEPT_WEBHOOKS_REASON = "webhook receiver: accept-webhooks gate";

/**
 * Returns true when a tenant row exists with a status that accepts
 * inbound webhooks ('provisioning' or 'active'). Returns false when
 * the tenant does not exist OR exists with a denied status
 * ('suspended', 'inactive').
 *
 * The collapse to boolean is deliberate — see file header. The route
 * handler treats both no-row and denied-status as 401 (existence-
 * oracle masking), so distinguishing them at this layer would be
 * thrown away upstream.
 */
export async function tenantAcceptsWebhooks(tenantId: Uuid): Promise<boolean> {
  return withServiceRole(ACCEPT_WEBHOOKS_REASON, async (tx) => {
    const result = await tx.execute<{ accepts: boolean }>(sqlTag`
      SELECT 1 AS accepts
      FROM tenants
      WHERE id = ${tenantId}
        AND status IN ('provisioning', 'active')
      LIMIT 1
    `);
    const rows = result as unknown as ReadonlyArray<{ accepts: boolean }>;
    return rows.length > 0;
  });
}
