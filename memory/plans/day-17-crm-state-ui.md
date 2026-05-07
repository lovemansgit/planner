# Day-17 plan — CRM state change UI

**Status:** Drafting (T1 plan PR; T2 hard-stop fires at implementation-PR open).
**Tier:** T1 (plan PR; merge after CI green per branch-protection path-exemption from PR #158).
**Sequencing:** Drafted Day-17 morning after PR #162 (Day-16 14-item plan-sync backfill) merged at `c31b4fb`. Day-17 substantive #1 of brief §6 day-by-day plan slot.
**Owns:** UI surface for consignee CRM state transitions per brief §3.3.2 + brief §3.1.4 + plan PR #155 (`0d1ce21`) §10.4 matrix lock.

**This plan does NOT include implementation.** It is the design. Implementation lands as a separate T2 code PR drafted in a future session AFTER this plan merges.

---

## §1 Purpose + brief lineage

### §1.1 What this plan is

UI surface design for the CRM state change workflow. Composes against the **already-shipped** service contract (`changeConsigneeCrmState` at `src/modules/consignees/service.ts:408-505`, landed via PR #160 commit `ffc9943`). No new service surfaces for the mutation path; one net-new read-side service fn (`getConsigneeCrmHistory`) for the history tab.

The headline UI surfaces:

- **§3.0** — `/consignees/[id]` detail page scaffolding (PREREQUISITE — does not currently exist; built in this plan's implementation PR per Drift #1 Option A ruling)
- **§3.1** — CRM state badge column on `/consignees` list
- **§3.2** — Transition workflow modal on `/consignees/[id]` header
- **§3.3** — Transition history surface in History tab on `/consignees/[id]`

### §1.2 Brief lineage

- Brief §2.2 workflow 6: "Maintain consignee CRM state — transition consignees between states"
- Brief §3.1.1 — six-state machine (ACTIVE / ON_HOLD / HIGH_RISK / INACTIVE / CHURNED / SUBSCRIPTION_ENDED) + `consignees.crm_state` column + `consignee_crm_events` table
- Brief §3.1.2 — `consignee.crm_state.changed` audit event
- Brief §3.1.3 — `consignee:change_crm_state` permission
- Brief §3.1.4 — `changeConsigneeCrmState` service signature (already shipped per part-2 service-layer landing)
- Brief §3.3.2 — consignee list view: CRM state badge column, color-coded per state
- Brief §3.3.3 — consignee detail page with calendar (full surface; this plan ships scaffolding + Overview + History tabs, defers Subscription + Calendar to later Day-17/Day-18 PRs)
- Brief §3.3.7 — consignee timeline view (integration point with Day-17 substantive #2 — this plan's history tab reads ONLY `consignee_crm_events`; the broader timeline surface aggregates additional event sources)
- Brief §3.3.10 — UI permission rendering rules (hide / disable / never silently fail)
- Brief §3.3.11 — brand pass (Transcorp design tokens; defer pixel-level treatment to implementation PR with frontend-design skill activation)
- Brief §8.5 — visual treatment per CRM state (High Risk red-tinted, On Hold greyed, Active default)
- Plan PR #155 (`0d1ce21`) §10.4 — locked transitions matrix (CHURNED → ACTIVE keyword-required; INACTIVE → ACTIVE permission-only; SUBSCRIPTION_ENDED terminal; "from any" → INACTIVE / SUBSCRIPTION_ENDED always allowed)

### §1.3 Day-17 checklist position

Per Day-16 EOD §5 Day-17 plan, this is item 5 (CRM state change UI). Items 4 (per-task delivery status timeline) and 6 (address change workflows from popover) plus item 5 (consignee timeline view) all consume the `/consignees/[id]` detail page scaffolding shipped here. **Building the scaffolding once in this plan's implementation PR unblocks the rest of Day-17.**

### §1.4 Drift surfacing record (Day-17 morning, pre-draft)

Two material drifts surfaced before plan drafting; both reviewer-ruled and locked here.

- **Drift #1 — `/consignees/[id]` detail page does not exist.** Per Day-17 morning research turn: `src/app/(app)/consignees/page.tsx:19-20` comment explicitly states "Edit / create / delete UI is intentionally absent — those land Day 4 or later." No detail page route shipped to date. **Locked: Option A — build the detail page scaffolding (header card + tab structure + Overview + History) as a prerequisite within THIS plan's implementation PR.** Rationale: Day-17 items 4 + 5 + 6 all presume the detail page; building it once unblocks the rest of Day-17.
- **Drift #2 — TanStack Query not in the codebase.** Per Day-17 morning research turn: established pattern is server components calling service-layer fns directly (`buildRequestContext` → `withTenant` → service fn). Mutations would be net-new client-side data-layer surface. **Locked: Option B — server actions + `revalidatePath` for mutations; server components for reads.** Rationale: established convention; net-new TanStack adoption with 4 days to demo is wrong-time architectural migration.

Both drifts re-surfaced as locked decisions in §10 open questions for explicit plan-PR reviewer acknowledgment.

---

## §2 Service contract reference (verbatim from main HEAD `c31b4fb`)

### §2.1 Mutation surface — `changeConsigneeCrmState`

**Service:** `src/modules/consignees/service.ts:408-505`

```typescript
export async function changeConsigneeCrmState(
  ctx: RequestContext,
  id: Uuid,
  input: ChangeConsigneeCrmStateInput,
): Promise<ChangeConsigneeCrmStateResult>;
```

**Input shape** (camelCase service):

```typescript
interface ChangeConsigneeCrmStateInput {
  toState: 'ACTIVE' | 'ON_HOLD' | 'HIGH_RISK' | 'INACTIVE' | 'CHURNED' | 'SUBSCRIPTION_ENDED';
  reason: string;  // required, non-empty (trimmed by service)
}
```

**Result shape** (discriminated by `status`):

```typescript
type ChangeConsigneeCrmStateResult =
  | { status: 'updated'; consigneeId: string; fromState: string; toState: string; eventId: string }
  | { status: 'no_op';   consigneeId: string; fromState: string; toState: string };
```

**Wire route:** `POST /api/consignees/[id]/crm-state` (`src/app/api/consignees/[id]/crm-state/route.ts` — Day-16 Block 4-F Commit 3).

**Wire body** (snake_case):

```json
{ "to_state": "<enum>", "reason": "<non-empty string>" }
```

**Wire-to-service mapping:** snake_case `to_state` → camelCase `toState` (per route.ts:106-109).

**Permission gate:** `consignee:change_crm_state` (asserted INSIDE the service via `requirePermission` at service.ts:413; route does NOT pre-gate per Block 4-F convention).

### §2.2 Error map (from route.ts header comment + service.ts try/throw paths)

| HTTP | AppError subclass | Surface trigger |
|---|---|---|
| 400 | `ValidationError` | input shape, empty reason, invalid enum, malformed JSON, no tenant context |
| 403 | `ForbiddenError` | actor lacks `consignee:change_crm_state` |
| 404 | `NotFoundError` | consignee not in tenant (RLS-hidden or genuinely missing) |
| 409 | `ConflictError` | `invalid_transition` OR `reactivation_keyword_required` (matrix violation per service.ts:436-446) |

### §2.3 Locked transitions matrix (verbatim from `src/modules/consignees/transitions.ts:55-64`)

**`ALLOWED_TRANSITIONS` constant (frozen):**

| From state | Allowed to-states |
|---|---|
| `ACTIVE` | `ON_HOLD`, `HIGH_RISK`, `CHURNED`, `INACTIVE`, `SUBSCRIPTION_ENDED` |
| `ON_HOLD` | `ACTIVE`, `HIGH_RISK`, `CHURNED`, `INACTIVE`, `SUBSCRIPTION_ENDED` |
| `HIGH_RISK` | `ACTIVE`, `ON_HOLD`, `CHURNED`, `INACTIVE`, `SUBSCRIPTION_ENDED` |
| `INACTIVE` | `ACTIVE`, `SUBSCRIPTION_ENDED` |
| `CHURNED` | `ACTIVE`, `INACTIVE`, `SUBSCRIPTION_ENDED` |
| `SUBSCRIPTION_ENDED` | (empty — terminal) |

**Same-state (`from === to`)** — NOT included in any from-state's allowed set. The service handles same-state as a `no_op` short-circuit (service.ts:431-433) BEFORE calling `canTransition`.

**`CHURNED → ACTIVE` keyword guard** — case-insensitive substring `reactivation` required in `reason` (transitions.ts:92-95 + service.ts:437-441).

### §2.4 Permission catalogue + role-holders (from `src/modules/identity/permissions.ts:514-521` + `src/modules/identity/roles.ts`)

`consignee:change_crm_state` is **non-systemOnly**. Held by:

- `tenant_admin` (via TENANT_SCOPED auto-pickup of all non-systemOnly perms)
- `operations_manager` (via `permsFor('consignee')` expansion)
- `customer_service_agent` (via explicit grant)

`consignee:read` held by all three (same role-mapping file). Used by §5's read-side service fn.

`consignee:change_crm_state` is **NOT** in `API_KEY_FORBIDDEN_PERMISSIONS` (verified at `src/modules/identity/permissions.ts:607-631`); API keys CAN be scoped with this permission. UI-side concern is none — the UI surfaces operate via session auth, not API keys.

---

## §3 UI surfaces

### §3.0 `/consignees/[id]` detail page scaffolding (PREREQUISITE)

**Net-new route:** `src/app/(app)/consignees/[id]/page.tsx`. Server component (per established pattern; matches `src/app/(app)/consignees/page.tsx:33-48`).

**Page structure:**

```
+---------------------------------------------------------------+
| Header card                                                    |
|   Name (h1)                            [ Change state ▾ ]     |
|   Phone · Email                                                |
|   CRM state badge (current state, color-coded per §3.1)        |
+---------------------------------------------------------------+
| Tabs:  [ Overview ] [ Subscription ] [ Calendar ] [ History ]  |
+---------------------------------------------------------------+
| Tab content                                                    |
+---------------------------------------------------------------+
```

**Tab inventory:**

| Tab | This plan ships | Defers to |
|---|---|---|
| Overview (default) | YES — contact info + subscription summary card + recent activity teaser | n/a |
| Subscription | NO — placeholder "Coming in Day-17 next PRs" | Day-17 substantive #2 or later |
| Calendar | NO — placeholder "Coming in Day-17 next PRs" | brief §3.3.3 calendar implementation (Day-17/18 scope) |
| History | YES — CRM state transition history per §3.3 | n/a |

**Permission gate:** `consignee:read` (all three operator roles hold).

**Brief design treatment reference:** §3.3.3 (header card + tab navigation pattern). Pixel-level treatment deferred to implementation PR (frontend-design skill activates per brief §7).

**"Change state" button placement:** top-right of header card (per the layout sketch above). Triggers the §3.2 modal. Hidden per brief §3.3.10 if actor lacks `consignee:change_crm_state`.

### §3.1 CRM state badge column on `/consignees` list

**Surface:** existing `src/app/(app)/consignees/page.tsx`. Add badge column.

**Column placement:** between **Emirate** (current column 3) and **Address** (current column 4) per the research finding. New order: Name → Phone → Emirate → **CRM State** → Address.

**Six visual treatments** per brief v1.4 §3.3.11 state-semantic color section. Tokens reference `src/styles/brand-tokens.css` (the implementation source of truth aligned with the brief). Pixel-level treatment (badge geometry, row-tint opacity, hover states) defers to implementation; frontend-design skill activates.

| State | Treatment per brief v1.4 §3.3.11 |
|---|---|
| `ACTIVE` | Grass Green (`var(--color-green)` = `#2E8B4A`) — go-signal semantics. Badge: green text on Snow White. Row: default styling. |
| `ON_HOLD` | Stone 600 (`var(--color-stone-600)` = `#4E4A42`) on Ivory (`var(--color-ivory)` = `#F2EEE6`). Badge: muted stone. Row: subtle ivory tint. |
| `HIGH_RISK` | Bright Red (`var(--color-red)` = `#D93A2B`). Badge: red text on Snow White. Row: subtle red tint at low opacity (~5%). |
| `INACTIVE` | Stone 600 muted. Badge + row: muted text, no row tint. |
| `CHURNED` | Stone 600 with strikethrough. Badge label: "Churned". Row: muted text, no row tint. |
| `SUBSCRIPTION_ENDED` | Stone 600 with "Ended" label. Badge: stone with terminal-state framing. Row: muted text, no row tint. |

**Row interaction:** clicking a row navigates to `/consignees/[id]`. Replaces current read-only-list-only behavior (per the comment removal in §3.0).

**Permission gate:** badge column visible to all who hold `consignee:read` (all three operator roles).

### §3.2 Transition workflow modal (on `/consignees/[id]` header)

**Trigger:** "Change state" button on header card per §3.0.

**Modal structure:**

```
+------------------------------------------+
| Change CRM state                       × |
+------------------------------------------+
| Current state:  [ ACTIVE ]               |
|                                          |
| New state:      [ Select ▾ ]             |
|                 (only allowed to-states  |
|                  per ALLOWED_TRANSITIONS  |
|                  [fromState] — client     |
|                  forgiveness; server      |
|                  authoritative)           |
|                                          |
| [Conditional] when from='CHURNED' AND    |
| to='ACTIVE':                             |
| ⚠ Reactivation required — include        |
|   "reactivation" in your reason.         |
|                                          |
| Reason:                                  |
| [_______________________________]        |
| [_______________________________]        |
| (required; min length 1)                 |
|                                          |
|                  [ Cancel ] [ Submit ]   |
+------------------------------------------+
```

**Submit gating:** disabled until target state selected AND reason non-empty (trimmed).

**Submit flow (server-action-based per Drift #2 Option B):**

```typescript
// src/app/(app)/consignees/[id]/_actions.ts (NEW)
'use server';

export async function changeCrmStateAction(
  consigneeId: string,
  formData: FormData,
): Promise<ChangeCrmStateActionResult>;

export type ChangeCrmStateActionResult =
  | { kind: 'updated';                       fromState: string; toState: string; eventId: string }
  | { kind: 'no_op';                         fromState: string; toState: string }
  | { kind: 'invalid_transition';            message: string }
  | { kind: 'reactivation_keyword_required'; message: string }
  | { kind: 'forbidden';                     message: string }
  | { kind: 'not_found';                     message: string }
  | { kind: 'validation';                    message: string };
```

**Action implementation:**
1. `buildRequestContext` (server-action context).
2. Parse `formData` → `{ toState, reason }`; on parse failure return `kind: 'validation'`.
3. Try/catch `changeConsigneeCrmState(ctx, consigneeId, { toState, reason })`.
4. Map service result → action result (`updated` / `no_op`).
5. Map caught AppError → typed action result kind:
   - `ConflictError` with message containing "reactivation" → `reactivation_keyword_required`
   - `ConflictError` otherwise → `invalid_transition`
   - `ForbiddenError` → `forbidden`
   - `NotFoundError` → `not_found`
   - `ValidationError` → `validation`
6. On `updated`: `revalidatePath('/consignees/[id]', 'page')` + `revalidatePath('/consignees', 'page')` (badge column update + header refresh).
7. On `no_op`: `revalidatePath` skipped (no state change).
8. Return typed result.

**Modal client component** (the form itself is `'use client'` for `useFormState`/`useActionState` interactivity):
- `useActionState(changeCrmStateAction.bind(null, consigneeId), { kind: 'idle' })` — React 19 server-action hook (verify exact name at implementation; React 18 equivalent is `useFormState`).
- On result kind:
  - `updated` → close modal, toast `"State changed: {fromState} → {toState}"` (success styling)
  - `no_op` → close modal, soft toast `"State was already {toState}"` (neutral styling, no error)
  - `reactivation_keyword_required` → keep modal open, inline error on reason field: `"Reason must include 'reactivation' to confirm CHURNED → ACTIVE"`
  - `invalid_transition` → keep modal open, inline error: `"Transition {fromState} → {toState} not allowed"` (defensive; client-side allowed-list filter should prevent this; race-condition possible if another operator changed state mid-modal)
  - `forbidden` → close modal, toast `"You don't have permission to change CRM state"` (defensive; button should be hidden per brief §3.3.10 — catches API-direct attempts)
  - `not_found` → close modal, toast `"Consignee not found"`; trigger router navigation back to `/consignees`
  - `validation` → keep modal open, inline error from server message

**Permission gate per brief §3.3.10:**
- Hide "Change state" button if actor lacks `consignee:change_crm_state` (option 1: hide; not the disabled-with-tooltip variant for this surface — hidden because the button is absent rather than present-but-disabled)
- Server action also re-asserts via the underlying service `requirePermission`; defense-in-depth

### §3.3 Transition history surface (History tab on `/consignees/[id]`)

**Surface:** History tab on `/consignees/[id]` per §3.0 tab inventory.

**Component:** server component reading via the new `getConsigneeCrmHistory` service fn (§5).

**Display:** chronological list (most recent first), each row showing:

| Column | Source field | Treatment |
|---|---|---|
| State change | `from_state` → `to_state` | Two badges with arrow between; uses §3.1 visual treatments |
| Reason | `reason` | Full text, no truncation; long reasons wrap |
| Actor | `actor` (uuid) | Resolve to user display name; system actor renders as "System" |
| Occurred at | `occurred_at` | Formatted local time per existing tenant-tz convention (Dubai-date helper or similar) |

**Initial-create row handling:** `from_state` is nullable (per migration 0016 + Q5 research). When `from_state IS NULL`, render "Created as {to_state}" instead of "{null} → {to_state}".

**Pagination:** initial implementation server-side LIMIT 50. "Load more" affordance defers to implementation PR judgment; if 50 rows is enough for demo and likely-pilot scale, ship without "Load more" and revisit Phase 2.

**Integration point with Day-17 substantive #2 (consignee timeline view, brief §3.3.7):** the broader consignee timeline view aggregates CRM events + subscription events + exception events + task state changes. **This plan's History tab reads ONLY `consignee_crm_events`.** When the consignee-timeline PR ships, the History tab content may be subsumed or deprecated. Implementation PR should keep the read-side service fn modular so the broader timeline surface composes against it.

---

## §4 Data flow

**Established pattern (per Drift #2 Option B):** server components call service-layer fns directly; mutations via server actions + `revalidatePath`.

### §4.1 Server component reads

| Surface | Service fn | File |
|---|---|---|
| `/consignees` list (badge column) | `listConsignees(ctx)` (existing) — ensure it returns `crmState` field; verify at implementation pre-flight | existing `src/app/(app)/consignees/page.tsx` |
| `/consignees/[id]` Overview tab | `getConsigneeById(ctx, id)` or equivalent (existing or net-new — verify) | NEW `src/app/(app)/consignees/[id]/page.tsx` |
| `/consignees/[id]` History tab | `getConsigneeCrmHistory(ctx, id, { limit?, before? })` (NEW per §5) | NEW `src/app/(app)/consignees/[id]/_components/HistoryTab.tsx` |

### §4.2 Server actions for mutations

| Action | File | Wraps |
|---|---|---|
| `changeCrmStateAction(consigneeId, formData)` | NEW `src/app/(app)/consignees/[id]/_actions.ts` | `changeConsigneeCrmState` service fn + `revalidatePath('/consignees/[id]', 'page')` + `revalidatePath('/consignees', 'page')` on success |

**Cache invalidation strategy:**
- On `updated`: revalidate both consignee detail (header badge + History tab) and consignee list (badge column).
- On `no_op`: skip revalidation (no state change).
- No other surfaces affected by CRM state change (consignee timeline view is Day-17 substantive #2; revalidation pattern applied there when that PR ships).

### §4.3 Client component scope

**Minimum:** the modal form itself (`useActionState`/`useFormState` requires `'use client'`). Everything else is server-rendered.

- Header card → server component
- Tab nav → server component (Next.js link-based tabs) OR thin `'use client'` wrapper for active-tab styling; defer to implementation
- Modal trigger button → `'use client'` (state for open/closed)
- Modal form → `'use client'` (server-action binding)
- History tab list → server component (rendered server-side from service fn)
- List badge column → server component (existing list page is server-rendered)

---

## §5 Net-new service fn — `getConsigneeCrmHistory` (no public API route)

**Module:** extends `src/modules/consignees/service.ts` (sibling to `changeConsigneeCrmState`).

**Signature:**

```typescript
export interface GetConsigneeCrmHistoryInput {
  limit?: number;       // default 50; max 200
  before?: string;      // ISO timestamp cursor on occurred_at; for pagination
}

export interface ConsigneeCrmHistoryRow {
  id: string;
  fromState: string | null;      // null on initial-create rows
  toState: string;
  reason: string | null;
  actorId: string;
  actorDisplayName: string;      // resolved from users table; "System" for system actor
  occurredAt: string;            // ISO timestamp
}

export async function getConsigneeCrmHistory(
  ctx: RequestContext,
  consigneeId: Uuid,
  input?: GetConsigneeCrmHistoryInput,
): Promise<readonly ConsigneeCrmHistoryRow[]>;
```

**Behavior:**

1. `requirePermission(ctx, 'consignee:read')`.
2. `assertTenantScoped(ctx, 'consignee:read')`.
3. Verify consignee exists in tenant (NotFoundError if not).
4. SELECT `consignee_crm_events` WHERE `consignee_id = $1 AND tenant_id = $2` (RLS as backstop) AND (if `before` supplied) `occurred_at < $3` ORDER BY `occurred_at` DESC LIMIT `$limit ?? 50`.
5. JOIN to users table for `actor` → `actorDisplayName`; system actor (no matching user row) renders as "System".
6. Return rows.

**No audit emit** — read-only fetch.

**No public API route.** Server component is the only consumer; introducing a route would be net-new public surface for no consumer. Implementation PR may revisit if a future client-side need surfaces; default for MVP is server-component-only.

---

## §6 Permission rendering matrix per brief §3.3.10

| Surface | tenant_admin | operations_manager | customer_service_agent | other (Phase 2 read-only) |
|---|---|---|---|---|
| `/consignees` list (read + badge column) | visible | visible | visible | visible if holds `consignee:read` |
| `/consignees/[id]` detail page (Overview + History) | visible | visible | visible | visible if holds `consignee:read` |
| "Change state" button on detail header | visible | visible | visible | hidden if lacks `consignee:change_crm_state` |
| Modal submit | succeeds | succeeds | succeeds | n/a (button hidden; defense-in-depth via service) |

**Brief §3.3.10 application:**
- **Hide what user cannot access:** "Change state" button hidden for actors lacking `consignee:change_crm_state`.
- **Disable what user can see but not act on:** N/A for this surface (no disabled-with-tooltip variant; the button is fully hidden because the audience for this view always has either-yes-or-no permission, no partial-access tier).
- **Never silently fail:** All error paths surface explicit toast or inline error per §3.2 submit-flow map. 403 from server action surfaces as toast even though button should already be hidden (defensive).

---

## §7 Error states + edge cases

| # | Scenario | UI behavior |
|---|---|---|
| 1 | Network failure on submit | Keep modal open; inline error "Network error, try again." |
| 2 | Optimistic update? | NO. Wait for server-action result before any UI change. Avoids `no_op` vs `updated` race AND keyword-validation server-side gate. |
| 3 | Same-state submission | Server returns `no_op`; UI shows soft neutral toast "State was already {toState}", closes modal, no revalidation. |
| 4 | Concurrent state change (operator A submits while operator B already changed it) | Server-action returns either `invalid_transition` (if A's intended transition no longer valid from B's new state) or `updated` (if still valid). UI renders accordingly per §3.2 flow map. No special handling. |
| 5 | Modal open, browser refresh mid-edit | Form state lost (acceptable; modal is transient; operator re-opens and re-enters). |
| 6 | History tab empty (no transitions yet) | Render placeholder "No state changes recorded for this consignee." |
| 7 | History tab with only initial-create row | Render "Created as {to_state}" per §3.3 initial-create handling. |
| 8 | CHURNED → ACTIVE submitted without keyword | Server returns `reactivation_keyword_required`; UI renders inline error on reason field per §3.2 flow map. Does NOT auto-prepend the keyword (operator must consciously add it — preserves the brief's "deliberately clunky" surface). |
| 9 | Disallowed transition (e.g., SUBSCRIPTION_ENDED → ACTIVE) reaches server (client filter bug) | Server returns `invalid_transition`; UI renders inline error per §3.2 flow map. |
| 10 | Reason field with only whitespace | Client-side validation: trim + check non-empty BEFORE submit; submit button disabled while reason is empty/whitespace. Server re-validates (`requireNonEmpty`); ValidationError → `validation` action result kind. |

---

## §8 Out of scope for this plan

- **Bulk CRM state change** — Phase 2 (multi-select consignees + apply transition).
- **CSV export of CRM history** — Phase 2 per brief §4 deferral table.
- **CRM state change via API key** — already non-blocking at service level (`consignee:change_crm_state` not in `API_KEY_FORBIDDEN_PERMISSIONS`); not a UI concern.
- **Same-state hint on dropdown** (showing current state in target dropdown but disabled) — defer to implementation polish.
- **Consignee timeline view** (broader aggregation per brief §3.3.7) — Day-17 substantive #2 separate plan PR. This plan's History tab is CRM-events-only.
- **Subscription tab + Calendar tab content** on `/consignees/[id]` — placeholders in this PR; populated by later Day-17/Day-18 PRs.
- **Address change workflows from popover** — Day-17 substantive (item 6) separate plan PR.
- **Per-task delivery status timeline** — Day-17 substantive #1 alternative (item 4) separate plan PR.
- **Phase 2 read-only role's permission tier** — out of scope; whoever holds `consignee:read` sees badges + history; whoever holds `consignee:change_crm_state` sees the modal trigger.

---

## §9 Implementation PR sequencing

### §9.1 Tier + cadence

- This plan PR — T1, merge after CI green per branch-protection path-exemption (memory/ + *.md path patterns from PR #158).
- Implementation PR — T2 hard-stop at PR open; reviewer counter-review for verification only (architectural decisions are locked here).
- Implementation PR may surface drift items via plan-sync followup memos per §A REGISTERED-METADATA-WINS discipline; if drift requires plan amendment, that's a separate T1 plan-sync bundle PR.

### §9.2 Implementation PR scope

**Net-new files expected:**

- `src/app/(app)/consignees/[id]/page.tsx` — server component, header card + tab routing
- `src/app/(app)/consignees/[id]/_actions.ts` — `changeCrmStateAction` server action
- `src/app/(app)/consignees/[id]/_components/HeaderCard.tsx` — client component for "Change state" trigger (button + modal-open state)
- `src/app/(app)/consignees/[id]/_components/CrmStateModal.tsx` — client component, form with `useActionState`, error rendering
- `src/app/(app)/consignees/[id]/_components/CrmStateBadge.tsx` — shared badge component (used by list + header + history)
- `src/app/(app)/consignees/[id]/_components/Tabs.tsx` — tab nav (server or thin client wrapper per implementation judgment)
- `src/app/(app)/consignees/[id]/_components/OverviewTab.tsx` — server component
- `src/app/(app)/consignees/[id]/_components/HistoryTab.tsx` — server component
- `src/modules/consignees/service.ts` — additions: `getConsigneeCrmHistory` fn + `ConsigneeCrmHistoryRow` type
- `src/modules/consignees/repository.ts` — additions: `selectCrmHistoryForConsignee` raw query helper
- `src/modules/consignees/tests/get-crm-history.spec.ts` — unit tests
- `tests/integration/consignees/crm-history.spec.ts` — integration test against real Postgres
- `tests/integration/consignees/crm-state-change-flow.spec.ts` — end-to-end mutation flow integration test

**Modified files expected:**

- `src/app/(app)/consignees/page.tsx` — add CRM state badge column; add row-click navigation to `/consignees/[id]`
- `src/modules/consignees/index.ts` — export `getConsigneeCrmHistory`

### §9.3 Test coverage spec

| Surface | Test type | Coverage |
|---|---|---|
| `getConsigneeCrmHistory` service fn | unit | permission denial; tenant scoping; pagination cursor; actor-display-name resolution; system-actor fallback |
| `getConsigneeCrmHistory` service fn | integration | real Postgres query; LIMIT + ORDER BY correctness; cross-tenant RLS isolation |
| `changeCrmStateAction` server action | unit | error mapping (each AppError → action result kind); revalidatePath called on success only; no_op skips revalidation |
| `CrmStateModal` client component | unit (rendering) | submit button gating; conditional CHURNED→ACTIVE hint; inline error rendering for each result kind |
| End-to-end CRM state change flow | integration | full happy path (operator clicks → modal opens → submits → state changes → history updates); CHURNED→ACTIVE keyword-required flow; same-state no_op flow |

### §9.4 Implementation PR cross-references

Implementation PR will reference:
- This plan PR by merge SHA (in PR description).
- Service contract sources at `c31b4fb` (per §2 verbatim).
- Brief §3.3.2, §3.3.3, §3.3.7, §3.3.10, §3.3.11, §8.5 (per §1.2 lineage).
- Plan PR #155 (`0d1ce21`) §10.4 matrix lock.

---

## §10 Open questions

Both questions below are **locked per Day-17 morning reviewer ruling on drift surfacing turn**. Open-question framing is for explicit plan-PR reviewer acknowledgment, NOT for re-litigation. Reopening either requires a `decision_*.md` filing per `feedback_no_self_tier_escalation.md`.

### §10.1 — `/consignees/[id]` page scaffolding scope

**Question:** Confirm `/consignees/[id]` detail page scaffolding (header card + tab structure + Overview + History tabs) is in scope for this plan's implementation PR?

**LOCKED: YES — Drift #1 Option A.** Page does not currently exist (verified Day-17 morning). Day-17 substantive items 4 + 5 + 6 all presume the detail page; building it once unblocks the rest of Day-17. Subscription + Calendar tabs ship as placeholders ("Coming in Day-17 next PRs") and are populated by later Day-17/Day-18 PRs.

### §10.2 — Server-action pattern for mutations vs. TanStack Query

**Question:** Confirm server-action pattern for the CRM state change mutation (no TanStack Query, no other client-side data layer)?

**LOCKED: YES — Drift #2 Option B.** Established codebase pattern is server components calling service-layer fns directly. Mutations via Next.js server actions + `revalidatePath`. No TanStack Query in the codebase; introducing it mid-Day-17 with 4 days to demo is wrong-time architectural migration.

---

## §11 Amendment log

| Version | Date | Changes |
|---|---|---|
| v1.0 | 7 May 2026 (Day 17 morning) | Initial filing per PR #163 (`ed61f35`). |
| v1.1 | 7 May 2026 (Day 17 morning, post brief v1.4 + brand tokens) | §3.1 visual treatment table replaced with explicit v1.4 §3.3.11 state-semantic color references (per `decision_day_17_crm_plan_visual_amendment.md`). §3.2 modal badge + §3.3 history transition badges now reference §3.1's tokens. No structural changes; visual-only amendment closing the brief-stale gap. |

---

**End of plan.**

Cross-references:
- [PLANNER_PRODUCT_BRIEF.md](../PLANNER_PRODUCT_BRIEF.md) — v1.4 source of truth
- [memory/plans/day-14-part2-service-layer.md](day-14-part2-service-layer.md) — merged plan PR #155 (`0d1ce21`); §10.4 transitions matrix lock
- [memory/handoffs/day-16-eod.md](../handoffs/day-16-eod.md) — Day-17 plan slot per §5; §A discipline rules per §9
- `src/modules/consignees/service.ts:408-505` — `changeConsigneeCrmState` (PR #160 commit `ffc9943`)
- `src/modules/consignees/transitions.ts:55-64` — `ALLOWED_TRANSITIONS` matrix
- `src/modules/audit/event-types.ts:677-686` — `consignee.crm_state.changed` registration
- `src/app/api/consignees/[id]/crm-state/route.ts` — existing wire route (Day-16 Block 4-F Commit 3)
- `src/modules/identity/permissions.ts:514-521` — `consignee:change_crm_state` permission
- `src/app/(app)/consignees/page.tsx` — existing list page (badge column lands here)
- `supabase/migrations/0016_consignee_crm_state_and_events.sql:149-181` — `consignee_crm_events` table schema
