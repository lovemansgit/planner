# Active-lane followups digest

> **Purpose.** Rolling digest of the active substantive lane's open
> followups, blockers, and success criteria. Read at session start
> alongside `MEMORY.md` (the historical per-day index) for the
> current state of in-flight architectural work. Rotated lane-by-lane
> as code-PRs land and new lanes open.
>
> **Last updated:** Day-25 EOD (13 May 2026 PM).
> **Active lane:** Per-merchant SuiteFleet credentials + multi-region
> `client_id` resolver + dual-path SF auth at region level.

---

## Active lane summary

The current substantive lane replaces the v1.7 region-scoped env-backed OAuth credential model with:

- **DB-backed regions** (`suitefleet_regions` table) — adding a region becomes operator-facing flow, not a deploy.
- **Per-tenant Supabase Vault credentials** — each merchant has its own credentials stored at-rest via pgsodium AEAD.
- **Dual-path SF auth at region level** — `auth_method` enum (`'oauth'` \| `'api_key'`, IMMUTABLE post-create) selects per-region flavor. Sandbox keeps OAuth (preserves working path); production regions use API Key + Secret Key per SF OpsPortal.

Plans + brief amendments are all on main. **Code-PR is the next substantive lane.**

## Source documents

- **Brief amendments (in force on main):**
  - v1.14 — `memory/decision_brief_v1_14_amendment_per_merchant_sf_credentials.md`
  - v1.15 — `memory/decision_brief_v1_15_amendment_dual_path_sf_auth.md`
- **Plan + plan amendment (in force on main):**
  - v1.14 plan — `memory/plans/day-25-per-merchant-sf-credentials.md` (15 sections, all OQs ratified)
  - v1.15 plan amendment — `memory/plans/day-25-per-merchant-sf-credentials-amendment-dual-auth.md` (overlays v1.14 plan; OQ-10 reversed)
- **Brief sections to read (v1.15 on main):**
  - §3.1.1 schema additions (`suitefleet_regions` table + `tenants` Vault columns)
  - §3.1.2 four new audit events (region.{created,updated,deactivated} + credentials.set with no plaintext / no Vault UUIDs)
  - §3.1.3 new `region:manage` permission + `merchant:update` extension
  - §3.1.4 new service methods (region CRUD, storeSuitefleetCredentials, resolveSuitefleetCredentials rewrite)
  - §3.2.1 new admin routes (/admin/regions list/new/[id] + /admin/merchants/[id]/credentials)
  - §3.6 four-layer identifier model + auth_method discriminated-union resolver
  - §3.7 security posture — Vault content semantics per region.auth_method

## Current state (Day-25 EOD)

- **Main HEAD:** `3b35617` (post-merge of EOD PR #277).
- **Production HEAD:** `6c637f4` on `dpl_29fxudjgb-lovemansgits-projects`. EOD doc PR #277 NOT yet promoted; merchant-detail surface (PR #271) IS live.
- **Brief on main:** **v1.15**.
- **Plans on main:** both v1.14 + v1.15 plan-PRs landed (PR #274 + PR #276).
- **No code shipped yet** for the lane. Migration 0024 NOT yet created. `suitefleet_regions` table not on production DB.

## Blockers (status snapshot)

### Blocker 1 — Aqib SF API Key + Secret Key request-header reply

**Status:** OPEN (Love is firing the question).
**Scope:** NARROWED per v1.15. v1.14 had this as the blocker for the entire code-PR; v1.15 narrows it to the `loginApiKey` body only.

What Aqib needs to confirm:
1. Endpoint path (does `/api/auth/authenticate` stay, or is there an `/api/auth/api-key` variant?)
2. Header names + casing — two industry-standard candidates documented at v1.15 plan amendment §5.2:
   - **(a)** `Clientid: <client_id>` + `X-Api-Key: <api_key>` + `X-Api-Secret: <secret_key>`
   - **(b)** `Authorization: Bearer <base64(api_key:secret_key)>` + `Clientid: <client_id>`
3. Whether tokens returned differ in shape/TTL from OAuth tokens
4. Whether a refresh-token path exists or every login is fresh

**Impact on code-PR:** OAuth code path ships unblocked. `loginApiKey` body is stubbed at code-PR open with `ConfigurationError("API Key auth not yet enabled — pending vendor configuration")` (operator-visible). Tenants on api_key regions can be created and credentialed but pushes fail closed at runtime until Aqib replies.

**Follow-on T2 PR** lands the `loginApiKey` body + one integration spec when Aqib confirms — narrow surface, expected ~1 hour of work.

### Blocker 2 — Vault availability verification on production DB

**Status:** OPEN (pre-merge gate; verification step, not investigative work).
**Scope:** Code-PR pre-merge gate per plan §3.1.

Verification command (run via Supabase SQL editor):
```sql
SELECT extname FROM pg_extension WHERE extname = 'supabase_vault';
```
Expected: one row returned. Supabase hosted projects enable Vault by default, so this is almost certainly already true — but it's the precondition check before migration 0024 lands.

**Impact if absent:** code-PR holds for an enabling migration (low likelihood).

## Success criteria for the code-PR (round 2 §3.6 verification)

Per plan §11.3 + plan-amendment §11.3:

- [ ] **Migration 0024 lands cleanly.** `suitefleet_regions` table created + four regions seeded (sandbox=`oauth`, production×3=`api_key`) + `tenants.suitefleet_region_id` + two Vault FK columns added + sandbox backfill applied + `suitefleet_region_id SET NOT NULL` succeeds.
- [ ] **Backfill verification on production.** All existing tenants (MPL, DNR, FBU, Demo Bistro) point at `transcorpsb` region.
- [ ] **OAuth path live + tested.** Sandbox merchants authenticate via `loginOAuth` per the existing flow — push works end-to-end on the sandbox.
- [ ] **api_key path stubs cleanly.** `loginApiKey` throws `ConfigurationError` at runtime; type-narrowing via exhaustive switch verified by tsc; build does NOT break.
- [ ] **8 integration specs land at PR open** (6 from v1.14 plan §10 + 2 from v1.15 amendment §10: auth-method-immutable + discriminated-union resolver). All use canonical teardown skeleton per `memory/followup_audit_rule_cascade_conflict.md`.
- [ ] **Token cache invalidation tested.** Rotation path invalidates the in-memory token cache per plan §4.4.
- [ ] **All four audit events register + emit** (region.{created,updated,deactivated}, credentials.set with payload `{ tenant_id, classifier }` only — no plaintext, no Vault UUIDs).
- [ ] **CI green** per brief v1.13 §7.1.
- [ ] **Vault availability verified** on production DB pre-merge (Blocker 2 cleared).
- [ ] **Demo Bistro credentialed** as a post-deploy smoke test via `/admin/merchants/[id]/credentials`.

## T1 follow-ons (post-deploy)

These DO NOT block the code-PR but land in a small T1 doc + ops sequence afterward.

### T1-followon-1: Vercel env-var retirement

`SUITEFLEET_SANDBOX_USERNAME` / `SUITEFLEET_SANDBOX_PASSWORD` / `SUITEFLEET_SANDBOX_CLIENT_ID` env vars are dead config after the v1.14 + v1.15 cutover (resolver no longer reads env). Retire from Production + Preview via `vercel env rm` after the code-PR's first production push completes cleanly.

Trigger: code-PR deploys cleanly + first sandbox push succeeds via the new resolver path. T1 PR scope: one-line removal × 3 env keys + a memo entry confirming retirement.

### T1-followon-2: Aqib reply landed → loginApiKey body PR

When Blocker 1 clears, file a small T2 PR with just the `loginApiKey` body + one integration spec asserting the request-header shape. Tenants on api_key regions can then push successfully.

Trigger: Aqib's reply lands. Expected scope: one function body + one spec; ~1 hour.

### T1-followon-3: `migrateRegionAuthMethod` flow (deferred)

Future enhancement if a production region ever needs to migrate from one auth flavor to another. Out of v1.15 scope per the IMMUTABLE invariant. The operator-driven re-credentialing flow is not designed yet — file a plan-PR when a real migration need surfaces.

Trigger: a production region operator asks to change auth method. Currently zero demand.

## Followup memos in flight

These memos are referenced by the active lane and should be re-read by anyone working in this area:

- `memory/followup_audit_rule_cascade_conflict.md` — **🔴 LOAD-BEARING** — canonical integration-spec teardown skeleton (mandatory for the 8 new specs)
- `memory/followup_t3_plan_code_branch_sequencing.md` — Option A/B sequencing posture (Option A locked at plan §0.5 — code branch forks off main, no plan-branch base-ref chain)
- `memory/decision_review_discipline_ci_gate.md` — §3.6 hard-stop with CI gate (brief §7.1 codification; load-bearing for both review rounds)
- `memory/followup_secrets_manager_swap_critical_path.md` — Phase 2 scope reshape from "regional credentials" to "Vault UUID → Secrets Manager ARN per merchant" (per v1.14 §4)
- `memory/followup_credential_resolver_type_narrowing.md` — `as string` casts in the v1.7 resolver retire automatically post-cutover (no env reads in new resolver)

## Decommissioned (Day-25 PM)

These items previously appeared in plan / brief drafts but are deliberately not in scope:

- ~~"Regional credential expansion (UAE/Qatar onboarding)"~~ Phase 2 row — retired per v1.14 §4 (regions no longer hold credentials).
- ~~"Integrations page (SF credential entry/test in merchant portal)"~~ Phase 2 row — retired per v1.14 §4 (now MVP via `/admin/merchants/[id]/credentials`).
- ~~"Credential rotation UX"~~ Phase 2 row — retired per v1.14 §4 (now MVP via the same surface).
- ~~"Clean OAuth cutover"~~ v1.14 OQ-10 ruling — REVERSED per v1.15 (dual-path retained; sandbox keeps OAuth working).

---

## Meta: file lifecycle

This file was a phantom reference in `memory/handoffs/bootstrap-session-a-day-25-pm.md` (PR #272) — the bootstrap brief instructed fresh sessions to read it, but no such file existed in git. This Day-25 EOD PR materialises it for the first time and closes the phantom-reference doc bug.

**Rotation cadence:** Refresh whenever a new substantive lane opens (typically post-code-PR-merge of the previous lane). The historical record stays in `MEMORY.md`'s per-day sections; this file is the always-current "active followups" digest.
