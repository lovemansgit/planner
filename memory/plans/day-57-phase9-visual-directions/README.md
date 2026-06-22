# Phase 9 · Visual directions — three premium skins for the console

**Lane:** design exploration (docs + standalone mockups only). **Status:** for Love's directional pick.
**Inputs:** the merged Step-2 design-system proposal (#558, `memory/plans/day-57-phase9-step2-design-system.md`) and the Step-1 visual audit (`audit/PHASE-9-VISUAL-AUDIT.md`, branch `phase9/visual-audit`).
**Method:** the `frontend-design` skill — brainstorm → plan → critique → build → critique again.

> **What this is / isn't.** This proposes **three distinct premium executions of the *same* locked contract**, so you can pick a *look* before any screen is built. It is **direction, not the build** — no product code, no screen touched, no migration. The chosen direction becomes the skin contract the Step-3 table/detail/button bundles execute to, so they build once, not twice.

---

## How to view

Open the folder over a local server (the directions cross-link, and Google Fonts need http):

```
cd memory/plans/day-57-phase9-visual-directions
python3 -m http.server 8799
# then open http://localhost:8799/index.html
```

`index.html` is the chooser. Each `direction-*.html` renders the three premium-carrying surfaces on one page: **① table** (admin Subscriptions — the real data shape), **② detail view** (consignee, two-column fill), **③ the button family** (primary / secondary / ghost / danger + states, in context).

---

## What is LOCKED (identical across all three)

The freedom here is in **execution**, never in the palette or the four rulings. Every direction honours:

- **Palette:** navy `#252d60`, green `#3e7c4b`, a cream field. (Status tones — amber/red/stone/navy — are the functional StatusBadge map from the #558 spec, not a re-palette.)
- **D1** — green is the one primary action colour; navy is secondary.
- **D2** — sentence case for everything human-facing; UPPERCASE reserved for tiny mono eyebrows only.
- **D3** — detail pages are two-column and fill the width (no stranded right half).
- **D4** — humanised data: names not UUID hashes, `+971 50 333 3333` not E.164, "consignee" as the one entity noun.
- The **dense premium-console thesis** from the audit (§5): trust comes from density, alignment, and consistency — not whitespace.

What **differs** between directions: the type pairing + scale, the density rhythm, the table treatment, the surface/depth treatment, and **one signature move each**. That is the whole point of the exercise — same bones, three skins.

> **Note on the baseline.** The #558 proposal already shipped three neutral mockups (`day-57-phase9-step2-mockups/`) in Manrope/Mulish + a serif number face, warm paper, dot-pills, hairlines. None of the three directions below reproduces that — each is a deliberate, different execution so the choice is real.

---

## The three directions (design-plan format)

### Direction A — **Instrument**  ·  *the precision control surface*

A logistics console as a measuring instrument: quiet, razor-aligned, near-monochrome. Confidence comes from alignment and tabular discipline, not decoration. The reference tier is Linear — flat surfaces, tight type, withheld colour.

- **Colour (within the locked palette):** navy ink `#1a1d2b`→`#252d60` on a cream field `#f7f5ef`; hairline structure `rgba(37,45,96,.12)`. **Green appears in only two places — the primary action and the healthy/active state** — so the eye learns green = go.
- **Type:** display **Space Grotesk** (engineered, slightly mechanical) at a tight scale (h1 24–26px, `-0.02em`); body **IBM Plex Sans** 14px; **IBM Plex Mono** for eyebrows, figures, and IDs — a "readout" face. Tabular numerics throughout.
- **Density rule:** comfortable-tight — 46px rows, hairline dividers, no card chrome on the table.
- **Signature — the status spine:** a 3px colour-coded edge on every row (and the detail header), so you read the whole status column down the left margin without reading words. Status is a *position + colour*, not a paragraph.
- **The one risk:** **restraint** — withholding colour almost everywhere. A near-monochrome ops surface can read as plain in a thumbnail; it earns its premium feel in use, through alignment and the single confident green. Justified because the audit's core failure was *inconsistency*, and the most credible answer to "looks unfinished" is disciplined quiet.
- **Round-0 cut (mirror check):** removed the 1px border on status pills — the spine already scans status by colour, so bg + text is enough. Flatter reads more like an instrument.

### Direction B — **Dispatch**  ·  *the delivery manifest, elevated*

The operations sheet you'd be glad to hand a client — warm, layered, generous-but-structured. The reference tier is the Stripe dashboard: soft depth, confident colour, data that breathes. The personality lives in **how it reads the day**.

- **Colour:** warm cream working field `#efeae0` with floating warm-white cards `#fffdf8` and soft **navy-tinted** shadows (`0 10px 30px -16px rgba(37,45,96,.28)`); green primary with lift.
- **Type:** display **Bricolage Grotesque** (characterful, humanist-display — carries consignee names with warmth) at h1 26–30px; body **Hanken Grotesk** 14.5px; **IBM Plex Mono** for figures/AWBs. More generous than a pure grid.
- **Density rule:** comfortable — 54px rows to give the signature room; cards float on the field.
- **Signature — the delivery-window track:** every time window is drawn as a green bar on a faint **06:00→22:00 day baseline**, so an operator reads the day's load at a glance — early-morning drops cluster left, evening sits right — instead of parsing "16:00–18:00" six times. This is the most subject-grounded device of the three: a logistics console's core question is *when, across the day, are my deliveries.*
- **The one risk:** **a non-text visual in every row.** Adding a chart element to a dense table risks clutter. Justified because the window is the operator's primary scheduling signal, and the track turns a column of near-identical time strings into a scannable shape.
- **Round-0 cut:** removed the drop-shadow from secondary + danger buttons — only the **primary** action carries lift now, so the eye goes to the one button that matters.

### Direction C — **Terminal**  ·  *the logistics operations terminal*

Maximum density, monospace numerics, a navy structural band — the table *is* the interface, the way a trading or dispatch desk works. The reference tier is a Bloomberg-grade ops surface. Cool cream keeps it from going cold.

- **Colour:** cool cream surface `#f3f1ea`, panel `#fbfaf6`, a **navy structural band** `#252d60` with cream text; colour-keyed status. Zebra fills (`rgba(37,45,96,.026)`), not bare hairlines.
- **Type:** display **Archivo** (industrial, condenses well for dense headers); body **IBM Plex Sans** 13.5px; **JetBrains Mono** for *all* numerics — windows, dates, counts, IDs — tabular and tight.
- **Density rule:** compact — 38px rows, the densest of the three; the metric ribbon and table read as one continuous control panel.
- **Signature — the status-LED gutter + live metric ribbon:** a solid colour block in the leftmost column acts like an indicator light per row (the desk reads colour first); the navy band along the top is a live readout of the whole book (Total / Active / Paused / At risk / Ended) in mono figures. Two halves of one "this is a terminal" move.
- **The one risk:** **density at the edge.** 38px rows + mono numerics can feel cold or cramped. Mitigated by the warm cream under the navy band, generous ribbon figures, and — deliberately — **keeping D2 sentence-case rather than shouting in caps**: the terminal feel comes from density and mono, not from uppercase. (This is also how it avoids the AI-default "broadsheet" look — it leans on colour-keyed bands and the ribbon, not hairline newspaper columns.)
- **Round-0 cut:** removed the in-pill status dot — the LED gutter already signals status colour at the row edge, so dropping the dot buys horizontal density, which is this direction's whole thesis.

---

## Calibration — why these three, and what they are *not*

The `frontend-design` skill warns that AI design clusters around three defaults: (1) cream + high-contrast serif + terracotta, (2) near-black + one acid accent, (3) broadsheet hairline newspaper columns. The brand palette is fixed (it isn't terracotta or acid), but the *execution* could still drift into a default, so each direction is checked against them:

- **A · Instrument** is flat and quiet but it is navy-on-cream with a *withheld* green, not near-black + acid (#2); no serif, no terracotta (#1).
- **B · Dispatch** is warm but its personality is the window track and layered depth, **not** a high-contrast serif — it deliberately avoids the cream-serif default (#1) by pairing two grotesques.
- **C · Terminal** is dense but it is a *colour-keyed ops terminal* — navy bands, LED gutter, live ribbon, zebra fills, modest radius — **not** a zero-radius hairline broadsheet (#3).

Each is a choice made *for this brief* (a logistics ops console), grounded in the subject's own world: delivery windows, recurring cadences, consignees, the rhythm of a dispatch day.

---

## How to pick (one sentence on the record)

Reply with the direction — e.g. **"Go with B / Dispatch"** (or A / C). That pick becomes the skin contract for the Step-3 build bundles (Button → StatusBadge → Table → DetailView → Form/Empty/Metric) in the #558 sequence. Nothing merges to a live screen on the strength of this lane; the build PRs are still separately reviewed.

If two appeal for different surfaces (e.g. Terminal's ribbon on dashboards, Instrument's calm on detail pages), say so — the directions share the same locked tokens, so a hybrid ("Instrument as the base, adopt the metric ribbon for dashboards") is a legitimate ruling and costs nothing extra to spec.

---

## Boundaries honoured

- **No product code, no screen touched, no migration.** Standalone HTML with real brand-token hex inline; nothing routed through app components.
- Did not alter the #558 proposal, the existing Step-2 mockups, or any in-flight functional lane (test-data fence, consignee-name render, task-status).
- All three keep the locked palette and D1–D4 exactly; the only variable is execution.
