# ADR-006 · Next.js 16, not 15, for the pilot

## Status

Accepted · 25 April 2026 · Supersedes the Next.js 15 reference in ADR-005 §3.5 and §11.2 #1.

## Context

The build plan was written on 24 April 2026 and referenced Next.js 15 as the current stable line. By 25 April — the day engineering mobilisation begins — the 15.x line has moved to backport-only maintenance under the npm `backport` dist-tag; the active stable line is `next@16.2.4`. Pinning the originally specified `next@15.1.0` resolves to a release that carries unpatched issues from the December 2025 advisory batch, including a CVSS 10.0 remote code execution vulnerability affecting the React Flight protocol. Starting a 14-day greenfield pilot on a known-vulnerable, backport-only major is incorrect; a 15 → 16 migration would be required within months regardless.

## Decision

Pin `next` and `eslint-config-next` to `16.2.4`. Pin `react` and `react-dom` to `19.2.0` to match the Next.js 16 peer requirement. Wherever the v2.1 plan refers to "Next.js 15," read "Next.js 16." ADR-005 itself is left untouched as the historical record of the 24 April decision.

## Consequences

- **Positive — Turbopack is the default bundler in Next.js 16.** Faster local dev and CI build iteration, no configuration change needed.
- **Positive — React 19.2 adopted automatically.** View Transitions and `useEffectEvent` become available; we are not required to use them, but the option is open as the UI builds out from Day 5 onward.
- **Negative — `params` and `searchParams` are now async props in route handlers and pages.** Each new route uses `const { id } = await params` rather than the Next.js 15 sync pattern. Handled inline as routes are built; non-blocking at commit 1 because no routes exist yet.
- **Negative — Some Next.js 15 examples in older documentation will not work as-is.** Mitigated by referencing the Next.js 16 migration guide rather than ad-hoc StackOverflow answers.
- **Reversible — yes.** Downgrading is a `package.json` change plus reverting any routes that adopted async-params idioms; the cost grows with each route added on 16, but at commit 1 it is zero.
