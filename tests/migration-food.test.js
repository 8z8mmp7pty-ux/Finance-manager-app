// R27: the one-time food split. Food & Dining is split 50:50 into Mandatory Food and Optional Food;
// Groceries becomes Mandatory Food in full. Entries, planned payments and budgets are all converted,
// totals are unchanged, and running the upgrade again changes nothing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { skip, raw, call } from "./helpers.js";

let pool;

before(async () => {
  if (skip) return;
  // The schema just before this change (with plans.day), holding some food data.
  await raw(`
    DROP TABLE IF EXISTS entries, budgets, plans, app_migrations;
    CREATE TABLE entries (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer', 'contra')),
      description TEXT NOT NULL,
      amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
      entry_date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      category TEXT NOT NULL DEFAULT '', reserve TEXT NOT NULL DEFAULT '', to_reserve TEXT NOT NULL DEFAULT '',
      account TEXT NOT NULL DEFAULT '', to_account TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE budgets (category TEXT PRIMARY KEY, amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE plans (
      id BIGSERIAL PRIMARY KEY, type TEXT NOT NULL, category TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0), next_date DATE NOT NULL,
      repeat TEXT NOT NULL DEFAULT 'none', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), day INTEGER
    );
    INSERT INTO entries (type, category, description, reserve, account, amount, entry_date) VALUES
      ('expense', 'Food & Dining', 'lunch', 'Salary', 'GPay', 100.01, '2026-09-10'),
      ('expense', 'Food & Dining', '', 'General Reserve', 'Super Money', 0.01, '2026-09-11'),
      ('expense', 'Groceries', 'veg', 'General Reserve', 'Cash', 850, '2026-09-12'),
      ('expense', 'Ntorq', '', 'General Reserve', 'Super Money', 500, '2026-09-13'),
      ('income', 'Salary', '', 'Salary', 'Super Money', 60000, '2026-09-01');
    INSERT INTO plans (type, category, description, amount, next_date, repeat, day) VALUES
      ('expense', 'Food & Dining', 'eating out', 3000, '2026-10-05', 'monthly', 5),
      ('expense', 'Groceries', '', 4000, '2026-10-01', 'monthly', 1);
    INSERT INTO budgets (category, amount) VALUES ('Food & Dining', 6000.01), ('Groceries', 4000), ('Ntorq', 1000);
  `);
});

after(async () => {
  if (pool) await pool.end();
});

const sum = (rows) => Math.round(rows.reduce((s, r) => s + Number(r.amount), 0) * 100) / 100;

test("R27: food entries, plans and budgets are converted once, keeping every rupee", { skip }, async () => {
  const handler = (await import("../api/entries.js")).default;
  const db = await import("../lib/db.js");
  pool = db.getPool();

  const res = await call(handler, "GET");
  assert.equal(res.status, 200);
  const food = (c) => res.data.filter((e) => e.category === c).sort((a, b) => a.date.localeCompare(b.date));

  // 100.01 → 50.00 mandatory + 50.01 optional, same date, reserve, account and note.
  const mandatory = food("Mandatory Food");
  const optional = food("Optional Food");
  assert.deepEqual(mandatory.map((e) => [e.date, e.amount, e.reserve, e.account, e.description]), [
    ["2026-09-10", 50, "Salary", "GPay", "lunch"],
    ["2026-09-11", 0.01, "General Reserve", "Super Money", ""], // a single paisa can't be split
    ["2026-09-12", 850, "General Reserve", "Cash", "veg"], // Groceries: 100% mandatory
  ]);
  assert.deepEqual(optional.map((e) => [e.date, e.amount, e.reserve, e.account, e.description]), [
    ["2026-09-10", 50.01, "Salary", "GPay", "lunch"],
  ]);
  assert.equal(food("Food & Dining").length + food("Groceries").length, 0);
  assert.equal(sum(mandatory) + sum(optional), 100.01 + 0.01 + 850);
  assert.equal(food("Ntorq")[0].amount, 500, "other categories untouched");

  const plans = (await raw("SELECT category, amount::float AS amount, next_date::text AS d, repeat, day, description FROM plans ORDER BY category, amount")).rows;
  assert.deepEqual(plans, [
    { category: "Mandatory Food", amount: 1500, d: "2026-10-05", repeat: "monthly", day: 5, description: "eating out" },
    { category: "Mandatory Food", amount: 4000, d: "2026-10-01", repeat: "monthly", day: 1, description: "" },
    { category: "Optional Food", amount: 1500, d: "2026-10-05", repeat: "monthly", day: 5, description: "eating out" },
  ]);

  const budgets = (await raw("SELECT category, amount::float AS amount FROM budgets ORDER BY category")).rows;
  assert.deepEqual(budgets, [
    { category: "Mandatory Food", amount: 3000 + 4000 },
    { category: "Ntorq", amount: 1000 },
    { category: "Optional Food", amount: 3000.01 },
  ]);

  // Running the upgrade again (another cold start) must not split anything twice.
  await raw(db.SCHEMA_SQL);
  await raw(db.SCHEMA_SQL);
  const again = await call(handler, "GET");
  assert.equal(again.data.length, res.data.length);
  assert.equal((await raw("SELECT count(*)::int AS n FROM plans")).rows[0].n, 3);
  assert.deepEqual((await raw("SELECT category, amount::float AS amount FROM budgets ORDER BY category")).rows, budgets);
});
