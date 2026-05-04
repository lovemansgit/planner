---
name: Example data in user-facing help text — prefer obviously-fake names
description: When scripts, plan files, or runtime help text use real-sounding example data (tabchilli, customer-code MPL, sandbox-merchant-588), it can surface in agent narration unexpectedly and create false alarms. Use obviously-fake names (acme-corp, example-merchant, foo-bar) reserving real-sounding names for actual seeded fixtures.
type: feedback
---

# Example data in user-facing help text — prefer obviously-fake names

Use obviously-fake placeholder names in script help text, argparse error messages, plan documentation, and migration comments. Reserve real-sounding names for actual seeded fixtures and code that interacts with the real DB.

**Why:** Surfaced 3 May 2026 (Day 10 P2 cross-tenant probe prep). When I copy-pasted the canonical onboarding command from `scripts/onboard-merchant.mjs`'s usage example block — which used `--slug=tabchilli` as a placeholder — Love read the resulting message and reasonably asked "why does tabchilli appear in output without me providing it?" That triggered a verification loop (codebase grep, DB tenant audit, hostname re-check) before any DB writes happened. Cost: ~10 min of probe-prep time. Net outcome: zero data leakage; tabchilli was always documentation/help text only. But the false-alarm signal was indistinguishable from a real concern at first read, because `tabchilli` sounded like a real merchant.

**How to apply:** When writing or reviewing script help text (`need(args, "slug", "merchant URL slug, e.g. ___")`), plan-file example invocations (`npm run onboard-merchant -- --slug=___`), migration comments (`UPDATE tenants SET ... WHERE slug = '<___-slug>'`), or runtime error messages that suggest example values, ask: *would this name be visually distinguishable from a real merchant if it appeared in chat output?* If not, swap to an obviously-fake name. Suggested patterns:

- `acme-corp`, `acme-foods`, `acme-restaurants` — broadly recognisable as placeholder
- `example-merchant`, `example.test`, `example.localhost` — domain conventions for non-routable
- `foo-bar`, `foo-corp` — programmer-canon placeholder (less professional)
- `<merchant-slug>`, `<your-slug>` — angle-bracket convention for fill-in placeholders, only works in static documentation (not runtime help text)

**Audit pass to apply this:** the existing audit corpus has a few callouts:
- `scripts/onboard-merchant.mjs` line 30, 33, 95 — usage example + argparse help text use `tabchilli`
- `memory/plans/auth_implementation_plan.md` lines 127, 130, 141 — auth plan example invocations
- `supabase/migrations/0013_sf_integration_required_fields.sql` line 58 — `<tabchilli-slug>` placeholder (acceptable as it's bracketed, but cleanup pass could swap to `<merchant-slug>` for consistency)

When the next P3 onboarding work touches these files, swap in placeholder-flavored names. Not blocking; one-touch on existing files when adjacent edits land.

**Companion guidance — real-sounding names ARE appropriate when:**
- Seeded fixtures intended to live in the DB (e.g. `sandbox-merchant-588` is the canonical pilot sandbox; reading "we onboarded sandbox-merchant-588" in chat is correct because it really exists)
- Migration data scripts that operate on specific known merchants (`UPDATE tenants SET suitefleet_customer_code = 'TBC' WHERE slug = 'tabchilli'` — once tabchilli is real, the slug matches the data)
- Test fixtures with explicit `<test-prefix>-<random-uuid>` shape (e.g. `r3-test-${RUN_ID}-a`) — the prefix already signals "test"

The rule is about HELP TEXT and USAGE EXAMPLES, not all references to merchant names everywhere.

## Cross-references

- `scripts/onboard-merchant.mjs` — primary surface for Day-10 P3 onboarding work
- `memory/plans/auth_implementation_plan.md` — Day-10 P1 plan with example invocations
- `supabase/migrations/0013_sf_integration_required_fields.sql` — D8-2 backfill comment
