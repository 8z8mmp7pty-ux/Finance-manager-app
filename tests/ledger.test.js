// Tests for the FIFO reserve logic. Requirement IDs refer to REQUIREMENTS.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GENERAL, allocate, reserveBalances, reserveMonths, reserveReport, reserveAccountGrid, accountBalances, transferAllPlan,
  addMonths, periodRange, filterEntries, totalsOf, spendingByCategory, reserveReceipts, receiptReport,
  budgetStatus, planOccurrences, cashflowForecast, UNCATEGORISED, autoFoodPlans, chronological,
  autoNtorqPlans, autoPlans, availableToSpend, spendable, availableExplanation, forecastEnd, planDates } from "../public/ledger.js";

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

test("R28/R39: automatic food plans use each food type's last-30-day average per day for the next 3 months", () => {
  const entries = [
    expense("2026-09-26", "Mandatory Food", 300), // today
    expense("2026-08-28", "Mandatory Food", 600), // 30th day back: included
    expense("2026-08-27", "Mandatory Food", 999), // 31 days back: not included
    expense("2026-09-10", "Optional Food", 450),
    expense("2026-09-10", "Groceries", 5000), // not a food type any more
  ];
  const [mandatory, optional] = autoFoodPlans(entries, "2026-09-26");
  assert.deepEqual(
    [mandatory.category, mandatory.perDay, mandatory.amount, mandatory.from, mandatory.to, mandatory.days, mandatory.horizon],
    ["Mandatory Food", 30, 2700, "2026-09-27", "2026-12-25", 90, "next 3 months"]
  );
  assert.deepEqual([optional.category, optional.perDay, optional.amount], ["Optional Food", 15, 1350]);
});

test("R28: the forecast counts automatic food plans day by day, split across months", () => {
  const entries = [income("2026-09-01", "Salary", 10000), expense("2026-09-20", "Mandatory Food", 3000)]; // 100/day
  const auto = autoFoodPlans(entries, "2026-09-26");
  const f = cashflowForecast(entries, [], [], "2026-09-26", 2, auto);
  // ₹100/day: 27–30 Sep = 4 days in September, all 31 days of October.
  assert.deepEqual([f.rows[0].expense, f.rows[1].expense], [400, 3100]);
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

test("R28: the food amount is rounded once, and the forecast days add up to it", () => {
  const entries = [expense("2026-09-20", "Mandatory Food", 100.01)];
  const [m] = autoFoodPlans(entries, "2026-09-26");
  assert.equal(m.amount, 300.03);
  const f = cashflowForecast(entries, [], [], "2026-09-26", 3, [m]);
  assert.equal(Math.round(f.rows.reduce((s, r) => s + r.expense, 0) * 100) / 100, 300.03);
});

test("R31/R39: Ntorq petrol = weekly average of the last 4 weeks; repair = monthly average of the last 3 months; both over the 3-month forecast", () => {
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
    ["Petrol", 300, "week", 3857.14, "2026-09-27", "2026-12-25", 90] // ₹1,200 per 28 days × 90 days
  );
  assert.deepEqual(
    [repair.subcategory, repair.rate, repair.unit, repair.amount, repair.from, repair.to],
    ["Repair / Accessory", 978.26, "month", 2934.78, "2026-09-27", "2026-12-25"] // ₹3,000 per 92 days × 90 days
  );
  assert.deepEqual(autoPlans(entries, "2026-09-26").map((l) => l.subcategory || l.category), [
    "Mandatory Food", "Optional Food", "Petrol", "Repair / Accessory", "Transport", "Bills & Utilities",
    "Education", "Entertainment",
  ]);
});

test("R31: the forecast spreads the Ntorq lines day by day across months and adds them to Ntorq", () => {
  const entries = [{ ...expense("2026-09-26", "Ntorq", 2800), subcategory: "Petrol" }]; // 700/week, 100/day
  const lines = autoPlans(entries, "2026-09-26");
  const f = cashflowForecast(entries, [], [], "2026-09-26", 2, lines);
  // Petrol at ₹100/day: 27–30 Sep = 4 days (400), October 31 days (3,100).
  assert.deepEqual([f.rows[0].expense, f.rows[1].expense], [400, 3100]);
  // A budget for Ntorq counts if it is larger than the planned amount.
  const withBudget = cashflowForecast(entries, [{ category: "Ntorq", amount: 5000 }], [], "2026-09-26", 2, lines);
  assert.deepEqual([withBudget.rows[0].expense, withBudget.rows[1].expense], [2200, 5000]);
});

test("R32/R39: Transport = weekly average over the last 3 months; Bills & Utilities = monthly average over the last 3 months; both for the next 3 months", () => {
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
  // 27 Jun – 26 Sep = 92 days = 13.14 weeks; ₹1,840 → ₹140/week; next 90 days = ₹1,800.
  assert.deepEqual(
    [transport.since, transport.spent, transport.rate, transport.unit, transport.amount, transport.from, transport.to, transport.horizon, transport.basis],
    ["2026-06-27", 1840, 140, "week", 1800, "2026-09-27", "2026-12-25", "next 3 months", "last 3 months"]
  );
  const bills = lines.find((l) => l.category === "Bills & Utilities");
  assert.deepEqual(
    [bills.spent, bills.rate, bills.unit, bills.amount, bills.to, bills.horizon],
    [4500, 1467.39, "month", 4402.17, "2026-12-25", "next 3 months"]
  );
});

test("R28/R31/R32: the forecast spreads auto amounts in whole paise and never gives a day a negative share", () => {
  const entries = [expense("2026-09-20", "Mandatory Food", 0.15)]; // ₹0.45 over 90 days
  const lines = autoPlans(entries, "2026-09-26");
  const food = lines.find((l) => l.category === "Mandatory Food");
  const f = cashflowForecast(entries, [], [], "2026-09-26", 3, [food]);
  assert.equal(Math.round(f.rows.reduce((s, r) => s + r.expense, 0) * 100) / 100, food.amount);
  assert.ok(f.rows.every((r) => r.expense >= 0));
});

test("ordering is stable when some entries have no saved time", () => {
  const a = { ...expense("2026-09-10", "Transport", 1), id: 1, createdAt: "2026-09-10T09:00:00.000Z" };
  const b = { ...expense("2026-09-10", "Transport", 1), id: 2 };
  const c = { ...expense("2026-09-10", "Transport", 1), id: 3, createdAt: "2026-09-10T08:00:00.000Z" };
  const orders = [[a, b, c], [c, b, a], [b, a, c]].map((list) => chronological(list).map((e) => e.id).join());
  assert.equal(new Set(orders).size, 1);
});

test("R34/R39: Education and Entertainment = monthly average over the last 3 months, over the 3-month forecast", () => {
  const entries = [
    expense("2026-09-10", "Education", 3000),
    expense("2026-07-01", "Education", 1500),
    expense("2026-06-20", "Education", 9000), // older than 3 months
    expense("2026-09-25", "Entertainment", 600),
  ];
  const lines = autoPlans(entries, "2026-09-26");
  const education = lines.find((l) => l.category === "Education");
  const fun = lines.find((l) => l.category === "Entertainment");
  assert.deepEqual([education.rate, education.amount, education.unit, education.horizon, education.basis], [1467.39, 4402.17, "month", "next 3 months", "last 3 months"]);
  assert.deepEqual([fun.rate, fun.amount, fun.to], [195.65, 586.96, "2026-12-25"]);
  // A per-month line shows its amount per forecast month, so 3 × rate ≈ amount (R39).
  assert.ok(Math.abs(education.rate * 3 - education.amount) < 0.02);
});

test("R31: look-back windows at month ends, future entries ignored, auto lines + manual plan + budget", () => {
  const ntorq = (date, sub, amount) => ({ ...expense(date, "Ntorq", amount), subcategory: sub });
  // 31 May: 3 months back starts 1 Mar (92 days); the forecast ends 30 Aug (1 Jun – 30 Aug = 91 days).
  const may = autoNtorqPlans([ntorq("2026-03-01", "Repair / Accessory", 900), ntorq("2026-02-28", "Repair / Accessory", 5000)], "2026-05-31")[1];
  assert.deepEqual([may.since, may.to, may.amount], ["2026-03-01", "2026-08-30", 890.22]);
  // 31 Mar: 3 months back starts 1 Jan.
  const mar = autoNtorqPlans([], "2026-03-31")[1];
  assert.equal(mar.since, "2026-01-01");
  // A petrol entry dated tomorrow is not part of the average.
  const petrol = autoNtorqPlans([ntorq("2026-09-27", "Petrol", 800), ntorq("2026-09-26", "Petrol", 400)], "2026-09-26")[0];
  assert.equal(petrol.spent, 400);

  // Petrol ₹1,400 per 28 days = ₹50/day + a manual Ntorq plan of 500 on 5 Oct, all under Ntorq.
  const entries = [ntorq("2026-09-20", "Petrol", 1400)];
  const lines = autoPlans(entries, "2026-09-26");
  const plans = [{ type: "expense", category: "Ntorq", amount: 500, nextDate: "2026-10-05", repeat: "none" }];
  const f = cashflowForecast(entries, [], plans, "2026-09-26", 3, lines);
  assert.equal(Math.round(f.rows.reduce((s, r) => s + r.expense, 0) * 100) / 100, 4500 + 500);
  // A larger Ntorq budget wins in October.
  const b = cashflowForecast(entries, [{ category: "Ntorq", amount: 5000 }], plans, "2026-09-26", 2, lines);
  assert.equal(b.rows[1].expense, 5000);
});

test("R35: every automatic average includes today in the past period; the plan ahead starts tomorrow", () => {
  const today = "2026-09-26";
  const entries = [
    expense(today, "Mandatory Food", 300),
    expense(today, "Optional Food", 150),
    { ...expense(today, "Ntorq", 400), subcategory: "Petrol" },
    { ...expense(today, "Ntorq", 900), subcategory: "Repair / Accessory" },
    expense(today, "Transport", 92 * 10),
    expense(today, "Bills & Utilities", 3000),
    expense(today, "Education", 3000),
    expense(today, "Entertainment", 3000),
    expense("2026-09-27", "Education", 99999), // tomorrow: not counted
  ];
  for (const line of autoPlans(entries, today)) {
    assert.ok(line.since <= today, line.category);
    assert.ok(line.spent > 0, `${line.subcategory || line.category} counts today's entry`);
    assert.equal(line.from, "2026-09-27", "the plan ahead starts tomorrow");
  }
  assert.equal(autoPlans(entries, today).find((l) => l.category === "Education").spent, 3000);
});

test("R32: Transport over a 90-day 3-month window (31 Mar looks back to 1 Jan)", () => {
  const [t] = autoPlans([expense("2026-01-01", "Transport", 1000)], "2026-03-31").filter((l) => l.category === "Transport");
  // 1 Jan – 31 Mar = 90 days back; 1 Apr – 30 Jun = 91 days ahead.
  assert.deepEqual([t.since, t.rate, t.amount, t.to], ["2026-01-01", 77.78, 1011.11, "2026-06-30"]);
});

test("R34: Education and Entertainment auto amounts land in the forecast month by month", () => {
  const entries = [expense("2026-09-01", "Education", 3100), expense("2026-09-02", "Entertainment", 3100)];
  const lines = autoPlans(entries, "2026-09-26").filter((l) => ["Education", "Entertainment"].includes(l.category));
  // Each is ₹3,100 per 92 days, over the 90 days 27 Sep – 25 Dec.
  const f = cashflowForecast(entries, [], [], "2026-09-26", 3, lines);
  const total = lines.reduce((s, l) => s + l.amount, 0);
  assert.equal(Math.round(f.rows.reduce((s, r) => s + r.expense, 0) * 100) / 100, Math.round(total * 100) / 100);
  assert.ok(f.rows[1].expense > f.rows[0].expense * 5);
});

// ---------- Available to spend = balance × (income − payments) ÷ income over the 3-month forecast (R36) ----------

test("R36: the forecast covers today to the same date 3 months ahead, month by month", () => {
  assert.equal(forecastEnd("2026-09-26"), "2026-12-25");
  const entries = [income("2026-09-01", "Salary", 60000)];
  const budgets = [{ category: "Bills & Utilities", amount: 3100 }]; // nothing spent yet
  const f = cashflowForecast(entries, budgets, [], "2026-09-26", 3, []);
  assert.deepEqual(f.rows.map((r) => [r.from, r.to, r.partial]), [
    ["2026-09-26", "2026-09-30", true],
    ["2026-10-01", "2026-10-31", false],
    ["2026-11-01", "2026-11-30", false],
    ["2026-12-01", "2026-12-25", true],
  ]);
  // Sep: the ₹3,100 left this month; Oct: 3,100; Nov: 3,100; Dec: 25/31 of 3,100 = 2,500.
  assert.deepEqual(f.rows.map((r) => r.expense), [3100, 3100, 3100, 2500]);
});

test("R36: surplus = balance + every expected income − every expected payment; available = balance × left ÷ income", () => {
  const today = "2026-09-26";
  const entries = [income("2026-09-01", "Salary", 60000), expense("2026-09-10", "Mandatory Food", 2000)]; // balance 58,000
  const budgets = [{ category: "Mandatory Food", amount: 6000 }];
  const plans = [
    { type: "income", category: "Salary", amount: 60000, nextDate: "2026-10-01", repeat: "monthly", day: 1 }, // Oct, Nov, Dec
    { type: "expense", category: "Ntorq", amount: 1500, nextDate: "2026-11-05", repeat: "none" },
    { type: "expense", category: "Health", amount: 700, nextDate: "2027-01-05", repeat: "none" }, // after the forecast: not counted
  ];
  const a = availableToSpend(entries, budgets, plans, today, []);
  // Food: Sep 4,000 left + Oct 6,000 + Nov 6,000 + Dec 25/31 × 6,000 = 4,838.71 → 20,838.71.
  assert.equal(a.income, 180000);
  assert.deepEqual(a.rows.map((r) => [r.category, r.expected]), [["Mandatory Food", 20838.71], ["Ntorq", 1500]]);
  assert.equal(a.expected, 22338.71);
  assert.equal(a.surplus, 58000 + 180000 - 22338.71);
  // 58,000 × (1,80,000 − 22,338.71) ÷ 1,80,000 = 50,801.97.
  assert.equal(a.available, 50801.97);
  assert.equal(a.until, "2026-12-25");
});

test("R36: available = current balance × (left at period end ÷ total income of the period)", () => {
  const today = "2026-09-26";
  const entries = [income("2026-09-01", "Salary", 58000)]; // balance 58,000
  const plans = [
    { type: "income", category: "Salary", amount: 60000, nextDate: "2026-10-01", repeat: "monthly", day: 1 }, // 3 × 60,000
    { type: "expense", category: "Health", amount: 9200, nextDate: "2026-10-05", repeat: "none" },
  ];
  const a = availableToSpend(entries, [], plans, today, []);
  assert.deepEqual([a.balance, a.income, a.expected, a.surplus], [58000, 180000, 9200, 228800]);
  // The owner's example: 58,000 × (1,70,800 ÷ 1,80,000) = 58,000 × 0.9489 = 55,035.56.
  assert.equal(a.available, 55035.56);
  assert.ok(a.available <= a.balance);
});

test("R36: available with no income ahead, payments above income, or an empty balance", () => {
  assert.equal(spendable(20000, 0, 5000), 15000, "no income: the balance after payments");
  assert.equal(spendable(20000, 0, 25000), -5000, "no income, not enough: the shortfall");
  assert.equal(spendable(20000, 10000, 15000), 0, "payments use up all income: nothing free");
  assert.equal(spendable(20000, 10000, 35000), -5000, "and more than the balance can cover: the shortfall");
  assert.equal(spendable(0, 150000, 1000), 0, "nothing in hand: nothing to spend yet");
  assert.equal(spendable(-3000, 50000, 1000), -3000);
  assert.equal(spendable(10000, 100000, 90000), 1000);
  assert.equal(spendable(10000, 100000, 0), 10000, "no payments: the whole balance");
  // Nothing in hand yet, though income is coming: 0.
  const salary = { type: "income", category: "Salary", amount: 50000, nextDate: "2026-10-01", repeat: "monthly", day: 1 };
  const a = availableToSpend([], [], [salary], "2026-09-26");
  assert.deepEqual([a.balance, a.income, a.surplus, a.available], [0, 150000, 150000, 0]);
});

test("R36: the breakdown shows the calculation step by step and explains each case truthfully", () => {
  const explain = (balance, income, expected) => {
    const surplus = balance + income - expected;
    return availableExplanation({ balance, income, expected, surplus, available: spendable(balance, income, expected) });
  };
  // The owner's case: 63,000 in, 54,115.39 out, 2,972 in hand.
  const c = explain(2972, 63000, 54115.39);
  assert.deepEqual(c.groups[0], [
    { label: "Income expected", amount: 63000, sign: "+" },
    { label: "Payments expected", amount: 54115.39, sign: "−" },
    { label: "Left at period end", amount: 8884.61, total: true },
  ]);
  assert.deepEqual(c.groups[1], [
    { label: "Balance now", amount: 2972 },
    { label: "× Share of income left", percent: 14.1 },
    { label: "Available to spend", amount: 419.13, total: true },
  ]);
  assert.equal(c.note, "");
  assert.equal(c.closing, 11856.61);
  // Cases where the share is not used: no "× share" step, and a note says why.
  const note = (b, i, e) => explain(b, i, e).note;
  assert.equal(explain(0, 150000, 0).groups[1].length, 2);
  assert.equal(note(0, 150000, 0), "Nothing in hand yet.");
  assert.match(note(0, 0, 5000), /shortfall/);
  assert.equal(note(20000, 0, 1000), "No income expected: your balance after the payments.");
  assert.equal(explain(20000, 0, 1000).groups[1][1].amount, 19000);
  assert.match(note(20000, 10000, 15000), /use up all the income/);
  assert.match(note(20000, 10000, 55000), /shortfall/);
});

test("R36: budget and planned are compared month by month; the lowest point is reported", () => {
  const today = "2026-09-26";
  const entries = [income("2026-09-01", "Salary", 10000), expense("2026-09-05", "Health", 10000)]; // balance 0, Health budget used up
  const budgets = [{ category: "Health", amount: 10000 }];
  const plans = [
    { type: "expense", category: "Health", amount: 5000, nextDate: "2026-09-28", repeat: "none" },
    { type: "income", category: "Salary", amount: 40000, nextDate: "2026-11-01", repeat: "none" },
  ];
  const a = availableToSpend(entries, budgets, plans, today, []);
  const [sep, oct] = a.forecast.rows;
  assert.equal(sep.expense, 5000, "September: planned beats the used-up budget");
  assert.equal(oct.expense, 10000, "October: the full budget");
  assert.deepEqual(a.lowest, { balance: -15000, date: "2026-10-31" });
});

test("R36: transfers and contra entries do not change what is available", () => {
  const base = [income("2026-09-01", "Salary", 50000)];
  const moved = [...base, transfer("2026-09-02", "Salary", GENERAL, 20000), { id: 999, type: "contra", category: "", description: "", reserve: GENERAL, toReserve: "", account: "Super Money", toAccount: "Cash", amount: 5000, date: "2026-09-03" }];
  assert.equal(availableToSpend(moved, [], [], "2026-09-26").available, availableToSpend(base, [], [], "2026-09-26").available);
});

test("R37: a planned payment in a category with an Auto line adds to it (forecast and available to spend)", () => {
  const today = "2026-09-26";
  const entries = [income("2026-09-01", "Salary", 50000), { ...expense("2026-09-20", "Ntorq", 1400), subcategory: "Petrol" }];
  const lines = autoPlans(entries, today); // petrol ₹1,400 per 28 days = ₹50/day → ₹4,500 over 90 days
  const service = { type: "expense", category: "Ntorq", amount: 1500, nextDate: "2026-10-05", repeat: "none" };
  const salary = { type: "income", category: "Salary", amount: 50000, nextDate: "2026-11-01", repeat: "monthly", day: 1 };
  const f = cashflowForecast(entries, [], [service], today, 3, lines);
  assert.equal(Math.round(f.rows.reduce((s, r) => s + r.expense, 0) * 100) / 100, 4500 + 1500);
  const a = availableToSpend(entries, [], [service, salary], today, lines);
  assert.deepEqual(a.rows.map((r) => [r.category, r.expected]), [["Ntorq", 6000]]);
  // A budget only counts when it is larger than planned + Auto (compared month by month):
  // Sep: max(budget left 600 × … , petrol) and so on — never less than planned + Auto.
  const small = availableToSpend(entries, [{ category: "Ntorq", amount: 100 }], [service, salary], today, lines);
  assert.ok(small.rows[0].expected >= 6000);
});

test("R38: the 3-month window ends on the right day at month ends", () => {
  assert.equal(forecastEnd("2026-09-26"), "2026-12-25");
  assert.equal(forecastEnd("2027-01-31"), "2027-04-30");
  assert.equal(forecastEnd("2026-11-30"), "2027-02-28");
  assert.equal(forecastEnd("2027-11-29"), "2028-02-28");
  assert.equal(forecastEnd("2026-08-31"), "2026-11-30");
  assert.equal(forecastEnd("2028-02-29"), "2028-05-28");
  assert.equal(forecastEnd("2026-10-01"), "2026-12-31");
});

test("R36/R38: an overdue monthly plan counts once (as due today), not once per missed month", () => {
  const today = "2026-09-26";
  const salary = { type: "income", category: "Salary", amount: 50000, nextDate: "2026-07-01", repeat: "monthly", day: 1 };
  const a = availableToSpend([], [], [salary], today);
  // Today (overdue, once) + 1 Oct + 1 Nov + 1 Dec = 4 salaries, not 6.
  assert.equal(a.income, 200000);
  assert.equal(a.forecast.rows[0].income, 50000);
});

test("R39: every automatic line plans for the whole 3-month forecast, at its own average", () => {
  const entries = [
    expense("2026-09-26", "Mandatory Food", 300),
    { ...expense("2026-09-26", "Ntorq", 700), subcategory: "Petrol" },
    expense("2026-09-26", "Transport", 920),
    expense("2026-09-26", "Bills & Utilities", 920),
  ];
  for (const line of autoPlans(entries, "2026-09-26")) {
    assert.deepEqual([line.from, line.to, line.days, line.horizon], ["2026-09-27", "2026-12-25", 90, "next 3 months"], line.category);
  }
  // With the forecast: every forecast day after today carries the daily pace (₹10/day food here).
  const food = autoPlans(entries, "2026-09-26").filter((l) => l.category === "Mandatory Food");
  const f = cashflowForecast(entries, [], [], "2026-09-26", 3, food);
  assert.deepEqual(f.rows.map((r) => r.expense), [40, 310, 300, 250]);
});

test("R38: a monthly plan counts 3 times in the window, also at month ends", () => {
  const rent = (nextDate, day) => ({ type: "expense", category: "Bills & Utilities", amount: 1000, nextDate, repeat: "monthly", day });
  assert.deepEqual(planDates(rent("2027-01-31", 31), "2027-01-31"), ["2027-01-31", "2027-02-28", "2027-03-31"]);
  assert.deepEqual(planDates(rent("2026-11-30", 30), "2026-11-30"), ["2026-11-30", "2026-12-30", "2027-01-30"]);
  assert.deepEqual(planDates(rent("2026-12-28", 28), "2026-11-30"), ["2026-12-28", "2027-01-28", "2027-02-28"]);
  assert.equal(availableToSpend([], [], [rent("2027-01-31", 31)], "2027-01-31").expected, 3000);
  // Due exactly today: counted once today, then monthly.
  assert.deepEqual(planDates(rent("2026-09-26", 26), "2026-09-26"), ["2026-09-26", "2026-10-26", "2026-11-26"]);
});

test("R38: an overdue expense plan counts once, as due today", () => {
  const today = "2026-09-26";
  const bill = { type: "expense", category: "Bills & Utilities", amount: 800, nextDate: "2026-07-10", repeat: "monthly", day: 10 };
  assert.deepEqual(planDates(bill, today), [today, "2026-10-10", "2026-11-10", "2026-12-10"]);
  assert.equal(availableToSpend([], [], [bill], today).expected, 3200);
  // Overdue on the same day of the month as today: last month's payment and today's are both due.
  const rent = { ...bill, nextDate: "2026-08-26", day: 26 };
  assert.deepEqual(planDates(rent, today), [today, today, "2026-10-26", "2026-11-26"]);
  const once = { ...bill, repeat: "once" };
  assert.deepEqual(planDates(once, today), [today]);
});

test("R40: a repeating plan has one date per month in the 3-month forecast, the same dates the forecast counts", () => {
  const today = "2026-09-26";
  const salary = { type: "income", category: "Salary", amount: 50000, nextDate: "2026-10-01", repeat: "monthly", day: 1 };
  const trip = { type: "expense", category: "Dress", amount: 2000, nextDate: "2026-10-15", repeat: "once", day: 15 };
  const later = { type: "expense", category: "Dress", amount: 2000, nextDate: "2027-03-01", repeat: "monthly", day: 1 };
  assert.deepEqual(planDates(salary, today), ["2026-10-01", "2026-11-01", "2026-12-01"]);
  assert.deepEqual(planDates(trip, today), ["2026-10-15"]);
  assert.deepEqual(planDates(later, today), []);
  const f = cashflowForecast([], [], [salary, trip, later], today);
  assert.equal(f.rows.reduce((s, r) => s + r.income, 0), 50000 * planDates(salary, today).length);
});
