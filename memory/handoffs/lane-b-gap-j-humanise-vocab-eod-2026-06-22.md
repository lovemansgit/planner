# Lane B — Gap J humanise + D4 vocabulary adoption — EOD (2026-06-22)

Overnight non-idle lane. Direction-INDEPENDENT (words + formatters only, true
in every aesthetic) → ran parallel to Lane A (aesthetic) with zero collision.
Adopts the shipped #560 humanise layer across rendered screens + fixes
operator-facing copy. Per the frontend-design writing rules.

## State: ALL 3 MERGED to main via Love's ORCH-CLEARANCE — NOT promoted

Branched off `origin/main` (`3379a13`, #566 fast-lane tip); zero file overlap.
Love cleared all three (2026-06-22/23): merged via the `orch-automerge`
`love-cleared` route (squash), each re-gated server-side (ORCH-CLEARANCE comment
present + ORCH-VERDICT APPROVE at head + CI green). **NOT promoted** — Love's
separate ruling; bounds were "rendered UI copy only; storage stays raw; no
migration; no promote".

| PR | Scope | Verdict | Merge commit |
|----|-------|---------|--------------|
| **#567** | consignee phones → `formatPhone()` (5 surfaces) + retire "subscriber" noun | APPROVE r1 | `508ee61` |
| **#569** | admin users list+detail → shipped `roleLabel()`; dedupe local helper | APPROVE r1 | `d7a84da` |
| **#570** | engineer-speak → operator copy (failed-pushes + webhook surfaces) | APPROVE r1 | `c051561` |

main tip after the wave: `9ef93fe` (Lane A mockups #568 also landed on top).
#569 transient-parked once ("Pull request is in unstable status" — its own
in-flight gate check briefly flipped the PR to UNSTABLE, which
`enablePullRequestAutoMerge` refuses); remedied by removing `parked-t3` +
re-applying `love-cleared`, merged clean on the retry.

Each: Round-0 self-review → fresh independent `reviewer` subagent (isolated
worktree) → ORCH-VERDICT. Full unit suite green on every branch
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
- **Promote when Love rules it** — all 3 are merged on main but NOT promoted.
  A whole-main promote ships these alongside whatever else has landed since
  `9ef93fe`. (Promote = `vercel promote <preview-dpl> --yes`; rollback anchor
  per the last promote memo.)
- Optional follow-up: the nav-config-owned "Failed pushes → Failed deliveries
  to SuiteFleet" rename (skip #1), then close the /tasks phone (skip #2).
- This memo (PR #571) rides the #566 docs/memory fast-lane (memory/**.md only).
