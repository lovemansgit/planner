// F8 (20 Jun 2026) — genuine-merchant default-view contract.
//
// Love's ruling: the admin merchant list shows ONLY genuine merchants
// by default; the ~1,825 automated-test tenants are hidden (not
// deleted), reversible via a one-click "show all" toggle. NO deletion,
// NO migration — a read-path filter only.
//
// Origin (read-only production diagnosis, 20 Jun 2026): test tenants are
// minted by the test + seed suites against the single production
// Supabase, each with a random 8-hex slug fragment for isolation
// (e.g. `r3-test-74a6b577-a`, `det-db4cd52c-full`). The `audit_events_
// no_delete` rule blocks tenant teardown, so they accumulate. The
// fragment sits MID-slug, so the discriminator is the UN-ANCHORED
// pattern `[0-9a-f]{8}` — Love's brief sketched `^[0-9a-f-]*[0-9a-f]{8}`
// but the anchored form matches almost nothing on real data. The
// un-anchored form was proven on live data: it matched 1,821 of 1,832
// tenant rows, and the 11 non-matches were exactly the genuine ones.
// Love delegated "the cleanest predicate" to the reviewer's call.
//
// This contract has TWO renderings, cross-checked by tests so they can
// never silently diverge:
//   - SQL: `listMerchants({ excludeTestTenants: true })` in repository.ts
//   - JS:  `isGenuineMerchant()` below (executable spec + reuse point)
// Both consume the constants exported here.

import type { TenantStatus } from "./types";

/**
 * Allowlist safety net — these six slugs ALWAYS appear in the default
 * view regardless of status or slug shape, so a real merchant can never
 * be hidden by the heuristic. Confirmed genuine by the 20 Jun 2026
 * production diagnosis. (`transcorp` is the internal Transcorp home
 * tenant; `hem`/`mlp` are real UAT production merchants; the other
 * three are the canonical demo merchants preserved by migration 0021.)
 */
export const GENUINE_MERCHANT_SLUGS: readonly string[] = [
  "meal-plan-scheduler",
  "dr-nutrition",
  "fresh-butchers",
  "transcorp",
  "hem",
  "mlp",
];

/**
 * Statuses shown in the default genuine view. Includes `provisioning`
 * (Love's clearance ruling, 20 Jun 2026) so genuine newly-onboarded
 * merchants — which land as `provisioning` — appear in the default view
 * and can be activated without leaving it. The ~1,825 provisioning test
 * tenants stay hidden anyway: they carry the 8-hex slug fragment caught
 * by TEST_TENANT_SLUG_PATTERN. Only `archived` is excluded here; it
 * remains reachable via the explicit `?status=archived` forensic path
 * and via the "show all" toggle.
 */
export const DEFAULT_VIEW_STATUSES: readonly TenantStatus[] = [
  "active",
  "inactive",
  "suspended",
  "provisioning",
];

/**
 * The un-anchored 8-hex test-isolation fragment. Held as a string so it
 * is the single source of truth for BOTH the Postgres `!~` operator
 * (repository.ts) and the JS RegExp below — POSIX and JS agree on this
 * character class + bounded quantifier.
 */
export const TEST_TENANT_SLUG_PATTERN = "[0-9a-f]{8}";
const TEST_TENANT_SLUG_REGEX = new RegExp(TEST_TENANT_SLUG_PATTERN);

/**
 * Whether a tenant row would appear in the default genuine merchant
 * view. Executable specification of the `excludeTestTenants` SQL filter:
 *
 *   genuine := allowlisted
 *           OR (status in DEFAULT_VIEW_STATUSES AND slug has no 8-hex run)
 *
 * The allowlist branch is evaluated first so a real merchant always
 * shows even if provisioning/archived or its slug happens to contain a
 * hex run.
 */
export function isGenuineMerchant(row: {
  readonly slug: string;
  readonly status: TenantStatus;
}): boolean {
  if (GENUINE_MERCHANT_SLUGS.includes(row.slug)) return true;
  if (!DEFAULT_VIEW_STATUSES.includes(row.status)) return false;
  return !TEST_TENANT_SLUG_REGEX.test(row.slug);
}
