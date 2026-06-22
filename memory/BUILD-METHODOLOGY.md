# The Three-Role Build Methodology
**Owner-ruled, agent-built, agent-reviewed software delivery**
Version 1.3 — June 2026. Derived from a live production project; generalized for any application.

> **How to read this file — and why it lives in the repo.** This is the canonical
> Three-Role Build Methodology (current version **v1.3**), mirrored from
> `~/.claude/methodology/BUILD-METHODOLOGY.md` and committed into the planner repo
> as the **bootstrap-read governing operating model**. It is here so that EVERY
> builder and reviewer bootstrap reads the same operating model, identically,
> after a context compaction with nothing but the repo. The §-numbered body below
> is the canonical text. Three primary planner-specific embeddings are clearly
> marked **[PLANNER]** where they appear — Love's standing dispatch model (§4),
> the on-record gate formats (§4), and the release/promote posture (§3) — plus a
> §5 file-map note pointing the canonical memory-architecture table at this repo's
> actual paths. These embeddings reflect this repo's live Shape-3 implementation
> (`scripts/orchestration/RUNBOOK.md`, `.claude/agents/reviewer.md`,
> `memory/decision_workflow_autonomy_single_checkin.md`) and do not alter the
> canonical text or the §2 floors. The **§2 floors are drift-exempt (§8.5)**: they
> can only be amended by an explicit owner ruling that names the floor, states the
> replacement protection, and records why — never by accumulation of small
> exceptions, never by analogy, and never on the system's own initiative.

---

## 0. What this is

A complete operating model for a non-technical owner to ship production software using AI agents, without reading code, performing manual pipeline steps, or blind-approving anything. The owner rules product decisions in plain-English sentences; two AI agents in separate contexts build and review each other's work; a third surface audits the pair from outside. Everything risky parks until the owner clears it by sentence.

It optimizes for four things, in order: the owner's work is never destroyed, the product matches the owner's intent, quality is verified rather than asserted, and speed — which comes from autonomy between check-ins, not from skipping verification.

**Throughput posture (v1.3).** Within those four, the system is tuned to keep builders loaded with substantive work, minimize turnarounds, park only when necessary, and never idle before assigned scope reaches an open PR. Speed comes from three sources: autonomy between check-ins, builders running scope to completion instead of stopping to ask, and uncapped parallelism on non-colliding work. None of this overrides the floors in §2 — when throughput pressure meets a floor or a hard-stop, the floor wins, every time.

---

## 1. The three roles (plus the outside check)

**The Owner** — sole decision-maker. Rules by sentence: directional questions, parked-item clearances, named authorizations. Never reviews technical correctness (reviewing code you don't read protects nothing). Never performs pipeline steps manually. Owns the product brief.

**The Builder** (terminal agent, e.g. Claude Code) — writes all code, runs all commands, executes everything programmatic. Works in isolated worktrees/branches. May spawn unlimited sub-agents as its own parallelized labor (§4). Invokes the reviewer with a reference (PR number) only — never a summary, never a framing.

**The Reviewer** (terminal agent, separate context from the builder) — reads every changed file itself from the repository at the pinned head version and posts its own structured verdict. Never rules off the builder's summary. Its standing orders live in the repo so every session behaves identically.

**The Outside Check** (a separate chat surface, e.g. a claude.ai project) — the owner's working surface AND the independent corner pointed at the pair itself. Two aligned agents share blind spots; this surface body-reads parked work independently, audits direction against the brief, and catches what the pair misses from inside. This role matters more, not less, as autonomy widens.

The two-party seam is permanent. Builder and reviewer are never the same context. One brain cannot review its own work. This is the guardrail that makes everything else safe; it is not subject to streamlining — including within a single long session, and including via sub-agents (§4).

---

## 2. The floors (hold regardless of phase, project, or speed pressure)

1. **Live database changes always park.** Schema migrations and production SQL are never auto-applied. The owner authorizes by named sentence; the executing agent states the route used.
2. **Owner-triggers park even when both agents agree.** Agreement between agents never clears these — only the owner does:
   - Risk to the owner's work or the build — repo corruption, lost commits, destructive or hard-to-reverse states.
   - Drift from the product brief.
   - Over-engineering the reviewer judges an owner ruling could streamline — gold-plating is flagged to the owner, never resolved between agents.
   - Cost — any new paid dependency, metered API, or spend.
3. **Disagreement parks; it never merges.** Review rounds cap at 2 (request-changes → fix → re-review). Round exhaustion, a standing rejection, a malformed verdict, or classifier uncertainty all park. There is no code path from disagreement to merge.
4. **Body-reads at pinned versions.** The reviewer and the outside check read full file contents at exact commit hashes — never builder summaries, never "trust me" descriptions.
5. **Verify against the running product.** Claims about what exists are checked against the live system, not assumptions or prior framing. One surprising diagnostic result requires a second, structurally different diagnostic before acting on it.
6. **The merge gate is server-side.** Auto-merge (where allowed at all) is performed by one trusted server-side actor that re-computes eligibility itself; the builder cannot merge directly. Permission boundaries that stop an agent from widening its own permissions are features, not bugs. Widening a permission is sentence-authorized by the owner and agent-executed — but never by the agent that benefits from the widening: a separate session executes, quoting the owner's sentence verbatim, with independent review. If no non-beneficiary route exists, the widening parks for the owner's explicit per-instance sentence. The owner performs no UI steps. (Owner ruling, 12 Jun 2026 — v1.2.)
7. **Secrets never travel through chat or terminal.** Credentials are entered by the owner directly into write-only admin surfaces. Agents handle secret references, never secret values. This floor stands as the single exception to Floor 9 (no manual owner steps): the protection is non-exposure of the value to any agent context — a control a sentence cannot replace. (Owner ruling, 12 Jun 2026 — v1.2.)
8. **The product brief is canonical and append-only.** It wins over every other memory file. Shipped amendment entries are immutable; supersedence lives in newer entries, never retroactive edits.
9. **The owner performs no manual pipeline actions.** No file edits, no commits, no label clicks, no UI steps, no terminal commands. The owner's sentence on the record authorizes; the agent executes and states the route used. If a step appears to require the owner's hands, that is a design error: redesign it to sentence-authorized agent execution, or park it as a question — never ask the owner to click, paste, or run anything. "Attribution" / "human-held key" arguments never justify a manual step; shared credentials make typed-by-owner meaningless. The real controls: the owner's quoted sentence on the record, independent review, server-side gates. Single exception: secret-value entry under Floor 7. Where a platform offers no agent route at all, the action is named explicitly as a platform-forced owner action, not a designed step. (Owner ruling, 12 Jun 2026 — v1.1/v1.2.)
10. **Throughput never overrides a floor or a hard-stop.** (New, v1.3.) The anti-idle and run-to-PR rules in §4 push builders to keep going. That pressure is bounded: when a builder must choose between continuing and honoring a park-trigger, a hard-stop, or any floor above, it stops. A builder that talks itself past a real stop "to stay productive" has failed, not optimized. The default-and-continue rule (§4) applies only to ambiguities that are *not* park-triggers; anything in this section's list parks regardless of remaining scope.

> **The §2 floors are drift-exempt (§8.5).** They are amended only by an explicit
> owner ruling that names the floor, states the replacement protection, and
> records why — never by accumulation of small exceptions, never by analogy, and
> never on the system's own initiative. An efficiency proposal that weakens a
> floor must be flagged as exactly that.

---

## 3. How work ships (the lanes)

**Docs lane (auto-merge).** Changes touching only documentation/memory paths are cross-reviewed and, on a genuine approval pinned to the current head, merged by the server-side gate. Path allowlists are re-computed server-side from the trusted copy.

**Everything else parks.** All code, all configuration off the closed allowlist, all migrations. Parked items carry the reviewer's verdict plus a plain-English summary written for the owner: what it does, what it touches, whether SQL needs applying.

**Autonomy tiers:**
- **T1 (docs/memory):** auto-merges through the gate.
- **T2 (closed allowlist):** narrow, explicitly enumerated low-risk categories (UI-only, test-only, non-deploy config). Gated by category precedent, not analogy — the deciding test: does it touch a data path or an external contract? Widening the list requires an owner ruling and a written amendment.
- **T3 (everything substantive):** plan first when stakes are high, then build; both park. Two mandatory hard-stops: at plan open and at code open.

**The queue.** Park labels on open PRs are the source of truth; a generated queue document is the owner's reading view. The queue never auto-drains — the owner clears items by sentence, batched or singly, whenever they arrive. No fixed check-in hour required.

**Scope-completeness gate before park (new, v1.3).** Before a session parks anything, it confirms every non-blocked item in its assigned scope has reached an open PR. A park filed with idle, unblocked work still in scope is itself a flag: the reviewer surfaces it as an incomplete-scope park, and the builder is expected to finish the reachable work first. The only legitimate early park is one where the remaining work is genuinely blocked (see the blocks-everything-downstream test, §4). This protects the owner's objective that a builder never idles before its scope reaches review.

**Notifications.** Event-driven and debounced: one push + one email per park-batch, listing every newly parked item in plain English.

**Production releases.** Pre-launch (no live users): releases flow on agent agreement — gating them is theater when rollback is free. From launch: releases also park. The owner throws that switch by sentence and defines what "launched" means when they throw it.

### [PLANNER] Release / promote posture (current phase)

- **Current phase: pre-MVP, Option B (Love-ruled, Day-52).** Production promote (Vercel) is part of the autonomous flow — the pair performs it on agent-agreement, with **no per-promote Love authorization** (reversible, no live users; gating promote pre-MVP is theater). Source: `scripts/orchestration/RUNBOOK.md`.
- **Standing rule once MVP-FINALIZED — promote always a separate owner sentence.** When Love throws the MVP-FINALIZED switch (by sentence; he defines "MVP finalized" when he throws it), promotes start parking: each promote then requires a separate owner sentence, exactly as §3 "Production releases" describes for the launched state. Until that switch is thrown, promotes flow.
- **Carve-out that parks in EVERY phase:** live DATABASE changes — `supabase/migrations/**` and any production SQL apply — ALWAYS park for Love's explicit named sentence (Floor 1 / Love-trigger #1), regardless of phase. A bad migration is destructive to the owner's own work, so it parks even pre-MVP.

---

## 4. The working rhythm

**Check-ins, not supervision.** The owner arrives when convenient; the pair runs autonomously between check-ins. Check-in order: directional questions → parked-item review → owner clears → verification/smoke. Verification and smoke checks are agent-run; the owner reads the results in plain English and rules — the owner never executes the checks.

**Run scope to an open PR before yielding (new, v1.3 — anti-idle).** A session's job is to carry its assigned scope all the way to an open PR, not to stop at the first uncertainty. When a builder hits an ambiguity, the default is **default-and-continue**: record the ambiguity as a parked item with its best-judgment default and the reasoning, then keep building the rest of the scope. Stopping early with reachable work remaining is a design error, the same way a manual owner step is. The exceptions are exact and small: a park-trigger or floor (§2) is hit — those stop regardless — or the ambiguity blocks everything downstream (test below).

**The blocks-everything-downstream test (new, v1.3).** The bright line that keeps "keep going" from becoming reckless: *Can any remaining work in scope proceed without resolving this ambiguity?*
- **Yes** — record the default, keep building. Surface the parked decision at PR open.
- **No** — the ambiguity gates the whole scope; park the scope with the blocker stated plainly and stop. This is the only legitimate early yield.

This test is deliberately plain so a builder can apply it without rationalizing. "I'd rather check first" is not a downstream block. "Nothing else can be built until the owner picks A or B" is.

**Round-0 self-review (new, v1.3).** Before invoking the independent reviewer, the builder runs the reviewer's standing-orders checklist against its own diff and fixes what it catches. This cuts wasted review rounds — the single biggest turnaround cost — by catching the obvious misses in-session. It does **not** weaken the two-party seam: round-0 is *in addition to* independent review, never instead of it. The independent reviewer (separate context) still body-reads every changed file and posts its own verdict. A builder that treats its own round-0 pass as sufficient has broken the seam.

**No cap on parallel builder sessions (amended, v1.3).** There is no headcount limit on concurrent builder sessions. The only constraint is **non-colliding scope**: each session carries explicit do-not-touch boundaries, and no two concurrent sessions may write the same files or the same external contract. Collision is the limit, not a number. If scopes cannot be cleanly separated, the work is sequenced — because they would corrupt each other, not because of a quota. Three, four, or more parallel sessions are expected and fine when scopes are clean. When scope splits cleanly, dispatch splits cleanly — parallel is the default question at dispatch, not the exception.

**Unlimited sub-agents (new, v1.3).** A builder may spawn as many sub-agents as it judges necessary. Sub-agents operate inside the builder's own branch and scope; they are the builder's labor parallelized, not independent contexts. No cap, no per-spawn authorization. One floor holds: **a sub-agent can never serve as the independent reviewer.** The two-party seam is between separate contexts, and a builder's own sub-agents are the same party — review through a sub-agent would look like review while being none. Spawn freely to build; never to self-review.

**Dispatch prompts are self-contained.** Each carries the date anchor, the owner's ruling verbatim, exact references (PR numbers, pinned hashes), ordered steps, the do-not-touch boundaries for parallel scopes, and the hard lines. A session must be able to execute after a context compaction with nothing but the prompt and the repo.

**Owner rulings are recorded verbatim** in decision memos that merge through the docs lane — the ruling's repo record is cleared by the same sentence that made it.

**Sessions open with a date check and close with an end-of-day handoff memo** (state, in-flight items, carry-forwards) filed through the docs lane.

**Fail honestly.** If a proof or test can't be produced, the session parks the gap with evidence of what was tried — it never fakes a leg or "calls it probably fine."

### [PLANNER] Love's standing dispatch model

How Love runs the pair on this project — the planner-specific shape of §4's rhythm. The canonical §4 rules above govern (anti-idle / run-to-PR, blocks-everything-downstream, round-0 self-review, no-cap parallel sessions, unlimited sub-agents); this note adds only what is planner-specific and does not restate them:

- **One dispatch carries the full load-bearing scope.** Love fires a single builder prompt with the entire scope; the builder runs it to open PRs per the §4 anti-idle rule, surfacing to Love only at open PRs.
- **One PR per item.** Each load-bearing item ships as its **own** PR — never bundled — so each carries its own reviewer verdict and its own park/clearance and can be ruled on independently.
- **The independent reviewer is a dedicated separate-context agent, spawned per PR.** On this repo the reviewer is `subagent_type: reviewer` (fixed standing orders in `.claude/agents/reviewer.md`), invoked with the **PR number only**, body-reading the **pinned head SHA** and posting its own `ORCH-VERDICT` **before the PR is surfaced** to Love. This dedicated reviewer is a separate context and **is** the two-party seam (§1) — it is explicitly NOT one of the builder's own labor sub-agents (§4 "Unlimited sub-agents"), which may never review. Round-0 self-review (§4) runs first and never replaces it.
- **Love engages only at open PRs.** Between dispatch and open-PR the pair runs autonomously; Love arrives to ruled, reviewer-verdicted, parked PRs and clears them by sentence.

### [PLANNER] On-record gate formats (Shape-3 implementation)

The two-party seam and the server-side merge gate (§1, Floor 6) are implemented on GitHub as on-record comments the merge Action greps. The exact envelope shapes are **load-bearing contracts, not style** — the Action's grep fails closed on a malformed envelope.

- **`ORCH-VERDICT`** (reviewer-posted) must **lead with the literal lines** `ORCH-VERDICT`, then `PR: #<n>`, then `SHA: <full 40-char headRefOid>`, `ROUND: <n>`, and `VERDICT: APPROVE` **or** `VERDICT: REQUEST_CHANGES` — exactly one of the two verdict words, written as a literal line. The reviewer posts it itself (`gh pr comment`); the **builder NEVER reformats, paraphrases, or re-posts a reviewer verdict envelope.**
- **`ORCH-CLEARANCE`** (the Love-clearance comment) body must **START with the bare clearance token** — no `##` heading, no preamble before it — followed by Love's clearance sentence quoted verbatim. The **reviewer writes the clearance text itself**; **Love firing the merge prompt IS the authorization** (firing-as-clearance), not a Love-typed comment.
- **On-record order is fixed:** reviewer `ORCH-VERDICT` (APPROVE at the current head) → `ORCH-CLEARANCE` (bare token + Love's verbatim sentence) → the park/clearance **label** → the **server-side merge gate** (the Action re-computes eligibility itself and is the only actor that merges). The builder never merges directly.

Source contracts: `.claude/agents/reviewer.md` (verdict format), `scripts/orchestration/RUNBOOK.md` (clearance + label + Action gate), `memory/decision_workflow_autonomy_single_checkin.md` (the ruled autonomy model), `memory/decision_d54_love_cleared_allow_rule.md`.

---

## 5. The memory architecture

All durable knowledge lives in the repository, mirrored to the owner's chat-project files. The builder prepares and maintains the mirror bundle; where the chat platform offers no agent upload route, the upload itself is a platform-forced owner action (named as such per Floor 9), not a designed step. Repo HEAD wins over mirrors; the brief wins over everything.

| File | Role |
|------|------|
| `PRODUCT-BRIEF.md` | Canonical scope, architecture, posture. Append-only amendment log. |
| `memory/handoffs/day-N-eod.md` | Daily state handoff for the next session. |
| `memory/followup_*.md` | One memo per open thread, finding, or deferred item. |
| `memory/decision_*.md` | One memo per owner ruling, verbatim. |
| `MEMORY-INDEX.md` | Index of all memos so any session can locate them. |
| `memory/PARKED-QUEUE.md` | Generated view of what awaits the owner. |
| `.claude/agents/reviewer.md` | The reviewer's standing orders. |
| `RUNBOOK.md` | The pair's operating procedure. |

Conflict rules: repo beats mirror; brief beats memo; registered contracts and filed memos beat bootstrap assumptions and paraphrase. If a session detects drift between mirror and repo, it surfaces the drift before acting.

> **[PLANNER] file map.** On this project the canonical brief is
> `memory/PLANNER_PRODUCT_BRIEF.md`; the memo index is `memory/MEMORY.md`; daily
> handoffs live under `memory/handoffs/`; the runbook is
> `scripts/orchestration/RUNBOOK.md`; the reviewer's standing orders are
> `.claude/agents/reviewer.md`; the queue is `memory/PARKED-QUEUE.md`.

---

## 6. Engineering discipline (what "reviewed" means)

- Tests are watched to fail first (RED) before the fix, then pass — a test that never failed proves nothing.
- Integration tests run against the real database engine, not mocks — schema-drift bugs hide in mocks.
- Force-push is allowed only on the builder's own feature branch, hard-blocked on shared branches.
- Diagnose before rollback when there's no clock pressure and minimal user impact.
- Ground before write — read the actual current state (files, data, vendor behavior) before planning against it. Plans built on stale framing produce confident, wrong code.
- Stale-framing audit: when a ruling or memo encodes a number or fact about the system, the reviewer checks it against the running product before building on it. (The costliest bug class in the source project was a correct implementation of an outdated constant.)
- **Token discipline (new, v1.3).** Tokens are a real cost and a real speed tax; waste is a flaggable inefficiency, not a free default. The rules:
  - Re-reading an unchanged file already body-read at the same pinned hash is waste — cite the prior read instead of re-fetching, unless the hash changed.
  - The reviewer reads the *changed* files in full at the pinned head — never the whole tree to "get oriented."
  - Dispatch prompts and parked summaries carry references (paths, PR numbers, hashes), not pasted file bodies.
  - Sub-agents are spawned for parallel labor, not to re-derive context the parent already holds — pass the context down, don't re-read it up.
  - This discipline never trades away a floor: body-reads at pinned versions (Floor 4) and verify-against-running-product (Floor 5) are not "waste" and are never skipped to save tokens. Token economy applies to redundant work, not to verification.

---

## 7. Communicating with the owner

- **Plain English only.** Product and operational framing, never implementation framing. The owner should be able to rule on every parked item from its summary alone.
- **Brevity first.** No preamble, no restating, no ceremony. Explain only when reasoning must be auditable, a real decision is being surfaced, or translation is requested.
- **Batch decisions, one recommendation each.** Surface only genuinely-owner decisions; decide reviewer-level questions autonomously. Trade-offs are presented without pushing.
- **Never ask the owner to verify technical work.** When the reviewer says approved, that is the approval.
- **Honest caveats, then respect the call.** The owner gets the risk stated once, plainly; if they rule against the caveat, the system executes their ruling with the guardrails intact rather than relitigating.

---

## 8. Self-evolution protocol (efficiency and accuracy improve by design)

The methodology amends itself the same way the product does — proposals park, the owner rules, the record is append-only.

- **Friction log.** Every end-of-day memo carries a short section: what cost time, what was ambiguous, what a permission rule or process change would have saved. No filtering — small frictions compound.
- **Catch log.** Every defect that survives review to a later stage gets a one-line entry: what was missed, which check would have caught it. Same for false alarms that wasted a round.
- **Idle/turnaround log (new, v1.3).** Every end-of-day memo also records: any session that yielded before its scope reached a PR (and whether the early yield was a legitimate downstream block or an avoidable stop), and any review round that could have been saved by round-0 self-review. This is the measurement surface for the throughput objective — fewer idle yields and fewer avoidable rounds over time, or the amendment isn't working.
- **Retro cadence.** At each milestone (or weekly, whichever comes first) the pair reads the logs and proposes methodology amendments — concrete, testable changes. Proposals park as a batch with a recommendation each.
- **The owner rules; the amendment is versioned.** Accepted amendments are appended to this document with date, rationale, and the evidence line that motivated them. Rejected ones are recorded too — rejected-with-reason prevents re-litigating.
- **The floors in §2 are exempt from drift.** They can only be amended by an explicit owner ruling that names the floor, states the replacement protection, and records why — never by accumulation of small exceptions, never by analogy, and never on the system's own initiative. An efficiency proposal that weakens a floor must be flagged as exactly that.
- **Measure, don't vibe.** Where possible, amendments cite numbers: review rounds per PR, defects caught per stage, owner touches per shipped item, time from park to clear, idle yields per session. Efficiency means fewer owner touches and fewer late catches — not fewer checks.

---

## 9. Bootstrapping a new application (day-1 checklist)

1. Write the product brief with the owner — scope, users, posture, and an acknowledgment protocol (how owner rulings are confirmed and recorded). This is the constitution; everything else references it.
2. Create the repo with the memory skeleton (§5 table) and the reviewer's standing orders. Executor: the builder.
3. Configure the server-side merge gate and branch protection: agents cannot merge; docs-lane allowlist enumerated; force-push blocked on shared branches. Executor: the builder, sentence-authorized, via the platform's API/CLI; the reviewer independently verifies the resulting settings. (These are restrictions, not widenings — Floor 6's non-beneficiary rule applies only when loosening them later.)
4. Set up the parked-queue generator and the notification path (email + push, debounced per batch). Executor: the builder, sentence-authorized. Any secret values the notification services require are entered by the owner directly into write-only admin surfaces per Floor 7; the builder wires up references only.
5. Record the autonomy tier table and the owner-trigger list in the runbook, signed by an owner ruling.
6. Declare the phase: pre-launch (releases flow) or live (releases park).
7. Stand up the outside-check chat project. Executor: the builder prepares the project instructions and the mirror bundle, sentence-authorized. Where the chat platform offers no agent route (e.g. chat-project creation and file uploads on claude.ai), those uploads are platform-forced owner actions — named as such per Floor 9, not designed steps.
8. First build runs the full loop end-to-end on something small, deliberately — proving the seam, the park, the clear, and the notification before any load-bearing work rides them.

---

## Amendment log (append-only)

| Version | Date | Change | Evidence |
|---------|------|--------|----------|
| 1.0 | 2026-06-11 | Initial generalization from the source project. | — |
| 1.1 | 2026-06-12 | Owner ruling — no manual Love steps (permanent, all projects): the owner never performs manual pipeline actions (file edits, commits, label clicks, UI steps, terminal commands); the owner's sentence on the record authorizes and the agent executes, stating the route used. Supersedes any step in this document that asks the human to perform a manual pipeline action; such steps are redesigned to sentence-authorized agent execution or parked as a question. | Owner ruling, 12 Jun 2026, recorded verbatim in `~/.claude/CLAUDE.md`. |
| 1.2 | 2026-06-12 | Two named floor rulings + rewrite pass. Floor 7 (named) STANDS as the single exception to the no-manual-owner-steps ruling: secret values are entered by the owner directly into write-only admin surfaces, agents handle references only — the protection is non-exposure of the value to any agent context, a control a sentence cannot replace. Floor 6 (named) reconciled: permission widening is sentence-authorized by the owner and agent-executed, never by the agent that benefits; a separate session executes quoting the owner's sentence, with independent review; where no non-beneficiary route exists, the widening parks for the owner's explicit per-instance sentence; the owner performs no UI steps. Body rewrite: v1.1 ruling folded into §2 as Floor 9; §5 mirroring and §9 steps 3, 4, 7 reworded to sentence-authorized agent execution with named executors, platform-forced owner actions named as such; §4 verification/smoke clarified as agent-run with owner reading results; dangling §10 reference in §9 step 1 fixed. | Owner rulings + rewrite order, 12 Jun 2026, verbatim in the dispatch prompt; floors named per §8.5. |
| 1.3 | 2026-06-22 | Owner ruling — throughput pass (all projects). Eight additive amendments to keep builders loaded, minimize turnarounds, and remove parallelism caps, without weakening any floor: (1) anti-idle rule — a session runs its scope to an open PR before yielding, default-and-continue on non-blocking ambiguities (§4); (2) blocks-everything-downstream test — the bright line for legitimate early yield (§4); (3) token discipline as a named efficiency axis, exempting verification floors (§6); (4) scope-completeness gate before park — an idle-work park is itself flagged (§3); (5) round-0 self-review — builder runs the reviewer checklist on its own diff first, in addition to and never instead of the independent reviewer (§4); (6) parallel-by-default disposition (§4); (7) no cap on parallel builder sessions — collision of scope is the only limit, not headcount (§4, supersedes the prior two-session limit); (8) unlimited sub-agents as the builder's own parallelized labor, with the one floor that a sub-agent can never be the independent reviewer (§1, §4). New Floor 10 added: throughput never overrides a floor or hard-stop (§2). New idle/turnaround log added to §8 as the measurement surface. The two-party seam (§1) explicitly extended to cover sub-agents. | Owner ruling, 22 Jun 2026, recorded verbatim in the dispatch prompt and this log. Motivating objective: minimized turnarounds, every turn load-bearing, park only when necessary, never idle before open PR, quality non-negotiable, plus speed / token optimization / self-evolution. Owner works 3–4 parallel sessions in practice; the prior two-session limit boxed below actual use. |

---

*Repo-mirror provenance: this file is the canonical methodology committed into the planner repo as the bootstrap-read governing operating model. The §-numbered body is verbatim from `~/.claude/methodology/BUILD-METHODOLOGY.md` (v1.3). The blocks marked **[PLANNER]** are project-specific embeddings reflecting this repo's live Shape-3 implementation; they do not alter the canonical text or the §2 floors. If the canonical source and this mirror diverge, the canonical source wins and the drift is surfaced before acting (Floor 4 / §5 conflict rules).*
