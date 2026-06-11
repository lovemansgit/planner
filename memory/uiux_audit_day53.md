---
name: Day-53/54 NIGHT — full-platform UI/UX audit + pre-UAT polish tier split
description: Operator-surface aesthetics/UX audit before the first Ops UAT, walked in run-sheet order at laptop + tablet widths. Severity/effort matrix + the hard Tier-1 (UI-only, ships tonight) vs Tier-2 (structural, parks for Love's post-UAT ruling) split. Directed by Love 2026-06-11.
type: reference
---

# Day-53/54 NIGHT — UI/UX audit (pre-UAT)

**Love's direction (verbatim):** "Love directs a full-platform aesthetics and
UI/UX audit toward a modern, optimized click-through application, executed before
UAT — with the reviewer's tier discipline: only changes that cannot alter a proven
flow ship tonight; structural recommendations park as a post-UAT lane for Love's
ruling. Directed by Love, 2026-06-11."

**Love's addendum (verbatim, 2026-06-11):** "Love rules all calendar views default
to MONTHLY everywhere. The consignee calendar already complies (R7.2/R9); the
consolidated all-deliveries calendar must now default to month as well. Week
remains available as a toggle option — only the default changes. Love also rules
the UAT run-sheet's pause/resume step carries a known-limitation note: resume
restores the calendar locally; vendor-side re-sync (R16) ships immediately after
UAT. Confirmed by Love, 2026-06-11."

Folded into this lane: (1) consolidated `/calendar` no-param default week → month
(`parseView`); no view/toggle removed; explicit `?view=` deep-links unchanged — an
**owner-ruled exception to the Tier-1 "no flow changes" line**, shipped tonight
WITH it, and re-verified in the Phase-4 run-sheet re-walk. (2) Brief v1.20
amendment (§3.3.3 + §3.3.4 default → month, superseding BRD §6.2.1/§6.4) rides the
code PR. (3) Run-sheet step H carries the pause/resume known-limitation line. (4)
`memory/followup_r16_resume_sf_reactivation.md` filed (first build after UAT, ahead
of the Tier-2 lane).

**Method.** Walked every operator surface in run-sheet order
(`memory/uat_run_sheet_v1.md`) against production `planner-olive-sigma.vercel.app`
as the UAT operator, screenshotting at **laptop (1280×800)** and **tablet
(768×1024)** — the UAT-room reality. Paired the visual walk with a file:line code
inventory of the design-token system (`src/styles/brand-tokens.css`) and shared
components. Session A's lanes excluded (credentials / regions / SF auth).

**Headline.** The app is **already well-built and consistent** — generous
whitespace, a real token system, clean typographic hierarchy, good empty-state
copy in most places. Findings are **refinement-level**, not defects. The two
genuinely visible-at-UAT items are the **tablet header overlap** and the
**unbranded default 404**; everything else is polish that compounds into "feels
finished."

---

## Per-screen walk

| Screen | Verdict | Notable |
|---|---|---|
| **Login** | Good | Button missing `duration-` on transition + no `disabled:` state; `py-3`/`text-sm` is an undocumented login-specific size (fine). |
| **Consignees list** | Strong | Hero strip + table clean. CRM badge bordered-pill consistent. |
| **Consignee overview** | Strong | Two-column contact dl, clear CTAs. Email cell has no truncation (long addresses can push layout). |
| **Consignee calendar (month)** | Strong | Day cells clean; "No deliveries" copy present in consolidated view but **absent on a fully-empty consignee month grid**. |
| **Day action popover** | Strong | 8 well-labelled action cards. **No focus-visible** on the cards or the calendar day trigger (keyboard + polish gap). |
| **Task timeline drawer** | OK | Loading = plain "Loading timeline…" text, **no skeleton** (user-initiated, so the wait is seen). |
| **POD lightbox** | Backdrop bug | Already a correctly-built centered modal (`PodLightboxModal`) — BUT its backdrop dim is invisible (the systemic scrim bug, finding 14). Expired rows show the broken-image placeholder (correct + proven). |
| **Tasks list** | Strong (laptop) | AWB / order# cells **not truncated** → can push columns; table **cramps at tablet** (see responsiveness). Inline action buttons miss the `transition-opacity duration-` the rest of the app uses. |
| **Failed pushes (DLQ)** | Strong | Excellent empty-state copy. Secondary buttons are the **most divergent** recipe (no `rounded-sm`, different hover, larger padding). Raw error string rendered without the bordered-alert wrapper used elsewhere. |
| **Subscriptions list** | Strong | Status badge is **borderless** here but **bordered pill** on the detail header — same state, two recipes. Hero numeral `text-7xl` vs `text-5xl` everywhere else. |
| **Subscriptions / new (form)** | Strong | Mode toggle + cadence chips + weekday toggles all consistent (navy-fill active / outline inactive). |
| **Consolidated calendar (All deliveries)** | Strong | 5 metric cards — a **third** hero-metric treatment (cards) vs list-page tinted-strip vs DLQ label-above. |
| **404 (any bad path)** | Weak | **Unbranded Next.js default** ("404 | This page could not be found.") — no chrome, no brand. |

---

## Findings by category (file:line)

### 1. Color tokens bypassed (Tailwind palette instead of brand ladder)
- `DayActionPopover.tsx:634,640` — `bg-stone-100 text-stone-700` (pending_cancel / pending_reschedule badges) → brand `bg-ivory` + `text-[color:var(--color-stone-600)]`.
- `DayActionPopover.tsx:645,771,831` — `bg-amber-50 text-amber-900` (failed-push badges) → brand `bg-[color:var(--color-amber-100)]` + `text-[color:var(--color-amber-deep)]`.
- `SearchBar.tsx:111` — `focus:bg-stone-100` → `focus:bg-ivory`.
- `Toast.tsx:92` — `bg-stone-100` → `bg-ivory`.

### 2. Button recipes diverge
- `/tasks` inline green buttons miss `transition-opacity duration-[120ms] ease-out`: `tasks/client.tsx:494` (Cancel), `:710` (Save address), `:759` (Save note). Login `:66` missing `duration-`.
- Failed-pushes secondary buttons (`failed-pushes/client.tsx:220,333,479`) use **no `rounded-sm`**, `hover:bg-[…surface-secondary]` (vs the app's `hover:opacity-80`), and larger padding — the outlier recipe.

### 3. Badge/pill recipes diverge (same concept, two looks)
- Subscription status: borderless text (`subscriptions/page.tsx:185`) vs bordered pill (`SubscriptionDetailHeader.tsx:90`).
- Task status: filled pill on `/tasks` (`status.ts:22`) vs flat text in `SubscriptionTasksList.tsx:132`.
- Sync badge: `text-[8px]/tracking-[0.08em]` on the calendar trigger vs `text-[10px]/tracking-[0.1em]` in the popover dialog (`DayActionPopover.tsx:756` vs `:831`).

### 4. Spacing / type ad-hoc values
- Tracking orphans: `tracking-[0.12em]` (`ConsigneesTable.tsx:87`, `PerMerchantBreakdownPanel.tsx:144,212`) and `tracking-[0.08em]` (`DayActionPopover.tsx:756,771`) — both should be `0.1em`.
- Hero numeral size divergence: `subscriptions/page.tsx:101` `text-7xl` vs `text-5xl` on consignees/tasks/failed-pushes.

### 5. Missing / weak states
- No skeleton: `TaskTimelineDrawer.tsx:147`, `tasks/client.tsx:558` (EditModal) — plain "Loading…" text.
- Asymmetric empty-state border + raw token: `HistoryTab.tsx:27` and `SubscriptionTab.tsx:62` use top-only `border-stone-200` (rest of app uses top+bottom `var(--color-border-strong)`).
- Empty calendar month/year: no zero-data copy on a fully-empty consignee grid.
- Raw error string (no alert wrapper): `failed-pushes/client.tsx:368`.

### 6. Focus/hover gaps (keyboard + polish)
`focus:outline-none` with no `focus-visible` replacement on buttons/links/rows: `DayActionPopover.tsx:745` (day trigger), `:859,:875,:889,:957` (cards/close), `tasks/client.tsx:205` (Print labels), `ConsigneesTable.tsx:54` (name link), `CalendarMonthView.tsx:113,119,126` (nav), `nav.tsx:74`, `user-menu.tsx:103`, `PodLightboxModal.tsx:110,126`.

### 7. Truncation / overflow
- `/tasks`: `customerOrderNumber` (`client.tsx:342`) and `externalTrackingNumber`/AWB (`:350`) — no truncation/max-width; push columns + cramp at tablet. **AWB must stay fully readable** → fix by letting the table scroll, not by truncating data.
- Email in consignee header (`consignees/[id]/page.tsx:348`), long plan name in `SubscriptionDetailHeader.tsx:27` — no truncation.

### 14. ⭐ Systemic — modal/drawer/lightbox backdrops render TRANSPARENT (highest-value find)
Every overlay uses `bg-navy/NN` (e.g. `bg-navy/20`, `/40`, `/50`). Because
`--color-navy` is defined as a **hex** (not RGB channels), Tailwind silently drops
the alpha and the backdrop computes to `rgba(0,0,0,0)` — **verified live**: the day
popover `[role=dialog]` backgroundColor is `rgba(0, 0, 0, 0)`. So **no modal in the
app has a dim backdrop** — they float on a full-brightness page and read as
unfinished. Affects: `DayActionPopover`, `PodLightboxModal`, `AdHocTaskDialog`,
`CrmStateModal`, `TaskTimelineDrawer`, tasks `CancelModal`/`EditModal`,
failed-pushes `BulkResolveModal` (+ regions modal, excluded). Same class also hits
`bg-stone-200/30`, `bg-surface-primary/90` (lightbox), and the alert recipe
`border-red/40 bg-red/10` (error/success alerts render as bare text). **Fix
(Tier-1, surgical):** a `--color-scrim: rgba(37,45,96,0.4)` token + `bg-scrim` on
the overlays — bakes the alpha in so it renders. Behavior identical (click-outside
uses ref containment, not the backdrop). The broad alert/tint cases need the
RGB-channel token refactor → Tier-2 (H4).

### 8. Responsiveness (tablet 768)
- **HIGH — header nav overlaps:** the wordmark and "Calendar" link overlap, and "mpl-admin" clips at the right edge. The horizontal nav doesn't reflow/collapse. Visible on **every** screen at tablet width.
- `/tasks` table cramps (columns merge, AWB wraps) but stays usable.

---

## Severity / effort matrix

| # | Finding | Severity | Effort | Tier | Shipped tonight? |
|---|---|---|---|---|---|
| 14 | ⭐ Modal backdrops render transparent | **High** | S (scrim token) | **T1** | ✅ |
| 8a | Tablet header overlap | **High** | M (proper) / S (guard) | **T1** guard; **T2** proper | ✅ guard |
| 13 | Unbranded 404 | **High** | S | **T1** | ✅ |
| 1 | Color tokens bypassed | Med | S | **T1** | ✅ |
| 6 | Focus-visible gaps | Med | M | **T1** | ✅ (key surfaces) |
| 12 | POD lightbox backdrop (= finding 14) | Med | S | **T1** | ✅ (via scrim) |
| 2 | Button transition/recipe gaps | Low | S | **T1** | ✅ tasks/login; ⛔ DLQ recipe (cut) |
| 4 | Tracking orphans | Low | S | **T1** | ✅ |
| 4b | Hero-numeral size divergence | Low | M | **T2** (entangled w/ H1) | ⛔ deferred |
| 5a | No loading skeletons | Low | S | **T1** | ✅ timeline + edit modal |
| 3 | Badge recipes diverge | Med | S–M | **T1** | ⛔ cut (review surface) |
| 7 | AWB/order#/email overflow | Med | S | **T1** | ⛔ cut (table scroll deferred) |
| 5b | Empty-state border asymmetry | Low | S | **T1** | ⛔ cut (micro) |
| 5c | Empty calendar zero-data copy | Low | S | **T1** | ⛔ cut |
| 5d | Raw error string (DLQ) | Low | S | **T1** |
| H1 | Hero-metric treatment unification (strip vs cards vs label) | Low | M | **T2** |
| H2 | 8-action popover grouping / click-reduction | Low | M | **T2** |
| H3 | POD "expired at vendor" styled message (vs broken-img) | Low | S | **T2** (touches proven state copy) |

---

## TIER 1 — ships tonight (UI-only, zero behavioral surface)

Every item below is a className/markup change that cannot rename, move, reorder,
or re-route anything the run sheet references, and cannot change a proven flow's
behavior. Status/action **labels are untouched** — only their styling.

1. **Color-token normalization** — finding 1 (badges, search focus, toast).
2. **Tracking + hero-size normalization** — finding 4.
3. **Badge recipe consistency** — finding 3 (give the borderless/flat variants the dominant filled/bordered recipe; labels unchanged).
4. **Button consistency** — finding 2 (add the standard transition; normalize the DLQ secondary recipe).
5. **Focus-visible** — finding 6 (additive ring/border on buttons, day trigger, popover cards, nav, rows, lightbox arrows).
6. **Empty/loading state quality** — findings 5a–5d (skeletons for timeline + edit modal; symmetric tokenized empty-state borders; empty-calendar copy; wrap the DLQ error in the standard alert).
7. **Truncation without hiding data** — finding 7 (email/plan-name `truncate`+`title`; `/tasks` table gets `overflow-x-auto` so AWB stays fully readable and the table scrolls instead of cramping).
8. **POD lightbox polish** — finding 12 (centre the panel with a dimmed backdrop; the broken-image/expired CONTENT is unchanged — proven flow intact).
9. **Branded 404** — finding 13 (`app/not-found.tsx` with app chrome).
10. **Header overlap guard (minimal)** — finding 8a, conservative form only: allow the header row to wrap / add min-widths so text never overlaps at tablet. NO structural nav change. (If this reads worse than the overlap on re-walk, it drops to T2.)

## TIER 2 — parks for Love's post-UAT ruling (structural / flow)

1. **Responsive nav redesign** (8a, proper) — collapse to a menu / dedicated tablet+mobile nav. Effort: M. The T1 guard only prevents overlap; a real responsive nav is a design decision.
2. **Hero-metric unification** (H1) — one treatment across list pages, DLQ, and the consolidated-calendar cards. Effort: M. Touches layout structure on 4+ pages.
3. **Click-reduction passes** (H2) — e.g. grouping the 8-action day popover into primary/secondary, collapsing the `/tasks` filter stack, a one-screen onboarding. Effort: M–L each; each alters a flow the run sheet walks → must be Love-ruled, re-scripted, re-proven.
4. **POD "expired at vendor" styled message** (H3) — replace the broken-image placeholder with a styled empty state. Effort: S, but it changes the observable POD expired-state the run sheet + proving record reference → Love-ruled.
5. **Component library extraction** — a shared `<Badge>` / `<Button>` / `<HeroCount>` to make recipe drift structurally impossible. Effort: L. Worth doing once the IA settles.
6. **H4 — RGB-channel token refactor (the root of finding 14).** Redefine the brand colors with `*-rgb` channel companions (`--color-navy-rgb: 37 45 96`) and map Tailwind to `rgb(var(--color-x-rgb) / <alpha-value>)`, so EVERY `color/NN` opacity modifier renders (alerts `border-red/40 bg-red/10`, tints, `border-green/30` badges, lightbox `/30`/`/90`). Tonight's scrim token fixes only the modal backdrops surgically; this is the foundational fix that makes all intended translucency work. Effort: M. Foundational → Love-ruled. Until it lands, error/success **alerts render as bare coloured text** (no pill) across the app.

## Owner-ruled exception shipped tonight (Love's addendum)

**Consolidated `/calendar` default view week → month** (finding outside the audit
— Love's direct ruling). This *does* change a flow's landing, so it would normally
be Tier-2; Love ruled it ships tonight. No view/toggle removed; `?view=week|day`
deep-links unchanged. Brief v1.20 records it. The Phase-4 re-walk re-verified the
calendar steps against the new month landing.

## Cuts (clock discipline — "fewer-clean beats all-rushed")

Cut from tonight's Tier-1 to keep the PR clean + reviewable, requeued: badge-recipe
unification (finding 3 — multi-surface, review surface), `/tasks` table
horizontal-scroll + truncation (finding 7), empty-state border symmetry (5b),
empty-calendar zero-data copy (5c), DLQ secondary-button recipe + raw-error-alert
wrapper (the DLQ is empty in the sandbox, so invisible at UAT anyway), hero-numeral
size (4b → Tier-2 H1). None are UAT-blocking; all are in the matrix above.

---

## Build note

Tier 1 ships as one code PR (split only if size demands honest review), RED-first
where testable, full suite green, tsc/eslint clean, cross-reviewed with the
reviewer explicitly verifying the Tier-1 line was not crossed. NO promote tonight
— Love clears, promote rides the morning with fresh smoke + preflight 10/10 before
UAT. If the clock tightens, fewer-clean beats all-rushed; cuts are named in the
park summary.

## Cross-references
- `memory/uat_run_sheet_v1.md` — the operator spine this walk followed.
- `memory/decision_d53_eve_final_clears.md` — UAT context.
- `src/styles/brand-tokens.css` — the token source of truth Tier 1 normalizes toward.
