import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        navy: "var(--color-navy)",
        green: "var(--color-green)",
        "surface-primary": "var(--color-surface-primary)",
        "surface-secondary": "var(--color-surface-secondary)",
        amber: "var(--color-amber)",
        red: "var(--color-red)",
        "ocean-blue": "var(--color-ocean-blue)",
        "amber-100": "var(--color-amber-100)",
        "amber-300": "var(--color-amber-300)",
        "amber-600": "var(--color-amber-600)",
        "amber-deep": "var(--color-amber-deep)",
        paper: "var(--color-paper)",
        ivory: "var(--color-ivory)",
        "stone-200": "var(--color-stone-200)",
        "stone-600": "var(--color-stone-600)",
        ink: "var(--color-ink)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        serif: ["var(--font-serif)"],
        display: ["var(--font-display)"],
      },
    },
  },
  plugins: [],
};

export default config;
