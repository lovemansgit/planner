# Day-25 EOD

Filed: 2026-05-13 (PM). Full-day arc; consolidates Session A AM + PM
and Session B work landed across the day. Inbound counterpart is the
Day-25 morning bootstrap briefs (one per session); this is the
outbound EOD covering Day-25 from the Day-24 EOD handoff through to
the end-of-day production promote.

## §A — Final state at sign-off

- **Main HEAD**: `6c637f4` — `plan(d25): dual-path SF auth amendment — overrides v1.14 plan OQ-10 (T3) (#276)`
- **Production**: `https://planner-olive-sigma.vercel.app` served by
  `dpl_29fxudjgb-lovemansgits-projects` (built from main HEAD `6c637f4`,
  promoted Day-25 PM-late). Build duration 46s, status Ready. Prior
  production was `dpl_cpvwhy1y4-...` against `484e2a4`; this promote
  moves Production forward by 4 commits (PR #271 merchant detail page
  + webhook URL surface + the three Day-25 PM docs PRs).
- **Brief on main**: **v1.15** (bumped four times today — v1.11 →
  v1.12 AM → v1.13 PM → v1.14 PM-late → v1.15 PM-late)
- **Demo blockers**: 0 (post-pilot foundation-building posture)
- **Demo distance**: post-demo (May 12 internal CAIO + May 18 external
  prospect both shipped earlier in the calendar). Day-25 work is
  foundation-building toward Phase 2 production cutover.

## §B — PRs landed Day-25

Fifteen PRs across both sessions. Session split: A landed #261, #263,
#266, #267, #269, #272, #273, #274, #275, #276 (10 PRs across AM + PM,
covering decoupled-consignee architecture + per-merchant SF
credentials + dual-path auth amendment). B landed #262, #264, #268,
#270, #271 (5 PRs, edit-merchant surface + admin merchants detail
page + §3.6 review-discipline + CI gate).

PR #265 was Session A's first attempt at the decoupled-consignee
code-PR; auto-closed by GitHub when the plan-PR's `--delete-branch`
removed its base ref. Recovered via PR #266 (rebased identical commit
onto main). Filed at `memory/followup_t3_plan_code_branch_sequencing.md`
(landed as PR #267) as the canonical institutional learning. Counted
as 16 PRs opened, 15 merged.

| PR | Author | Slot | Tier | Title |
|---|---|---|---|---|
| [#261](https://github.com/lovemansgit/planner/pull/261) | Session A | AM | T1 | Brief v1.12 amendment — decouple consignee + edit merchant |
| [#262](https://github.com/lovemansgit/planner/pull/262) | Session B | AM | T3 | Plan — edit merchant surface |
| [#263](https://github.com/lovemansgit/planner/pull/263) | Session A | AM | T3 | Plan — decoupled consignee creation + ad-hoc task |
| [#264](https://github.com/lovemansgit/planner/pull/264) | Session B | AM/early-PM | T3 | Code — Edit Merchant surface |
| [#266](https://github.com/lovemansgit/planner/pull/266) | Session A | AM | T3 | Code — decouple consignee creation + ad-hoc task (rebase recovery from auto-closed #265) |
| [#267](https://github.com/lovemansgit/planner/pull/267) | Session A | early-PM | T1 | Followup memo — T3 plan-then-code branch sequencing fragility |
| [#268](https://github.com/lovemansgit/planner/pull/268) | Session B | early-PM | T1 | §3.6 review-discipline CI gate + brief v1.13 |
| [#269](https://github.com/lovemansgit/planner/pull/269) | Session A | PM | T2 | Integration spec teardowns + tenant-consignees-count phone overlap fix; load-bearing pattern memo header on `followup_audit_rule_cascade_conflict.md` |
| [#270](https://github.com/lovemansgit/planner/pull/270) | Session B | PM | T2 | Plan — admin merchants detail page + webhook URL surface |
| [#271](https://github.com/lovemansgit/planner/pull/271) | Session B | PM | T2 | Code — admin merchants detail page + webhook URL surface |
| [#272](https://github.com/lovemansgit/planner/pull/272) | Session A | PM | T1 | Session A PM bootstrap brief for context-fade handoff |
| [#273](https://github.com/lovemansgit/planner/pull/273) | Session A | PM-late | T1 | Brief v1.14 amendment — per-merchant SF credentials + multi-region resolver |
| [#274](https://github.com/lovemansgit/planner/pull/274) | Session A | PM-late | T3 | Plan — per-merchant SF credentials + multi-region client_id resolver |
| [#275](https://github.com/lovemansgit/planner/pull/275) | Session A | PM-late | T1 | Brief v1.15 amendment — dual-path SF auth at region level |
| [#276](https://github.com/lovemansgit/planner/pull/276) | Session A | PM-late | T3 | Plan amendment — dual-path SF auth (overrides v1.14 plan OQ-10) |

## §C — Database state changes (production)

Zero data-side changes today. Day-25's substantive PRs landed
schema-touching changes via migrations on the code-PR pre-merge step
(PR #266 decoupled-consignee, PR #264 edit-merchant, PR #271 merchant
detail) — none required ad-hoc SQL-editor cleanups or bulk-update
operations against production.

Note: the v1.14 + v1.15 plans + plan amendment land schema additions
(`suitefleet_regions` table + `tenants` credential columns) on the
forthcoming code-PR (migration 0024). Plans + brief amendments are on
main; the migration itself does NOT land until the code-PR (still
blocked on §F items below). Production schema state is unchanged from
Day-24 EOD.

## §D — Discipline learnings logged Day-25

Four institutional learnings filed today; two are load-bearing.

- **§3.6 plan-then-code branch sequencing fragility** (PR #267, AM/
  early-PM) — `gh pr merge --delete-branch` on a plan-PR auto-closes
  the dependent code-PR if the code branch's base ref is the plan
  branch. Surfaced during Session A's Day-25 morning lane when PR #265
  was auto-closed after PR #263 merge. Memo at
  `memory/followup_t3_plan_code_branch_sequencing.md` documents
  Option A (fork code off main + cherry-pick plan deltas) vs Option B
  (preserve plan branch via `--delete-branch=false`). Day-25 PM lanes
  (PR #274 + PR #276) used Option A successfully — no auto-close
  incidents.

- **§3.6 review-discipline + CI gate codified** (PR #268, Session B,
  early-PM) — v1.13 amendment introduces §7.1 of the brief: the §3.6
  hard-stop checklist becomes structured (plan compliance, test
  signal, **CI status verification (red is a blocker)**, architectural
  gates, brand discipline). Builder reports CI state in PR-open
  message; reviewer verifies before clearing §3.6. Filed at
  `memory/decision_review_discipline_ci_gate.md`. Load-bearing for
  every T2 + T3 PR going forward. Trigger: PR #264 cleared both §3.6
  rounds on a CI-red main without surfacing the state.

- **🔴 LOAD-BEARING — Audit-rule cascade canonical teardown pattern**
  (PR #269, PM) — `audit_events_no_delete` RULE blocks `DELETE FROM
  tenants` whenever child audit_events exist. Memo
  `memory/followup_audit_rule_cascade_conflict.md` now carries a
  red-banner header at the top with a copy-paste try/catch teardown
  skeleton + anti-patterns list + 8 working-precedent specs. All new
  integration specs must use this pattern. Trigger: six specs across
  Days 24-25 had teardown bugs that surfaced as integration CI red
  multiple times; pattern is now mandatory per the memo header.

- **Brief §9 amendment log is append-only** (Day-25 PM, auto-memory) —
  once a v1.N entry or preamble timeline chunk ships to main, it is
  immutable historical record. Supersedence narrative lives in the
  newer version's own entry; no retroactive footnotes or silent drops
  to older entries. Filed at
  `~/.claude/projects/.../memory/feedback_brief_amendment_log_append_only.md`.
  Trigger: v1.15 amendment (PR #275) originally introduced a hybrid
  retroactive edit of the v1.14 §9 entry; Love caught the
  inconsistency at §3.6 round 1 clarification ask 3 and codified the
  append-only rule. The retroactive-edit hook deny is the structural
  enforcement.

## §E — Brief state

Brief reached **v1.15** today — four amendment versions bumped in a
single day, the highest churn day since v1.1 → v1.2 on Day-13.

- **v1.12** (Day-25 AM) — decoupled consignee creation from
  subscription creation. Wizard removed; flat `/consignees/new` form;
  Overview-tab CTAs for Create-subscription + Add-ad-hoc-task.
  Edit-merchant surface added (`/admin/merchants/[id]/edit`).
  Filed at `memory/decision_brief_v1_12_amendment_decouple_and_edit_merchant.md`.
- **v1.13** (Day-25 PM, Session B) — §3.6 review-discipline checklist
  codified as §7.1 of the brief. CI status verification gate. Filed
  at `memory/decision_review_discipline_ci_gate.md`.
- **v1.14** (Day-25 PM, Session A) — per-merchant SF credentials +
  multi-region `client_id` resolver. §3.6 identifier model deepens
  from three layers to four. New `suitefleet_regions` table + Vault
  storage. New §3.7 security posture. Filed at
  `memory/decision_brief_v1_14_amendment_per_merchant_sf_credentials.md`.
- **v1.15** (Day-25 PM-late, Session A) — dual-path SF auth at region
  level. Overrides v1.14 OQ-10 "clean OAuth cutover" — sandbox keeps
  OAuth, production regions use API Key per SF OpsPortal.
  `auth_method` enum on `suitefleet_regions` (IMMUTABLE post-create).
  Tenant Vault columns renamed to generic
  `suitefleet_credential_1_vault_id` / `_2_vault_id`. Resolver returns
  discriminated union. Filed at
  `memory/decision_brief_v1_15_amendment_dual_path_sf_auth.md`.

## §F — Open carry-forwards to Day-26

### Aqib SF API Key + Secret Key auth-header reply (BLOCKER, narrowed scope)

Aqib (SuiteFleet vendor contact) has been asked for the exact request
headers SF uses to authenticate API Key + Secret Key per merchant.
Industry-standard candidates:

- `Clientid: <client_id>` + `X-Api-Key: <api_key>` + `X-Api-Secret: <secret_key>`
- `Authorization: Bearer <base64(api_key:secret_key)>` + `Clientid: <client_id>`

**Scope narrowed per v1.15.** v1.14 had this as the blocker for the
entire code-PR. v1.15 narrows the blocker to the `loginApiKey` body
only:

- OAuth code path ships in the code-PR (sandbox keeps working
  username/password via `loginOAuth`).
- API Key code path is stubbed at code-PR open with
  `ConfigurationError("API Key auth not yet enabled — pending vendor
  configuration")`. Tenants on api_key regions can be created +
  credentialed but their pushes fail closed at runtime until Aqib
  replies.
- Follow-on **T2 PR** lands the `loginApiKey` body + one integration
  spec when Aqib confirms.

### Vault availability verification on production DB (pre-merge gate)

Code-PR pre-merge gate requires confirming `supabase_vault` extension
is enabled on production via Supabase SQL editor:
`SELECT extname FROM pg_extension WHERE extname = 'supabase_vault';`

Supabase enables Vault by default on hosted projects, so this is
almost certainly already true. The verification is the precondition
check per plan §3.1.

### Code-PR open (forthcoming Day-26+)

Per-merchant SF credentials + multi-region resolver code-PR is the
next substantive lane. Scope per `memory/plans/day-25-per-merchant-sf-credentials.md`
(v1.14 plan, in force) + `memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md`
(v1.15 overlay):

- Migration 0024: `suitefleet_regions` table (with `auth_method`
  enum) + seed rows + `tenants` column additions + sandbox backfill
- Service layer: `createRegion` / `updateRegion` / `deactivateRegion`
  / `storeSuitefleetCredentials` / `resolveSuitefleetCredentials`
  rewrite (returns discriminated union)
- SF auth-client `login()` branches on `auth_method`; `loginOAuth`
  live, `loginApiKey` stubbed with `ConfigurationError`
- Admin UI: `/admin/regions` (list / new / [id]) +
  `/admin/merchants/[id]/credentials` (write-only) + merchant detail
  credentials status badge
- 8 integration specs (6 from v1.14 plan + 2 from v1.15 amendment for
  auth_method immutability + discriminated-union resolver)
- Token cache invalidation interface on rotation

### Vercel env-var retirement (T1 follow-on, post-deploy)

`SUITEFLEET_SANDBOX_USERNAME` / `PASSWORD` / `CLIENT_ID` env vars
remain on Vercel today. Post code-PR deploy + credential provisioning
verification, file a T1 PR to retire these env vars from Production +
Preview. Currently still consumed by the env-backed resolver path
(v1.7); after v1.14 + v1.15 cutover, they're dead config.

### Operational

- **`MEMORY.md` index reconstruction** (carried over from Day-23 §G
  and Day-24 §F). Index currently stops at Day 20. Not addressed
  today. Low-priority versus substantive work. Re-surface Day-26
  morning.
- **Vercel auto-promote OFF** (`memory/followup_vercel_auto_promote_main_to_production.md`).
  Standing rule: every merge to main requires manual `vercel promote
  <dpl-id> --yes --scope=lovemansgits-projects`. Followed today
  (single promote at EOD for the cumulative Day-25 main movement).

## §G — Memory delta filed Day-25

Eight new memo files + one in-place update + one auto-memory feedback:

- `memory/decision_brief_v1_12_amendment_decouple_and_edit_merchant.md` (PR #261)
- `memory/decision_brief_v1_14_amendment_per_merchant_sf_credentials.md` (PR #273)
- `memory/decision_brief_v1_15_amendment_dual_path_sf_auth.md` (PR #275)
- `memory/decision_review_discipline_ci_gate.md` (PR #268, Session B)
- `memory/followup_t3_plan_code_branch_sequencing.md` (PR #267)
- `memory/plans/day-25-decoupled-consignee-creation.md` (PR #263)
- `memory/plans/day-25-per-merchant-sf-credentials.md` (PR #274)
- `memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md` (PR #276)
- `memory/handoffs/bootstrap-session-a-day-25-pm.md` (PR #272 — context-fade handoff filed mid-Day-25)
- `memory/followup_audit_rule_cascade_conflict.md` — UPDATED in-place
  with 🔴 LOAD-BEARING header + canonical teardown skeleton (PR #269)

Auto-memory (not in git, persists across conversations):

- `feedback_brief_amendment_log_append_only.md` (Day-25 PM, post v1.15
  retroactive-edit incident)

---

End of Day-25 EOD. Session A + Session B standing down. Post-demo
foundation-building lane. Next substantive lane (code-PR for
per-merchant SF credentials + multi-region resolver) opens Day-26+
once Aqib's auth-header reply narrows or the OAuth-only code path
ships per v1.15 dual-path posture.
