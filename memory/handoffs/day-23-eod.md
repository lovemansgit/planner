# Day-23 EOD

Filed: 2026-05-12 (PM). Full-day arc; consolidates Session A + Session
B work landed across AM + PM. Replaces the rolling
`MEMORY-eod-latest.md` for Day-23.

## §A — Final state at sign-off

- **Main HEAD**: `8a3cec1` — `docs(d23-pm): Session A final handoff brief`
- **Production**: `https://planner-olive-sigma.vercel.app` served by
  `dpl_4cHcRTWc33fXQm9Cz14RjoaTM686` (built from main HEAD `4381b61`).
  Three aliases live: `planner-olive-sigma`, `planner-lovemansgits-projects`,
  `planner-git-main-lovemansgits-projects`.
- **Demo blockers**: 0.
- **Demo distance**: T-2 (May 15 internal CAIO) / T-5 (May 18 external).

## §B — PRs landed Day-23

| PR | Author | Slot | Title |
|---|---|---|---|
| #244 | Session B | AM | Preflight Gate 8 v1.10 + scripts/README |
| #245 | Session A | AM (d22n) | /calendar consolidated view — service + page + week-view (added retroactively — merged Day-23 AM Dubai as a d22n overnight-lane continuation; missed in the original §B ledger, caught during Day-26 MEMORY.md index reconstruction (PR #280)) |
| #246 | Session A | AM | VERCEL_URL fallback for callback base URL |
| #247 | Session A | PM | /calendar polish + Transcorp admin variant metrics |
| #248 | Session B | PM | Subscription tab + wizard success toast |
| #249 | Session A | PM | Transcorp fleet panels (Top merchants + Per-merchant breakdown) |
| #250 | Session B | PM | /calendar month + day views |
| #251 | Session A | late PM | Tenant search bars + Transcorp fleet bar chart |

Plus the doc-ride-along T1 commits filed direct to main (Session A
handoff briefs at `f28e7be` + `8a3cec1`; Session B handoff brief at
`3ed06b0`).

## §C — Diagnostics resolved Day-23

- **SF push end-to-end pipeline confirmed working.** AWB
  `MPL-64596425` minted live during the manual cron trigger probe;
  outbound push, QStash callback, AWB write-back all proven on
  production.
- **`PUBLIC_BASE_URL` + `VERCEL_URL` fallback both live.** PR #246
  shipped the in-code fallback chain (PUBLIC_BASE_URL →
  `https://${VERCEL_URL}` → FALLBACK_BASE_URL); operator separately
  populated `PUBLIC_BASE_URL` on the production scope. Pipeline now
  resilient on either presence.
- **Schema-drift bug class caught + remediated.** Session B's PR #250
  surfaced a column-name drift in the day view's SQL that the unit
  specs (mocking `tx.execute`) had missed. Remediation: integration-
  test pattern established at
  `tests/integration/calendar-day-view.spec.ts` — runs real SQL
  against a Postgres fixture so column-name drift fails the suite.
  This is now the discipline for any new SQL path (see §F).
- **SF same-day cutoff is a phantom problem.** Sandbox probe with
  current-day `deliveryDate` returned HTTP 200; the failed pushes
  observed earlier (DLQ population) were not driven by a same-day
  cutoff. Real causes characterised in the morning handoff §B (past-
  date test data + duplicate `customerOrderNumber` collisions).

## §D — Open carry-forwards to Day-24

**Session B's next lane:**

- **Admin search bars** for `/admin/tasks`, `/admin/consignees`,
  `/admin/merchants`, `/admin/failed-pushes` — mirroring the operator-
  side surface PR #251 just shipped. Brief is to bundle this work
  with the **Calendar admin-nav fix** surfaced during Session A's
  read-only check this session: `ADMIN_NAV_ITEMS` at
  `src/app/(app)/nav-config.ts:139-144` lacks a `/calendar` entry,
  so transcorp-sysadmins on any `/admin/*` page have no top-nav link
  to Calendar. One-line add gated on `task:read_all` is the
  recommended fix. **MUST include integration specs** per the §F
  discipline lesson.

**Love's lane:**

- **Architecture slide** (~30 min). Final demo deck artifact.
- **Dry-run walkthrough** — all 8 chapters end-to-end against
  production. T-2 to internal CAIO demo; the dry-run is the last
  rehearsal before the live walk.
- **`demo-preflight.mjs` run + green**. Existing script (shipped
  pre-Day-23) — run it against production HEAD and confirm 100% pass.

**Documentation:**

- **`MEMORY-index.md` reconstruction**. Was flagged this AM but
  deprioritized in favour of shipping. Defer to Day-24 EOD if not
  done overnight.

## §E — Deferred to Phase 1.5 / Phase 2

- **`demo-infra-preflight.mjs`** (parallel ops checks script). Higher-
  fidelity than `demo-preflight.mjs`; runs concurrent probes against
  cron, queue depth, DLQ size, alias resolution. Deferred to Phase 2
  per scope cap.
- **3-day cron silence diagnostic** (`task_generation_runs` had no
  realistic rows 2026-05-09 → 2026-05-11). Manual `vercel crons run`
  trigger this session restored function; auto-resume on scheduled
  cadence unverified. Recommended diagnostic: read Vercel runtime
  logs for `/api/cron/generate-tasks` invocations in that window +
  add `console.warn` on 401 return path for future drift visibility.
- **DLQ cleanup** (84 rows test-tenant noise). Operationally
  harmless; cosmetic blemish on `/admin/failed-pushes`. Optional
  cleanup pass before demo if time permits.
- **`postgres-js` mocking infra for scripts unit tests**. Scripts
  currently rely on integration coverage only; a mocking layer would
  let scripts grow unit-spec coverage without the integration test
  setup cost.
- **Tenant search bars — integration specs**. PR #251 covered ILIKE
  paths via `tx.execute` mocks only. Schema-drift discipline (see
  §F) says future changes to those SQL paths need integration
  specs. Current production cover is acceptable for demo; debt is
  flagged.

## §F — Discipline lessons logged Day-23

- **Schema-drift catch via integration tests.** Unit specs that mock
  `tx.execute` cannot catch column-name drift (caught by PR #250 at
  preview-walk time, not in CI). Going forward: **any new SQL path
  with non-trivial column shape needs an integration spec following
  `tests/integration/calendar-day-view.spec.ts`**. Repo-level unit
  specs assert SQL shape (predicates present, parameters bound),
  integration specs assert columns resolve against the real
  database.
- **Vercel inspect-then-promote pattern preserved.** Every production
  promote today (SHA `26de3d9`, `761ce9b`, `4381b61`) went through
  `vercel ls` → `vercel inspect <id>` → `vercel promote <id> --yes`.
  Per-statement approval gate honoured (Love pre-authorised the
  full merge → promote sequence in the prompt for the latest
  promote, no dashboard round-trip needed).
- **Parallel session lanes ran clean with zero merge conflicts.**
  Session A on tenant work (calendar service + page shell, fleet
  panels, tenant search) + Session B on admin work (preflight,
  forms, calendar month/day, subscription tab). Worktree isolation
  via `git worktree add` (per the memory rule) was the load-bearing
  enabler — both sessions held distinct file-spaces, merge bases
  stayed compatible across 7 PRs in one day.

## §G — Project files state at EOD

- **`MEMORY-eod-latest.md`**: replaced tonight with this doc (`day-23-eod.md`).
- **`MEMORY-index.md`**: pending reconstruction. Defer to Day-24 EOD
  if not done overnight.
- **`MEMORY-followup-current.md`**: no rotation. Day-19 Phase 1 plan-
  PR fully shipped today; no new load-bearing followup item
  surfaced that needs to roll up to a top-level memory file.
- **`MEMORY-product-brief.md`**: v1.11 unchanged.
