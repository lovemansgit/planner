// Day-52 proving pass — parametric UI driver. Loads the saved login
// session and performs one popover action on the Roudy M consignee
// calendar against production. Diagnostic pass: generous logging,
// screenshot at each stage, no retries.
//
// Usage:
//   node scripts/uat-leg.mjs recon
//   node scripts/uat-leg.mjs note  <delivery-date> <note text...>
//   node scripts/uat-leg.mjs skip  <delivery-date>
//   node scripts/uat-leg.mjs pause <delivery-date> <pause-start> <pause-end>

import { chromium } from "playwright";

const BASE = "https://planner-olive-sigma.vercel.app";
const CONSIGNEE = "5071ebd6-e774-413f-8437-8e89e2b56d7c";
const [mode, date, ...rest] = process.argv.slice(2);

const browser = await chromium.launch();
const context = await browser.newContext({ storageState: "/tmp/uat-state.json" });
const page = await context.newPage();

await page.goto(`${BASE}/consignees/${CONSIGNEE}?tab=calendar&view=month`, {
  waitUntil: "networkidle",
});
console.log(`url: ${page.url()}`);
await page.screenshot({ path: `/tmp/uat-leg-${mode}-1-calendar.png`, fullPage: true });

const labels = await page
  .locator("[aria-label]")
  .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")).filter((l) => l && /eliver|une|task|day/i.test(l)));
console.log("delivery-ish aria-labels on page:");
for (const l of labels.slice(0, 40)) console.log(`  ${l}`);

if (mode === "recon") {
  await browser.close();
  process.exit(0);
}

// Open the day popover for the target delivery date. The month grid
// renders one cell per day; locate the cell whose day-number text is
// exactly the target day, then click its delivery card (status text).
// Cells are plain divs: <div><p>{dayNum}</p><ul><li><button (popover
// trigger, contains the status text)>…  Find the exact day-number <p>,
// step up to the cell, click the trigger button inside.
const dayNumber = String(Number(date.slice(8, 10)));
const dayP = page.locator("p").filter({ hasText: new RegExp(`^${dayNumber}$`) }).first();
if ((await dayP.count()) === 0) {
  console.error(`FAIL-NAV: no day-number <p> for day ${dayNumber}`);
  await browser.close();
  process.exit(3);
}
const trigger = dayP.locator("xpath=..").locator("button").first();
if ((await trigger.count()) === 0) {
  console.error(`FAIL-NAV: day ${dayNumber} cell has no delivery card button`);
  await browser.close();
  process.exit(3);
}
await trigger.click();
await page.waitForTimeout(800);
await page.screenshot({ path: `/tmp/uat-leg-${mode}-2-popover.png`, fullPage: true });
const popoverText = (await page.textContent("body"))?.replace(/\s+/g, " ").slice(0, 100);
console.log(`after day click, body head: ${popoverText}`);

async function clickAction(label) {
  const btn = page.getByText(label, { exact: false }).first();
  if ((await btn.count()) === 0) {
    console.error(`FAIL-NAV: action "${label}" not found in popover`);
    const visible = await page
      .locator("button")
      .evaluateAll((els) => els.map((e) => e.textContent?.trim()).filter(Boolean));
    console.error(`visible buttons: ${JSON.stringify(visible.slice(0, 30))}`);
    await browser.close();
    process.exit(4);
  }
  await btn.click();
  await page.waitForTimeout(600);
}

if (mode === "note") {
  await clickAction("Add note to driver");
  const noteText = rest.join(" ") || "UAT proving pass note — Day-52";
  await page.fill('textarea[name="note"]', noteText);
  await page.screenshot({ path: `/tmp/uat-leg-note-3-filled.png`, fullPage: true });
  await page.locator('textarea[name="note"]').locator("xpath=ancestor::form").locator('button[type="submit"]').click();
  await page.waitForTimeout(4000);
} else if (mode === "skip") {
  await clickAction("Skip this delivery");
  await page.screenshot({ path: `/tmp/uat-leg-skip-3-form.png`, fullPage: true });
  // Skip form: submit button labelled "Skip delivery"
  await page.getByText("Skip delivery", { exact: true }).first().click();
  await page.waitForTimeout(4000);
} else if (mode === "pause") {
  await clickAction("Pause from this date");
  await page.screenshot({ path: `/tmp/uat-leg-pause-3-form.png`, fullPage: true });
  const [pauseStart, pauseEnd] = rest;
  const inputs = page.locator('form input[type="date"]');
  const n = await inputs.count();
  console.log(`pause form date inputs: ${n}`);
  if (n >= 2) {
    await inputs.nth(0).fill(pauseStart);
    await inputs.nth(1).fill(pauseEnd);
  } else if (n === 1) {
    // start may be pre-bound to the clicked day; single input = pause_end
    await inputs.nth(0).fill(pauseEnd);
  }
  await page.screenshot({ path: `/tmp/uat-leg-pause-4-filled.png`, fullPage: true });
  const form = page.locator('input[type="date"]').first().locator("xpath=ancestor::form");
  await form.locator('button[type="submit"]').click();
  await page.waitForTimeout(4000);
}

await page.screenshot({ path: `/tmp/uat-leg-${mode}-5-after.png`, fullPage: true });
const after = (await page.textContent("body"))?.replace(/\s+/g, " ");
const interesting = after?.match(/(saved[^.]*\.|skip[^.]*\.|pause[^.]*\.|error[^.]*\.|fail[^.]*\.|cancel[^.]*\.)/gi);
console.log(`result fragments: ${JSON.stringify(interesting?.slice(0, 8))}`);
await browser.close();
