# Shape-3 Orchestration Runbook — LIVE

**Shape-3 is LIVE (Day-52 PM).** Proven end-to-end: agent-to-agent cross-review
with a real caught bug, a real revision round, a real park with verdict +
desktop push + email, a live Action auto-merge by the bot, SHA-pinning
verified. The manual relay is retired.

The operating procedure for the terminal builder + reviewer pair. Governing
operating model: `memory/POINTER.md (→ canonical lovemansgit/methodology)` (the Three-Role Build Methodology
— read at bootstrap; this runbook is its planner Shape-3 implementation; the §2
floors there are drift-exempt). Discipline source of truth:
`memory/decision_workflow_autonomy_single_checkin.md` (see its
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
- **Authorization scope is LITERAL (Love's ruling, 2026-06-12 — Day-54,
  after the bag-tracking dev-DB breach):** an authorization names a scope;
  if the named scope does not exist or differs from reality, execution
  STOPS and the discrepancy parks for Love — "the spirit was safe" is
  never grounds to proceed. Verify the named scope (database, tenant,
  branch, file, environment) BEFORE executing; on any mismatch, stop at
  that point, park with what-was-named vs. what-reality-is plus one
  recommendation, and wait for Love's corrected sentence. Honest
  after-the-fact disclosure and additive/reversible/dark character may
  inform Love's retroactive acceptance — they are never the builder's
  license. Applies to all lanes, all phases. Ruling of record:
  `memory/decision_d54_authorization_scope_literal.md`.
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
- **Clearance execution (Love's ruling, 2026-06-12 — verbatim "I dont want
  such blockers... I approve and code executes."):** the production-SQL
  pattern covers ALL pipeline actions, all phases — **Love authorizes by
  sentence on the record; the builder executes and states the route.** No
  Love-side file edits, commits, or label clicks anywhere in the pipeline.
  Concretely, for a Love-cleared parked PR the builder routes through the
  orch-automerge Action's clearance mode (`love-cleared` label, shipped
  #440): the builder applies the label WHEN, AND ONLY WHEN, Love's clearance
  sentence is quoted verbatim in an ORCH-CLEARANCE comment on that PR —
  never without the quoted sentence. The Action re-verifies server-side
  (clearance comment present + reviewer APPROVE at the current head + CI
  enforced by auto-merge) and executes the merge; the builder reports route +
  head/merge SHAs every time. The permission classifier remains the standing
  backstop against UNQUOTED self-application. The four conditions of the
  retired 2026-06-11 builder clearance-merge bridge live on as the Action's
  server-side gates; the bridge clause itself and every "Love pastes / Love
  clicks / Love commits" step in this runbook are RETIRED by this ruling.
- **`love-cleared` is agent-appliable + standing reconciliation audit (Love's
  ruling, 2026-06-12 — Day-54):** the `gh pr edit … --add-label love-cleared`
  permission is now ALLOWED to the builder/subagents in `.claude/settings.json`
  (Love authored the settings commit himself — the harness auto-mode classifier
  blocks EVERY agent route to self-grant a permission widening, "user
  instruction cannot clear"; landed on `main` at `14709c0`, independently
  reviewer-verified at the pinned SHA: deny-pair intact + exactly the one allow
  line). Applying `love-cleared` triggers the orch-automerge Action's clearance
  mode (path-gate relaxed for that PR only; `ORCH-CLEARANCE` comment + reviewer
  APPROVE at the head SHA still required server-side). Authorization is **Love's
  recorded clearance sentence**, NEVER the label's GitHub identity —
  attribution-by-identity is explicitly NOT a goal (builder and Love share one
  identity). **Standing audit (compensating control):** at EVERY claude.ai
  check-in, every `love-cleared` merge since the last check-in is reconciled
  against Love's recorded clearance sentences; any merge with no matching
  recorded sentence is surfaced to Love immediately. Ruling of record:
  `memory/decision_d54_love_cleared_allow_rule.md`. The un-spoofable-signal open
  question in `memory/followup_clearance_merge_into_action.md` is resolved by
  ruling, with a post-UAT revisit.

## Three-pair scaling rules (Day-53, Love-ruled)

Shape-3 runs as **three concurrent builder pairs** (Sessions A, B, C), each
its own permanent two-party seam. Ruling of record:
`memory/decision_d53_three_pair_scaling.md`. Three coordination rules:

1. Every dispatch carries an explicit **do-not-touch list** naming the other
   lanes' territories.
2. **One EOD owner per day** — Session A by convention; other sessions feed
   their closing state to it, never file their own EOD.
3. **Product-brief version bumps are assigned by the reviewer surface in each
   dispatch, never self-assigned** (prevents two lanes racing the same §9
   version number).

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
