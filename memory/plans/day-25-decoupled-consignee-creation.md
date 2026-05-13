# Day-25 plan-PR — Decoupled consignee creation + ad-hoc task

**Tier:** T3 (touches service layer + audit events + new SQL paths + RBAC)
**Brief:** v1.12 (`memory/PLANNER_PRODUCT_BRIEF.md` at main `f422aef`)
**Decision memo:** `memory/decision_brief_v1_12_amendment_decouple_and_edit_merchant.md`
**Filed:** Day-25 (13 May 2026)
**Reviewer mode:** §3.6 hard-stop-twice — this is the FIRST hard-stop (plan-PR). Code-PR is the SECOND.

---

## §0. Wizard removal audit

Critical-path enumeration. If any item is missed, the code-PR will leave orphan imports or dead routes.

### §0.1 `createConsigneeWithSubscription` removal surface

| File | Line | Role |
|---|---|---|
| `src/modules/consignees/onboarding.ts` | 154–360 | Function definition (the orchestration itself) |
| `src/modules/consignees/index.ts` | 34–38 | Re-exports `CreateConsigneeWithSubscriptionInput`, `CreateConsigneeWithSubscriptionResult`, `createConsigneeWithSubscription` |
| `src/app/(app)/consignees/new/_actions.ts` | 24, 60 | Imports + sole production caller (`onboardConsigneeAction`) |
| `src/modules/consignees/tests/onboarding.spec.ts` | (full file, 17 `it()` cases) | Unit tests scoped to the orchestration |

No other call sites in `src/`, `tests/`, or `scripts/`. Confirmed via `grep -rn createConsigneeWithSubscription`.

### §0.2 Wizard route tree (entire `/consignees/new` directory)

```
src/app/(app)/consignees/new/
├── page.tsx                                    # server shell, permission preflight
├── _actions.ts                                 # onboardConsigneeAction server action
├── _helpers.ts                                 # parseOnboardForm + validateStep
├── _components/
│   └── OnboardConsigneeWizard.tsx              # 3-step client component (currentStep|1|2|3 state model)
└── tests/
    └── helpers.spec.ts                         # parseOnboardForm + validateStep unit tests
```

All five files replaced in-place. The `/consignees/new` route URL is preserved; only the contents change.

### §0.3 Internal links to wizard / nav references

| File | Reference | Action |
|---|---|---|
| `src/app/(app)/nav-config.ts` | nav entry `path: "/consignees/new"` | No change (URL preserved) |
| `src/app/(app)/consignees/page.tsx` ~line 88 | "Onboard" button `href="/consignees/new"` | No change |
| `OnboardConsigneeWizard.tsx` line 76 | success redirect `→ /consignees/${id}?created=1` | Replaced — flat form keeps the same redirect shape (`?created=1` triggers the existing Toast pattern per PR #248) |

No deep links to wizard sub-steps exist (wizard uses `hidden` fieldset toggles, not URL segments).

### §0.4 Seed scripts — no impact

`scripts/seed-subscriptions.mjs`, `scripts/demo-preflight.mjs`, `scripts/onboard-merchant.mjs`, `scripts/teardown-merchant.mjs`, `scripts/seed-demo-personas.mjs` — all bypass the service layer with direct SQL INSERTs. Wizard removal is invisible to seed paths.

### §0.5 Existing `createConsignee` — load-bearing API caller

`src/modules/consignees/service.ts:145–181` exports the existing `createConsignee(ctx, input)` (consignee-row-only, writes legacy inline `address_line` / `district` / `emirate_or_region` columns on `consignees` table; does NOT write an `addresses` row).

Callers:
- `src/app/api/consignees/route.ts:64` — POST `/api/consignees` (production REST endpoint)
- `src/modules/consignees/tests/service.spec.ts` — 5 `it()` cases at lines 159, 162, 176, 189, 203, 227, 244

Brief v1.12 §3.1.4 names the new service `createConsignee(ctx, { identity, address })` — same name, different signature, ALSO writes the `addresses` row. Two paths:

- **Path A (recommended):** Replace existing `createConsignee` signature. Update the REST POST route + the 5 unit-test cases to match. Single function, brief-canonical name.
- **Path B:** Add new `createConsigneeWithAddress` alongside existing `createConsignee`. Brief naming drift.

→ See §9 OQ-1 for verdict.

---

## §1. Scope boundaries

### §1.1 In scope

- New `createConsignee(ctx, { identity, address })` service (replaces wizard orchestration; writes consignees row + primary addresses row + emits `consignee.created`)
- New `createAdHocTask(ctx, consigneeId, params)` service (thin wrapper around existing `createTask`, post-commit enqueues SF push via `enqueueTaskPushBatch`)
- Flat `/consignees/new` form (identity + address sections, single submit)
- `/consignees/[id]` Overview-tab empty state (CTAs: Create subscription, Add ad-hoc task)
- Ad-hoc task creation modal (mirrors `MerchantStatusModal` pattern — custom modal, not Radix Dialog)
- `/consignees` list amber NO TASKS badge

### §1.2 Out of scope

- Edit consignee surface (Phase 1.5)
- Bulk consignee operations
- Hard-delete consignee (Phase 1.5)
- Wizard sub-route deletion (no sub-routes exist — `/consignees/new` is the only path)
- Phase 2 deferrals already filed (alternative phone, address rotation, blackout date editor)

### §1.3 Brief-amendment dependencies

None. Brief v1.12 is on main at `f422aef`; this plan-PR implements that amendment. No further brief amendment expected during this lane.

---

## §2. Service layer

### §2.1 `createConsignee` — replace existing

**File:** `src/modules/consignees/service.ts` (in place — keep export name)

**New signature:**
```typescript
export async function createConsignee(
  ctx: RequestContext,
  input: CreateConsigneeInput,
): Promise<{ consignee_id: Uuid }>

export interface CreateConsigneeInput {
  identity: {
    name: string;                       // required, normalised
    phone: string;                      // required, E.164 via normaliseToE164
    email?: string;
    deliveryNotes?: string;
    externalRef?: string;
    notesInternal?: string;
  };
  address: {
    label: "home" | "office" | "other"; // required
    line: string;                       // required
    district: string;                   // required
    emirate: string;                    // required
  };
}
```

**Behavior in single `withTenant` transaction:**

1. Permission gate: `requirePermission(ctx, "consignee:create")`. Throws `ForbiddenError` if denied.
2. Tenant context: `assertTenantScoped(ctx, "consignee:create")`.
3. Validate identity: phone via `normaliseToE164`, name non-empty.
4. Validate address: label in enum, line/district/emirate non-empty.
5. `INSERT INTO consignees (...)` — populates inline legacy columns (`address_line`/`district`/`emirate_or_region`) from `input.address.*`. Returns `consignee_id`.
6. `INSERT INTO addresses (consignee_id, tenant_id, label, is_primary=true, line, district, emirate)`.
7. Both inserts in same `tx`.

**Post-commit (outside tx):**

- Emit `consignee.created` event. Metadata: `{ consignee_id, source: "planner", onboarded_via: "flat_form" }` (replaces the old `"wizard"` value — useful for analytics retros).
- Return `{ consignee_id }`.

**Removed:** existing `createConsigneeWithSubscription` at `src/modules/consignees/onboarding.ts`. Whole file body replaced; helpers (`computeTargetDateInDubai`, validation utilities) extracted to a separate helpers module if multiply-consumed, otherwise inlined.

### §2.2 `createAdHocTask` — new wrapper

**File:** `src/modules/tasks/service.ts` (alongside existing `createTask`, `bulkCreateTasks`)

**Signature:**
```typescript
export async function createAdHocTask(
  ctx: RequestContext,
  consigneeId: Uuid,
  params: {
    date: string;                       // YYYY-MM-DD
    windowStart: string;                // HH:MM:SS
    windowEnd: string;                  // HH:MM:SS, ≥30min after windowStart
    addressId?: Uuid;                   // defaults to consignee's primary address
    notes?: string;
  },
): Promise<{ task_id: Uuid }>
```

**Behavior:**

1. Permission gate via `requirePermission(ctx, "task:create")` (the existing permission registered Day-19 per `decision_task_module_amendment_v1.md`).
2. Resolve `addressId`: if null, `SELECT id FROM addresses WHERE consignee_id = ? AND is_primary = true LIMIT 1` (single-statement; no CTE — ad-hoc has no subscription/rotation/exception chain). If provided, validate it belongs to the same consignee.
3. Validate window: ≥30 minutes gap; date is not historical.
4. Delegate to existing `createTask`:
   ```typescript
   const task = await createTask(ctx, {
     consigneeId,
     subscriptionId: null,                   // ad-hoc invariant
     createdVia: "manual_admin",             // matches Day-19 task amendment + CHECK constraint
     deliveryDate: params.date,
     deliveryStartTime: params.windowStart,
     deliveryEndTime: params.windowEnd,
     addressId,
     notes: params.notes,
     // customerOrderNumber auto-generated inside validateCreateTaskInput
   });
   ```
   The existing `createTask` already emits `task.created`. No new audit event registration needed.
5. **Post-commit (outside tx)** enqueue to QStash via `enqueueTaskPushBatch`:
   ```typescript
   try {
     await enqueueTaskPushBatch({
       tenantId: ctx.tenantId,
       taskIds: [task.id],
       requestId: ctx.requestId,
     });
   } catch (err) {
     console.error("[createAdHocTask] enqueue failed:", err);
     // Intentionally swallow per Phase-5 self-healing posture.
     // Cron reconciliation re-discovers via pushed_to_external_at IS NULL.
   }
   ```
6. Return `{ task_id: task.id }`.

**Schema invariants relied upon:**
- `tasks.subscription_id` is nullable (per migration 0006).
- `tasks_creation_source_invariant` CHECK enforces `created_via='manual_admin' ⇒ subscription_id IS NULL`.
- `tasks.address_id` exists as FK to `addresses` (migration 0014).
- `tasks.internal_status` defaults to `'CREATED'` per migration 0006 (the brief's `'SCHEDULED'` reference in the user prompt is incorrect against schema — see §9 OQ-3).

**No migration needed.** All schema is in place.

### §2.3 Existing `createConsigneeWithSubscription` removal

- Delete the function body in `src/modules/consignees/onboarding.ts`.
- Delete the type exports (`CreateConsigneeWithSubscriptionInput`, `CreateConsigneeWithSubscriptionResult`) from `src/modules/consignees/index.ts`.
- Delete the 17 unit-test cases in `src/modules/consignees/tests/onboarding.spec.ts` (whole file removed; the new `createConsignee` gets its own unit-test file alongside `service.spec.ts`).
- Delete the wizard server action's import + invocation in `src/app/(app)/consignees/new/_actions.ts`.

The orchestration's value (atomic transaction across consignee + address + subscription) is no longer needed because subscription creation moves to its own surface (Overview-tab CTA → `/subscriptions/new?consigneeId=`), where the existing `createSubscription` already opens its own `withTenant` tx and materialises the 14-day horizon.

---

## §3. UI changes

### §3.1 Flat consignee form

**Route:** `/consignees/new` (URL preserved; component contents replaced).

**Files:**
- `src/app/(app)/consignees/new/page.tsx` — server component shell. Permission preflight: `requirePermission(ctx, "consignee:create")`. Renders the new client form.
- `src/app/(app)/consignees/new/_actions.ts` — server action `createConsigneeAction(formData)`. Parses + validates with Zod, calls `createConsignee(ctx, parsedInput)`. Returns discriminated union `{ ok: true, consigneeId } | { ok: false, fieldErrors }`.
- `src/app/(app)/consignees/new/_components/CreateConsigneeForm.tsx` — client component using `useActionState`. Two sections: Identity + Address. Single submit button labelled `CREATE CONSIGNEE` (all-caps per brand canon, matches `CREATE MERCHANT`).

**Visual structure (mirrors `/admin/merchants/new`):**

```
<form action={formAction}>
  <FormErrorBanner result={actionResult} />

  <section class="form-section">
    <h2>Identity</h2>
    <Field label="Full name" name="name" required />
    <Field label="Primary phone" name="phone" required helpText="E.164 format (auto-converts UAE local)" />
    <Field label="Email" name="email" type="email" optional />
    <Field label="Delivery notes" name="delivery_notes" optional multiline />
    <Field label="Merchant internal reference" name="external_ref" optional />
    <Field label="Internal notes" name="notes_internal" optional multiline />
  </section>

  <section class="form-section">
    <h2>Delivery address</h2>
    <Select label="Address label" name="address_label" options={["Home","Office","Other"]} required />
    <Field label="Address line" name="address_line" required />
    <Field label="District" name="address_district" required />
    <Field label="Emirate" name="address_emirate" required />
  </section>

  <SubmitButton>CREATE CONSIGNEE</SubmitButton>
</form>
```

Section headers use Display S / hairline divider underneath (consistent with merchant-new pattern; brand-tokens.css supplies the divider color `--color-stone-200`).

**Success:** Redirect to `/consignees/[consigneeId]?created=1`. The existing `Toast` component at `src/components/Toast.tsx` renders the "Consignee created" toast via the `?created=1` query param convention (PR #248 pattern).

**Validation:** Server-side via Zod schema; field-level errors threaded through `useActionState` result.

### §3.2 Consignee detail Overview-tab empty state

**File modified:** `src/app/(app)/consignees/[id]/page.tsx` (or wherever the Overview tab renders).

**Empty-state detection:** Server-side check — `subscriptionCount === 0 && taskCount === 0`. Both counts computed via single `SELECT` per the existing repository pattern. If empty, render the empty-state component; otherwise render the existing header/calendar/header card.

**Empty-state component:** `src/app/(app)/consignees/[id]/_components/OverviewEmptyState.tsx` (new):

```
- Identity block (name, phone, email)
- Primary address block (line / district / emirate / label)
- CRM state badge (defaults to ACTIVE — read from consignees.crm_state)

[ CREATE SUBSCRIPTION ]   [ ADD AD-HOC TASK ]
   ↳ link → /subscriptions/new?consigneeId=[id]
   ↳ opens AdHocTaskDialog (see §3.3)
```

Subscription / Calendar / History tabs render their existing natural empty states; tabs not hidden.

Once a subscription or ad-hoc task lands (i.e., `taskCount > 0 || subscriptionCount > 0`), the standard header card replaces the empty state on next render.

### §3.3 Ad-hoc task creation modal

**File:** `src/app/(app)/consignees/[id]/_components/AdHocTaskDialog.tsx` (new client component).

**Pattern:** Mirror `MerchantStatusModal` (`src/app/(admin)/admin/merchants/_components/MerchantStatusModal.tsx`) exactly:
- Custom modal (NOT Radix Dialog — codebase convention is hand-rolled with `useRef` + click-outside `mousedown` listener + Escape `keydown` listener + focus-return on close).
- Trigger: ADD AD-HOC TASK button. Panel state: `open` (boolean) + `formKey` (counter for form reset on re-open).
- Form bound via `useActionState` to the new `createAdHocTaskAction` server action.
- Success effect: `useEffect` watching `actionResult.kind === "created"` triggers (a) toast "Saved — pushing to SuiteFleet" via the existing toast pattern, (b) modal close, (c) consignee detail refresh.

**Fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| Date | `<input type="date">` | yes | Must be ≥ today; client-validates |
| Window start | `<input type="time">` | yes | HH:MM |
| Window end | `<input type="time">` | yes | ≥30 min after start; client-validates |
| Address override | `<select>` | no | Dropdown of consignee addresses (primary pre-selected); defaults to primary if none chosen |
| Notes | `<textarea>` | no | max 500 chars |

**Server action:** `src/app/(app)/consignees/[id]/_actions.ts` — `createAdHocTaskAction(consigneeId, formData)`. Parses with Zod (windowEnd > windowStart + 30min cross-field), calls `createAdHocTask(ctx, consigneeId, params)`. Returns `{ ok: true, taskId } | { ok: false, fieldErrors }`.

**Toast string:** "Saved — pushing to SuiteFleet" — matches optimistic-ack copy convention (the SF push is async; user-visible state is the durable DB row).

### §3.4 `/consignees` list NO TASKS badge

**File modified:**
- `src/modules/consignees/repository.ts` — extend the `listConsignees` query to return `taskCount` per row. Cheapest addition: LEFT JOIN tasks with COUNT, grouped by consignee.id:

```sql
SELECT
  c.*,
  COALESCE(COUNT(t.id), 0) AS task_count
FROM consignees c
LEFT JOIN tasks t ON t.consignee_id = c.id
WHERE c.tenant_id = $1
  AND ($2::text IS NULL OR /* existing searchTerm predicates */)
GROUP BY c.id
ORDER BY c.created_at DESC
LIMIT $3 OFFSET $4
```

- `src/app/(app)/consignees/page.tsx` — pass `taskCount` through to the list row component.
- `src/app/(app)/consignees/_components/ConsigneeRow.tsx` (or equivalent — find current row component file path during implementation; not enumerated in audit but presumed under `consignees/_components/`) — render amber `NO TASKS` pill when `taskCount === 0`.

**Styling:** Amber pill using existing tokens.
```css
.no-tasks-badge {
  background: var(--color-amber-300);    /* #F1BF6B — soft hi-vis */
  color: var(--color-amber-deep);        /* #8E5A14 — amber-on-light text */
  /* Mulish caps + letter-spacing per eyebrow type-scale token */
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  /* dimensions per existing badge convention */
}
```

**Performance:** LEFT JOIN + GROUP BY on a tenant-scoped table set (consignees: ~845 rows at demo seed; tasks: ~7K-12K rows). Query cost is bounded by the consignee index and the existing `tasks.consignee_id` FK (which has an index). Manageable. If page-load latency regresses (>50ms over baseline), Phase 2 optimization is a denormalized `consignees.task_count` column updated via trigger.

**Edge cases:**
- Consignee with only CANCELED tasks → `task_count > 0`, flag absent (correct per brief: "any internal_status" counts).
- Consignee with only ad-hoc tasks → `task_count > 0`, flag absent (correct).
- Consignee with one materialised subscription task → `task_count > 0`, flag absent (correct).

---

## §4. Integration specs (Day-23 §F discipline — new SQL paths)

Three new integration specs, each pinning a new SQL path. Follow the `tests/integration/calendar-day-view.spec.ts` pattern: `withServiceRole` for setup + test queries; `sqlTag` for DDL fixtures; direct service-function invocation for assertions.

### §4.1 `tests/integration/consignees-create.spec.ts`

Pins `createConsignee` against a real database.

- Atomicity: both consignees + addresses rows present on success.
- Audit event `consignee.created` emitted post-commit with correct metadata.
- Tenant isolation: cross-tenant fetch returns empty.
- Validation rollback: malformed phone → ValidationError, neither row written.
- `is_primary=true` UNIQUE partial index respected (migration 0014).

### §4.2 `tests/integration/tasks-create-ad-hoc.spec.ts`

Pins `createAdHocTask` against a real database.

- Task row inserted with `subscription_id IS NULL`, `created_via='manual_admin'`, `internal_status='CREATED'`.
- `address_id` defaults to consignee's primary address when omitted.
- Provided `address_id` from a different consignee → ValidationError, no insert.
- Provided `address_id` from same consignee → task linked to that address.
- Window <30min apart → ValidationError.
- `task.created` event emitted.
- QStash enqueue mock asserted called once with `{ tenantId, taskIds: [task.id], requestId }`.

### §4.3 `tests/integration/consignees-list-no-tasks-flag.spec.ts`

Pins the NO TASKS flag computation against a real database.

- Consignee with zero tasks → `task_count === 0`.
- Consignee with one materialised subscription task → `task_count === 1`.
- Consignee with one ad-hoc task → `task_count === 1`.
- Consignee with mixed (ad-hoc + materialised) → correct sum.
- Cross-tenant pollution: tasks in another tenant's consignee don't bleed (RLS guard).

---

## §5. Unit tests

### §5.1 `src/modules/consignees/tests/service.spec.ts` — extend existing file

Replace the existing 5 `createConsignee` test cases with the new signature. Add cases for:
- Permission denial (no `consignee:create` perm).
- Missing tenant context.
- Validation: each required field independently.
- Address `is_primary=true` set automatically.
- Audit emit shape (mock `auditEmit`, assert call).

### §5.2 `src/modules/tasks/tests/service.spec.ts` — extend existing file

Add `createAdHocTask` cases:
- Permission denial.
- Address default-to-primary path (mock `tx.execute` for the primary-address SELECT).
- Address override validation (FK check via simulated 23503).
- Window cross-field validation (≥30 min).
- Wraps `createTask` correctly (assert delegation + `subscription_id: null` + `createdVia: 'manual_admin'`).
- QStash enqueue post-commit (mock `enqueueTaskPushBatch`).
- Enqueue failure does NOT throw (post-commit swallow per Phase-5 self-healing).

### §5.3 `src/app/(app)/consignees/new/tests/parse.spec.ts` — replace existing helpers.spec.ts

Form Zod schema unit tests:
- Required field presence.
- Phone E.164 normalisation via `normaliseToE164`.
- Address label enum validation.
- Server-action result shape.

### §5.4 `src/app/(app)/consignees/[id]/tests/ad-hoc-dialog.spec.ts` — new

Modal client-side tests (limited — most rigour lives in the integration spec and the parse spec):
- Window-end < window-start client-validation.
- Address override defaults to primary on dialog open.

### §5.5 Removed test files

- `src/modules/consignees/tests/onboarding.spec.ts` — deleted (17 cases).
- `src/app/(app)/consignees/new/tests/helpers.spec.ts` — replaced by §5.3.

---

## §6. Permissions / RBAC

No new permission registrations. Existing:
- `consignee:create` (existing) — gates `createConsignee`.
- `task:create` (existing, Day-19) — gates `createAdHocTask`.
- `subscription:create` (existing) — gates the Overview-tab "Create subscription" CTA target route.

No change to role mappings.

---

## §7. Audit event registrations

No new event types needed:
- `consignee.created` — already at `src/modules/audit/event-types.ts:286`. Reused.
- `task.created` — already at `src/modules/audit/event-types.ts:397`. Reused by `createAdHocTask` via the delegated `createTask` emit.

Metadata refinement (non-breaking): `onboarded_via` value changes from `"wizard"` to `"flat_form"` for `consignee.created`. Audit-query consumers downstream are unaffected (the existing analytics retros key on `event_type`, not metadata values).

---

## §8. Files touched

### §8.1 Added

```
src/app/(app)/consignees/new/_components/CreateConsigneeForm.tsx
src/app/(app)/consignees/[id]/_components/OverviewEmptyState.tsx
src/app/(app)/consignees/[id]/_components/AdHocTaskDialog.tsx
tests/integration/consignees-create.spec.ts
tests/integration/tasks-create-ad-hoc.spec.ts
tests/integration/consignees-list-no-tasks-flag.spec.ts
src/app/(app)/consignees/new/tests/parse.spec.ts
src/app/(app)/consignees/[id]/tests/ad-hoc-dialog.spec.ts
```

### §8.2 Modified

```
src/modules/consignees/service.ts                 # createConsignee signature rewrite + address insert
src/modules/consignees/repository.ts              # listConsignees: + task_count column
src/modules/consignees/index.ts                   # remove createConsigneeWithSubscription exports
src/modules/tasks/service.ts                      # + createAdHocTask
src/modules/tasks/index.ts                        # + createAdHocTask export (if module has an index)
src/app/(app)/consignees/page.tsx                 # thread task_count through; render NO TASKS badge
src/app/(app)/consignees/_components/<row>.tsx    # NO TASKS pill rendering (exact filename TBD during impl)
src/app/(app)/consignees/new/page.tsx             # render new flat form
src/app/(app)/consignees/new/_actions.ts          # call createConsignee (new signature)
src/app/(app)/consignees/[id]/page.tsx            # empty-state branch in Overview tab
src/app/(app)/consignees/[id]/_actions.ts         # + createAdHocTaskAction
src/api/consignees/route.ts                       # accept address fields per new createConsignee signature
src/modules/consignees/tests/service.spec.ts      # update 5 createConsignee cases
src/modules/tasks/tests/service.spec.ts           # + createAdHocTask cases
```

### §8.3 Deleted

```
src/modules/consignees/onboarding.ts              # createConsigneeWithSubscription orchestration
src/modules/consignees/tests/onboarding.spec.ts   # 17 wizard tests
src/app/(app)/consignees/new/_helpers.ts          # wizard validation helpers
src/app/(app)/consignees/new/_components/OnboardConsigneeWizard.tsx
src/app/(app)/consignees/new/tests/helpers.spec.ts
```

### §8.4 Net diff estimate

~+650 lines / ~−750 lines. Net subtractive — codebase simpler post-merge.

---

## §9. Open questions for §3.6 verdict

| # | Question | Recommendation |
|---|---|---|
| OQ-1 | Existing `createConsignee` in `service.ts:145` writes consignee-only (no addresses row). Brief v1.12 specifies `createConsignee({ identity, address })`. Replace or alongside? | **Replace.** Brief naming canon wins. Update REST `/api/consignees` POST handler + 5 unit tests to match. |
| OQ-2 | `createAdHocTask` location: new file `src/modules/tasks/ad-hoc.ts` or alongside `createTask` in `service.ts`? | **Alongside in service.ts.** Wraps `createTask` directly; co-location matches Day-19 task-amendment pattern (single service.ts file for the task module). |
| OQ-3 | User-prompt §2 says `internal_status='SCHEDULED'`; schema CHECK constraint at `0006_task.sql` line 38 only allows {CREATED, ASSIGNED, IN_TRANSIT, DELIVERED, FAILED, CANCELED, ON_HOLD}. | **Use `'CREATED'`.** Schema canon wins. Materialised subscription tasks also default to `'CREATED'`; ad-hoc tasks should match for consistency. |
| OQ-4 | Existing `createTask` does NOT enqueue QStash. `createAdHocTask` adds the enqueue. Does `createTask` itself need enqueue for parity? | **No — out of scope.** `createTask` callers today (Day-19 amendment scope) don't need optimistic-ack semantics; ad-hoc is the first true user-facing one-off path. If parity becomes desirable, file as follow-up. |
| OQ-5 | NO TASKS badge SQL: LEFT JOIN + GROUP BY vs subquery? | **LEFT JOIN + GROUP BY.** Cheaper at scale; the existing `tasks.consignee_id` FK already has an index per migration 0006. |
| OQ-6 | Overview-tab `subscription:create` link target — does `/subscriptions/new?consigneeId=` exist? | **Yes** — confirmed at `src/app/(app)/subscriptions/new/page.tsx` (server agent §17). Accepts `?consigneeId=` pre-select. No new route needed. |
| OQ-7 | Existing 17 wizard tests — delete in code-PR or pre-delete in plan-PR ride-along? | **Delete in code-PR.** Plan-PR carries the markdown only; no test deletion until the replacement code lands. |
| OQ-8 | `consignee.created` metadata change (`onboarded_via: "wizard"` → `"flat_form"`) — backward-compat concern for audit-query consumers? | **None.** No production query keys on the metadata value; only on `event_type`. Document the change in code-PR commit message for retrospection. |
| OQ-9 | `customer_order_number` for ad-hoc task — auto-generated by `validateCreateTaskInput` or operator-supplied? | **Auto-generated.** Match existing materialised-task pattern; ad-hoc operator dialog doesn't ask for it. Confirm during code-PR by tracing `validateCreateTaskInput`. |
| OQ-10 | Modal pattern — Radix Dialog or hand-rolled? | **Hand-rolled** per codebase convention (`MerchantStatusModal` precedent). No Radix Dialog imported elsewhere in `src/`. |

---

## §10. Sequencing

1. **Plan-PR opens** (this doc). First §3.6 hard-stop. ← we are here.
2. Reviewer renders §3.6 verdicts for OQ-1 through OQ-10.
3. Plan-PR fix-ups (if any) applied. Plan-PR awaits Love's merge.
4. **Code-PR opens off plan branch** (so the code-PR diff is purely code, plan diff in parent). Second §3.6 hard-stop.
5. Reviewer counter-review on code; fix-ups applied.
6. Both PRs await Love's merge gate. NO SELF-MERGE.

---

## §11. Pre-merge gate checklist (for code-PR)

To be ticked at code-PR open, not at plan-PR open. Listed here for forward visibility:

- [ ] All 3 integration specs green against production-shaped DB
- [ ] All extended unit tests green (vitest)
- [ ] Wizard deletion verified — `grep -rn createConsigneeWithSubscription src/ tests/` returns 0 hits
- [ ] `/consignees/new` rendered manually in Preview deployment
- [ ] Ad-hoc task dialog manually validated against demo seed (Fatima)
- [ ] NO TASKS badge manually validated on a freshly-onboarded consignee
- [ ] PR description references brief §3.1.4 + §3.3 + §5.1 verbatim
- [ ] §3.6 round-1 verdicts (plan-PR) referenced in PR description
- [ ] §3.6 round-2 reviewer counter-review surface logged inline

---

End of plan.
