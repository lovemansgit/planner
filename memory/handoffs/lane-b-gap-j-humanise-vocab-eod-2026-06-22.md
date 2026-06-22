# Lane B — Gap J humanise + D4 vocabulary adoption — EOD (2026-06-22)

Overnight non-idle lane. Direction-INDEPENDENT (words + formatters only, true
in every aesthetic) → ran parallel to Lane A (aesthetic) with zero collision.
Adopts the shipped #560 humanise layer across rendered screens + fixes
operator-facing copy. Per the frontend-design writing rules.

## State: 3 PRs OPEN, all green, awaiting Love's promote ruling

All three branched off `origin/main` (`3379a13`, #566 fast-lane tip).
**Zero file overlap between the three** → independently mergeable in ANY order.

| PR | Branch | Scope | Reviewer |
|----|--------|-------|----------|
| **#567** | `lane-b/batch1-consignee-phones-noun` | consignee phones → `formatPhone()` (5 surfaces) + retire "subscriber" noun | **APPROVE r1** |
| **#569** | `lane-b/batch2-admin-role-labels` | admin users list+detail → shipped `roleLabel()`; dedupe local helper | **APPROVE r1** |
| **#570** | `lane-b/batch3-operator-copy` | engineer-speak → operator copy (failed-pushes + webhook surfaces) | **APPROVE r1** |

Each: Round-0 self-review → fresh independent `reviewer` subagent (isolated
worktree) → ORCH-VERDICT on PR. Full unit suite green on every branch
(2423–2427 tests), `tsc --noEmit` clean, `eslint` clean.

## What shipped, by batch

**Batch 1 (#567) — `formatPhone` + noun.** `+971501234567` → `+971 50 123 4567`
on: operator consignees list table, consignee detail (header + Contact),
admin consignees list, admin consignee detail. Form INPUTS stay E.164
(parse, not display). Noun: nav-config `"Subscriber base"`→`"All consignees"`,
`"merchant subscriber"`→`"consignee"`; `/consignees` subhead
`"Subscriber base."`→`"Everyone you deliver to."`. New `ConsigneesTable`
render-proof test; `nav-config.spec` label assertions updated. Storage
unchanged; search still matches (ILIKE digit-strips server-side).

**Batch 2 (#569) — `roleLabel`.** `/admin/users` list rendered raw
`roleSlugs.join(", ")` → now `roleLabel()` (catalogue-backed). Detail page
migrated from a local 3-role helper (raw-slug fallback for cs-agent /
transcorp-systems) to the same shipped `roleLabel`, so list + detail are
identical and all 5 roles humanise. Removed the orphaned local `roleLabel`
+ its helpers.spec cases (covered by `role-label.spec`). Edit/create forms
were already correct (option value=slug, label=human) — untouched.

**Batch 3 (#570) — operator copy.** Failed-pushes (list/resolved/retry-client)
+ webhook-config: `"Operations · DLQ"`→`"Operations · SuiteFleet"` (×4);
`"…task pushes that hit the dead-letter queue … 5 requests per second …
hammered"` → `"Deliveries that didn't reach SuiteFleet … paced … overwhelmed"`;
`"…when the cron writes a DLQ row"`→`"appear here automatically"`;
`"back to DLQ"`→`"back to the failed queue"` (×2); `"dead rows stay dead"`→
`"won't be resent"`; webhook `"Coming soon: credential management"`,
`"deferred to a future commit"`/`"receiver-side persistence"`,
`"Self-serve credential management…"` → plain operator wording. No logic /
contract / API change.

## Deliberate SKIPS (noted, not done) — for a follow-up lane

1. **`Failed pushes` → `Failed deliveries to SuiteFleet` top-level rename.**
   KEPT the "Failed pushes" / "push" product term in Batch 3 on purpose:
   the nav-config "Failed pushes" label sits in the SAME `visibleLandingCards`
   spec hunk Batch 1 (#567) edits → renaming it cross-PR-conflicts. Do the
   rename as ONE nav-config-owned change (nav tab + landing card + page
   headings + calendar badge together) so the term stays consistent
   everywhere. Until then "Failed pushes" is internally consistent (nav ↔
   heading ↔ badge all say it).
2. **`/tasks` consignee-cell phone** (`tasks/client.tsx:430`, plain-text
   `cgn.telephone`). Hard boundary — `/tasks` is the just-shipped
   status-filter lane. Leaves ONE cross-surface phone inconsistency
   (humanised everywhere except /tasks) for the /tasks-owning lane to close.
3. **Calendar "Failed push" badge** (`DayActionPopover`): left as-is for
   consistency with the retained "push" product term; also layout-sensitive
   (truncated 8px badge). Fold into follow-up #1.

## Next session
- Love rules promote on #567/#569/#570 (any order; all independent, all green).
  These are code PRs → a promote, not the docs fast-lane.
- Optional follow-up: the nav-config-owned "Failed pushes → Failed deliveries
  to SuiteFleet" rename (skip #1), then close the /tasks phone (skip #2).
- This memo rides the #566 docs/memory fast-lane (memory/**.md only).
