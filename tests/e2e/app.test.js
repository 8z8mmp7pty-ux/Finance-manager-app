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

const account = async (name) =>
  page.$eval(`.account-card[aria-label^="${name}"] .account-balance`, (e) => e.textContent);

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
  await addEntry("expense", "Ntorq", 20000, { date: "2026-07-10", reserve: "Salary" });
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

test("R17/R18: payments default to Super Money; another account can be chosen", { skip }, async () => {
  await page.tap(".type-card[data-flow=expense]");
  await settle();
  await page.tap('#pick-grid .category-card:has-text("Groceries")');
  await settle();
  assert.equal(await page.textContent("#account-label"), "Paid from account");
  assert.equal(
    await page.$eval('#account-chips .chip[aria-checked="true"] .chip-name', (e) => e.textContent),
    "Super Money"
  );
  await page.tap('#account-chips .chip:has-text("GPay")');
  await page.fill("#amount", "300");
  await page.tap("#post-btn");
  await cards(9);
  assert.equal(await account("GPay"), "-₹300");
  assert.equal(await account("Super Money"), "₹46,300");
});

test("R19: contra moves money between accounts without changing reserves or the balance", { skip }, async () => {
  await page.tap('.account-card[aria-label^="Super Money"]');
  await settle();
  assert.equal(await page.textContent("#wizard-title"), "Contra");
  await page.tap('#pick-grid .category-card:has-text("Cash")');
  await settle();
  assert.equal(
    await page.$eval('#pay-from-chips .chip[aria-checked="true"] .chip-name', (e) => e.textContent),
    "General Reserve"
  );
  await page.fill("#amount", "5000");
  await page.tap("#post-btn");
  await cards(10);
  assert.equal(await account("Super Money"), "₹41,300");
  assert.equal(await account("Cash"), "₹5,000");
  assert.equal(await reserve("General Reserve"), "₹46,000.00");
  assert.equal(await page.textContent("#balance"), "₹46,000.00");
  assert.match(await page.textContent(".entry-card.contra"), /Super Money → Cash/);
});

test("R20: grid report of reserves × accounts adds up", { skip }, async () => {
  await page.tap("#report .grid-card");
  const rows = await page.$$eval(".grid-table tr", (trs) =>
    trs.map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim()))
  );
  assert.deepEqual(rows[0], ["Reserve", "Super Money", "GPay", "Cash", "Total"]);
  const general = rows.find((r) => r[0].includes("General Reserve"));
  assert.deepEqual(general.slice(1), ["₹41,300", "-₹300", "₹5,000", "₹46,000"]);
  const total = rows[rows.length - 1];
  assert.deepEqual(total, ["Total", "₹41,300", "-₹300", "₹5,000", "₹46,000"]);
  await page.tap("#report-back");
});

test("R11: 'Transfer all' moves the whole reserve even when it is split across accounts", { skip }, async () => {
  // Salary money in two accounts: 1,000 in Cash and 2,000 in Super Money.
  await page.tap(".type-card[data-flow=income]");
  await settle();
  await page.tap('#pick-grid .category-card:has-text("Salary")');
  await settle();
  await page.tap('#account-chips .chip:has-text("Cash")');
  await page.fill("#amount", "1000");
  await page.tap("#post-btn");
  await cards(11);
  await addEntry("income", "Salary", 2000);
  await cards(12);
  assert.equal(await reserve("Salary"), "₹3,000.00");

  await page.tap('.reserve-card[aria-label^="Salary"]');
  await settle();
  await page.tap('#pick-grid .category-card:has-text("General Reserve")');
  await settle();
  await page.tap("#transfer-all");
  assert.equal(await page.inputValue("#amount"), "3000.00");
  assert.match(await page.textContent("#available-text"), /Super Money ₹2,000\.00 \+ Cash ₹1,000\.00/);
  await page.tap("#post-btn");
  await cards(14);
  assert.match(await page.textContent("#posted"), /Moved all ₹3,000\.00 to General Reserve \(from 2 accounts\)/);
  assert.equal(await reserve("Salary"), "₹0.00");
  assert.equal(await page.textContent("#balance"), "₹49,000.00");

  await page.tap("#report .grid-card");
  const rows = await page.$$eval(".grid-table tr", (trs) =>
    trs.map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim()))
  );
  const salary = rows.find((r) => r[0].includes("Salary"));
  assert.deepEqual(salary.slice(1), ["–", "–", "–", "–"], "no Salary money left in any account");
  await page.tap("#report-back");
});

async function post(flow, category, amount, { reserve: into, account: acct } = {}) {
  await page.tap(`.type-card[data-flow=${flow}]`);
  await settle();
  await page.tap(`#pick-grid .category-card:has-text("${category}")`);
  await settle();
  if (acct) await page.tap(`#account-chips .chip:has-text("${acct}")`);
  if (into) await page.tap(`#pay-from-chips .chip:has-text("${into}")`);
  await page.fill("#amount", String(amount));
  await page.tap("#post-btn");
}

async function startTransferAll(from, to) {
  await page.tap(`.reserve-card[aria-label^="${from}"]`);
  await settle();
  await page.tap(`#pick-grid .category-card:has-text("${to}")`);
  await settle();
  await page.tap("#transfer-all");
}

test("R11: Transfer all never overdraws a reserve that is negative in one account", { skip }, async () => {
  await post("income", "Business", 3000);
  await cards(15);
  await post("expense", "Shopping", 500, { reserve: "Business", account: "Cash" });
  await cards(16);
  assert.equal(await reserve("Business"), "₹2,500.00");
  await startTransferAll("Business", "General Reserve");
  assert.equal(await page.inputValue("#amount"), "2500.00");
  await page.tap("#post-btn");
  await cards(17);
  assert.equal(await reserve("Business"), "₹0.00");
  assert.equal(await page.textContent("#balance"), "₹51,500.00");
});

test("R11: a Transfer all amount does not carry over to a transfer from another reserve", { skip }, async () => {
  await post("income", "Freelance", 500);
  await cards(18);
  await post("income", "Freelance", 250, { account: "GPay" });
  await cards(19);
  await startTransferAll("Freelance", "General Reserve");
  assert.equal(await page.inputValue("#amount"), "750.00");
  await page.tap('.reserve-card[aria-label^="General Reserve"]');
  await settle();
  await page.tap('#pick-grid .category-card:has-text("Freelance")');
  await settle();
  assert.equal(await page.inputValue("#amount"), "", "no leftover amount");
  assert.ok(await page.isVisible('#account-chips .chip[aria-checked="true"]'), "back to a one-account transfer");
});

test("R11: if Transfer all fails halfway, the rest can be moved and nothing is lost", { skip }, async () => {
  let posts = 0;
  await page.route("**/api/entries", async (route) => {
    if (route.request().method() === "POST" && ++posts === 2) {
      await route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"Simulated failure"}' });
    } else {
      await route.continue();
    }
  });
  await startTransferAll("Freelance", "General Reserve");
  await page.tap("#post-btn");
  await page.waitForFunction(() => document.getElementById("status").textContent.includes("Simulated failure"));
  assert.match(await page.textContent("#status"), /Moved ₹500\.00 of ₹750\.00.*Tap Transfer to move the rest/);
  assert.equal(await page.inputValue("#amount"), "250.00");
  assert.match(await page.textContent("#available-text"), /GPay ₹250\.00/);
  await page.unroute("**/api/entries");

  await page.tap("#post-btn");
  await cards(21);
  assert.equal(await reserve("Freelance"), "₹0.00");
  assert.equal(await page.textContent("#balance"), "₹52,250.00");
});

test("R11: 'nothing to move' is shown, then cleared when leaving; new flows start with no amount", { skip }, async () => {
  await startTransferAll("Business", "General Reserve");
  assert.equal(await page.textContent("#status"), "Business has nothing to move.");
  await page.tap("#wizard-back");
  await settle();
  assert.ok(await page.isHidden("#status"), "message cleared after leaving the step");

  await startTransferAll("General Reserve", "Salary");
  assert.notEqual(await page.inputValue("#amount"), "");
  for (let i = 0; i < 3; i++) {
    await page.tap("#wizard-back"); // amount → to → from → type
    await settle();
  }
  await page.tap(".type-card[data-flow=income]");
  await settle();
  await page.tap('#pick-grid .category-card:has-text("Salary")');
  await settle();
  assert.equal(await page.inputValue("#amount"), "", "no Transfer all amount in a new income");
  await page.tap("#wizard-back");
  await settle();
  await page.tap("#wizard-back");
  await settle();
});

test("R7: expense cards include 'Ntorq' and 'For Mom, Dad, Muthu' (replacing 'Rent' and 'EMI & Loans')", { skip }, async () => {
  await page.tap(".type-card[data-flow=expense]");
  await settle();
  const names = await page.$$eval("#pick-grid .category-name", (els) => els.map((e) => e.textContent));
  assert.deepEqual(names, [
    "Food & Dining", "Groceries", "Ntorq", "Bills & Utilities", "Transport", "Shopping",
    "Health", "Education", "Entertainment", "Travel", "For Mom, Dad, Muthu", "Other",
  ]);
  await page.tap('#pick-grid .category-card:has-text("For Mom, Dad, Muthu")');
  await settle();
  await page.fill("#amount", "2000");
  await page.tap("#post-btn");
  await page.waitForSelector('.entry-card:has-text("For Mom, Dad, Muthu")');
  assert.match(await page.textContent('.entry-card:has-text("For Mom, Dad, Muthu")'), /❤️/);
  // R7: "Ntorq" (scooter) replaced "Rent".
  assert.match(await page.textContent('.entry-card:has-text("Ntorq")'), /🛵/);
});

test("R14/R7: the report shows the 🛵 Ntorq expense paid from July salary", { skip }, async () => {
  await page.tap('#report-body .category-card:has-text("Salary")');
  await page.tap('#report-body .category-card:has-text("July 2026")');
  const rows = await page.$$eval("#report-body .report-row", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
  assert.ok(rows.some((r) => r.includes("🛵") && r.includes("Ntorq")), rows.join(" | "));
  await page.tap("#report-back");
  await page.tap("#report-back");
});

test("R7/R5: entries saved with a replaced category keep their name and icon and can be edited", { skip }, async () => {
  const res = await page.request.post(URL_ + "api/entries", {
    data: { type: "expense", category: "Rent", description: "", amount: 9000, date: "2026-06-01" },
  });
  assert.equal(res.status(), 201);
  await page.reload();
  await page.waitForSelector(".entry-card");
  const card = page.locator('.entry-card:has-text("Rent")').first();
  assert.match(await card.innerText(), /🏠/);

  await card.tap();
  await page.waitForSelector("dialog[open]");
  assert.equal(
    await page.$eval('#edit-categories .category-card[aria-checked="true"] .category-name', (e) => e.textContent),
    "Rent"
  );
  await page.fill("#edit-amount", "9500");
  await page.tap("#edit-save");
  await page.waitForFunction(() => !document.querySelector("dialog").open);
  const saved = (await (await page.request.get(URL_ + "api/entries")).json()).find((e) => e.category === "Rent");
  assert.equal(saved.amount, 9500);
});
