---
name: Client-component test infrastructure — net-new framework decision
description: Day-17 T2 #1 (app-shell brand pass + UserMenu) surfaced that the codebase has zero precedent for rendering React components in tests. No @testing-library/react, no jsdom, no .spec.tsx files. Existing tests are pure-function (.spec.ts) only. UserMenu shipped with helper-only unit coverage + Vercel preview visual gate; full interaction tests (click-outside, escape, aria states, keyboard nav) deferred to a future PR that establishes the testing infrastructure.
type: project
---

# Client-component test infrastructure

**Surfaced:** Day-17 T2 #1 implementation (app-shell brand pass + UserMenu).

## §1 Gap

Codebase test inventory at Day-17 morning:
- ~80 unit spec files, all `.spec.ts`
- All testing pure functions OR service-layer logic with mocked DB OR route handlers with mocked Supabase
- Zero `.spec.tsx` files
- Zero `@testing-library/*` packages
- Zero `jsdom` / `happy-dom`

UserMenu component (Day-17 T2 #1) is the first React client component with non-trivial interaction surface — click-outside detection, escape-key handler, aria-expanded toggle, focus management.

## §2 Day-17 T2 #1 coverage compromise

UserMenu shipped with:
- Helper-only unit test on `resolveDisplayName` (pure function; multi-branch logic)
- Vercel preview manual visual + interaction smoke test (gate at PR open)
- No automated coverage on: click-outside close, escape close, aria-expanded state, focus return on close, keyboard menu navigation

This is acceptable for the Day-17 substantive landing because UserMenu is structural-rendering + DOM-event handling (low architectural risk; visible regression on visual smoke). NOT acceptable as a permanent posture — every future client component would compound the gap.

## §3 What a future PR needs to establish

Net-new architectural decision; should be its own T2 PR with reviewer counter-review:

1. **Choose testing library**: `@testing-library/react` is industry default; alternatives (e.g. `@vitest/browser`) exist. Recommend `@testing-library/react` + `@testing-library/user-event` + `@testing-library/jest-dom` for ergonomic assertions.
2. **Choose DOM env**: `jsdom` is mature; `happy-dom` is faster but younger. Recommend `jsdom` for stability.
3. **Vitest config split**: existing `vitest.config.ts` uses node env. Two paths:
   - Single config with environment matcher: `.spec.tsx` files use jsdom; `.spec.ts` files use node.
   - Separate config files: `vitest.config.node.ts` + `vitest.config.dom.ts`; CI runs both.
4. **First component to test**: backfill UserMenu interaction tests (click-outside, escape, aria states, focus management). All 11 cases originally specified in T2 #1 prompt that were deferred to helper-only.
5. **Pattern documentation**: short doc in `memory/` or `src/` describing how to add new client-component tests so future contributors don't reinvent.

## §4 Why deferring is correct for Day-17 T2 #1

Adding test-infra deps to a feature PR violates the "no new framework deps in feature PRs" instruction explicitly given by the reviewer in T2 #1's Step 3g. First-of-its-kind framework decisions deserve dedicated review, not bundling.

Alternatives considered:
- Bundle into T2 #1 → rejected (instruction violation; scope creep)
- Defer entire UserMenu → rejected (slips Path B commitment)
- Helper-only + Vercel preview → ACCEPTED (this memo)

## §5 Day-18 polish or post-demo?

This is technical-debt closure work, not feature work. Demo doesn't need it. Recommend post-demo Phase 2; tracker for first post-pilot hardening sprint alongside admin middleware Phase 2 hardening.

## §6 Cross-references

- `src/app/(app)/user-menu.tsx` — first client component awaiting interaction-test coverage
- `src/app/(app)/tests/user-menu-helpers.spec.ts` — current helper-only coverage
- `vitest.config.ts` — current node-only test config
- T2 #1 PR (this Day's app-shell brand pass) — context for the gap surfacing
- `followup_admin_middleware_phase2.md` — sibling Phase 2 hardening item
