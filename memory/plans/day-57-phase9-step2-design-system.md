# Phase 9 · Step 2 — Design-System Proposal

**Lane:** design-proposal (docs + static mockups only). **Status:** for Love's directional ruling.
**Input:** Phase 9 Step 1 audit — `audit/PHASE-9-VISUAL-AUDIT.md` on branch `phase9/visual-audit` (the 10 gaps A–J).
**Grounded against:** the existing partial kit (`src/components/Button.tsx`, `Badge.tsx`, `HeroCount.tsx`, `button-recipe.ts`, `badge-recipe.ts`), brand tokens (`src/styles/brand-tokens.css`), and `decision_d54_component_library_closeout.md`.

> **What this is / isn't.** This proposes the shared component layer that the audit showed is missing, and asks you to rule on four token choices. **It builds nothing into the product** — no screen is refactored here. The actual rebuild is **Step 3**, which stays parked until you approve this. If you want to *see* the direction, three static mockups are linked in §5.

---

## 0. Decision sheet — four rulings I need from you

Each is one plain-English choice with my recommendation. Everything in §3 is designed around these; if you pick differently, I adjust the spec. **None of these change any screen today.**

| # | Decision | Options | My recommendation | Why |
|---|----------|---------|-------------------|-----|
| **D1** | **One primary *action-button* colour** | Green or Navy | **Green** (`#3e7c4b`); navy becomes the *secondary* | 30 files already hand-roll green for the main "Onboard / New" actions; the shared navy button is used on exactly **one** utility surface (failed-pushes). Green is already the de-facto primary — make it official, make navy the secondary. |
| **D2** | **One casing system** | Sentence-case human-facing / UPPERCASE everywhere / mixed (today) | **Sentence-case** for all human-facing text (titles, labels, values, buttons); reserve **UPPERCASE only for tiny eyebrows** (10–11px) | The uppercase-everywhere habit is both the "shouty" feel *and* a mechanical cause of button wrapping (uppercase + letter-spacing widens text ~15%, so "RESET PASSWORD" / "REFRESH NOW" overflow). Sentence-case is calmer and fits. |
| **D3** | **Detail-page width + layout** | Two-column fill / keep stranded ~560px left column | **Two-column fill** inside one shared max-width (~1200px) | Admin detail pages strand the entire right half of the screen; the merchant consignee detail already shows the better two-column treatment. Unify on it. |
| **D4** | **Humanise + one vocabulary** | Adopt / leave raw | **Adopt** — names not IDs, human role labels not slugs, formatted phones, operator language; **canonical entity noun = "consignee"** (retire "subscriber"/"merchant subscriber") | The product currently shows raw UUIDs, role slugs, E.164 phones, and engineer words ("DLQ", "cron") to operators, and calls one entity three names. One vocabulary + a formatting layer fixes a whole class of "looks unfinished." |

> **Note on D4 scope:** the **task-status** wording/filter is owned by the in-flight fast-follow lane (see §4) — this proposal does *not* restyle task status. D4's recommendation covers the *general* rule plus the non-task surfaces (the consignee/subscriber noun, and retiring "DLQ/cron/dead-letter" on the failed-pushes & webhook surfaces).

---

## 1. The thesis (one paragraph)

The audit's ten gaps are one root cause: **shells were extracted but never generalised or adopted** (the shared code exists, but ~30 pages ignore it and hand-roll their own). Day-54 created good primitives (`Button`, `Badge`, `HeroCount`) by lifting them from one surface each, locked them with recipe tests, and stopped. So today the product has *both* a shared layer *and* thirty hand-rolled buttons, *both* a Badge shell *and* four ways to draw a status. **Step 2 is to finish the layer — extend what exists, build the seven primitives that are genuinely missing, and define the token rules (D1–D4) so the layer can actually hold the line.** Step 3 then routes screens through it, one PR at a time.

---

## 2. State of the existing kit (so we extend, not rebuild)

| Primitive | Status | Evidence | Verdict |
|-----------|--------|----------|---------|
| `Button` + `button-recipe` | **Exists, ignored + under-specified** | Imported in **1** file; **30** raw `<button>`s elsewhere. Only `filled-navy` / `outline`, **uppercase-locked**, no green primary, no `nowrap`, no `lg`. A separate `OutlineButton` (4 files) and an **unbuilt "CTA-Link"** (the green `<a>` "Onboard/New" actions) exist alongside it. | **Extend + unify + adopt** |
| `Badge` + `badge-recipe` | **Shell exists, semantics missing** | Imported in **2** files; it's a *colourless* shell — each caller injects its own status colour. Subscriptions' dot+text and Consignees' strikethrough bypass it entirely (the dot was a **recorded deferral**). | **Extend (add status map)** |
| `HeroCount` | **Exists, adopted** | **5** files. The list-page big-count strip; its trailing-control slot is **by design** (so the "/tasks per-page-in-card" the audit flagged is intentional, not a bug). | **Keep + widen adoption** |
| Type scale tokens | **Exist, under-enforced** | Full scale in `brand-tokens.css` (display / body / caption / eyebrow + 3 faces). Weights/tracking are "declared per component", so the scale isn't applied as a system. | **Adopt via text utilities** |
| `Table` / `DataTable` | **Missing** | **14** hand-rolled `<table>` blocks; no component. | **Build** |
| `DetailView` / `FieldRow` | **Missing** | Two unrelated hand-rolled detail systems (admin uppercase single-col vs merchant sentence-case two-col). | **Build** |
| `PageShell` | **Missing** | Page width is 560 / 900 / full at random. | **Build** |
| Form controls (`Select`/`Input`/`Field`…) | **Missing** | **13** native `<select>`; custom inputs hand-rolled; good one-offs (chips, segmented, preview) not shared. | **Build + promote one-offs** |
| `EmptyState` | **Missing** | Four different empty treatments. | **Build** |
| Humanise / formatters | **Missing** | Grep finds **zero** `formatPhone` / `roleLabel` / `statusLabel` utilities. | **Build** |

---

## 3. Per-gap component spec (A–J)

For each: **verdict**, the **proposed API in plain names** (no code), the **token choice it locks in**, and the **audited surfaces it fixes** (surface codes are from the Step 1 catalogue, e.g. `A13` = admin Users, `M2` = merchant Tasks).

### Gap A — `Button` → **EXTEND + UNIFY + ADOPT**
One button primitive replaces three things (`Button`, `OutlineButton`, the unbuilt green CTA-Link) and the 30 hand-rolls.
- **Variants:** `primary` (green filled — **D1**), `secondary` (navy outline), `ghost` (text-only, replaces bare text "Cancel" links), `danger` (red, for Disable/Deactivate/Delete).
- **Sizes:** `sm` / `md` / `lg` — each a **fixed height** with a **minimum width**.
- **Invariant (non-negotiable):** button text **never wraps** (`white-space: nowrap`). Name it explicitly — this one rule is the mechanical fix for every Reset/Refresh/New-X wrap, and Step 3 must not omit it.
- **Renders as** either a `<button>` or a link (`<a>`/`Link`) without changing appearance — so the green "Onboard new consignee" anchor and the navy form-submit are the *same* component.
- **Casing** follows the global rule (**D2** → sentence-case).
- **Locks:** the one primary colour (D1), no-wrap, one size ladder.
- **Fixes:** A1 "+ New merchant" wrap, A13 Reset/Disable mismatch, A17/A19 "Refresh now" wrap, A20 "+ New region" wrap; A2-vs-A3 outline-vs-filled "Update merchant"; A15-vs-A22 navy-vs-green primary; M4/M8 green-vs-navy.

### Gap B — `StatusBadge` → **EXTEND** (semantic layer over the existing `Badge` shell)
The `Badge` shell stays; this adds the missing **status → {label, colour, icon}** map so a status renders one way everywhere.
- **Props:** `status` (the raw enum value) + `domain` (`task` / `subscription` / `crm` / `push`). The component owns the mapping — callers never pick a colour again.
- **Push status is a binary lifecycle** (`unresolved` / `resolved`). The failure *reason* (`client_4xx`, `past_dated`, …) is a separate humanised field via Gap J — **not** a status pill. (So the resolved-pushes table shows a Resolved/Unresolved pill **plus** a readable reason, never the raw enum.)
- **Tones** drawn from tokens: green = healthy/active, amber = paused/attention, red = failed/at-risk, stone = ended/neutral, navy = created/new.
- One **pill** geometry everywhere — retires dot+text, strikethrough, bare-text, and icon-only variants.
- **Locks:** the four-styles-become-one rule; humanised status labels (D4) — "Created", not "CREATED"; "Skipped", not blank.
- **Fixes:** A1/A9/A11 differing status styles, A8/A12 status-shown-twice, A9 CHURNED strikethrough, M9/M14 raw enum codes. **Boundary:** *proposed* here but **not applied to `/tasks` or `/admin/tasks`** — the fast-follow lane owns task-status rendering (§4).

### Gap C — `Table` (`DataTable`) → **BUILD**
- **Props:** `columns` (each: header label, alignment, min-width, `truncate?`, `mono?`, `priority` for responsive hide order), `rows`, `density` (`comfortable` / `compact`), `rowAction?`, `selectable?`.
- **Always:** header text **never wraps**; cells **truncate with tooltip** past their min-width; a defined **mobile behaviour** (stack each row into a labelled card below a breakpoint).
- **Locks:** one table density, one header rule, one responsive rule.
- **Fixes:** every header-wrap (A17/A19/M14), M2 desktop overflow, A13 date/email/name wrap, M14 UUID-wrapping, all mobile table overflow.

### Gap D — `DetailView` + `DetailHeader` + `FieldRow` → **BUILD** (unifies admin & merchant)
- **`DetailView`:** wraps `PageShell` + a `DetailHeader` + ordered `Section`s of `FieldRow`s laid out in a **two-column grid** (D3).
- **`DetailHeader` props:** eyebrow, title, `StatusBadge`, primary/secondary actions slot, optional tabs.
- **`FieldRow` props:** label, value, `empty?` (renders the shared `EmptyState` inline value, not a bare "—"), `mono?`. One **label-casing** rule (D2).
- **Locks:** admin and merchant detail become *one* system; one label casing; the recurring **"Auth method" indent bug** (A2/A21) dies because every value renders through the same row.
- **Fixes:** A2/A8/A10/A12 vs M5/M9 divergence, A2/A21 indent bug, stranded width (D3), "—" empties.

### Gap E — `PageShell` → **BUILD**
- **Props:** `maxWidth` (one shared content width, ~1200px — the **exact** number is confirmed in Step 3; D3 approves the *two-column-fill direction*, not a specific pixel value), eyebrow, title, subtitle, actions slot, optional stat slot.
- One max-width + content grid for **every** page; detail pages fill it (D3) instead of stranding the right half.
- **Locks:** the 560 / 900 / full chaos → one width system.
- **Fixes:** A2/A4/A14 width inconsistency; the stranded right half on every detail/form page.

### Gap F — Stat surfaces → **EXTEND `HeroCount` + BUILD `MetricCard`/`MetricGrid`**
Two genuinely different needs, today muddled:
- **List count** → keep `HeroCount` (extend adoption to the admin Subscriptions list, A11, which lacks one).
- **Dashboard metrics** (the 5-card Overview/Calendar grid) → new **`MetricCard`** (label, value, sublabel, `tone` default/alert) in a **`MetricGrid`**. The pink "Failed" card becomes `tone="alert"`.
- **Locks:** one list-count strip + one dashboard metric card (today they're conflated).
- **Fixes:** A6-vs-A1/A7 two stat-card systems; A11 missing count. (The "/tasks per-page-in-card" is **not** a defect — it's HeroCount's trailing slot; documented so Step 3 doesn't "fix" it.)

### Gap G — Form kit → **BUILD + PROMOTE the good one-offs**
- **Core:** `Field` (label + control + help + optional `Optional` tag + error), `TextInput`, `Textarea`, `Select` (styled — retires the 13 native selects), `DateField`, `TimeField`.
- **Promote to shared** (they already exist as good one-offs, just not reusable): `RadioCardGroup` (from A22 region/new), `ChipToggle` (the day-of-week chips, M10/M11), `SegmentedControl` (calendar + sub/new), `PreviewPanel` (the "will create 23 deliveries" card, M11).
- **Locks:** placeholders look like placeholders (a styling rule so example text can't be mistaken for a value, A3); one control system.
- **Fixes:** native-select inconsistency (A7/A15/M3/M11), A3 placeholder-as-value, scattered input styles; makes the good patterns standard.

### Gap H — `EmptyState` → **BUILD**
- **Props:** title, body, optional action, optional icon, `variant` (`block` for empty pages/lists, `inline` for empty field values).
- Used for empty lists *and* empty fields — the `inline` variant replaces every bare "—".
- **Locks:** one empty treatment (today there are four).
- **Fixes:** A18 card vs M13 plain-text vs A2 "—" vs empty-list-nothing.

### Gap I — Type / casing / format tokens → **ADOPT (scale exists) + ADD casing rule + formatters**
- **Text utilities** that apply the *existing* scale tokens: `Display`, `Heading`, `Body`, `Caption`, `Eyebrow` (so the scale is used as a system, not re-declared per component).
- **The one casing rule (D2):** sentence-case human-facing; uppercase only on `Eyebrow`.
- **Mono rule:** monospace reserved for true machine identifiers shown deliberately (AWB/order #), never for names, dates, or labels.
- **Formatters** (shared, see Gap J): one date format, one time format (no stray seconds — fixes A8/A12), one phone format, and one **cadence** format — consecutive weekdays collapse to a range ("Mon–Fri"), non-consecutive days stay a comma list ("Mon, Wed, Fri"), all seven = "Daily" (fixes A11's verbose cadence).
- **Fixes:** A4 casing chaos, A8 mono-overload, A11-vs-A12 time-seconds mismatch.

### Gap J — Humanise layer + one vocabulary → **BUILD**
- **Formatters:** `formatPhone` (E.164 → "+971 50 333 3333"), `roleLabel` (slug → "Tenant Admin"), `statusLabel` (enum → "Created"), and a rule that **raw UUIDs/hashes never render** (show the name; if an ID is truly needed, label it and shorten it).
- **One vocabulary doc:** one noun per entity (**"consignee"** — retire "subscriber"/"merchant subscriber", D4); operator language (retire "DLQ"/"dead-letter"/"cron"/"deferred to a future commit" on M13/M15 → "Failed delivery pushes" / "automatic retries").
- **Locks:** D4.
- **Fixes:** A11 hash (already fixed by FIX 3 — see §4), A13/A14 role slug-vs-label, A9/A10 raw phones, M1 noun drift, M13/M15 engineer-speak, M14 raw enums.
- **Boundary:** the **task-status** vocabulary is the fast-follow lane's (§4) — this proposes the rule and the non-task surfaces only.

---

## 4. Prioritised remediation order for Step 3 (the future rebuild)

**Not started here.** Each item below is a future, separately-reviewed PR, gated on your approval of this proposal. **No screen is refactored in this lane.**

**Already owned by the in-flight functional lane — do NOT re-scope in Step 3:**
- 🟢 **Test-data fence** on Overview/dashboard counts, top-10, breakdown — **FIX 2 (#555)**, approved/in-flight.
- 🟢 **Admin subscriptions consignee-name** render — **FIX 3 (#556)**, **done on main** (`79e2220`).
- 🟢 **Task status filter + dropdown vocabulary + ON_HOLD** rendering — **fast-follow lane**. (StatusBadge is *proposed* in Gap B but task surfaces are not refactored onto it by this lane.)

**Design-system rebuild order (recommended sequencing, by leverage × risk):**

| Step | Bundle | Why this order |
|------|--------|----------------|
| 3.1 | **Foundations:** `PageShell` + text utilities + casing rule + formatters (Gaps E, I, J) | Pure-additive, unblocks everything, near-zero visual risk. Locks D2/D3/D4. |
| 3.2 | **`Button` unification + adoption** (Gap A) | Highest visibility, fixes the most-flagged defects (all the wraps + colour splits). Locks D1. |
| 3.3 | **`StatusBadge`** (Gap B) — CRM / subscription / push surfaces only | One status render. *Excludes task surfaces (fast-follow owns them).* |
| 3.4 | **`Table`** (Gap C) | The core of the product; fixes overflow + header-wrap across every list/report at once. |
| 3.5 | **`DetailView` + `FieldRow`** (Gap D) | Unifies admin/merchant detail; kills the Auth-method indent bug; applies D3. |
| 3.6 | **Form kit + `EmptyState` + `MetricCard`** (Gaps G, H, F) | Forms, empties, dashboards; promotes the good one-offs. |
| 3.7 | **Vocabulary rollout** (Gap J) on non-task surfaces | Rename "Failed pushes"/webhook language; one entity noun. |

**Highest-impact, lowest-risk single move overall** is the test-data cleanup — but that's the functional lane's (FIX 2), so it's flagged here for sequencing only, not re-scoped.

---

## 5. Static mockups (illustrative — not production components)

Standalone HTML, real brand-token hex values inline, **no wiring into the app**. They show the dense-console direction for the three highest-impact primitives so you can see it before ruling.

- **`day-57-phase9-step2-mockups/table.html`** — the `Table` direction: dense rows, nowrap headers, truncation, a mobile-stacked card. Shows the admin Subscriptions list with **names** (not the hash) and condensed cadence.
- **`day-57-phase9-step2-mockups/status-badges.html`** — the `StatusBadge` map: every status (task / subscription / CRM / push) rendered as one pill family, beside the four current styles for contrast.
- **`day-57-phase9-step2-mockups/detail-view.html`** — the `DetailView`: two-column fill, sentence-case labels, shared `FieldRow`, `EmptyState` inline values, one header with `StatusBadge` + buttons — the same template for admin *and* merchant.

> Open them in a browser. They are **direction, not the build** — final tokens come from your D1–D4 rulings.

---

## 6. Boundaries honoured & open defaults

- **No product-screen edits, no migrations, no DB.** Docs + standalone mockups only. Nothing routed through new components.
- **Collision avoidance:** did not touch admin overview/calendar queries, the genuine-tenant fence, the admin-subscriptions consignee render, or any `/tasks`/`/admin/tasks` status rendering or filters. (Task surfaces = `/tasks` and `/admin/tasks` **only**; the failed-pushes [M13] and webhook-config [M15] vocabulary rename in Gap J **is** in scope — those aren't task-status surfaces.)
- **Defaults taken (recorded, non-blocking):** (i) canonical entity noun = "consignee"; (ii) Step-3 sequencing as in §4; (iii) mockups cover Table/StatusBadge/DetailView (the three the task named). Each is reversible by your ruling.

**Decision needed from you:** the four rulings in §0 (D1–D4). Everything else is mechanical once those are set. On approval, Step 3 begins as the sequence in §4 — one reviewed PR per bundle, still nothing merged to a live screen until each passes review.
