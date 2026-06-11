---
name: Brief v1.3 amendment — tenants.pickup_address column-name canon (short forms retired)
description: Day-16 Block 1 schema-probe finding surfaced that brief §3.1.1's pickup_district + pickup_emirate short names didn't exist on prod; the columns shipped via PR #139 migration 0017 as pickup_address_district + pickup_address_emirate (matching the pickup_address_line sibling). Brief amends to the migration-canonical names; service-layer DTO shape (`{ line, district, emirate }`) is preserved at the persistence boundary.
type: project
---

# Brief v1.3 amendment — pickup_address column-name canon

## §1 Context

Day-16 Block 1 morning pre-flight verification (per merged plan PR #155 §0.4) ran a read-only schema probe against production. The probe checked for the seven columns brief §3.1.1 named under `tenants.pickup_address`:

- `pickup_address_line` — found ✓
- `pickup_district` — **NOT FOUND** ✗
- `pickup_emirate` — **NOT FOUND** ✗

A follow-up probe (Block 1b) listed the full `tenants` table column set and surfaced the actual production column names:

- `pickup_address_line`
- `pickup_address_district`
- `pickup_address_emirate`

Migration 0017 (`supabase/migrations/0017_tenants_pickup_address.sql`, shipped via PR #139, merged `875bfc4`) is the canonical schema landing. Its DDL adds all three columns with the `pickup_address_*` prefix family. The migration's own header comment block claims to follow brief §3.1.1, but the brief text in earlier drafts used short forms (`pickup_district`, `pickup_emirate`) that don't match the prefix-aligned naming the migration actually shipped.

Code references in `src/`: only one mention exists (in [`src/modules/audit/event-types.ts:709`](../src/modules/audit/event-types.ts#L709), describing the abstract object shape `pickup_address: { line, district, emirate }` for the `merchant.created` audit event metadata). No SQL or column-name references in `src/` use either the short or long forms — the persistence layer hadn't been written yet at probe time.

## §2 Decision

**Brief §3.1.1 amends to match the production schema.** Short forms `pickup_district` / `pickup_emirate` are retired from the brief text. The `pickup_address_*` prefix family becomes the canonical column-name surface.

This is **option 1 of three routing paths considered** at probe time:

1. ✅ **Selected:** brief amends to match prod (`pickup_address_district` / `pickup_address_emirate`).
2. ❌ Rejected: rename prod columns to match brief — would require an additive migration + backfill + dropping the old columns; cross-cutting churn for stylistic gain.
3. ❌ Rejected: service layer adapts both names — dual source of truth at the persistence boundary; bug surface for any future query that hits one form vs the other.

## §3 Reasoning

The decision pattern mirrors v1.2 amendment §0.3 Option A on `pushed_to_external_at`:

> Existing column has identical semantic; rename rejected as cross-cutting churn for stylistic gain. Already-shipped column names win.

In both cases:
- The migration is the canonical source of truth.
- The brief text was an outlier that drifted from the actual landing.
- A rename would be cosmetic — same data, same semantic, different label — and would burn migration + backfill + drop work for no behavioral gain.
- Brief amends post-hoc to acknowledge what shipped.

The naming choice the migration actually shipped (`pickup_address_*` prefix family) is also arguably better than the short forms — it makes the column group's relationship explicit. The brief's short forms were terser but less self-documenting.

## §4 Service-layer impact — none

The service-layer DTO shape is **unchanged**. Per §3.1.4 of the brief, `createMerchant(ctx, { name, slug, pickup_address })` receives `pickup_address` as an object: `{ line, district, emirate }`. That DTO shape is the public surface; it does NOT need to mirror DB column names.

The persistence layer's job is to map between the public DTO shape and the DB column names. A simple INSERT pattern:

```ts
INSERT INTO tenants (..., pickup_address_line, pickup_address_district, pickup_address_emirate, ...)
VALUES (..., :pickup_address.line, :pickup_address.district, :pickup_address.emirate, ...)
```

Keeps the DTO shape at the API boundary while honoring the DB's column names. The Day-14 part-2 service-layer PR (the next code PR after this bundle merges) will land the `createMerchant` service and will use the `pickup_address_*` prefix family for the SQL, with the `{ line, district, emirate }` DTO shape preserved at the public surface.

No service-layer code is currently written that uses either form — the part-2 service PR is the first time this column surface gets touched in `src/`. So this amendment lands **before** any code that depends on it; no refactor risk, no migration risk.

## §5 Cross-references

- **PR #139** (`875bfc4`) — schema landing. Migration `supabase/migrations/0017_tenants_pickup_address.sql` is the canonical column-name source.
- **Day-16 Block 1 schema probe** (Day-16 morning) — surfaced the missing `pickup_district` / `pickup_emirate` columns under their short names. Probe ephemeral, results captured in conversation.
- **Day-16 Block 1b tenants probe** (Day-16 morning) — surfaced the actual `pickup_address_district` / `pickup_address_emirate` columns. Probe ephemeral, results captured in conversation.
- **Brief §3.1.1** — amended to the migration-canonical naming.
- **Brief §3.1.4** — `createMerchant` DTO shape `{ line, district, emirate }` preserved.
- **Brief §9 amendment log** — v1.3 row added.
- **Brief §10 amendment protocol** — followed: explicit decision memo (this file) + brief amendment + version bump.
- **v1.2 amendment §0.3 Option A** (`memory/decision_brief_v1_2_amendments_d13_part1.md`) — precedent for the "already-shipped column names win" pattern this amendment follows.
