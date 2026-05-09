---
name: Phase 1.5 admin cross-tenant — Phase 2 follow-up surface area
description: Captures three Phase-2 lanes deliberately deferred from the Day-19 Phase 1.5 admin cross-tenant code-PR: (1) global search affordance across /admin/tasks /admin/consignees /admin/subscriptions; (2) cursor pagination if cross-tenant volume scales to 10k+ rows; (3) cross-tenant action capability (Phase 1.6) gating reads-only Phase 1.5 to write-capable. Each lane has a defined trigger and a sketched scope.
type: project
---

# Phase 1.5 admin cross-tenant — Phase 2 follow-up surface area

**Filed:** Day 19 (9 May 2026), with the Phase 1.5 code-PR
**Trigger date:** post-pilot (`mm/dd/2026` once trigger conditions surface)
**Tier when triggered:** see per-lane scope
**Source:** merged plan PR #211 §0 scope items 15-16 + §5 pagination amendment + §10 followup memo placeholder

---

## §1 Lane A — Global search affordance

### What's deferred

A global search box on each of `/admin/tasks`, `/admin/consignees`, `/admin/subscriptions` that lets a Transcorp staff actor find a specific record across ALL merchants by:
- Tasks: AWB / SF id / customer order number / consignee name
- Consignees: name / phone / email
- Subscriptions: consignee name / linked AWB / id

Currently Phase 1.5 surfaces only:
- Default-sort listing (delivery_date DESC for tasks; created_at DESC for consignees + subscriptions)
- Merchant filter via `?merchant=<slug>` URL query param
- Pagination (50 / 100 / 200 / 500; default 50)

### Why deferred from Phase 1.5

Per merged plan PR #211 §0 scope item 16 (locked NO). Reasoning: pagination + merchant filter solves the 80% case for May-15 internal CAIO + May-18 external prospect demos; "find specific record" UX is a refinement, not load-bearing for the demo narrative.

### Trigger

Post-pilot operator feedback OR cross-tenant volume exceeds visible-list-size at default pagination (when "scroll the page to find a row" stops being practical). Likely surfaces within the first 30 days of pilot operations.

### Phase 2 scope sketch

- **Tier:** T2 (incremental UI affordance + service-layer search predicate; no schema change)
- **Surface:** add a `?q=<term>` URL query param to each admin page; debounced client-side input → page-level GET → service-layer search call
- **Service-layer:** new `searchAllTasks(ctx, { q, ...filters })` / `searchAllConsignees` / `searchAllSubscriptions` fns. Same `withServiceRole` + `requirePermission` posture as listAll fns
- **Repository:** ILIKE predicates on the high-cardinality columns (e.g., `tasks.external_tracking_number ILIKE '%<q>%' OR consignees.name ILIKE '%<q>%'`). `pg_trgm` extension consideration (faster ILIKE via GIN index) deferred until volume justifies — for ~5000 rows ILIKE without index is sub-second
- **Coverage:** integration tests + 1 fixture row containing the search term; assert the result set narrows correctly
- **Estimated effort:** 4-6 hours

### Cross-references

- Merged plan PR #211 §0 scope item 16
- Merged plan PR #211 §6 file-by-file complexity table (search affordance not included)

---

## §2 Lane B — Cursor pagination

### What's deferred

Cursor-based pagination on `/admin/tasks` (and `/admin/consignees`, `/admin/subscriptions` if they scale similarly). Currently Phase 1.5 ships OFFSET-based pagination per merged plan §5 pagination amendment.

### Why deferred from Phase 1.5

Per merged plan PR #211 §5 pagination amendment: "OFFSET pagination acceptable at pilot volume; cursor pagination is Phase 2 candidate if cross-tenant tasks scale to 10k+ rows."

OFFSET pagination has known drift problems at high page counts (`OFFSET 9000` does a sequential scan over 9000 rows then discards them). At pilot volume (~1500-2500 tasks total), this is sub-second. The 10k+ threshold is the crossover where OFFSET-induced query cost surfaces in operator-facing latency.

### Trigger

Production task count cross-tenant exceeds 10,000 OR p95 latency on `/admin/tasks` exceeds 500ms at default pagination depth.

### Phase 2 scope sketch

- **Tier:** T2 (service-layer + repository contract change; URL-state migration)
- **Surface:** replace `?page=<n>` with `?cursor=<base64-encoded-(delivery_date, created_at, id)>` style cursor
- **Service-layer:** breaking change to `ListAllTasksFilters` — `offset` removed, `cursor` added. Response shape gains `nextCursor` field
- **Repository:** WHERE clause changes to `(t.delivery_date, t.created_at, t.id) < (cursor.deliveryDate, cursor.createdAt, cursor.id)` for keyset pagination
- **Coverage:** integration tests for cursor stability (next cursor + previous cursor; concurrent insert doesn't break pagination)
- **Estimated effort:** 6-8 hours; breaking change so coordination with UI lane

### Cross-references

- Merged plan PR #211 §5 pagination amendment
- Merged plan PR #211 §6 file-by-file complexity table

---

## §3 Lane C — Cross-tenant action capability (Phase 1.6)

### What's deferred

Write-capable actions on the cross-tenant admin pages — currently Phase 1.5 ships READ-ONLY surfaces. Future Phase 1.6 work would let Transcorp staff perform actions ON OTHER MERCHANTS' DATA from `/admin/tasks` / `/admin/consignees` / `/admin/subscriptions`:

- Tasks: skip a delivery, change CRM state, mark canceled
- Consignees: change CRM state (ACTIVE → INACTIVE), reactivate
- Subscriptions: pause, resume, end

### Why deferred from Phase 1.5

Per merged plan PR #211 §0 scope item 15 (locked NO). Reasoning: Phase 1.5 demo-narrative is "Transcorp staff get visibility"; modifications happen through the merchant operator's tenant-scoped surface. Cross-tenant ACTION capability is a privilege-escalation surface that warrants its own design discussion + audit-trail considerations.

Open design questions for Phase 1.6:
1. Audit trail — every cross-tenant action MUST emit an audit event with `actor.kind='user'` AND `actor.userId=<staff>` AND a marker that distinguishes "staff acting on behalf" from "operator acting in own tenant"
2. Merchant communication — should the merchant tenant's operators be notified when transcorp-staff acts in their tenant? Email? Audit-log surfacing on operator side?
3. Permission gates — separate `<resource>:write_all` perms (parallel to read_all) or per-action grants (`task:cancel_all` etc.)?
4. Reversibility — some actions (skip, pause) are reversible; others (CRM-state-CHURNED) are sticky. Should cross-tenant actions be limited to reversible ones?

### Trigger

Operator feedback during pilot OR a specific Transcorp-side support escalation that motivates "I need to fix X for merchant Y RIGHT NOW without waiting for the merchant operator to log in."

### Phase 1.6 scope sketch

- **Tier:** T3 (new permission family + new action endpoints + audit-trail extension + UI surface in admin pages; demo-relevant if pulled forward to a future external demo)
- **Permissions:** `<resource>:write_all` family (or per-action; design call)
- **Service-layer:** new write fns parallel to existing tenant-scoped writes; `withServiceRole` instead of `withTenant`; audit-emit with `actor` flagged as cross-tenant staff
- **UI:** action buttons on the cross-tenant pages, gated on the write_all perms; confirmation modals stress "you are acting on tenant X's data"
- **Coverage:** integration tests for RBAC + audit emit + reversibility
- **Estimated effort:** 12-20 hours; non-trivial scope

### Cross-references

- Merged plan PR #211 §0 scope item 15
- `memory/followup_admin_middleware_phase2.md` (transcorp-staff role slug deferral; bundles with Phase 1.6 if both land together)
- `memory/followup_admin_merchant_list_filter_internal_tenant.md` (is_internal flag; if Phase 1.6 also adds per-tenant settings, this gets pulled in)

---

## §4 Sequencing notes

The three lanes are independent and can land in any order post-pilot. Lane A (search) is the highest-likelihood early trigger because of the scrolling UX pain. Lane B (cursor pagination) is volume-gated. Lane C (Phase 1.6 actions) is a deliberate product decision, not a forced trigger.

If multiple lanes land in the same PR, the sequencing is: **A then B then C** (search builds on existing list infrastructure cleanly; cursor pagination is a breaking change that affects search; actions sit on top of both).

---

**End of follow-up memo.**
