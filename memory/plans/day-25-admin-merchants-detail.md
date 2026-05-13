# Day-25 plan — read-only merchant detail page + webhook URL surface (T2)

Filed: 2026-05-13 (Session B, evening). T2 plan-PR per Love's directive
to plan-first on this lane. Code-PR opens after plan clearance.

Production HEAD at filing: main at `484e2a4` (PR #267) — CI GREEN as
of PR #269 audit-rule teardown fix (Session A's parallel landing).

## §0. Preamble

Two gaps surfaced Day 25 PM:

1. **Read-only inspection surface missing.** The only path to view
   merchant data today is `/admin/merchants/[id]/edit` (shipped Day 25
   AM via PR #264). That's a footgun for read-only inspection —
   sysadmins reading a merchant's pickup address or SF customer code
   risk fat-fingering an edit. The list page shows name + slug + status
   + created but not pickup address, sf customer code, or webhook URL.

2. **Webhook URL not surfaced on admin side.** Tenant-admin operators
   have `/admin/webhook-config` (Day-9 P4a) for their own merchant's
   webhook URL. Transcorp staff onboarding a new merchant need that URL
   to share with the SuiteFleet vendor for outbound wiring — currently
   no admin-side surface exists. Sysadmin has to derive the URL by hand
   from the tenant UUID + production hostname.

This plan adds a single `/admin/merchants/[id]` page that solves both.
Read-only by construction; edit goes through the existing edit route.

### §0.1 Tier discipline

T2 per Love's directive ("T2 plan-PR"). Convention is T2 hard-stops at
code-PR open (one stop); Love is asking for a plan-PR first to
coordinate the scope clearly given the architectural decisions involved
(shared `<CopyableUrl>` extraction; permission-gate wording; webhook
URL builder reuse). Plan-PR clears §3.6 round 1; code-PR clears §3.6
round 2 per brief v1.13 §7.1.

CI gate active for both rounds per brief §7.1.

### §0.2 Demo distance

T-1 (May 15 internal CAIO) at filing. **Not on critical path** — both
gaps existed during PRs that already cleared; this PR is operational
hygiene, not a demo-blocker. Code-PR may merge pre-demo or post-demo
depending on Love's queue.

## §1. Scope boundaries

### §1.1 In scope

- New route `/admin/merchants/[id]` — read-only detail page under
  `(admin)/` route group.
- `/admin/merchants` list-page changes:
  - Merchant **NAME** column becomes a clickable link to
    `/admin/merchants/[id]` (whole-row click is NOT proposed; only the
    name cell wraps the link, matching `/admin/users` precedent).
  - Subtle hover cue (underline + cursor pointer) on the name cell.
  - Existing **EDIT** row action removed.
  - Existing **DEACTIVATE** row action stays.
- Detail page top-right: **EDIT MERCHANT** button (all-caps per brand
  canon + §9.1 ruling from PR #264). Gated on `merchant:update`; hidden
  when the actor lacks the permission.
- Webhook URL surfaced on the detail page §3 Routing section with the
  shared `<CopyableUrl>` primitive (see §6).
- Extract `<CopyableUrl>` from its page-colocated location at
  `src/app/(app)/admin/webhook-config/client.tsx` to a shared
  primitive at `src/components/CopyableUrl.tsx`. Both consumers
  (webhook-config page + new detail page) reference the shared
  primitive. No behavior change to the webhook-config page.

### §1.2 Out of scope

- **No schema changes.** Detail page reads existing `tenants` columns
  via the existing `getMerchantById` service fn from PR #264.
- **No new service methods.** `getMerchantById` covers the read; if a
  Phase-2 surface needs more (e.g., last-webhook-received-at,
  recent-audit-events), that's a separate PR.
- **No audit event changes.** Read-only page = no state mutations =
  no new audit emits. The existing `db.service_role.use` observer
  still fires on the underlying read; that's pre-existing telemetry,
  not new instrumentation.
- **Tenant-admin-facing webhook config UI unchanged.** The existing
  `/admin/webhook-config` page (Day-9 P4a, lives under `(app)/`)
  serves tenant operators their OWN merchant's webhook URL. The new
  `/admin/merchants/[id]` page is the cross-tenant Transcorp-staff
  equivalent. Both legitimately exist; both read the same builder.
- **No bulk operations.** Single-merchant detail only.
- **No timeline / audit-trail surface on the page.** Phase 2 (per
  `memory/followup_audit_log_viewer_ui.md` corpus).

### §1.3 Schema impact

**Zero.** All fields shown on the page already exist on `tenants`:
- `name`, `slug`, `status`, `created_at` (existing since 0001)
- `pickup_address_line / district / emirate` (since 0017)
- `suitefleet_customer_code` (since Day-22 §5.3 Gate 2 closure)

The webhook URL is a pure derivation from `tenants.id` + the public
base URL — no DB column, no migration.

## §2. Permission model

### §2.1 Detail page read

Gated on `merchant:read_all` (existing systemOnly perm, registered at
`src/modules/identity/permissions.ts:633`). Held by:

- `transcorp-sysadmin` — via the `new Set<PermissionId>(ALL)` pattern at
  `roles.ts:219` (auto-grants every permission).

**OQ (§9.1): user spec mentioned `transcorp-readonly` role.** No such
role exists in the catalogue today; only `transcorp-systems` (narrow
migration scope) and `transcorp-sysadmin` (ALL). Either:
- (a) we proceed gating on `merchant:read_all` as-spec'd; the only
  current holder is `transcorp-sysadmin` (which also holds
  `merchant:update`, so the EDIT button always renders for them).
- (b) we add a new `transcorp-readonly` role that holds the read perms
  but NOT the update perms — but that's a separate role-catalogue
  change with its own surface area + Phase 2-class effort.

Plan defaults to (a). Reviewer override is straightforward if (b) is
the call.

### §2.2 EDIT MERCHANT button visibility

Gated on `merchant:update` (registered Day 25 AM, PR #264). Button
renders ONLY when the actor's permission set includes it. With the
current role catalogue, that's `transcorp-sysadmin` only.

Implementation: `hasPermission(ctx, "merchant:update")` checked in the
page component; pass result as a boolean prop to the rendering helper.

### §2.3 Webhook URL visibility

Same gate as detail page read (`merchant:read_all`). The URL itself
contains no secrets — it's the same pattern used at the existing
`/admin/webhook-config` page which surfaces it to any user with
`webhook_config:read` (tenant-admin + ops-manager scope).

### §2.4 Defense in depth

Per brief §3.4 three-layer:

1. **Server-component preflight** — `[id]/page.tsx` calls
   `requirePermission(ctx, "merchant:read_all")`. ForbiddenError →
   redirect to `/`. UnauthorizedError → redirect to `/login`.
2. **Service-layer reassertion** — `getMerchantById` already gates on
   `merchant:update` per §9.3 ruling from PR #264. **Problem:** the
   detail page needs to read merchant data with the **read_all** gate,
   not the **update** gate (otherwise read-only viewers can't access
   it, defeating the whole purpose of this PR).
3. **No RLS layer** — cross-tenant scope; `withServiceRole` bypasses
   tenant RLS on `tenants`.

**Resolution: new read fn or perm-gate amendment.** Two options:

- **Option A — relax `getMerchantById` perm gate from `merchant:update` to `merchant:read_all`.** Reasoning: "what you can see in the list, you can see in detail." Tightens nothing; loosens the gate by exactly one permission. The §9.3 ruling from PR #264 was "tighter gate, route-specific; avoids granting merchant:read_all just to support edit" — but the new read-only detail page genuinely needs the read gate, and `merchant:read_all` is already what the list page uses. **Plan defaults to Option A.**
- **Option B — add a new `getMerchantForReadOnly` service fn that gates on `merchant:read_all`, leave `getMerchantById` unchanged.** Bifurcates the read path; more code; same outcome behaviorally. Rejected unless reviewer asks.

Service-level test pin: under Option A, the unit test `getMerchantById — tighter gate than read_all` from PR #264 inverts — the new pin asserts both `merchant:read_all` AND `merchant:update` actors can read. The existing test at `src/modules/merchants/tests/service.spec.ts` for the §9.3 ruling needs updating in lockstep.

## §3. Detail page layout

Three sections in a vertical stack. Brand-canon: `bg-surface-primary`,
`text-navy`, hairline borders (0.5px Stone 200), sentence-case body,
all-caps eyebrow labels with letter-spacing per existing
`/admin/merchants/new` precedent.

### §3.1 Header

```
Transcorp · Admin

<Merchant name as h1>

<sentence-case explainer: "Read-only details. Edit non-status fields via UPDATE MERCHANT.">

[EDIT MERCHANT button, top-right, gated on merchant:update]
```

### §3.2 Section 1 — Identity

| Field | Display |
|---|---|
| Name | `merchant.name` (Mulish 500) |
| Slug | `merchant.slug` (font-mono, smaller) |
| Status | colored badge per existing `statusBadgeSurface` helper (active = green tint; provisioning/suspended/inactive/archived = muted Stone 600) |
| Created | `YYYY-MM-DD` from `merchant.createdAt` (operator-facing; time-of-day not load-bearing here) |

### §3.3 Section 2 — Pickup address

Three fields surfaced as label + value rows:
- Address line
- District
- Emirate

Empty fields render with `—` placeholder rather than blank. Operator
sees "this field isn't set" without scanning column widths.

### §3.4 Section 3 — Routing

Two sub-blocks:

**SuiteFleet customer code.**
- Label + value row.
- Value rendered in `font-mono text-sm`. `—` placeholder when null.

**Webhook URL.**
- Single row containing the URL display + copy button via the shared
  `<CopyableUrl>` primitive (see §6).
- Helper text below: "Share with SuiteFleet vendor to wire outbound
  webhooks for this merchant."
- URL computed via existing `buildWebhookUrl(merchant.tenantId, resolvePublicBaseUrl())`
  from `src/modules/webhooks/queries.ts:140` (no new builder needed).

### §3.5 Hairline section separators

Each section separated by `border-t border-[color:var(--color-border-strong)]`
matching the existing `/admin/merchants/new` form fieldsets and the
`/admin/webhook-config` page rhythm.

## §4. Webhook URL computation

**No new helper needed.** Two existing fns in
`src/modules/webhooks/queries.ts:140-159` cover the full surface:

- `buildWebhookUrl(tenantId: Uuid, baseUrl: string): string` — pure
  derivation, normalises trailing slash, returns the canonical
  `${baseUrl}/api/webhooks/suitefleet/${tenantId}` shape.
- `resolvePublicBaseUrl(env): string` — resolution chain:
  1. `PUBLIC_BASE_URL` env override
  2. `VERCEL_URL` auto-injected per-deploy alias (Day-22n fallback)
  3. Hard-coded `FALLBACK_BASE_URL = "https://planner-olive-sigma.vercel.app"`

The hard-coded fallback is documented at `queries.ts:145-156` with a
header comment explaining the fail-silent posture (webhook-config page
never 500s on missing env var). Both functions are public exports from
the `@/modules/webhooks` barrel.

**Server-component call pattern** (matches existing
`/admin/webhook-config/page.tsx:55-56`):

```typescript
const baseUrl = resolvePublicBaseUrl();
const webhookUrl = buildWebhookUrl(merchant.tenantId, baseUrl);
```

### §4.1 Preview-vs-production caveat

When the page renders in a Preview deploy, `resolvePublicBaseUrl()`
returns the `VERCEL_URL` of that preview. The webhook-config page has
a helper text caveat for this: "URL above reflects current deploy
environment. For Production, use the value displayed at
planner-olive-sigma.vercel.app." The new admin detail page should
carry the same caveat in the helper text under the URL row, to keep
the discipline consistent across both webhook-URL surfaces.

## §5. List page changes (`/admin/merchants`)

### §5.1 Name → link

Current `MerchantsTable` Row (page.tsx:137-171) renders the name as
`<span className="font-medium text-navy">{merchant.name}</span>`. Wrap
in `<Link href={`/admin/merchants/${merchant.tenantId}`}>` with the
existing typography preserved + a hover state.

Hover cue: `hover:underline` on the Link (sentence-case underline at
hover-time only; underline is reserved for interactive cues per brand
discipline). Cursor pointer is automatic via the `<a>` tag.

### §5.2 EDIT row action removed

Current Actions cell (page.tsx:158-174) renders a flex row with `<Link>Edit` + `<MerchantStatusModal>`. Drop the Edit link entirely. The
Actions cell becomes a single-item conditional render — `<MerchantStatusModal>` when `action !== null`, otherwise `—`.

Rationale: with the name column clickable, the EDIT button is
redundant on the list. The detail page's top-right EDIT MERCHANT
button is the canonical edit-entry-point. Single path = less footgun
surface.

### §5.3 DEACTIVATE row action stays

No change to `<MerchantStatusModal>` rendering. ACTIVATE for
`provisioning` rows, DEACTIVATE for `active` rows, `—` for terminal
states. Same logic as today.

### §5.4 Header CTA unchanged

The "+ New merchant" CTA in the header (page.tsx:88-93) stays.

## §6. CopyableUrl extraction

### §6.1 Current location

`src/app/(app)/admin/webhook-config/client.tsx:23-64` defines
`<CopyableUrl url={url} />`. Page-colocated because it's the only
consumer today.

### §6.2 New location

`src/components/CopyableUrl.tsx` — shared primitive matching the
existing convention used for `<SearchBar>` and `<DateRangeFilter>`
(also at `src/components/`).

### §6.3 Migration

- Move the file: `git mv src/app/(app)/admin/webhook-config/client.tsx src/components/CopyableUrl.tsx`
- Update the import in `src/app/(app)/admin/webhook-config/page.tsx:34`
  from `import { CopyableUrl } from "./client";` to
  `import { CopyableUrl } from "@/components/CopyableUrl";`.
- No behavior change. The component contract is unchanged: `url: string`
  prop, two-state idle/copied/failed with 2s timeout.

### §6.4 New consumer

`src/app/(admin)/admin/merchants/[id]/page.tsx` imports the same
shared component for the webhook URL row.

### §6.5 Defensive posture

Existing implementation already gates `navigator.clipboard.writeText`
with try/catch and falls back to `setState("failed")` on rejection
(non-secure context, permission denied). No changes needed; the
existing pattern handles the contingency the user spec called out.

## §7. Tests

### §7.1 Unit tests

**Existing tests touched (perm-gate amendment per §2.4 Option A):**

- `src/modules/merchants/tests/service.spec.ts` — the `getMerchantById`
  test suite (3 cases from PR #264) needs updating:
  - "Throws ForbiddenError when actor lacks merchant:update" → reword
    to "merchant:read_all".
  - "Returns the mapped row when found (with merchant:update perm)" →
    rename + parameterize over both perms.
  - "Does NOT accept merchant:read_all alone (tighter gate per plan §9.3 ruling)"
    → invert: now the case is "Accepts merchant:read_all alone; does
    NOT require merchant:update" (Option A loosens this).
  - PR description should call out the §9.3 amendment explicitly.

**New tests:**

- `src/modules/webhooks/tests/queries.spec.ts` — already covers
  `buildWebhookUrl` + `resolvePublicBaseUrl` with 6+ cases (file
  existed pre-PR per earlier grep). No new spec needed unless reviewer
  surfaces gaps.

**No new helper file under `_helpers` — the detail page has no parser
or form-validation surface (read-only).**

### §7.2 Integration spec at PR open (Day-23 §F discipline)

`tests/integration/admin-merchants-detail.spec.ts` — new file.

Coverage:
1. **Detail page render — happy path.** Seed a tenant with all fields
   populated; GET-equivalent service call returns the full merchant
   DTO. Assert every projected field matches the seed values.
2. **Webhook URL computation correctness.** With a known tenant UUID +
   known `PUBLIC_BASE_URL` (set via env), assert the rendered URL
   matches the canonical pattern.
3. **Permission rejection — non-sysadmin actor.** Mock an actor
   without `merchant:read_all`; assert ForbiddenError.
4. **EDIT MERCHANT button visibility.** With a `merchant:update`-holding
   actor, the button render-helper returns true. Without, false.
   (This is a unit-level concern but pinning it at integration tier
   keeps it grouped with the page surface.)
5. **Mid-null pickup address.** Tenant with `pickup_address_line: null`
   etc. surfaces as `pickupAddress: null` on the DTO; page renders
   `—` placeholders.
6. **Empty suitefleet_customer_code.** Tenant with null code surfaces
   as `—` placeholder on the page; webhook URL still renders (it
   doesn't depend on the customer code).

afterAll teardown follows the Day-25 post-PR-#269 pattern (Session A
fixed the audit-rule teardown bug class; my admin-merchants-update
spec already uses the try-catch wrapper which is the canonical
established pattern).

### §7.3 Test baseline impact

Expected: ~+6 integration tests + ~3 amended unit tests in
`merchants/tests/service.spec.ts`. Net unit change is near-zero (re-purposing
existing tests, not new growth).

## §8. Sequencing

1. **Plan-PR (this PR)** — §3.6 round 1 hard-stop.
2. **Code-PR** — opens after plan clearance. Commits:
   - C-1 — `<CopyableUrl>` extraction (move + import update; no
     behavior change). Touch `webhook-config/page.tsx` + new
     `components/CopyableUrl.tsx`.
   - C-2 — `getMerchantById` perm-gate amendment from
     `merchant:update` → `merchant:read_all`. Service unit test
     updates. Pins the §9.3 amendment explicitly via test rename.
   - C-3 — `/admin/merchants/[id]/page.tsx` server component + render
     helpers. Imports the shared `<CopyableUrl>`. Renders all three
     sections.
   - C-4 — `/admin/merchants/page.tsx` list page changes (name link,
     EDIT row action removed).
   - C-5 — `tests/integration/admin-merchants-detail.spec.ts`.

3. **Code-PR §3.6 round 2 hard-stop** → reviewer body-read + CI
   verify per brief v1.13 §7.1 → Love merges.

## §9. Open questions for reviewer

### §9.1 `transcorp-readonly` role

The user spec mentioned "transcorp-sysadmin and transcorp-readonly
roles" for the read gate. No `transcorp-readonly` role exists in the
catalogue. Plan defaults to gating on `merchant:read_all` (the perm
sysadmin already has via ALL); this implicitly behaves as
sysadmin-only for the read until a new role lands. Reviewer override:
add the new role in this PR (Phase 2-class effort) OR keep as-spec'd
and file a follow-up.

### §9.2 Service-fn perm gate (§2.4)

Option A (relax `getMerchantById` from `merchant:update` to
`merchant:read_all`) inverts the §9.3 ruling from PR #264. Plan
defaults to Option A on the reasoning that the new read-only page is
legitimate user-facing scope that the original §9.3 ruling didn't
anticipate. Reviewer override: stick with Option B (bifurcated read fns).

### §9.3 Whole-row click vs name-cell click

The plan proposes only the NAME cell is the clickable Link, matching
`/admin/users` precedent. Some admin tools prefer whole-row click
(larger hit target). Plan defaults to name-cell-only; reviewer
override is trivial.

### §9.4 Preview-vs-production caveat copy

The webhook-config page has a "URL reflects current deploy
environment" caveat. Plan duplicates this on the new page. Reviewer
may want different copy or a stronger visual treatment (since
sysadmin sharing a Preview URL with the SF vendor is high-stakes).

### §9.5 EDIT MERCHANT button placement

Plan proposes top-right. Could also be bottom of the page (after all
three sections, alongside the existing pages' button patterns). Plan
defaults to top-right for fast-access; the read-only majority case is
"glance at fields, leave"; top-right reinforces "this is the edit
escape hatch, not the default."

## §10. Out-of-scope (forward-link)

- Phase 2 audit-trail viewer on the detail page (per
  `memory/followup_audit_log_viewer_ui.md` corpus).
- Last-webhook-received-at indicator (requires receiver-side
  persistence — same constraint that gated the webhook-config page's
  receiver metrics deferral).
- `transcorp-readonly` role addition (§9.1) — separate role-catalogue
  PR.
- Whole-page activate/deactivate surface (already exists on list page
  via `<MerchantStatusModal>`; no need to duplicate on detail).
- Cross-route navigation breadcrumbs (`Merchants > Demo Bistro`) —
  Phase 2 nav polish if multiple cross-route admin surfaces emerge.

## §11. CI gate (per brief v1.13 §7.1)

This plan-PR ships as docs-only (single markdown file). CI status at
PR-open:

- Local tests: not applicable (no .ts touched). Markdown render +
  cross-references visually verified.
- CI status: PENDING at push time; main is GREEN as of `484e2a4` (PR
  #267), so the run is expected to land PASS. Surface CI state in the
  PR-open message per the §7.1 format.

§3.6 round 1 (plan-PR) clearance gates code-PR opening; CI must be
green before plan-PR merges.

---

End of plan. T2 hard-stop at plan-PR open per §3.6 (plus the round 2
hard-stop at code-PR open per brief v1.13 §7.1).
