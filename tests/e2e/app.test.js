// End-to-end tests in a real (headless) browser, on a phone-sized screen.
// Needs TEST_DATABASE_URL and a Playwright Chromium (npx playwright install chromium).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { skip, raw, TEST_DB } from "../helpers.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const PORT = 3210 + Math.floor(Math.random() * 500);
const URL_ = `http://localhost:${PORT}/`;
let server, browser, page;

before(async () => {
  if (skip) return;
  await raw("DROP TABLE IF EXISTS entries");
  server = spawn(process.execPath, ["dev-server.js"], {
    cwd: root,
    env: { ...process.env, DATABASE_URL: TEST_DB, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (d) => String(d).includes("running at") && resolve());
    server.on("exit", (code) => reject(new Error("dev server exited: " + code)));
  });
  const { chromium, devices } = await import("playwright");
  browser = await chromium.launch();
  page = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
  page.on("dialog", (d) => d.accept());
  page.on("pageerror", (e) => assert.fail("page error: " + e.message));
});

after(async () => {
  await browser?.close();
  server?.kill();
});

const settle = () => page.waitForTimeout(250);
const cards = (n) => page.waitForFunction((n) => document.querySelectorAll(".entry-card").length === n, n);
const reserve = async (name) =>
  page.$eval(`.reserve-card[aria-label^="${name}"] .reserve-balance`, (e) => e.textContent);

async function addEntry(flow, category, amount, { date, reserve: into } = {}) {
  await page.tap(`.type-card[data-flow=${flow}]`);
  await settle();
  await page.tap(`#pick-grid .category-card:has-text("${category}")`);
  await settle();
  if (into) await page.tap(`#pay-from-chips .chip:has-text("${into}")`);
  await page.fill("#amount", String(amount));
  if (date) await page.fill("#date", date);
  await page.tap("#post-btn");
}

test("R4: app opens straight to the balance with no password", { skip }, async () => {
  await page.goto(URL_);
  await page.waitForSelector("#app:not([hidden])");
  assert.equal(await page.locator("input[type=password]").count(), 0);
  assert.equal(await page.textContent("#balance"), "₹0.00");
});

test("R6/R7: adding an entry rides through type → category → amount cards", { skip }, async () => {
  assert.ok(await page.isVisible('.step[data-step="type"]'));
  assert.ok(await page.isHidden('.step[data-step="amount"]'));
  await page.tap(".type-card[data-flow=income]");
  await settle();
  assert.ok(await page.isHidden('.step[data-step="amount"]'), "amount step hidden while picking category");
  const names = await page.$$eval("#pick-grid .category-name", (els) => els.map((e) => e.textContent));
  assert.ok(names.includes("Salary") && names.includes("Freelance"));
  await page.tap('#pick-grid .category-card:has-text("Salary")');
  await settle();
  assert.equal(await page.textContent("#pay-from-label"), "Goes into reserve");
  await page.fill("#amount", "50000");
  await page.fill("#date", "2026-07-01");
  await page.tap("#post-btn");
  await cards(1);
  assert.equal(await page.textContent("#balance"), "₹50,000.00");
  assert.ok(await page.isVisible('.step[data-step="type"]'), "wizard returns to step 1");
});

test("R8/R9/R10: income reserves, income allotted elsewhere, expense paid from a chosen reserve", { skip }, async () => {
  await addEntry("income", "Salary", 60000, { date: "2026-08-01" });
  await cards(2);
  await addEntry("income", "Gift", 1000, { date: "2026-08-02", reserve: "General Reserve" });
  await cards(3);
  await addEntry("expense", "Rent", 20000, { date: "2026-07-10", reserve: "Salary" });
  await cards(4);
  await addEntry("expense", "Shopping", 45000, { date: "2026-08-03", reserve: "Salary" });
  await cards(5);
  await addEntry("expense", "Transport", 500, { date: "2026-08-04" });
  await cards(6);
  assert.equal(await reserve("Salary"), "₹45,000.00");
  assert.equal(await reserve("General Reserve"), "₹500.00");
  assert.equal(await page.locator('.reserve-card[aria-label^="Gift"]').count(), 0);
  assert.equal(await page.textContent("#balance"), "₹45,500.00");
});

test("R14/R13: report shows what happened to Salary of August (FIFO after July)", { skip }, async () => {
  await page.tap('#report-body .category-card:has-text("Salary")');
  await page.tap('#report-body .category-card:has-text("August 2026")');
  const text = (await page.textContent("#report-body")).replace(/\s+/g, " ");
  assert.match(text, /What happened to Salary of August 2026\?/);
  assert.match(text, /Received₹60,000\.00/);
  assert.match(text, /Used₹15,000\.00/);
  assert.match(text, /Left₹45,000\.00/);
  assert.match(text, /after the older money in this reserve was used up/);
  assert.match(text, /Shopping/);
  assert.match(text, /₹15,000\.00 of ₹45,000\.00 — ₹30,000\.00 from Salary of July 2026/);
  assert.doesNotMatch(text, /Transport/, "General Reserve expense is not part of the salary report");
  await page.tap("#report-back");
  await page.tap("#report-back");
});

test("R11/R12: tapping a reserve card transfers its whole balance; total balance unchanged", { skip }, async () => {
  await page.tap('.reserve-card[aria-label^="Salary"]');
  await settle();
  await page.tap('#pick-grid .category-card:has-text("General Reserve")');
  await settle();
  await page.tap("#transfer-all");
  assert.equal(await page.inputValue("#amount"), "45000.00");
  await page.tap("#post-btn");
  await cards(7);
  assert.equal(await reserve("Salary"), "₹0.00");
  assert.equal(await reserve("General Reserve"), "₹45,500.00");
  assert.equal(await page.textContent("#balance"), "₹45,500.00");
});

test("R5: tapping an entry card opens the editor; changes are saved to the database", { skip }, async () => {
  await page.tap('.entry-card:has-text("Transport")');
  await page.waitForSelector("dialog[open]");
  await page.fill("#edit-amount", "700");
  await page.tap("#edit-save");
  await page.waitForFunction(() => !document.querySelector("dialog").open);
  await page.reload();
  await page.waitForSelector(".entry-card");
  assert.equal(await page.textContent("#balance"), "₹45,300.00");
});

test("R9: an income's reserve can be changed in the editor", { skip }, async () => {
  await addEntry("income", "Gift", 1000, { date: "2026-08-10" });
  await cards(8);
  assert.equal(await reserve("Gift"), "₹1,000.00");
  await page.tap('.entry-card:has-text("Gift")');
  await page.waitForSelector("dialog[open]");
  assert.equal(await page.textContent("#edit-pay-from-label"), "Goes into reserve");
  // Balances in the editor leave out the entry being edited.
  assert.equal(
    await page.$eval('#edit-pay-from-chips .chip[aria-checked="true"]', (e) => e.innerText.replace(/\s+/g, " ")),
    "🎁 Gift ₹0.00"
  );
  await page.tap('#edit-pay-from-chips .chip:has-text("General Reserve")');
  await page.tap("#edit-save");
  await page.waitForFunction(() => !document.querySelector("dialog").open);
  await page.reload();
  await page.waitForSelector(".entry-card");
  assert.equal(await page.locator('.reserve-card[aria-label^="Gift"]').count(), 0);
  assert.equal(await reserve("General Reserve"), "₹46,300.00");
  assert.equal(await page.textContent("#balance"), "₹46,300.00");
});
