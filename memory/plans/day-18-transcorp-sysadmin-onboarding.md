# Day-18 Transcorp-sysadmin onboarding (PLAN)

**Tier:** T2 (one new script + one followup memo; no schema migration; no service-layer changes; no middleware changes)
**Filed:** Day 18, 8 May 2026
**Brief reference:** §2.1 transcorp_staff role context (admin surface ownership)
**Cross-references:**
- `src/modules/identity/roles.ts:183` (transcorp-sysadmin role definition; ALL permission set; systemOnly)
- `scripts/onboard-merchant.mjs` (sibling onboarding script — pattern reference)
- `supabase/migrations/0001_identity.sql:103-199` (users / roles / role_assignments schema)
- `src/shared/request-context.ts:131-141` (resolveUserContext JOIN)
- `src/app/(admin)/layout.tsx` + PR #186 (the admin surface this onboarding unblocks)
- `memory/followup_admin_middleware_phase2.md` (existing memo on transcorp-staff role deferral)

---

## §0 Scope and tier

**T2 scope:** one new script (`scripts/onboard-transcorp-sysadmin.mjs`) + one new followup memo. **No schema migration. No service-layer changes. No middleware changes.**

**Rationale for T2 (not T3):**

- No schema changes. Existing `tenants` / `users` / `role_assignments` columns are sufficient.
- No new permissions or audit events. The `transcorp-sysadmin` role + ALL permission set are already shipped (`roles.ts:183`).
- No RLS / auth-surface changes.
- A `tenants.is_internal` column to discriminate the Transcorp tenant from real merchants is **deferred** (Phase 2; followup memo, not in this PR).

**Demo unblock target:** Gate 12 visual UI smoke for `/admin/merchants` — Love logs in as a transcorp-sysadmin and visually verifies the three demo merchants (MPL/DNR/FBU) render correctly in the admin list page (PR #186 surface).

**Not gating Gate 18:** A1's production smoke (createTask routing) runs via the existing merchant operator logins (mpl-admin / dnr-admin / fbu-admin) — no transcorp-sysadmin needed. Gate 18 is unaffected by this plan.

---

## §1 Background

Three demo tenants exist post-A1 + post-test-tenants-soft-archive:

| Tenant | Slug | customer_code | Status |
|---|---|---|---|
| Meal Plan Scheduler | `meal-plan-scheduler` | 588 | active |
| Dr. Nutrition | `dr-nutrition` | 586 | active |
| Fresh Butchers | `fresh-butchers` | 578 | active |

Merchant operator logins exist for all three (`{slug}-admin@planner.test`), provisioned earlier via `scripts/onboard-merchant.mjs` per the Day-10 P3 onboarding pattern.

`/admin/merchants` surface ships in PR #186 (Day-18 Session B C1 merchant admin frontend) — list + create + activate + deactivate routes + UI + service layer.

`transcorp-sysadmin` role is defined at `src/modules/identity/roles.ts:183`:

```ts
"transcorp-sysadmin": {
  slug: "transcorp-sysadmin",
  name: "Transcorp Sysadmin",
  description: "Transcorp engineering staff. Full cross-tenant access including migration import. Highest-privilege role. Use is logged in the audit trail under actor_kind='user' with the staff member's user id.",
  systemOnly: true,
  permissions: new Set<PermissionId>(ALL),
}
```

**Survey finding (verified Day 18):** ZERO `transcorp-sysadmin` users have ever been provisioned in production — no `INSERT INTO role_assignments` for that slug exists in `scripts/` or `supabase/migrations/` or any seed path. References in `src/` are all role-definition lines, comments, or test fixtures with placeholder strings (e.g., `actorId: "transcorp-sysadmin:alice"` in `audit/tests/emit.spec.ts:64`). **This onboarding will provision the first transcorp-sysadmin user in the system.**

**Goal:** provision one transcorp-sysadmin user so Love can log in and run Gate 12.

---

## §2 Home-tenant binding decision

The schema enforces tenant binding for every user:

| Constraint | Source |
|---|---|
| `users.tenant_id uuid NOT NULL REFERENCES tenants(id)` | `0001_identity.sql:105` |
| `role_assignments.tenant_id uuid NOT NULL REFERENCES tenants(id)` | `0001_identity.sql:193` |
| Permission resolution requires `ra.tenant_id = u.tenant_id` | `request-context.ts:135` (JOIN clause) |
| Permission resolution requires `t.status = 'active'` | `request-context.ts:140` |

There is **no tenant-NULL role assignment shape** in the codebase. Every user — including the transcorp-sysadmin — must have a "home tenant" with `status = 'active'`. Cross-tenant operations work via `withServiceRole` (BYPASSRLS) at the service layer, NOT via tenant-NULL role assignments.

**Decision:** provision a dedicated `'transcorp'` tenant row.

**Rationale (option β from final pre-plan-PR survey):**

- Keeps audit-trail `actor.tenantSlug` honest — a Transcorp staff actor reads "transcorp", not "meal-plan-scheduler". Important for forensic queries that surface actor identity.
- Avoids mixing operator identity with merchant identity in `users.tenant_id` joins.
- Matches brief §2.1 framing of `transcorp_staff` role context as a separate-from-merchant identity.

**Rejected options:**

- **(α) Bind to MPL or another demo tenant** — works mechanically; cosmetic confusion in logs and audit trails ("transcorp staff member appears to belong to MPL"). Not chosen.
- **(γ) Use sandbox-merchant-588** — eliminated. Session B's PR #191 archived this tenant to `status='archived'`; the `t.status = 'active'` constraint at `request-context.ts:140` blocks login for users bound to archived tenants.

**Transcorp tenant row shape:**

| Column | Value | Notes |
|---|---|---|
| `slug` | `'transcorp'` | UNIQUE; must not collide with any existing tenant |
| `name` | `'Transcorp'` | Display name |
| `status` | `'active'` | Required for login per request-context.ts:140 |
| `suitefleet_customer_code` | `NULL` | β cron filter excludes (`list-cron-eligible-tenants.ts:80` requires non-NULL); transcorp tenant correctly stays out of the cron walk |
| `pickup_address_line` | `NULL` | Placeholder; transcorp tenant has no real pickup address |
| `pickup_address_district` | `NULL` | Placeholder |
| `pickup_address_emirate` | `NULL` | Placeholder |
| All other columns | Table defaults | `created_at`, `updated_at`, `id` (gen_random_uuid()) |

---

## §3 Cosmetic filter — deferred

The transcorp tenant row will appear in the `/admin/merchants` list rendered by PR #186's listMerchants flow. There is no `tenants.is_internal` column today, and listMerchants currently filters only by `excludeArchived` (default true) — the transcorp tenant has `status='active'`, so it's included in the list.

**Cosmetic only; no functional issue.** A transcorp-sysadmin viewing the list sees four tenants (transcorp + MPL + DNR + FBU) instead of three.

**Demo Q&A risk:** minor. CAIO panel asking "what's that fourth tenant?" is recoverable. Mitigation: train Love on demo-day phrasing ("that's our system tenant — we'll filter it out before external demo").

**Followup memo to file in this PR:** `memory/followup_admin_merchant_list_filter_internal_tenant.md`.

Memo body:
- When the discrete `transcorp-staff` role slug lands as Phase 2 work (per existing `memory/followup_admin_middleware_phase2.md`), bundle:
  - `tenants.is_internal boolean NOT NULL DEFAULT false` schema migration
  - Backfill: `UPDATE tenants SET is_internal = true WHERE slug = 'transcorp'`
  - `listMerchants` accepts `excludeInternal?: boolean` (defaults true) and filters out internal rows
  - `/admin/merchants` page passes `excludeInternal: true`; explicit toggle when transcorp staff want to see their own tenant row
- Trigger date: pre-Day-28 (external demo to first prospect customer).

---

## §4 Script design

**File:** `scripts/onboard-transcorp-sysadmin.mjs` (new, sibling to `scripts/onboard-merchant.mjs`).

**Idempotent** (safe to re-run with same arguments).

**Six-step shape (mirrors onboard-merchant.mjs structure):**

1. **Upsert tenants row** keyed by `slug='transcorp'`:
   ```sql
   INSERT INTO tenants (slug, name, status)
   VALUES ('transcorp', 'Transcorp', 'active')
   ON CONFLICT (slug) DO UPDATE SET status = 'active', name = 'Transcorp'
   RETURNING id
   ```
   The `DO UPDATE SET status='active'` revives the tenant if a previous operator manually muted it to `'inactive'`. Surface log line warning when the conflict path fires.

2. **Ensure roles row** for `slug='transcorp-sysadmin'` exists (global, `tenant_id IS NULL`):
   ```sql
   INSERT INTO roles (tenant_id, name, slug, description)
   VALUES (NULL, 'Transcorp Sysadmin', 'transcorp-sysadmin', '<description from roles.ts:185-187>')
   ON CONFLICT (tenant_id, slug) DO NOTHING
   ```
   The description string mirrors `ROLES["transcorp-sysadmin"].description` from `src/modules/identity/roles.ts:185-187`. Two implementation choices for keeping description in sync:
   - **(a)** Hardcode the description string in the script. Drift risk if roles.ts changes; mitigation = code comment cross-referencing roles.ts:183 with the line number.
   - **(b)** Dynamically import `ROLES` from `src/modules/identity/roles.ts` via the `.mjs` script. Requires resolving the TS-compile dependency in node — onboard-merchant.mjs does NOT do this, so the precedent is hardcoded strings.

   **Decision:** (a) hardcoded, matching onboard-merchant.mjs precedent. Drift is recoverable via a future T1 fixup if descriptions diverge.

3. **Create the Supabase Auth user** via `supabase.auth.admin.createUser({ email, password, email_confirm: true })` with idempotent listUsers fallback for existing email. Pattern lifted verbatim from `onboard-merchant.mjs:147-178`.

4. **Upsert `public.users` mirror row**:
   ```sql
   INSERT INTO users (id, tenant_id, email, display_name)
   VALUES (${userId}, ${transcorpTenantId}, ${adminEmail}, 'Transcorp Admin')
   ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, email = EXCLUDED.email
   ```
   The `ON CONFLICT (id)` path supports **only** the case where the same script re-runs against the same email + same target tenant. The collision-with-merchant-operator case (e.g., `mpl-admin@planner.test` reused) is a hard FAIL per §5.

5. **Insert role_assignments**:
   ```sql
   INSERT INTO role_assignments (user_id, role_id, tenant_id)
   VALUES (${userId}, ${transcorpSysadminRoleId}, ${transcorpTenantId})
   ON CONFLICT (user_id, role_id, tenant_id) DO NOTHING
   ```

6. **Print confirmation** with login URL + email reminder (operator already knows password — they supplied it via CLI flag). Password is NEVER echoed.

**CLI shape:**
```
npm run onboard-transcorp-sysadmin -- \
  --admin-email=transcorp-admin@planner.test \
  --admin-password=<operator-supplied>
```

`--admin-password` is mandatory. Script does NOT generate passwords. (Same convention as `onboard-merchant.mjs`.)

**`package.json` scripts entry:**
```json
"onboard-transcorp-sysadmin": "node scripts/onboard-transcorp-sysadmin.mjs"
```

---

## §5 Edge cases + idempotency

**Re-run with same email:** step 3 hits the idempotent listUsers fallback; steps 4-5 ON CONFLICT no-op. Final state matches first-run.

**Re-run with different password for same email:** the script does **NOT** call `supabase.auth.admin.updateUserById` to reset the password. If the operator forgets the password, the recovery flow is the Supabase dashboard or a future password-reset script. Out of scope here. Re-running with a new password silently leaves the auth user's existing password unchanged (because step 3's listUsers-fallback path takes over and skips the create).

**Transcorp tenant exists with `status='inactive'`** (operator manually muted it for some reason): step 1's `ON CONFLICT (slug) DO UPDATE SET status='active'` brings it back. Surface a log line:

```
[onboard] WARNING: existing 'transcorp' tenant had status='<prev>'; restored to 'active'
```

**Email collision with merchant operator** (e.g., `mpl-admin@planner.test` reused as `--admin-email`):
- Step 3: `auth.admin.createUser` returns "user already registered" → listUsers fallback finds the existing auth user.
- Step 4: `INSERT INTO users (id, tenant_id, ...) VALUES (${authUserId}, ${transcorpTenantId}, ...) ON CONFLICT (id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id` would **rewrite** the user's home tenant from MPL to Transcorp — silently breaking that user's MPL operator login.

**Mitigation: hard FAIL FAST** before step 4 with a clear error. Pattern:

```
SELECT tenant_id FROM users WHERE id = ${authUserId};
IF tenant_id != transcorpTenantId AND tenant_id IS NOT NULL THEN
  FAIL: "Email <adminEmail> is already provisioned for a different tenant (id=<existing_tenant_id>); aborting to avoid silent rewrite. Use a fresh email for the Transcorp sysadmin user."
```

Reasoning: a single `auth.users` row can map to only one `public.users` row (PK = FK to `auth.users.id`), so the same email cannot be both an MPL admin and a Transcorp admin.

**Empty / weak password:** the script delegates password validation to Supabase Auth (per `onboard-merchant.mjs` precedent). Supabase rejects passwords below its configured minimum (default 6 chars). The script surfaces the Supabase error verbatim.

---

## §6 Tests

**Existing test infrastructure surface for `scripts/`:**

`scripts/` directory currently contains 13 `.mjs` and 1 `.sh` files (per Day-18 survey). **No tests exist for any of them.** `scripts/onboard-merchant.mjs` (the sibling script this plan mirrors) has no test coverage. There is no `scripts/tests/` directory.

**Decision:** tests are SKIPPED for `onboard-transcorp-sysadmin.mjs` — parity with the no-test-coverage convention for `scripts/onboard-merchant.mjs` and the rest of `scripts/`.

**Followup memo to file** (Phase 2 cleanup, not in this PR): `memory/followup_scripts_test_infra.md` — captures the gap that all scripts under `scripts/` lack test coverage. Trigger: post-pilot.

If integration test coverage IS required by reviewer at code-PR review, four cases would be:

| # | Case | Expected |
|---|---|---|
| 1 | Happy path | Clean DB → script runs → transcorp tenant + sysadmin user + role assignment all present |
| 2 | Idempotent re-run | Script runs twice → exit 0 both times → final state identical |
| 3 | Email collision with merchant operator | Script fails with clear error; no DB mutation |
| 4 | Re-run with `status='inactive'` transcorp tenant | Tenant status becomes 'active'; warning log line printed |

Building test infrastructure for a single script is out of scope for T2. Reviewer can override to require tests; they would fold under §6 of code-PR.

---

## §7 Documentation

**README section:** docstring at the top of `scripts/onboard-transcorp-sysadmin.mjs` mirroring the `onboard-merchant.mjs` header style — purpose, six-step description, env requirements, CLI shape, idempotency notes.

**No top-level README change** in this PR. The script is self-documenting via header docblock; top-level README does not enumerate every `scripts/` file.

---

## §8 Out of scope

- **Schema migration for `tenants.is_internal`** flag — Phase 2, captured in `memory/followup_admin_merchant_list_filter_internal_tenant.md`.
- **`/admin/merchants` list filter** to exclude the transcorp tenant — Phase 2, captured in same followup memo.
- **`transcorp-staff` role slug** as a discrete entry (separate from `transcorp-sysadmin`) — Phase 2, existing memo at `memory/followup_admin_middleware_phase2.md` already covers.
- **Password reset flow** for transcorp-sysadmin — out of MVP. If a Transcorp staff member forgets their password, the recovery path is the Supabase dashboard.
- **Multi-user transcorp-sysadmin** — the script is single-user invocation. Re-run with a different `--admin-email` creates an additional sysadmin user, all bound to the same `transcorp` tenant. Supported by the schema (UNIQUE on (user_id, role_id, tenant_id) allows multiple users per tenant) but not exercised in MVP.
- **`onboard-merchant.mjs` changes** — zero touch. Sibling script remains unchanged.
- **Test infrastructure for scripts/** — out of scope, captured in `memory/followup_scripts_test_infra.md` (filed if reviewer agrees memo is needed).

---

## §9 Approval gates

**T2 hard-stop at PR open** per tier discipline. Reviewer counter-reviews this plan-PR; on approval, code-PR opens. Code-PR review verifies:

- Script matches plan §4 (six-step shape; CLI shape; idempotency)
- Idempotency edge cases match plan §5 (especially the email-collision FAIL FAST)
- Followup memo body matches plan §3
- No password values appear in logs / commit messages / error strings
- Brief amendment NOT required — admin onboarding is implicit in §2.1 transcorp_staff role context; no scope change

**No T3 hard-stop** because:
- No schema migration
- No service-layer logic change
- No new audit events / permissions / RLS policies
- No middleware changes

If reviewer disagrees on tier (e.g., wants T3 because this is the FIRST transcorp-sysadmin user in production), surface the question pre-PR per `feedback_no_self_tier_escalation.md` discipline.

---

## §10 Sequencing

1. **This plan-PR opens** → reviewer counter-review at plan-PR open (T2 first hard-stop).
2. **Plan-PR merges** after reviewer approves.
3. **Code-PR opens** on a fresh branch (`day18/transcorp-sysadmin-onboarding-code` or similar) off main HEAD post-plan-PR-merge.
4. **Code-PR reviewer counter-review at PR open** (T2 second-pass; verifies script matches plan).
5. **Code-PR merges** after approval.
6. **Love runs the script** with operator-supplied password to create `transcorp-admin@planner.test`:
   ```
   npm run onboard-transcorp-sysadmin -- \
     --admin-email=transcorp-admin@planner.test \
     --admin-password=<operator-supplied>
   ```
7. **Gate 12 smoke:** Love logs in as `transcorp-admin@planner.test` → navigates to `/admin/merchants` → visually verifies the three demo merchants render correctly + an extra `transcorp` row → ✓.
8. **Then A2** (webhook handler 3-layer fix) — separate plan-PR per existing `memory/followup_webhook_handler_status_pod_date_sync_bug.md`.

---

## §11 Pre-merge checklist

- [ ] Plan-PR §0-§10 complete
- [ ] No mention of operator-supplied password in plan-PR body, commit messages, or PR description
- [ ] Followup memo path agreed: `memory/followup_admin_merchant_list_filter_internal_tenant.md`
- [ ] Reviewer approves plan-PR before code-PR opens
- [ ] Code-PR section §6 either ships tests OR documents the no-test parity with `onboard-merchant.mjs` + adds `memory/followup_scripts_test_infra.md`

---

**End of plan.**
