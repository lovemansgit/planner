# Day-19 Phase 1.5 — Transcorp admin cross-tenant operational read

**Filed:** Day 19, 9 May 2026
**Branch:** `day19/phase-1-5-admin-cross-tenant-plan` (plan-PR), `day19/phase-1-5-admin-cross-tenant-code` (code-PR, future)
**Tier:** T3 (3 new admin pages + service-layer cross-tenant fns + 3 new systemOnly permissions + brief amendment)
**Trigger date:** between Day 25 (post-internal-demo May 15) and Day 28 (external-demo May 18); pulled forward per Love's Day-19 ruling
**Effort estimate:** 6-10 hours code-PR (per Phase-1.5 deferral memo §3)
**Demo relevance:** **load-bearing for the May-15 internal CAIO panel** — the plan-PR's headline demo claim is "here's how Transcorp staff manage the entire merchant ecosystem at a glance"

**Branched from `34b5071`** (post PR #210 T3 webhook handler lookup-column fix).

---

## §0 Scope summary — 17 lockings

The following 17 items are locked in this plan-PR and must not be re-litigated at code-PR time without an explicit reviewer override:

1. Read-only surfaces only — 3 new pages: `/admin/tasks`, `/admin/consignees`, `/admin/subscriptions`
2. 3 new systemOnly permissions: `task:read_all`, `consignee:read_all`, `subscription:read_all` (mirrors `merchant:read_all` naming convention from `permissions.ts:537-545`)
3. 3 new entries added to `API_KEY_FORBIDDEN_PERMISSIONS` set (mirrors merchant:* exclusion at `permissions.ts:615-618`)
4. 3 new service-layer fns: `listAllTasks` / `listAllConsignees` / `listAllSubscriptions` — **parallel implementations** using `withServiceRole` BYPASSRLS, NOT parameterized extensions of tenant-scoped fns. Discipline rationale: tenant-scoped fns assert `assertTenantScoped`; conflating with cross-tenant-scoped paths complicates that assertion's contract
5. 3 repository extensions with merchant `JOIN tenants` at repo level (single round-trip; merchant slug + name + status surfaced alongside the operator entity)
6. Shared `MerchantFilterDropdown` at `(admin)/_components/MerchantFilterDropdown.tsx`; URL-state via `?merchant=<slug>` query param; single-select; reset-to-all = empty param
7. Column shape: mirror operator-side table column order + **prepend `Merchant` column at position 1**
8. Pagination: same defaults as operator (50 / 100 / 200 / 500; default 50)
9. Default sort: `delivery_date DESC` for tasks; `created_at DESC` for consignees + subscriptions
10. Empty / loading / error states reuse operator-side `EmptyState` + `SystemNotInitialised` patterns from `(admin)/admin/merchants/page.tsx:179-204`
11. `nav-config.ts:102-104` `ADMIN_NAV_ITEMS` gets 3 new entries
12. **Brief amendment**: §2.3 expansion from 1 workflow to 2 workflows (lifecycle + cross-tenant operational read); `v1.8 → v1.9`; **brief amendment included in plan-PR commit** (NOT a separate PR)
13. **NO audit events on read** (mirrors R-4 task:read non-audit posture per existing `listMerchants` pattern at `merchants/service.ts:357-359`)
14. **NO `is_internal` flag introduction** (deferred to Phase 2 per existing `memory/followup_admin_merchant_list_filter_internal_tenant.md`)
15. **NO action capability cross-tenant** (read-only; future Phase 1.6 if needed)
16. **NO search affordance** (Phase 2 candidate; followup memo flagged for code-PR landing — `memory/followup_phase_1_5_search_affordance_phase_2.md`)
17. Tests: 3 new integration spec files — `tests/integration/admin-tasks-cross-tenant.spec.ts`, `admin-consignees-cross-tenant.spec.ts`, `admin-subscriptions-cross-tenant.spec.ts` — covering RBAC + cross-tenant scoping + merchant filter behavior

---

## §1 Locked decisions (cross-reference reviewer rulings)

| # | Decision | Source |
|---|---|---|
| L1 | Phase 1.5 pulled forward from May-15 / May-18 sequencing window to Day-19 PM lane | Love's Day-19 ruling (verbal handoff) |
| L2 | Read-only scope; action capability deferred to Phase 1.6 | Reviewer Day-19 plan-PR-prompt §3 |
| L3 | Parallel `listAll*` impls (NOT parameterized extensions of tenant-scoped fns) | Reviewer Day-19 plan-PR-prompt scope-item 4 |
| L4 | Single-select merchant filter via URL query param `?merchant=<slug>` | Reviewer Day-19 plan-PR-prompt scope-item 6 |
| L5 | Pagination defaults match operator-side (50/100/200/500; default 50) | Reviewer Day-19 plan-PR-prompt scope-item 8 |
| L6 | Default sort: `delivery_date DESC` for tasks; `created_at DESC` for consignees + subscriptions | Reviewer Day-19 plan-PR-prompt scope-item 9 |
| L7 | Brief amendment in plan-PR commit (NOT separate PR) | Reviewer Day-19 plan-PR-prompt scope-item 12 |
| L8 | No audit events on read (R-4 non-audit posture) | Reviewer Day-19 plan-PR-prompt scope-item 13; `merchants/service.ts:357-359` precedent |
| L9 | No `is_internal` flag in this PR (Phase 2) | Reviewer Day-19 plan-PR-prompt scope-item 14; existing `followup_admin_merchant_list_filter_internal_tenant.md` |
| L10 | No search affordance (Phase 2 candidate; followup memo lands with code-PR) | Reviewer Day-19 plan-PR-prompt scope-item 16 |

Reviewer §3.6 review will lock 4 of the open questions still floating per the survey briefing:
- §3.6 OQ-1 — Brief §2.3 amendment text shape (this plan body proposes; reviewer ratifies)
- §3.6 OQ-2 — Permission descriptions exact wording (this plan body proposes; reviewer ratifies)
- §3.6 OQ-3 — Service-layer error contract for unknown merchant slug filter (this plan body proposes `ValidationError`; reviewer ratifies)
- §3.6 OQ-4 — Schema column-list scope on the JOIN (this plan body proposes `tenants.slug, tenants.name, tenants.status`; reviewer ratifies)

---

## §2 Brief amendment — §2.3 expansion (v1.8 → v1.9)

### §2.1 Before (current main HEAD `34b5071`, brief v1.8)

```markdown
### 2.3 One Transcorp-staff workflow

1. **Onboard, activate, deactivate a merchant** — create the merchant tenant (name, slug, pickup address as ship-from), activate, deactivate.
```

### §2.2 After (proposed v1.9)

```markdown
### 2.3 Two Transcorp-staff workflows

1. **Onboard, activate, deactivate a merchant** — create the merchant tenant (name, slug, pickup address as ship-from), activate, deactivate.
2. **Cross-tenant operational read** (Phase 1.5, Day-19) — read-only visibility into all tasks, consignees, and subscriptions across all merchants on the platform. Powers the `/admin/tasks`, `/admin/consignees`, `/admin/subscriptions` admin surfaces with merchant-filter dropdown. Backed by 3 systemOnly read_all permissions (`task:read_all` / `consignee:read_all` / `subscription:read_all`) granted only to the `transcorp-sysadmin` role. No action capability — modifications go through the merchant operator's tenant-scoped surface (Phase 1.6 if cross-tenant action capability is needed).
```

### §2.3 Version line update

```markdown
**Version:** v1.9
**Filed:** Day 12 (5 May 2026), evening; v1.2 amendments filed Day 13 (5 May 2026), post-PR-#139 merge; v1.4 amendment filed Day 17 (7 May 2026) morning; v1.5 amendment filed Day 17 (7 May 2026) post-PR-#168 visual refinement; v1.6 amendment filed Day 17 (7 May 2026) ~1:30 PM Dubai; v1.7 amendment filed Day 18 (8 May 2026) post-A1-resolver-swap; v1.8 amendment filed Day 18 (8 May 2026) post-A2-plan-PR — webhook handler 3-layer plan + §3.1.10 array-shape + §5.3 Gate-5 path corrections; v1.9 amendment filed Day 19 (9 May 2026) post-A2-smoke-PASS — §2.3 expansion to two Transcorp-staff workflows (Phase 1.5 admin cross-tenant operational read).
```

The amendment lands in the **same commit as this plan-PR's plan body** per scope item L7. Companion `decision_brief_v1_9_amendment_phase_1_5_cross_tenant.md` is NOT required (this plan-PR doc itself is the decision file).

---

## §3 Permission catalogue diff (3 new entries verbatim)

The 3 new entries land in `src/modules/identity/permissions.ts` immediately AFTER the `merchant:deactivate` block (current line ~554), preserving lexical adjacency to other systemOnly cross-tenant perms.

```ts
  "task:read_all": {
    id: "task:read_all",
    resource: "task",
    action: "read_all",
    description:
      "Day 19 / Phase 1.5. Cross-tenant read access to the full task list across all merchants. Powers the /admin/tasks list view per brief §2.3 (v1.9). Granted only to transcorp-sysadmin; tenant operators see only their own tenant's data via task:read (single-tenant scope).",
    systemOnly: true,
  },

  "consignee:read_all": {
    id: "consignee:read_all",
    resource: "consignee",
    action: "read_all",
    description:
      "Day 19 / Phase 1.5. Cross-tenant read access to the full consignee list across all merchants. Powers the /admin/consignees list view per brief §2.3 (v1.9). Granted only to transcorp-sysadmin; tenant operators see only their own tenant's data via consignee:read (single-tenant scope).",
    systemOnly: true,
  },

  "subscription:read_all": {
    id: "subscription:read_all",
    resource: "subscription",
    action: "read_all",
    description:
      "Day 19 / Phase 1.5. Cross-tenant read access to the full subscription list across all merchants. Powers the /admin/subscriptions list view per brief §2.3 (v1.9). Granted only to transcorp-sysadmin; tenant operators see only their own tenant's data via subscription:read (single-tenant scope).",
    systemOnly: true,
  },
```

### `API_KEY_FORBIDDEN_PERMISSIONS` companion edit

In the `Object.freeze(new Set<PermissionId>([...]))` set at lines 607-630, add 3 entries within the existing "merchant lifecycle perms are systemOnly" comment block (lines 612-618):

```ts
    // Day 19 / Phase 1.5 — cross-tenant read perms are systemOnly per
    // brief §2.3 (v1.9); API keys must not exfiltrate cross-tenant
    // operational data.
    "task:read_all",
    "consignee:read_all",
    "subscription:read_all",
```

### Roles delta

**ZERO.** The `transcorp-sysadmin` role at `roles.ts:189` grants `new Set<PermissionId>(ALL)` — the 3 new perms are granted automatically. No role-table edit required.

### Invariant test impact

`systemOnlyPermissionsAreNotInTenantRoles` test (cited at `permissions.ts:45` and `merchants/service.ts:13`) passes by construction — none of the 3 new systemOnly perms appear in any tenant role's permission set.

---

## §4 Service-layer signatures (3 new fns with TypeScript types)

Each lives in its respective module's `service.ts` file. All three follow the **identical structural pattern** established by `merchants/service.ts:listMerchants` ([service.ts:368-377](src/modules/merchants/service.ts#L368-L377)):
1. `requirePermission(ctx, "<resource>:read_all")`
2. `withServiceRole("transcorp_staff:list_all_<resource>", async (tx) => ... )`
3. Call repository fn passing `tx` + filter
4. Return result

### §4.1 `src/modules/tasks/service.ts` (added near existing `listTasks` at line 489)

```ts
/**
 * Day 19 / Phase 1.5 — cross-tenant SELECT of tasks across all merchants.
 * Read-only; no audit emit per R-4. Joined with tenants for merchant-side
 * surface columns (slug + name + status). Optional `merchantSlug` filter
 * narrows to a single tenant. Optional `limit/offset` for pagination
 * (operator-side defaults: 50/100/200/500).
 *
 * Throws:
 *   - ForbiddenError    actor lacks `task:read_all`.
 *   - ValidationError   merchantSlug filter doesn't resolve to an existing tenant.
 */
export interface ListAllTasksFilters {
  readonly merchantSlug?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface AdminTaskRow {
  readonly task: Task;
  readonly merchant: {
    readonly tenantId: Uuid;
    readonly slug: string;
    readonly name: string;
    readonly status: TenantStatus;
  };
}

export async function listAllTasks(
  ctx: RequestContext,
  filters: ListAllTasksFilters = {},
): Promise<readonly AdminTaskRow[]> {
  requirePermission(ctx, "task:read_all");

  return withServiceRole("transcorp_staff:list_all_tasks", async (tx) => {
    return listAllTasksRows(tx, filters);
  });
}
```

### §4.2 `src/modules/consignees/service.ts` (added near existing `listConsignees` at line 176)

```ts
export interface ListAllConsigneesFilters {
  readonly merchantSlug?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface AdminConsigneeRow {
  readonly consignee: Consignee;
  readonly merchant: {
    readonly tenantId: Uuid;
    readonly slug: string;
    readonly name: string;
    readonly status: TenantStatus;
  };
}

export async function listAllConsignees(
  ctx: RequestContext,
  filters: ListAllConsigneesFilters = {},
): Promise<readonly AdminConsigneeRow[]> {
  requirePermission(ctx, "consignee:read_all");

  return withServiceRole("transcorp_staff:list_all_consignees", async (tx) => {
    return listAllConsigneesRows(tx, filters);
  });
}
```

### §4.3 `src/modules/subscriptions/service.ts` (added near existing `listSubscriptions` at line 281)

```ts
export interface ListAllSubscriptionsFilters {
  readonly merchantSlug?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface AdminSubscriptionRow {
  readonly subscription: Subscription;
  readonly merchant: {
    readonly tenantId: Uuid;
    readonly slug: string;
    readonly name: string;
    readonly status: TenantStatus;
  };
}

export async function listAllSubscriptions(
  ctx: RequestContext,
  filters: ListAllSubscriptionsFilters = {},
): Promise<readonly AdminSubscriptionRow[]> {
  requirePermission(ctx, "subscription:read_all");

  return withServiceRole("transcorp_staff:list_all_subscriptions", async (tx) => {
    return listAllSubscriptionsRows(tx, filters);
  });
}
```

### §4.4 Filter validation (proposes resolution for §3.6 OQ-3)

When `merchantSlug` is provided, repository pre-flights `findMerchantBySlug(tx, slug)` — null result throws `ValidationError("merchantSlug filter does not resolve to an existing tenant: <slug>")`. Service layer surfaces this as 400 to the page; page surfaces as a non-blocking inline error message + falls back to no-filter view.

---

## §5 Repository SELECT statements (verbatim, with JOIN)

Each lives in its respective module's `repository.ts`. JOINs `tenants` for merchant surface columns (per scope item 5: single round-trip).

### §5.1 `src/modules/tasks/repository.ts` (added near existing `listTasksByTenant`)

```sql
-- listAllTasksRows — cross-tenant SELECT joined with tenants for merchant
-- surface columns. Caller is in withServiceRole; no RLS predicate
-- (cross-tenant scope by definition). delivery_date DESC default per
-- scope item 9. Pagination via LIMIT/OFFSET; default 50, max 500.

SELECT
  t.id, t.tenant_id, t.consignee_id,
  t.customer_order_number, t.external_id, t.external_tracking_number,
  t.internal_status, t.delivery_date,
  t.delivery_start_time, t.delivery_end_time,
  t.pushed_to_external_at, t.created_via,
  t.pod_photos, t.recipient_name, t.signature,
  t.consignee_rating, t.consignee_comment, t.driver_comment,
  t.number_of_attempts, t.failure_reason_comment,
  t.completion_latitude, t.completion_longitude,
  t.created_at, t.updated_at,
  -- merchant-side columns
  ten.id   AS merchant_tenant_id,
  ten.slug AS merchant_slug,
  ten.name AS merchant_name,
  ten.status AS merchant_status
FROM tasks t
JOIN tenants ten ON ten.id = t.tenant_id
WHERE (
  ${merchantSlug}::text IS NULL
  OR ten.slug = ${merchantSlug}
)
ORDER BY t.delivery_date DESC, t.created_at DESC
LIMIT ${limit} OFFSET ${offset}
```

### §5.2 `src/modules/consignees/repository.ts` (added near existing `listConsigneesByTenant`)

```sql
-- listAllConsigneesRows — cross-tenant SELECT joined with tenants.
-- created_at DESC default per scope item 9.

SELECT
  c.id, c.tenant_id, c.name, c.phone,
  c.address_line, c.emirate_or_region, c.district,
  c.crm_state, c.email, c.notes,
  c.created_at, c.updated_at,
  ten.id   AS merchant_tenant_id,
  ten.slug AS merchant_slug,
  ten.name AS merchant_name,
  ten.status AS merchant_status
FROM consignees c
JOIN tenants ten ON ten.id = c.tenant_id
WHERE (
  ${merchantSlug}::text IS NULL
  OR ten.slug = ${merchantSlug}
)
ORDER BY c.created_at DESC
LIMIT ${limit} OFFSET ${offset}
```

### §5.3 `src/modules/subscriptions/repository.ts` (added near existing `listSubscriptionsByTenant`)

```sql
-- listAllSubscriptionsRows — cross-tenant SELECT joined with tenants.
-- created_at DESC default per scope item 9.

SELECT
  s.id, s.tenant_id, s.consignee_id,
  s.status, s.start_date, s.end_date,
  s.delivery_weekdays, s.cadence,
  s.last_delivered_date, s.last_skipped_date,
  s.created_at, s.updated_at,
  ten.id   AS merchant_tenant_id,
  ten.slug AS merchant_slug,
  ten.name AS merchant_name,
  ten.status AS merchant_status
FROM subscriptions s
JOIN tenants ten ON ten.id = s.tenant_id
WHERE (
  ${merchantSlug}::text IS NULL
  OR ten.slug = ${merchantSlug}
)
ORDER BY s.created_at DESC
LIMIT ${limit} OFFSET ${offset}
```

**Index usage:**
- Tasks: existing `tasks (tenant_id, delivery_date)` index covers tenant-scoped queries; cross-tenant SELECT uses sequential scan + sort. At pilot volume (~1500-2500 tasks total) this is acceptable. Cross-tenant pagination performance flagged as a follow-up if it becomes load-bearing post-pilot.
- Consignees: existing `consignees (tenant_id, created_at DESC)` index; cross-tenant scan acceptable.
- Subscriptions: existing `subscriptions (tenant_id, status)` index; cross-tenant scan acceptable.

OFFSET pagination acceptable at pilot volume; cursor pagination is Phase 2 candidate if cross-tenant tasks scale to 10k+ rows.

**No index additions in this PR** — scope discipline (per Day-18 EOD §8.7 convention).

---

## §6 File-by-file complexity table

| File | Type | Est. lines | Notes |
|---|---|---|---|
| `src/app/(admin)/admin/tasks/page.tsx` | NEW | ~180-220 | SSR; mirrors `merchants/page.tsx` shape; +Merchant column; pagination controls |
| `src/app/(admin)/admin/consignees/page.tsx` | NEW | ~150-200 | Same pattern |
| `src/app/(admin)/admin/subscriptions/page.tsx` | NEW | ~160-210 | Same pattern + cadence column |
| `src/app/(admin)/_components/MerchantFilterDropdown.tsx` | NEW | ~120-160 | Client component; reads `?merchant=<slug>` from URL; uses `useRouter().push` to update; renders all merchants from a list pre-fetched server-side and passed in |
| `src/modules/tasks/service.ts` | EDIT | +~50-70 | New `listAllTasks` fn + `ListAllTasksFilters` + `AdminTaskRow` types |
| `src/modules/tasks/repository.ts` | EDIT | +~50-70 | New `listAllTasksRows` fn + the JOIN SELECT from §5.1 |
| `src/modules/consignees/service.ts` | EDIT | +~50-70 | Same pattern |
| `src/modules/consignees/repository.ts` | EDIT | +~50-70 | Same pattern |
| `src/modules/subscriptions/service.ts` | EDIT | +~50-70 | Same pattern |
| `src/modules/subscriptions/repository.ts` | EDIT | +~50-70 | Same pattern |
| `src/modules/identity/permissions.ts` | EDIT | +~40 | 3 new entries (verbatim §3 above) + 3 new entries in `API_KEY_FORBIDDEN_PERMISSIONS` |
| `src/app/(app)/nav-config.ts` | EDIT | +~12-15 | 3 new `ADMIN_NAV_ITEMS` entries (Tasks / Consignees / Subscriptions) |
| `tests/integration/admin-tasks-cross-tenant.spec.ts` | NEW | ~150-200 | RBAC (forbidden for tenant-admin) + cross-tenant scoping (sysadmin sees both A and B tenants' tasks) + merchant filter (`?merchant=mpl` returns only MPL tasks) |
| `tests/integration/admin-consignees-cross-tenant.spec.ts` | NEW | ~150-200 | Same coverage |
| `tests/integration/admin-subscriptions-cross-tenant.spec.ts` | NEW | ~150-200 | Same coverage |
| `memory/PLANNER_PRODUCT_BRIEF.md` | EDIT | +~12-15 | §2.3 amendment per §2 above; version line update |
| `memory/followup_phase_1_5_search_affordance_phase_2.md` | NEW (lands in code-PR) | ~30-50 | Captures search affordance deferral per scope item 16 |

**Total est:** ~1480-1990 LOC across 17 files (12 source + 3 tests + 1 brief amendment + 1 followup memo).

**Effort estimate:** 6-10 hours (per memo §3) — aligned with this scope.

---

## §7 Sequencing

```
plan-PR open (this branch)
    │
    │  reviewer §3.6 counter-review on plan body
    │  (4 open questions ratified inline; any new concerns surfaced)
    ▼
plan-PR merge (with brief v1.8 → v1.9 amendment)
    │
    ▼
code-PR open (branch: day19/phase-1-5-admin-cross-tenant-code)
    │
    │  reviewer §3.6 counter-review on code-PR (T3 hard-stop-twice)
    │  - body-read on permission entries
    │  - body-read on service-fn signatures
    │  - body-read on repo SELECTs (JOIN structure + filter shape)
    │  - body-read on page.tsx auth/RBAC pattern
    │  - body-read on merchant-filter dropdown URL-state
    │  - integration test coverage check
    ▼
code-PR merge
    │
    ▼
Vercel preview verification (no migration; runtime-only)
    │
    ▼
production promote (next batched cadence)
```

**No production migration** required. **No external-API or queue changes.** **No webhook handler changes** (PR #210 dependency is contextual, not technical).

---

## §8 T3 hard-stop discipline acknowledgment

Per `memory/feedback_t3_plan_prs_need_realtime_review.md`: T3 plans (architecture / queue / idempotency / DLQ design) **require real-time counter-review**; do NOT draft autonomously.

This plan was drafted IN-SESSION with reviewer in real-time relay. The reviewer's plan-PR-prompt explicitly authorized this as a `T3 plan-PR` and provided 17 lockings + 4 open-question framings. Drafting was authorized, NOT autonomous.

Hard-stops observed:
1. Pre-survey hard-stop (briefing surfaced, reviewer combined with Session B) ✓
2. Post-survey, plan-PR-scope-locking hard-stop (reviewer locked 17 items + 4 open questions) ✓
3. Plan-PR-OPEN hard-stop (this plan-PR open; reviewer §3.6 counter-review BEFORE merge) — **active**
4. Plan-PR-MERGE → code-PR-OPEN hard-stop (reviewer authorizes code-PR drafting) — **future**
5. Code-PR-OPEN → MERGE hard-stop (reviewer §3.6 body-read counter-review) — **future**

---

## §9 Dependencies

### §9.1 PR #210 (T3 webhook handler lookup-column hot-fix) — contextual, NOT technically blocking

PR #210 fixed the webhook handler's `external_id → external_tracking_number` column lookup. Phase 1.5 doesn't touch webhook handlers, parser, or apply-* flows. Completely orthogonal scope.

PR #210 IS contextually relevant because:
- A2 production smoke verified PASS-FULL-SCOPE post-#210 (per Day-19 reviewer relay) — gives confidence the webhook → DB pipeline is now reliable, which means the `tasks.internal_status` values surfaced in `/admin/tasks` reflect real SF lifecycle state (not 4-day-stale CREATED).
- Demo narrative for May-15 CAIO: "Transcorp staff see all 5 merchants' deliveries flowing through SuiteFleet's webhook lifecycle in real-time" relies on PR #210 working in production.

### §9.2 Day-18 EOD §3.11 — transcorp-sysadmin onboarding precedent

Day-18 onboarded the first `transcorp-admin@planner.test` sysadmin user (per `memory/handoffs/day-18-eod.md` §3.11). Phase 1.5 admin pages target this user-type. No additional onboarding needed.

### §9.3 Brief amendment protocol §0

Per the brief's amendment-protocol section (preamble), new scope additions require:
- (a) explicit `decision_*.md` filing with reasoning — **THIS PLAN-PR doc serves as the decision file**
- (b) versioned update in §2.3 — applied per §2 above
- (c) version-line update in the document header — applied per §2.3 above

---

## §10 Followup memo to file with code-PR (NOT plan-PR)

Path: `memory/followup_phase_1_5_search_affordance_phase_2.md`

Body shape (drafted at code-PR time):
- §1 What's deferred — global search box across cross-tenant tasks/consignees/subscriptions
- §2 Why now isn't the time — Phase 1.5 scope discipline; pagination + filter solves the 80% case for May-15 / May-18 demos
- §3 Phase 2 trigger — operator feedback post-pilot OR cross-tenant volume exceeds visible-list-size
- §4 Cross-references — this plan-PR; brief §2.3 (v1.9)

---

## §11 Demo relevance

**May-15 internal CAIO panel narrative:** "Transcorp staff manage the entire merchant ecosystem at a glance. From `/admin/merchants` they onboard and lifecycle-manage merchants. From `/admin/tasks`, `/admin/consignees`, `/admin/subscriptions` they get cross-tenant operational visibility — see every active subscription, every consignee, every task across the platform. Filter by merchant when drilling in. SuiteFleet webhooks flow into our DB in real-time, so internal_status, pod_photos, address corrections — all visible to Transcorp staff without per-merchant-tenant logins."

**Load-bearing for the panel.** Without Phase 1.5, the demo is "we have a merchant onboarding admin page" + 4 separate per-merchant-tenant logins to demonstrate operational visibility. With Phase 1.5, it's a coherent cross-tenant story.

**May-18 external prospect demo:** Phase 1.5 also surfaces during the prospect demo; the prospect is a Transcorp customer, NOT a transcorp-staff actor, so they wouldn't see `/admin/*` directly. But the panel's framing of "Transcorp manages all this" is reinforced by the existence of the cross-tenant surfaces.

---

## §12 Open questions for §3.6 counter-review

| OQ | Topic | Plan body proposes | Reviewer ratifies |
|---|---|---|---|
| OQ-1 | Brief §2.3 amendment text | Two-workflow framing per §2.2 above | TBD |
| OQ-2 | Permission descriptions exact wording | Per §3 above (mirrors `merchant:read_all` voice) | TBD |
| OQ-3 | Filter on unknown merchant slug — error contract | `ValidationError`; page surfaces as inline non-blocking error + falls back to no-filter view | TBD |
| OQ-4 | JOIN column-list scope | `tenants.id, tenants.slug, tenants.name, tenants.status` | TBD |

Reviewer also free to surface additional concerns at counter-review time per T3 discipline.

---

**End of plan body.**

Plan-PR opens immediately after this file lands on `day19/phase-1-5-admin-cross-tenant-plan` branch + brief amendment lands in same commit. Code-PR scope opens AFTER plan-PR merge per §7 sequencing.
