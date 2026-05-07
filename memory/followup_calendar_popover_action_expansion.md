---
name: Calendar popover action expansion — 6 deferred actions
description: Day-17 Calendar Week view PR (Session A) shipped with Skip-default action wired end-to-end. The other 6 popover actions per brief §3.3.3 (target_date_override skip, skip-without-append, pause-from-this-date, address change one-off, address change forward, cancel delivery) are deferred to follow-up PRs — each ~30-60 min builder time, composes against the popover scaffolding shipped in this PR + existing PR #160 service-layer fns. Reviewer prioritizes by demo relevance.
type: project
---

# Calendar popover action expansion

**Surfaced:** Day 17 (7 May 2026) ~14:30 Dubai. Calendar Week view PR shipped with Skip-default action.

## §1 Background

Per brief §3.3.3 the click-into-day popover surfaces 7 actions. The Day-17 calendar PR ships ONE end-to-end (Skip-default) per pragmatic-scope ruling; the popover's `DayActionPopover` client component renders only the wired button. The other 6 actions land in follow-up PRs, each composing against the existing scaffolding.

Calendar Week view + Skip-default cover brief §5.1 demo arc Section 4 ("Click future Wednesday → click Skip → preview shows tail-end reinsertion → confirm → calendar updates"). The deferred actions are demo-nice-to-have but not demo-blocker.

## §2 Deferred actions (each = a separate T2 PR)

Each action requires:
1. A new server action in `src/app/(app)/consignees/[id]/_calendar-actions.ts` (or sibling file)
2. A new button (or button + secondary modal) in `DayActionPopover.tsx`
3. Permission gate per brief §3.3.10 — hide button if actor lacks the permission
4. Status-eligibility check (some actions only meaningful for tasks in certain states)
5. Audit-grade error mapping in the action's discriminated-union result

### §2.1 target_date_override_skip

- **Permission:** `subscription:override_skip_rules`
- **Service:** `addSubscriptionException(ctx, subscriptionId, { type: 'skip', date, target_date_override, idempotency_key })`
- **Route:** existing `POST /api/subscriptions/[id]/skip` (PR #160)
- **UI flow:** Skip button → secondary mini-modal with date picker showing eligible weekdays (per `subscription.daysOfWeek`) within the future-eligible window → confirm
- **Result kinds:** `success | conflict | validation | forbidden | not_found`
- **Demo relevance:** Section 4 advanced flow — "Move to specific date" branch
- **Estimated builder time:** ~45 min (date picker is the only non-trivial new UI)

### §2.2 skip_without_append

- **Permission:** `subscription:override_skip_rules`
- **Service:** same `addSubscriptionException` with `skip_without_append: true`
- **UI flow:** Skip button → mini-modal "Skip without compensating?" confirmation → confirm
- **Result kinds:** same shape as Skip-default
- **Demo relevance:** Section 4 advanced flow — "Cancel without compensation"
- **Estimated builder time:** ~30 min (cleanest of the six; smallest new code)

### §2.3 pause_from_this_date

- **Permission:** `subscription:pause`
- **Service:** `pauseSubscription(ctx, subscriptionId, { pause_start, pause_end, idempotency_key, reason? })` (Service B from PR #160)
- **Route:** existing `POST /api/subscriptions/[id]/pause`
- **UI flow:** Pause button → secondary modal with `pause_end` date picker (today's date is `pause_start`) → confirm. Brief §3.1.7 — bounded pause; no open-ended pauses in MVP
- **Result kinds:** `success | conflict | validation | forbidden | not_found`
- **Demo relevance:** Section 6 — "bounded pause for 1 week (holiday)"
- **Estimated builder time:** ~50 min (pause-end picker UX matters; brief shows operator picking a return date)

### §2.4 address_change_one_off

- **Permission:** `subscription:change_address_one_off`
- **Service:** `addSubscriptionException(ctx, subscriptionId, { type: 'address_override_one_off', date, address_override_id, idempotency_key })`
- **Route:** existing `POST /api/subscriptions/[id]/address-override`
- **UI flow:** "Change address" button → secondary modal showing consignee's existing addresses (Home / Office / Other from `addresses` table) → operator picks one → confirm. New repository fn `listConsigneeAddresses` if not already present (verify against `subscription_addresses` module)
- **Result kinds:** `success | conflict | validation | forbidden | not_found`
- **Demo relevance:** demo data prep needs Sarah Khouri / Fatima Al Mansouri rotation
- **Estimated builder time:** ~60 min (address picker + new repo fn if needed)

### §2.5 address_change_forward

- **Permission:** `subscription:change_address_forward`
- **Service:** `addSubscriptionException` with `type: 'address_override_forward'`, `date` = effective_from
- **Route:** same as §2.4
- **UI flow:** Same address picker as §2.4 but copy reads "From this delivery onwards" + warning that future deliveries inherit the new address
- **Result kinds:** same as §2.4
- **Demo relevance:** secondary demo flow
- **Estimated builder time:** ~30 min once §2.4 lands (shares the picker component)

### §2.6 cancel_delivery

- **Permission:** verify exists. Likely `task:cancel` or similar; if not present, this might require either a new permission OR the existing `subscription:override_skip_rules` (since cancel-without-append is essentially a skip-without-append on a single task; double-check semantics with Love before implementation)
- **Service:** TBD per permission decision
- **UI flow:** "Cancel delivery" button → confirmation modal → confirm
- **Result kinds:** standard discriminated union
- **Demo relevance:** OUT of demo arc; lowest priority
- **Estimated builder time:** ~30 min if `task:cancel` exists; ~60 min if a new permission needs registering

## §3 Implementation discipline

Each follow-up PR composes against:
- The popover scaffolding shipped in this PR (`DayActionPopover.tsx` + `_calendar-actions.ts`)
- The existing service-layer fns from PR #160 (skip / pause / resume / address-rotation / address-override are all live + integration-tested)
- The existing route handlers from PR #160 Block 4-F
- Pattern: server action → POST route → service fn → audit emit + revalidatePath
- Direct sub-module imports for client components (`@/modules/<module>/types` only — NEVER `@/modules/<module>` barrel per PR #174 fix)

## §4 Sequencing (reviewer prioritizes by demo relevance)

1. **target_date_override_skip + skip_without_append** — demo Section 4 advanced flows; Skip story arc completion. Probably bundle as one PR since they share the parent Skip semantics.
2. **pause_from_this_date** — demo Section 6 (bounded pause). High-visibility moment in the demo.
3. **address change one-off + forward** — Sarah/Fatima rotation demo prep needs at least one of these working. Bundle as one PR (shares address picker).
4. **cancel_delivery** — out of demo arc; lowest priority. Could land Day-18 or Phase 2.

## §5 Cross-references

- Brief §3.3.3 — consignee detail with calendar; full popover surface
- Brief §3.4 + §3.3.10 — RBAC enforcement layers + UI permission rendering rules
- PR #174 — detail page scaffolding + CRM modal (precedent for client component patterns)
- PR #160 — service-layer fns this PR's server action + future actions wrap
- PR #170 + PR #172 — drizzle/SF hotfix lessons; integration-test discipline rule applies to any new repository fn
- This PR's calendar Week view foundation — `DayActionPopover` is the extension point for the 6 deferred actions
- `memory/followup_day_17_frontend_gap_audit.md` §1 — calendar view expansion plans (Month/Year deferred to Day 18)
