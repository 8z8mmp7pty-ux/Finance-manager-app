// Tests for the FIFO reserve logic. Requirement IDs refer to REQUIREMENTS.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { GENERAL, allocate, reserveBalances, reserveMonths, reserveReport, reserveAccountGrid, accountBalances } from "../public/ledger.js";

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
