// API tests against a real PostgreSQL. Requirement IDs refer to REQUIREMENTS.md.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { skip, raw, call } from "./helpers.js";

let handler;
let pool;

before(async () => {
  if (skip) return;
  await raw("DROP TABLE IF EXISTS entries");
  handler = (await import("../api/entries.js")).default;
  pool = (await import("../lib/db.js")).getPool();
});

after(async () => {
  if (pool) await pool.end();
});

const post = (body) => call(handler, "POST", "/api/entries", body);
const base = { description: "", date: "2026-08-01" };

test("R3: table is created automatically and starts empty", { skip }, async () => {
  const res = await call(handler, "GET");
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, []);
});

test("R8: income pours into the reserve named after its type", { skip }, async () => {
  const res = await post({ ...base, type: "income", category: "Salary", amount: 60000 });
  assert.equal(res.status, 201);
  assert.equal(res.data.reserve, "Salary");
  assert.equal(res.data.amount, 60000);
  assert.equal(res.data.date, "2026-08-01");
});

test("R9: income can be allotted to another reserve", { skip }, async () => {
  const res = await post({ ...base, type: "income", category: "Gift", reserve: "General Reserve", amount: 500 });
  assert.equal(res.status, 201);
  assert.equal(res.data.reserve, "General Reserve");
});

test("R9: editing an income can move it to another reserve", { skip }, async () => {
  const created = await post({ ...base, type: "income", category: "Refund", amount: 250 });
  assert.equal(created.data.reserve, "Refund");
  const moved = await call(handler, "PUT", `/api/entries?id=${created.data.id}`, {
    ...base, type: "income", category: "Refund", reserve: "Salary", amount: 250,
  });
  assert.equal(moved.status, 200);
  assert.equal(moved.data.reserve, "Salary");
  await call(handler, "DELETE", `/api/entries?id=${created.data.id}`);
});

test("R10: expenses are paid from General Reserve by default, or a chosen reserve", { skip }, async () => {
  const a = await post({ ...base, type: "expense", category: "Rent", amount: 15000 });
  assert.equal(a.data.reserve, "General Reserve");
  const b = await post({ ...base, type: "expense", category: "Groceries", reserve: "Salary", amount: 2000 });
  assert.equal(b.data.reserve, "Salary");
});

test("R11: transfers move money between two different reserves", { skip }, async () => {
  const ok = await post({ ...base, type: "transfer", reserve: "Salary", toReserve: "General Reserve", amount: 1000 });
  assert.equal(ok.status, 201);
  assert.equal(ok.data.toReserve, "General Reserve");
  assert.equal(ok.data.category, "");
  const same = await post({ ...base, type: "transfer", reserve: "Salary", toReserve: "Salary", amount: 1 });
  assert.equal(same.status, 400);
  const missing = await post({ ...base, type: "transfer", reserve: "Salary", amount: 1 });
  assert.equal(missing.status, 400);
});

test("R1: invalid entries are rejected", { skip }, async () => {
  for (const body of [
    { ...base, type: "loan", category: "Salary", amount: 1 },
    { ...base, type: "income", category: "Salary", amount: -5 },
    { ...base, type: "income", category: "Salary", amount: 0 },
    { ...base, type: "income", amount: 10 },
    { ...base, type: "income", category: "Salary", amount: 10, date: "01/08/2026" },
  ]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body));
  }
});

test("R5: entries can be edited and deleted", { skip }, async () => {
  const created = await post({ ...base, type: "expense", category: "Transport", amount: 300 });
  const id = created.data.id;
  const put = await call(handler, "PUT", `/api/entries?id=${id}`, { ...base, type: "expense", category: "Travel", reserve: "Salary", amount: 350 });
  assert.equal(put.status, 200);
  assert.equal(put.data.category, "Travel");
  assert.equal(put.data.reserve, "Salary");
  assert.equal(put.data.amount, 350);
  assert.equal((await call(handler, "DELETE", `/api/entries?id=${id}`)).status, 200);
  assert.equal((await call(handler, "DELETE", `/api/entries?id=${id}`)).status, 404);
});

test("R4: API works without any password", { skip }, async () => {
  const res = await call(handler, "GET");
  assert.equal(res.status, 200);
  assert.ok(res.data.length >= 4);
});
