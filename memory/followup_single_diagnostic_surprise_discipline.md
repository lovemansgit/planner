# Single-diagnostic surprise — re-diagnose, don't plan

**Filed:** Day-27 (15 May 2026), late-AM.
**Severity:** Procedural — institutional discipline learning. Not load-bearing for any specific lane; marks a rule for future sessions.
**Trigger arc:** Day-26 PM filing → Day-27 audit chain (PRs [#287](https://github.com/lovemansgit/planner/pull/287), [#288](https://github.com/lovemansgit/planner/pull/288), [#289](https://github.com/lovemansgit/planner/pull/289), [#290](https://github.com/lovemansgit/planner/pull/290), [#291](https://github.com/lovemansgit/planner/pull/291)) invalidated every specific claim of the Day-26 PM filing.

## What happened

Day-26 PM, mid-cutover of the per-merchant SF credentials lane (migration 0024 target), the prior reviewer ran a single diagnostic against production project `qdotjmwqbyzldfuxphei` and got a surprising result: four of five core identity tables (`public.tenants`, `public.roles`, `public.role_assignments`, `public.api_keys`) appeared absent, `set_updated_at()` appeared absent, and `public.users` appeared to exist but be missing `updated_at`. See [`memory/handoffs/day-26-eod.md`](handoffs/day-26-eod.md) §F for the as-filed surprising result.

On the basis of that single diagnostic, the reviewer made a confident call: production's `0001_identity.sql` schema is broken. A 🔴 LOAD-BEARING followup was filed at [`memory/followup_production_identity_schema_absent.md`](followup_production_identity_schema_absent.md), the Day-26 production promote was held, and a T3 reconciliation lane (audit → plan → execute) was scoped to fix the broken foundation.

Day-27 ran the audit. Two repo-side audit inputs (PRs #287 + #289 + #290 + #291) and one production audit pass (results captured in [`memory/audit/day-27-production-schema-audit-findings.md`](audit/day-27-production-schema-audit-findings.md), PR #288) established that **every specific claim from the Day-26 PM diagnostic was false**. Production's identity schema is intact. All four tables claimed absent are present. `set_updated_at()` is present. `public.users.updated_at` is present. The webhook_events `FOR ALL` policy concern (findings §3) resolved as benign once Q5 confirmed grants are tight (SELECT+INSERT only on `planner_app`, per PR #290's load-bearing query). Migration 0024's failure during the Day-26 promote is real and unexplained — but it is not an absent-identity-schema problem.

The mechanism by which the Day-26 diagnostic produced false-negative results on every identity-table existence check is still not fully understood. Plausible candidates include: the query ran against a different schema or DB than the one carrying pilot data, a session-state issue in the SQL editor (search_path, role, schema visibility), or an editor-side filtering of the result set. The mechanism doesn't actually matter for this memo's purpose — what matters is that the diagnostic was wrong, and the wrongness was discoverable by running a second, structurally different diagnostic.

## The rule

**When a single diagnostic produces a surprising result, the next step is ANOTHER diagnostic — not a plan-PR.**

This applies especially when the surprising result implies "the foundation is broken in a way that contradicts evidence from earlier in the project." The Day-26 PM filing claimed the identity schema had been absent — but the platform had been serving production traffic for the entire pilot, the auth layer had been issuing tokens against `public.users`, RLS had been scoping queries to tenants, the cron had been walking subscriptions, every audit-event row in the 4-week ledger named a real tenant. The diagnostic's conclusion was inconsistent with every other piece of evidence in the project, and no part of that inconsistency was reconciled before the T3 plan-scope was committed to.

The rule isn't "don't trust diagnostics." The rule is "one diagnostic is one piece of evidence, and when it conflicts with all other evidence in the project, re-diagnose before you plan."

## The deeper principle — "ground before write" applies to plan-writes

The standing discipline of "verify the actual shape of the world before drafting schema migrations against it" (the audit→plan→execute sequencing, the read-only-SQL-first posture, the controlled-retry pattern) is the same shape of discipline that applies to **plan-PRs themselves**.

A plan-PR that scopes a T3 reconciliation lane is itself a load-bearing artifact: it commits reviewer attention, builder time, and a non-trivial schema delta against a premise. Treating that premise as established when only one diagnostic supports it is the same shape of mistake as drafting a schema migration against an unverified assumption about a column's type. The artifact's tier (plan vs migration) doesn't change the rule — both are load-bearing writes that need a grounded premise before they're committed.

The audit-input-first pattern that Day-27 used (read-only SQL block reviewed before it touches production, reconciliation deferred to a separate plan-PR after the audit lands) was structurally correct **because** the audit's premise was uncertain. If the same pattern had been applied to the Day-26 PM filing — file the surprising result as audit input, run a second structurally-different diagnostic before scoping the T3 lane — the false-positive would have been caught before any plan work was committed.

## Detection heuristic

The strongest signal for "re-diagnose, don't plan" is when a diagnostic result implies a contradiction of the form:

> "The foundation has been silently broken for N days, but everything has been working."

Working systems generate evidence of working: live traffic, live writes, live audit rows, live tokens, live cron-runs. Absent foundations don't generate that evidence — they generate errors, outages, customer reports, pager-duty pings. When a single diagnostic claims a foundation is absent and the rest of the project carries evidence that the foundation is present, the diagnostic is the thing under suspicion, not the foundation.

Secondary heuristics, all weaker than the contradiction signal but useful as confirming evidence:

- **The diagnostic queried catalog/metadata, not behavior.** A metadata query can be wrong about a column's existence in ways that a behavioral query (e.g., "select count(*) from the relation under suspicion") cannot. Behavioral queries can be wrong about row counts; metadata queries can be wrong about whether the relation exists at all (search_path, schema visibility, role privileges, dashboard filtering).
- **The diagnostic was a single query, not a query set.** Two structurally-different queries that converge on the same answer raise the bar substantially over either query alone.
- **The diagnostic was run in an interactive editor, not a script.** Editor session state (search_path, role, the current schema in the dropdown) is a frequent source of false-negatives on existence checks. A script that captures full environment alongside the result is harder to mis-read.

None of these are individually decisive. The contradiction-with-other-evidence signal is the one that should reliably stop a plan-PR from being scoped.

## What this memo is NOT

- Not a critique of the Day-26 PM reviewer's judgment in the moment — the diagnostic looked clean, and the time pressure of an in-flight promote made a re-diagnose vs file-and-plan call hard.
- Not a load-bearing rule that blocks any specific lane. It's institutional discipline for future plan-PR drafting, especially for reconciliation/cutover work.
- Not a claim that diagnostics should be doubted by default. The rule is narrow: surprising results contradicting prior evidence are the trigger, not all results.
- Not a replacement for the existing audit→plan→execute sequencing. It reinforces that pattern by clarifying when it applies most.

## How to apply

When a diagnostic produces a result that meets the contradiction-with-other-evidence signal:

1. **Pause before scoping any plan-PR.** The plan-PR is the thing the rule guards.
2. **Run a second, structurally different diagnostic** — different query shape, different tool (script vs editor), different angle (behavioral vs metadata, or vice versa). The goal is to converge or diverge from the original result, not to rerun it.
3. **If the two diagnostics converge:** the original result is more credible; scope the plan-PR as normal.
4. **If the two diagnostics diverge:** neither is yet credible. Run more diagnostics. The point of divergence usually surfaces the original's failure mode (session state, schema visibility, filtering, etc.).
5. **In either branch, file the diagnostic results as audit input** before any plan-PR opens. The audit-input pattern is the cheap second-layer check that catches the rare-but-expensive false-positive.

## Cross-references

- [`memory/audit/day-27-production-schema-audit-findings.md`](audit/day-27-production-schema-audit-findings.md) — the audit that established ground truth and invalidated the Day-26 PM diagnostic.
- [`memory/handoffs/day-26-eod.md`](handoffs/day-26-eod.md) §F — the original surprising-diagnostic moment as filed.
- [`memory/followup_production_identity_schema_absent.md`](followup_production_identity_schema_absent.md) — the now-superseded followup that came out of the mistake; retained as historical record with SUPERSEDED banner.

---

**End of single-diagnostic-surprise discipline followup.**
