# Shape-3 Orchestration Runbook

The operating procedure for the terminal builder + reviewer pair. Discipline
source of truth: `memory/decision_workflow_autonomy_single_checkin.md`. Ruled
design: `memory/design_shape3_orchestration_surface.md` @ `f2226af` + Love's
Fork 1–6 rulings (Day-52). Built deliberately NARROWER than the memo grants:
v1 auto-merges DOCS ONLY; all code and all T2 parks.

## Pieces

| Piece | Path | Role |
|---|---|---|
| Reviewer agent | `.claude/agents/reviewer.md` | Fixed standing orders; separate context; posts verdicts itself |
| Model config | `scripts/orchestration/models.json` | The ONE place model names live (Fork 6) |
| Path gate (Layer 1) | `scripts/orchestration/path-gate.sh` | Mechanical docs-only allowlist; no model judgment |
| Merge lock (Layer 2) | `.github/workflows/orch-automerge.yml` | The ONLY actor that merges; re-gates server-side |
| Queue doc | `scripts/orchestration/parked-queue.sh` → `memory/PARKED-QUEUE.md` | What Love reads on arrival |
| Merge denial | `.claude/settings.json` | `gh pr merge` denied to builder and all subagents |

## Per-PR flow (builder follows this every time)

1. Open the PR on a feature branch (`--force-with-lease` allowed on your own
   branch only; main is hard-blocked by branch protection).
2. Classify mechanically: `scripts/orchestration/path-gate.sh <N>`.
   - `AUTO_MERGE_ELIGIBLE` → docs lane, reviewer model = `docs_reviewer`.
   - `PARK` (any code, any T2, anything off-allowlist) → park lane, reviewer
     model = `code_reviewer` (T3 pre-review verdict for Love).
   - `SQL_TO_APPLY` → carry the flag into the ORCH-PARK comment.
3. Launch the reviewer: Agent tool, `subagent_type: reviewer`, `model` read
   from `models.json` per step 2. **The prompt is the PR number only** — e.g.
   `PR #351`. Never include a summary, framing, or suggested verdict.
4. The reviewer posts its ORCH-VERDICT comment itself. Act on the verdict:
   - **APPROVE + docs lane** → apply label `automerge-t1`. The Action
     re-computes the gate and merges. The builder NEVER merges directly
     (denied in `.claude/settings.json`; the Action is the only merge path).
   - **APPROVE + park lane** → park (step 5); the verdict rides with the PR.
   - **REQUEST_CHANGES** → revise on the same branch, relaunch the reviewer
     (round 2). **Maximum 2 rounds.** Round 2 not APPROVE → park with the
     dispute trail (the verdict comments) in place.
   - **Reviewer flags a Love-only directional question** → park IMMEDIATELY
     with `needs-directional-ruling`. No revision attempt — the question is
     Love's, not the pair's.
   - Missing or malformed verdict → park. Never re-prompt toward approval.
5. Parking a PR:
   - Apply exactly one park label: `needs-directional-ruling`, `parked-t3`,
     or `parked-t2`.
   - Post an `ORCH-PARK` comment: plain English for Love — what the PR does,
     what it touches, the reviewer's verdict in one line, and
     **SQL TO APPLY: yes** if `supabase/migrations/` changed.
   - Regenerate the queue doc: `scripts/orchestration/parked-queue.sh`, then
     ship `memory/PARKED-QUEUE.md` through the normal docs lane (steps 1–4).
     No special rails for the queue doc — it rides the same lock as
     everything else.
   - Notify Love (see below).
6. Park notification (event-driven, debounced):
   - Debounce = one notification per builder work-batch: finish parking
     EVERYTHING in the current batch first, then send ONE notification
     listing all newly parked items, not one per PR.
   - Body = the new PARKED-QUEUE.md entries (plain English, SQL flags
     included).
   - **Send mechanism: PENDING LOVE'S RULING.** No email-send path exists
     in-environment without a new credential (verified Day-52: no local
     Resend key; macOS sendmail unconfigured; Gmail MCP is draft-only).
     Options are with Love. Until ruled, use the harness PushNotification
     tool as the interim event-driven signal.

## What NEVER happens (memo §5, enforced not promised)

- Builder or reviewer running `gh pr merge` — denied in `.claude/settings.json`;
  the Action re-gates server-side even if mislabeled.
- Merging anything off the docs allowlist — Layer 1 + Layer 2 both park it.
- Draining the park queue without Love — no automation touches park labels
  except the Action's own park-on-failure.
- Production SQL or Vercel promote by an agent — Love, manual, always.
- One brain reviewing its own work — the reviewer is a separate context with
  fixed standing orders; the builder passes only a PR number.

## One-time Love setup (action items, Love performs)

1. **Branch protection — require 1 approving review on main:**
   GitHub → `lovemansgit/planner` → Settings → Branches → edit the `main`
   rule → check "Require a pull request before merging" → set
   "Required approvals" to **1** → Save.
2. **Let the Action approve docs PRs:** Settings → Actions → General →
   Workflow permissions → check **"Allow GitHub Actions to create and approve
   pull requests"** → Save.
3. **Caveat to know before clicking:** all agent PRs are authored by the
   `lovemansgit` account, and GitHub forbids approving your own PR. After
   step 1, docs PRs get their required approval from the Action
   (github-actions bot); for parked T3 PRs Love merges using the admin
   **"bypass branch protections"** checkbox on the merge button. If that
   feels wrong, say so before clicking and we re-surface options.
4. **Rule the park-notification send path** (see ORCH-PARK notification above).

## Model swap (Fork 6)

Edit `scripts/orchestration/models.json` — one line per role. Verified Day-52:
Agent-tool alias `sonnet` → claude-sonnet-4-6, `opus` → claude-opus-4-8.
Fable leaves the subscription 2026-06-22; the builder model is a session-level
choice and appears in the config for the record only.
