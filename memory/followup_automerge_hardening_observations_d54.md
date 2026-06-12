---
name: followup-automerge-hardening-observations-d54
description: Two orch-automerge hardening observations from the D54 clearance-execution session — (a) post-arm push gap, (b) reviewer transient comment-posting block. Assembly-day candidates; nothing built.
type: followup
status: open
filed: 2026-06-12 (Day-54)
---

# Follow-up — orch-automerge hardening observations (Day-54)

Two observations from the Day-54 clearance-execution session, filed as queue
items per dispatch. **Assembly-day candidates — nothing is built here.**

## (a) Post-arm push gap

**Observation:** once the orch-automerge Action arms GitHub auto-merge on a PR
(all gates verified at the then-current head), the armed auto-merge **survives
later pushes to the branch** — the merge completes at the NEW head once
required checks go green there, without a fresh ORCH-VERDICT pinned at that
head. The server-side verdict-at-head gate runs only at arming time.

**Live evidence (Day-54):** #481 and #470 were both refreshed git-natively
(merge of current `main` pushed to the branch) AFTER arming, to clear stale
pre-Pro Vercel rate-limit check failures; both armed auto-merges survived the
push and completed at the new heads. In those two cases the post-arm commits
were merges of already-reviewed `main` — benign, and the refresh was the
dispatched remedy — but the same gap would admit ANY post-arm commit.

**Fix shape:** disable auto-merge on `pull_request` `synchronize` — a small
workflow leg (or job) that runs `gh pr merge --disable-auto` when a labeled,
armed PR receives a new push, returning it to the wait state until a fresh
verdict at the new head re-triggers arming. Merge conditions unchanged;
arming still requires APPROVE at head.

## (b) Reviewer transient comment-posting block

**Observation:** the prior session reported a transient failure where a
reviewer subagent completed its body-read but was blocked posting its
ORCH-VERDICT comment (permission-layer classifier denial on the `gh pr
comment` route). Transient — not reproduced on retry; no verdict was lost,
but a recurrence would strand a PR in the WAIT state with no re-trigger.

**Action:** watch for recurrence; if it repeats, capture the exact denial
text and the command shape, and consider an allow-rule scoped to
ORCH-VERDICT posting for the reviewer agent. No change now.

## Cross-references

- `.github/workflows/orch-automerge.yml` — the merge lock (wait-not-park
  semantics landed Day-54 via #452).
- `memory/followup_clearance_merge_into_action.md` — clearance-mode lineage.
- `scripts/orchestration/RUNBOOK.md` — per-PR flow + standing reconciliation
  audit.
