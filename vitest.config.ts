// vitest.config.ts
//
// Plan §11.2 #9: "Vitest + Playwright configs. A hello-world test in each."
// Plan §3.5: "Testing — Vitest + Playwright — Unit + E2E in one toolchain;
// fast iteration."
//
// Two-project split (approved in commit-10 prep, 2026-04-26):
//
//   - `unit`        — Pure TypeScript tests with no external dependencies.
//                     Runs in CI on every PR. Hello-world test lives at
//                     tests/unit/harness.spec.ts; real unit tests start
//                     arriving Day 2 with the identity module.
//
//   - `integration` — Tests that need a real Postgres connection. The
//                     R-3 mandatory tests/integration/rls-tenant-isolation.spec.ts
//                     lands Day 2 and is the first inhabitant.
//
// =============================================================================
// THE INTEGRATION PROJECT IS INTENTIONALLY NOT WIRED INTO CI YET.
// -----------------------------------------------------------------------------
// The integration project exists, is configured here, and runs locally via
// `npm run test:integration`. The CI test-database provisioning decision
// (GitHub Actions service container vs dedicated Supabase test project vs
// ephemeral Postgres) lands with the Day-2 R-3 isolation test
// implementation, NOT in commit 10. Until that decision is made, the CI
// workflow at .github/workflows/ci.yml runs ONLY the unit project.
//
// This is a documented pre-Day-2 state, not a bug. Do not "fix" it by
// adding the integration project to CI without first deciding how the
// test database is provisioned. See the open follow-up "Day-2 RLS
// BYPASSRLS hole" in the project memory for the related Day-2 work.
// =============================================================================

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["src/**/*.spec.ts", "tests/unit/**/*.spec.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.spec.ts"],
          environment: "node",
          // Real DB roundtrips are slower than in-memory tests; bump
          // timeouts so the R-3 isolation test (Day 2) has headroom.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
