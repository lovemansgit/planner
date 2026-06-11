---
name: Session B pre-onboarding-work bootstrap (Day 18, post-compact)
description: Fresh Session B resume context for whatever onboarding-related work Reviewer C assigns post-bootstrap. Day 18's heavy A1 + test-tenants architectural work is shipped + production-live. Next phase is operator-user creation to enable production smoke gates 12 and 18. Session B was last working on test-tenants cleanup PR #191 (merged at 301dbde); has since been synced to current main 4e0b3c5. Reviewer is fresh-context Reviewer C (replaced Reviewer B mid-Day-18).
type: project
---

# Session B bootstrap — pre-onboarding-work (Day 18, post-compact)

## §1 Read-first orientation

You are Session B, the UI lane in the parallel-session pattern.
Session A operates the architectural lane in the main worktree at `/Users/lovemansgit/Code/planner`.
This session was just compacted to preserve context budget for whatever onboarding work Reviewer C assigns next.

**Repo HEAD at compact time:** `4e0b3c5` (post Day-18 A1 + test-tenants merges + Vercel promote).
**Worktree:** `~/work/planner-b`. Detached HEAD at origin/main.
**Reviewer:** Reviewer C, fresh-context, in claude.ai. Replaced Reviewer B mid-Day-18 at handoff.

**First action on resume:** read this file in full, then read the four files listed in §2. Then await Reviewer C's onboarding-survey output relay or work assignment.

## §2 Required reads on resume

1. `memory/PLANNER_PRODUCT_BRIEF.md` — current at v1.7 post-A1.
2. `memory/MEMORY.md` — index, with Day-18 entries from both A1 and test-tenants PRs.
3. `memory/plans/day-18-test-tenants-cleanup.md` — the plan you implemented in PR #191.
4. `memory/handoffs/bootstrap-session-a.md` — Session A's standing bootstrap, for reference on parallel-session coordination patterns.

Optional (read on-demand):
- `memory/handoffs/day-17-eod.md` — Day-17 substantive landings
- `memory/decision_test_tenants_cleanup_snapshot.md` — your snapshot memo from PR #191
- `memory/snapshots/test-tenants-archive-2026-05-08.csv` — your pre-archive CSV

## §3 What Day 18 has shipped (locked, do not relitigate)

**A1 (PR #192) — SuiteFleet customer_id per-tenant resolver swap.** Resolver now reads `tenants.suitefleet_customer_code` from DB (numeric customerId per tenant: 588 MPL, 586 DNR, 578 FBU); throws CredentialError on missing/invalid. Wire body unchanged. Brief amended v1.6 → v1.7. Pattern B (race-condition-belt guard kept; plan §2.5 framing was empirically wrong; memo filed).

**Test-tenants (PR #191, your work) — soft-archive 377 fixture rows.** Migration 0021 widened tenants_status_check to 5-state; 377 fixture rows flipped to status='archived'. Demo-three preserved at status='active'. Cron β filter added (status IN ('provisioning', 'active')). TS exhaustive switch + Zod enum + repo filter all widened in atomic bundle.

**Production state:** Both PRs production-live at HEAD `4e0b3c5`. Migration 0021 verified applied (379 archived + 3 active demo-three with customer codes 588/586/578). Vercel promote cleared 11-commit queue in single promote.

## §4 What's owed Day 18

1. **Operator user creation** — to unblock production smoke gates 12 and 18. No transcorp_staff or tenant operator users exist in production yet. Reviewer C is drafting an onboarding plan-PR after Session A's pre-onboarding survey returns.
2. **Production smoke Gate 12** — admin merchant list shows 3 demo merchants only.
3. **Production smoke Gate 18** — trigger createTask on each of three demo tenants; verify each lands on correct SF merchant per SF console. Load-bearing demo-correctness proof.
4. **A2 plan-PR** — webhook handler 3-layer (Layer 1.5 verdict locked: AWB-only fix; Layers 2-3 still to design).
5. **Day-17 backfill in MEMORY.md** — pre-existing gap.
6. **Brand pass on per-page surfaces.**
7. **Demo data prep** (Fatima, Sarah, 5 cherry-picked DELIVERED tasks).
8. **demo-preflight.sh.**
9. **Day-18 EOD doc.**

You may be assigned any of items 1, 5, 6, or 7 depending on Reviewer C's split with Session A.

## §5 Discipline rules to hold (from Reviewer A handoff §3 + Reviewer B Day-18 additions)

- **§3.1** ground in data, not hypothesis
- **§3.2** verify shipped contracts before drafting (grep before naming)
- **§3.3** bidirectional info flow with reviewer (relay findings proactively)
- **§3.4** survey registered metadata before drafting
- **§3.5** trust Love's architectural context as ground truth
- **§3.6** post-draft re-review on every structured artifact
- **§3.7 (Day-18)** filenames in plans/EOD docs/handoffs MUST be verified against actual `ls` output. Project files in claude.ai are NOT repo files. Repo HEAD wins.
- **§3.8 (Day-18)** force-push (with-lease or otherwise) requires explicit reviewer authorization BEFORE action. Surface proposed action + reasoning; reviewer authorizes; then act. Session A self-corrected on this rule today; precedent established.

## §6 Per-call worktree pattern (unchanged)

Your bash tool starts each call from `/Users/lovemansgit/Code/planner` (Session A's main worktree), not your worktree at `~/work/planner-b`. All Session B operations target the parallel worktree explicitly:

- `git -C ~/work/planner-b <cmd>`
- `cd ~/work/planner-b && <cmd>` (chained inside one call)
- Absolute paths for file edits

**Detached HEAD anchor pattern:** when starting a new Session B task, first command is:
`git -C ~/work/planner-b fetch origin && git -C ~/work/planner-b checkout -b day18/<feature>` 
(anchor on current origin/main, which is `4e0b3c5` at bootstrap time but may have advanced if Session A has merged anything new).

**Worktree-merge brittleness fallback** (per `memory/feedback_parallel_sessions_use_git_worktree.md`): if `gh pr merge --delete-branch` aborts because your worktree holds the branch, fall back to manual cleanup pattern. You have used this pattern successfully twice today (PR #186 + PR #189).

## §7 What NOT to do

- Don't begin code work until Reviewer C surfaces an explicit prompt
- Don't relitigate locked architectural decisions in §3
- Don't authorize force-push without explicit reviewer authorization
- Don't assume project-file names match repo file names — verify with `ls` or `git ls-files`
- Don't mark the day closed; Love makes that call
- Don't run any production-targeting writes (Supabase SQL editor, prod API mutations) without reviewer authorization

## §8 First-turn protocol on resume

After reading this bootstrap + the four files in §2:

1. Confirm absorption with a single line: "Session B bootstrap absorbed. Worktree HEAD verified at <SHA>. Ready for Reviewer C's next assignment."
2. Verify worktree HEAD: `git -C ~/work/planner-b log -1 --oneline`
3. If HEAD is not 4e0b3c5, surface the actual HEAD — Session A may have advanced main with a fix-up PR. That's not a problem; just a coordination note.
4. Stand by for Reviewer C's prompt.

DO NOT begin any code work, file edits, or PR creation in your first turn post-resume.
