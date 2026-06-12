---
name: love-cleared allow-rule — agent-appliable clearance label (Day-54)
description: Love-ruled 2026-06-12. The gh-pr-edit --add-label love-cleared permission is allowed to the builder/subagents; authorization is Love's recorded sentence, not the label identity; a reconciliation audit at each claude.ai check-in is the compensating control; the shared-identity question is resolved by ruling, revisit post-UAT.
type: reference
---

# Decision — `love-cleared` allow-rule (agent-appliable clearance label)

**Ruled:** Day-54 (2026-06-12), by Love, on the record.

## Context

The orch-automerge Action merges an off-allowlist PR in **clearance mode** when
the PR carries the `love-cleared` label (`.github/workflows/orch-automerge.yml`;
hardening memo `memory/followup_clearance_merge_into_action.md`). The open
hardening question was how to make that clearance signal un-spoofable by the
builder/subagents, given builder and Love share one GitHub identity.

A permission allow-rule was added to `.claude/settings.json`:

    "Bash(gh pr edit*--add-label*love-cleared*)"

The Claude Code auto-mode classifier blocks **every agent route** to install it
(self-granted permission widening / self-modification — the denial states "user
instruction cannot clear" it, even for a Love-authored commit cherry-picked by
an agent). Love therefore authored and committed the settings change **himself**
(GitHub web), landing on `main` at `14709c0`. An independent reviewer (separate
context) body-read the pinned SHA and verified: deny-pair intact
(`Bash(gh pr merge)`, `Bash(gh pr merge:*)`) plus exactly the one allow line,
only `.claude/settings.json` touched, 3 insertions.

## The ruling (verbatim)

> Proceed — add the allow-rule with the review leg intact. Ruling on the
> record: my sentence in the reviewer chat is the authorization; no Love-side
> act will ever back the label, so attribution-by-identity is not a goal.
> Compensating control: every love-cleared merge is reconciled against my
> recorded sentences at each claude.ai check-in; file that as a standing audit
> item in the runbook. The shared-identity question closes as "resolved by
> ruling," with a post-UAT revisit note.

## What this establishes

- The `love-cleared` label is **agent-appliable** (no per-use prompt).
- **Authorization is Love's recorded sentence**, never the label's GitHub
  identity. Attribution-by-identity is explicitly not a goal.
- **Standing audit (compensating control):** every `love-cleared` merge is
  reconciled against Love's recorded sentences at each claude.ai check-in; any
  unmatched merge is surfaced to Love immediately. Filed in
  `scripts/orchestration/RUNBOOK.md`.
- The shared-identity / un-spoofable-signal open question in
  `memory/followup_clearance_merge_into_action.md` is **resolved by ruling**,
  with a **post-UAT revisit**.

## Caveat recorded at ruling time (methodology §7 — stated once, ruling stands)

The executing agent flagged (twice) that a `.claude/settings.json` allow-rule is
global to every local session, so the "non-beneficiary executor" framing does
not contain the widening — any builder session can then silently apply
`love-cleared` and trigger clearance-mode code auto-merge, which is the exact
capability the orch-automerge hardening removed. Love ruled with that caveat
understood; the reconciliation audit is the accepted compensating control.

## Cross-references

- `.claude/settings.json` — the allow-rule (landed `14709c0`).
- `.github/workflows/orch-automerge.yml` — the clearance-mode merge gate.
- `memory/followup_clearance_merge_into_action.md` — the resolved open question.
- `scripts/orchestration/RUNBOOK.md` — the standing reconciliation audit.
