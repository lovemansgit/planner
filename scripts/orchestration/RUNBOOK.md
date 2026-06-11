# Shape-3 Orchestration Runbook — LIVE

**Shape-3 is LIVE (Day-52 PM).** Proven end-to-end: agent-to-agent cross-review
with a real caught bug, a real revision round, a real park with verdict +
desktop push + email, a live Action auto-merge by the bot, SHA-pinning
verified. The manual relay is retired.

The operating procedure for the terminal builder + reviewer pair. Discipline
source of truth: `memory/decision_workflow_autonomy_single_checkin.md` (see its
§9 Day-52 PM amendment for the ruled autonomy model). Ruled design:
`memory/design_shape3_orchestration_surface.md` @ `f2226af` + Love's Fork 1–6
rulings (Day-52). Built deliberately NARROWER than the memo grants:
v1 auto-merges DOCS ONLY; all code and all T2 parks.

## Love's ruled autonomy model (Day-52 PM, pre-MVP)

- The pair runs **autonomously on agent-agreement**. Love does not approve
  technical correctness (Love does not blind-approve — it is not a gate).
  No cutover gates.
- **Production, Option B (Love-ruled):** PRE-MVP, production promote (Vercel)
  is part of the autonomous flow — the pair performs it on agent-agreement,
  with NO per-promote Love authorization (pre-MVP promotes are reversible and
  have no live users; up-to-MVP promote gating is theater — Love's ruling).
  **CARVE-OUT that still parks pre-MVP: live DATABASE changes** —
  `supabase/migrations/**` and any production SQL apply — ALWAYS park for
  Love. That is Love-trigger #1 (risk to Love's own work/data), not a
  user-protection gate: a bad migration is destructive to Love's work, so it
  parks regardless of phase.
- **The two-party seam is PERMANENT**: separate contexts, reviewer body-reads
  at pinned SHAs, reviewer posts its own verdicts. Never collapses, including
  within a single long session. The seam is the guardrail that enables the
  autonomy; it is not optional and not subject to streamlining.
- **Four Love-triggers park-and-email EVEN WHEN BOTH AGENTS AGREE**
  (agreement does NOT clear these):
  1. Risk of breaking LOVE'S WORK or the build — repo corruption,
     lost/overwritten commits, a wedged or unrecoverable build state.
     (NOT live-customer risk — moot pre-MVP.)
  2. Drift from the product brief (`memory/PLANNER_PRODUCT_BRIEF.md`;
     claude.ai-side: MEMORY-product-brief.md).
  3. Over-engineering the reviewer judges a Love ruling could streamline —
     gold-plating is flagged TO Love, not resolved builder↔reviewer.
  4. Cost — any new paid dependency, metered/paid API call, or new spend.
- **MVP-FINALIZED placeholder (NOT active):** a future switch Love throws by
  sentence. When thrown, the FULL production floor returns: promotes ALSO
  start PARKING for Love's go (DB changes already park in every phase). Until
  Love throws that switch, promotes flow.
  > PLACEHOLDER — Love defines "MVP finalized" here when he throws the switch.
- **Unchanged floors regardless of phase:** production SQL / migrations park
  in EVERY phase and are builder-EXECUTED only on Love's explicit named
  authorization (Love does nothing manually — Love authorizes by sentence,
  builder executes and states the route). §3.6 body-reads.
  Verify-against-running-product. Path-gate + merge-Action lock as built
  (docs-only auto-merge in v1).
- **Firing-as-clearance (Love's amendment, 2026-06-11):** firing a dispatch
  prompt constitutes Love's clearance of the items that prompt EXPLICITLY
  names as cleared-by-firing. Those named items merge/close on the firing; the
  builder records the firing as the clearance basis (alongside any verbatim
  ruling already carried in the ORCH-PARK). This does NOT collapse the
  two-party seam — the reviewer still body-reads and posts its verdict; firing
  is Love's authorization layer, not the technical-correctness check.
  Explicit CONVERSATIONAL rulings remain REQUIRED for: live DB changes and
  production SQL (named authorization — the Love-trigger #1 carve-out above),
  new spend (Love-trigger #4), and genuine open decisions the reviewer
  surfaces as questions (a reviewer "Love-only directional" park). Verbatim:
  > "Love's amendment, 2026-06-11: firing a dispatch prompt constitutes Love's
  > clearance of the items that prompt explicitly names as cleared-by-firing.
  > Explicit conversational rulings remain required for: live DB changes and
  > production SQL (named authorization), new spend, and genuine open
  > decisions the reviewer surfaces as questions. Confirmed by Love."

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
   - **Love-trigger check (BOTH lanes, applies even on APPROVE):** if either
     agent flags any of the four Love-triggers (build/repo breakage risk,
     brief drift, streamlinable over-engineering, new cost/spend), the PR
     parks-and-emails regardless of agreement. Agreement does not clear a
     trigger; only Love does.
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
6. Park notification (event-driven, debounced — Love-ruled Day-52: BOTH
   desktop push AND email, every park-batch):
   - Debounce = one notification per builder work-batch: finish parking
     EVERYTHING in the current batch first, then send ONE notification
     covering all newly parked items, not one per PR.
   - **Desktop push (harness PushNotification tool):** one push per batch.
     Pushes truncate near 200 characters, so the push carries the compressed
     form — count + PR numbers/titles + SQL flags. The full detail lives in
     the email and PARKED-QUEUE.md.
   - **Email (`scripts/orchestration/notify-park.sh`):** subject
     `Shape-3: <n> parked for Love`, body on stdin = the new PARKED-QUEUE.md
     entries verbatim (plain English, SQL flags included). Requires
     `ORCH_RESEND_API_KEY` in `.env.local` (gitignored; a SEPARATE
     orchestration key per Love's ruling — independently revocable without
     touching production email, whose RESEND_API_KEY lives only in Vercel).
     LIVE since Day-52: key placed, from `onboarding@resend.dev` to
     `love.mansukhani@gmail.com`, test send confirmed received.

## What NEVER happens (memo §5, enforced not promised)

- Builder or reviewer running `gh pr merge` — denied in `.claude/settings.json`;
  the Action re-gates server-side even if mislabeled.
- Merging anything off the docs allowlist — Layer 1 + Layer 2 both park it.
- Draining the park queue without Love — no automation touches park labels
  except the Action's own park-on-failure.
- Production SQL / migrations applied without Love's explicit NAMED
  authorization — they park in every phase; Love authorizes by sentence, the
  builder executes and states the route. Love performs nothing manually.
  (Vercel promote: autonomous on agent-agreement pre-MVP per Option B; starts
  parking at MVP-FINALIZED.)
- One brain reviewing its own work — the reviewer is a separate context with
  fixed standing orders; the builder passes only a PR number.

## One-time Love setup — ALL DONE (Day-52)

1. ~~Branch protection: required approvals = 1 on main~~ **DONE** (verified:
   agent self-merge impossible; admin path required for Love-authorized merges).
2. ~~Allow GitHub Actions to create and approve pull requests~~ **DONE**
   (verified live: the bot approved and merged PR #350).
3. Standing reference: agent PRs are authored by `lovemansgit`, and GitHub
   forbids approving your own PR — docs PRs get their required approval from
   the Action's bot; Love-authorized code merges go via the admin route
   (builder executes on Love's named authorization and states the route).
4. ~~Park-notification send path~~ **DONE** (both: desktop push + Resend email,
   verified received Day-52).

## Model swap (Fork 6)

Edit `scripts/orchestration/models.json` — one line per role. Verified Day-52:
Agent-tool alias `sonnet` → claude-sonnet-4-6, `opus` → claude-opus-4-8.
Fable leaves the subscription 2026-06-22; the builder model is a session-level
choice and appears in the config for the record only.
