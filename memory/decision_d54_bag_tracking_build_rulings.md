---
name: D54 bag-tracking build clearance + vendor answers + staged posture
description: Love cleared #502 (all 10 recommendations as written), Aqib confirmed the 5-state enum / no API scan timestamps yet / ice-packs+bags semantics, 30-min poll cadence ruled, staged verification posture (preview sign-off before any merge; 0034 flag dark per tenant until Love flips by sentence)
type: decision
---

Rulings of record, riding the Day-54 (2026-06-12) Session B build
firing. Full verbatim quotes live in the plan's §11 ruling addendum
(`plans/day-54-session-b-bag-tracking-reports.md`); this memo is the
discoverable index.

1. **#502 cleared — all ten recommendations accepted as written.**
   "Build is CLEARED on this plan." Clearance basis: firing-as-
   clearance (the firing names #502 explicitly) + the quoted sentence.
2. **Vendor answers (Aqib via Love):** state enum complete at FIVE
   (Collected / Received / Sorted / EnRoute / Returned — wire
   `COLLECTED` / `RECEIVED` / `SORTED` / `EN_ROUTE` / `RETURNED`);
   scan timestamps NOT in the API yet (roadmap —
   `followup_vendor_scanned_at_activation.md`); **Supp. Quantity =
   number of ice packs**, **Allocated Asset = number of bags
   allocated to the AWB** (verbatim in tooltips).
3. **Ingest cadence:** 30-minute poll of the SF GET (supersedes the
   plan's manual-refresh-only recommendation; manual Refresh stays as
   the operator override). Tier-proof scheduling required — no Vercel
   Pro dependency (Love downgrades to Hobby post-build); QStash
   (existing stack, $0) or equivalent; if every tier-proof route
   implies new spend, PARK. Poll scope: AWBs plausibly in motion,
   bounded batches, respectful of the vendor.
4. **Staged verification posture:** (a) NOTHING from this lane merges
   to main before Love's explicit preview sign-off sentence after
   walking the reports on a preview deployment (dev DB + SF sandbox);
   (b) the 0034 tenant flag gates ALL surfaces, default off pinned by
   test, per-tenant activation only by Love's sentence; (c) demo-ready
   preview hands Love the URL + a 5-minute plain-English walk script;
   (d) end-to-end ingest proof waits on Aqib's staged sandbox scans —
   meanwhile coverage runs on recorded/synthetic shapes, labeled.
5. **Migrations 0032/0033/0034:** park SQL-TO-APPLY individually at
   their build moments — never fire-cleared. Dev-DB applies for
   build/test fine under the firing; production applies park.
6. **Fences:** Session A's lane untouched; no spend; UAT fixtures
   (Fatima + AWB MPL-40595232) are read-only.
