# Decision · Transcorp brand guidelines v2 — design tokens for Subscription Planner

**Status:** Working tokens locked. Awaiting brand-team source-of-truth confirmation.
**Captured:** 30 April 2026 (Day 5 EOD / pre-Day-6).
**Decided by:** Love (engineering-owner).
**Source:** `Transcorp_Branding_Guidelines.pdf` published by brand team late April 2026, supplemented by hex values supplied by Love (origin: prior Claude design session) and pixel-extractions from the rendered PDF colour-block pages.

## Provenance flag

The seven hex values below are **working values, not source-of-truth values**. They are well-structured, internally consistent, and visually aligned with the brand book's rendered colour blocks. They are NOT confirmed against the brand team's Figma/Adobe source files.

**Brand book has printed-hex errors on pages 27–28.** Four of five printed hex values do not match the rendered colour blocks (e.g., "Navy Blue HEX DC6127" — DC6127 is burnt orange, not navy). Likely a designer template-copy error. **Pre-Day-14 action: email brand team to (a) confirm the seven working hex values below match their source files, (b) correct the printed-PDF errors for future readers.** Until brand team confirms, all UI colour decisions reference this memory note.

## Working design tokens (locked for Day 6+ frontend work)

### Primary palette

| Token name                  | Hex       | RGB                | Role                                                                                                                          |
| --------------------------- | --------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `--color-navy`              | `#0F2A5C` | rgb(15, 42, 92)    | Primary brand colour. Headers, primary CTAs, navigation.                                                                      |
| `--color-green`             | `#2E8B4A` | rgb(46, 139, 74)   | Secondary brand colour. Success states, secondary CTAs, positive emphasis.                                                    |
| `--color-surface-primary`   | `#FAF8F4` | rgb(250, 248, 244) | **Page background.** Warm off-white. Default body surface.                                                                    |
| `--color-surface-secondary` | `#F2EEE6` | rgb(242, 238, 230) | **Card / panel surface.** Slightly deeper warm neutral. Used for cards, sidebars, modals on top of `--color-surface-primary`. |

### Accent palette

| Token name           | Hex       | RGB               | Role                                                                                                |
| -------------------- | --------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| `--color-amber`      | `#E8A33C` | rgb(232, 163, 60) | Warning states, attention prompts, status badges (e.g., "Paused — needs attention"). Use sparingly. |
| `--color-red`        | `#D93A2B` | rgb(217, 58, 43)  | Error states, destructive actions, failure indicators. Use sparingly.                               |
| `--color-ocean-blue` | `#1F6FA8` | rgb(31, 111, 168) | Informational accents, links, neutral status indicators. Mid-blue, distinct from navy.              |

### Reconciliation against the brand book PDF

| Brand book name         | Brand book printed hex                         | Working hex | Status                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navy Blue / "Night Sky" | `#DC6127` (wrong — is burnt orange)            | `#0F2A5C`   | Working value — flag to brand team                                                                                                                                                      |
| Grass Green             | `#333132` (wrong — is dark grey)               | `#2E8B4A`   | Working value — flag to brand team                                                                                                                                                      |
| Snow White              | `#FFFFFF` (correct in book)                    | `#FAF8F4`   | Brand book value (`#FFFFFF`) is pure white; working value (`#FAF8F4`) is warm off-white per design call. Working value chosen for warmer feel; deviation surfaced for brand team review |
| Bright Red              | `#DC6127` (wrong — duplicates Navy Blue value) | `#D93A2B`   | Working value — flag to brand team                                                                                                                                                      |
| Ocean Blue              | `#D0CFCC` (wrong — is light beige)             | `#1F6FA8`   | Working value — flag to brand team                                                                                                                                                      |
| Amber                   | (not in brand book)                            | `#E8A33C`   | New accent introduced by Love during design. Surface to brand team for inclusion in v2.1 of guidelines                                                                                  |

## Tints (per brand book §4.3)

The brand book specifies tint usage at 10% increments (10%, 20%, 30%, ..., 100%) for primary palette colours. Implementation: define tints as opacity-based or explicit hex variants in the CSS variable set.

```css
/* Example — navy at 10% increments. Apply pattern to green and accent colours */
--color-navy-10: rgba(15, 42, 92, 0.1);
--color-navy-20: rgba(15, 42, 92, 0.2);
/* … through --color-navy-100 = full --color-navy */
```

Frontend sprint to decide opacity-based vs. solid-hex tints based on layering needs.

## Typography

### Primary typeface — Mulish

- Body text, UI labels, buttons, navigation, forms, tables — everything functional.
- Sans-serif. Available on Google Fonts.
- Weights expected: 300 (Light), 400 (Regular), 500 (Medium), 600 (SemiBold), 700 (Bold).
- Fallback stack: `'Mulish', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`.

### Secondary typeface — Sanchez Slab

- Display / decorative use only. Section headings on long-form content, special emphasis, marketing surfaces.
- Serif. Available on Google Fonts.
- Should NOT be used for primary UI text (forms, tables, body copy). Cognitive load too high at small sizes.
- Weights expected: 400 (Regular).

### Slogan typeface — Manrope

- Used **only** for the brand slogan "Delivering the best of life." per the brand book §2.4.
- Operator-facing UI does NOT need Manrope; the slogan is a marketing surface concern, not a product surface.

### Type scale (extrapolated — not in brand book)

The brand book does not specify a type scale for product UI. Extrapolating a sensible scale aligned with Tailwind's defaults:

```
text-xs:    12px / 0.75rem    — captions, helper text, tooltips
text-sm:    14px / 0.875rem   — secondary UI text, table cell text
text-base:  16px / 1rem       — body, default UI text, form inputs
text-lg:    18px / 1.125rem   — emphasised body, section labels
text-xl:    20px / 1.25rem    — small headings, card titles
text-2xl:   24px / 1.5rem     — section headings
text-3xl:   30px / 1.875rem   — page-level headings
text-4xl:   36px / 2.25rem    — hero numerals, landing-page-style emphasis (per brand book "hero numerals" reference)
```

## Brand voice (carry forward into UI copy)

Per brand book §2.2 and §2.3:

- **Assertive and professional.** "Skip Wednesday" not "You've successfully cancelled your subscription delivery."
- **Approachable and engaging.** Operator's voice, not marketing's.
- **Forward-looking.** Action-oriented, results-focused.
- **Medium-length sentences with felt rhythm.** No marketing fluff, no exclamation marks, no apologies.
- **Subtle authority.** Expertise without overcomplication.

The voice principles already guided the Day-3 onboarding doc copy. They continue to govern UI microcopy: empty states, error messages, button labels, success toasts.

## Logo usage

### Files

Two source files supplied by Love:

- `Transcorp_logo_full_color.jpeg` — full-colour lockup (navy + green + wordmark) on white background. Use for light surfaces.
- `Transcorp-white-logo__1_.png` — reversed lockup (full white) on transparent background. Use for dark surfaces (navy backgrounds, dark headers).

**Repo placement (Day 6 setup):**

```
public/brand/
  transcorp-logo-full.jpeg       (or .svg if source available)
  transcorp-logo-white.png       (transparent background)
docs/brand/
  Transcorp_Branding_Guidelines.pdf
```

**SVG conversion:** preferred for scaling and dark-mode flexibility. If brand team has SVG source files, request them. Otherwise PNG with transparency rides for now; SVG conversion is a Day-7+ chore.

### Misuse rules (per brand book §3.6)

The Subscription Planner UI must never:

- Recolour the logo or change opacity
- Stretch, squash, skew, or distort
- Split the lockup (mark + wordmark always together unless using the icon-only variant deliberately)
- Frame the logo (no borders, no boxed treatments)
- Add drop shadows, glows, or any graphic effects
- Rotate

### Minimum size

Brand book specifies 42.5px / 1.5cm minimum for legibility. UI surfaces should respect this — favicons and very small contexts use the icon-only mark, not the full lockup.

### Clear space

Equivalent to the height of the small "T" of the logo on all sides. Don't crowd the logo with adjacent UI elements.

## Imagery style

Brand book §7 calls for "futuristic, aesthetic" imagery — neon-network logistics visualisations. **This is marketing-surface guidance.** The operator-facing Subscription Planner is functional UI, not marketing material. It should NOT include hero imagery, photographic backgrounds, or decorative network visuals — that would clash with the operational mental model the onboarding doc establishes ("operator's voice, generous whitespace, hairline borders").

If a marketing site for the Subscription Planner is built later, that site uses the imagery style. The pilot UI does not.

## UI extrapolations — what the brand book does NOT specify

The brand book is comprehensive on brand expression (logo, palette, voice, imagery) but light on product UI specifics. The following decisions extrapolate from brand voice + look-and-feel and are NOT directly specified:

- **Card border radius:** 8px (slight rounding; matches "modern but not playful" reading)
- **Shadows:** None. Brand book consistently shows flat layouts without drop shadows. Card separation via 1px `--color-surface-secondary` borders or subtle background contrast.
- **Border colour for hairline separators:** ~10% opacity navy on light surfaces. Suggested token: `--color-border-default: rgba(15, 42, 92, 0.10)`.
- **Default border weight:** 1px hairline.
- **Spacing scale:** Tailwind defaults (4, 8, 12, 16, 24, 32, 48, 64). No deviation from web standards.
- **Focus rings:** 2px navy outline with 2px offset. Accessibility-compliant.
- **Disabled state:** 40% opacity on text, no colour change on background.
- **Hover state on primary buttons:** darken navy by ~10% (alternatively `--color-navy-90` if tint variants are defined).

These are working defaults; frontend sprint can adjust based on visual review.

## Pre-Day-14 brand-team confirmation request

Email to brand team to send before Day 14 demo:

**Subject:** Subscription Planner pilot — confirming brand colour values from source files

**Body draft:**

> Hi [brand team contact],
>
> We're building the Subscription Planner pilot UI and need to confirm the authoritative hex values for our colour palette ahead of the Day-14 demo.
>
> While referencing the published brand guidelines (March 2026), we noticed the printed hex values on pages 27-28 don't appear to match the rendered colour blocks (e.g., "Navy Blue HEX DC6127" — DC6127 is burnt orange, not navy). We've been working from values that visually match the rendered blocks, but want to align with your source files (Figma / Adobe) for the final pilot.
>
> Could you send the authoritative hex codes for:
>
> - Navy Blue / Night Sky
> - Grass Green
> - Snow White (and any secondary off-white surface colour for warm UI backgrounds)
> - Bright Red
> - Ocean Blue
> - Amber accent (recently added — confirm whether it's part of v2.1 of the guidelines)
>
> Working values we're using until you confirm: [paste the seven values from the table above]
>
> Once confirmed, we'll lock these into our design system and update our internal documentation. Could also use a corrected version of the colour spec pages for the brand book record if there's appetite to publish v2.1.
>
> Thanks,
> Love

## CSS variable file (Day-6+ frontend work)

When frontend work begins, the working tokens land in a single source file:

```
src/styles/brand-tokens.css
```

Schema sketch:

```css
:root {
  /* Primary */
  --color-navy: #0f2a5c;
  --color-green: #2e8b4a;
  --color-surface-primary: #faf8f4;
  --color-surface-secondary: #f2eee6;

  /* Accents */
  --color-amber: #e8a33c;
  --color-red: #d93a2b;
  --color-ocean-blue: #1f6fa8;

  /* Borders + extrapolations */
  --color-border-default: rgba(15, 42, 92, 0.1);
  --color-text-primary: #0f2a5c;
  --color-text-secondary: rgba(15, 42, 92, 0.7);
  --color-text-tertiary: rgba(15, 42, 92, 0.5);

  /* Typography */
  --font-sans: "Mulish", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --font-serif: "Sanchez Slab", Georgia, serif;
}
```

Tailwind config extends from these CSS variables, not duplicates them.

## When brand team confirms / corrects values

1. Update this memory note with corrected values + a note on what changed
2. Update `src/styles/brand-tokens.css` (10-line PR, T1 chore)
3. Sweep the codebase for any hardcoded hex values referencing the old tokens; replace with CSS variable
4. Re-render any frontend screens against the new tokens

The architecture allows clean swap because everything routes through CSS variables, not hex literals scattered across the code.
