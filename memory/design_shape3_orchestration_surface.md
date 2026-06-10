# Design Surface: Shape-3 Terminal Orchestration (Step 1 — PARKED for Love's ruling)

**Filed:** Day-52 (2026-06-10, `date -u` verified)
**Status:** DESIGN SURFACE ONLY. Nothing here is built. Six forks below need Love's
ruling before Step 2 (build) starts. The design choices ARE the safety model.
**Source of truth:** `memory/decision_workflow_autonomy_single_checkin.md` (the
Shape-3 memo, main @ `9fa08ae`). This doc designs the *plumbing* that memo scoped
out; it changes none of the memo's discipline.
**Tier:** T3 (this is the safety architecture).

---

## 0. Capability probes (verified Day-52, not assumed)

Ran against the live environment before designing:

| Probe | Result | Consequence |
|---|---|---|
| `claude --version` | 2.1.144 installed at `~/.local/bin/claude` | A separate-instance headless reviewer (`claude -p`) is genuinely feasible (Fork 1B) |
| `gh auth status` | Authed as `lovemansgit`, scopes `repo`, `workflow` | Orchestration can create labels, Actions, comments, merges |
| main branch protection | Requires 2 status checks (Vercel, lint+typecheck+unit); **required approving reviews = 0**; force-push blocked | **The merge gate is currently convention, not code.** Any authed agent could `gh pr merge` into main today once CI passes. Fork 4 closes this. |
| Labels in `lovemansgit/planner` | Only GitHub defaults — no tier/park labels | Queue labels are green-field (Fork 2) |
| `.claude/` in planner | Does not exist | Agent definitions are green-field (Fork 5) |
| Migrations path | `supabase/migrations/` | Hard always-park path (Fork 4) |
| VS Code extension constraint | Per standing rule, VS Code subagents can't write files | **The orchestration must run in terminal Claude Code (CLI), not the VS Code extension.** Not a fork — a constraint. |

---

## 1. Invariants (pre-decided by the Shape-3 memo — NOT forks, every design below must satisfy them)

- The two-party seam never collapses: builder and reviewer are separate contexts, always.
- The reviewer performs its own body-reads from git at pinned SHAs. It never rules
  off builder summaries. The builder hands the reviewer a PR number/SHA — never a
  paraphrase of the diff.
- Ambiguity parks. Disagreement parks. The T3 queue never auto-drains.
- Production SQL: Love applies manually via Supabase SQL editor. Vercel promote:
  manual. Auto-promote stays off.
- Force-push: auto-allowed `--force-with-lease` on own feature branch; hard-blocked
  on main/shared/protected.
- T1 docs auto-merge; everything touching the data path or an external contract parks.

---

## 2. Fork 1 — Where does the reviewer run?

The seam holds structurally in both real options (fresh context either way). The
difference is *how much the builder can influence the reviewer's runtime*.

### Option A — Subagent inside the builder's Claude Code instance (Agent tool)
The builder spawns a reviewer subagent. Subagents get a fresh context window — they
do NOT see the builder's conversation.
- **For:** Zero extra plumbing; works today; agent-to-agent is direct; cheapest.
- **Against:** The builder writes the reviewer's per-invocation prompt → framing-bias
  risk (the builder can unconsciously shape the review by what it includes/omits).
- **Hardening that makes A acceptable:** a fixed reviewer agent definition
  (`.claude/agents/reviewer.md`) holding the standing orders — read the diff bodies
  yourself from git at the pinned SHA, never trust the builder's framing, output a
  structured verdict, post the verdict yourself as a PR comment via `gh` (so the
  builder cannot paraphrase it). The builder's invocation passes ONLY the PR number.

### Option B — Separate headless Claude Code instance (`claude -p`, verified installed)
An orchestration script invokes a second, fully separate process per review, in its
own worktree, with its own settings and standing orders on disk.
- **For:** Strongest isolation — the builder doesn't author the reviewer's prompt or
  share its process; reviewer environment is files the builder doesn't touch at runtime.
- **Against:** More plumbing (invocation, verdict collection, error handling); every
  review is a fresh full session (token cost); two processes to babysit.

### Option C — Cloud agent / claude.ai reviews each PR
- **Rejected by the memo itself:** claude.ai is reserved as Love's separate-surface
  high-stakes reviewer (§1.2). Pulling it into the per-PR loop blurs the two surfaces
  and re-couples what the memo deliberately separated.

**Builder's lean:** A with the full hardening set for v1 (verdict posted by reviewer
itself, fixed agent file, reviewer pulls diffs itself); B as a v2 hardening step if
framing bias is ever observed in practice. **Love rules.**

---

## 3. Fork 2 — How does the park queue surface at the daily check-in?

Source-of-truth and presentation are separable. Proposed source of truth regardless
of presentation: GitHub labels (`parked-t3`, `parked-t2-ambiguous`, `auto-cleared-t1`,
`needs-directional-ruling`) + one structured comment pinned on each parked PR
containing: reviewer verdict, plain-English summary, what-it-touches, dispute trail
(if any), and a **SQL-to-apply flag** when `supabase/migrations/` changed.

Presentation options (composable):
- **(a) Saved filter link** — Love opens `is:pr is:open label:parked-t3` at check-in;
  claude.ai reviewer pulls the same list. Zero maintenance, lives where the PRs live.
- **(b) Queue doc** — pair regenerates `memory/PARKED-QUEUE.md` at EOD (auto-merges
  as T1). One doc Love reads first; claude.ai reviewer starts there.
- **(c) Push digest** — daily notification/email at a fixed hour with the queue
  summary, so the check-in starts in Love's inbox instead of Love remembering.

**Builder's lean:** labels as truth + (b) the queue doc; (c) optional add-on.
**Question for Love:** what do you want to SEE first at check-in — a single doc, the
PR list, or a pushed digest? And is there a fixed check-in hour to anchor (c)?

---

## 4. Fork 3 — Tie-break when builder and reviewer disagree (Love asleep)

**Mechanism (confirming the memo's park-default is structural, not behavioral):**
merge is only ever executed by one code path, and that path requires the conjunction:

```
tier-classifier says auto-eligible  AND  reviewer verdict == APPROVE  AND  CI green
```

Disagreement is not an input that gets "resolved" — there is no branch from
disagreement toward merge. REQUEST_CHANGES, a missing verdict, a malformed verdict,
classifier uncertainty, or round-cap exhaustion all fall through to the same
outcome: PARK + label. The pair cannot argue its way to a merge.

**Sub-fork for Love — revision rounds:** cross-review naturally produces "reviewer
requests change → builder fixes → re-review." Proposed cap: **2 rounds**, then park
with the dispute trail attached even if the work is T1.
- **(a)** A PR that reaches APPROVE within the cap auto-merges (if tier-eligible),
  dispute trail attached in the PR for audit.
- **(b)** Stricter: ANY round that ended in REQUEST_CHANGES parks the PR for Love
  regardless of eventual agreement.

**Builder's lean:** (a) — revisions are the normal mechanism of review, and (b) would
park nearly everything, recreating the relay. But (b) is the maximally cautious
start. **Love rules.**

---

## 5. Fork 4 — Auto-merge boundary enforced in code (the consequential one)

**Finding:** main currently has 0 required reviews — the merge gate exists only as
discipline in prompts. Two layers proposed to make it code:

**Layer 1 — mechanical path gate (no model judgment):** a script computes auto-merge
eligibility purely from changed paths. T1 allowlist: `memory/**`, `docs/**`,
`tasks/**`, root `*.md`. One file outside the allowlist → park. `supabase/migrations/**`
→ always park + SQL-to-apply flag. No agent's opinion can override the path check.

**Layer 2 — server-side re-verification:** a GitHub Actions workflow is the ONLY
actor that merges. It triggers on the auto-merge label, **re-computes the path check
itself server-side**, and merges only if it passes. The builder and reviewer never
call `gh pr merge` directly (additionally enforced by a Claude Code permission deny
rule on `gh pr merge` in the builder's settings). A confused or compromised agent
labeling a data-path PR still can't merge it — the Action re-checks.

**Sub-fork for Love — v1 scope of auto-merge:**
- **(a) T1-only in v1.** Only the docs path-allowlist auto-merges. ALL T2 parks,
  including the memo's closed list. Reason: "UI-only" is not mechanically verifiable
  by paths — a `.tsx` edit can add a fetch call into the data path. The memo grants
  closed-list T2 auto-clear, but the grant assumed enforcement; path rules can't
  honestly enforce it yet.
- **(b) Implement closed-list T2 now** with path heuristics + reviewer attestation
  ("I read the bodies; nothing touches data path / external contract"), parking on
  any heuristic uncertainty.

**Builder's lean:** (a) for v1 — narrower than the memo permits, deliberately; widen
to (b) after the orchestration has run clean for some days. Ambiguity-parks-toward-
the-gate suggests starting narrow. **Love rules** (this surrenders some granted
autonomy, so it's explicitly Love's call, not the builder's to self-deny or self-grant).

**Also for Love (one-time settings change, Love performs or pre-authorizes):** should
required-approving-reviews on main go to 1, with the merge Action as the sanctioned
bypass? Strongest version of the gate; slight ceremony cost on solo hotfixes.

---

## 6. Fork 5 — Where the orchestration lives

Parts that must live in planner regardless: labels, the GitHub Action (Layer 2),
branch protection, the path-allowlist config.

- **(a) Everything in planner** (`.claude/agents/`, `.claude/settings.json`,
  `scripts/orchestration/`, `.github/workflows/`): orchestration changes are
  safety-model changes, and in-repo they flow through the same parked-T3 gate
  automatically — the orchestration governs its own modification. One repo,
  claude.ai reviewer already reads it.
- **(b) Separate tooling repo:** cleaner separation from product CI; but the gate
  must be rebuilt there, safety config drifts from the repo it governs, and
  orchestration changes would escape the planner merge gate unless re-gated.

**Builder's lean:** (a) planner. **Love rules.**

---

## 7. Fork 6 — Model assignment (cost + capability, Love's call)

Builder: Fable 5 [1m] (in subscription through June 22; this build is the window's
highest-value use). Reviewer options:

| Reviewer model | For | Against |
|---|---|---|
| Fable 5 | Strongest review | Highest cost; same-model = maximally correlated blind spots with the builder |
| Opus 4.8 | Strong review, different failure profile (decorrelates blind spots) | Mid cost |
| Sonnet 4.6 | Cheap, fast | Adequate for T1 docs cross-review; weaker for T3 pre-review |

**Split option:** Sonnet 4.6 for T1/T2 cross-review, Opus 4.8 (or Fable 5) for T3
pre-review verdicts. Model is config, not hardcode — June 23 (Fable leaves the
subscription) must be a one-line change. **Love rules.**

---

## 8. Out of scope until the orchestration works (Definition-of-Done tail)

The Phase-2 rewrite — replacing the "transition banner / manual relay still live"
framing in BOTH the claude.ai project instructions AND the planner-side methodology
doc with the now-live autonomy — is the FINAL step. It happens only after the
orchestration demonstrably works end-to-end (a real PR cross-reviewed agent-to-agent,
a real T1 auto-merge through the Action, a real T3 parked with verdict + summary).
Not before.

---

**STOP LINE.** Step 2 (build) does not start until Love rules Forks 1–6. Rulings can
land as PR review comments here or as a batch at the next check-in.
