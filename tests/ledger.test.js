// Tests for the FIFO reserve logic. Requirement IDs refer to REQUIREMENTS.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GENERAL, allocate, reserveBalances, reserveMonths, reserveReport, reserveAccountGrid, accountBalances, transferAllPlan,
  addMonths, periodRange, filterEntries, totalsOf, spendingByCategory, reserveReceipts, receiptReport,
  budgetStatus, planOccurrences, cashflowForecast, UNCATEGORISED, autoFoodPlans, chronological,
  autoNtorqPlans, autoPlans } from "../public/ledger.js";

let nextId = 1;
const income = (date, category, amount, reserve = category) => ({ id: nextId++, type: "income", category, description: "", reserve, toReserve: "", amount, date });
const expense = (date, category, amount, reserve = GENERAL) => ({ id: nextId++, type: "expense", category, description: "", reserve, toReserve: "", amount, date });
const transfer = (date, from, to, amount) => ({ id: nextId++, type: "transfer", category: "", description: "", reserve: from, toReserve: to, amount, date });

test("R13: August salary is only touched after July salary is used up", () => {
  const entries = [
    income("2026-07-01", "Salary", 50000),
    expense("2026-07-10", "Rent", 20000, "Salary"),
    income("2026-08-01", "Salary", 60000),
    expense("2026-08-03", "Shopping", 45000, "Salary"), // 30,000 from July + 15,000 from August
    expense("2026-08-20", "Groceries", 5000, "Salary"),
  ];
  const july = reserveReport(entries, "Salary", "2026-07");
  assert.equal(july.remaining, 0);
  assert.equal(july.exhaustedOn, "2026-08-03");
  assert.deepEqual(july.items.map((i) => [i.entry.category, i.amount]), [["Rent", 20000], ["Shopping", 30000]]);

  const aug = reserveReport(entries, "Salary", "2026-08");
  assert.equal(aug.received, 60000);
  assert.equal(aug.used, 20000);
  assert.equal(aug.remaining, 40000);
  assert.equal(aug.hadEarlierMoney, true);
  assert.equal(aug.firstUsedOn, "2026-08-03");
  const shopping = aug.items[0];
  assert.equal(shopping.entry.category, "Shopping");
  assert.equal(shopping.amount, 15000);
  assert.deepEqual(shopping.otherSources, [{ reserve: "Salary", month: "2026-07", amount: 30000 }]);
  assert.equal(aug.items[1].amount, 5000);
});

test("R14: report lists every expense and transfer allotted from a month's money", () => {
  const entries = [
    income("2026-08-01", "Salary", 60000),
    expense("2026-08-05", "Rent", 15000, "Salary"),
    transfer("2026-08-06", "Salary", GENERAL, 20000),
    expense("2026-08-07", "Transport", 1000), // General Reserve: not part of the salary report
  ];
  const r = reserveReport(entries, "Salary", "2026-08");
  assert.deepEqual(r.items.map((i) => [i.entry.type, i.amount]), [["expense", 15000], ["transfer", 20000]]);
  assert.equal(r.remaining, 25000);
});

test("R13: an expense made before the salary arrives is covered by that salary", () => {
  const entries = [expense("2026-08-01", "Rent", 10000, "Salary"), income("2026-08-31", "Salary", 60000)];
  const r = reserveReport(entries, "Salary", "2026-08");
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].amount, 10000);
  assert.equal(r.items[0].before, true);
  assert.equal(r.remaining, 50000);
});

test("R14: money is never reported as used before it arrived", () => {
  const entries = [
    income("2026-07-01", "Salary", 50000),
    expense("2026-07-20", "Rent", 65000, "Salary"), // 50,000 from July, 15,000 covered by August
    income("2026-08-01", "Salary", 60000),
  ];
  const aug = reserveReport(entries, "Salary", "2026-08");
  assert.equal(aug.firstUsedOn, "2026-08-01");
  assert.equal(aug.items[0].amount, 15000);
  assert.equal(aug.items[0].before, true);
  assert.deepEqual(aug.items[0].otherSources, [{ reserve: "Salary", month: "2026-07", amount: 50000 }]);
});

test("R13: shortfall not yet covered is reported", () => {
  const entries = [income("2026-08-01", "Salary", 1000), expense("2026-08-02", "Rent", 3000, "Salary")];
  const r = reserveReport(entries, "Salary", "2026-08");
  assert.equal(r.items[0].amount, 1000);
  assert.equal(r.items[0].uncovered, 2000);
});

test("R12: reserves always add up to the balance; transfers do not change it", () => {
  const entries = [
    income("2026-08-01", "Salary", 60000),
    income("2026-08-02", "Gift", 5000, GENERAL), // R9: income allotted to another reserve
    expense("2026-08-03", "Rent", 15000),
    expense("2026-08-04", "Food & Dining", 2000, "Salary"),
    transfer("2026-08-05", "Salary", GENERAL, 30000),
  ];
  const balances = reserveBalances(entries, "2026-08-15");
  const total = balances.reduce((s, r) => s + r.balance, 0);
  assert.equal(total, 60000 + 5000 - 15000 - 2000);
  const byName = Object.fromEntries(balances.map((r) => [r.name, r.balance]));
  assert.equal(byName.Salary, 28000);
  assert.equal(byName[GENERAL], 20000);
  assert.equal(byName.Gift, undefined, "Gift was allotted to General Reserve, so no Gift reserve");
});

test("R8: General Reserve always exists", () => {
  assert.deepEqual(reserveBalances([], "2026-08-01").map((r) => r.name), [GENERAL]);
});

test("R14: months list shows received and remaining per month, newest first", () => {
  const entries = [
    income("2026-07-01", "Salary", 50000),
    income("2026-08-01", "Salary", 60000),
    expense("2026-08-03", "Shopping", 55000, "Salary"),
  ];
  assert.deepEqual(reserveMonths(entries, "Salary"), [
    { month: "2026-08", received: 60000, remaining: 55000 },
    { month: "2026-07", received: 50000, remaining: 0 },
  ]);
});

test("R13: money transferred in becomes a lot in the destination reserve", () => {
  const entries = [
    income("2026-08-01", "Salary", 10000),
    transfer("2026-08-02", "Salary", GENERAL, 10000),
    expense("2026-08-03", "Rent", 4000),
  ];
  const { lots } = allocate(entries);
  const general = lots.find((l) => l.reserve === GENERAL);
  assert.equal(general.label, "Transfer from Salary");
  assert.equal(general.remaining, 6000);
  const r = reserveReport(entries, GENERAL, "2026-08");
  assert.equal(r.items[0].entry.category, "Rent");
});

test("allocation handles paise without rounding drift", () => {
  const entries = [income("2026-08-01", "Salary", 100.1)];
  for (let i = 0; i < 7; i++) entries.push(expense("2026-08-02", "Food & Dining", 14.3, "Salary"));
  const r = reserveReport(entries, "Salary", "2026-08");
  assert.equal(r.remaining, 0);
  assert.equal(r.used, 100.1);
});

// ---------- Accounts (R17–R20) ----------

const withAccount = (entry, account) => ({ ...entry, account });
const contra = (date, from, to, amount, reserve = GENERAL) => ({ id: nextId++, type: "contra", category: "", description: "", reserve, toReserve: "", account: from, toAccount: to, amount, date });

test("R18: entries without an account count as Super Money", () => {
  const balances = accountBalances([income("2026-08-01", "Salary", 1000)]);
  assert.deepEqual(balances, [
    { name: "Super Money", balance: 1000 },
    { name: "GPay", balance: 0 },
    { name: "Cash", balance: 0 },
  ]);
});

test("R19: contra moves a reserve's money between accounts without changing any reserve or the balance", () => {
  const entries = [
    income("2026-08-01", "Salary", 60000),
    contra("2026-08-02", "Super Money", "Cash", 5000, "Salary"),
    withAccount(expense("2026-08-03", "Groceries", 1200, "Salary"), "Cash"),
  ];
  const grid = reserveAccountGrid(entries);
  assert.equal(grid.cell("Salary", "Super Money"), 55000);
  assert.equal(grid.cell("Salary", "Cash"), 3800);
  assert.equal(grid.rowTotals.Salary, 58800);
  assert.equal(grid.columnTotals.Cash, 3800);
  assert.equal(grid.total, 58800);
  const reserves = Object.fromEntries(reserveBalances(entries, "2026-08-15").map((r) => [r.name, r.balance]));
  assert.equal(reserves.Salary, 58800, "contra does not change the reserve");
  // FIFO report is about reserves, so the contra is not an expense of August salary.
  const r = reserveReport(entries, "Salary", "2026-08");
  assert.deepEqual(r.items.map((i) => i.entry.category), ["Groceries"]);
});

test("R20: grid rows add up to reserve balances, columns to account balances, total to the balance", () => {
  const entries = [
    income("2026-08-01", "Salary", 60000),
    withAccount(income("2026-08-02", "Freelance", 8000), "GPay"),
    withAccount(expense("2026-08-03", "Rent", 15000), "Super Money"),
    transfer("2026-08-04", "Salary", GENERAL, 20000),
    contra("2026-08-05", "Super Money", "Cash", 2000),
    withAccount(expense("2026-08-06", "Food & Dining", 500), "Cash"),
  ];
  const grid = reserveAccountGrid(entries);
  const reserves = Object.fromEntries(reserveBalances(entries, "2026-08-15").map((r) => [r.name, r.balance]));
  for (const r of grid.reserves) assert.equal(grid.rowTotals[r], reserves[r], r);
  assert.deepEqual(accountBalances(entries), [
    { name: "Super Money", balance: 60000 - 15000 - 2000 },
    { name: "GPay", balance: 8000 },
    { name: "Cash", balance: 1500 },
  ]);
  assert.equal(grid.total, 60000 + 8000 - 15000 - 500);
  assert.equal(grid.cell(GENERAL, "Super Money"), -15000 + 20000 - 2000);
  assert.equal(grid.cell(GENERAL, "Cash"), 1500);
});

test("R11: Transfer all moves exactly the reserve's balance, across accounts", () => {
  const split = [
    income("2026-08-01", "Salary", 2000),
    withAccount(income("2026-08-02", "Salary", 1000), "Cash"),
  ];
  assert.deepEqual(transferAllPlan(split, "Salary"), [
    { account: "Super Money", amount: 2000 },
    { account: "Cash", amount: 1000 },
  ]);

  // Overdrawn in one account: +3000 in Super Money, -500 in Cash => balance 2500.
  const overdrawn = [
    income("2026-08-01", "Business", 3000),
    withAccount(expense("2026-08-02", "Shopping", 500, "Business"), "Cash"),
  ];
  const plan = transferAllPlan(overdrawn, "Business");
  assert.deepEqual(plan, [{ account: "Super Money", amount: 2500 }]);
  const after = [...overdrawn, ...plan.map((p) => ({ ...transfer("2026-08-03", "Business", GENERAL, p.amount), account: p.account }))];
  const balances = Object.fromEntries(reserveBalances(after, "2026-08-15").map((r) => [r.name, r.balance]));
  assert.equal(balances.Business, 0, "reserve ends at exactly zero");

  // Negative overall: nothing to move.
  const negative = [
    income("2026-08-01", "Business", 100),
    withAccount(expense("2026-08-02", "Shopping", 500, "Business"), "Cash"),
  ];
  assert.deepEqual(transferAllPlan(negative, "Business"), []);
});

// ---------- Entries screen, reports, budgets (R22–R26) ----------

test("addMonths keeps the day where possible", () => {
  assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(addMonths("2026-11-15", 3), "2027-02-15");
  assert.equal(addMonths("2026-03-10", -3), "2025-12-10");
});

test("R22: quick periods and filters narrow the entries list", () => {
  const today = "2026-09-26";
  assert.deepEqual(periodRange("this-month", today), { from: "2026-09-01", to: "2026-10-01" });
  assert.deepEqual(periodRange("last-month", today), { from: "2026-08-01", to: "2026-09-01" });
  const entries = [
    income("2026-09-01", "Salary", 60000),
    withAccount(expense("2026-09-20", "Groceries", 1200), "Cash"),
    expense("2026-09-22", "Ntorq", 900, "Salary"),
    { ...expense("2026-08-30", "Groceries", 800), description: "Big basket" },
    transfer("2026-09-05", "Salary", GENERAL, 10000),
  ];
  const ids = (f) => filterEntries(entries, f, today).map((e) => e.category || e.type);
  assert.deepEqual(ids({ period: "this-month" }), ["Salary", "Groceries", "Ntorq", "transfer"]);
  assert.deepEqual(ids({ period: "last-month" }), ["Groceries"]);
  assert.deepEqual(ids({ period: "last-7" }), ["Groceries", "Ntorq"]);
  assert.deepEqual(ids({ type: "expense" }), ["Groceries", "Ntorq", "Groceries"]);
  assert.deepEqual(ids({ category: "Groceries" }), ["Groceries", "Groceries"]);
  assert.deepEqual(ids({ reserve: "Salary" }), ["Salary", "Ntorq", "transfer"]);
  assert.deepEqual(ids({ account: "Cash" }), ["Groceries"]);
  assert.deepEqual(ids({ search: "basket" }), ["Groceries"]);
  assert.deepEqual(ids({ from: "2026-09-20", to: "2026-09-21" }), ["Groceries"]);
  assert.deepEqual(totalsOf(filterEntries(entries, { period: "this-month" }, today)), { income: 60000, expense: 2100, net: 57900 });
});

test("R23: spending report groups expenses by category, largest first", () => {
  const entries = [
    expense("2026-09-02", "Groceries", 1200),
    expense("2026-09-10", "Groceries", 800),
    expense("2026-09-11", "Ntorq", 3000),
    expense("2026-08-11", "Ntorq", 999), // other month
    income("2026-09-01", "Salary", 60000),
  ];
  const r = spendingByCategory(entries, { period: "this-month" }, "2026-09-26");
  assert.equal(r.total, 5000);
  assert.deepEqual(r.rows.map((x) => [x.category, x.amount, x.count, x.share]), [
    ["Ntorq", 3000, 1, 0.6],
    ["Groceries", 2000, 2, 0.4],
  ]);
});

test("R24: reserve utilisation lists every receipt with used and left; a receipt shows where it went", () => {
  const entries = [
    income("2026-07-01", "Salary", 50000),
    expense("2026-07-10", "Rent", 20000, "Salary"),
    income("2026-08-01", "Salary", 60000),
    expense("2026-08-03", "Shopping", 45000, "Salary"),
  ];
  const receipts = reserveReceipts(entries, "Salary");
  assert.deepEqual(receipts.map((r) => [r.date, r.amount, r.used, r.remaining]), [
    ["2026-08-01", 60000, 15000, 45000],
    ["2026-07-01", 50000, 50000, 0],
  ]);
  const aug = receiptReport(entries, "Salary", receipts[0].id);
  assert.equal(aug.used, 15000);
  assert.equal(aug.hadEarlierMoney, true);
  assert.deepEqual(aug.items.map((i) => [i.entry.category, i.amount]), [["Shopping", 15000]]);
  const jul = receiptReport(entries, "Salary", receipts[1].id);
  assert.deepEqual(jul.items.map((i) => [i.entry.category, i.amount]), [["Rent", 20000], ["Shopping", 30000]]);
  assert.equal(receiptReport(entries, "Salary", 999999), null);
});

test("R25: budget status compares this month's spending with each category's budget", () => {
  const entries = [expense("2026-09-02", "Groceries", 4500), expense("2026-09-03", "Ntorq", 500), expense("2026-08-03", "Ntorq", 9000)];
  const s = budgetStatus(entries, [{ category: "Groceries", amount: 5000 }, { category: "Ntorq", amount: 2000 }], "2026-09-26");
  assert.deepEqual(s.rows.map((r) => [r.category, r.spent, r.left]), [["Groceries", 4500, 500], ["Ntorq", 500, 1500]]);
  assert.deepEqual([s.budget, s.spent, s.left], [7000, 5000, 2000]);
});

test("R26: planned cashflows repeat monthly; overdue ones count as due today", () => {
  assert.deepEqual(planOccurrences({ nextDate: "2026-10-01", repeat: "monthly" }, "2026-09-26", "2027-01-01"), ["2026-10-01", "2026-11-01", "2026-12-01"]);
  assert.deepEqual(planOccurrences({ nextDate: "2026-09-01", repeat: "none" }, "2026-09-26", "2027-01-01"), ["2026-09-26"]);
  assert.deepEqual(planOccurrences({ nextDate: "2027-05-01", repeat: "none" }, "2026-09-26", "2027-01-01"), []);
});

test("R26: forecast couples budgets with planned cashflows month by month", () => {
  const entries = [income("2026-09-01", "Salary", 60000), expense("2026-09-05", "Groceries", 3000)]; // balance 57,000
  const budgets = [{ category: "Groceries", amount: 5000 }, { category: "Ntorq", amount: 1000 }];
  const plans = [
    { type: "income", category: "Salary", amount: 60000, nextDate: "2026-10-01", repeat: "monthly" },
    { type: "expense", category: "Ntorq", amount: 15000, nextDate: "2026-11-10", repeat: "none" }, // service, above budget
    { type: "expense", category: "Groceries", amount: 1000, nextDate: "2026-09-28", repeat: "none" }, // within budget left
  ];
  const f = cashflowForecast(entries, budgets, plans, "2026-09-26", 3);
  assert.equal(f.start, 57000);
  // Sep: Groceries budget left 2,000 (covers the 1,000 planned) + Ntorq 1,000 budget.
  assert.deepEqual([f.rows[0].month, f.rows[0].income, f.rows[0].expense, f.rows[0].balance], ["2026-09", 0, 3000, 54000]);
  // Oct: salary in; budgets 5,000 + 1,000.
  assert.deepEqual([f.rows[1].income, f.rows[1].expense, f.rows[1].balance], [60000, 6000, 108000]);
  // Nov: planned Ntorq 15,000 replaces its 1,000 budget.
  assert.deepEqual([f.rows[2].income, f.rows[2].expense, f.rows[2].balance], [60000, 20000, 148000]);
  assert.equal(f.rows[2].items.length, 2);
});

test("R23: old expenses without a category are grouped as Uncategorised and can be filtered", () => {
  const entries = [
    { ...expense("2026-09-02", "", 40), description: "chai" },
    { ...expense("2026-09-03", "", 60), description: "snacks" },
    expense("2026-09-04", "Groceries", 500),
  ];
  const r = spendingByCategory(entries, { period: "all" }, "2026-09-26");
  assert.deepEqual(r.rows.map((x) => [x.category, x.amount, x.count]), [["Groceries", 500, 1], [UNCATEGORISED, 100, 2]]);
  const shown = filterEntries(entries, { type: "expense", category: UNCATEGORISED }, "2026-09-26");
  assert.deepEqual(shown.map((e) => e.description), ["chai", "snacks"]);
});

test("R26: a monthly plan keeps its day of the month (31st stays the 31st after February)", () => {
  assert.equal(addMonths("2027-02-28", 1, 31), "2027-03-31");
  const plan = { nextDate: "2027-01-31", repeat: "monthly", day: 31 };
  assert.deepEqual(planOccurrences(plan, "2027-01-01", "2027-05-01"), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  // Recording moves it on from wherever it is now, aiming at its day.
  assert.equal(addMonths(addMonths("2027-01-31", 1, 31), 1, 31), "2027-03-31");
});

test("R28: automatic food plans use each food type's last-30-day average per day for the next 14 days", () => {
  const entries = [
    expense("2026-09-26", "Mandatory Food", 300), // today
    expense("2026-08-28", "Mandatory Food", 600), // 30th day back: included
    expense("2026-08-27", "Mandatory Food", 999), // 31 days back: not included
    expense("2026-09-10", "Optional Food", 450),
    expense("2026-09-10", "Groceries", 5000), // not a food type any more
  ];
  const [mandatory, optional] = autoFoodPlans(entries, "2026-09-26");
  assert.deepEqual(
    [mandatory.category, mandatory.perDay, mandatory.amount, mandatory.from, mandatory.to],
    ["Mandatory Food", 30, 420, "2026-09-27", "2026-10-10"]
  );
  assert.deepEqual([optional.category, optional.perDay, optional.amount], ["Optional Food", 15, 210]);
});

test("R28: the forecast counts automatic food plans day by day, split across months", () => {
  const entries = [income("2026-09-01", "Salary", 10000), expense("2026-09-20", "Mandatory Food", 3000)]; // 100/day
  const auto = autoFoodPlans(entries, "2026-09-26");
  const f = cashflowForecast(entries, [], [], "2026-09-26", 2, auto);
  // 27–30 Sep = 4 days in September, 1–10 Oct = 10 days in October.
  assert.deepEqual([f.rows[0].expense, f.rows[1].expense], [400, 1000]);
  // With a budget, the larger of budget and planned counts.
  const withBudget = cashflowForecast(entries, [{ category: "Mandatory Food", amount: 5000 }], [], "2026-09-26", 2, auto);
  assert.deepEqual([withBudget.rows[0].expense, withBudget.rows[1].expense], [2000, 5000]);
});

test("R29/R30: spending by category can show one line per Ntorq type; the filter follows the type", () => {
  const entries = [
    { ...expense("2026-09-02", "Ntorq", 300), subcategory: "Petrol" },
    { ...expense("2026-09-05", "Ntorq", 250), subcategory: "Petrol" },
    { ...expense("2026-09-06", "Ntorq", 1200), subcategory: "Repair / Accessory" },
    expense("2026-09-07", "Ntorq", 100), // saved before types existed
    expense("2026-09-08", "Transport", 90),
  ];
  const one = spendingByCategory(entries, { period: "all" }, "2026-09-26");
  assert.deepEqual(one.rows.map((r) => [r.category, r.amount]), [["Ntorq", 1850], ["Transport", 90]]);
  const split = spendingByCategory(entries, { period: "all" }, "2026-09-26", { bySubcategory: true });
  assert.deepEqual(split.rows.map((r) => [r.category, r.parent, r.subcategory, r.amount]), [
    ["Ntorq · Repair / Accessory", "Ntorq", "Repair / Accessory", 1200],
    ["Ntorq · Petrol", "Ntorq", "Petrol", 550],
    ["Ntorq · Unclassified", "Ntorq", "Unclassified", 100],
    ["Transport", "Transport", "", 90],
  ]);
  assert.equal(split.total, one.total);
  assert.equal(filterEntries(entries, { category: "Ntorq", subcategory: "Petrol" }, "2026-09-26").length, 2);
  assert.equal(filterEntries(entries, { category: "Ntorq", subcategory: "Unclassified" }, "2026-09-26").length, 1);
});

test("same-day entries are ordered by when they were first saved (split food halves stay together)", () => {
  const a = { ...expense("2026-09-10", "Mandatory Food", 50), id: 1, createdAt: "2026-09-10T08:00:00.000Z" };
  const b = { ...transfer("2026-09-10", "Salary", GENERAL, 50), id: 2, createdAt: "2026-09-10T09:00:00.000Z" };
  const c = { ...expense("2026-09-10", "Optional Food", 50), id: 3, createdAt: "2026-09-10T08:00:00.000Z" };
  assert.deepEqual(chronological([b, c, a]).map((e) => e.id), [1, 3, 2]);
});

test("R28: the 14-day food amount is rounded once, and the forecast days add up to it", () => {
  const entries = [expense("2026-09-20", "Mandatory Food", 100)];
  const [m] = autoFoodPlans(entries, "2026-09-26");
  assert.equal(m.amount, 46.67);
  const f = cashflowForecast(entries, [], [], "2026-09-26", 2, [m]);
  assert.equal(Math.round((f.rows[0].expense + f.rows[1].expense) * 100) / 100, 46.67);
});

test("R31: Ntorq petrol = weekly average of the last 4 weeks for the next 4 weeks; repair = monthly average of the last 3 months for the next month", () => {
  const ntorq = (date, sub, amount) => ({ ...expense(date, "Ntorq", amount), subcategory: sub });
  const entries = [
    ntorq("2026-09-26", "Petrol", 500), // today
    ntorq("2026-08-30", "Petrol", 700), // 28th day back: included
    ntorq("2026-08-29", "Petrol", 999), // 29 days back: not included
    ntorq("2026-07-10", "Repair / Accessory", 1800), // within 3 months
    ntorq("2026-06-27", "Repair / Accessory", 1200), // first day of the 3 months
    ntorq("2026-06-26", "Repair / Accessory", 5000), // just outside
    expense("2026-09-20", "Ntorq", 300), // unclassified: neither
  ];
  const [petrol, repair] = autoNtorqPlans(entries, "2026-09-26");
  assert.deepEqual(
    [petrol.subcategory, petrol.rate, petrol.unit, petrol.amount, petrol.from, petrol.to, petrol.days],
    ["Petrol", 300, "week", 1200, "2026-09-27", "2026-10-24", 28]
  );
  assert.deepEqual(
    [repair.subcategory, repair.rate, repair.unit, repair.amount, repair.from, repair.to],
    ["Repair / Accessory", 1000, "month", 1000, "2026-09-27", "2026-10-26"]
  );
  assert.deepEqual(autoPlans(entries, "2026-09-26").map((l) => l.subcategory || l.category), [
    "Mandatory Food", "Optional Food", "Petrol", "Repair / Accessory", "Transport", "Bills & Utilities",
  ]);
});

test("R31: the forecast spreads the Ntorq lines day by day across months and adds them to Ntorq", () => {
  const entries = [{ ...expense("2026-09-26", "Ntorq", 2800), subcategory: "Petrol" }]; // 700/week, 100/day
  const lines = autoPlans(entries, "2026-09-26");
  const f = cashflowForecast(entries, [], [], "2026-09-26", 2, lines);
  // Petrol: 27–30 Sep = 4 days (400), 1–24 Oct = 24 days (2,400).
  assert.deepEqual([f.rows[0].expense, f.rows[1].expense], [400, 2400]);
  // A budget for Ntorq counts if it is larger than the planned amount.
  const withBudget = cashflowForecast(entries, [{ category: "Ntorq", amount: 3000 }], [], "2026-09-26", 2, lines);
  assert.deepEqual([withBudget.rows[0].expense, withBudget.rows[1].expense], [400, 3000]);
});

test("R32: Transport = weekly average over the last 3 months for the next 3 weeks; Bills & Utilities = monthly average over the last 3 months for the next month", () => {
  const entries = [
    expense("2026-09-26", "Transport", 920), // today
    expense("2026-06-27", "Transport", 920), // first day of the 3 months
    expense("2026-06-26", "Transport", 5000), // just outside
    expense("2026-09-05", "Bills & Utilities", 2500),
    expense("2026-07-05", "Bills & Utilities", 2000),
    expense("2026-10-01", "Bills & Utilities", 9999), // future-dated: not counted
  ];
  const lines = autoPlans(entries, "2026-09-26");
  const transport = lines.find((l) => l.category === "Transport");
  // 27 Jun – 26 Sep = 92 days = 13.14 weeks; ₹1,840 → ₹140/week; next 3 weeks = ₹420.
  assert.deepEqual(
    [transport.since, transport.spent, transport.rate, transport.unit, transport.amount, transport.from, transport.to, transport.horizon, transport.basis],
    ["2026-06-27", 1840, 140, "week", 420, "2026-09-27", "2026-10-17", "next 3 weeks", "last 3 months"]
  );
  const bills = lines.find((l) => l.category === "Bills & Utilities");
  assert.deepEqual(
    [bills.spent, bills.rate, bills.unit, bills.amount, bills.to, bills.horizon],
    [4500, 1500, "month", 1500, "2026-10-26", "next month"]
  );
});

test("R28/R31/R32: the forecast spreads auto amounts in whole paise and never gives a day a negative share", () => {
  const entries = [expense("2026-09-20", "Mandatory Food", 0.15)]; // ₹0.07 over 14 days
  const lines = autoPlans(entries, "2026-09-26");
  const food = lines.find((l) => l.category === "Mandatory Food");
  const f = cashflowForecast(entries, [], [], "2026-09-26", 2, [food]);
  assert.equal(Math.round((f.rows[0].expense + f.rows[1].expense) * 100) / 100, food.amount);
  assert.ok(f.rows.every((r) => r.expense >= 0));
});

test("ordering is stable when some entries have no saved time", () => {
  const a = { ...expense("2026-09-10", "Transport", 1), id: 1, createdAt: "2026-09-10T09:00:00.000Z" };
  const b = { ...expense("2026-09-10", "Transport", 1), id: 2 };
  const c = { ...expense("2026-09-10", "Transport", 1), id: 3, createdAt: "2026-09-10T08:00:00.000Z" };
  const orders = [[a, b, c], [c, b, a], [b, a, c]].map((list) => chronological(list).map((e) => e.id).join());
  assert.equal(new Set(orders).size, 1);
});
