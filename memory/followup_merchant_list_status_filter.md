---
name: followup_merchant_list_status_filter
description: PARKED build (F8 diagnosis) — admin /admin/merchants list has no status filter, so it shows every non-archived tenant (~1,248, mostly never-onboarded 'provisioning'). Fix shape: default to a status filter + "show all" toggle. Build nothing yet.
metadata:
  type: project
---

# PARKED followup — admin merchant-list status filter (F8 diagnosis)

**Source:** Day-55 overnight Builder-2 F8 (read-only diagnosis; Aqib reported
~1,248 merchants in the list). Love's firing: "file the merchant-list
diagnosis as a parked followup with your recommended fix shape. Build nothing."

## Root cause (from code; prod was NOT queried per the overnight fence)

`src/app/(admin)/admin/merchants/page.tsx` calls `listMerchants(ctx, { searchTerm: q })`
with **no status filter**. `listMerchants` defaults `excludeArchived: true`, so
the list renders **every non-archived tenant** — `provisioning` + `active` +
`suspended` + `inactive` all mixed. There is no "real merchants only" default.

Tenant statuses: `provisioning | active | suspended | inactive | archived`
(`merchants/types.ts`). `createMerchant` (UI) defaults new tenants to
`provisioning`; `onboard-merchant.mjs` (CLI) inserts `active`. No bulk
SF-roster import script exists in the repo — the ~1,248 were loaded outside
tracked scripts (consistent with "SF-roster loaded for the dark switch") and
are almost certainly dominated by never-onboarded `provisioning` rows.

## Category shape (counts await Love's read-only SQL)

| Category | status | source | shown today |
|---|---|---|---|
| Real, onboarded | `active` | activateMerchant / onboard-merchant.mjs | yes |
| Never-onboarded / bulk-loaded | `provisioning` | createMerchant default; out-of-repo roster load | yes — likely the bulk |
| Deactivated | `inactive` | deactivateMerchant | yes |
| Suspended (reserved) | `suspended` | none sets it | yes (~0) |
| Test/synthetic names | any | seed scripts; demo-/test- slugs | yes |
| Archived | `archived` | migration 0021 fixture cleanup | no (excluded) |

Confirm counts (read-only):
```sql
SELECT status, count(*) FROM tenants GROUP BY status ORDER BY 2 DESC;
SELECT count(*) FROM tenants WHERE slug ~* '(test|demo|synthetic|sample|dummy)';
SELECT name, count(*) FROM tenants GROUP BY name HAVING count(*)>1 ORDER BY 2 DESC LIMIT 50;
```

## Recommended fix shape (NOT built — Love decides)

Default the admin merchants list to a **status filter** (the repository already
supports `filters.status`; the page just doesn't pass it): exclude
`provisioning`/`archived` by default (or show `active` only), with an explicit
**"show all"** toggle for the forensic view. Optionally exclude test-name-pattern
slugs. Mostly a page/UI change — no migration, no deletion. **Love decides the
cleanup of the provisioning rows separately** after seeing the real counts.
