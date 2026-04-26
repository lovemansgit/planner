// tests/e2e/hello.smoke.spec.ts
//
// Playwright smoke test for the /hello page (plan §11.2 #9 — "A hello-world
// test in each"). Verifies STRUCTURE only — that the page renders the git-SHA
// line and exactly five panels with the expected names.
//
// Does NOT assert that the panels are green; that requires real env vars in
// the test environment, which CI does not have. The "all five green" check
// is a manual eyeball on the live Vercel preview deployment by Love before
// merging (commit-10 prep approval).

import { test, expect } from "@playwright/test";

const EXPECTED_PANELS = [
  "Supabase",
  "Upstash Redis",
  "AWS Secrets Manager",
  "Sentry",
  "SuiteFleet sandbox",
] as const;

test("/hello renders git SHA + five service panels", async ({ page }) => {
  await page.goto("/hello");

  // Page heading
  await expect(
    page.getByRole("heading", { name: /subscription planner — \/hello/i }),
  ).toBeVisible();

  // Git SHA metadata line (display-only, not a panel — see deviation note
  // in src/app/hello/page.tsx).
  await expect(page.getByTestId("git-sha")).toBeVisible();

  // Exactly five panels render.
  const panels = page.getByTestId("hello-panel");
  await expect(panels).toHaveCount(EXPECTED_PANELS.length);

  // Each expected panel is present (label-by-label).
  for (const name of EXPECTED_PANELS) {
    await expect(page.locator(`[data-panel-name="${name}"]`)).toBeVisible();
  }
});
