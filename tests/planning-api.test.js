// API tests for budgets (R25) and planned cashflows (R26) against a real PostgreSQL.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { skip, raw, call } from "./helpers.js";
import { forecastEnd, addMonths } from "../public/ledger.js";

const todayUtc = () => new Date().toISOString().slice(0, 10);

let budgets, plans, pool;

before(async () => {
  if (skip) return;
  await raw("DROP TABLE IF EXISTS entries, budgets, plans");
  budgets = (await import("../api/budgets.js")).default;
  plans = (await import("../api/plans.js")).default;
  pool = (await import("../lib/db.js")).getPool();
});

after(async () => {
  if (pool) await pool.end();
});

test("R25: budgets can be set, changed and removed per category", { skip }, async () => {
  assert.deepEqual((await call(budgets, "GET", "/api/budgets")).data, []);
  const set = await call(budgets, "PUT", "/api/budgets", { category: "Groceries", amount: 5000 });
  assert.equal(set.status, 200);
  assert.deepEqual(set.data, { category: "Groceries", amount: 5000 });
  await call(budgets, "PUT", "/api/budgets", { category: "Groceries", amount: 6000.5 });
  await call(budgets, "PUT", "/api/budgets", { category: "Ntorq", amount: 1500 });
  assert.deepEqual((await call(budgets, "GET", "/api/budgets")).data, [
    { category: "Groceries", amount: 6000.5 },
    { category: "Ntorq", amount: 1500 },
  ]);
  assert.equal((await call(budgets, "PUT", "/api/budgets", { category: "Ntorq", amount: 0 })).status, 400);
  assert.equal((await call(budgets, "PUT", "/api/budgets", { amount: 10 })).status, 400);
  assert.equal((await call(budgets, "DELETE", "/api/budgets?category=Ntorq")).status, 200);
  assert.equal((await call(budgets, "GET", "/api/budgets")).data.length, 1);
});

test("R26: planned cashflows can be created, edited and deleted", { skip }, async () => {
  const created = await call(plans, "POST", "/api/plans", {
    type: "income", category: "Salary", amount: 60000, nextDate: "2026-10-01", repeat: "monthly", description: "",
  });
  assert.equal(created.status, 201);
  assert.deepEqual(
    { ...created.data, id: undefined },
    { id: undefined, type: "income", category: "Salary", description: "", amount: 60000, nextDate: "2026-10-01", repeat: "monthly", day: 1 }
  );
  const rent31 = await call(plans, "POST", "/api/plans", {
    type: "expense", category: "Ntorq", amount: 100, nextDate: todayUtc(), day: 31, repeat: "monthly",
  });
  assert.equal(rent31.data.day, 31, "an explicit day is kept even when the date is earlier in the month");
  assert.equal((await call(plans, "POST", "/api/plans", { ...rent31.data, day: 32 })).status, 400);
  await call(plans, "DELETE", `/api/plans?id=${rent31.data.id}`);
  const id = created.data.id;
  const moved = await call(plans, "PUT", `/api/plans?id=${id}`, { ...created.data, nextDate: "2026-11-01" });
  assert.equal(moved.data.nextDate, "2026-11-01");
  for (const bad of [
    { type: "transfer", category: "Salary", amount: 1, nextDate: "2026-10-01" },
    { type: "income", category: "", amount: 1, nextDate: "2026-10-01" },
    { type: "income", category: "Salary", amount: -1, nextDate: "2026-10-01" },
    { type: "income", category: "Salary", amount: 1, nextDate: "01/10/2026" },
    { type: "income", category: "Salary", amount: 1, nextDate: "2026-10-01", repeat: "weekly" },
  ]) {
    assert.equal((await call(plans, "POST", "/api/plans", bad)).status, 400, JSON.stringify(bad));
  }
  // R36: plans only within the 3-month forecast (a new plan, or a one-time plan).
  const tooLate = addMonths(forecastEnd(todayUtc()), 1);
  const late = await call(plans, "POST", "/api/plans", { type: "expense", category: "Health", amount: 1, nextDate: tooLate });
  assert.equal(late.status, 400);
  assert.match(late.data.error, /within the next 3 months/);
  // …but recording an early monthly payment may move it past the forecast.
  const early = await call(plans, "PUT", `/api/plans?id=${id}`, { ...created.data, nextDate: tooLate });
  assert.equal(early.status, 200);
  assert.equal((await call(plans, "DELETE", `/api/plans?id=${id}`)).status, 200);
  assert.equal((await call(plans, "DELETE", `/api/plans?id=${id}`)).status, 404);
  assert.deepEqual((await call(plans, "GET", "/api/plans")).data, []);
});
