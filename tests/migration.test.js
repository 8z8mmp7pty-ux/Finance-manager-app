// Upgrading an existing database must keep all data (R3) and sort old entries into reserves (R8).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { skip, raw, call } from "./helpers.js";

let pool;

before(async () => {
  if (skip) return;
  // The very first schema (before categories and reserves existed).
  await raw(`
    DROP TABLE IF EXISTS entries, budgets, plans;
    CREATE TABLE entries (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      description TEXT NOT NULL,
      amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
      entry_date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO entries (type, description, amount, entry_date) VALUES
      ('income', 'July pay', 50000, '2026-07-01'),
      ('expense', 'Groceries', 1200.50, '2026-07-02');
  `);
});

after(async () => {
  if (pool) await pool.end();
});

test("R3: old data survives the upgrade and old entries land in General Reserve", { skip }, async () => {
  const handler = (await import("../api/entries.js")).default;
  pool = (await import("../lib/db.js")).getPool();
  const res = await call(handler, "GET");
  assert.equal(res.status, 200);
  assert.equal(res.data.length, 2);
  for (const e of res.data) {
    assert.equal(e.reserve, "General Reserve");
    assert.equal(e.account, "Super Money", "R18: existing entries are in Super Money");
  }
  const transfer = await call(handler, "POST", "/api/entries", {
    type: "transfer", reserve: "General Reserve", toReserve: "Salary", amount: 10, description: "", date: "2026-07-03",
  });
  assert.equal(transfer.status, 201, "transfer type allowed after upgrade");
  const contra = await call(handler, "POST", "/api/entries", {
    type: "contra", account: "Super Money", toAccount: "Cash", amount: 10, description: "", date: "2026-07-04",
  });
  assert.equal(contra.status, 201, "contra type allowed after upgrade");
});
