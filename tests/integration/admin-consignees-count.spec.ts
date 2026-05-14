// tests/integration/admin-consignees-count.spec.ts
// =============================================================================
// Day-24 PM schema-drift regression pin for countAllConsigneesRows.
//
// Cases pinned:
//   1. empty filter returns full count (matches seeded live-tenant set)
//   2. merchantSlug narrows to that tenant's consignees
//   3. searchTerm narrows (name match + phone digit-stripping + merchant name)
//   4. archived tenant rows excluded
//
// Fixture-construction note (latent collision bug fix):
//
// `buildAdminConsigneeSearchFilter` at
// src/modules/consignees/repository.ts:350-361 evaluates `searchTerm`
// as a 3-way OR across consignee.name + consignee.phone (search digits
// vs stored phone via ILIKE) + tenant.name — and the phone branch
// fires whenever the search term contains ANY digit. The earlier
// fixture wove `RUN_ID` (an 8-char hex slice — may include digits) into
// SEARCH_NAME, NAME_LIVE, AND the digit-stripped PHONE_DIGITS. That
// arrangement made every `it(...)` non-deterministic: on an unlucky
// RUN_ID draw, the digit content of one fixture's name lit up the
// phone-OR branch and matched another fixture's phone (which itself
// contained RUN_ID's digits), so "1 of 2 on live tenant" silently
// landed 2.
//
// Surfaced on a CI failure under PR #282 (slug-edit removal), but the
// PR only perturbed vitest execution order — the latent bug pre-dates
// it. Fix: keep RUN_ID for slug uniqueness across CI runs (slugs are
// not searched), but build a separate digit-free RUN_TAG for the
// searchable fields, and use FIXED distinct digit patterns for the
// phones so within-spec collisions are structurally impossible
// regardless of RUN_ID's draw.
//
// Cross-run isolation is preserved by the `merchantSlug` filter — every
// query narrows to this run's tenant via RUN_ID-bearing slug, so any
// stale rows from prior runs (per memory/followup_audit_rule_cascade_conflict.md
// audit-RULE teardown leaks) cannot influence the count.
// =============================================================================

import { randomUUID } from "node:crypto";

import { sql as sqlTag } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { countAllConsigneesRows } from "../../src/modules/consignees/repository";
import { withServiceRole } from "../../src/shared/db";

// RUN_ID: hex slice (a-f + 0-9). Used for tenant UUIDs (not searched)
// and slugs (UNIQUE-constrained, not searched by
// buildAdminConsigneeSearchFilter). Digit content here is harmless.
const RUN_ID = randomUUID().slice(0, 8);

// RUN_TAG: alphabetic-only suffix derived from concatenated UUIDs.
// Used as the cross-run uniqueness anchor for SEARCHABLE name fields
// (consignee names + tenant.name) where digit content would activate
// the phone-OR branch in buildAdminConsigneeSearchFilter. Two UUIDs'
// hex chars are concatenated and digits stripped to guarantee an
// alphabetic tag with negligible collision rate per CI run. The
// `|| "tagfallback"` guards against the vanishingly rare draw where
// 64 hex chars produce zero a-f letters; the test's determinism does
// not depend on the suffix value beyond it being non-empty.
const RUN_TAG =
  (randomUUID() + randomUUID()).replace(/[^a-f]/g, "").slice(0, 10) || "tagfallback";

const TENANT_LIVE = randomUUID();
const TENANT_ARCHIVED = randomUUID();
const SLUG_LIVE = `acc-${RUN_ID}-live`;
const SLUG_ARCHIVED = `acc-${RUN_ID}-arch`;

// NAME_LIVE: tenant.name for the live merchant. Digit-free so a search
// for NAME_LIVE never activates the phone-OR branch. RUN_TAG suffix
// gives cross-run uniqueness without re-introducing digit content.
const NAME_LIVE = `Acc Live Merchant ${RUN_TAG}`;
const NAME_ARCHIVED = `Acc Archived Merchant ${RUN_TAG}`;

const CONSIGNEE_LIVE_A = randomUUID();
const CONSIGNEE_LIVE_B = randomUUID();
const CONSIGNEE_ARCHIVED = randomUUID();

// SEARCH_NAME: matches CONSIGNEE_LIVE_A.name only. Distinguishing
// token "Sarah Khouri" is disjoint from "Other Person" (B's name) and
// from "Acc Live Merchant" (tenant.name) — no substring overlap, no
// digit content. RUN_TAG suffix isolates this run's fixture from any
// leaked rows.
const SEARCH_NAME = `Sarah Khouri ${RUN_TAG}`;
const NAME_OTHER = `Other Person ${RUN_TAG}`;
const NAME_ARCHIVED_CONSIGNEE = `Archived Person ${RUN_TAG}`;

// PHONE_DIGITS: fixed deterministic digit pattern. Disjoint from
// PHONE_DIGITS_B + PHONE_DIGITS_ARCHIVED under ILIKE digit-stripping —
// no shorter substring of one phone is a substring of any other phone.
// Not derived from RUN_ID so the digit content is independent of any
// RUN_ID draw.
const PHONE_DIGITS = "5111100001";
const PHONE_DIGITS_B = "6222200002";
const PHONE_DIGITS_ARCHIVED = "7333300003";

describe("Day-24 PM count pin — countAllConsigneesRows", () => {
  beforeAll(async () => {
    await withServiceRole("admin-consignees-count integration setup", async (tx) => {
      await tx.execute(sqlTag`
        INSERT INTO tenants (id, slug, name, status) VALUES
          (${TENANT_LIVE}, ${SLUG_LIVE}, ${NAME_LIVE}, 'active'),
          (${TENANT_ARCHIVED}, ${SLUG_ARCHIVED}, ${NAME_ARCHIVED}, 'archived')
      `);

      await tx.execute(sqlTag`
        INSERT INTO consignees
          (id, tenant_id, name, phone, address_line, emirate_or_region, district, crm_state)
        VALUES
          (${CONSIGNEE_LIVE_A}, ${TENANT_LIVE}, ${SEARCH_NAME}, ${`+971 ${PHONE_DIGITS}`},
           'Addr A', 'Dubai', 'Marina', 'ACTIVE'),
          (${CONSIGNEE_LIVE_B}, ${TENANT_LIVE}, ${NAME_OTHER}, ${`+971 ${PHONE_DIGITS_B}`},
           'Addr B', 'Dubai', 'Al Quoz', 'ACTIVE'),
          (${CONSIGNEE_ARCHIVED}, ${TENANT_ARCHIVED}, ${NAME_ARCHIVED_CONSIGNEE}, ${`+971 ${PHONE_DIGITS_ARCHIVED}`},
           'Addr C', 'Dubai', 'Jumeirah', 'ACTIVE')
      `);
    });
  });

  async function count(filters: Parameters<typeof countAllConsigneesRows>[1] = {}): Promise<number> {
    return withServiceRole("acc test", async (tx) => countAllConsigneesRows(tx, filters));
  }

  it("merchantSlug = live narrows to that tenant's 2 seeded consignees", async () => {
    expect(await count({ merchantSlug: SLUG_LIVE })).toBe(2);
  });

  it("excludes archived tenant rows (merchantSlug = archived returns 0)", async () => {
    expect(await count({ merchantSlug: SLUG_ARCHIVED })).toBe(0);
  });

  it("searchTerm matches consignee name (1 of 2 on live tenant)", async () => {
    expect(await count({ merchantSlug: SLUG_LIVE, searchTerm: SEARCH_NAME })).toBe(1);
  });

  it("searchTerm matches phone via digit-stripping", async () => {
    expect(await count({ merchantSlug: SLUG_LIVE, searchTerm: PHONE_DIGITS })).toBe(1);
  });

  it("searchTerm matches merchant name (ten.name ILIKE) returns both live consignees", async () => {
    expect(await count({ merchantSlug: SLUG_LIVE, searchTerm: NAME_LIVE })).toBe(2);
  });
});
