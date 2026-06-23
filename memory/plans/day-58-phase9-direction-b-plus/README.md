# Phase 9 · Direction B+ — Dispatch, instrumented

**Lane:** design refinement (docs + standalone mockup only). **Status:** the durable B+ record, for Love's morning ruling.
**Inputs:** the approved Direction **B / Dispatch** (`../day-57-phase9-visual-directions/direction-b-dispatch.html`, #568) and Direction **C / Terminal** (`../day-57-phase9-visual-directions/direction-c-terminal.html`) as the borrow source; the merged Step-2 design-system contract (`../day-57-phase9-step2-design-system.md`, #558); the Step-1 audit.
**Method:** the `frontend-design` skill — the direction was pinned by Love (B+), so this is *execution*, not exploration: brainstorm → build → screenshot-critique → cut.

> **What this is / isn't.** Love approved Direction B, then refined it to **"B+"** — keep B's warmth and restraint, borrow the two things Terminal did best, and fix Terminal's one real problem. This file is the single static mockup of that blend plus this record. It is **direction, not the build** — no product code, no screen touched, no migration. B+ becomes the skin contract the Step-3 bundles (3.3 StatusBadge → 3.4 Table → 3.5 DetailView → 3.6 Form/Empty/Metric) execute to.

---

## How to view

```
cd memory/plans/day-58-phase9-direction-b-plus
python3 -m http.server 8812
# then open http://localhost:8812/direction-b-plus.html
```

`direction-b-plus.html` renders the three premium-carrying surfaces on one page, the same set B and C used so you can compare like-for-like: **① table** (admin Subscriptions — the real data shape), **② detail view** (consignee, two-column fill), **③ the button family** (primary / secondary / ghost / danger + states).

---

## The B+ brief, in three moves

### KEEP from B (Dispatch) — the base is unchanged
- The **warm cream working field** (`#efeae0`) with **floating warm-white cards** (`#fffdf8`) and soft navy-tinted depth.
- **Restraint / minimalism** — quiet surfaces, one accent.
- **Bricolage Grotesque** (display, carries consignee names with warmth) + **Hanken Grotesk** (body).
- **Comfortable density** — 54px rows, kept deliberately (Terminal went 38px; B+ keeps the room the signature needs).
- **The signature — the delivery-window track.** Every window drawn as a green bar on a faint 06:00→22:00 day baseline, so an operator reads the day's load as a *shape* down the column instead of parsing six near-identical time strings. **Boldness is spent here and only here** — everything borrowed below stays quiet around it.

### BORROW from C (Terminal) — instrumentation, made quiet
- **Monospace tabular figures on *all* numerics** (IBM Plex Mono): times, dates, windows, counts, phone. In plain B, mono was reserved for figures/AWBs; B+ pushes it across every machine figure so columns of times and dates align to the eye. Names, labels, and cadence words stay in the sans faces.
- **The status-LED gutter** — a 4px colour block at every row's left edge, an indicator light per row. The desk reads colour first.
- **The metric ribbon** — "the whole book at a glance": Total / Active / Paused / At risk / Ended, in mono figures with colour-keyed ticks, as the header of the table card.

### FIX C's one real problem — navy drops from slab to spine
Terminal's weakness was **solid navy bands** (the ribbon band and the detail-header band) sitting heavy on cream and tiring the eye. B+ keeps navy's *structural* job — "this is the readout," "this is the card's edge" — but **navy never fills a surface**. It survives only as:
- a **3px navy left-spine** on every card (banner, ribbon, detail), and
- the **ink** in eyebrows, headings, and labels.

So the metric ribbon is a **cream card with a navy spine**, not a navy band; the detail header is a **cream header with a navy spine**, not a navy band. You get Terminal's "whole book at a glance" legibility and its per-row LED without the dark mass. That is the entire B+ resolution, visible in one element: the ribbon.

---

## The three judgments Love delegated to design-lead craft

Love ruled the bones and left the finer calls to craft "within the above." Here's how each resolved, so the choice is legible and reversible:

1. **How far to push mono.** All the way for *figures* (times, dates, windows, counts, phone) — that is the point of the C borrow and it makes the tabular columns scan. **Not** onto names, role labels, cadence words, addresses, or emails — those stay in the warm sans faces, so the page reads human, not like a log file. (This deliberately widens #558 Gap-I's wording, which had reserved mono for identifiers and excluded dates; Love's B+ borrow authorizes mono for tabular figures including dates. Flagged here as an intentional refinement of Gap-I, not a drift.)
2. **How to render the ribbon.** As the table card's **header band on cream with a navy spine and colour ticks** — the navy-eye-strain fix, made concrete. The five segments spread evenly across the card so it reads as one balanced readout, joined to the table below as a single floating card.
3. **The status instrumentation.** The **LED gutter** continues the card's left spine: navy at the readout, status-colour per row. The in-pill **dot was cut** — the LED gutter and the soft pill fill already carry status colour, so the dot was one accessory too many (it also buys a little horizontal room).

Two more small cuts during the screenshot pass, recorded so they aren't re-litigated:
- The full-width **bottom axis was removed** from the table — it spanned the whole card while the tracks live in one column, so its ticks didn't sit under the bars (misleading). The 06:00–22:00 scale is now anchored once, in the **window column header** (perfectly aligned), and the detail view keeps its own single-column axis.
- **All table window bars are green** (ended stays stone). Plain B tinted late windows navy; B+ drops that — the bar's horizontal position already encodes time-of-day, so colour stays the single green accent.

---

## What is LOCKED (unchanged from B / C / #558)

- **Palette:** navy `#252d60`, green `#3e7c4b`, cream field. Status tones (active/paused/at-risk/ended/new) are the #558 StatusBadge map, not a re-palette.
- **D1** — green is the one primary action colour; navy is secondary. (Matches the shipped Button, #572/#573.)
- **D2** — sentence case for everything human-facing; UPPERCASE reserved for tiny mono eyebrows only.
- **D3** — detail pages are two-column and fill the width.
- **D4** — humanised data: names not UUIDs, `+971 50 333 3333` not E.164, "consignee" as the one entity noun.

---

## How B+ maps to the Step-3 build (the skin contract)

The mockup is drawn to the components the next four bundles build, so they build once:

| Bundle | Builds | B+ details it executes to |
|--------|--------|---------------------------|
| **3.3 StatusBadge** (Gap B) | the status → {label, tone} pill | soft-filled, dot-less, sentence-case, rounded-full; the five tones above; CRM / subscription / push surfaces only (task surfaces excluded). |
| **3.4 Table / DataTable** (Gap C) | the dense table | one floating card; nowrap uppercase-eyebrow headers; truncation; the **LED status gutter**; mono tabular figure cells; the **window-track** cell; the **metric ribbon** as an optional header slot. |
| **3.5 DetailView + DetailHeader + FieldRow** (Gap D) | the two-column detail | cream header + navy spine; `StatusBadge` in the header; D3 two-column fill; `FieldRow` with mono values for figures and an inline empty state ("Not set"). |
| **3.6 Form kit + EmptyState + MetricCard** (Gaps G, H, F) | forms, empties, dashboard metrics | the **MetricCard / ribbon segment** as the reusable metric unit; button family already shipped; sentence-case labels; placeholder ≠ value. |

---

## Boundaries honoured

- **No product code, no screen touched, no migration.** Standalone HTML with real brand-token hex inline; nothing routed through app components.
- The locked palette and D1–D4 are held exactly; the only thing that moved from B is the instrumentation borrow and the navy-as-spine resolution.
- Did not alter the #558 proposal, the day-57 direction mockups, or any in-flight lane (status-filter, the genuine-tenant fence #555, the admin-subscriptions consignee-name render #556).

---

## If Love wants a B+ tweak in the morning

The mockup is one self-contained file; a tweak (e.g. "ribbon should be navy after all", "drop the LED gutter", "push mono onto cadence too") is a small edit here, after which the affected Step-3 bundles rebase to the amended skin. Nothing in the Step-3 stack merges or promotes until Love rules on B+; the only thing at risk is rework, never the live product.
