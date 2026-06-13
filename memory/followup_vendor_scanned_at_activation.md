---
name: vendor_scanned_at activation waits on SF release
description: SF's task-asset-tracking API does not carry scan timestamps yet (vendor roadmap, Aqib 2026-06-12). asset_scan_log.vendor_scanned_at stays NULL until SF ships; flip the display path when the field lands on the wire
type: followup
---

Aqib's answer (2026-06-12, on the record via Love): scan timestamps
are **not in the task-asset-tracking API yet** — a vendor roadmap
item. SF's own report screens show scan date+time, so SF stores them;
the API just doesn't expose them.

## Provision shipped in 0032

`asset_scan_log` carries BOTH columns from day one:

- `vendor_scanned_at timestamptz NULL` — SF's scan time, populated
  the moment the wire carries it (no migration needed at activation).
- `received_at timestamptz NOT NULL` — when Planner observed the
  state (poll, read-through, or webhook).

Display logic (Love's ruling verbatim: "if no timestamp then put
actual timestamp of receiving the data"): show `vendor_scanned_at`
when present, else `received_at` honestly labeled **"recorded in
Planner"** until SF ships scan times.

## Activation checklist (when SF announces the release)

1. Probe one real record; snapshot the new field name/shape into the
   wire fixture (do not trust the announcement — Day-4 lesson).
2. Map the field in `asset-tracking-client.ts` → `vendor_scanned_at`
   on the log writer.
3. The UI flips automatically (it already prefers
   `vendor_scanned_at`); remove nothing.
4. Backfill question for Love at that moment: SF may expose
   timestamps for OLD scans on re-fetch — decide whether to
   re-poll history (append-only log gains corrected lines; never
   rewrites).

## Cross-references

- [`decision_bag_tracking_mvp.md`](decision_bag_tracking_mvp.md)
- Plan + §11 ruling addendum:
  [`plans/day-54-session-b-bag-tracking-reports.md`](plans/day-54-session-b-bag-tracking-reports.md)
- Vendor question list parent:
  [`followup_suitefleet_asset_tracking_api.md`](followup_suitefleet_asset_tracking_api.md)
  — Q5/Q7 partially answered by this ruling (state enum CONFIRMED
  five; `*_by` blocks carry no timestamps yet)
