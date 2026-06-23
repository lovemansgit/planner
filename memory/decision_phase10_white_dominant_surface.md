# Decision — Phase 10 Batch A0: white-dominant surface pass

**Date:** 2026-06-23 (Day 58 / Phase 10)
**Brief:** v1.33 → **v1.34** (§3.3.11 page-field amendment + §9 log row)
**Scope class:** src (CSS tokens + 2 route-group shells) + docs (brief). NO migration, NO auth, NO promote.
**Branch / PR:** `phase10/a0-white-dominant` off `origin/main` @ `e9a5d02`.

## Love's directive (verbatim, authorizing sentence)
> "lift the whole app to WHITE-DOMINANT (Love's standard) … Today the page field is
> `--color-paper` `#FAF8F4` (cream) … The cream page reads dull vs /welcome's white.
> Fix CENTRALLY."

## The ruling
The default **page field** is lifted from Snow White cream `#FAF8F4` to a warm
near-white **`#FCFBF8`** so WHITE dominates the field. Cream's warmth recedes to thin
framing/borders/section breaks (Ivory `#F2EEE6`, Stone 200, navy-alpha borders).

This touches a value that §3.3.11 listed under the **corporate-locked primary palette**
("Snow White `#FAF8F4` — Default page surface"), so per §10.5 it rides a brief amendment
(this file + §3.3.11 + §9 v1.34). **Snow White `#FAF8F4` is retained** as the warm
brand-white / framing reference; only the live page-field token (Paper /
`--color-surface-primary`) moves.

## Why `#FCFBF8` (the constrained design choice)
- **Floating cards must survive.** The Phase-9 B+ cards are `--color-b-card` `#fffdf8`
  (255 253 248) + `--shadow-b-card`. The field must stay *faintly* warm (R>G>B) and
  uniformly below the card on R/G so the card + shadow still read as floating.
- **Not stark white.** `#FFFFFF` was rejected — against pure white the warm card goes
  dingy and the "floating" read collapses (the page must keep a *faint warm backing*).
- `#FCFBF8` (252 251 248): a clear lift off cream (brighter + less yellow) that keeps the
  warm backing and the card-float gap. Verified by a static harness comparing
  `#FAF8F4` / `#FCFBF8` / `#FDFCFA` / `#FFFFFF` and by the real `/welcome` page.

## Mechanism (why this is central, not per-screen)
Every page paints its own field via `bg-surface-primary` / `bg-paper`; both resolve to the
two tokens. No `<body>` background, no hardcoded `#FAF8F4`, no `bg-white` anywhere — so
changing the two tokens cascades app-wide, **including `/login`** (outside the route
groups). The two route-group shells (`src/app/(app)/layout.tsx`,
`src/app/(admin)/layout.tsx`) additionally wrap their content in a single
`min-h-screen bg-paper` field so the white-dominant field is owned centrally (covers
loading states / short-content gaps / future pages). **No per-screen `<main>` edits.**

## Explicitly unchanged
Navy / green / amber / red, status-badge tones, DataTable LED tones, all shadows,
`--color-ivory` / `--color-surface-secondary` / `--color-stone-200`, `--color-b-card`,
and the composition ratio (white still ~58%).

## Owner-clearance flag (Floor 2)
This changes a corporate-locked brand value. Love's directive above is the authorizing
sentence; the change is surfaced in the PR as an owner-clearance item and is cleared when
Love clears the PR. No self-merge; no promote.

## Verification
- Static card-float harness (decisive) + real `/welcome` screenshot (white-dominant field,
  cards float). `/login` not screenshot-able locally (no `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  in `.env.local` per project convention — environmental, not a regression; `/login` is
  outside the route groups so the shell wrappers don't even apply to it).
- Real `next build` exit 0 (the dynamic-Tailwind compile gate), `tsc --noEmit` 0,
  `eslint .` 0 errors, `vitest --project unit` 2519 passing.
- 3 authed B+ surfaces (`/welcome` proper post-login, admin Subscriptions, admin Consignee
  detail) → Love's authed browser walk at PR review.

## Downstream
Blocks the Phase-10 coverage batches — they rebase on this once it lands.
