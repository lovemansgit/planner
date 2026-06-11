# Decision: Workflow autonomy + single daily check-in (Shape 3)

**Filed:** Day-52 (2026-06-10)
**Tier:** T3 artifact (reviewed under full §3.6 by Love before merge)
**Supersedes:** The relay-based three-party workflow and the 5-step manual EOD walk
described in `PROJECT-INSTRUCTIONS.md`. Those sections are replaced wholesale by
this memo. The merge gate, production-SQL gate, §3.6 body-reads, and
verify-against-running-product discipline are PRESERVED unchanged.
**Driver:** Love's Day-52 streamline ruling. Goal: cut turns, tokens, and manual
relay; run longer autonomous build runs; reduce Love's involvement to a single
daily check-in — WITHOUT moving any of the gates that protect a non-technical
operator from an unrecoverable production mistake.

---

## 0. The one constraint everything hangs on

Love does not read code. Every protection in this workflow exists because of that
single fact. The builder and the reviewer are both Claude; if they share a blind
spot, there is no non-AI checkpoint between that shared mistake and the production
database UNLESS a human gate forces a pause. Love is that human gate. This memo
moves as much routine work off Love as possible while keeping the human gate
exactly where a mistake is unrecoverable: the merge into the product, and the
production-SQL apply.

This is why the memo automates the *relay* (pure friction, no safety) and keeps
the *gates* (the actual safety). The two were bundled together in the old
workflow; this memo separates them.

---

## 1. The two surfaces

### 1.1 Terminal pair (Claude Code) — builder + reviewer subagent

Two agents run in the terminal with **separate contexts**: a builder and a
reviewer subagent. They cross-review each other's work directly, agent-to-agent,
with no human relaying text between them. This is a genuine two-party seam — two
independent contexts, not one agent critiquing itself. The separation is
load-bearing: a single agent reviewing its own output shares its own blind spots
and provides one opinion twice, not two opinions. The seam must never collapse to
one brain reviewing its own work.

The terminal pair runs autonomously between check-ins on routine / lower-risk work
(see §2).

> **Plumbing note (NOT part of this discipline).** Standing up the
> builder+reviewer-subagent orchestration in the terminal is a separate build
> task. This memo encodes the *discipline*; the wiring is a *how* and is scoped
> elsewhere. Until the orchestration is stood up, the discipline below still
> governs — the relay simply remains manual in the interim.
> *(Day-52 PM: the orchestration IS stood up and proven end-to-end; the manual
> relay is retired. See §9.)*

### 1.2 claude.ai (reviewer) — once-a-day high-stakes reviewer

claude.ai is Love's once-a-day reviewer for **high-stakes T3 work**: schema, auth,
SuiteFleet wire contracts, anything touching the production data path. The terminal
pair does NOT self-review or self-merge these. It builds them, attaches a
plain-English summary, and PARKS them for §3.6 review at the daily check-in.

The review happens on a **separate surface from the builder**. That separate-surface
second opinion is the entire point of keeping claude.ai in the loop: it is the one
review that does not share the terminal pair's context, kept exactly where a shared
blind spot would be unrecoverable.

claude.ai's role shifts from per-exchange relay endpoint to: rule-setter, daily
directional reviewer, T3 §3.6 reviewer, and morning-state auditor.

---

## 2. What the terminal pair may do autonomously between check-ins

### 2.1 T1 docs / memory — build, cross-review, AND auto-merge

The pair builds, cross-reviews, and auto-merges T1 docs/memory PRs. The pair files
its own EOD doc and memos. **Love no longer walks the 5-step manual EOD refresh.**
The day-close memo work self-completes as T1 auto-merges.

### 2.2 T2 routine code — closed-list auto-clear, else park

The deciding test for whether a T2 PR may be auto-cleared by the pair is **"does it
touch the data path or an external contract"** — NEVER size. Ambiguity parks: if the
pair is unsure which side a PR sits on, it parks for Love's check-in. Ambiguity
always resolves toward the gate, never away from it.

The precedent that qualifies a T2 PR for auto-clear is **CATEGORY precedent**, not
"something similar shipped once." A novel change may not be bootstrapped into
"routine" by analogy to a single prior PR.

**Closed list of pair-auto-clearable T2** (exhaustive — anything not on this list
parks):

1. **UI-only** — copy, layout, brand-token application, view removal.
2. **Test-only additions.**
3. **Non-deploy / non-cron config.**

Anything not on this closed list parks for Love's daily check-in. The pair may not
extend this list by analogy; extending it requires an explicit ruling from Love and
a memo amendment.

### 2.3 Plan-PR drafting, smoke-test prep, mechanical fixes

Fully self-complete between check-ins.

### 2.4 T3 high-stakes work — build and park (see §4 for the directional split)

The pair MAY build T3 (schema / auth / SuiteFleet wiring / production-data-path)
work autonomously and PARK it — but never self-review or self-merge it, and subject
to the directional-question split in §4. The finished T3 PR sits at Love's merge
gate with the reviewer subagent's verdict and a plain-English summary attached,
untouched, until the daily check-in.

---

## 3. The daily check-in (claude.ai, once a day)

One active touchpoint per day. The order inside the check-in is fixed, because
smoke tests run against production and production only changes after Love clears the
queue:

1. **Rule directional questions in a batch.** This includes any T3 directional /
   product questions the pair surfaced before building (§4).
2. **§3.6-review the parked T3 PRs live** with the reviewer. Full body-reads at
   pinned SHAs per standing discipline — not a skim.
3. **Love applies production SQL + Vercel promote** for cleared T3 PRs. Manual,
   by hand, always (§5).
4. **Smoke-test what just shipped.** Smoke is the TAIL of the check-in, not the
   head — it runs against the production state that only exists after step 3.

If Love wants to skip a day's touchpoint, the pair keeps building and the T3 merge
queue grows; Love clears two days at once at the next check-in. Safe — the work
simply parks longer. The queue never auto-drains.

---

## 4. T3 directional-question split (do NOT read as flat "one stop replaces two")

The old workflow ran T3 as two hard-stops with Love: a plan-stop, then a code-stop.
The plan-stop was NOT ceremony — it caught R10 (a feature that was already built)
and R8 (seven product questions) BEFORE wasted build. Collapsing it blind would cost
Love the redirect-before-build on calls only Love can make.

So the split is:

- **T3 with NO open product / directional question** → the pair plans, builds, and
  parks; **ONE §3.6 review at the check-in** on the finished PR. This is the only
  case where "one stop replaces two" holds.

- **T3 carrying an UNRESOLVED product / directional question** → the pair surfaces
  the **question** at the daily check-in **BEFORE building**. Love rules. The pair
  then builds against Love's ruling and parks the finished PR for the §3.6 review
  (which lands at the *next* check-in, or later the same session if the build
  completes in time).

The plan-stop does not vanish — it **collapses INTO the check-in's
directional-questions batch** (step 1 of §3). Net effect: still one daily
touchpoint, but judgment-heavy T3 gets Love's direction before the build, and
mechanical T3 runs straight through to a parked PR.

**Written explicitly so future sessions do not misread this:**
- A future session must NOT read the old brief's "T3 = two hard-stops" and flag the
  pair building T3 autonomously as a discipline violation. Autonomous T3 build is
  permitted under this memo.
- A future session must NOT read "one stop" and let the pair guess at a product
  call. An unresolved product/directional question on a T3 item is a mandatory
  pre-build surface to Love, not a judgment the pair may make.

---

## 5. Absolute lines (unchanged)

- **Production SQL apply + Vercel promote: Love's, manual, always.** Migrations are
  operator-applied via the Supabase SQL editor; promotion is manual via Vercel CLI
  (`--scope=lovemansgits-projects`). Auto-promote stays off.
- **Nothing touching the product or database merges or deploys unattended.** The T3
  merge queue NEVER auto-drains while Love is away.
- **The two-party seam never collapses to one brain reviewing its own work.**
- **§3.6 body-reads remain non-negotiable** — full file bodies at pinned SHAs;
  reviewer never rules off builder summaries for the T3 §3.6 review. (Plain-English
  summaries attached to parked PRs are an *aid* for Love, not a substitute for the
  body-read.)
- **Verify-against-running-product discipline holds** (the framing-discipline memo,
  `memory/feedback_verify_framing_against_running_product.md`). Day-marker references
  verified via `date -u` at session-open before use.

---

## 6. Force-push (amended)

- **Auto-allow** `git push --force-with-lease` on a builder's OWN feature branch.
  No pre-authorization required.
- **HARD-BLOCK** force-push on `main`, shared, or protected branches. Explicit Love
  authorization required there.

This replaces the prior standing blanket "force-push requires explicit
pre-authorization" rule, which was over-broad — it gated routine own-branch history
cleanup behind a Love authorization that added no safety.

---

## 7. What this memo CUTS

- **The hand-relay.** Love no longer copy-pastes instructions and results between
  reviewer and builder. The terminal pair relays agent-to-agent. (This also removes
  the relay as a framing-drift source — see Day-51 EOD §F, where the "Day-49" drift
  landed because text was hand-relayed.)
- **One-prompt-per-turn ferrying.** The session-collision protection that rule
  provided is now handled inside the terminal orchestration, not by Love pacing
  prompts one at a time.
- **The manual 5-step EOD walk.** The pair files its own EOD + memos as T1
  auto-merges.
- **The over-broad force-push block** (see §6).

## 8. What this memo KEEPS

- Love's T3 §3.6 review (now once-daily, on a separate surface).
- The merge gate (Love clears all product merges).
- The production-SQL gate (Love applies, manual).
- §3.6 body-reads at pinned SHAs.
- Verify-against-running-product.
- The two-party adversarial seam (now terminal builder + terminal reviewer subagent,
  separate contexts).

---

**End of decision memo. To be cross-referenced from the next EOD and indexed in
MEMORY.md. The terminal orchestration plumbing is scoped as a separate build task.**

---

## 9. Day-52 PM amendment — orchestration LIVE + final pre-MVP autonomy ruling

**Authority:** Love's Day-52 PM ruling, relayed in-session (Session A). This
section is the repo record of that ruling. Because the repo held no record at
encoding time, the PRs writing it down (this one and the runbook PR) PARKED
under the four-triggers rule and were cleared only by Love's explicit named
authorization — the clearance itself is the verification.

**Orchestration status: LIVE.** Built per the ruled design
(`memory/design_shape3_orchestration_surface.md` @ `f2226af`, Forks 1–6),
merged in PR #348, and proven end-to-end on Day-52: agent-to-agent cross-review
with a real caught bug and a real revision round (PR #349), a real park with
verdict + desktop push + email (received), a live merge-Action auto-merge by
the bot (PR #350), and SHA-pinned verdict invalidation verified. The manual
relay — including the hand-relay and one-prompt ferrying this memo already cut
on paper (§7) — is retired in practice.

**The ruled autonomy model (pre-MVP):**

- The pair runs autonomously on agent-agreement. Love does not approve
  technical correctness (Love does not blind-approve — it is not a gate). No
  cutover gates.
- Production, Option B (Love-ruled): PRE-MVP, production promote (Vercel) is
  part of the autonomous flow — the pair performs it on agent-agreement, with
  NO per-promote Love authorization. Pre-MVP promotes are reversible and have
  no live users; up-to-MVP promote gating is theater (Love's ruling).
  CARVE-OUT that still parks pre-MVP: live DATABASE changes —
  `supabase/migrations/**` and any production SQL apply — ALWAYS park for
  Love. That is Love-trigger #1 (risk of breaking Love's own work/data), not a
  user-protection gate: a bad migration is destructive to Love's work, so it
  parks regardless of phase.
- The two-party seam is PERMANENT: separate contexts, reviewer body-reads at
  pinned SHAs, reviewer posts its own verdicts. Never collapses, including
  within a single long session. The seam is the guardrail that enables the
  autonomy; it is not optional and not subject to streamlining.
- Four Love-triggers park-and-email EVEN WHEN BOTH AGENTS AGREE (agreement
  does NOT clear these):
  1. Risk of breaking LOVE'S WORK or the build — repo corruption,
     lost/overwritten commits, a wedged or unrecoverable build state. (NOT
     live-customer risk — moot pre-MVP.)
  2. Drift from the product brief (`memory/PLANNER_PRODUCT_BRIEF.md`;
     claude.ai-side: MEMORY-product-brief.md).
  3. Over-engineering the reviewer judges a Love ruling could streamline —
     gold-plating is flagged TO Love, not resolved builder↔reviewer.
  4. Cost — any new paid dependency, metered/paid API call, or new spend.
- MVP-FINALIZED placeholder (NOT active): a future switch Love throws by
  sentence. When thrown, the FULL production floor returns: promotes ALSO
  start PARKING for Love's go (DB changes already park in every phase). Until
  Love throws that switch, promotes flow.
  > PLACEHOLDER — Love defines "MVP finalized" here when he throws the switch.

**Supersedence (narrative lives here, per the append-only discipline; older
sections are left as written):**

- §5's "Production SQL apply + Vercel promote: Love's, manual, always" is
  SUPERSEDED two ways (Option B): (a) Vercel promote — pre-MVP it flows
  autonomously on agent-agreement with no per-promote authorization, and starts
  parking for Love's go only at MVP-FINALIZED; (b) production SQL / migrations
  — gated in EVERY phase: they park, and are builder-EXECUTED only on Love's
  explicit named authorization. Love does nothing manually in either case;
  where Love authorizes, he authorizes by sentence and the builder executes
  and states the route.
- §3's once-a-day check-in framing is relaxed: park notification is now
  event-driven (debounced desktop push + email per park-batch), and Love rules
  by sentence whenever he arrives. The queue still NEVER auto-drains.
- Unchanged floors: §3.6 body-reads at pinned SHAs;
  verify-against-running-product; the path-gate + merge-Action lock as built
  (docs-only auto-merge in v1); the two-party seam.

**End of §9. The memo above this line is preserved as filed.**
