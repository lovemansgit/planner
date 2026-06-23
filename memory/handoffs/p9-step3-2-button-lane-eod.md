# Phase 9 Step 3.2 — Button unification to Direction B · EOD state memo

**Lane:** unify every button onto one shared `<Button>`, skinned to Direction B ("Dispatch").
**Date:** 2026-06-22 (overnight). **Builder:** autonomous. **Promote:** NOT done (Love's separate ruling).

---

## Headline — one Love-only gate blocks ALL three merges

Direction B is Love's pick **per this lane's build dispatch** ("DIRECTION LOCKED: Love picked B"). But the isolated reviewer (invoked with PR# only, body-reads git at the SHA) **cannot see the dispatch**, so it correctly parks Bundle 1 on a directional question it isn't allowed to settle: *which visual direction the whole app adopts is Love's product call, and it isn't recorded durably in git.* PR #568 (the "pick one of three" exploration) is still **open, unmerged, no recorded ruling**, and the source mockup `direction-b-dispatch.html` only lives on the #568 branch (not main).

**To unblock the whole stack, Love records the Direction-B pick durably** — either:
- post a `LOVE-RULING` comment on #572 choosing Direction B, and/or
- **merge #568** (lands the mockups + README on main → the pick is recorded AND the recipe's cited source file becomes verifiable).

The engineering is clean and reviewer-confirmed; only this record is missing. Building proceeded per Love's explicit dispatch ("proceed straight to the build … each bundle to an open PR").

---

## Bundles opened (stacked: #574 → #573 → #572 → main)

| PR | Bundle | Scope | Reviewer | Mergeable when |
|----|--------|-------|----------|----------------|
| **#572** | 1 — Button component → Direction B | component + fonts + tokens + recipe tests + visual check; **no screen migrated** | r1 REQUEST_CHANGES → **fixed** r2; engineering clean, parked on the Love directional record | Love records Direction-B pick |
| **#573** | 2 — admin form buttons | 6 admin submit/action buttons → unified Button | **APPROVE** r1 (flag: #572 merges first) | after #572 |
| **#574** | 3 — operator/admin-subs buttons | 2 clean raw-button swaps | pending (dispatched) | after #573 |

**Merge order: #572 → #573 → #574** (GitHub base-branch rule enforces it).

### Bundle 1 (#572) detail
- Extended `<Button>`: variants `primary`/`secondary`/`ghost`/`danger` (only primary lifts — round-0 cut), sizes `sm`/`md`/`lg` (fixed height + min-width), label never wraps, default/hover/active/disabled/loading + visible green focus ring (outline-based), `aria-disabled`/`aria-busy` + disabled-tooltip, polymorphic (`<button>` or Next `<Link>`), sentence-case (D2).
- Fonts: wired Hanken / Bricolage / IBM Plex Mono via `next/font` + tokens + Tailwind. **Only `<Button>` uses Hanken; global app faces stay Manrope/Mulish (no app-wide reskin).**
- Migration discipline: legacy `outline`/`filled` + `tone` and `<OutlineButton>` marked `@deprecated`, NOT deleted.
- **Reviewer-caught regression (fixed):** initial default `variant` flip `outline`→`primary` silently re-skinned the live `/admin/failed-pushes` (its 4 no-variant `<Button>`s). Fix: default stays `outline` → failed-pushes byte-identical.
- Recorded deviations: focus = offset outline ring (vs mockup glow, a11y+robustness); danger uses brand red token `#d93a2b` (not mockup `#c0392b`).

---

## Sites migrated (8 buttons)

| Bundle | File | Mapping |
|--------|------|---------|
| 2 | CreateMerchantForm / EditMerchantForm / CreateRegionForm submits | → `primary` |
| 2 | **UserCreateForm / UserEditForm submits (were NAVY)** | → `primary` — **fixes audit Gap A** (navy-vs-green primary split) |
| 2 | UserEnableButton | → `secondary` sm |
| 3 | CreateConsigneeForm submit | → `primary` |
| 3 | MaterializeButton (admin subs) | → `secondary` sm |

All pure visual swaps: no onClick/submit/destination/label changed. Each bundle: `tsc` clean, `eslint` clean, **2435/2435 unit tests pass**.

---

## Sites SKIPPED (recorded — not silently dropped)

1. **`FormSubmitButton` (`@/components/forms/FormSubmitButton`) — a THIRD shared button primitive the original ground-truth didn't list.** Used by SubscriptionWithModeForm + PauseResumeActions submits (and likely other forms). Needs its **own unification bundle** into `<Button>`; half-migrating a file leaves a 3-way mix.
2. **DayActionPopover** (12 buttons, calendar action state-machine) + dialogs **AdHocTaskDialog / AddAddressDialog / CrmStateModal / ForwardOverrideConfirmDialog** — entangled modal/popover state; not clean visual-only swaps. Deferred.
3. **Cancel `<Link>`s + page CTA `<Link>`s** ("+ New merchant/region/user", "Onboard new consignee", "New subscription", per-consignee New-subscription) — these are **server-component** links. `<Button>` as a `<Link>` from a server component needs a small refinement: **bind onClick only when provided** (today the link branch always binds a handler, which would throw "functions can't cross the server/client boundary"). Carry that refinement in the **link bundle**.
4. **Destructive-modal triggers** (Disable / Deactivate / Reset password / Pause) — these are the audit's button-size-mismatch flags (#2/#3, "RESET PASSWORD wraps"). High value but live inside modal components; own bundle (→ `danger` + ghost/secondary pairs).
5. **`/tasks` + `/admin/tasks`** — boundary (status-filter lane). Untouched. `<OutlineButton>`'s only caller is here → can't delete it yet.
6. **failed-pushes** — still on the deprecated `outline`/`filled` Button → those variants can't be deleted yet.

---

## Lane-B (vocabulary) collisions

**None hit.** This lane changed zero label text / copy. Note: `EditMerchantForm` submit still reads `"UPDATE MERCHANT"` (uppercase, verbatim) — left exactly as-is; the casing fix is Lane B's.

---

## Recommended next bundles (order)

1. **Link bundle** — Button shared-component refinement (conditional onClick) + migrate the Cancel `<Link>`s and the page "+ New / Onboard" CTA `<Link>`s → `primary`/`ghost`. (Fixes the audit's "+ New X wraps" flag.)
2. **FormSubmitButton unification** → `<Button variant=primary>`; retire `FormSubmitButton`.
3. **Destructive-modal triggers** → `danger` (fixes audit #2/#3 size mismatch) + modal Cancel/confirm pairs.
4. **failed-pushes** → new variants, then **delete** old `outline`/`filled` Button variants.
5. **tasks boundary** buttons (coordinate w/ status-filter lane), then **delete `<OutlineButton>`** once no caller remains.
6. **Typography bundle** (separate) — global face swap Manrope/Mulish → Bricolage/Hanken needs a brief §3.3.11 amendment; out of scope for the button lane.

---

## Verification summary

`tsc --noEmit` clean · `eslint` clean (touched files) · **2435/2435 unit tests pass** on each bundle · Bundle 1 round-0 visual check: built button family rendered from the resolved recipe matched the Direction-B mockup gallery (variants, states, sizes, the lift). Promote NOT done (Love's separate ruling).
