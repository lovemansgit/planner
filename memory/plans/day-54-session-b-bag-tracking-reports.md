# Day-54 Session B — Bag Tracking Reports (T3 plan, PLAN ONLY)

**Status:** PARKED for Love. No code, no migrations, no spend, no
credentials handled. Build starts only on Love's clear.

**Ruling of record (dispatch, 2026-06-12):** the parked post-MVP
"bag tracking" item is pulled forward — PLAN ONLY this dispatch; no
build until the plan parks and Love clears.

## 0. The business request (verbatim from dispatch)

> A. Asset Tracking report (Transcorp admin, all merchants): columns
> Collected / Received / Sorted / En Route / Returned / Allocated
> Asset / Supp. Quantity; Allocated Asset count hyperlinks to an Asset
> Log; the log shows scan date+time per status, append-only lines,
> never overwriting prior statuses.
>
> B. Inventory report (merchant users + Transcorp admin, merchant-scoped
> to their consignees): by-date and by-consignee sections, both with
> Delivery Date / Assets Allocated / Supp. Qty / Collected / Received /
> Sorted / En Route / Returned; consignee rows expand per delivery
> date; every value hyperlinks to its AWB set.

Reference visuals: SF's own report screens (Love's screenshots) —
mirror the information design, not pixel-fidelity.

## 1. Probe result (2026-06-12, sandbox merchant 588, read-only)

Script: `scripts/probe-sf-asset-tracking-report.mjs` (in this PR).
Auth route: standard client-credentials flow we hold —
`POST /api/auth/authenticate` → Bearer `accessToken` + `Clientid`
header. Same auth as `/api/tasks`.

Findings, in order of load-bearing-ness:

1. **No user-JWT requirement.** All 12 single-AWB GETs against
   `GET /api/task-asset-tracking?awbs=<AWB>` returned **200** with our
   client-credentials Bearer token. The dispatch's STOP condition
   (endpoint requires user-JWT) did NOT trigger. (A first run got 401
   — that was our probe script reading the wrong token field
   (`token` vs `accessToken`), not an SF auth posture; fixed and
   re-run, the existing adapter already reads `accessToken`.)
2. **Batch `awbs=` accepted.** Comma-separated 3-AWB query returned
   200 with a valid Spring-Data wrapper — the separator does not
   error. Caveat kept honest: with zero records on every probed AWB
   we proved *acceptance*, not *merged multi-AWB content*. First
   non-empty batch response upgrades this to proven. (Vendor
   question 4 in `followup_suitefleet_asset_tracking_api.md`,
   partially retired.)
3. **Sandbox still has ZERO asset records.** All 12 most-recent
   AWBs (statuses CREATED / SKIPPED / CANCELED, delivery dates
   2026-06-23 → 2026-07-02) returned the empty wrapper verbatim:

   ```json
   {
     "content": [], "last": true, "totalElements": 0,
     "totalPages": 0, "first": true, "number": 0,
     "numberOfElements": 0, "size": 50, "empty": true
   }
   ```

   The **inner record shape therefore remains doc-derived, not
   empirically pinned** — unchanged since the Day-6 B-1 probe
   (vendor question 9). Everything downstream that depends on the
   inner shape carries that caveat and a fixture-snapshot obligation
   on first real record.

## 2. What already exists (this is NOT a greenfield)

Day-6 B-1/B-2 shipped a working asset-tracking vertical
(`decision_bag_tracking_mvp.md`):

- **Cache table** `asset_tracking_cache` (migration 0011): one row
  per package (`tracking_id` unique), `awb` STORED generated column,
  `state` CHECK `('COLLECTED','EN_ROUTE','RECEIVED','RETURNED')`,
  `type` CHECK `('BAGS')`, `supplementary_quantity` integer,
  `collected_by`/`enroute_by`/`received_by`/`returned_by` jsonb,
  tenant-match trigger, RLS.
- **Module** `src/modules/asset-tracking/` — repository + read-through
  service (5-min TTL) + 3 audit events (`refreshed`, `state_changed`,
  `orphan_dropped`).
- **SF client** `asset-tracking-client.ts` + adapter
  `fetchAssetTrackingByAwb` (single-AWB; logs+truncates if
  `totalPages > 1`).
- **Route** `GET /api/tasks/[id]/asset-tracking` gated on
  `asset_tracking:read`. No UI component renders it yet.

## 3. Gap analysis (request vs. existing)

| # | Gap | Severity |
|---|-----|----------|
| G1 | **`SORTED` state missing.** The requested columns include "Sorted"; our `state` CHECK pins 4 states without it. SF's own report screens showing a Sorted column is empirical evidence SF's lifecycle has ≥5 states — the restrictive CHECK (Option A) would reject the first SORTED record into the error queue. Schema change required. | Blocking |
| G2 | **No append-only scan log.** The cache UPSERTs (latest state wins); the Asset Log requires never-overwritten per-status lines with scan date+time. New table required. | Blocking |
| G3 | **No aggregation path.** Reports need counts across dates / consignees / merchants; today's service is one-AWB-at-a-time read-through. | Blocking |
| G4 | **No cross-tenant permission.** `asset_tracking:read` is tenant-scoped; the Transcorp report needs a `read_all` sibling (pattern: `task:read_all` etc.). | Blocking |
| G5 | **Webhook flag unwired.** `customer.taskAssetTrackingEnabled` / `defaultTaskAssetType` are not persisted; reports should render "not enabled" states honestly per merchant. (The known post-B-2 follow-up becomes load-bearing.) | Medium |
| G6 | **Batch fetch unwired.** Adapter is single-AWB; report refresh wants chunked `awbs=a,b,c` GETs (probe: accepted). | Medium |
| G7 | **Scan timestamps unproven.** The log needs scan date+time per status. SF's own log screen shows them, so SF stores them — whether the API's `*_by` jsonb blocks carry them is unproven (inner shape never seen). Fallback: our observation time. | Medium |

## 4. Data architecture: ingest-and-store (recommended), not live-query

**Live-query rejected:** a report over D dates × C consignees fans out
to one SF GET per AWB-chunk per render — hundreds of calls against an
endpoint with an unknown rate limit (vendor question 3), and it cannot
produce an append-only history at all (SF returns current state; the
log must be accumulated locally).

**Recommended: extend the existing hybrid cache into the system of
record for reporting.**

1. `asset_tracking_cache` stays the *current-state* store (it is
   already persistent; UPSERT, never evicted).
2. New **append-only** `asset_scan_log` table accumulates one row per
   observed `(tracking_id, state)` transition — written by the same
   code paths that write the cache (read-through refresh today;
   webhook ingestion once wired). Never UPDATEd, never DELETEd.
3. Reports aggregate **locally** (SQL GROUP BY over cache + log +
   tasks join for consignee/date), with freshness shown as
   "as of <oldest last_synced_at in range>" + a bounded manual
   Refresh action (chunked batch GETs).

### Named migrations (ALL park for Love's named authorization at build time)

- **`0032_asset_scan_log.sql`** — new table: `id`, `tenant_id` (FK),
  `task_id` (FK), `tracking_id`, `awb`, `state`, `scanned_at`
  (timestamptz — SF scan time when the wire carries it, else our
  observed-at), `scanned_by` jsonb, `source`
  (`read_through`|`webhook`), `sf_payload` jsonb (verbatim record
  snapshot), `created_at`. Indexes: `(tenant_id, awb)`,
  `(tenant_id, tracking_id, scanned_at)`, `(tenant_id, scanned_at)`.
  Append-only enforced by **trigger** (BEFORE UPDATE OR DELETE →
  RAISE), NOT by `DO INSTEAD NOTHING` rules — the 0002 rule pattern
  is documented to break `ON DELETE CASCADE` from tenants
  (`followup_audit_rule_cascade_conflict.md`); the trigger variant
  must allow cascade deletes from the tenant teardown path or use
  RESTRICT deliberately (build-time design note for the reviewer).
  RLS: tenant SELECT policy only; writes via service role.
- **`0033_asset_tracking_state_sorted.sql`** — extend
  `asset_tracking_cache_state_check` to include `'SORTED'` (drop +
  re-add CHECK). Same 5-state CHECK on `asset_scan_log.state`.
  Unknown future states keep today's error-queue posture.
- **`0034_tenants_asset_tracking_flag.sql`** —
  `tenants.task_asset_tracking_enabled boolean NOT NULL DEFAULT false`
  + `tenants.default_task_asset_type text` — persisted from inbound
  webhook payloads (`customer.taskAssetTrackingEnabled` /
  `customer.defaultTaskAssetType`), refreshed on every event.

No data backfill is possible (sandbox has zero records; production
history starts accumulating at deploy — see Q7).

## 5. Role / visibility model (reuse, no new concepts)

- New permission **`asset_tracking:read_all`** (systemOnly: true) —
  exact sibling of `task:read_all` (`permissions.ts` pattern).
  Transcorp roles get it via the ALL set automatically; merchant
  roles never see it.
- Merchant report reuses existing **`asset_tracking:read`**
  (tenant-admin + ops-manager hold it today; CS Agent does NOT —
  see Q6). Merchant scoping to own consignees is automatic: RLS +
  `withTenant`, same as every tenant-scoped list page.
- Surfaces: Inventory report in `(app)` for merchants; Transcorp
  admin gets the Asset Tracking report + an all-merchants Inventory
  view in `(admin)` via `withServiceRole` + `requirePermission`,
  exactly the `/admin/tasks` pattern.

## 6. Report surfaces

### A. `/admin/asset-tracking` — Asset Tracking report (Transcorp)

- Rows: **merchant × delivery date** within a date-range filter
  (default: last 30 days — see Q3). Columns: Collected / Received /
  Sorted / En Route / Returned (counts of packages currently in that
  state, from cache) / **Allocated Asset** (count of asset records in
  scope — see Q9) / **Supp. Quantity** (SUM of
  `supplementary_quantity` — see Q8).
- **Allocated Asset hyperlinks to the Asset Log**:
  `/admin/asset-tracking/log?merchant=…&date=…` — renders
  `asset_scan_log` lines (scan date+time, state, tracking_id, AWB,
  scanned-by) newest-first, append-only by construction, grouped per
  package. The log page is also reachable per-AWB.

### B. `/reports/inventory` (merchant) + `/admin/inventory` (Transcorp, all merchants)

- **By-date section:** rows per delivery date; columns Delivery Date /
  Assets Allocated / Supp. Qty / Collected / Received / Sorted /
  En Route / Returned.
- **By-consignee section:** rows per consignee, expandable per
  delivery date (client-side expand, same data query grouped twice).
- **Every value hyperlinks to its AWB set:** link target = the
  existing tasks list filtered by the AWB set
  (`/tasks?awbs=…` / `/admin/tasks?awbs=…`, new query-param filter on
  the existing pages — see Q4) so drill-down lands on a page
  operators already know, with task status, consignee, and the
  per-task asset state available.

Shared plumbing: one aggregation query module in
`src/modules/asset-tracking/` (e.g. `report-repository.ts`), both
pages are thin renderers over it. SF screenshots drive column order
and grouping; existing table primitives drive look and feel.

## 7. Build plan + estimate

Three PR pairs, ~**5–6 working days** total:

| Phase | Content | Est. |
|---|---|---|
| P1 backend | Migrations 0032/0033/0034 (PARK for named auth), scan-log writer in refresh path, webhook flag + cache/log ingestion wiring, batch `awbs=` adapter method, `asset_tracking:read_all` perm. RED-first tests incl. append-only + RLS regression. | 2 d |
| P2 reports | Aggregation queries + `/admin/asset-tracking` + Inventory (merchant + admin) + AWB-set filter on tasks pages. | 2–2.5 d |
| P3 log + polish | Asset Log page, drill-down links everywhere, freshness/Refresh affordance, empty/not-enabled states, UAT addendum. | 1–1.5 d |

Every PR rides the normal Shape-3 seam (reviewer body-read, park
labels); the three migrations park in every phase per the standing
floor.

## 8. UAT addendum shape

Three legs appended to the run sheet:

1. **Admin Asset Tracking report** renders; counts match seeded cache
   + log fixtures; Allocated Asset link lands on the log; log lines
   never change across re-renders (append-only proof).
2. **Merchant Inventory report** scoped to own consignees only
   (cross-tenant leak check vs. second seeded merchant); by-date and
   by-consignee sections agree with each other; every value links to
   the right AWB set.
3. **Live SF scan leg — UAT-opportunistic** (same posture as POD
   live-render): sandbox has zero asset records, so a real
   COLLECTED→…→RETURNED walk only happens if/when SF attaches assets
   on a sandbox or pilot task. Until then the wire-shape caveat
   (§1.3) stands and the first real record gets fixture-snapshotted.

## 9. Directional questions for Love (one recommendation each)

1. **Nav placement.** Where do the reports live? — *Recommend:* a new
   "Reports" nav group on both sides: merchant nav gains "Inventory";
   admin nav gains "Asset Tracking" + "Inventory". One group now,
   future reports slot in without nav churn.
2. **Refresh cadence.** Reports read the local store and show an
   "as of" stamp. — *Recommend:* manual Refresh button doing a
   bounded chunked batch refresh (e.g. ≤10 GETs per click) on top of
   the 5-min read-through TTL; no cron sweep until pilot data shows
   staleness pain. Keeps SF load bounded with an unknown rate limit.
3. **History depth.** How far back can reports query? —
   *Recommend:* date-range picker with 30-day default, 90-day max in
   v1; the scan log retains everything (append-only), only the UI
   window is bounded, so the cap is a UI lift later, not a data
   decision.
4. **Link targets.** Where does a drill-down value land? —
   *Recommend:* existing `/tasks` and `/admin/tasks` pages with a new
   AWB-set query-param filter — operators land somewhere familiar; no
   new drawer component to build or maintain.
5. **Admin report row scope.** SF's screen implies a flat report. —
   *Recommend:* merchant × delivery-date rows behind a date-range +
   merchant filter; a merchant-rollup row per merchant on top.
6. **CS Agent access.** CS Agent's hand-rolled permission list does
   not include `asset_tracking:read` today, so CS Agents would not
   see the Inventory report. — *Recommend:* grant it (read-only,
   harmless, consignee-facing role answering "where's my bag"
   questions); flag because role grants are Love's call.
7. **History starts at deploy.** No backfill exists — SF gives
   current state only, so the log accumulates from go-live; early
   reports show current-state counts with thin history. —
   *Recommend:* accept; note it on the report UI ("history since
   <deploy date>") for the pilot.
8. **Supp. Quantity semantics.** Doc-derived integer per package; we
   render SUM per scope. Exact business meaning (extra loose items
   accompanying bagged assets?) unconfirmed. — *Recommend:* SUM +
   footnote, and add the semantics question to the Aqib vendor list.
9. **"Allocated Asset" semantics.** — *Recommend:* count of asset
   records (packages with an asset attached) in scope — matches
   `totalElements` per AWB set and is computable from the cache; ask
   Aqib to confirm against SF's own column definition.
10. **Vendor email refresh (no spend, two asks).** G1/G7 hang on SF
    facts: the full state enum (is it exactly
    COLLECTED/RECEIVED/SORTED/EN_ROUTE/RETURNED?) and whether the
    API's `*_by` blocks carry scan timestamps. — *Recommend:* fold
    both into the standing Aqib question list now so answers can land
    before P1 freezes the CHECK constraint; build proceeds on the
    5-state assumption + observed-at fallback either way.

## 10. Explicitly NOT in this dispatch

No code, no migrations created or applied, no spend, no credentials
requested or handled, no vendor email sent. The probe was read-only
GETs with credentials already held in `.env.local`. Session A's lanes
(#496/#497 churn gate + row lock, promote branch) untouched.
