# T3 Plan · Docs-only CI fast-lane (skip the heavy matrix on `memory/**` + `*.md` PRs)

**Status:** **T3 PLAN — PARKS for Love.** Plan only; no implementation in this PR. The plan
edits the merge gate (CI workflow + branch-protection posture), so the eventual **code** PR is a
separate pass that gets a **non-beneficiary, isolated-worktree reviewer running an adversarial
review of the path predicate** (Floor 6; methodology §9.3). Do not implement on the strength of
this document — it parks for Love's ruling first.

**Lane isolation:** CI/gate config only. Does **not** touch the status-filter lane (#557/#559/
calendar) or the design-system lane. Authored in a separate worktree off freshly-fetched
`origin/main` @ `aaed7ae`.

**Bootstrap ack (brief §10 + methodology):** absorbed Path 2-A scope, Transcorp-microservice
framing, the three-role permission catalogue, the exception/horizon/pause/rotation backend model,
the operator + admin frontend surfaces, the Day-by-day slot, and demo posture. The governing
floors for *this* task are **Floor 6 — the merge gate is server-side, and any loosening of a gate
is reviewed by a non-beneficiary session** — and **Floor 10 — throughput never overrides a floor**.
Methodology **§3 "Docs lane (auto-merge)"** is the exact lane being optimised: *"Changes touching
only documentation/memory paths are cross-reviewed and, on a genuine approval pinned to the current
head, merged by the server-side gate. Path allowlists are re-computed server-side from the trusted
copy."* This plan speeds that lane **without** moving the allowlist off its trusted, server-side
re-computation.

---

## 0. TL;DR (the recommendation in three sentences)

Keep CI triggering on **every** PR; add a fast `detect` job that reuses the **existing trusted
predicate** [`scripts/orchestration/path-gate.sh`](../../scripts/orchestration/path-gate.sh) to set
`docs_only`. On a docs-only PR, **step-gate the one required CI job** (`lint + typecheck + test
(unit)`) so it still runs and reports a **real SUCCESS in seconds** (its own sentinel), and
**job-skip the non-required `integration` job** to drop the Postgres compute. Nothing about
branch protection, the orch-automerge actor, the promote gate, or any code/mixed-PR path changes —
a single non-docs file forces the full matrix via the same allowlist that already guards merges.

---

## 1. Current state — grounded in what's actually on `main` (not assumed)

Read at `origin/main @ aaed7ae` on 2026-06-22.

**`.github/workflows/ci.yml`** — fires on `pull_request → [main, production]` and `push → [main]`.
Two jobs:

| Job (`name:`) | What it does | Cost driver |
|---|---|---|
| `lint + typecheck + test (unit)` | `npm ci` → `eslint .` → `tsc --noEmit` → `vitest run --project unit` | `npm ci` + tsc; ~1–2 min |
| `test (integration)` | spins a `postgres:17` **service container**, `npm ci`, provisions a DB, `vitest --project integration` | container + suite; the minutes-long one |

**Branch protection on `main`** (`gh api .../branches/main/protection`, verbatim):

```
required_status_checks.contexts = ["Vercel", "lint + typecheck + test (unit)"]
required_status_checks.strict    = false
required_approving_review_count  = 1
```

**Two load-bearing facts that shape the whole design:**

1. **`test (integration)` is NOT a required status check.** It runs on every PR (compute + wall-time)
   but it does **not** gate the merge — native auto-merge (`gh pr merge --auto`) only waits on the
   two required contexts. So skipping `integration` on docs PRs is **pure compute savings with zero
   gate impact** — it cannot break the merge contract because it was never part of it.
2. **The merge-latency driver on a docs PR is the single required job `lint + typecheck + test
   (unit)`** (plus `Vercel`, out of scope — see §6). To make docs PRs merge fast, *that one job*
   must report SUCCESS fast.

**`.github/workflows/orch-automerge.yml`** — the only actor that merges (Floor 6). For the `t1`
lane (label `automerge-t1`) it re-computes the path gate **from main's trusted copy** under
`pull_request_target` (base ref), requires an `ORCH-VERDICT APPROVE` pinned at head, then arms
**native** auto-merge (`gh pr merge --squash --auto`). Native auto-merge then waits on the required
checks. Hardening already present: disarm-on-synchronize, CONFLICTING loud-park probe, wait-not-park
verdict semantics.

**`scripts/orchestration/path-gate.sh`** — the predicate already exists and is battle-tested:

```sh
# Allowlist: memory/**, docs/**, tasks/**, root-level *.md.
# One file outside the allowlist -> PARK.
# supabase/migrations/** -> ALWAYS park, plus SQL_TO_APPLY flag.
# Fail-closed: gh api --paginate (never the 100-file-capped `gh pr view --json files`);
#              PARK on any API error or empty list (Day-53 fail-open hardening).
case "$f" in
  supabase/migrations/*) sql=true; park=true ;;
  memory/*|docs/*|tasks/*) ;;   # allowed
  */*) park=true ;;             # ANY other nested path -> park
  *.md) ;;                      # ROOT-level *.md only (reached only if no slash)
  *) park=true ;;               # any other root file -> park
esac
```

**Implication:** the "docs-only" question is *already solved*, server-side, fail-closed, and is
*already* the authority that decides whether a PR may ride the auto-merge lane. The gap this plan
closes is narrow: **CI ignores that predicate and runs the full matrix on every PR anyway.** We do
not invent a new predicate — we feed the existing one into CI.

---

## 2. Requirement 1 — the required-status-checks hazard, and the chosen mechanism

**The hazard (stated plainly).** Required checks must still report **SUCCESS** on a docs-only PR.
If a docs PR causes the required check `lint + typecheck + test (unit)` to never report, branch
protection sits in *"Expected — waiting for status to be reported"* **forever** and native
auto-merge never fires — the exact opposite of the goal. The classic way to trip this is
`on.pull_request.paths-ignore: [...]` at the workflow level: a skipped **workflow** leaves its
checks **Pending forever**. (GitHub only auto-passes a check when a **job** is skipped via a
**conditional**, never when the whole workflow is path-filtered out.)

### Decision: **Option (a)** — keep the required job reporting the same required-check name.

Realised in the lowest-blast-radius way the facts allow:

- **The required job `lint + typecheck + test (unit)` always runs** (no workflow-level path filter),
  so the required check **always reports**. On a docs-only PR its expensive **steps** are gated off,
  so it reports a **real SUCCESS in seconds**. The job is its own sentinel — there is no separate
  always-green job to name-match, and **branch protection does not change at all** (the required
  context string `lint + typecheck + test (unit)` is preserved verbatim).
- **The non-required `integration` job is job-level skipped** on docs PRs (it isn't a required
  context, so a skipped/absent status is harmless), dropping the Postgres container + suite.

**Why this over a separate sentinel job (the other shape of option (a)).** A separate
always-green sentinel would require **renaming the required context** in branch protection (drop
`lint + typecheck + test (unit)`, add `ci-required`). That is a server-side gate change with a
dangerous transition window (if protection still requires the old name while the job is now skipped,
docs PRs stick forever) and it leans on GitHub's "skipped job ⇒ success" reporting quirk. Keeping
the required job and gating its *steps* sidesteps both: the job genuinely runs and genuinely
succeeds, and **no branch-protection edit is needed** — strictly less gate churn, strictly less to
get wrong, and the floor-review surface shrinks accordingly.

### Why NOT option (b) — orch-automerge self-detects docs-only and merges without the heavy suites.

Rejected. Today orch-automerge arms **native** auto-merge, which defers to branch protection's
required checks — so even under (b) it could not merge a docs PR until `lint + typecheck + test
(unit)` is green **unless** it switched to a **direct** merge that *bypasses* required checks. That
bypass:

1. **Weakens Floor 6's invariant that every merge satisfies the server-side branch-protection
   contract.** It introduces a second merge semantics where the Action's own path detection — not
   branch protection — is the final gate. (a) keeps the single server-side gate intact and only
   makes the required check go green faster.
2. Requires the Action to hold an admin/bypass capability on `main` — a *widening* of the merge
   actor's power, which is precisely the thing Floor 6 says must be minimised and non-beneficiary-
   reviewed.
3. Re-engineers the Day-54 hardening (disarm-on-synchronize, CONFLICTING loud-park probe,
   wait-not-park verdict) which is all built around native auto-merge. More surface, more risk, for
   a strictly worse safety posture.

### Why NOT native `on: paths` / `paths-ignore` at all.

Two independent disqualifiers:

1. **Pending-forever** (the §2 hazard) on the required check.
2. **`paths`/`paths-ignore` are ANY-match, not ALL-match** — they cannot express "**docs-ONLY**."
   `paths: ['**/*.md']` fires if **any** file matches; a mixed PR (one doc + one code file) would
   match *both* a code-CI workflow and a docs-stub workflow, producing **two runs that report the
   same check name** — a race where a passing stub can overwrite a failing real status and let code
   merge untested. The docs-ONLY question must be answered by a **job that reads the full changed-
   file list** (exactly what `path-gate.sh` does), never by GitHub's native path filters.

---

## 3. Requirement 2 — the docs-only predicate and the mixed-PR safety case

### 3.1 The predicate: reuse `path-gate.sh` verbatim — single source of truth, no second copy.

The `detect` job calls the **existing** script and reads its verdict; it does not re-implement the
allowlist:

```sh
# detect job (pull_request, base == main only):
out="$(bash scripts/orchestration/path-gate.sh "$PR_NUMBER" || true)"
if printf '%s' "$out" | grep -q 'AUTO_MERGE_ELIGIBLE'; then
  echo "docs_only=true"  >> "$GITHUB_OUTPUT"
else
  echo "docs_only=false" >> "$GITHUB_OUTPUT"   # PARK, SQL_TO_APPLY, OR any error/empty -> full CI
fi
```

This inherits, for free:

- **Allowlist** = `memory/**`, `docs/**`, `tasks/**`, **root-level** `*.md`.
- **`supabase/migrations/**` ⇒ never docs-only** (always `PARK`, with the `SQL_TO_APPLY` flag) ⇒
  full CI. (Migrations also still park for Love's named sentence at the merge gate — unchanged.)
- **Fail-closed:** the script uses `gh api --paginate` (never the 100-file-capped `gh pr view`),
  and parks on any API error or empty list. `|| true` + grep means **any** non-`AUTO_MERGE_ELIGIBLE`
  output (PARK, SQL flag, network error, empty) ⇒ `docs_only=false` ⇒ **full CI**. Uncertainty
  always resolves to *more* testing, never less.
- **Zero drift risk:** CI and the merge gate compute docs-only from the **same script**. They can
  only disagree if a PR edits `path-gate.sh` itself — which lands under `scripts/` ⇒ `*/*` ⇒ not
  docs-only ⇒ full CI in both. Self-consistent.

> **Note on the brief's shorthand.** The task framed the predicate as "`memory/**`, `**/*.md`."
> The *actual* trusted predicate is **broader on dirs** (`docs/**`, `tasks/**` too) and **narrower
> on markdown** (**root** `*.md` only, **not** `**/*.md` at any depth). The narrower markdown rule
> is the safer one and is kept: a `.md` *under a code directory* is treated as **not** docs-only
> (see the matrix). We deliberately do **not** widen to `**/*.md`.

### 3.2 The mixed-PR safety proof (the whole risk lives here).

`path-gate.sh` loops over **every** changed file and sets `park=true` on the **first** file outside
the allowlist; it only emits `AUTO_MERGE_ELIGIBLE` if **no** file parked. Therefore the predicate is
**ALL-files-must-be-docs**, not any-file. A single code file ⇒ `park` ⇒ `docs_only=false` ⇒ full CI.
There is no code path from "contains a code file" to "fast lane."

The subtle correctness detail is the **case-statement order**: `*/*` (any nested path) is matched
**before** `*.md`. So a markdown file under a code directory hits `*/*` first and parks — it never
reaches the `*.md` arm, which only ever matches a **root** (slash-free) `*.md`. This is why
`src/foo.md` is correctly **not** docs-only.

### 3.3 Explicit example matrix (the acceptance table for the eventual implementation).

| # | PR contents | `path-gate.sh` | `docs_only` | CI behaviour |
|---|---|---|---|---|
| 1 | `memory/handoffs/x.md` only | allowlisted | `true` | **fast** — required job step-skips → SUCCESS in s; integration skipped |
| 2 | `README.md` (repo root) only | `*.md` arm | `true` | **fast** |
| 3 | `docs/adrs/0007.md` only | `docs/*` | `true` | **fast** |
| 4 | `tasks/todo.md` only | `tasks/*` | `true` | **fast** |
| 5 | `memory/x.md` **+** `src/app/page.tsx` | `src/...` → `*/*` → PARK | `false` | **FULL** ← the safety case: one code file ⇒ full matrix |
| 6 | `src/app/page.tsx` only | `*/*` → PARK | `false` | **FULL** (identical to today) |
| 7 | `src/components/Note.md` (`.md` under code dir) | `*/*` → PARK (before `*.md`) | `false` | **FULL** |
| 8 | rename `docs/a.md` → `docs/b.md` | both `docs/*` | `true` | **fast** (new path governs; both docs) |
| 9 | move `src/x.ts` → `src/y.ts` | both `*/*` | `false` | **FULL** |
| 10 | move `src/x.ts` → `memory/x.ts` | new path `memory/*` → **allowlisted** | `true` ⚠️ | **fast** — see §7 adversarial vector V2 (path-based trust) |
| 11 | `supabase/migrations/0036_*.sql` (+/− docs) | migrations → PARK + `SQL_TO_APPLY` | `false` | **FULL** (and still parks for Love at the gate) |
| 12 | `.github/workflows/ci.yml` edit | `*/*` → PARK | `false` | **FULL** (CI edits never self-fast-lane) |
| 13 | `package.json` / `package-lock.json` | `*` root non-`.md` → PARK | `false` | **FULL** (dep changes never fast-lane) |
| 14 | empty diff / 0 files (error symptom) | empty-list → PARK (fail-closed) | `false` | **FULL** |

Rows 5, 7, 9, 11, 12, 13 are the safety-critical "must fall back to FULL" cases; all hold. **Row 10
is the one genuine residual** (a code file *relocated under* an allowlisted dir is path-trusted as
docs) — flagged for adversarial review in §7, not silently accepted.

---

## 4. Requirement 3 — lint + typecheck on docs PRs: **skip** (with reasoning)

**Call: SKIP `eslint` and `tsc --noEmit` on docs-only PRs** (step-gated alongside the unit suite).

- `eslint .` and `tsc --noEmit` validate the **whole tree**, which on a docs-only diff is **byte-
  identical to `main`** in every code path — `main` was already green, so they add **zero** new
  safety on a no-code change.
- They are the **merge-latency driver** (the required job). Skipping them — and the `npm ci` they
  sit behind — is where essentially all the docs-PR speed-up comes from. Keeping them would pay
  `npm ci` (most of the cost) for no safety.
- The "but lint/typecheck might catch a stray code file" counter-argument is already defeated by
  the predicate: a stray code file makes `docs_only=false` ⇒ the full matrix (including lint +
  typecheck) runs. They only ever skip when the diff provably contains no code.

**Markdown linting "stays":** there is **no markdown/prose linter in CI today** — no
`.markdownlint*` config exists, and `ci.yml` runs neither `markdownlint` nor `prettier --check`
(the `format:check` script exists in `package.json` but is not wired into CI). So "any markdown
linting stays" is satisfied vacuously: nothing prose-related is being removed. **Optional, separable
follow-up (not part of this plan's core):** add a lightweight `markdownlint` job gated to run
**only** on docs PRs (the inverse of `docs_only`), so docs changes gain their *own* cheap check
instead of a heavy code matrix. Called out so the door stays open; not required to ship the fast-
lane.

---

## 5. Requirement 4 — untouched guarantees

1. **No change to code-PR behaviour.** For any PR with ≥1 non-docs file, `detect` ⇒
   `docs_only=false` ⇒ every job runs exactly as today (lint, typecheck, unit, **and** integration),
   with the same required contexts. Byte-for-byte identical merge behaviour. (Matrix rows 5–14.)
2. **No change to the promote / production gate.** The fast-lane is scoped to
   `event_name == pull_request && base_ref == main`. Promotion PRs target `production` (and their
   diff is the accumulated code delta since the last promote — never docs-only anyway), so they
   always get the full matrix. `push → main` post-merge runs also get the full matrix (no PR number
   to evaluate ⇒ `docs_only=false`). The promote workflow and `production` branch protection are not
   touched.
3. **No weakening of the Tier-1 "Vercel + CI green before auto-merge" rule for non-docs.** The
   `Vercel` required context is untouched. `lint + typecheck + test (unit)` remains a required
   context and remains genuinely green-gated; on docs PRs it is genuinely green (steps skipped on a
   provably-no-code diff), on code PRs it is genuinely green only after the real suites pass. The
   orch-automerge verdict gate, clearance gate, disarm-on-synchronize, and CONFLICTING probe are all
   unchanged.
4. **No branch-protection edit.** Required contexts stay `["Vercel", "lint + typecheck + test
   (unit)"]`. (This is the property that keeps the floor-review surface small — see §8.)

---

## 6. Out of scope / honest limits

- **`Vercel` required check.** A docs-only PR still triggers a Vercel **preview build**, which
  remains a required context — so docs-PR merge latency is floored by Vercel's build, not by CI,
  after this change. Optimising that (e.g. Vercel "Ignored Build Step" to short-circuit docs-only
  deploys) is a **separate** follow-up, not this plan. Stated so the speed claim is honest: this
  removes the **CI-matrix** minutes, not the Vercel-build minutes.
- **The `automerge-t1` lane already path-gates docs-only at merge time.** This plan does not change
  *whether* a docs PR may auto-merge — only *how fast the CI it waits on turns green*.

---

## 7. Adversarial-review mandate for the eventual CODE PR (Floor 6 / §9.3)

The code PR that implements this is a **separate pass** and **must** be reviewed by a
**non-beneficiary session in an isolated worktree** (a builder sub-agent may **not** serve as this
reviewer — methodology §1/§4). The reviewer's explicit charge: **construct a code-bearing diff the
filter wrongly treats as docs-only.** Concretely, attempt each vector and prove the outcome:

- **V1 — markdown under a code dir.** `src/x.md`, `app/y.md` ⇒ must be FULL (matrix row 7). Verify
  the `*/*`-before-`*.md` case order survives any refactor of the predicate.
- **V2 — code relocated under an allowlisted dir (the known residual, row 10).** `src/evil.ts` →
  `memory/evil.ts` is path-trusted as docs. The reviewer must **prove whether anything under
  `memory/**`, `docs/**`, `tasks/**` is ever in the build/compile/runtime graph** — i.e. does
  `tsconfig` `include` them, does `eslint .` lint them, does Next.js bundle them, does any runtime
  `import` reach them? If **no**, the residual is benign (untested code that nothing executes). If
  **yes**, the path allowlist **leaks** and the predicate must gain a content/extension guard
  (e.g. reject `*.ts`/`*.tsx`/`*.js`/`*.mjs`/`*.sql` even under allowlisted dirs). **This is the
  single most important check.**
- **V3 — file-list truncation.** Confirm `detect` inherits `path-gate.sh`'s `--paginate` + fail-
  closed behaviour. Construct a 150-file PR (149 docs + 1 code file on "page 2") and prove
  `docs_only=false`. A non-paginated or 100-capped list that hides the code file is a leak.
- **V4 — head-ref trust boundary.** `ci.yml` runs from the PR **head** copy; a PR could rewrite
  `ci.yml`/`path-gate.sh` to hard-code `docs_only=true`. Prove this **cannot** authorise a merge:
  (i) such a PR touches `.github/**` or `scripts/**` ⇒ not docs-only at the **base-ref** path-gate
  inside orch-automerge ⇒ `automerge-t1` arming **parks**; (ii) the only other merge route is
  `love-cleared`, which requires Love's quoted sentence. State explicitly that CI `detect` affects
  **speed only** and never **authorises** a merge — the merge authority remains the base-ref,
  trusted path-gate + verdict. Confirm this property is preserved, and that the change introduces
  **no new** head-trust hole beyond the pre-existing fact that `ci.yml` already runs from head today.
- **V5 — detect liveness / fail-closed direction.** Prove `detect` **never hard-fails** (always
  exits 0, always emits a `docs_only` value), so the required job's `needs: detect` can never be
  *skipped-due-to-failed-dependency* (which would strand the required check Pending-forever — the §2
  hazard re-entering by the back door). And prove the default on any error is `docs_only=false`.
- **V6 — base/event scoping.** Prove `production`-targeted PRs and `push → main` never fast-lane
  (matrix: promote gate untouched).
- **V7 — case-insensitive FS / path normalisation.** `Memory/x.ts`, `./memory/x`, `memory//x` — the
  GitHub files API returns normalised, case-exact repo-relative paths; confirm none of these
  alternate spellings reach an allowlisted arm by accident.

The reviewer signs off only when V1–V7 are each demonstrated (not argued). V2 in particular is a
**build-graph fact to verify in the repo**, not a judgement call.

---

## 8. Floor / methodology compliance

- **Floor 6 (server-side merge gate; non-beneficiary review of any loosening).** The merge gate is
  unchanged: same actor (orch-automerge), same required contexts, same trusted base-ref path-gate
  for authorisation. The CI change makes a required check go green *faster* on a provably-no-code
  diff; it does **not** widen what may merge. To the degree this is read as a *loosening of the
  effort required to turn a required check green*, the implementing code PR is routed to a
  **non-beneficiary reviewer with the adversarial mandate in §7** — satisfying the floor. No branch-
  protection edit is proposed, so there is no settings-level widening to review.
- **Floor 10 (throughput never overrides a floor).** The motivation is throughput (faster docs
  merges at every compaction), but the design refuses every shortcut that would touch a floor: no
  bypass merge (b), no widened actor power, no relaxed allowlist, fail-closed to *more* testing.
  Where speed met the gate, the gate won.
- **Methodology §3 docs lane.** The allowlist remains re-computed server-side from the trusted copy;
  this plan feeds that same computation into CI rather than forking it.
- **Brief §10.5 / decision filing.** This is a CI/gate process change, not a product-scope change,
  so it needs **no brief amendment** and **no `decision_*.md`** — it parks for Love as a T3 plan and,
  once ruled, ships as a reviewed code PR. (If Love prefers, the ruling can be mirrored into a
  `decision_*.md` for the record; not required by §10.5.)

---

## 9. Implementation sketch (for the LATER code PR — NOT applied here)

A single-file change to `.github/workflows/ci.yml` (no new files if reusing `path-gate.sh`):

1. Add a `detect` job (runs on `pull_request` with `base_ref == main`): checks out, runs the
   `path-gate.sh` snippet from §3.1, outputs `docs_only`. Always exits 0 (V5). Needs `GH_TOKEN`.
2. `ci` job (`name: lint + typecheck + test (unit)` — **unchanged name**): add `needs: detect`; gate
   the `npm ci`, `Lint`, `Typecheck`, `Test (unit)` steps with `if: needs.detect.outputs.docs_only
   != 'true'`. Checkout + setup-node may stay ungated (cheap) or also gate — either way the job
   reports SUCCESS fast on docs PRs.
3. `integration` job: add `needs: detect` + job-level `if: needs.detect.outputs.docs_only != 'true'`.
   Skipped on docs PRs (non-required ⇒ harmless).
4. Leave triggers, `concurrency`, and the `production`/`push` paths as-is; the `base_ref == main`
   guard in `detect` keeps the fast-lane off promotion + post-merge runs.

**Verification before merge (on a scratch branch, by the code PR):** prove matrix rows 1–14 by
observation — a docs-only PR shows `lint + typecheck + test (unit)` = SUCCESS in seconds with
`integration` skipped and native auto-merge firing; a mixed PR (row 5) shows the full matrix; a
code PR (row 6) is byte-identical to a pre-change run. Re-confirm `gh api .../protection` still lists
`["Vercel","lint + typecheck + test (unit)"]` (no settings drift).

**Rollback:** revert the single `ci.yml` commit — instantly restores unconditional full matrix.
Zero data/DB/migration surface.

---

## 10. Open questions for Love (park points)

1. **Mechanism — confirm option (a) step-gating (no branch-protection edit)** over the separate-
   sentinel variant (which would rename the required context). Recommendation: **the step-gate**
   (less churn, no settings change, no skipped-check quirk reliance).
2. **Markdown lint follow-up (§4):** add a cheap docs-only `markdownlint` job now, or leave docs
   PRs with no CI check of their own? Recommendation: **leave for now** (none exists today; separable).
3. **Row 10 residual (§7 V2):** acceptable to ship on the "nothing under `memory/`,`docs/`,`tasks/`
   is in the build graph" finding the reviewer must confirm, or require an extension-guard in the
   predicate up front? Recommendation: **ship on the verified finding; add the extension-guard only
   if V2 shows a leak** — but this is Love's call since it touches the gate's risk posture.

**This plan parks here for Love's ruling. No CI/gate file is modified in this PR.**
