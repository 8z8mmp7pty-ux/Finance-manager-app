// End-to-end tests in a real (headless) browser, on a phone-sized screen.
// Needs TEST_DATABASE_URL and a Playwright Chromium (npx playwright install chromium).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { skip, raw, TEST_DB } from "../helpers.js";
import { autoPlans, planDates } from "../../public/ledger.js";

const root = fileURLToPath(new URL("../..", import.meta.url));
const PORT = 3210 + Math.floor(Math.random() * 500);
const URL_ = `http://localhost:${PORT}/`;
let server, browser, page;

before(async () => {
  if (skip) return;
  await raw("DROP TABLE IF EXISTS entries, budgets, plans");
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

// The Add Entry popup (R41): opened with the + button, and by itself whenever the app loads.
const addOpen = () => page.evaluate(() => document.getElementById("add-dialog").open);
async function openAdd() {
  if (!(await addOpen())) {
    await page.tap("#add-fab");
    await settle();
  }
}
async function closeAdd() {
  if (await addOpen()) await page.tap("#add-close");
}

// Switches screen the way the nav buttons do (#entries, #reports, #budget; "" = home).
async function screen(name) {
  await closeAdd();
  await page.evaluate((n) => {
    location.hash = n;
  }, name);
  await page.waitForSelector(`#screen-${name || "home"}:not([hidden])`);
}

// Opens a report from the Reports menu.
async function openReport(kind) {
  await screen("reports");
  while (await page.isVisible("#report-back")) await page.tap("#report-back");
  await page.tap(`[data-report="${kind}"]`);
}

const account = async (name) =>
  page.$eval(`.account-card[aria-label^="${name}"] .account-balance`, (e) => e.textContent);

// If the card asks for a type (Ntorq: Petrol / Repair / Accessory), pick one.
async function pickSubIfAsked(sub = "Petrol") {
  if (await page.isVisible('.step[data-step="pick"]')) {
    await page.tap(`#pick-grid .category-card:has-text("${sub}")`);
    await settle();
  }
}

async function addEntry(flow, category, amount, { date, reserve: into, sub } = {}) {
  await openAdd();
  await page.tap(`.type-card[data-flow=${flow}]`);
  await settle();
  await page.tap(`#pick-grid .category-card:has-text("${category}")`);
  await settle();
  await pickSubIfAsked(sub);
  if (into) await page.tap(`#pay-from-chips .chip:has-text("${into}")`);
  await page.fill("#amount", String(amount));
  if (date) await page.fill("#date", date);
  await page.tap("#post-btn");
}

test("R4: app opens straight to the balance with no password", { skip }, async () => {
  await page.goto(URL_);
  await page.waitForSelector("#app:not([hidden])");
  assert.equal(await page.locator("input[type=password]").count(), 0);
  // R41: the Add Entry popup opens by itself when the app opens.
  assert.ok(await addOpen(), "Add Entry opens automatically");
  assert.equal(await page.textContent("#balance"), "₹0.00");
  // R1: no income / expense totals under the balance on the home page.
  assert.equal(await page.locator("#screen-home .totals, #total-income, #total-expense").count(), 0);
});

test("R6/R7: adding an entry rides through type → category → amount cards", { skip }, async () => {
  assert.ok(await page.isVisible('.step[data-step="type"]'));
  assert.ok(await page.isHidden('.step[data-step="amount"]'));
  await openAdd();
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
  // R41: after Post the popup closes and a confirmation shows; + opens it again at step 1.
  assert.equal(await addOpen(), false);
  assert.match(await page.textContent("#posted"), /Added to Salary/);
  await openAdd();
  assert.ok(await page.isVisible('.step[data-step="type"]'), "a fresh entry starts at step 1");
});

test("R8/R9/R10: income reserves, income allotted elsewhere, expense paid from a chosen reserve", { skip }, async () => {
  await addEntry("income", "Salary", 60000, { date: "2026-08-01" });
  await cards(2);
  await addEntry("income", "Gift", 1000, { date: "2026-08-02", reserve: "General Reserve" });
  await cards(3);
  await addEntry("expense", "Ntorq", 20000, { date: "2026-07-10", reserve: "Salary" });
  await cards(4);
  await addEntry("expense", "Dress", 45000, { date: "2026-08-03", reserve: "Salary" });
  await cards(5);
  await addEntry("expense", "Transport", 500, { date: "2026-08-04" });
  await cards(6);
  assert.equal(await reserve("Salary"), "₹45,000.00");
  assert.equal(await reserve("General Reserve"), "₹500.00");
  assert.equal(await page.locator('.reserve-card[aria-label^="Gift"]').count(), 0);
  assert.equal(await page.textContent("#balance"), "₹45,500.00");
});

test("R14/R13: report shows what happened to Salary of August (FIFO after July)", { skip }, async () => {
  await openReport("reserve");
  await page.tap('#report-body .category-card:has-text("Salary")');
  await page.tap('#report-body .category-card:has-text("August 2026")');
  const text = (await page.textContent("#report-body")).replace(/\s+/g, " ");
  assert.match(text, /What happened to Salary of August 2026\?/);
  assert.match(text, /Received₹60,000\.00/);
  assert.match(text, /Used₹15,000\.00/);
  assert.match(text, /Left₹45,000\.00/);
  assert.match(text, /after the older money in this reserve was used up/);
  assert.match(text, /Dress/);
  assert.match(text, /₹15,000\.00 of ₹45,000\.00 — ₹30,000\.00 from Salary of July 2026/);
  assert.doesNotMatch(text, /Transport/, "General Reserve expense is not part of the salary report");
  await screen("");
});

test("R11/R12: tapping a reserve card transfers its whole balance; total balance unchanged", { skip }, async () => {
  await closeAdd();
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
  await screen("entries");
  await page.tap('.entry-card:has-text("Transport")');
  await page.waitForSelector("dialog[open]");
  await page.fill("#edit-amount", "700");
  await page.tap("#edit-save");
  await page.waitForFunction(() => !document.querySelector("dialog").open);
  await page.reload();
  await page.waitForSelector(".entry-card", { state: "attached" });
  await closeAdd();
  assert.equal(await page.textContent("#balance"), "₹45,300.00");
  await screen("");
});

test("R9: an income's reserve can be changed in the editor", { skip }, async () => {
  await addEntry("income", "Gift", 1000, { date: "2026-08-10" });
  await cards(8);
  assert.equal(await reserve("Gift"), "₹1,000.00");
  await screen("entries");
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
  await page.waitForSelector(".entry-card", { state: "attached" });
  await closeAdd();
  assert.equal(await page.locator('.reserve-card[aria-label^="Gift"]').count(), 0);
  assert.equal(await reserve("General Reserve"), "₹46,300.00");
  assert.equal(await page.textContent("#balance"), "₹46,300.00");
  await screen("");
});

test("R17/R18: payments default to Super Money; another account can be chosen", { skip }, async () => {
  await openAdd();
  await page.tap(".type-card[data-flow=expense]");
  await settle();
  await page.tap('#pick-grid .category-card:has-text("Mandatory Food")');
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
  await closeAdd();
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
  await openReport("grid");
  const rows = await page.$$eval("#report .grid-table tr", (trs) =>
    trs.map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim()))
  );
  assert.deepEqual(rows[0], ["Reserve", "Super Money", "GPay", "Cash", "Total"]);
  const general = rows.find((r) => r[0].includes("General Reserve"));
  assert.deepEqual(general.slice(1), ["₹41,300", "-₹300", "₹5,000", "₹46,000"]);
  const total = rows[rows.length - 1];
  assert.deepEqual(total, ["Total", "₹41,300", "-₹300", "₹5,000", "₹46,000"]);
  await screen("");
});

test("R11: 'Transfer all' moves the whole reserve even when it is split across accounts", { skip }, async () => {
  // Salary money in two accounts: 1,000 in Cash and 2,000 in Super Money.
  await openAdd();
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

  await closeAdd();

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

  await openReport("grid");
  const rows = await page.$$eval("#report .grid-table tr", (trs) =>
    trs.map((tr) => [...tr.children].map((c) => c.innerText.replace(/\s+/g, " ").trim()))
  );
  const salary = rows.find((r) => r[0].includes("Salary"));
  assert.deepEqual(salary.slice(1), ["–", "–", "–", "–"], "no Salary money left in any account");
  await screen("");
});

async function post(flow, category, amount, { reserve: into, account: acct, sub } = {}) {
  await openAdd();
  await page.tap(`.type-card[data-flow=${flow}]`);
  await settle();
  await page.tap(`#pick-grid .category-card:has-text("${category}")`);
  await settle();
  await pickSubIfAsked(sub);
  if (acct) await page.tap(`#account-chips .chip:has-text("${acct}")`);
  if (into) await page.tap(`#pay-from-chips .chip:has-text("${into}")`);
  await page.fill("#amount", String(amount));
  await page.tap("#post-btn");
}

async function startTransferAll(from, to) {
  await closeAdd(); // the reserve cards are on the page behind the popup
  await page.tap(`.reserve-card[aria-label^="${from}"]`);
  await settle();
  await page.tap(`#pick-grid .category-card:has-text("${to}")`);
  await settle();
  await page.tap("#transfer-all");
}

test("R11: Transfer all never overdraws a reserve that is negative in one account", { skip }, async () => {
  await post("income", "Business", 3000);
  await cards(15);
  await post("expense", "Dress", 500, { reserve: "Business", account: "Cash" });
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
  await closeAdd(); // ✕, then tap another reserve on the page
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
  await page.waitForFunction(() => document.getElementById("add-status").textContent.includes("Simulated failure"));
  assert.match(await page.textContent("#add-status"), /Moved ₹500\.00 of ₹750\.00.*Tap Transfer to move the rest/);
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
  // R41: while the popup is open its messages show inside it.
  assert.equal(await page.textContent("#add-status"), "Business has nothing to move.");
  await page.tap("#wizard-back");
  await settle();
  assert.ok(await page.isHidden("#add-status"), "message cleared after leaving the step");

  await startTransferAll("General Reserve", "Salary");
  assert.notEqual(await page.inputValue("#amount"), "");
  for (let i = 0; i < 3; i++) {
    await page.tap("#wizard-back"); // amount → to → from → type
    await settle();
  }
  await openAdd();
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
  await openAdd();
  await page.tap(".type-card[data-flow=expense]");
  await settle();
  const names = await page.$$eval("#pick-grid .category-name", (els) => els.map((e) => e.textContent));
  assert.deepEqual(names, [
    "Mandatory Food", "Optional Food", "Ntorq", "Bills & Utilities", "Transport", "Dress",
    "Health", "Education", "Entertainment", "For Mom, Dad, Muthu", "Other",
  ]);
  await page.tap('#pick-grid .category-card:has-text("For Mom, Dad, Muthu")');
  await settle();
  await page.fill("#amount", "2000");
  await page.tap("#post-btn");
  await page.waitForSelector('.entry-card:has-text("For Mom, Dad, Muthu")', { state: "attached" });
  assert.match(await page.textContent('.entry-card:has-text("For Mom, Dad, Muthu")'), /❤️/);
  // R7: "Ntorq" (scooter) replaced "Rent".
  assert.match(await page.textContent('.entry-card:has-text("Ntorq")'), /🛵/);
});

test("R14/R7: the report shows the 🛵 Ntorq expense paid from July salary", { skip }, async () => {
  await openReport("reserve");
  await page.tap('#report-body .category-card:has-text("Salary")');
  await page.tap('#report-body .category-card:has-text("July 2026")');
  const rows = await page.$$eval("#report-body .report-row", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
  assert.ok(rows.some((r) => r.includes("🛵") && r.includes("Ntorq")), rows.join(" | "));
  await screen("");
});

test("R7/R5: entries saved with a replaced category keep their name and icon and can be edited", { skip }, async () => {
  const res = await page.request.post(URL_ + "api/entries", {
    data: { type: "expense", category: "Rent", description: "", amount: 9000, date: "2026-06-01" },
  });
  assert.equal(res.status(), 201);
  await page.reload();
  await page.waitForSelector(".entry-card", { state: "attached" });
  await closeAdd();
  await screen("entries");
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
  await screen("");
});

// ---------- Entries screen, reports, budget & plans (R21–R26) ----------

function localToday() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}
const visibleCards = () => page.$$eval("#entries .entry-card", (els) => els.map((e) => e.className));

test("R21: the entries list is on its own screen, opened from a button on the home page", { skip }, async () => {
  await screen("");
  assert.ok(await page.isHidden("#entries"), "no entries list on the home page");
  await page.tap("#nav-entries");
  await page.waitForSelector("#screen-entries:not([hidden])");
  assert.equal(await page.textContent("#page-title"), "Entries");
  assert.ok(await page.isVisible("#entries .entry-card"));
  await page.tap("#nav-back");
  await page.waitForSelector("#screen-home:not([hidden])");
  assert.ok(await page.isVisible("#add-fab"), "the + button for adding entries is on the home page");
});

test("R22: quick filter buttons and more filters narrow the entries list", { skip }, async () => {
  await screen("entries");
  const all = (await visibleCards()).length;
  await page.tap('#quick-type .qf[data-type="expense"]');
  const expenses = await visibleCards();
  assert.ok(expenses.length > 0 && expenses.length < all);
  assert.ok(expenses.every((c) => c.includes("expense")));
  assert.match(await page.textContent("#filter-summary"), /entries · Out ₹/);

  await page.tap("#more-filters summary");
  await page.selectOption("#f-category", "Ntorq");
  const ntorq = await page.$$eval("#entries .entry-card", (els) => els.map((e) => e.innerText));
  assert.ok(ntorq.length >= 1 && ntorq.every((t) => t.includes("Ntorq")));
  assert.equal(await page.textContent("#filter-count"), "1");

  await page.selectOption("#f-category", "");
  await page.fill("#f-search", "muthu");
  const muthu = await page.$$eval("#entries .entry-card", (els) => els.map((e) => e.innerText));
  assert.equal(muthu.length, 1);
  assert.match(muthu[0], /For Mom, Dad, Muthu/);

  await page.tap('#quick-period .qf[data-period="last-month"]');
  assert.match(await page.textContent("#empty"), /No entries match/);
  await page.tap("#f-clear");
  assert.equal((await visibleCards()).length, all);
  await screen("");
});

test("R23: spending report groups expenses by category and opens their entries", { skip }, async () => {
  await openReport("spending");
  await page.tap('#report-body .qf[data-period="all"]');
  const entries = await (await page.request.get(URL_ + "api/entries")).json();
  const expected = entries.filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);
  const total = await page.textContent("#report-body .spend-total .tile-value");
  assert.equal(total, "₹" + expected.toLocaleString("en-IN", { minimumFractionDigits: 2 }));
  const rows = await page.$$eval("#report-body .spend-row", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
  assert.ok(rows.some((r) => r.includes("Ntorq")) && rows.some((r) => r.includes("For Mom, Dad, Muthu")));

  await page.tap('#report-body .spend-row:has-text("Ntorq")');
  await page.waitForSelector("#screen-entries:not([hidden])");
  const shown = await page.$$eval("#entries .entry-card", (els) => els.map((e) => e.innerText));
  assert.ok(shown.length >= 1 && shown.every((t) => t.includes("Ntorq")));
  await page.tap("#f-clear");
  await screen("");
});

test("R24: reserve utilisation shows each receipt's use; a receipt shows where it went", { skip }, async () => {
  await openReport("util-reserve");
  await page.tap('#report-body .category-card:has-text("Salary")');
  const rows = await page.$$eval("#report-body .receipt-row", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
  assert.ok(rows.length >= 2);
  const july = rows.findIndex((r) => r.includes("1 Jul 2026"));
  assert.ok(july >= 0, rows.join(" | "));
  assert.match(rows[july], /Fully used/);
  await page.locator("#report-body .receipt-row").nth(july).tap();
  const text = (await page.textContent("#report-body")).replace(/\s+/g, " ");
  assert.match(text, /Where did Salary of 1 Jul 2026 go\?/);
  assert.match(text, /Ntorq/);
  assert.match(text, /Dress/);
  await screen("");
});

test("R25: a monthly budget per category shows spent against budget", { skip }, async () => {
  await page.tap("#nav-budget");
  await page.waitForSelector("#screen-budget:not([hidden])");
  await page.tap("#budget-add");
  await page.waitForSelector("#budget-dialog[open]");
  await page.tap('#budget-categories .category-card:has-text("Mandatory Food")');
  await page.fill("#budget-amount", "5000");
  await page.tap("#budget-save");
  await page.waitForFunction(() => !document.getElementById("budget-dialog").open);
  const row = (await page.textContent('#budget-list .budget-row:has-text("Mandatory Food")')).replace(/\s+/g, " ");
  assert.match(row, /₹300\.00 of ₹5,000\.00/);
  assert.match(row, /₹4,700\.00 left/);
  assert.match(await page.textContent("#budget-summary"), /Spent ₹300\.00 of ₹5,000\.00/);
});

test("R26/R40: planned cashflows feed the forecast, repeat as one line per month, and can be recorded as entries", { skip }, async () => {
  const today = localToday();
  const nextMonth1st = (() => {
    const [y, m] = today.split("-").map(Number);
    return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  })();

  // Monthly salary from next month.
  await page.tap("#plan-add");
  await page.waitForSelector("#plan-dialog[open]");
  await page.tap('#plan-dialog .toggle.income');
  await page.tap('#plan-categories .category-card:has-text("Salary")');
  await page.fill("#plan-amount", "60000");
  await page.fill("#plan-date", nextMonth1st);
  await page.tap('#plan-dialog label:has-text("Every month")');
  await page.tap("#plan-save");
  await page.waitForFunction(() => !document.getElementById("plan-dialog").open);

  // One-time Ntorq service due today.
  await page.tap("#plan-add");
  await page.tap('#plan-categories .category-card:has-text("Ntorq")');
  await page.fill("#plan-amount", "1500");
  await page.fill("#plan-note", "Service");
  await page.tap("#plan-save");
  await page.waitForFunction(() => !document.getElementById("plan-dialog").open);
  // R40: the monthly salary shows one line per date in the 3-month forecast; the one-time plan once.
  const salaryDates = planDates({ nextDate: nextMonth1st, repeat: "monthly", day: 1 }, today);
  assert.ok(salaryDates.length >= 2);
  assert.equal(await page.locator("#plan-list .plan-item:not(.auto-plan)").count(), salaryDates.length + 1);
  const salaryLines = page.locator('#plan-list .plan-item:not(.auto-plan):has-text("Salary")');
  assert.equal(await salaryLines.count(), salaryDates.length);
  const metas = await salaryLines.locator(".entry-date").allTextContents();
  metas.forEach((m, i) => assert.match(m, new RegExp(`every month · ${i + 1} of ${salaryDates.length}`), m));
  assert.equal(await salaryLines.locator(".record-btn").count(), 1, "only the next date can be recorded");
  assert.equal(await salaryLines.first().locator(".record-btn").count(), 1);
  // All plan lines are in date order: the Ntorq plan due today comes first.
  assert.match(await page.textContent("#plan-list .plan-item:not(.auto-plan)"), /Ntorq/);
  // Tapping a later line edits the plan.
  await salaryLines.nth(1).locator(".plan-row").tap();
  await page.waitForSelector("#plan-dialog[open]");
  assert.equal(await page.inputValue("#plan-amount"), "60000");
  await page.tap("#plan-close");
  await page.waitForFunction(() => !document.getElementById("plan-dialog").open);

  const rows = await page.$$eval("#forecast-table tr", (trs) => trs.map((tr) => [...tr.children].map((c) => c.innerText.trim())));
  // Header, today, then one row per (part of a) month to the same date 3 months ahead:
  // usually 4 rows (e.g. 26–30 Sept, Oct, Nov, 1–25 Dec), 3 when today is the 1st.
  const expectedMonths = localToday().endsWith("-01") ? 3 : 4;
  assert.equal(rows.length, 1 + 1 + expectedMonths);
  if (expectedMonths === 4) assert.match(rows[2][0], /^\d+–\d+ \w+/, "the first (partial) month shows its days");
  const next = rows[3];
  assert.equal(next[1], "+₹60,000");
  // Out = the Mandatory Food budget (more than its auto plan) plus the automatic lines that reach
  // into next month (e.g. Transport); at least the budget.
  const out = Number(next[2].replace(/[^\d.]/g, ""));
  assert.ok(next[2].startsWith("−") && out >= 5000, next[2]);

  // Record the Ntorq plan: it becomes an entry and the one-time plan goes away.
  const before = (await (await page.request.get(URL_ + "api/entries")).json()).length;
  await page.tap('#plan-list .plan-item:has-text("Ntorq") .record-btn');
  await page.waitForFunction((n) => document.querySelectorAll("#plan-list .plan-item:not(.auto-plan)").length === n, salaryDates.length);
  const after = await (await page.request.get(URL_ + "api/entries")).json();
  assert.equal(after.length, before + 1);
  const recorded = after.find((e) => e.description === "Service");
  assert.deepEqual([recorded.type, recorded.category, recorded.amount, recorded.date], ["expense", "Ntorq", 1500, today]);

  // Record the monthly salary: an entry is added and the plan moves to the following month.
  await page.tap('#plan-list .plan-item:has-text("Salary") .record-btn');
  await page.waitForFunction(() => document.getElementById("status").textContent.startsWith("Recorded Salary"));
  const plans = await (await page.request.get(URL_ + "api/plans")).json();
  assert.equal(plans.length, 1);
  assert.equal(plans[0].nextDate.slice(0, 7) > nextMonth1st.slice(0, 7), true);
  await screen("");
});

test("R21: ← does not leave an extra history step, and changing screen closes an open sheet", { skip }, async () => {
  await screen("");
  const before = await page.evaluate(() => history.length);
  await page.tap("#nav-entries");
  await page.waitForSelector("#screen-entries:not([hidden])");
  await page.tap("#nav-back");
  await page.waitForSelector("#screen-home:not([hidden])");
  assert.equal(await page.evaluate(() => history.length), before + 1, "← went back instead of adding a step");

  await page.tap("#nav-budget");
  await page.waitForSelector("#screen-budget:not([hidden])");
  await page.tap("#plan-add");
  await page.waitForSelector("#plan-dialog[open]");
  await page.goBack(); // the phone's back button
  await page.waitForSelector("#screen-home:not([hidden])");
  assert.equal(await page.$eval("#plan-dialog", (d) => d.open), false);
});

test("R23: an old expense without a category opens from the spending report", { skip }, async () => {
  const res = await page.request.post(URL_ + "api/entries", {
    data: { type: "expense", category: "", description: "chai", amount: 40, date: localToday() },
  });
  assert.equal(res.status(), 201);
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  await openReport("spending");
  await page.tap('#report-body .qf[data-period="all"]');
  await page.tap('#report-body .spend-row:has-text("Uncategorised")');
  await page.waitForSelector("#screen-entries:not([hidden])");
  const shown = await page.$$eval("#entries .entry-card", (els) => els.map((e) => e.innerText));
  assert.equal(shown.length, 1);
  assert.match(shown[0], /chai/);
  assert.equal(await page.inputValue("#f-category"), "Uncategorised");
  await page.tap("#f-clear-quick"); // visible even with More filters closed
  assert.ok(await page.isHidden("#f-clear-quick"));
  await screen("");
});

test("R28/R39: the Planned section shows automatic food lines (last 30 days → next 3 months)", { skip }, async () => {
  await screen("budget");
  const autos = await page.$$eval("#plan-list .auto-plan", (els) => els.map((e) => e.innerText.replace(/\s+/g, " ")));
  assert.equal(autos.length, 8, "food ×2, Ntorq petrol and repair, Transport, Bills & Utilities, Education, Entertainment");
  // Mandatory Food: ₹300 spent today (R17/R18) → ₹10/day, for every day of the 3-month forecast.
  const days = autoPlans([], localToday())[0].days;
  const expected = "−₹" + (10 * days).toLocaleString("en-IN", { minimumFractionDigits: 2 });
  assert.match(autos[0], /Mandatory Food.*next 3 months · ₹10\.00\/day/);
  assert.ok(autos[0].includes(expected) && autos[0].includes("Auto"), autos[0]);
  assert.match(autos[1], /Optional Food.*₹0\.00\/day.*−₹0\.00/);
  assert.equal(await page.locator("#plan-list .auto-plan .record-btn").count(), 0, "auto lines are not recorded");

  await page.tap('#plan-list .auto-plan:has-text("Mandatory Food") .plan-row');
  await page.waitForSelector("#screen-entries:not([hidden])");
  const shown = await page.$$eval("#entries .entry-card", (els) => els.map((e) => e.innerText));
  assert.ok(shown.length >= 1 && shown.every((t) => t.includes("Mandatory Food")));
  await page.tap("#f-clear-quick");
  await screen("");
});

test("R29: tapping Ntorq asks Petrol or Repair / Accessory; the type is saved and editable", { skip }, async () => {
  await screen("");
  await openAdd();
  await page.tap(".type-card[data-flow=expense]");
  await settle();
  await page.tap('#pick-grid .category-card:has-text("Ntorq")');
  await settle();
  assert.equal(await page.textContent("#pick-hint"), "Ntorq: what was it for?");
  const names = await page.$$eval("#pick-grid .category-name", (els) => els.map((e) => e.textContent));
  assert.deepEqual(names, ["Petrol", "Repair / Accessory"]);
  assert.equal(await page.locator("#steps .dot").count(), 4);
  await page.tap('#pick-grid .category-card:has-text("Repair / Accessory")');
  await settle();
  assert.equal(await page.textContent("#chosen-category"), "Ntorq · Repair / Accessory");
  await page.fill("#amount", "1200");
  await page.fill("#note", "helmet");
  await page.tap("#post-btn");
  await page.waitForSelector('.entry-card:has-text("Ntorq · Repair / Accessory")', { state: "attached" });
  const saved = (await (await page.request.get(URL_ + "api/entries")).json()).find((e) => e.description === "helmet");
  assert.deepEqual([saved.category, saved.subcategory], ["Ntorq", "Repair / Accessory"]);

  // Other cards go straight to the amount.
  await openAdd();
  await page.tap(".type-card[data-flow=expense]");
  await settle();
  await page.tap('#pick-grid .category-card:has-text("Transport")');
  await settle();
  assert.ok(await page.isVisible("#amount-form"));
  for (let i = 0; i < 2; i++) {
    await page.tap("#wizard-back");
    await settle();
  }

  // The editor shows and changes the type.
  await screen("entries");
  await page.tap('.entry-card:has-text("helmet")');
  await page.waitForSelector("dialog[open]");
  assert.equal(await page.$eval('#edit-sub-chips .chip[aria-checked="true"] .chip-name', (e) => e.textContent), "Repair / Accessory");
  await page.tap('#edit-sub-chips .chip:has-text("Petrol")');
  await page.tap("#edit-save");
  await page.waitForFunction(() => !document.querySelector("dialog").open);
  const edited = (await (await page.request.get(URL_ + "api/entries")).json()).find((e) => e.description === "helmet");
  assert.equal(edited.subcategory, "Petrol");
  await screen("");
});

test("R30: the spending report switches between Ntorq as one line and one line per type", { skip }, async () => {
  await openReport("spending");
  await page.tap('#report-body .qf[data-period="all"]');
  const lines = async () => page.$$eval("#report-body .spend-row .entry-desc", (els) => els.map((e) => e.textContent));
  const oneLine = await lines();
  assert.ok(oneLine.includes("Ntorq"));
  assert.ok(!oneLine.some((l) => l.startsWith("Ntorq ·")));

  await page.tap('#report-body .qf[data-split="true"]');
  const byType = await lines();
  assert.ok(!byType.includes("Ntorq"));
  assert.ok(byType.includes("Ntorq · Petrol"));
  // Older Ntorq entries saved before types existed.
  assert.ok(byType.includes("Ntorq · Unclassified"));
  const entries = await (await page.request.get(URL_ + "api/entries")).json();
  const ntorq = entries.filter((e) => e.type === "expense" && e.category === "Ntorq");
  const total = (rows) => rows.reduce((s, e) => s + e.amount, 0);
  const petrolText = await page.textContent('#report-body .spend-row:has-text("Ntorq · Petrol") .entry-amount');
  assert.equal(petrolText, "₹" + total(ntorq.filter((e) => e.subcategory === "Petrol")).toLocaleString("en-IN", { minimumFractionDigits: 2 }));

  await page.tap('#report-body .spend-row:has-text("Ntorq · Petrol")');
  await page.waitForSelector("#screen-entries:not([hidden])");
  const shown = await page.$$eval("#entries .entry-card", (els) => els.map((e) => e.innerText));
  assert.equal(shown.length, ntorq.filter((e) => e.subcategory === "Petrol").length);
  assert.ok(shown.every((t) => t.includes("Ntorq · Petrol")));
  assert.match(await page.textContent("#filter-summary"), /^Ntorq · Petrol: /);
  await page.tap("#f-clear-quick");
  await screen("");
});

test("R31/R39: automatic Ntorq lines: petrol per week, repair per month, both for the next 3 months", { skip }, async () => {
  const today = localToday();
  const shift = (days) => {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  // A repair within the last 3 months, so both lines have something to average.
  const res = await page.request.post(URL_ + "api/entries", {
    data: { type: "expense", category: "Ntorq", subcategory: "Repair / Accessory", description: "brake pads", amount: 2400, date: shift(-20) },
  });
  assert.equal(res.status(), 201);
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  await screen("budget");

  const entries = await (await page.request.get(URL_ + "api/entries")).json();
  const sum = (sub, since) =>
    entries.filter((e) => e.category === "Ntorq" && e.subcategory === sub && e.date >= since && e.date <= today).reduce((s, e) => s + e.amount, 0);
  const inr = (n) => "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const petrol = sum("Petrol", shift(-27));
  const [y, m, d] = today.split("-").map(Number);
  const threeMonthsAgo = new Date(Date.UTC(y, m - 1 - 3, 1));
  const lastDay = new Date(Date.UTC(threeMonthsAgo.getUTCFullYear(), threeMonthsAgo.getUTCMonth() + 1, 0)).getUTCDate();
  threeMonthsAgo.setUTCDate(Math.min(d, lastDay) + 1);
  const repair = sum("Repair / Accessory", threeMonthsAgo.toISOString().slice(0, 10));

  const row = async (label) => (await page.textContent(`#plan-list .auto-plan:has-text("${label}")`)).replace(/\s+/g, " ");
  const lines = autoPlans(entries, today);
  const petrolLine = lines.find((l) => l.subcategory === "Petrol");
  const repairLine = lines.find((l) => l.subcategory === "Repair / Accessory");
  assert.equal(petrolLine.spent, Math.round(petrol * 100) / 100);
  assert.equal(repairLine.spent, Math.round(repair * 100) / 100);
  const petrolRow = await row("Ntorq · Petrol");
  assert.ok(petrolRow.includes(`next 3 months · ${inr(petrol / 4)}/week (last 4 weeks' average)`), petrolRow);
  assert.ok(petrolRow.includes("−" + inr(petrolLine.amount)), petrolRow);
  assert.match(petrolRow, /⛽/);
  const repairRow = await row("Ntorq · Repair / Accessory");
  assert.ok(repairRow.includes(`next 3 months · ${inr(repairLine.amount / 3)}/month (last 3 months' average)`), repairRow);
  assert.ok(repairRow.includes("−" + inr(repairLine.amount)), repairRow);
  assert.match(repairRow, /🔧/);

  // Tapping a line shows the entries it averages.
  await page.tap('#plan-list .auto-plan:has-text("Ntorq · Repair / Accessory") .plan-row');
  await page.waitForSelector("#screen-entries:not([hidden])");
  const shown = await page.$$eval("#entries .entry-card", (els) => els.map((e) => e.innerText));
  assert.ok(shown.some((t) => t.includes("brake pads")));
  assert.ok(shown.every((t) => t.includes("Ntorq · Repair / Accessory")));
  await page.tap("#f-clear-quick");
  await screen("");
});

test("R32/R33: Dress replaces Shopping; automatic Transport (3 weeks) and Bills & Utilities (1 month) lines", { skip }, async () => {
  await screen("");
  await openAdd();
  await page.tap(".type-card[data-flow=expense]");
  await settle();
  const names = await page.$$eval("#pick-grid .category-name", (els) => els.map((e) => e.textContent));
  assert.ok(names.includes("Dress") && !names.includes("Shopping"));
  assert.ok(!names.includes("Travel"), "R34: no Travel card");
  await page.tap("#wizard-back");
  await settle();

  await screen("budget");
  const row = async (label) => (await page.textContent(`#plan-list .auto-plan:has-text("${label}")`)).replace(/\s+/g, " ");
  const transport = await row("Transport");
  assert.match(transport, /next 3 months · ₹[\d,.]+\/week \(last 3 months' average\)/);
  for (const label of ["Bills & Utilities", "Education", "Entertainment"]) {
    assert.match(await row(label), /next 3 months · ₹[\d,.]+\/month \(last 3 months' average\)/, label);
  }
  await screen("");
});

test("R33/R34: old Shopping and Travel entries keep their name and icon and open in the editor", { skip }, async () => {
  for (const [category, icon] of [["Shopping", "🛍️"], ["Travel", "✈️"]]) {
    const res = await page.request.post(URL_ + "api/entries", {
      data: { type: "expense", category, description: "old " + category, amount: 111, date: localToday() },
    });
    assert.equal(res.status(), 201);
    await page.reload();
    await page.waitForSelector("#app:not([hidden])");
    await screen("entries");
    const card = page.locator(`.entry-card:has-text("old ${category}")`);
    assert.match(await card.innerText(), new RegExp(icon));
    await card.tap();
    await page.waitForSelector("dialog[open]");
    assert.equal(await page.$eval('#edit-categories .category-card[aria-checked="true"] .category-name', (e) => e.textContent), category);
    await page.tap("#edit-close");
  }
  await screen("");
});

test("R36: the home page shows available to spend = balance × (left ÷ income), never above the balance", { skip }, async () => {
  await screen("");
  const num = (t) => Number(t.replace(/[^\d.-]/g, "").replace(/^-?/, (m) => m));
  const amount = await page.textContent("#available-amount");
  assert.match(amount, /^-?₹[\d,]+\.\d\d$/);
  const meta = await page.textContent("#available-meta");
  assert.match(meta, /^until \d{1,2} \w+ · \+₹[\d,.]+ in · −₹[\d,.]+ out/);
  // Smaller than the current balance, but on the same card.
  const sizes = await page.evaluate(() => [
    parseFloat(getComputedStyle(document.getElementById("balance")).fontSize),
    parseFloat(getComputedStyle(document.getElementById("available-amount")).fontSize),
  ]);
  assert.ok(sizes[1] < sizes[0]);

  await page.tap("#available");
  await page.waitForSelector("#screen-budget:not([hidden])");
  // The calculation reads like a receipt: label on the left, amount on the right.
  const calc = await page.$$eval("#available-summary .calc-row", (rows) =>
    Object.fromEntries(rows.map((r) => [r.querySelector(".calc-label").textContent, r.querySelector(".calc-value").textContent]))
  );
  const money = (t) => (t.startsWith("−") ? -1 : 1) * num(t.replace(/^[+−]/, ""));
  const income = money(calc["Income expected"]);
  const expected = -money(calc["Payments expected"]);
  const left = money(calc["Left at period end"]);
  const balance = money(calc["Balance now"]);
  assert.equal(money(calc["Available to spend"]), num(amount));
  assert.equal(await page.locator("#available-summary .calc-total").count(), 2);
  const closingNote = await page.textContent('#available-summary .calc-note:has-text("if all goes to plan")');
  const closingText = closingNote.split(": ")[1].replace(/\.$/, "");
  const surplus = (closingText.startsWith("−") ? -1 : 1) * num(closingText);
  assert.match(await page.textContent("#available-sub"), /^Next 3 months · until \d{1,2} \w+/);
  assert.equal(Math.round((income - expected) * 100), Math.round(left * 100));
  assert.equal(Math.round((balance + income - expected) * 100), Math.round(surplus * 100));
  // The surplus is the forecast's closing balance.
  const lastRow = await page.$$eval("#forecast-table tbody tr", (trs) => trs[trs.length - 1].lastElementChild.textContent);
  assert.equal(Math.round(num(lastRow)), Math.round(surplus));
  // Available = balance × (left ÷ income), at most the balance.
  const available = num(amount);
  const share =
    balance <= 0 || income <= 0 ? Math.min(balance, surplus) : expected >= income ? Math.min(0, surplus) : (balance * (income - expected)) / income;
  assert.equal(Math.round(available * 100), Math.round(share * 100));
  assert.ok(available <= balance);
  assert.equal(num(await page.textContent("#balance")), balance);
  const rows = await page.$$eval("#available-list .report-row .entry-amount.expense", (els) => els.map((e) => e.textContent));
  assert.equal(Math.round(rows.reduce((s, t) => s + num(t.replace("−", "")), 0) * 100), Math.round(expected * 100));
  await screen("");
});

test("R38: plan dates are limited to the 3-month forecast, but a later plan can still be edited", { skip }, async () => {
  const late = new Date(Date.now() + 200 * 86400000).toISOString().slice(0, 10);
  // Made later than the window, as after an early Record of a monthly plan.
  const created = await page.request.post(URL_ + "api/plans", {
    data: { type: "expense", category: "Health", amount: 900, nextDate: localToday(), repeat: "monthly" },
  });
  const plan = await created.json();
  const moved = await page.request.put(URL_ + "api/plans?id=" + plan.id, { data: { ...plan, nextDate: late } });
  assert.equal(moved.status(), 200);
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  await screen("budget");
  await page.tap('#plan-list .plan-item:has-text("after the 3-month forecast") .plan-row');
  await page.waitForSelector("#plan-dialog[open]");
  assert.equal(await page.getAttribute("#plan-date", "max"), "", "no date limit when editing a later plan");
  await page.fill("#plan-amount", "950");
  await page.tap("#plan-save");
  await page.waitForFunction(() => !document.getElementById("plan-dialog").open);
  const saved = (await (await page.request.get(URL_ + "api/plans")).json()).find((p) => p.id === plan.id);
  assert.equal(saved.amount, 950);

  // A new plan's date picker stops at the end of the forecast.
  await page.tap("#plan-add");
  await page.waitForSelector("#plan-dialog[open]");
  assert.match(await page.getAttribute("#plan-date", "max"), /^\d{4}-\d{2}-\d{2}$/);
  await page.tap("#plan-close");
  await page.request.delete(URL_ + "api/plans?id=" + plan.id);
  await screen("");
});

test("R41: Add Entry is a popup from the + button; a tap outside closes it, or posts a ready entry", { skip }, async () => {
  await screen("");
  const count = async () => (await (await page.request.get(URL_ + "api/entries")).json()).length;
  const outside = () => page.touchscreen.tap(200, 20); // the page above the bottom sheet
  const before = await count();

  // The + button is a small round button on the side, on every screen.
  const fab = await page.$eval("#add-fab", (b) => {
    const r = b.getBoundingClientRect();
    return { w: r.width, right: window.innerWidth - r.right, position: getComputedStyle(b).position };
  });
  assert.ok(fab.w <= 64 && fab.right <= 24 && fab.position === "fixed", JSON.stringify(fab));
  await screen("entries");
  assert.ok(await page.isVisible("#add-fab"));
  await screen("");

  // Nothing typed: a tap outside just closes it.
  await openAdd();
  await outside();
  await page.waitForFunction(() => !document.getElementById("add-dialog").open);
  await openAdd();
  await page.tap(".type-card[data-flow=expense]");
  await settle();
  await page.tap('#pick-grid .category-card:has-text("Health")');
  await settle();
  await outside(); // category chosen but no amount: closes without posting
  await page.waitForFunction(() => !document.getElementById("add-dialog").open);
  assert.equal(await count(), before);

  // An amount typed: a tap outside posts it, then closes.
  await openAdd();
  assert.ok(await page.isVisible('.step[data-step="type"]'), "a fresh entry each time");
  await page.tap(".type-card[data-flow=expense]");
  await settle();
  await page.tap('#pick-grid .category-card:has-text("Health")');
  await settle();
  await page.fill("#amount", "123");
  await page.fill("#note", "Tapped outside");
  await outside();
  await page.waitForFunction(() => !document.getElementById("add-dialog").open);
  await page.waitForFunction(() => /Health paid from/.test(document.getElementById("posted").textContent));
  const saved = (await (await page.request.get(URL_ + "api/entries")).json()).find((e) => e.description === "Tapped outside");
  assert.deepEqual([saved.type, saved.category, saved.amount], ["expense", "Health", 123]);
  assert.equal(await count(), before + 1);

  // ✕ closes without posting.
  await openAdd();
  await page.tap(".type-card[data-flow=expense]");
  await settle();
  await page.tap('#pick-grid .category-card:has-text("Health")');
  await settle();
  await page.fill("#amount", "50");
  await page.tap("#add-close");
  assert.equal(await addOpen(), false);
  assert.equal(await count(), before + 1);

  // Post, then a quick tap outside while it is saving: saved once.
  await page.route("**/api/entries", async (route) => {
    if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 600));
    await route.continue();
  });
  await openAdd();
  await page.tap(".type-card[data-flow=expense]");
  await settle();
  await page.tap('#pick-grid .category-card:has-text("Health")');
  await settle();
  await page.fill("#amount", "7");
  await page.tap("#post-btn");
  await outside();
  await page.waitForFunction(() => !document.getElementById("add-dialog").open);
  await page.unroute("**/api/entries");
  assert.equal(await count(), before + 2, "Post + tap outside saves it once");

  // A drag from a field inside that ends outside is not a tap outside.
  await openAdd();
  await page.tap(".type-card[data-flow=expense]");
  await settle();
  await page.tap('#pick-grid .category-card:has-text("Health")');
  await settle();
  await page.fill("#amount", "8");
  const box = await page.locator("#note").boundingBox();
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.down();
  await page.mouse.move(200, 20);
  await page.mouse.up();
  assert.ok(await addOpen(), "still open after a drag");
  assert.equal(await count(), before + 2);

  // A cancelled "only has …" confirm after a tap outside: nothing posted, the popup says why.
  await page.tap("#add-close");
  await closeAdd();
  await page.tap('.account-card[aria-label^="Cash"]');
  await settle();
  await page.tap('#pick-grid .category-card:has-text("GPay")');
  await settle();
  await page.fill("#amount", "999999");
  await page.evaluate(() => {
    window.realConfirm = window.confirm;
    window.confirm = () => false; // the owner taps Cancel
  });
  await outside();
  await page.waitForFunction(() => !document.getElementById("add-status").hidden);
  assert.match(await page.textContent("#add-status"), /Not posted/);
  assert.ok(await addOpen());
  assert.equal(await count(), before + 2);
  await page.evaluate(() => (window.confirm = window.realConfirm));
  await closeAdd();

  // The page's own message stays when the popup shows one, and after a successful post.
  await page.evaluate(() => {
    const st = document.getElementById("status");
    st.textContent = "Recorded Salary";
    st.hidden = false;
  });
  await openAdd();
  await page.tap(".type-card[data-flow=expense]");
  await settle();
  await page.tap('#pick-grid .category-card:has-text("Health")');
  await settle();
  await page.fill("#amount", "9");
  await page.route("**/api/entries", (route) =>
    route.request().method() === "POST" ? route.fulfill({ status: 500, contentType: "application/json", body: '{"error":"boom"}' }) : route.continue()
  );
  await page.tap("#post-btn");
  await page.waitForFunction(() => document.getElementById("add-status").textContent.includes("boom"));
  assert.equal(await page.textContent("#status"), "Recorded Salary", "a popup message leaves the page's");
  await page.unroute("**/api/entries");
  await page.tap("#post-btn");
  await page.waitForFunction(() => !document.getElementById("add-dialog").open);
  assert.equal(await page.textContent("#status"), "Recorded Salary", "a post leaves the page's message");
  await page.evaluate(() => (document.getElementById("status").hidden = true));

  // A popup left open overnight moves to the new day when the owner comes back (the amount stays).
  await openAdd();
  await page.tap(".type-card[data-flow=expense]");
  await settle();
  await page.tap('#pick-grid .category-card:has-text("Health")');
  await settle();
  await page.fill("#amount", "11");
  const opened = await page.inputValue("#date");
  const next = await page.evaluate(() => {
    const RealDate = Date;
    window.RealDate = RealDate;
    window.Date = class extends RealDate {
      constructor(...args) {
        super(...(args.length ? args : [RealDate.now() + 86400000])); // tomorrow
      }
    };
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  });
  assert.notEqual(next, opened);
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  assert.equal(await page.inputValue("#date"), next, "the date follows the new day");
  assert.equal(await page.inputValue("#amount"), "11", "the typed entry is kept");
  await page.evaluate(() => (window.Date = window.RealDate));
  await page.tap("#add-close");

  // Coming back while typing in a field on the page does not cover it.
  await screen("entries");
  await page.evaluate(() => (document.getElementById("more-filters").open = true));
  await page.focus("#f-search");
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  assert.equal(await addOpen(), false, "no popup over a field being typed in");
  await page.evaluate(() => document.activeElement.blur());
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  assert.ok(await addOpen());
  await screen("");

  // Coming back to the app opens it again.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  assert.ok(await addOpen(), "opens when the app is opened again");
  await closeAdd();

  // Reopened from the home-screen shortcut after closing the browser: a fresh load opens it …
  await page.reload();
  await page.waitForSelector("#app:not([hidden])");
  assert.ok(await addOpen(), "opens on a fresh load");
  // … and so does a page restored from the browser's cache, with a fresh entry.
  await page.tap(".type-card[data-flow=expense]");
  await settle();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  assert.ok(await addOpen());
  assert.ok(await page.isVisible('.step[data-step="type"]'), "starts a fresh entry");
  await closeAdd();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  assert.ok(await addOpen(), "opens when restored from the cache");
  await closeAdd();
});
