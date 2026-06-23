import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // H4 (Day-53 Tier-2): each colour resolves through an RGB channel
        // token via `rgb(var(--color-x-rgb) / <alpha-value>)` so Tailwind
        // opacity modifiers render (a bare utility resolves to `/ 1` =
        // identical to the hex). See src/styles/brand-tokens.css.
        navy: "rgb(var(--color-navy-rgb) / <alpha-value>)",
        green: "rgb(var(--color-green-rgb) / <alpha-value>)",
        "surface-primary": "rgb(var(--color-surface-primary-rgb) / <alpha-value>)",
        "surface-secondary": "rgb(var(--color-surface-secondary-rgb) / <alpha-value>)",
        amber: "rgb(var(--color-amber-rgb) / <alpha-value>)",
        red: "rgb(var(--color-red-rgb) / <alpha-value>)",
        "ocean-blue": "rgb(var(--color-ocean-blue-rgb) / <alpha-value>)",
        "amber-100": "rgb(var(--color-amber-100-rgb) / <alpha-value>)",
        "amber-300": "rgb(var(--color-amber-300-rgb) / <alpha-value>)",
        "amber-600": "rgb(var(--color-amber-600-rgb) / <alpha-value>)",
        "amber-deep": "rgb(var(--color-amber-deep-rgb) / <alpha-value>)",
        paper: "rgb(var(--color-paper-rgb) / <alpha-value>)",
        ivory: "rgb(var(--color-ivory-rgb) / <alpha-value>)",
        "stone-200": "rgb(var(--color-stone-200-rgb) / <alpha-value>)",
        "stone-600": "rgb(var(--color-stone-600-rgb) / <alpha-value>)",
        ink: "rgb(var(--color-ink-rgb) / <alpha-value>)",
        // scrim is intentionally alpha-baked (Tier-1 surgical backdrop
        // fix); it is not channel-remapped.
        scrim: "var(--color-scrim)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        display: ["var(--font-display)"],
        // Phase 9 — Direction B skin faces (see src/styles/brand-tokens.css).
        // Available app-wide; only <Button> applies `font-b-body` in this bundle.
        "b-body": ["var(--font-b-body)"],
        "b-display": ["var(--font-b-display)"],
        "b-mono": ["var(--font-b-mono)"],
      },
      // Phase 11 Batch 1 — register the B+ shadow tokens as NAMED boxShadow
      // utilities. Tailwind v3's arbitrary-value parser mis-reads the multi-layer
      // `shadow-[var(--shadow-b-card)]` as a shadow COLOR (`--tw-shadow-color`),
      // which resets box-shadow to transparent — so every B+ card rendered FLAT.
      // A named utility assigns the value verbatim to `--tw-shadow`, so the
      // multi-layer shadow renders (and still composes with `ring-*`). The token
      // values stay canonical in src/styles/brand-tokens.css; this only references
      // them, so the float follows the token.
      boxShadow: {
        "b-card": "var(--shadow-b-card)",
        "b-rest": "var(--shadow-b-rest)",
        "b-lift": "var(--shadow-b-lift)",
      },
    },
  },
  plugins: [],
};

export default config;
