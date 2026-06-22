# The Three-Role Build Methodology
### Owner-ruled, agent-built, agent-reviewed software delivery

**Version 1.0 — June 2026. Derived from a live production project; generalized for any application.** *(Current version: v1.2 per the append-only amendment log at the foot of this file.)*

> **How to read this file — and why it lives in the repo.** This is the canonical
> Three-Role Build Methodology (current version **v1.2**), mirrored from
> `~/.claude/methodology/BUILD-METHODOLOGY.md` and committed into the planner repo
> as the **bootstrap-read governing operating model**. It is here so that EVERY
> builder and reviewer bootstrap reads the same operating model, identically,
> after a context compaction with nothing but the repo. The §-numbered body below
> is the canonical text. Three planner-specific embeddings are clearly marked
> **[PLANNER]** where they appear — Love's standing dispatch model (§4), the
> release/promote posture (§3), and the on-record gate formats (§4 addendum) —
> which reflect this repo's live Shape-3 implementation
> (`scripts/orchestration/RUNBOOK.md`, `.claude/agents/reviewer.md`,
> `memory/decision_workflow_autonomy_single_checkin.md`). The **§2 floors are
> drift-exempt (§8.5)**: they can only be amended by an explicit owner ruling that
> names the floor, states the replacement protection, and records why — never by
> accumulation of small exceptions, never by analogy, and never on the system's
> own initiative.

---

## 0. What this is

A complete operating model for a **non-technical owner** to ship production software using AI agents, without reading code, performing manual pipeline steps, or blind-approving anything. The owner rules product decisions in plain-English sentences; two AI agents in **separate contexts** build and review each other's work; a third surface audits the pair from outside. Everything risky **parks** until the owner clears it by sentence.

It optimizes for four things, in order: **the owner's work is never destroyed**, **the product matches the owner's intent**, **quality is verified rather than asserted**, and **speed** — which comes from autonomy between check-ins, not from skipping verification.

---

## 1. The three roles (plus the outside check)

**The Owner** — sole decision-maker. Rules by sentence: directional questions, parked-item clearances, named authorizations. Never reviews technical correctness (reviewing code you don't read protects nothing). Never performs pipeline steps manually. Owns the product brief.

**The Builder** (terminal agent, e.g. Claude Code) — writes all code, runs all commands, executes everything programmatic. Works in isolated worktrees/branches. Invokes the reviewer with a reference (PR number) only — never a summary, never a framing.

**The Reviewer** (terminal agent, **separate context** from the builder) — reads every changed file itself from the repository at the pinned head version and posts its own structured verdict. Never rules off the builder's summary. Its standing orders live in the repo so every session behaves identically.

**The Outside Check** (a separate chat surface, e.g. a claude.ai project) — the owner's working surface AND the independent corner pointed at the pair itself. Two aligned agents share blind spots; this surface body-reads parked work independently, audits direction against the brief, and catches what the pair misses from inside. *This role matters more, not less, as autonomy widens.*

**The two-party seam is permanent.** Builder and reviewer are never the same context. One brain cannot review its own work. This is the guardrail that makes everything else safe; it is not subject to streamlining — including within a single long session.

---

## 2. The floors (hold regardless of phase, project, or speed pressure)

1. **Live database changes always park.** Schema migrations and production SQL are never auto-applied. The owner authorizes by named sentence; the executing agent states the route used.
2. **Owner-triggers park even when both agents agree.** Agreement between agents never clears these — only the owner does:
   - **Risk to the owner's work or the build** — repo corruption, lost commits, destructive or hard-to-reverse states.
   - **Drift from the product brief.**
   - **Over-engineering** the reviewer judges an owner ruling could streamline — gold-plating is flagged *to* the owner, never resolved between agents.
   - **Cost** — any new paid dependency, metered API, or spend.
3. **Disagreement parks; it never merges.** Review rounds cap at 2 (request-changes → fix → re-review). Round exhaustion, a standing rejection, a malformed verdict, or classifier uncertainty all park. There is no code path from disagreement to merge.
4. **Body-reads at pinned versions.** The reviewer and the outside check read full file contents at exact commit hashes — never builder summaries, never "trust me" descriptions.
5. **Verify against the running product.** Claims about what exists are checked against the live system, not assumptions or prior framing. One surprising diagnostic result requires a second, structurally different diagnostic before acting on it.
6. **The merge gate is server-side.** Auto-merge (where allowed at all) is performed by one trusted server-side actor that re-computes eligibility itself; the builder cannot merge directly. Permission boundaries that stop an agent from widening its own permissions are features, not bugs. Widening a permission is sentence-authorized by the owner and agent-executed — but **never by the agent that benefits from the widening**: a separate session executes, quoting the owner's sentence verbatim, with independent review. If no non-beneficiary route exists, the widening parks for the owner's explicit per-instance sentence. The owner performs no UI steps. *(Owner ruling, 12 Jun 2026 — v1.2.)*
7. **Secrets never travel through chat or terminal.** Credentials are entered by the owner directly into write-only admin surfaces. Agents handle secret *references*, never secret *values*. This floor stands as the **single exception** to Floor 9 (no manual owner steps): the protection is non-exposure of the value to any agent context — a control a sentence cannot replace. *(Owner ruling, 12 Jun 2026 — v1.2.)*
8. **The product brief is canonical and append-only.** It wins over every other memory file. Shipped amendment entries are immutable; supersedence lives in newer entries, never retroactive edits.
9. **The owner performs no manual pipeline actions.** No file edits, no commits, no label clicks, no UI steps, no terminal commands. The owner's sentence on the record authorizes; the agent executes and states the route used. If a step appears to require the owner's hands, that is a design error: redesign it to sentence-authorized agent execution, or park it as a question — never ask the owner to click, paste, or run anything. "Attribution" / "human-held key" arguments never justify a manual step; shared credentials make typed-by-owner meaningless. The real controls: the owner's quoted sentence on the record, independent review, server-side gates. Single exception: secret-value entry under Floor 7. Where a platform offers no agent route at all, the action is named explicitly as a **platform-forced owner action**, not a designed step. *(Owner ruling, 12 Jun 2026 — v1.1/v1.2.)*

> **The §2 floors are drift-exempt (§8.5).** They are amended only by an explicit
> owner ruling that names the floor, states the replacement protection, and
> records why — never by accumulation of small exceptions, never by analogy, and
> never on the system's own initiative. An efficiency proposal that weakens a
> floor must be flagged as exactly that.

---

## 3. How work ships (the lanes)

**Docs lane (auto-merge).** Changes touching only documentation/memory paths are cross-reviewed and, on a genuine approval pinned to the current head, merged by the server-side gate. Path allowlists are re-computed server-side from the trusted copy.

**Everything else parks.** All code, all configuration off the closed allowlist, all migrations. Parked items carry the reviewer's verdict plus a **plain-English summary written for the owner**: what it does, what it touches, whether SQL needs applying.

**Autonomy tiers:**
- **T1 (docs/memory):** auto-merges through the gate.
- **T2 (closed allowlist):** narrow, explicitly enumerated low-risk categories (UI-only, test-only, non-deploy config). Gated by *category precedent, not analogy* — the deciding test: does it touch a data path or an external contract? Widening the list requires an owner ruling and a written amendment.
- **T3 (everything substantive):** plan first when stakes are high, then build; both park. Two mandatory hard-stops: at plan open and at code open.

**The queue.** Park labels on open PRs are the source of truth; a generated queue document is the owner's reading view. The queue **never auto-drains** — the owner clears items by sentence, batched or singly, whenever they arrive. No fixed check-in hour required.

**Notifications.** Event-driven and debounced: one push + one email per park-batch, listing every newly parked item in plain English.

**Production releases.** Pre-launch (no live users): releases flow on agent agreement — gating them is theater when rollback is free. From launch: releases also park. The owner throws that switch by sentence and defines what "launched" means when they throw it.

### [PLANNER] Release / promote posture (current phase)

- **Current phase: pre-MVP, Option B (Love-ruled, Day-52).** Production promote (Vercel) is part of the autonomous flow — the pair performs it on agent-agreement, with **no per-promote Love authorization** (reversible, no live users; gating promote pre-MVP is theater). Source: `scripts/orchestration/RUNBOOK.md`.
- **Standing rule once MVP-FINALIZED — promote always a separate owner sentence.** When Love throws the MVP-FINALIZED switch (by sentence; he defines "MVP finalized" when he throws it), promotes start parking: each promote then requires a separate owner sentence, exactly as §3 "Production releases" describes for the launched state. Until that switch is thrown, promotes flow.
- **Carve-out that parks in EVERY phase:** live DATABASE changes — `supabase/migrations/**` and any production SQL apply — ALWAYS park for Love's explicit named sentence (Floor 1 / Love-trigger #1), regardless of phase. A bad migration is destructive to the owner's own work, so it parks even pre-MVP.

---

## 4. The working rhythm

- **Check-ins, not supervision.** The owner arrives when convenient; the pair runs autonomously between check-ins. Check-in order: directional questions → parked-item review → owner clears → verification/smoke. Verification and smoke checks are **agent-run**; the owner reads the results in plain English and rules — the owner never executes the checks.
- **One prompt per session at a time.** A queued prompt is never handed over until the current one fully round-trips. Two sessions may run in parallel only on non-colliding scopes, with explicit do-not-touch boundaries in each prompt.
- **Dispatch prompts are self-contained.** Each carries the date anchor, the owner's ruling verbatim, exact references (PR numbers, pinned hashes), ordered steps, and the hard lines. A session must be able to execute after a context compaction with nothing but the prompt and the repo.
- **Owner rulings are recorded verbatim** in decision memos that merge through the docs lane — the ruling's repo record is cleared by the same sentence that made it.
- **Sessions open with a date check** and close with an end-of-day handoff memo (state, in-flight items, carry-forwards) filed through the docs lane.
- **Fail honestly.** If a proof or test can't be produced, the session parks the gap with evidence of what was tried — it never fakes a leg or "calls it probably fine."

### [PLANNER] Love's standing dispatch model

This is how Love runs the pair on this project — the operating shape that §4's rhythm takes in practice:

- **One dispatch carries the full load-bearing scope.** Love fires a single builder prompt containing the entire scope of the lane's work; the builder **sequences the items autonomously with minimal turnarounds**, surfacing to Love only at open PRs. Love does not micro-drive the work step by step.
- **One PR per item.** Each load-bearing item ships as its **own** PR — never bundled — so each carries its own reviewer verdict and its own park/clearance, and each can be ruled on independently.
- **The builder spawns its OWN fresh independent reviewer inside the session, per PR.** A reviewer that **did not build** the change, invoked with the **PR number only**, body-reads the **pinned head SHA** and posts its `ORCH-VERDICT` **before the PR is surfaced** to Love. The two-party seam (§1) holds inside a single long session — separate context, never the building brain reviewing its own work.
- **Love engages only at open PRs.** Between dispatch and open-PR the pair runs autonomously; Love arrives to ruled, reviewer-verdicted, parked PRs and clears them by sentence.
- **Speed comes from autonomy, NOT from skipping verification.** The reviewer body-read, the RED-first tests (§6), and the ground-before-write checks are never traded for throughput. **Quality is non-negotiable**; speed comes from the builder not waiting on Love between items, never from dropping a check.

### [PLANNER] On-record gate formats (Shape-3 implementation)

The two-party seam and the server-side merge gate (§1, Floor 6) are implemented on GitHub as on-record comments the merge Action greps. The exact envelope shapes are **load-bearing contracts, not style** — the Action's grep fails closed on a malformed envelope.

- **`ORCH-VERDICT`** (reviewer-posted) must **lead with the literal lines** `ORCH-VERDICT`, then `PR: #<n>`, then `SHA: <full 40-char headRefOid>`, `ROUND: <n>`, and `VERDICT: APPROVE` **or** `VERDICT: REQUEST_CHANGES` — exactly one of the two verdict words, written as a literal line. The reviewer posts it itself (`gh pr comment`); the **builder NEVER reformats, paraphrases, or re-posts a reviewer verdict envelope.**
- **`ORCH-CLEARANCE`** (the Love-clearance comment) body must **START with the bare clearance token** — no `##` heading, no preamble before it — followed by Love's clearance sentence quoted verbatim. The **reviewer writes the clearance text itself**; **Love firing the merge prompt IS the authorization** (firing-as-clearance), not a Love-typed comment.
- **On-record order is fixed:** reviewer `ORCH-VERDICT` (APPROVE at the current head) → `ORCH-CLEARANCE` (bare token + Love's verbatim sentence) → the park/clearance **label** → the **server-side merge gate** (the Action re-computes eligibility itself and is the only actor that merges). The builder never merges directly.

Source contracts: `.claude/agents/reviewer.md` (verdict format), `scripts/orchestration/RUNBOOK.md` (clearance + label + Action gate), `memory/decision_workflow_autonomy_single_checkin.md` (the ruled autonomy model), `memory/decision_d54_love_cleared_allow_rule.md`.

---

## 5. The memory architecture

All durable knowledge lives **in the repository**, mirrored to the owner's chat-project files. The **builder** prepares and maintains the mirror bundle; where the chat platform offers no agent upload route, the upload itself is a **platform-forced owner action** (named as such per Floor 9), not a designed step. Repo HEAD wins over mirrors; the brief wins over everything.

| File | Role |
|---|---|
| `PRODUCT-BRIEF.md` | Canonical scope, architecture, posture. Append-only amendment log. |
| `memory/handoffs/day-N-eod.md` | Daily state handoff for the next session. |
| `memory/followup_*.md` | One memo per open thread, finding, or deferred item. |
| `memory/decision_*.md` | One memo per owner ruling, verbatim. |
| `MEMORY-INDEX.md` | Index of all memos so any session can locate them. |
| `memory/PARKED-QUEUE.md` | Generated view of what awaits the owner. |
| `.claude/agents/reviewer.md` | The reviewer's standing orders. |
| `RUNBOOK.md` | The pair's operating procedure. |

**Conflict rules:** repo beats mirror; brief beats memo; registered contracts and filed memos beat bootstrap assumptions and paraphrase. If a session detects drift between mirror and repo, it surfaces the drift before acting.

> **[PLANNER] file map.** On this project the canonical brief is
> `memory/PLANNER_PRODUCT_BRIEF.md`; the memo index is `memory/MEMORY.md`; daily
> handoffs live under `memory/handoffs/`; the runbook is
> `scripts/orchestration/RUNBOOK.md`; the reviewer's standing orders are
> `.claude/agents/reviewer.md`; the queue is `memory/PARKED-QUEUE.md`.

---

## 6. Engineering discipline (what "reviewed" means)

- **Tests are watched to fail first** (RED) before the fix, then pass — a test that never failed proves nothing.
- **Integration tests run against the real database engine**, not mocks — schema-drift bugs hide in mocks.
- **Force-push** is allowed only on the builder's own feature branch, hard-blocked on shared branches.
- **Diagnose before rollback** when there's no clock pressure and minimal user impact.
- **Ground before write** — read the actual current state (files, data, vendor behavior) before planning against it. Plans built on stale framing produce confident, wrong code.
- **Stale-framing audit:** when a ruling or memo encodes a number or fact about the system, the reviewer checks it against the running product before building on it. (The costliest bug class in the source project was a correct implementation of an outdated constant.)

---

## 7. Communicating with the owner

- **Plain English only.** Product and operational framing, never implementation framing. The owner should be able to rule on every parked item from its summary alone.
- **Brevity first.** No preamble, no restating, no ceremony. Explain only when reasoning must be auditable, a real decision is being surfaced, or translation is requested.
- **Batch decisions, one recommendation each.** Surface only genuinely-owner decisions; decide reviewer-level questions autonomously. Trade-offs are presented without pushing.
- **Never ask the owner to verify technical work.** When the reviewer says approved, that *is* the approval.
- **Honest caveats, then respect the call.** The owner gets the risk stated once, plainly; if they rule against the caveat, the system executes their ruling with the guardrails intact rather than relitigating.

---

## 8. Self-evolution protocol (efficiency and accuracy improve by design)

The methodology amends itself the same way the product does — proposals park, the owner rules, the record is append-only.

1. **Friction log.** Every end-of-day memo carries a short section: what cost time, what was ambiguous, what a permission rule or process change would have saved. No filtering — small frictions compound.
2. **Catch log.** Every defect that survives review to a later stage gets a one-line entry: what was missed, which check would have caught it. Same for false alarms that wasted a round.
3. **Retro cadence.** At each milestone (or weekly, whichever comes first) the pair reads both logs and proposes **methodology amendments** — concrete, testable changes ("add X to the reviewer's standing orders", "promote category Y to T2", "require grep-counts on replacement PRs"). Proposals park as a batch with a recommendation each.
4. **The owner rules; the amendment is versioned.** Accepted amendments are appended to this document with date, rationale, and the evidence line that motivated them. Rejected ones are recorded too — rejected-with-reason prevents re-litigating.
5. **The floors in §2 are exempt from drift.** They can only be amended by an explicit owner ruling that names the floor, states the replacement protection, and records why — never by accumulation of small exceptions, never by analogy, and **never on the system's own initiative**. An efficiency proposal that weakens a floor must be flagged as exactly that.
6. **Measure, don't vibe.** Where possible, amendments cite numbers: review rounds per PR, defects caught per stage, owner touches per shipped item, time from park to clear. Efficiency means fewer owner touches and fewer late catches — not fewer checks.

---

## 9. Bootstrapping a new application (day-1 checklist)

1. Write the **product brief** with the owner — scope, users, posture, and an acknowledgment protocol (how owner rulings are confirmed and recorded). This is the constitution; everything else references it.
2. Create the repo with the **memory skeleton** (§5 table) and the **reviewer's standing orders**. Executor: the builder.
3. Configure the **server-side merge gate** and branch protection: agents cannot merge; docs-lane allowlist enumerated; force-push blocked on shared branches. Executor: the builder, sentence-authorized, via the platform's API/CLI; the reviewer independently verifies the resulting settings. (These are restrictions, not widenings — Floor 6's non-beneficiary rule applies only when loosening them later.)
4. Set up the **parked-queue generator** and the **notification path** (email + push, debounced per batch). Executor: the builder, sentence-authorized. Any secret values the notification services require are entered by the owner directly into write-only admin surfaces per Floor 7; the builder wires up references only.
5. Record the **autonomy tier table** and the owner-trigger list in the runbook, signed by an owner ruling.
6. Declare the phase: pre-launch (releases flow) or live (releases park).
7. Stand up the **outside-check chat project**. Executor: the builder prepares the project instructions and the mirror bundle, sentence-authorized. Where the chat platform offers no agent route (e.g. chat-project creation and file uploads on claude.ai), those uploads are **platform-forced owner actions** — named as such per Floor 9, not designed steps.
8. First build runs the full loop end-to-end on something small, deliberately — proving the seam, the park, the clear, and the notification before any load-bearing work rides them.

---

*Amendment log (append-only):*

| Version | Date | Change | Evidence |
|---|---|---|---|
| 1.0 | 2026-06-11 | Initial generalization from the source project. | — |
| 1.1 | 2026-06-12 | Owner ruling — no manual Love steps (permanent, all projects): the owner never performs manual pipeline actions (file edits, commits, label clicks, UI steps, terminal commands); the owner's sentence on the record authorizes and the agent executes, stating the route used. Supersedes any step in this document that asks the human to perform a manual pipeline action; such steps are redesigned to sentence-authorized agent execution or parked as a question. | Owner ruling, 12 Jun 2026, recorded verbatim in ~/.claude/CLAUDE.md. |
| 1.2 | 2026-06-12 | Two named floor rulings + rewrite pass. Floor 7 (named) STANDS as the single exception to the no-manual-owner-steps ruling: secret values are entered by the owner directly into write-only admin surfaces, agents handle references only — the protection is non-exposure of the value to any agent context, a control a sentence cannot replace. Floor 6 (named) reconciled: permission widening is sentence-authorized by the owner and agent-executed, never by the agent that benefits; a separate session executes quoting the owner's sentence, with independent review; where no non-beneficiary route exists, the widening parks for the owner's explicit per-instance sentence; the owner performs no UI steps. Body rewrite: v1.1 ruling folded into §2 as Floor 9; §5 mirroring and §9 steps 3, 4, 7 reworded to sentence-authorized agent execution with named executors, platform-forced owner actions named as such; §4 verification/smoke clarified as agent-run with owner reading results; dangling §10 reference in §9 step 1 fixed. | Owner rulings + rewrite order, 12 Jun 2026, verbatim in the dispatch prompt; floors named per §8.5. |

---

*Repo-mirror provenance: this file is the canonical methodology committed into the planner repo as the bootstrap-read governing operating model. The §-numbered body is verbatim from `~/.claude/methodology/BUILD-METHODOLOGY.md` (v1.2). The three blocks marked **[PLANNER]** are project-specific embeddings reflecting this repo's live Shape-3 implementation; they do not alter the canonical text or the §2 floors. If the canonical source and this mirror diverge, the canonical source wins and the drift is surfaced before acting (Floor 4 / §5 conflict rules).*
