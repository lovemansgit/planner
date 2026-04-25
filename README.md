# Subscription Planner

Transcorp's merchant-facing subscription management platform for meal-plan deliveries on SuiteFleet.

This is a 14-day pilot build (April–May 2026). The authoritative specification lives in `docs/`:

- `docs/plan.docx` — Subscription Planner Build Plan v2.1
- `docs/plan-resolutions.docx` — Authoritative resolutions addendum (overrides the plan where they disagree)

## Stack

Next.js 15 App Router · TypeScript strict · Tailwind · Supabase Postgres (with RLS) · Supabase Auth · Upstash Redis + QStash · AWS Secrets Manager (me-south-1) · Vercel · Sentry · Resend · Google Maps Geocoding.

## Local development

```bash
nvm use            # Node 20 LTS
npm install
cp .env.example .env.local   # fill in real values
npm run dev
```

## Scripts

- `npm run dev` — local dev server on http://localhost:3000
- `npm run build` — production build
- `npm run lint` — ESLint
- `npm run format` — Prettier write
- `npm run format:check` — Prettier check (CI gate)

## Repo layout

The full target layout is documented in plan §11.1. Modules land progressively over the 14-day sprint per plan §11.2.
