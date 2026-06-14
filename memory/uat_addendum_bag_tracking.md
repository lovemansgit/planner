---
name: UAT addendum — bag-tracking reports
description: Three UAT legs for the bag-tracking reports stack (#507/#508/P3), the preview-walk gating list, and the 5-minute walk script. Live-scan leg is UAT-opportunistic pending Aqib's staged sandbox scans
type: followup
---

# UAT addendum — bag-tracking reports (Day-54, plan PR #502 §8)

Appends to `uat_run_sheet_v2.md`. The stack ships dark (0034 default
false) — these legs run on a PREVIEW deployment first (staged posture
7a); they re-run post-promote per tenant as Love lights merchants up.

## Gating list — what the preview walk needs first (all wait on Love/Aqib)

1. **Love's named SQL go** for 0032 / 0033 / 0034 on the shared DB
   (the preview deployment reads that DB; without the tables the
   pages 500 at the service layer). Builder executes on the sentence
   and states the route.
2. **Love's per-tenant flag sentence** for ONE walk tenant — naming
   WHICH merchant (the demo merchant, not necessarily the live UAT
   merchant; lighting the UAT merchant exposes the Inventory nav to
   UAT operators mid-UAT). Builder executes the one-row UPDATE on the
   sentence.
3. **Seed data**: either (a) Aqib's staged sandbox scans land and one
   poll tick ingests them (the e2e-true path), or (b) Love authorizes
   a builder-seeded synthetic cache+log fixture on the shared DB
   (clearly labeled synthetic; deleted before UAT proper). (a) is the
   real proof; (b) un-blocks the walk if Aqib's staging lags.
4. **QStash schedule registration** (one command, $0-verified) — only
   needed for the "as of" stamp to advance on its own; the manual
   Refresh button covers the walk without it. **DEFERRED to the first
   real-tenant flip** (Love's ruling, 2026-06-14: "QStash registration
   DEFERRED to the first real-tenant flip — do not register now"). A
   dark fleet has nothing to poll, so registering earlier is a no-op;
   it becomes the first flip's second step (see "Flag-flip runbook
   step" below).

## Flag-flip runbook step — lighting the first REAL tenant

When Love names a real merchant to light (gating item 2), run BOTH
steps, first flip only:

1. **Flip the flag** — one-row UPDATE on Love's per-tenant sentence:
   `UPDATE tenants SET task_asset_tracking_enabled = true,
   default_task_asset_type = 'BAGS' WHERE slug = '<named-merchant>';`
   Builder executes and states the route. (Pre-req: Aqib's sandbox
   scans have proven the 30-minute ingest end-to-end — the flag never
   flips for a real tenant before that.)
2. **Register the QStash schedule — FIRST FLIP ONLY** (deferred from
   ship per Love's 2026-06-14 ruling): `set -a && source .env.local &&
   set +a; PUBLIC_BASE_URL=https://<prod-domain> node
   scripts/create-qstash-asset-poll-schedule.mjs` — needs `QSTASH_TOKEN`
   (production secret; pull into the local env or run where it is
   available — never through chat). Idempotent (dedupes by
   `scheduleId`); $0 at 48 msg/day on the free tier. The route
   `/api/cron/asset-tracking-poll` is already deployed + signature-gated
   in production (verified 403 to unsigned POST). Subsequent tenant
   flips do NOT re-register (one schedule polls all lit tenants).

## The three legs (plan §8, Love-accepted)

### Leg 1 — Admin Asset Tracking report + Asset Log (Transcorp persona)
- `/admin/asset-tracking` renders; counts match the seeded/staged
  fixtures; merchant rollup row = sum of its date rows.
- "Sorted" column populated (the state our schema previously rejected).
- Allocated Asset count → Asset Log: scan lines newest-first with
  date+time per status; each line stamped "recorded in Planner" until
  SF ships scan times; re-render changes NOTHING (append-only proof —
  also enforced structurally by the 0032 trigger).
- Dark-switch scoping: a merchant with the flag OFF does not appear.

### Leg 2 — Merchant Inventory report (operator persona)
- Lit tenant's operator sees "Inventory" in the nav; a DARK tenant's
  operator does NOT (and a direct URL renders the not-enabled state).
- By-date and by-consignee sections agree with each other; consignee
  rows expand per delivery date.
- Every value links to /tasks filtered to exactly its AWB set (filter
  chip + clear link); cross-tenant leak check against the second
  merchant.
- "Refresh now" updates the "as of" stamp; refresh on a dark tenant
  is refused (403).

### Leg 3 — Live SF scan (UAT-OPPORTUNISTIC, same posture as POD live-render)
- Waits on Aqib's staged sandbox scans (bags + ice packs through the
  five statuses on sandbox AWBs).
- When they land: one poll tick (or Refresh) ingests; the report
  counts move; the Asset Log grows lines WITHOUT rewriting old ones;
  the first real wire record gets fixture-snapshotted (retires the
  doc-derived inner-shape caveat, vendor Q9).

## 5-minute walk script (plain English, for Love on the preview URL)

1. Log in as Transcorp staff. Two new entries sit at the end of the
   admin menu: **Asset Tracking** and **Inventory**.
2. Open **Asset Tracking**. You should see one merchant block: a bold
   total row, then one row per delivery date. Check the columns match
   your screenshots: Assets allocated / Supp. qty / Collected /
   Received / Sorted / En route / Returned. Hover "Supp. qty" — the
   tooltip says "Number of ice packs".
3. Click the **Assets allocated** number → the **Asset Log** opens:
   every scan, newest first, each line marked "recorded in Planner"
   (SF doesn't send scanner timestamps yet — that label is the honest
   version). Refresh the page: the lines must be identical.
4. Go back; click any other number (say Collected) → the tasks list
   opens showing exactly those deliveries, with a banner "Showing N
   AWBs from a report drill-down" and a clear-filter link.
5. Open **Inventory**, pick the lit merchant: two sections — by date,
   and by consignee. Click a consignee row: it expands into its
   delivery dates. Click any value: tasks list again, filtered.
6. Log in as the lit merchant's operator: **Inventory** appears in
   their menu; same report, scoped to them. Press **Refresh now** —
   the "as of" stamp in the header updates.
7. Log in as the OTHER merchant's operator (dark): no Inventory menu
   item; pasting the URL shows "Asset tracking is not enabled for
   your account."

If all seven hold: that's the preview walk — your sign-off sentence
releases the stack to merge (it still stays dark in production until
your per-tenant flag sentences).

## Status — 2026-06-13 (Day 54/55): re-walk PASS, shipped DARK

The preview walk was run and signed off ("Re-walk PASS — the
bag-tracking stack #507 → #508 → #509 → #513 is cleared to merge").

- **Legs 1 + 2 PROVEN on the preview** (admin Asset Tracking + Asset
  Log; merchant Inventory; dark-switch scoping; AWB drill-downs;
  tooltips). Walk findings F1 (admin Inventory all-merchants view) and
  F2 (admin nav overflow → Reports dropdown) were fixed in P4 (#513)
  and re-walked.
- **Stack merged** to main via collapse-to-#513 (squash `d02b198`) and
  **promoted DARK** to production (`e00a4ae`, `dpl_9EGTCnv8…`, rollback
  anchor `d64e835`). Migrations 0032/0033/0034 already on the
  production Supabase. The `/api/cron/asset-tracking-poll` route is
  deployed and signature-gated (unsigned POST → 403). Fleet all-dark
  (`lit tenants = 0`); the walk's synthetic seed was removed post-walk
  (scan_log 18 / cache 6 / tasks 4 / consignees 2 deleted, zero SYN
  residue).
- **Leg 3 (live SF scan) — STILL UAT-OPPORTUNISTIC**, unchanged: it
  waits on Aqib's staged sandbox scans (bags + ice packs through the
  five statuses on sandbox AWBs). When they land, one poll tick (or
  Refresh) ingests, the counts move, the Asset Log grows lines without
  rewriting old ones, and the first real wire record is
  fixture-snapshotted (retires the doc-derived inner-shape caveat,
  vendor Q9).
- **QStash 30-minute schedule registration — OUTSTANDING.** Needs
  `QSTASH_TOKEN` (production secret, not in the local env). Deferrable
  to the first real-tenant flip: a dark fleet has nothing to poll, and
  the manual Refresh covers any walk. Register at the same gate as the
  first per-tenant flag sentence.
- **The flag flips for a REAL tenant ONLY on Love's explicit
  per-tenant sentence**, and only AFTER Aqib's scans prove the
  30-minute ingest end-to-end. Until then the feature is dark in
  production by construction (0034 default false).
