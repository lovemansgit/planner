# Follow-up · R8 history metadata allow-list is client-side — move the strip server-side before UAT

**Status:** OPEN — tracked MVP-hardening, explicitly NOT an R8 blocker (Love-ruled Day-52, filed at PR #356 merge clearance).

**Origin:** R8 build (PR #356, merged `6bb1082` Day-52). The task-drawer History section renders expanded-row metadata through `METADATA_ALLOW_LIST` in
[`TaskTimelineDrawer.tsx`](../src/app/%28app%29/consignees/%5Bid%5D/_components/TaskTimelineDrawer.tsx) — operator-meaningful fields only (Love's Day-52 metadata ruling, recorded in [`plan_r8_audit_timeline_drawer.md`](plan_r8_audit_timeline_drawer.md)).

## The finding

The allow-list filters on the **client, at render time**. `getTaskHistory` (src/modules/tasks/service.ts) returns each audit event's full `metadata` jsonb, and `getTaskHistoryAction` ships it to the browser unfiltered. Hidden fields — including `last_error` (raw SuiteFleet error text on `subscription.auto_paused`), `correlation_id`, `idempotency_key`, and internal record UUIDs — are therefore present in the server-action response payload and inspectable from the browser's network tab, even though the screen never shows them.

## Why this is low-risk today

- The payload is **same-tenant and authenticated**: the service gates on `task:view_timeline` and reads under `withTenant`, so RLS scopes every row to the operator's own tenant. Nothing crosses a tenant boundary.
- The rendered screen is clean — the allow-list ruling is honored for everything an operator actually sees.
- The hidden fields are operational plumbing, not credentials or PII: the audit layer already excludes note text, passwords, and credential material at emit time by convention (see `event-types.ts` metadataNotes).

## Why it matters for UAT / MVP

UAT puts curious testers (and later, merchant staff) in front of the product with devtools open. Raw vendor error text (`last_error`) is fishable from the network payload — it can leak SF-side internals, endpoint hints, or phrasing Transcorp doesn't control, and internal UUIDs invite support tickets quoting identifiers no operator surface explains. The product promise after the Day-52 allow-list ruling is "operators see operator-meaningful fields"; for UAT-grade hardening that promise should hold at the wire, not just at the screen.

## The fix (small, no migration)

Apply the allow-list **server-side in `getTaskHistory`** before returning: filter each entry's `metadata` to the allow-listed keys in the service (the set moves — or is shared — from `TaskTimelineDrawer.tsx` into the tasks service / a shared module), so hidden fields never leave the server. The client filter then becomes a no-op and can be dropped or kept as belt-and-braces. One service touch + one test asserting `last_error`/`correlation_id` absent from the returned page; the UI needs no behavioral change.

Sizing: T1-T2 small. No schema change, no permission change.

## Cross-references

- Ruling record: [`plan_r8_audit_timeline_drawer.md`](plan_r8_audit_timeline_drawer.md) §"Love's 7 rulings" + metadata allow-list ruling
- Honesty constraint (unchanged by this): [`followup_audit_failed_attempts.md`](followup_audit_failed_attempts.md)
- Build: PR #356 (merged `6bb1082`), allow-list confirmed by Love incl. `bulk_operation` + `is_auto_resume` shown
