---
name: Vercel env scope convention — Production + Preview only
description: Server-side env vars for the planner project go in Production + Preview scopes only, never Development. Match the existing pattern.
type: feedback
originSessionId: 745ed780-25c9-41f2-a58d-a5c1bbf8d5df
---
When adding a new env var to the Vercel dashboard for the planner project, scope it to **Production + Preview only**, NOT Development.

**Why:** Match the existing env var pattern in this project. Love has a deliberate convention here. Development scope is reserved for `.env.local` on developer machines, not Vercel — keeps the boundary clean between "real cloud creds" and "local dev creds." Likely also keeps the Development scope unused so a future migration to Vercel CLI dev doesn't surprise anyone.

**How to apply:** When writing PR descriptions, .env.example comments, migration headers, or any operator-facing doc that tells the user where to paste an env var into Vercel, say "Production + Preview" — never "all three scopes" or "Production + Preview + Development."

**Surfaced:** R-0 cutover, 27 April 2026. Original brief said "Production + Preview + Development" three times across .env.example, 0003 migration header, and a PR comment. Love corrected before doing the cutover. Fixed in same R-0 PR with a follow-up commit.
