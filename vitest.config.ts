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
// Integration project — wired into CI in R-3 (Day 2).
// -----------------------------------------------------------------------------
// CI runs `npm run test:integration` in a separate `integration` job against
// a postgres:17 service container provisioned by `scripts/setup-test-db.sh`.
// See `.github/workflows/ci.yml`'s `integration` job for the provisioning
// rationale. Locally, run the same script against any reachable Postgres
// (e.g. a docker container) and `npm run test:integration`.
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
