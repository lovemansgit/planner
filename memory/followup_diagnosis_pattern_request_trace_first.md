---
name: Diagnosis pattern — try the request trace before the code instrumentation
description: Day 12 surfaced subjectively slow /tasks (4-5s warm-hit). Initial diagnosis path proposed code-level latency instrumentation (PR #129) covering 9 measurement points across resolveSession + tasksPage. Vercel request inspector then revealed the actual bottleneck — function execution 9ms, total response 238ms, edge bom1 / function iad1 — geographic transatlantic split, NOT code execution. Lesson: when the symptom is "uniformly slow regardless of data volume," check request trace + region topology FIRST, before adding instrumentation to time individual code paths. Instrumentation is the right tool for "WHICH code path is slow"; it's the wrong tool for "WHERE is the bottleneck (network vs CPU vs DB vs geographic)." PR #129's instrumentation infrastructure was reverted via PR #131 once the region pin (PR #130) closed the loop.
type: feedback
---

# Diagnosis pattern — try the request trace before the code instrumentation

**Surfaced:** 4 May 2026 (Day 12 /tasks slow-warm-hit investigation)
**Closed by:** PR #130 (region pin to bom1)
**Cleanup PR:** #131 (revert PR #129 instrumentation; this memo's filing PR)

---

## §1 What happened

Day-11 EOD operator validation surfaced subjectively-slow `/tasks` page rendering — 4-5s warm-hits across all 3 P3 merchants regardless of tenant size (MPL 200, DNR 145, FBU 500 subscriptions). Uniform slowness across data volumes ruled out query scaling.

Day-12 morning diagnosis run hypothesised four candidate root causes:

1. supabase.auth.getUser() network roundtrip
2. DB roundtrip latency × 4 queries per render
3. Unconditional listUnresolvedFailedPushes query
4. Cold start

The recommendation was to deploy targeted code instrumentation (PR #129) wrapping the 9 measurement points around `resolveSession` (+4) and the page's data-fetch block (+5), gated behind `ENABLE_LATENCY_LOGS=1` so production wouldn't pay the cost. Plan: collect the timing logs from a preview deploy, identify the dominant cost, target a fix.

Before the instrumentation logs were collected, the reviewer (Love) inspected the request directly via Vercel's request inspector tool — and surfaced ground-truth that resolved the diagnosis without instrumentation:

- **Function execution time: 9 ms.** Server-side path (auth + DB queries) is fast.
- **Total response time: 238 ms.** Wire roundtrip dominates.
- **Edge entry: bom1** (Mumbai, India — auto-routed by user proximity).
- **Function execution: iad1** (Washington, D.C. — Vercel default region; no `regions` key in `vercel.json`).
- Geographic delta (~229 ms) per request roundtrip; multiplied across the 4-5 sequential request-response cycles per page-load (HTML + RSC payload + nav fetches + …) gives the 4-5s subjective load time.

The actual bottleneck was the cross-Atlantic geographic split between user-edge (bom1) and function-execution region (iad1), with the additional cost of function-to-Supabase queries also crossing the Atlantic since Supabase project region is ap-south-1 (Mumbai, confirmed via Supabase dashboard).

Fix: single-line `vercel.json` edit to pin function to `bom1`. Co-locates function with both Supabase and the edge entry. Verified post-deploy: warm-hits became "super fast" (sub-1s) across all 3 merchants. Diagnostic loop closed without using the instrumentation.

PR #129's instrumentation infrastructure was deployed in good faith and would have eventually pointed at the same answer (the `resolveSession.auth.getUser` and DB-query timing lines would have shown ~115-300ms each — a profile consistent with transatlantic cost rather than auth or DB pathology). But the lighter-weight Vercel request inspector got there first, with no code shipped to do it.

## §2 The pattern

When the latency symptom is **uniform across data volumes** ("all merchants slow equally regardless of size"), the bottleneck is more likely fixed-cost infrastructure than per-request CPU or DB scaling. Check in this order:

1. **Vercel request inspector / function trace** — gives function execution time, total response time, edge region, function region. ~30 seconds, no deploy needed.
2. **Region topology inventory** — `vercel.json` regions, Supabase project region, user geography. ~2 minutes, all data on dashboards.
3. **CDN cache hit-rate** — if static assets miss CDN consistently, that's a separate fixable cost.
4. **Network waterfall in browser devtools** — counts RSC payload chunks, nav fetches, image loads. Reveals if the issue is sequential-roundtrip pattern vs single-call slowness.

Only AFTER those four checks fail to localise the bottleneck does code-level instrumentation become the right tool. The instrumentation is right for **"WHICH code path is slow"**; it's wrong for **"WHERE is the bottleneck (network vs CPU vs DB vs geographic)"**.

The four-check pre-instrumentation pass is fast (~5-10 minutes total) and answers the macro-shape question. Skipping it and going straight to instrumentation:

- Pays a deploy cycle (env-var add + redeploy + warm-hit + log-grep)
- Adds a code-revert PR cycle to clean up
- Risks misattributing the bottleneck if the instrumentation only covers SOME layers (e.g., timing the function but not the user-to-edge hop)

The Day-12 path lost ~half a day to this — PR #129 + PR #130 + PR #131 across the loop, where PR #130 alone would have sufficed if the request inspector had been the first probe.

## §3 Empirical results (post-fix verification)

| Metric | Value |
|---|---|
| `/tasks` pre-fix (warm hits, subjective, all 3 merchants) | 4–5 s |
| `/tasks` post-fix (warm hits, subjective, all 3 merchants) | "super fast" (sub-1s) |
| Order-of-magnitude improvement on dominant user flow | ~15–20× |
| `resolveSession.getServerSupabase` post-fix (incidental capture) | 0.5–6.2 ms (median ~1 ms) |
| Final fix surface | 1 line in `vercel.json` |
| Diagnosis-to-fix elapsed | ~10 min from request-inspector observation to fix landing |

The single-line edit was `"regions": ["bom1"]` added to `vercel.json` alongside the existing `crons` key. PR #130 carried the change; Vercel auto-redeployed; Love verified warm-hits in incognito (ruling out browser cache as a confound).

The ~15–20× magnitude is the load-bearing number — it converts what was a "demo blocker" subjective complaint into a non-issue. Future reviewers triaging post-MVP perf work can use it as the calibration point: a single config change closing this much of a user-flow latency gap is rare; most perf gains land at 1.2–2× per fix.

## §4 What the instrumentation WOULD have shown (for completeness)

Had the instrumentation reached log collection before the request-inspector probe, the [TASKS-LATENCY] lines would have surfaced something like:

```
[TASKS-LATENCY] resolveSession.getServerSupabase=2.1ms
[TASKS-LATENCY] resolveSession.auth.getUser=128.4ms       ← transatlantic
[TASKS-LATENCY] resolveSession.resolveUserContext=119.7ms ← transatlantic
[TASKS-LATENCY] resolveSession.total=250.2ms {"outcome":"ok"}
[TASKS-LATENCY] tasksPage.buildRequestContext=0.1ms       ← cache hit (PR #121 working)
[TASKS-LATENCY] tasksPage.listTasks=124.1ms               ← transatlantic
[TASKS-LATENCY] tasksPage.countTasks=118.6ms              ← transatlantic
[TASKS-LATENCY] tasksPage.listUnresolvedFailedPushes=121.2ms ← transatlantic
[TASKS-LATENCY] tasksPage.dataFetch=375.4ms
```

The pattern — every network-dependent line clustering around 115-130ms — would have pointed at "uniform per-RTT cost" rather than "one slow path." That's still a diagnosis, just one obtained via more expensive instrumentation. The request inspector gave the same conclusion (geographic split) directly from the trace metadata.

## §5 The reusable rule

Future "subjectively slow" investigations on production-like surfaces:

1. **First probe: Vercel request inspector + region topology.** ~5 minutes total.
2. **Second probe: browser devtools network waterfall.** Reveals sequential-roundtrip patterns.
3. **Third probe (only if 1+2 don't localise): targeted code instrumentation.** Gated behind an env flag, ship to preview, collect, revert.

The instrumentation infrastructure (the gated `measure()` + `logLatency()` helpers) is itself reusable — preserve the PATTERN even though this particular instance was reverted. If a future investigation needs the same surface, re-introduce the helpers; they're a ~50-line copy-back.

## §6 Cross-references

- PR #129 — the deployed-then-reverted instrumentation infrastructure
- PR #130 — the one-line region pin that closed the loop
- PR #131 — this memo's filing PR + revert of #129
- `memory/decision_mvp_shared_suitefleet_credentials.md` — Path B SF posture; unrelated but useful context for "what does production look like during pilot"
- Day-12 conversation log — full diagnosis-and-fix arc captured
