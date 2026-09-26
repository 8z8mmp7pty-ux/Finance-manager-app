// Upgrading from the previous schema (reserves and transfers, before accounts/contra existed)
// must keep all data (R3), put existing entries in Super Money (R18) and allow contra (R19).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { skip, raw, call } from "./helpers.js";

let pool;

before(async () => {
  if (skip) return;
  await raw(`
    DROP TABLE IF EXISTS entries, budgets, plans;
    CREATE TABLE entries (
      id          BIGSERIAL PRIMARY KEY,
      type        TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer')),
      description TEXT NOT NULL,
      amount      NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
      entry_date  DATE NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      category    TEXT NOT NULL DEFAULT '',
      reserve     TEXT NOT NULL DEFAULT '',
      to_reserve  TEXT NOT NULL DEFAULT ''
    );
    INSERT INTO entries (type, category, description, reserve, to_reserve, amount, entry_date) VALUES
      ('income', 'Salary', '', 'Salary', '', 60000, '2026-08-01'),
      ('expense', 'Rent', 'August', 'General Reserve', '', 15000, '2026-08-02'),
      ('transfer', '', '', 'Salary', 'General Reserve', 20000, '2026-08-03');
  `);
});

after(async () => {
  if (pool) await pool.end();
});

test("R3/R18/R19: upgrade from the reserves schema keeps data, adds Super Money, allows contra", { skip }, async () => {
  const handler = (await import("../api/entries.js")).default;
  pool = (await import("../lib/db.js")).getPool();
  const res = await call(handler, "GET");
  assert.equal(res.status, 200);
  const byType = Object.fromEntries(res.data.map((e) => [e.type, e]));
  assert.equal(res.data.length, 3);
  assert.equal(byType.income.reserve, "Salary");
  assert.equal(byType.expense.description, "August");
  assert.equal(byType.transfer.toReserve, "General Reserve");
  for (const e of res.data) assert.equal(e.account, "Super Money");

  // R25/R26: the budgets and plans tables are added alongside the existing data.
  const tables = await raw("SELECT to_regclass('budgets') AS budgets, to_regclass('plans') AS plans");
  assert.deepEqual(tables.rows[0], { budgets: "budgets", plans: "plans" });

  const contra = await call(handler, "POST", "/api/entries", {
    type: "contra", account: "Super Money", toAccount: "Cash", amount: 500, description: "", date: "2026-08-04",
  });
  assert.equal(contra.status, 201);
  assert.equal((await call(handler, "GET")).data.length, 4);
});
