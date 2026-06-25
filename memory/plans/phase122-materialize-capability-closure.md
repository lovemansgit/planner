# Phase 12.2 · Lane 1 — Materialize Capability Closure (PLAN ONLY)

**Lane:** permission-logic closure on a task-generating service. **Status:** for Love's ruling.
**Base:** `e01d2ad` (= `origin/main`). **Scope:** `src/modules/subscriptions/service.ts` (one gate) + its unit test, plus the now-dead admin UI surface.
**Floor check:** no live DB, no migration, no new spend, no auth-config change. Pure runtime permission logic.

> **What this is / isn't.** This is the WRITTEN plan for the closure. **It changes no code and no permission today.** It is the deliverable for you to rule on. The build (gate change + RED-first tests) is a **separate later dispatch** after your clear. Removing the *button* is a different PR (#653); this lane closes the underlying *capability* — which the button removal alone does **not** do (see §4).

---

## 0. Decision sheet — what I need from you

Each is one plain-English choice with my recommendation.

| # | Decision | Options | My recommendation | Why |
|---|----------|---------|-------------------|-----|
| **D1** | **The closure shape** | (A) Forbid *all* cross-tenant materialize regardless of permission, or (B) keep an escape for some narrower marker | **A — forbid all cross-tenant** | Your rule is "Transcorp staff must have NO reachable path." Any retained escape is a reachable path. A is a one-line, surgical change that preserves the merchant same-tenant path exactly. |
| **D2** | **Dead-code removal sequencing** | (A) This PR = gate change only; the dead admin action + button-component get removed by the #653 button-removal PR (same UI surface), or (B) this PR removes the whole admin surface too | **A** | Keeps the security-critical gate change small and independently reviewable; lets the cosmetic UI removal ride with #653 on the same files (avoids two PRs editing `page.tsx`/the action). Either is fine — your call. |
| **D3** | **Build authorization** | Build now / hold | **Build after your clear** — it's RED-first, code-only, zero DB | Surgical and well-fenced; the proof plan (§3) is the gate. |

---

## 1. Caller audit — every path that reaches the capability

`triggerManualMaterialization` (`src/modules/subscriptions/service.ts:513`) has **exactly one** caller, and it is cross-tenant.

| Caller | File:line | Tenant scope | Surface |
|--------|-----------|--------------|---------|
| `triggerMaterializationAction` (server action) | `src/app/(admin)/admin/subscriptions/_actions.ts:36` | **cross-tenant** (Transcorp actor → merchant-owned subscription) | Transcorp · Admin |
| ↳ rendered by `MaterializeButton` | `src/app/(admin)/admin/subscriptions/_components/MaterializeButton.tsx:19,28` | — | the button #653 removes |
| ↳ button mounted at | `src/app/(admin)/admin/subscriptions/page.tsx:219` (actions column, `status === "active"` only) | — | list page only; the detail page has **no** button |

**Merchant surface: zero.** No file under `src/app/(app)/` references `triggerManualMaterialization`, `triggerMaterializationAction`, or `MaterializeButton`.

### Every OTHER materialization entry point (proof that none routes through the gate we change)

| Entry point | File:line | Routes through `triggerManualMaterialization`? | Actor |
|-------------|-----------|:--:|-------|
| Daily cron `GET /api/cron/generate-tasks` → `materializeTenant` | `src/app/api/cron/generate-tasks/route.ts:258-268` | **No** (direct) | System (CRON_SECRET, no user ctx) |
| Merchant subscription create → `materializeSubscriptionForDateRange` | `src/modules/subscriptions/service.ts:288` (inside `createSubscription`, `withTenant`) | **No** (direct) | **Same-tenant merchant** |
| Move-to-date → `materializeSubscriptionOneOffDate` | `src/modules/subscription-exceptions/service.ts:632` | **No** (direct) | Same-tenant merchant |
| Skip-tail-end → `invokeOnDemandMaterialization` → `materializeTenant` | `src/modules/subscription-exceptions/service.ts:1155` | **No** (direct) | Same-tenant merchant |

**Key finding for your rule:** when a merchant materializes their OWN subscription, it happens at **subscription-create** via `materializeSubscriptionForDateRange` (`service.ts:288`) — a *different* function that this change never touches. `triggerManualMaterialization`'s **same-tenant branch has no live caller today** (the only live caller is the admin cross-tenant action). So "preserve the merchant same-tenant path" means: keep the same-tenant branch intact as the sanctioned merchant-only capability surface, even though no UI currently exercises it. Your rule is satisfied: materialization is reachable by merchants (at create, same-tenant) and never cross-tenant by staff.

---

## 2. The exact closure

Today the gate is two checks (`src/modules/subscriptions/service.ts:517` + `:532-537`):

```ts
requirePermission(ctx, "subscription:update");          // line 517
// ...resolve targetTenantId via withServiceRole...
if (ctx.tenantId !== targetTenantId
    && !ctx.actor.permissions.has("subscription:read_all")) {   // line 533 — the escape
  throw new ForbiddenError("cross-tenant materialization requires subscription:read_all");
}
```

`subscription:read_all` is `systemOnly: true` (`src/modules/identity/permissions.ts:748-755`) and is held by **exactly one role — `transcorp-sysadmin`** (`src/modules/identity/roles.ts:249`). So today that escape is the precise authority that lets Transcorp staff materialize cross-tenant. **That escape is the capability to close.**

**Proposed change — delete the escape clause (D1·A):**

```ts
// Same-tenant only. Any cross-tenant materialize is forbidden — staff have
// NO path to materialize a merchant's subscription (Love, Phase 12.2 Lane 1).
if (ctx.tenantId !== targetTenantId) {
  throw new ForbiddenError(
    "materialization is restricted to the subscription's own tenant",
  );
}
```

- **Where it sits:** the same line (`service.ts:533`), inside `triggerManualMaterialization`, after the `targetTenantId` lookup and before any write. The `requirePermission("subscription:update")` at line 517 is unchanged.
- **Effect on Merchant Admin same-tenant:** `ctx.tenantId === targetTenantId` → the `if` is false → proceeds exactly as before. **Unbroken.**
- **Effect on Transcorp staff cross-tenant:** `ctx.tenantId` (Transcorp tenant) `!== targetTenantId` (merchant tenant) → **always Forbidden**, regardless of `read_all`. **Closed.**
- **JSDoc:** the function header (`service.ts:492-498, 509-510`) documents the `read_all` escape and must be rewritten to state the same-tenant-only rule. (Doc-only, same PR.)

No permission is added, removed, or re-graded; `subscription:read_all` keeps its other cross-tenant *read* uses. This is a logic change at one call site only.

---

## 3. Proof plan (RED-first)

Test file: `src/modules/subscriptions/tests/trigger-manual-materialization.spec.ts` (fully mocked; no DB).

| Step | Test | Expected against CURRENT code | After gate change |
|------|------|:--:|:--:|
| **(b) RED** | Rewrite the existing "allows a cross-tenant trigger when the actor carries `subscription:read_all`" case (`spec.ts:150-189`) into **"REJECTS a cross-tenant trigger EVEN WITH `subscription:read_all`"** — asserts `ForbiddenError`, and `materialize`/`emit` NOT called | **FAILS (red)** — current code allows it | **PASSES (green)** |
| **(a)** | Existing "same-tenant happy path … without requiring `subscription:read_all`" (`spec.ts:192-211`) | passes | **still passes** — merchant same-tenant unbroken |
| guard | Existing "rejects cross-tenant when actor lacks `read_all`" (`spec.ts:139-148`) | passes | **still passes** |
| guard | Existing "lacks `subscription:update`" (`spec.ts:115`) | passes | **still passes** |
| **(c)** | Full suite run of `task-materialization`, `subscriptions`, `subscription-exceptions`, and the cron route tests | green | **green** — none route through the changed gate (see §1 table) |

**Sequence:** write the (b) RED test → watch it fail → apply the §2 gate change → (b) goes green, (a) + guards stay green → run the (c) suites for the no-regression proof. Net test delta: one assertion flips from "allow" to "forbid"; everything else is unchanged.

---

## 4. Blast radius

- **`triggerMaterializationAction` (`_actions.ts`) becomes dead.** Its only behaviour is cross-tenant (Transcorp acting on a merchant's subscription); post-closure every invocation returns `kind:"forbidden"`. It **should be removed.** Recommended (D2·A): removed alongside #653's button removal, since `_actions.ts`, `MaterializeButton.tsx`, and the `page.tsx` button are one UI surface.
- **`MaterializeButton.tsx` becomes dead** for the same reason; remove with the action.
- **Why button-removal alone is insufficient (the load-bearing reason this lane exists):** `triggerMaterializationAction` is a Next.js **server action** — a callable POST endpoint. Removing the rendered button (#653) hides the UI but leaves the action endpoint reachable by a crafted request. **Only the §2 gate change makes the capability unreachable** regardless of UI. This is defense-in-depth and is the actual closure.
- **No other surface reaches the capability.** Confirmed: the only importers are `_actions.ts` (→ the function) and `MaterializeButton.tsx` (→ the action). The admin detail page `(/admin/subscriptions/[id])` has no button. No merchant page is affected.
- **UI behaviour if the button is NOT yet removed when the gate lands:** the button renders an inline "You don't have permission to materialize this subscription." (`_actions.ts:48`, surfaced in `MaterializeButton.tsx:63`). No crash.

---

## 5. DB / migration call-out

**NONE.** The change is one boolean condition in application code (`service.ts:533`) plus a doc comment and one test assertion. **Zero schema changes, zero migrations, zero DB writes, no Vault, no RLS touch.** Nothing in this lane touches the live database, so Floor 1 does not engage. (If review somehow surfaces a migration need, it would park under Floor 1 for your named DB authorization — not expected.)

---

## 6. Build checklist (for the later, post-clear dispatch — not done now)

1. Branch off current `main`; RED-first: flip the `spec.ts:150` case to assert `ForbiddenError`; run → red.
2. Apply the §2 gate change at `service.ts:533`; update the JSDoc (`:492-498`).
3. Run the four suites in §3 step (c); all green.
4. (If D2·A) leave `_actions.ts`/`MaterializeButton.tsx` removal to #653; (if D2·B) remove them here.
5. Round-0 self-review against the reviewer checklist → independent reviewer → open PR. No promote; rollback anchor untouched.
