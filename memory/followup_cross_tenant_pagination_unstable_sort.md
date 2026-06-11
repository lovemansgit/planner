---
name: Cross-tenant admin pagination — unstable ORDER BY (no tiebreaker) flakes under data growth
description: listAllConsignees + listAllSubscriptions paginate without a deterministic ORDER BY tiebreaker; their "offset shifts the window" specs intermittently return the same row on consecutive pages once many rows share the sort key (same-second created_at). Surfaced Day-53 under accumulated local test-DB state; CI's fresh-DB provisioning masks it. Fix is a trailing `, id` tiebreaker on the admin list queries + spec assertion unchanged.
type: followup
---

# The finding

Day-53 (2026-06-11), Session B, while running the full integration suite
repeatedly against an accumulated local test DB during the #368 fix round:

- `tests/integration/admin-subscriptions-cross-tenant.spec.ts` › "pagination —
  limit caps row count; offset shifts the window" failed intermittently
  (page1[0].id === page2[0].id).
- `tests/integration/admin-consignees-cross-tenant.spec.ts` › same-shaped spec,
  same intermittent failure on a different run.

Both specs are pre-existing (Day-19 Phase 1.5, PR #213) and both passed on
every CI run — CI provisions a FRESH Postgres per run (`scripts/setup-test-db.sh`),
so row counts stay small and sort-key collisions are rare. Locally, repeated
suite runs accumulate seed rows (many specs seed consignees/subscriptions with
no teardown), and once enough rows share the same `created_at` second the
unordered tail makes LIMIT/OFFSET windows non-deterministic — Postgres is free
to return overlapping pages.

# Root cause

The cross-tenant admin list queries (`listAllConsignees`,
`listAllSubscriptions` — Day-19 Phase 1.5 read surface) ORDER BY a non-unique
key (created_at-family) with no trailing unique tiebreaker.

# Fix shape (small, T2)

Append `, id` (or the table's PK) to the ORDER BY of the cross-tenant admin
list queries. No behavior change for operators beyond stable pagination. The
existing specs then hold under any data volume. Optional hygiene: teardown in
the highest-volume seeding specs (Session B added one to
`forward-override-outbound.spec.ts` in #368 as a first instance).

# Cross-references

- Surfaced during #368's Day-53 fix round (see its ORCH-PARK note).
- `memory/decision_d53_morning_clearances.md` — the Day-53 session this rode
  along with.
