# Day-27 EOD

Filed: 2026-05-15 (EOD overnight filing). Single-session day (Session A; Session B contributed PR #290 in parallel). Inbound counterpart is the Day-26 EOD doc + the bootstrap re-pickup of the load-bearing followup that opened the day; this is the outbound EOD covering Day-27 from the Day-26 EOD's deferred memory bundle through to the production-cutover smoke checks 1-4 sign-off.

## §A — Final state at sign-off

- **Main HEAD**: `e49913e` — `docs(d27): single-diagnostic-surprise discipline followup (T1) (#293)`.
- **Production**: `https://planner-olive-sigma.vercel.app` served by `dpl_J7zoFC2zv8CKLbMMkksQxfNfwA8F` (built from main HEAD `e49913e`, promoted Day-27 PM-late via rebuild-against-production-env path). **PRODUCTION CUTOVER LANDED Day-27** — Day-26 + Day-27 bundles now live; schema reconciled; code aligned.
- **Brief on main**: **v1.15** (no amendment Day-27).
- **Demo blockers**: 0 for the sandbox-region happy path. Production-region credential provisioning gated on Aqib API-key auth-header reply (still pending).
- **Demo distance**: tomorrow (Day-28, May 16). Sandbox-region end-to-end is the working demo path.

## §B — PRs landed Day-27

Seven PRs across the day's audit→plan→execute reconciliation arc, plus one direct-to-main housekeeping commit at the open of the day.

| PR / Commit | Slot | Tier | Title |
|---|---|---|---|
| `8132c0a` (direct) | AM | T1 housekeeping | Day-26 EOD doc + memory deltas (EOD ritual repo-side, deferred from Day-26 PM) |
| [#287](https://github.com/lovemansgit/planner/pull/287) | early-AM | T1 | Production schema audit input (repo expectation + prod audit query block) |
| [#288](https://github.com/lovemansgit/planner/pull/288) | mid-AM | T1 | Audit findings + supersede Day-26 absent-identity-schema followup |
| [#289](https://github.com/lovemansgit/planner/pull/289) | late-AM | T1 | Reconciliation audit input — migrations 0017/0020/0021/0022/0023 schema deltas (lane step 1 of 4) |
| [#290](https://github.com/lovemansgit/planner/pull/290) | parallel (Session B) | T1 | Reconciliation audit input — migrations 0018/0019 small slice |
| [#291](https://github.com/lovemansgit/planner/pull/291) | early-PM | T1 | Controlled 0024 retry wrapper (BEGIN/<verbatim>/ROLLBACK; lane step 2 of 4) |
| [#292](https://github.com/lovemansgit/planner/pull/292) | mid-PM | T3 plan | Reconciliation execution plan (lane step 3 of 4; §3.6-approved with 4 rulings folded in amendment commit `6c57220`) |
| [#293](https://github.com/lovemansgit/planner/pull/293) | late-PM | T1 | Single-diagnostic-surprise discipline followup |

Plus the production-side execution (steps 1-6 of the plan), Vercel promote with rebuild-against-production-env, and smoke checks 1-4 — all completed late-PM but with no code-side artifacts on main (the work was reviewer-walked SQL pasted by Love into the Supabase SQL editor + Vercel CLI promote, captured in this EOD doc's §E and §F).

## §C — The Day-27 substantive arc

**Day-27 was the production schema reconciliation lane.** Day-26 ended at the absent-identity-schema gate; Day-27 opened by auditing that gate and discovered every claim in the Day-26 PM filing was factually wrong on production. The day proceeded as a 4-step T3 lane (audit → controlled retry → execution plan → execution) plus an institutional-discipline followup capturing the lesson learned from the Day-26 PM misdiagnosis.

### C.1 — Bootstrap: Day-26 EOD bundle deferred-commit (`8132c0a`)

Day-26 EOD doc + load-bearing followup memo + `MEMORY.md` Day-26 section had been filed locally in the working tree but never committed; Day-27 AM opened with the housekeeping commit landing them direct-to-main per T1 docs-only authorization.

### C.2 — Audit lane (PRs #287 + #288)

PR #287 shipped the audit input: per-migration repo expectation for 0001-0023 + a 15-query read-only SQL block for Love to paste against production. Round 2 refactored Q6 / Q12 into an isolated follow-up section after the §3.6 reviewer caught that the Supabase SQL editor wraps multi-statement pastes in a single transaction (an error mid-block aborts everything after — what the original block called "harmless errors" weren't), and reframed Q1's project-ID semantics (`current_database()` returns `'postgres'` on every Supabase project; the SQL-editor URL is the actual identity check).

PR #288 shipped the findings + superseded the Day-26 load-bearing memo: **production's identity schema is intact on every checked element**. 21/21 expected tables, 1/1 view, all 45 identity-table columns + 21 constraints + 21 RLS-enabled tables + 25 RLS policies + 11-of-12 `set_updated_at` triggers present; `set_updated_at()` function present; `public.users.updated_at` present; `planner_app` role present with LOGIN; Supabase Vault `v0.3.1` available. **Two minor divergences only:** `users_set_updated_at` trigger missing (1 of 12 triggers); `webhook_events_tenant_isolation` policy is `FOR ALL` instead of narrower. Plus one adjacent tech-debt finding: 558 tenant rows on prod with only 57 having any associated user — 501 are integration-test residue accumulated over the sprint.

The Day-26 PM diagnostic claimed all four core identity tables were absent, `set_updated_at()` was absent, and `public.users.updated_at` was absent. All five claims false. The followup memo is retained as historical record with a SUPERSEDED banner.

### C.3 — Reconciliation audit slices (PRs #289 + #290)

PR #289 (Session A) shipped the schema-delta audit for 0017/0020/0021/0022/0023 — 11 read-only queries, single safe-to-paste block, byte-resilient against partial-apply states via `query_to_xml` + catalog-only patterns. PR #290 (Session B) shipped the parallel small-slice audit for 0018/0019. Together: full coverage of the post-`d00dc8a` schema-delta question raised by PR #288's findings memo §1.

### C.4 — Controlled 0024 retry (PR #291)

`BEGIN; <verbatim 0024>; ROLLBACK;` wrapper, byte-identical splice (md5 `bf7bd1c6c0cc30cae625e58e928c80d4` on source migration + extracted slice, verified post-write). The retry ran cleanly through ROLLBACK against production — no statement threw. **Day-26's 0024 failure was transient** (lock, Vault state, network hiccup, momentary catalog inconsistency — exact cause unknown and explicitly not investigated further per the audit memo's "we don't need to resolve this precisely"). Migration 0024 will now apply against the live database.

### C.5 — Reconciliation execution plan (PR #292)

T3 plan-PR with 9-section structure: §1 lane entry conditions; §2 GRANT sweep sub-audit (introduced based on PR #288's webhook_events broad-grant finding; predicted that 0003's `ALTER DEFAULT PRIVILEGES` had auto-granted broad on every table created after 0003 + line 104's explicit grant on all then-existing tables also went broad, meaning `audit_events`'s narrow-intent grant was also overridden in practice); §3 un-wrapped 0024 application (byte-identical 0024 body to PR #291's wrapper, md5 confirmed); §4(a-c) three divergence reconciliations; §5 sequencing (11 steps); §6 Vercel promotion; §7 smoke test scope; §8 hard constraints. Four reviewer decisions surfaced not pre-decided.

**Reviewer §3.6 rulings (resolved):**

| Decision | Ruling | Rationale |
|---|---|---|
| D1: §4(b) `audit_events` REVOKE scope | **INCLUDE** | Architecturally cleaner; operationally inert (0002's RULE protects regardless) |
| D2: defensive-depth RULEs on `webhook_events` | **DEFER** to post-demo | Grant REVOKE alone fully gates; RULE adds cascade-conflict footprint without closing real exposure |
| D3: §4(c) `webhook_events` policy narrowing | **DEFER** to post-demo cleanup lane | Functionally inert after §4(b); architectural cleanup decouples from demo-critical path |
| D4: §6 promotion-rollback schema-side scope | **DEPLOYMENT-ONLY** | Schema changes are additive-compatible with pre-§3 code on `dpl_29fxudjgb-...` |

Plan amendment commit `6c57220` folded all four rulings + two cosmetic fixes from review (§3.POST.1 row-ordering narrative; §3 rollback BEGIN/COMMIT-vs-naked-forward asymmetry comment).

### C.6 — Discipline learning (PR #293)

`memory/followup_single_diagnostic_surprise_discipline.md` filed as institutional-discipline followup. Rule: **when a single diagnostic produces a surprising result that contradicts all other evidence in the project (e.g. "the foundation has been silently broken for N days, but everything has been working"), the next step is ANOTHER diagnostic — not a plan-PR**. The Day-26 PM filing committed reviewer attention + builder time to a T3 reconciliation premise that a second structurally-different diagnostic would have caught as false. Detection heuristic + how-to-apply enumerated in the memo. **Not load-bearing for any specific lane**; marks a rule for future plan-PR drafting, especially reconciliation/cutover work.

## §D — Production execution (reviewer-walked, all pre/post-checks green)

Executed against production project `qdotjmwqbyzldfuxphei` per PR #292's execution plan, walked one §-step at a time with Love confirming each pre-check / post-check green before proceeding.

### D.1 — §2 GRANT sweep (read-only)

| Q | Finding |
|---|---|
| Q2.1 | All 21 base tables in public have `DELETE, INSERT, SELECT, UPDATE` on `planner_app` — confirms 0003 line 104's broad explicit grant + ALTER DEFAULT PRIVILEGES auto-grant pattern. `webhook_events` and `audit_events` both broad-actual despite narrow-intent in their source migrations. |
| Q2.2 | RULEs covering UPDATE/DELETE present only on `audit_events` (`audit_events_no_update`, `audit_events_no_delete`) — no other table carries covering RULEs. |
| Q2.3 | `consignee_timeline_events` view also has broad `DELETE, INSERT, SELECT, UPDATE` grant. Migration 0016 explicitly grants only SELECT on the view; the broad grant is unexpected (a view shouldn't accept writes regardless, but the grant shape is louder than intent). Reviewer call: **defer to post-demo cleanup** (view writes fail at Postgres view-write level even with the grant; the grant is cosmetic). |

**§4(b) REVOKE scope settled at `{webhook_events, audit_events}` only.** The view-grant cleanup punts to post-demo.

### D.2 — §3 migration 0024 application

Pre-checks (3): green. Execution: 0024 body pasted from PR #292 §3 (or equivalently from PR #291's wrapper minus the BEGIN/ROLLBACK frame). Post-checks (4): all green.

Concrete results:

- **`suitefleet_regions` table created** with 4 seed rows. Sandbox row's id confirmed exactly the pinned UUID `11111111-1111-4111-a111-111111111111`. Production-region UUIDs captured for the audit record:
  - `transcorp` → `8c298b3f-5228-40d1-a336-7899e395be66`
  - `transcorpqatar` → `521f51fc-dd0f-40f2-aa36-a9f1c5ac8694`
  - `transcorpuae` → `172207b2-a59b-4d00-b570-755ca0dde755`
- **`tenants` extended** with 3 columns: `suitefleet_region_id` (NOT NULL, FK to suitefleet_regions, DEFAULT pinned-UUID), `suitefleet_credential_1_vault_id` (nullable uuid), `suitefleet_credential_2_vault_id` (nullable uuid).
- **559 tenants backfilled** to the sandbox region. NB: row count was 558 at the audit time (PR #288's Q11); one additional tenant created between audit and execution — accounted for by the DEFAULT clause; backfill UPDATE ran as no-op (0 rows touched since DEFAULT had already populated all rows including the new one).
- **FK integrity clean** (POST.4 returned 0 orphans).

### D.3 — §4(a) `users_set_updated_at` trigger restored

Pre-check: 0 (trigger absent, matching PR #288 finding). Statement: single `CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION set_updated_at();`. Post-check: 1.

### D.4 — §4(b) GRANT REVOKEs

Two tables in scope per D.1's sweep + D1 reviewer ruling: `webhook_events`, `audit_events`. Each: pre-check confirmed broad grants present; REVOKE statement; post-check confirmed grants narrowed to `INSERT, SELECT` only.

- `REVOKE UPDATE, DELETE ON public.webhook_events FROM planner_app;` → post: `INSERT, SELECT` ✓
- `REVOKE UPDATE, DELETE ON public.audit_events FROM planner_app;` → post: `INSERT, SELECT` ✓

**No improvisation** — every statement was from the §3.6-cleared plan. §4(c) skipped per D3 ruling; defensive-depth RULEs skipped per D2 ruling.

## §E — Vercel promote (deployment cutover)

Followed PR #292 §6 inspect-then-promote pattern with one runtime-discovered detour for the preview-to-production rebuild.

### E.1 — Pre-promote inspect (deployment `dpl_27RZ9cfzjrTX8uGayYoyyTrwYQDW`)

- `vercel ls --scope=lovemansgits-projects` → most-recent deployment 13m old, status `● Ready`, environment `Preview`. URL: `planner-g2y6qc6l9-lovemansgits-projects.vercel.app`.
- `vercel inspect <url>` → confirmed `target: preview`, `status: ● Ready`, alias `planner-git-main-lovemansgits-projects.vercel.app` attached.
- `vercel inspect --logs <url> | head -50` → **SHA explicitly confirmed**: build log line 4 reads `Cloning github.com/lovemansgit/planner (Branch: main, Commit: e49913e)`. All four §3.6 promote criteria green.

Build-log side-quirk: an ignore-build optimization script (`bash -c 'git fetch origin main --depth=50 ... grep -qvE "^(memory/|docs/|.*\.md$)" && exit 1 || exit 0'`) emitted two `fatal:` lines because the shallow clone has no `origin/main` ref. The script's terminating `|| exit 0` swallows the failure, which Vercel reads as "do not skip" — a normal build proceeds. **Non-blocking; needs `--unshallow` or alternate base-ref strategy for clean evaluation. Filed as carry-forward.**

### E.2 — Promote → preview-can't-directly-promote runtime detour

`vercel promote https://planner-g2y6qc6l9-lovemansgits-projects.vercel.app --scope=lovemansgits-projects` hit an interactive prompt: *"This deployment is not a production deployment and cannot be directly promoted. A new deployment will be built using your production environment. Are you sure you want to continue? (y/N)"* — Vercel's behavior is to **rebuild against the production env scope** rather than alias-swap a preview-env build (preview and production env scopes carry different values per `feedback_vercel_env_scope_convention.md`).

Stopped, surfaced to reviewer. Reviewer ruled: proceed with rebuild path. `vercel promote --help` confirmed `--yes` flag supported. Re-ran with `--yes`: new deployment kicked off — `dpl_J7zoFC2zv8CKLbMMkksQxfNfwA8F` (URL `planner-6bjtv6vlr-lovemansgits-projects.vercel.app`).

### E.3 — Post-promote inspect (new production deployment `dpl_J7zoFC2zv8CKLbMMkksQxfNfwA8F`)

Polled `vercel ls` until status `● Ready` (46s build duration; identical to preview's 47s; build cache restored from prior deployment). Then:

- `vercel inspect <new-url>` → `target: production` ✓, `status: ● Ready` ✓. **Aliases attached:** `planner-olive-sigma.vercel.app` (primary production alias — swap confirmed), `planner-lovemansgits-projects.vercel.app`, `planner-git-main-lovemansgits-projects.vercel.app`.
- `vercel inspect --logs <new-url>` → build log line 4: `Cloning github.com/lovemansgit/planner (Branch: main, Commit: e49913e)` — **SHA explicitly confirmed identical to the preview build's SHA**. Same source, different env scope. The ignore-build optimization fatal: reappeared (same shallow-clone limitation; same `|| exit 0` safety; non-blocking).

**Previous production deployment `dpl_29fxudjgb-lovemansgits-projects` (built from `6c637f4`) retained for promotion-rollback per D4 ruling.** It no longer carries the `planner-olive-sigma.vercel.app` alias.

## §F — Smoke test status

Per PR #292 §7 checklist:

| Check | Status | Notes |
|---|---|---|
| 1. Application loads | ✓ GREEN | `planner-olive-sigma.vercel.app` returns 307 → /login as expected for unauthenticated traffic |
| 2. Login works | ✓ GREEN | Auth flow completes for test user |
| 3. `/admin/regions` renders 4 seed regions | ✓ GREEN | Sandbox + 3 production regions visible. Auth Method badge column renders. DEACTIVATE row action gated on `status='active'` |
| 4. Merchant detail page reads new schema | ✓ GREEN | Region link + auth-method badge + credentials-missing badge + webhook-URL surface all reading from the post-0024 schema |
| 5. Sandbox tenant credentials SET (live OAuth path) | ⏸ PAUSED | Page renders correctly; SUBMIT not yet executed — Love paused requesting Aqib full end-to-end sandbox review BEFORE committing the first live SF credential storage |
| 5b. Production-region credential SET → ConfigurationError stub | ⏸ NOT YET RUN | Downstream of check 5; expected to throw HTTP 503 with `ConfigurationError("API Key auth not yet enabled — pending vendor configuration")` |
| 6. End-to-end demo flow rehearsal (create merchant → consignee → subscription → task → push to SF sandbox) | ⏸ NOT YET RUN | Day-28 dry-run lane |

## §G — Production status as of EOD

**LIVE.** Schema reconciled + Day-26+27 bundles promoted. Code on production (`e49913e`) aligned with schema state (post-0024 + post-§4 reconciliation).

- **Sandbox-region (transcorpsb) end-to-end:** working happy path. OAuth `loginOAuth` lives. Credential provisioning surface renders; live SET pending Aqib end-to-end review (smoke check 5).
- **Production-region (transcorp / transcorpuae / transcorpqatar) end-to-end:** gated on Aqib API-key auth-header reply (still pending). Provisioning page renders but SUBMIT throws `ConfigurationError` per the lane stub.
- **Demo posture:** sandbox-region is the working demo flow. Live-added merchants in the demo go on sandbox.

## §H — Carry-forwards to Day-28 (deferred, all post-demo)

| # | Item | Notes |
|---|---|---|
| 1 | **§4(c) `webhook_events` policy narrowing** | Per D3 ruling. Functionally inert after §4(b); architectural cleanup. PR #292 body preserved intact for the future cleanup lane. |
| 2 | **Defensive-depth RULEs on `webhook_events`** | Per D2 ruling. Mirrors `audit_events` 0002 pattern; adds cascade-conflict footprint without closing a real exposure. |
| 3 | **`consignee_timeline_events` view-grant cleanup** | Day-27 D.1 finding: view has broad CRUD grant despite 0016 granting only SELECT. Cosmetic (view writes fail regardless at Postgres view-write layer). |
| 4 | **501-orphan-tenants integration-test residue** | Per PR #288's adjacent finding. Tech debt, not audit failure. Day-24 cleanup didn't catch this scope. |
| 5 | **Worktree retirement queue (~16 in queue)** | Includes 2 new Session-B worktrees Day-27: `planner-d27-discipline-followup`, the PR #290 worktree. |
| 6 | **`.gitignore` `.claude/` line** | Standing housekeeping item. `.claude/scheduled_tasks.lock` is the only file present locally — session-harness artifact, not for git. |
| 7 | **Orphan handoffs (2)** | `memory/handoffs/day-21-am-pr-a2-pr-description-draft.md`, `memory/handoffs/day-22-pm-eod-session-a.md`. Older artifacts that slipped through prior memory bundles. |
| 8 | **Mac folder reorg** | Standing item; outside repo. |
| 9 | **Vercel build-skip-optimization `fatal:`** | `git fetch --depth=50` + `merge-base origin/main` doesn't work on shallow clones; script's `|| exit 0` silent-safe-degrades to "always build". Needs `git fetch --unshallow` or alternate base-ref. Non-blocking. |
| 10 | **`demo-bistro` vs `demo-bistro1` duplicate** | Two demo-Bistro tenants on production. Love to decide pre-demo whether to deactivate one. |
| 11 | **Aqib API-key auth-header reply** | **🔴 LOAD-BEARING new active lane** — see followup memo + §M below. |

## §I — Day-28 (demo day, May 16)

Demo to acting Director of IT + COO. Love's lanes:

- Demo dry-run (full happy-path walkthrough on sandbox region).
- Architecture slide.
- Fold Aqib end-to-end review feedback (when it lands; gates smoke check 5).
- Complete smoke checks 5 → 5b → 6.

Session A standby. No code-side substantive lanes planned (Day-28 is demo execution + Aqib follow-on if the reply lands).

## §J — Discipline learnings filed Day-27

Three institutional artifacts:

- 🔴 **Single-diagnostic surprise → re-diagnose, don't plan** (`memory/followup_single_diagnostic_surprise_discipline.md`, PR #293). Rule: when a single diagnostic contradicts all other evidence in the project, the next step is ANOTHER diagnostic — not a plan-PR. Filed in response to Day-26's reconciliation-lane misfire on a single false-positive diagnostic.

- **SQL editor wraps multi-statement pastes in a single transaction.** Caught in PR #287's round 2 §3.6 review: the original block claimed "errors are harmless" for queries that could throw on missing relations — but the transaction-wrap means one error aborts every subsequent statement in the paste. Discipline: audit blocks must be provably non-throwing on partially-applied schemas; isolated follow-up queries get their own execution.

- **Vercel preview-built deployment cannot be directly promoted to production — it rebuilds against the production env scope.** Runtime-discovered Day-27 PM during the cutover. The `vercel inspect` chain still works (same source SHA on both builds), but the deployed-to-production build is structurally a NEW deployment with potentially-different env-driven behavior. Reviewer should be aware of this pattern for future promotes.

## §K — Memory delta filed Day-27

In-PR or in-this-EOD-commit:

- `memory/audit/day-27-production-schema-audit-input.md` (PR #287)
- `memory/audit/day-27-production-schema-audit-findings.md` (PR #288)
- `memory/audit/day-27-reconciliation-audit-0017-0023-schema-deltas.md` (PR #289)
- `memory/audit/day-27-reconciliation-audit-0018-0019-small-slice.md` (PR #290)
- `memory/audit/day-27-reconciliation-0024-controlled-retry.md` (PR #291)
- `memory/plans/day-27-reconciliation-execution-plan.md` (PR #292)
- `memory/followup_single_diagnostic_surprise_discipline.md` (PR #293)
- `memory/followup_production_identity_schema_absent.md` (modified — supersede banner prepended via PR #288)
- `memory/MEMORY.md` (modified — Day-26 supersede note via PR #288; Day-27 section + followup rotation via this EOD commit)
- 🔴 **NEW: `memory/followup_aqib_api_key_auth_header_pending.md`** (this EOD commit — see §M)
- `memory/handoffs/day-27-eod.md` (this file)

## §L — Brief state

Brief at **v1.15** on main. No amendment Day-27. The dual-path SF auth amendment (v1.15) ratified Day-25 PM-late remains the active brief delta underlying the credentials lane code now running in production. No new amendment forced by today's reconciliation work — the schema came out matching v1.15's intended shape post-§3 + post-§4.

## §M — Load-bearing followup rotation rationale

**Previous active load-bearing followup:** `memory/followup_production_identity_schema_absent.md` (Day-26 filing). **Status:** SUPERSEDED + lane COMPLETE. PR #288 ratified the supersede. Day-27 reconciliation execution + Vercel promote closed the lane.

**New active load-bearing followup:** 🔴 **`memory/followup_aqib_api_key_auth_header_pending.md`** (filed this EOD).

**Rationale.** Day-27's reconciliation work brought production into the v1.15-intended schema state, but the lane code's API Key path (`loginApiKey` in `src/modules/integration/providers/suitefleet/auth-client.ts`) is still stubbed with `ConfigurationError`. Production-region (transcorp / transcorpuae / transcorpqatar) credential provisioning **cannot succeed end-to-end** until Aqib's reply lands confirming the SF API Key + Secret Key request-header shape. The unblock is small (~1 hour: one function body + one integration spec, per the v1.15 plan amendment §5.2 candidates) but the gating dependency is external (vendor), so it is genuinely the next forcing function for production-region completeness.

The single-diagnostic-surprise memo (PR #293) is NOT rotated to load-bearing — it's institutional discipline, applies broadly, and is not gating any specific active lane. It lives as a permanent reference, not as the current substantive-lane pointer.

---

End of Day-27 EOD. Session A standing down. Lane code is COMPLETE + correct; lane LIVE on production; sandbox-region end-to-end is the working demo path; production-region end-to-end gated on Aqib reply. Day-28 opens with the demo dry-run (Love's lane) and Aqib follow-on if his end-to-end review lands.
