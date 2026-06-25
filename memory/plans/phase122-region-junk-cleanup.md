# Phase 12.2 · Lane 2 — Region Junk Cleanup (PLAN ONLY — Floor 1 / LIVE DB)

**Lane:** production data deletion on `suitefleet_regions`. **Status:** for Love's ruling.
**Base:** `e01d2ad` (= `origin/main`). **Target table:** `public.suitefleet_regions` on Supabase project **`qdotjmwqbyzldfuxphei`** (production — **there is no dev/staging; this DB is production**).
**Floor 1:** live DB change. **Nothing is deleted or modified this round.** This is the written plan only.

> **What this is / isn't.** This is the WRITTEN deletion plan for you to rule on. **It runs no query and changes no row today** — not even the read-only audit (it needs the same prod access the deletes do; see §6). A display FILTER that hides the junk on `/admin/regions` is built separately (Item 5, commit `4b907ad`) — note it currently lives on the `phase122b-cos` integration branch and is **not yet merged to main**; either way a filter only hides rows. **This lane is the actual deletion.** Execution is a separate dispatch after your named DB authorization.

---

## 0. Decision sheet — what I need from you

| # | Decision | My recommendation | Why |
|---|----------|-------------------|-----|
| **D1** | **Confirm the canonical four = the four `client_id` literals** `transcorpsb` / `transcorp` / `transcorpuae` / `transcorpqatar`, and that **everything else is junk to delete.** | **Confirm** | These are the stable, UNIQUE keys seeded in migration 0024 and already used by the display filter. See the reconciliation table in §2 — **"KSA" is the bare `transcorp` row, not a `transcorpksa`** (subtle; flagged so nobody mistakes `transcorp` for junk). |
| **D2** | **Bound-tenant rule.** Your screenshot showed each region "IN USE: 1". If the audit (§3) finds any tenant bound to a junk region: **(A)** re-point real merchants to the correct canonical region first, and treat junk-test-tenants as a tenant-cleanup prerequisite; **(B)** delete only currently-unbound junk now and park the bound ones. | **A**, with the audit deciding scope | The FK is `ON DELETE RESTRICT` — the DB will *block* deleting a bound region (no silent orphan). But your "exactly four" outcome needs the bound ones handled. The audit tells us if they're real merchants (re-point + your per-tenant ruling) or leftover test tenants (tenant cleanup first). |
| **D3** | **Execution mechanism.** Agent direct-pooler `psql` is classifier-blocked (`memory/followup_prod_migration_mechanism_gap`). Pick the apply path: Supabase SQL editor (you run my exact script) / Supabase CLI / an allow-rule. | **You run my exact, reviewed script in the Supabase SQL editor**, inside one transaction, after the backup dump | No new tooling; you hold the action; the script is reviewed and transactional (rolls back on any FK error). |
| **D4** | **Authorize the read-only audit (§3) as step 1 of execution** | **Yes** | The audit is what makes the delete safe; it needs the same prod access, so it's the first authorized step, not a precondition I can satisfy now. |

---

## 1. The risk in one paragraph

`suitefleet_regions` is load-bearing: merchants bind to a region via `tenants.suitefleet_region_id → suitefleet_regions.id`, and the SuiteFleet credential resolver JOINs them on every push (`src/modules/credentials/suitefleet-resolver.ts:91-92`). Deleting a region a live merchant is bound to would break that merchant's SuiteFleet routing. **The schema already protects us:** the FK is `ON DELETE RESTRICT` (`supabase/migrations/0024_…sql:207`) and `tenants.suitefleet_region_id` is `NOT NULL` (`…sql:217`) — so a delete of a bound region **errors and rolls back; it cannot silently orphan anyone.** The plan leans on that guarantee and adds an explicit binding audit + backup so the operation is safe *and* reversible.

---

## 2. Binding audit target & canonical reconciliation

**Reliable key = `client_id` (UNIQUE, immutable-by-convention), NOT display name (mutable) and NOT a prefix** (the display filter pins exact-Set membership; `client_id` `transcorp` is a prefix of the others — a prefix match would wrongly capture all four). Source of truth: migration `0024_suitefleet_regions_and_per_merchant_credentials.sql:153-157`.

| `client_id` | `display_name` (seeded) | Love's name | auth_method | `id` |
|-------------|-------------------------|-------------|-------------|------|
| `transcorpsb` | Sandbox | **Sandbox** | oauth | pinned `11111111-1111-4111-a111-111111111111` |
| `transcorp` | Transcorp KSA | **KSA** | api_key | `gen_random_uuid()` — read from prod |
| `transcorpuae` | Transcorp UAE | **UAE** | api_key | `gen_random_uuid()` — read from prod |
| `transcorpqatar` | Transcorp Qatar | **Qatar** | api_key | `gen_random_uuid()` — read from prod |

**Reconciliation result:** Love's "Sandbox / UAE / Qatar / KSA" maps 1:1 to the seeded four. **No content mismatch.** The only subtlety: **KSA's `client_id` is the bare `transcorp`** (there is no `transcorpksa`). Three of the four `id`s were `gen_random_uuid()` at seed time, so their real UUIDs are unknown from code and must be read live (the audit does this). Junk filter (the same four literals the display filter uses):

```
client_id NOT IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar')
```

> Source-of-truth note: these four literals are authoritative from **migration 0024 (on main)**. The matching display-filter constant `CANONICAL_REGION_CLIENT_IDS` / `isCanonicalRegion` currently lives **only in unmerged commit `4b907ad`** — the `src/app/(admin)/admin/regions/_helpers.ts` on main is still the Day-26 version without it. The deletion key does not depend on that filter being merged; it depends on 0024, which is on main.

**Junk provenance:** the ~70 rows are created by integration tests calling `createRegion()` (e.g. `tests/integration/admin-merchants-credentials-action-di.spec.ts:72-103`, display_name literal `"ACD OAuth Region"`, client_ids like `acd<hex>` / `arl<hex>` / `umr<hex>`). Their teardown deletes the region inside a `try/catch` that swallows the FK-RESTRICT error (`…:128 /* FK RESTRICT; ignore */`) — which is exactly why they accumulate, sometimes with a leftover test tenant still bound (the likely source of "IN USE: 1").

**Referencing tables:** grep of all migrations confirms **only `tenants.suitefleet_region_id`** references `suitefleet_regions(id)`. No other FK. So binding analysis = the `tenants` join, nothing else.

---

## 3. Binding audit (READ-ONLY — run FIRST under auth, decides everything below)

These are `SELECT`-only; they change nothing but require prod access (D4). Column names verified against 0024.

**Query A — every region with its bound-tenant count (the "what's real" picture):**
```sql
SELECT r.id, r.client_id, r.display_name, r.status, r.auth_method,
       COUNT(t.id) AS tenant_count
FROM suitefleet_regions r
LEFT JOIN tenants t ON t.suitefleet_region_id = r.id
GROUP BY r.id, r.client_id, r.display_name, r.status, r.auth_method
ORDER BY tenant_count DESC, r.display_name;
```

**Query B — the orphan-risk set: tenants bound to a NON-canonical (junk) region:**
```sql
SELECT t.id AS tenant_id, t.slug, t.name, t.status AS tenant_status,
       r.id AS region_id, r.client_id, r.display_name
FROM tenants t
JOIN suitefleet_regions r ON r.id = t.suitefleet_region_id
WHERE r.client_id NOT IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar')
ORDER BY t.slug;
```

**Query C — junk regions with ZERO bindings (safe to delete directly):**
```sql
SELECT r.id, r.client_id, r.display_name, r.created_at
FROM suitefleet_regions r
WHERE r.client_id NOT IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar')
  AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.suitefleet_region_id = r.id)
ORDER BY r.created_at;
```

**Decision fork driven by Query B:**
- **B is empty** → straight to §4 (delete all unbound junk; the result is exactly four).
- **B is non-empty** → for each bound tenant, classify (real merchant vs leftover test tenant — reuse the F8 test-tenant signature: 8-hex slug + the 6-slug allowlist, `memory/project_f8_merchant_filter_shipped`). **Real merchants → STOP and surface to you for a per-tenant re-point ruling (which canonical region).** Test tenants → tenant cleanup is the prerequisite (sibling seed-junk lane), not done here. **No bound region is deleted until its tenant is moved.**

---

## 4. Delete sequence (ordered, reversible)

Run as ONE transaction in the Supabase SQL editor (D3). Stop at any step whose output is unexpected.

1. **Backup dump** — capture every junk row in full so any row can be re-INSERTed verbatim:
   ```sql
   SELECT id, client_id, display_name, status, auth_method, created_at, updated_at
   FROM suitefleet_regions
   WHERE client_id NOT IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar')
   ORDER BY created_at;
   ```
   Save the output to `memory/handoffs/` as the rollback artifact **before** any delete.
2. **Re-confirm canonical four are present & active** (guards against deleting too much):
   ```sql
   SELECT client_id, display_name, status FROM suitefleet_regions
   WHERE client_id IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar');
   ```
   Expect exactly 4 rows. If not 4 → STOP.
3. **Handle bound junk (only if Query B non-empty)** — per D2/§3, re-point each authorized tenant to its canonical region (separate, named, per-tenant step), or defer. Do not proceed to step 4 for a region that still has a binding.
4. **Delete unbound junk** in one statement (atomic; FK RESTRICT makes it self-protecting — if any targeted row is still bound, the whole statement errors and rolls back, deleting nothing):
   ```sql
   BEGIN;
   DELETE FROM suitefleet_regions
   WHERE client_id NOT IN ('transcorpsb','transcorp','transcorpuae','transcorpqatar')
     AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.suitefleet_region_id = suitefleet_regions.id);
   -- verify before commit:
   SELECT client_id, display_name FROM suitefleet_regions ORDER BY client_id;
   -- expect EXACTLY the four canonical rows
   COMMIT;   -- only if the verify shows exactly four; else ROLLBACK;
   ```
5. **Post-delete verify** — `SELECT count(*) FROM suitefleet_regions;` → expect **4**. Re-run Query A → each canonical region present, counts unchanged from the audit.

**Reversibility:** `suitefleet_regions` has no generated/identity columns and no Vault references on the table itself (those live on `tenants`). A deleted row is fully restored by re-INSERTing the dumped tuple with its original `id` (the PK default is `gen_random_uuid()`, not GENERATED ALWAYS — an explicit `id` is accepted). RLS is enabled with no policies, so restore runs via the same service-role/superuser path. Restoring a row that had a tenant bound is multi-step (re-INSERT region → move tenant back) but possible.

---

## 5. Why deletion is needed at all (filter already ships)

The display filter (Item 5, commit `4b907ad`, on the `phase122b-cos` branch — not yet on main) only hides junk on `/admin/regions`; the rows stay live, routable, and selectable in the New-merchant / credentials-edit region picker, and they inflate the table. Your rule is that the table itself should hold **only** the four real regions. That requires the actual delete — this lane.

---

## 6. Authorization shape (Floor 1)

Execution will require **your named DB authorization**, stated plainly:

- **Table:** `public.suitefleet_regions` (DELETE) — and, only if §3·B forces it, `public.tenants` (UPDATE `suitefleet_region_id`) for any authorized re-point.
- **Project ref:** `qdotjmwqbyzldfuxphei`. **This project has no dev/staging — it is production.** Every query (including the read-only audit) runs against production.
- **Pre-flight floor (repeat the D56 0035 discipline):** confirm the connection's project ref (`postgres.qdotjmwqbyzldfuxphei` / `\conninfo`) **before** running anything; any mismatch = stop, never re-scope (`memory/decision_d54_authorization_scope_literal`).
- **Mechanism:** agent direct-pooler `psql` is classifier-blocked → per D3, you run the reviewed script in the Supabase SQL editor (or we agree an allow-rule / CLI path). The agent does not hold a path to execute this itself.
- **Backup / rollback:** the §4 step-1 dump, saved before any delete, is the rollback source (re-INSERT of dumped tuples). No promote; rollback anchor untouched (this is data-only, not a deploy).
- **Authorization is per-statement:** the audit (read-only) is one clear; the delete is a separate clear after you've seen the audit output; any tenant re-point is its own named clear.

**Nothing in this lane executes until you rule on §0 and give the named authorization.**
