// playwright.config.ts
//
// Plan §11.2 #9 / §3.5: Playwright covers the E2E half of the testing
// toolchain. One smoke test ships in commit 10 (tests/e2e/hello.smoke.spec.ts);
// real flows arrive Day 5+ as the merchant portal builds out.
//
// Playwright runs LOCAL ONLY — not in CI (commit-10 prep approval).
// Reasoning: the Vercel preview deployment provides the real-environment
// runtime check, and Playwright in CI duplicates that with a less faithful
// env (no real Supabase / Upstash / AWS credentials wired into GitHub
// Actions). Revisit at Day 12+ when there are real flows worth e2e-testing
// in CI.
//
// Local invocation patterns:
//   npm run test:e2e
//     → Spawns `next dev` on :3000 and runs the smoke against it.
//
//   PLAYWRIGHT_BASE_URL=https://planner-<sha>.vercel.app npm run test:e2e
//     → Runs the smoke against the live Vercel preview, no local server.
//       This is how Love manually verifies "all 5 panels green" against the
//       preview deployment before merging — the smoke confirms structure,
//       eyeballing the URL confirms colour.

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  // When PLAYWRIGHT_BASE_URL is set we're running against a remote
  // deployment — don't spawn a local server.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
