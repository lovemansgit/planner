---
name: Header logo height balance — Phase 2
description: Day-21 PR #229 (header alignment brand-pass) closed the inner-Link items-end→items-center two-tier feel. Logo height itself (h-14 = 56px) still dominates the row vs. menu typography. Post-May-15 follow-up.
type: project
---

# Header logo height balance — Phase 2 follow-up

**Filed:** Day 21 (10 May 2026), Session B.
**Source:** Love's walkthrough on `day21/header-alignment-brand-pass`
@ commit `f599941` (PR #229). Visual gate cleared posture (a) — single
horizontal centerline — but Love noted: "could do with better
alignment, but post-MVP."
**Trigger:** post-May-15 demo (Phase 2 cleanup window).
**Tier when closed:** T1 brand-pass.

---

## §1 What's resolved (closed at PR #229)

- Both nav surfaces (`TopNav` operator + `AdminTopNav` admin) flipped
  inner Link from `items-end` → `items-center`. Wordmark sits at the
  logo's vertical centerline rather than hanging at the bottom edge.
- Single horizontal line per parent row's `items-center`. No more
  wordmark-below-menu-items two-tier feel.
- Two-line patch, no new tokens, no scope creep.

## §2 What remains (Phase 2 surface)

The logo image at `h-14` (56px) is materially taller than the menu
items + user-dropdown text (text-sm font-medium ≈ 20-22px tall).
Even with vertical-center alignment:

- Logo image top extends ~17px above menu-item top
- Logo image bottom extends ~17px below menu-item bottom
- Visual weight of the logo image dominates the header height

This contradicts the SaaS-dashboard convention Love anchored on
(Linear / Vercel / Stripe). Linear's logo is ~24px in their nav,
Vercel ~26px, Stripe ~32px — all sized to match menu typography.

## §3 Closure path options (decide at trigger time)

**(a) Shrink logo to match menu typography** — change `h-14` to
`h-8` (32px) or `h-10` (40px). Wordmark stays inline (already
items-center). Keeps brand identity present without dominating.
Smallest LOC, lowest risk.

**(b) Normalize header to fixed-height row** — set the `<div>` row
to `h-12` (48px) explicitly. Logo `h-auto max-h-full`. Menu items
auto-center. Cleaner constraint expression but more refactor.

**(c) Bump menu typography** — go the other direction; menu items
become text-base font-medium (16px) so they meet the logo's visual
weight halfway. Trade-off: nav becomes denser visually; less
SaaS-clean.

Recommend (a) at trigger time — least scope, highest visual ROI.

## §4 What NOT to do

- ❌ Don't add new design tokens. The logo `h-{N}` value comes from
  the existing Tailwind scale.
- ❌ Don't change the wordmark typography or padding. Already
  brand-canon (Manrope display, tracking-[0.2em], leading-none).
- ❌ Don't touch (`(app)/user-menu.tsx` — the trigger button is
  brand-canon and unrelated to this surface.

## §5 Trigger

Phase 2 cleanup window opens post-May-15 demo per brief §5.1 timeline.
First brand-pass cycle in that window picks this up. Until then, the
PR #229 alignment fix is the demo-grade posture.
