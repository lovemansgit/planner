// tests/integration/merchant-auth-method-override.spec.ts
// =============================================================================
// Day-54 — per-merchant SF auth-method override (real Postgres).
// Plan: memory/plans/day-54-sandbox-apikey-method-switch.md §5.
//
// All three tenants sit on the SAME migration-seeded sandbox region
// (transcorpsb, auth_method='oauth') — the exact production shape of
// Love's ruling: one merchant switches to api_key, siblings stay oauth.
//
// Cases pinned:
//   1. Flipped + re-credentialed merchant resolves the api_key branch
//      with the NEW vault pair.
//   2. ONE end-to-end between-states path: flip via the REAL service
//      (real tx, real vault-column clear), then resolve → CredentialError
//      (credentials_not_configured). The fail-LOUD guarantee of plan §3.
//   3. Untouched sibling on the same region still resolves oauth with
//      its original credentials.
// Plus: the flip emits the new credentials.method_changed audit event
// with the minimal sensitive-by-class shape (no plaintext, no UUIDs),
// and a same-method flip is a no-op (no clear, no emit).
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  resolveSuiteFleetCredentials,
  setMerchantAuthMethodOverride,
  storeSuitefleetCredentials,
} from "../../src/modules/credentials";
import { CredentialError } from "../../src/shared/errors";
import { withServiceRole } from "../../src/shared/db";
import type { RequestContext } from "../../src/shared/tenant-context";
import type { Permission, Uuid } from "../../src/shared/types";

const RUN_ID = randomUUID().slice(0, 8);
const TENANT_FLIPPED = randomUUID();
const TENANT_BETWEEN = randomUUID();
const TENANT_SIBLING = randomUUID();

const SYSADMIN_ACTOR = randomUUID();

function sysadminCtx(label: string): RequestContext {
  return {
    actor: {
      kind: "user",
      userId: SYSADMIN_ACTOR,
      tenantId: "00000000-0000-0000-0000-000000000000",
      permissions: new Set<Permission>(["merchant:update"]),
    },
    tenantId: null,
    requestId: `test-${RUN_ID}-${label}`,
    path: "/admin/merchants",
  };
}

const noop = vi.fn();

describe("Day-54 — per-merchant auth-method override (real Postgres)", () => {
  beforeAll(async () => {
    await withServiceRole("amo setup", async (tx) => {
      // All three on the DEFAULT sandbox region (transcorpsb, oauth).
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status, suitefleet_customer_code) VALUES
          (${TENANT_FLIPPED}, ${`amo-${RUN_ID}-flip`}, 'AMO Flipped', 'active', '701'),
          (${TENANT_BETWEEN}, ${`amo-${RUN_ID}-btwn`}, 'AMO Between', 'active', '702'),
          (${TENANT_SIBLING}, ${`amo-${RUN_ID}-sib`}, 'AMO Sibling', 'active', '703')
      `);
    });
    // Everyone starts as a normal OAuth-credentialed sandbox merchant.
    for (const [t, label] of [
      [TENANT_FLIPPED, "flip"],
      [TENANT_BETWEEN, "btwn"],
      [TENANT_SIBLING, "sib"],
    ] as const) {
      await storeSuitefleetCredentials(
        sysadminCtx(`seed-${label}`),
        t as Uuid,
        { credential1: `oauth-user-${label}`, credential2: `oauth-pass-${label}` },
        noop,
      );
    }
  });

  afterAll(async () => {
    try {
      await withServiceRole("amo teardown", async (tx) => {
        await tx.execute(sqlTag`
          DELETE FROM tenants WHERE id IN (${TENANT_FLIPPED}, ${TENANT_BETWEEN}, ${TENANT_SIBLING})
        `);
      });
    } catch {
      /* audit RULE; ignore */
    }
  });

  it("case 1 — flipped + re-credentialed merchant resolves api_key with the NEW vault pair", async () => {
    const result = await setMerchantAuthMethodOverride(
      sysadminCtx("flip-1"),
      TENANT_FLIPPED as Uuid,
      "api_key",
      noop,
    );
    expect(result.changed).toBe(true);
    expect(result.credentialsCleared).toBe(true);

    // Re-credential with the api_key pair (initial-set again — the flip
    // cleared the columns).
    await storeSuitefleetCredentials(
      sysadminCtx("flip-recred"),
      TENANT_FLIPPED as Uuid,
      { credential1: `ak-${RUN_ID}`, credential2: `sk-${RUN_ID}` },
      noop,
    );

    const creds = await resolveSuiteFleetCredentials(TENANT_FLIPPED as Uuid);
    expect(creds.auth_method).toBe("api_key");
    if (creds.auth_method === "api_key") {
      expect(creds.clientId).toBe("transcorpsb"); // SAME region — method overridden, region untouched
      expect(creds.customerId).toBe(701);
      expect(creds.apiKey).toBe(`ak-${RUN_ID}`);
      expect(creds.secretKey).toBe(`sk-${RUN_ID}`);
    }
  });

  it("case 2 — ONE end-to-end between-states path: flip via the real service, then resolve → CredentialError (fail LOUD)", async () => {
    const result = await setMerchantAuthMethodOverride(
      sysadminCtx("flip-2"),
      TENANT_BETWEEN as Uuid,
      "api_key",
      noop,
    );
    expect(result.changed).toBe(true);
    expect(result.credentialsCleared).toBe(true);

    // No re-credentialing. The next resolve — the same call every
    // outbound push makes — must throw, never misread the cleared (or
    // any stale) pair, never fall back to oauth.
    await expect(
      resolveSuiteFleetCredentials(TENANT_BETWEEN as Uuid),
    ).rejects.toBeInstanceOf(CredentialError);
    await expect(
      resolveSuiteFleetCredentials(TENANT_BETWEEN as Uuid),
    ).rejects.toThrow(/credentials not configured/);

    // The vault columns really are NULL (cleared in the flip tx).
    const [row] = await withServiceRole("amo verify cleared", async (tx) =>
      tx.execute(sqlTag`
        SELECT suitefleet_credential_1_vault_id AS v1,
               suitefleet_credential_2_vault_id AS v2,
               suitefleet_auth_method_override AS override
        FROM tenants WHERE id = ${TENANT_BETWEEN} LIMIT 1
      `),
    );
    const r = row as { v1: string | null; v2: string | null; override: string };
    expect(r.v1).toBeNull();
    expect(r.v2).toBeNull();
    expect(r.override).toBe("api_key");
  });

  it("case 3 — untouched sibling on the same region still resolves oauth with original credentials", async () => {
    const creds = await resolveSuiteFleetCredentials(TENANT_SIBLING as Uuid);
    expect(creds.auth_method).toBe("oauth");
    if (creds.auth_method === "oauth") {
      expect(creds.clientId).toBe("transcorpsb");
      expect(creds.username).toBe("oauth-user-sib");
      expect(creds.password).toBe("oauth-pass-sib");
    }
  });

  it("flip emits credentials.method_changed with the minimal sensitive-by-class shape", async () => {
    const audits = await withServiceRole("amo audit read", async (tx) =>
      tx.execute(sqlTag`
        SELECT metadata FROM audit_events
        WHERE event_type = 'credentials.method_changed'
          AND resource_id = ${TENANT_BETWEEN}
      `),
    );
    expect(audits).toHaveLength(1);
    const meta = (audits[0] as { metadata: Record<string, unknown> }).metadata;
    expect(meta).toEqual({
      tenant_id: TENANT_BETWEEN,
      previous_method: "oauth",
      new_method: "api_key",
      credentials_cleared: true,
    });
  });

  it("flip without merchant:update is Forbidden — gate matches the credentials-set envelope", async () => {
    const ctx: RequestContext = {
      actor: {
        kind: "user",
        userId: SYSADMIN_ACTOR,
        tenantId: "00000000-0000-0000-0000-000000000000",
        permissions: new Set<Permission>([]),
      },
      tenantId: null,
      requestId: `test-${RUN_ID}-forbidden`,
      path: "/admin/merchants",
    };
    await expect(
      setMerchantAuthMethodOverride(ctx, TENANT_SIBLING as Uuid, "api_key", noop),
    ).rejects.toThrow(/merchant:update|forbidden/i);
  });

  it("same-effective-method flip is a no-op — no clear, no emit", async () => {
    const result = await setMerchantAuthMethodOverride(
      sysadminCtx("noop"),
      TENANT_SIBLING as Uuid,
      "oauth", // sibling's effective method is already oauth (region default)
      noop,
    );
    expect(result.changed).toBe(false);
    expect(result.credentialsCleared).toBe(false);

    // Credentials intact; no audit row.
    const creds = await resolveSuiteFleetCredentials(TENANT_SIBLING as Uuid);
    expect(creds.auth_method).toBe("oauth");
    const audits = await withServiceRole("amo noop audit read", async (tx) =>
      tx.execute(sqlTag`
        SELECT id FROM audit_events
        WHERE event_type = 'credentials.method_changed'
          AND resource_id = ${TENANT_SIBLING}
      `),
    );
    expect(audits).toEqual([]);
  });
});
