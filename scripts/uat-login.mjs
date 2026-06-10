// Day-52 proving pass — step 0: production login with the Love-provided
// UAT operator account (UAT_OPERATOR_EMAIL / UAT_OPERATOR_PASSWORD from
// env; values never logged). Saves storage state to /tmp/uat-state.json
// for the action steps and screenshots the landing page.

import { chromium } from "playwright";

const BASE = "https://planner-olive-sigma.vercel.app";
const email = process.env.UAT_OPERATOR_EMAIL;
const password = process.env.UAT_OPERATOR_PASSWORD;
if (!email || !password) {
  console.error("missing UAT_OPERATOR_EMAIL / UAT_OPERATOR_PASSWORD");
  process.exit(2);
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="email"]', email);
await page.fill('input[name="password"]', password);
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 20000 }).catch(() => null),
  page.click('button[type="submit"]'),
]);
await page.waitForLoadState("networkidle");

const url = page.url();
const bodyText = (await page.textContent("body"))?.slice(0, 300).replace(/\s+/g, " ");
console.log(`post-login url: ${url}`);
console.log(`page text head: ${bodyText}`);
await page.screenshot({ path: "/tmp/uat-0-login.png", fullPage: false });
await context.storageState({ path: "/tmp/uat-state.json" });
console.log("storage state saved");
await browser.close();
