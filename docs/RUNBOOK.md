# Runbook

Operational reference. Day-2 scaffolding — sections fill in as systems land.
The full runbook is scheduled for Day 11 of the sprint; the deployment-topology
section below ships early because it is load-bearing for every Day-2+ commit.

---

## Deployment topology

### Branch model

| Branch           | Vercel environment | Purpose                                                        |
| ---------------- | ------------------ | -------------------------------------------------------------- |
| `production`     | Production         | Live for the pilot. Only updated via promotion PR from `main`. |
| `main`           | Preview            | Integration trunk. All feature work merges here first.         |
| feature branches | Preview            | Per-PR previews.                                               |

**Why two long-lived branches.** Before R-0-prep, Vercel's production branch was `main`, so every merge to `main` shipped to the public Vercel URL — including auth-surface and database-role changes that needed observation time on a non-production env. R-0 (the BYPASSRLS hole closure) made this risk unignorable: a single merge to `main` would have rotated the database role under the live preview URL the team was demoing from. Splitting `production` off as a separate, manually-promoted branch puts a deliberate human step between integration and live traffic.

**Why `main` stays in the loop.** All PRs continue to target `main`; nothing routes around it. `main` is the source of truth for "what's been reviewed and integrated"; `production` is the source of truth for "what's currently serving live traffic." Promotion is a fast-forward (or merge) from `main` to `production` via a tracked PR — see `.github/workflows/promote-to-prod.md`.

### Vercel mapping

- **Production branch:** `production`. Only commits on this branch trigger a Production deployment to the public Vercel URL (currently `planner-olive-sigma.vercel.app`; will move to a custom domain pre-pilot).
- **Preview branches:** all other branches, including `main`. Each push gets a unique preview URL named `planner-git-<branch>-lovemansgits-projects.vercel.app`.
- **Environment variables:** every variable must be set in **Production AND Preview AND Development** scopes. Production-only or Preview-only values are a footgun; if a value legitimately differs by environment, document the divergence in `.env.example`.

### Branch protection

- `main` — PR-required, no approval (per bootstrap exception model). CI gate: GitHub Actions + Vercel preview both green.
- `production` — PR-required, no approval. CI gate: GitHub Actions green. The Vercel deployment that runs on merge IS the production deployment, so there is no pre-merge preview to validate against; pre-merge validation lives on `main`'s preview URL.

---

## Promotion to production

See `.github/workflows/promote-to-prod.md` for the step-by-step procedure. Summary:

1. PR lands on `main` → Vercel deploys a preview → validate.
2. When the preview is signed off, open a PR from `main` to `production`.
3. Squash-merge the promotion PR → Vercel deploys to Production → validate the public URL.

Hotfix variant: open a PR directly to `production` and a parallel backport PR to `main`. Same gate, same review pattern.

---

## Bootstrap exceptions

Folded in from `docs/BOOTSTRAP_NOTES.md` on Day 11 of the sprint. Until then, see that file directly.

---

## Other sections (placeholders, fill on Day 11)

- Local development setup
- Database migrations (apply / rollback / new)
- Secrets rotation (Supabase, Upstash, AWS, Resend, Sentry, SuiteFleet)
- Incident response (Sentry alerts, Vercel logs, Supabase dashboard)
- Common operations (resend invitation, retry dead-letter, replay webhook)
