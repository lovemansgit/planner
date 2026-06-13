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
   Refresh button covers the walk without it.

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
