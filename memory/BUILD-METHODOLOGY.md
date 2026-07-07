# The Three-Role Build Methodology
**Owner-ruled, agent-built, agent-reviewed software delivery**
Version 2.0 — 7 July 2026. Objective-gated, model-agnostic autonomy. Supersedes v1.3
(archived alongside as BUILD-METHODOLOGY-v1.3.md).

---

## 0. What this is

An operating model for a non-technical owner to ship production software using AI
agents. Two properties define v2.0:

1. **Objective-gated autonomy.** Agents run from brief to verified completion with
   no owner-approval stops. The owner's control points are the brief (before), the
   floors (during), and the record (after). Ordinary code no longer waits for an
   owner sentence to merge.
2. **Model-agnostic execution.** Every rule must produce the same behaviour from the
   weakest model that might run it. Therefore: every rule is mechanically checkable,
   every decision point has an explicit default, and counts replace adjectives. A
   rule that needs judgement to apply is a defect in this document — log it (§10).

Optimizes for, in order: the owner's work is never destroyed; the product matches
the brief; quality is verified by executed checks, never asserted; speed through
uninterrupted loops and parallelism.

---

## 1. The three roles (plus the outside check)

**The Owner** — sole decision-maker. Rules by sentence. Never reviews technical
correctness, never performs pipeline steps. Owns the brief.

**The Builder** (terminal agent) — writes all code, runs all commands, executes
everything programmatic in isolated worktrees/branches. May spawn unlimited
sub-agents as its own parallelized labor. Invokes the reviewer with a PR number
only — never a summary.

**The Reviewer** (terminal agent, separate context) — reads every changed file
itself at the pinned head and posts its own structured verdict. Standing orders
live in the repo.

**The Outside Check** (separate chat surface) — audits the pair from outside:
body-reads parked work independently, checks direction against the brief.

The two-party seam is permanent: builder and reviewer are never the same context,
including via sub-agents. A builder's sub-agent can never serve as the reviewer.

---

## 2. The floors (hold regardless of phase, project, or speed pressure)

1. **Live database changes always park.** Schema migrations and production SQL are
   never auto-applied. The owner authorizes by named sentence; the executing agent
   states the route used.
2. **Owner-triggers park even when both agents agree.** Only the owner clears:
   - Risk to the owner's work — repo corruption, lost commits, destructive or
     hard-to-reverse states.
   - Drift from the product brief.
   - Over-engineering: any diff addition lacking its simplicity-gate line (§6) is
     flagged automatically; gold-plating the reviewer judges an owner ruling could
     streamline is flagged too. Flagged to the owner, never resolved between agents.
   - Cost — any new paid dependency, metered API, or spend.
3. **Disagreement parks; it never merges.** Review rounds cap at 2 (request-changes
   → fix → re-review). Round exhaustion, standing rejection, malformed verdict, or
   classifier uncertainty all park. No code path from disagreement to merge.
4. **Body-reads at pinned versions.** Reviewer and outside check read full file
   contents at exact commit hashes — never builder summaries.
5. **Verify against the running product.** Claims about what exists are checked
   against the live system. A diagnostic result is *surprising* iff it contradicts
   the brief, a filed memo, or a previously passing check; a surprising result
   requires one structurally different second diagnostic before acting on it.
6. **The merge gate is server-side.** Auto-merge is performed by one trusted
   server-side actor that re-computes eligibility itself; the builder cannot merge
   directly. Widening any permission is sentence-authorized by the owner and
   executed by an agent that does not benefit from the widening, quoting the
   owner's sentence verbatim, with independent review; if no non-beneficiary route
   exists, the widening parks for a per-instance owner sentence. The owner performs
   no UI steps. (Owner ruling, 12 Jun 2026.)
7. **Secrets never travel through chat or terminal.** The owner enters credentials
   directly into write-only admin surfaces. Agents handle secret references, never
   values. Sole exception to Floor 9: the protection is non-exposure of the value
   to any agent context — a control a sentence cannot replace. (Owner ruling,
   12 Jun 2026.)
8. **The product brief is canonical and append-only.** It wins over every other
   memory file. Entries are immutable; supersedence lives in newer entries.
9. **The owner performs no manual pipeline actions.** No file edits, no commits, no
   label clicks, no UI steps, no terminal commands. The owner's sentence on the
   record authorizes; the agent executes and states the route used. A step that
   appears to require the owner's hands is a design error: redesign it or park it —
   never ask the owner to click, paste, or run anything. "Attribution" arguments
   never justify a manual step. Real controls: the owner's quoted sentence,
   independent review, server-side gates. Single exception: Floor 7 secret entry.
   Platform-forced owner actions are named as such, never designed in. (Owner
   ruling, 12 Jun 2026 — permanent.)
10. **Autonomy never overrides a floor or a stop.** The loop in §4 pushes agents to
    keep going; that pressure ends the moment a floor or park trigger fires. An
    agent that continues past a real stop "to stay productive" has failed.

---

## 3. The brief contract

- Every project has `PRODUCT-BRIEF.md` before build starts, containing: the
  objective (10 lines maximum), the acceptance criteria, and the phase declaration
  (pre-launch or live).
- **Acceptance criterion format (mandatory).** Each criterion has: an ID (AC-1,
  AC-2, …), one sentence of intent, and a runnable check — the exact command or
  script plus its pass condition (exit code 0, or an explicit expected string or
  HTTP status). If deciding pass/fail requires a human to look at something, the
  criterion is malformed: rewrite it until pass/fail is decidable from command
  output alone. Visual/media outputs get scripted property checks (file exists,
  dimensions, duration, text via OCR) plus at most one criterion tagged
  `OWNER-EYES`; OWNER-EYES criteria are verified at the owner's next check-in and
  never block the loop or the merge of the other criteria.
- **Single clarification pass.** If the brief lacks runnable checks or a required
  section, the agent — once, before the first build cycle — drafts the missing
  checks, appends them to the brief in an amendment entry tagged `DRAFTED-BY-AGENT
  (pending owner ratification)`, lists them in the next notification batch, and
  proceeds immediately against them. There is no second clarification pass: every
  later ambiguity follows default-and-continue (§4).
- **Scope changes only by brief amendment.** Owner entries rule; agent-drafted
  entries are ratified or superseded by a later owner entry, never edited.

---

## 4. The loop

**Cycle** = build → run → verify (execute every check the change could affect) →
debug → improve. Repeat. After the verify step and before the next build step,
update `memory/STATE.md` (§7). Progress is logged, never requested.

**Exactly three stops.** Nothing else pauses the loop — no check-ins, no "does this
look right", no plan-approval waits:

1. **A floor or park trigger fires (§2).** Park that item; continue every part of
   scope the parked item does not touch. If no untouched scope remains, update
   STATE.md and end the session.
2. **A blocker.** Park only after STATE.md lists 3 attempted routes, each with the
   exact command run and its failure output (last 20 lines + exit code).
3. **Completion.** Every acceptance check executed in one final consecutive pass,
   outputs pasted into the completion report (§9).

**Default-and-continue.** For any ambiguity not covered by a floor: write one line
in STATE.md (`DEFAULT: <question> → <choice> — <reason>`), keep building. The owner
reads defaults in the record, not in real time.

**Circuit breaker (counted, not sensed).** Problems are keyed by failing check ID —
or, for failures before any check runs (build/startup errors), by the first line of
the error message. An *attempt* = one code change followed by re-running that check
or command. Counts live in STATE.md and reset only when the check passes.
- After 3 consecutive failed attempts on the same key: mandatory route change —
  write one line naming the discarded approach and its replacement, then attempt 4.
- If attempt 4 fails: park with a written diagnosis — symptom, the 4 attempts with
  their outputs, suspected cause, one recommendation.

**Round-0 self-review.** Before requesting independent review, the builder runs the
reviewer's standing-orders checklist against its own diff and fixes what it
catches. Round-0 is in addition to independent review, never instead of it; a
builder that treats its own pass as sufficient has broken the two-party seam.

**Parallelism.** No cap on concurrent builder sessions; non-colliding scope is the
only limit (no two sessions write the same files or the same external contract).
Unlimited sub-agents inside a builder's own branch; never as reviewer.

---

## 5. Lanes and the merge gate

**Docs lane.** Changes touching only documentation/memory paths: cross-reviewed,
auto-merged by the server-side gate against a server-side path allowlist.

**Code lane** (replaces v1.3 tiers T2/T3). A PR is merge-eligible iff ALL of:
(a) independent reviewer approval at the pinned head, within the 2-round cap;
(b) every acceptance check affected by the PR passes, outputs attached to the PR;
(c) zero park-trigger flags (§2.2) on the PR;
(d) the PR contains no live-database migration content (Floor 1);
(e) the phase is pre-launch. In a live-phase project, any PR changing any path
    outside the server-side docs allowlist is a release and parks — docs-lane
    merges continue. Where deployment is continuous, merging is releasing; no
    model may argue otherwise.
The server-side gate re-computes all five itself. Eligible → merges with no owner
sentence. Ineligible → parks with the failing condition named.

**The queue** contains only floor/park-trigger items and blockers. The owner clears
by sentence at check-ins; the queue never auto-drains. Notifications stay
event-driven and debounced: one push + one email per park-batch.

**Releases.** Pre-launch: flow on agent agreement. From launch: releases park per
condition (e). The owner throws that switch by sentence and defines "launched"
when throwing it.

---

## 6. The simplicity gate (mechanical)

Before adding any new file, dependency, service, or abstraction layer, write one
line in STATE.md: `ADD: <thing> — required by <AC-id>`. No matching criterion = the
addition is not made; if the agent believes it is needed anyway, that is a brief
gap — draft an amendment (§3) or drop it. The reviewer's check is mechanical: any
added file or dependency in the diff without a matching ADD line triggers the
over-engineering park (Floor 2), and the reviewer verifies each cited AC-id exists
in PRODUCT-BRIEF.md — an ADD line citing a nonexistent criterion is treated as a
missing line and triggers the same park. Scope grows only when the brief is
amended.

---

## 7. State file and session survival

- Every project keeps `memory/STATE.md`. It is read as the first action of every
  session (after the date check) and rewritten after every cycle's verify step.
- Mandatory sections, exact headings:
  - `## Now` — current task and next action, 3 lines maximum.
  - `## Criteria` — table: AC-id | check command | last run date | PASS/FAIL |
    output path.
  - `## Attempts` — key | count | routes tried.
  - `## Defaults taken` — the DEFAULT lines (§4).
  - `## Adds` — the ADD lines (§6).
- Full check outputs are saved under `memory/check-runs/<AC-id>-<n>.txt`; STATE.md
  stores paths. Reports quote the last 20 lines + exit code verbatim.
- After compaction or a fresh session: STATE.md + brief + repo must be sufficient
  to resume. Where conversation memory and STATE.md disagree, STATE.md wins.

---

## 8. Engineering discipline

- Tests fail first (RED), then pass — a test that never failed proves nothing.
- Integration tests run against the real database engine, not mocks.
- Force-push only on the builder's own feature branch; hard-blocked on shared ones.
- Rollback rule: if any live user-facing error or alert exists, roll back first and
  diagnose after; otherwise diagnose first.
- Ground before write: read actual current state (files, data, vendor behavior)
  before planning against it. When a memo encodes a number or fact about the
  system, check it against the running product before building on it.
- Token discipline: never re-read an unchanged file already body-read at the same
  hash; reviewer reads changed files only; prompts and summaries carry references,
  not pasted bodies; sub-agents receive context, they don't re-derive it. This
  never trades away Floors 4 or 5 — verification is not waste.

---

## 9. Communicating with the owner

Global CLAUDE.md §5 governs tone and format. Methodology-specific rules:
- Every parked item carries a summary the owner can rule on without reading code.
- Never ask the owner to verify technical work; reviewer approval is the approval.
- Completion report format: 5 lines maximum, then the criteria table from STATE.md
  with each check's last-20-lines output quoted or linked.
- Honest failure: a proof that can't be produced is parked with the command run and
  its output — never "probably fine."

---

## 10. Self-evolution protocol

Amendments follow the same path as product changes: proposals park, the owner
rules, the record is append-only.
- **Friction log** (3 lines/day max): what cost time, what a rule change would save.
- **Catch log**: one line per defect that survived review, and per false alarm.
- **Misread log** (new, v2.0): any rule in this document that two models could read
  two different ways gets an entry plus a proposed rewrite. Ambiguity is a defect.
- **Retro cadence**: each milestone or every 7 days, whichever first — read the
  logs, propose concrete amendments, park them as a batch with one recommendation
  each.
- **The floors are exempt from drift**: amendable only by an explicit owner ruling
  that names the floor, states the replacement protection, and records why.
- **Measure, don't vibe**: review rounds per PR, defects per stage, owner touches
  per shipped item, circuit-breaker parks per week.

---

## 11. Bootstrapping a new application (day-1 checklist)

1. Write `PRODUCT-BRIEF.md` with the owner: objective, acceptance criteria in the
   §3 runnable format, phase declaration.
2. The owner records one bootstrap authorization sentence covering steps 3–6 below;
   it is filed verbatim as the first decision memo.
3. Create the repo with the memory skeleton (brief, STATE.md, check-runs/,
   handoffs/, reviewer standing orders, RUNBOOK.md).
4. Configure the server-side merge gate with the §5 eligibility conditions and
   branch protection; the reviewer independently verifies the resulting settings.
5. Set up the parked-queue generator and debounced notifications. Secret values are
   entered by the owner directly into write-only surfaces per Floor 7.
6. Run the first loop end-to-end on one trivial criterion — proving the loop, the
   state file, the seam, the gate, and the notification before load-bearing work.

---

## Amendment log (append-only)

| Version | Date | Change | Evidence |
|---------|------|--------|----------|
| 1.0 | 2026-06-11 | Initial generalization from the source project. | — |
| 1.1 | 2026-06-12 | Owner ruling — no manual Love steps (permanent, all projects): the owner never performs manual pipeline actions; the owner's sentence on the record authorizes and the agent executes, stating the route used. | Owner ruling, 12 Jun 2026, recorded verbatim in `~/.claude/CLAUDE.md`. |
| 1.2 | 2026-06-12 | Floors 6 and 7 named rulings + rewrite pass folding the v1.1 ruling into Floor 9; sentence-authorized agent execution named throughout; platform-forced owner actions named as such. | Owner rulings, 12 Jun 2026, verbatim in the dispatch prompt. |
| 1.3 | 2026-06-22 | Throughput pass: anti-idle run-to-PR rule, default-and-continue, blocks-everything-downstream test, round-0 self-review, scope-completeness gate, uncapped parallel sessions and sub-agents, token discipline, Floor 10, idle/turnaround log. | Owner ruling, 22 Jun 2026, recorded verbatim in the dispatch prompt and this log. |
| 2.0 | 2026-07-07 | Objective-gated, model-agnostic autonomy. Brief becomes the contract: acceptance criteria as runnable checks (exact command + pass condition), single clarification pass drafts missing checks and proceeds. Continuous loop with exactly three stops (floor/park-trigger; blocker after 3 evidenced routes; completion with all check outputs pasted); counted circuit breaker keyed by check ID (3 consecutive fails → mandatory route change, 4th fail → park with diagnosis). v1.3 tiers T2/T3 and both mandatory hard-stops replaced by a five-condition mechanical merge-eligibility test computed server-side; in live phase, any PR touching paths outside the docs allowlist is a release and parks (merging is releasing under continuous deployment); the parked queue narrows to floors and blockers. Mechanical simplicity gate: ADD lines keyed to criteria, reviewer verifies each cited AC-id exists in the brief, missing or invalid lines trigger the over-engineering park. `memory/STATE.md` (five fixed sections) replaces conversation memory as the state carrier, read first every session, rewritten every cycle. Every judgement-based rule rewritten as if/then with explicit defaults and counts; misread log added to §10. Round-0 self-review retained. All floors, park triggers, merge gate, secrets handling, and owner rulings preserved with tightened wording only. | Owner ruling, 7 Jul 2026 — the recorded approval message for this amendment, on the session record, including three named edits: mechanical live-phase release definition, ADD-line AC-id existence check, round-0 retention. |
