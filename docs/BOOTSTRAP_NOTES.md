# Bootstrap notes

## Commit-1 direct-push exception (25 April 2026)

Commit `550380a` — the initial Next.js 16 App Router scaffold — was pushed directly to `main` without going through the standard feature-branch + pull-request review cycle. This was a one-time bootstrap exception necessitated by the chicken-and-egg case of an empty repository: GitHub requires a base branch to exist before a pull request can target it, so the very first commit on `main` cannot itself be reviewed via a PR. Branch protection (Love-approval-only at this stage; Aqib added once his GitHub handle is confirmed) was enabled immediately after the commit landed, and from commit 2 onward every change goes through a feature branch and a reviewed pull request. This note will be folded into `docs/RUNBOOK.md` under a "Bootstrap exceptions" section when the runbook is written on Day 11 of the sprint.
