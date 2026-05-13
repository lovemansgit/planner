# Brief v1.12 amendment — decoupled consignee creation + edit-merchant surface

**Filed:** Day 25 morning (13 May 2026)
**Source decisions:** Day-25 morning review session — Love-driven product gap discovery
**Brief version:** v1.11 → v1.12

## Summary

Two architectural simplifications surfaced during Day-25 morning review. Both reframe original assumptions that didn't survive contact with real operator workflows.

1. **Consignee creation decouples from subscription creation.** Original brief assumed every consignee gets a subscription at onboarding. Real operators onboard consignees before plans are decided, or for one-off ad-hoc deliveries. Wizard goes away; flat consignee form lands operator on consignee detail page with CTAs to add work.

2. **Edit-merchant UI added.** Original brief had no path to correct merchant details post-create (name, slug, pickup address, SF customer code). SQL editor was the only path. Real operations require an Edit surface.

## §3.1.4 — Service method changes

**Removed:** createConsigneeWithSubscription (atomic wizard service).

**Added / clarified:**

- createConsignee(ctx, { identity, address }) — creates consignee + primary address in single transaction. No subscription, no tasks. Returns { consignee_id }.
- createSubscription — already exists; called from consignee detail page CTA (no API change).
- createAdHocTask(ctx, consigneeId, { date, window, address_id?, notes? }) — creates a one-off task for an existing consignee. Address defaults to consignee's primary unless overridden. Task is created immediately in Planner DB; SF outbound push enqueued to QStash for near-real-time delivery (matches optimistic-ack pattern from skip/cancel flows). Operator sees "Saved — pushing to SuiteFleet" toast.
- updateMerchant(ctx, tenantId, { name?, slug?, pickup_address?, suitefleet_customer_code? }) — Transcorp-staff scoped. Audit-emits merchant.updated with diff of changed fields. Slug changes warn operator pre-submit (breaks existing bookmarks). Cross-field validation: slug uniqueness, SF customer code positive integer. Permission: merchant:update (new), transcorp-sysadmin only.

## §3.3 — UI surface changes

### Flat consignee form

/consignees/new route. Replaces the 3-step wizard. Single form with two visually-distinct sections (mirrors /admin/merchants/new aesthetic — section headers with subtle dividers, single submit button):

- Identity section — full name, primary phone (E.164), email (optional), delivery notes (optional), merchant internal reference (optional), internal notes (optional)
- Address section — address label (Home/Office/Other), address line, district, emirate

Submit creates consignee + primary address atomically. Operator lands on /consignees/[id] Overview tab.

### Consignee detail Overview tab — empty state

For a consignee with no subscription and no tasks:
- Identity block (name, phone, email)
- Primary address block
- CRM state badge (defaults ACTIVE)
- Two prominent CTAs: Create subscription and Add ad-hoc task
- "Add ad-hoc task" opens a dialog capturing: date, window, optional notes, optional address override
- Subscription / Calendar / History tabs render their natural empty states (no tab hiding)

### Consignee list — "No tasks" flag

/consignees list adds an amber NO TASKS badge on any consignee row where the consignee has zero tasks (any internal_status). Flag clears the moment the first task lands — whether from a subscription's first materialised task or from an ad-hoc task creation. Flag is task-based, not subscription-based.

### Edit Merchant surface

New route /admin/merchants/[id]/edit. Form mirrors /admin/merchants/new component, pre-filled from current tenant row. Editable fields: name, slug, pickup address (line/district/emirate), SF customer code. Status not editable here — activate/deactivate is its own action.

Slug change shows confirm dialog before submit: "Changing the slug will break any existing bookmarks or saved URLs that use the current slug. Continue?"

EDIT row action added to /admin/merchants list, alongside existing DEACTIVATE. Permission: merchant:update granted to transcorp-sysadmin only.

## §5.1 — Demo narrative update (Chapter 3 rewrite)

Old Chapter 3 (atomic wizard):
"Onboard first consignee Fatima Al Mansouri (4-step wizard: identity → addresses with Home + Office → subscription Mon-Fri lunch → schedule rules) → /consignees/[id] calendar materializes immediately."

New Chapter 3 (two-beat decoupled flow):
"Onboard first consignee Fatima Al Mansouri via flat form (identity + primary address) → land on Fatima's Overview page → CRM state ACTIVE badge visible → click 'Create subscription' CTA → set Mon-Fri lunch plan in standalone subscription form → /consignees/[id] calendar materializes immediately."

## §5.3 — Pre-demo verification gates (no change required)

Existing gates 1–10 remain valid. Gate 8 unchanged.

## §4 — Phase 2 deferrals (no change required)

Edit-merchant promoted from implicit-Phase-2 to MVP via this amendment.

---

## Footer — Day-25 code-PR clarifications

**Audit event reuse (added Day-25 code-PR per plan-PR §3.6 round-1 FINDING 2).** The amendment text above proposes `task.ad_hoc.created` as the emit for the new `createAdHocTask` service. The implementing code reuses the existing `task.created` event instead. Differentiation between cron-materialised and operator-initiated ad-hoc tasks happens via `metadata.created_via='manual_admin'` + `actor_kind='user'` — sufficient for audit-query consumers without registering a new event type. This decision is intentional: event-type proliferation has a real cost (more docs, more audit-query indexes), while the metadata drill-down is the natural query path for analytics retros that need to filter "user-initiated tasks." No brief amendment (v1.13) needed.
