import { query, DatabaseConfigError, GENERAL_RESERVE, DEFAULT_ACCOUNT, ACCOUNTS } from "../lib/db.js";
import { send, readBody, text } from "../lib/http.js";
import { SUBCATEGORIES, REIMBURSEMENT, reimbursements } from "../public/ledger.js";

function validate(body) {
  const type = body.type;
  let category = text(body.category);
  let subcategory = text(body.subcategory);
  const description = text(body.description);
  let reserve = text(body.reserve);
  let toReserve = text(body.toReserve);
  const account = text(body.account) || DEFAULT_ACCOUNT;
  let toAccount = text(body.toAccount);
  const amount = Math.round(Number(body.amount) * 100) / 100;
  const date = body.date;

  if (!["income", "expense", "transfer", "contra"].includes(type)) {
    return "Type must be income, expense, transfer or contra";
  }
  if (description.length > 100) return "Note is too long (max 100 characters)";
  if ([category, subcategory, reserve, toReserve, account, toAccount].some((v) => v.length > 40)) {
    return "Names are limited to 40 characters";
  }

  if (!ACCOUNTS.includes(account) || (toAccount && !ACCOUNTS.includes(toAccount))) {
    return "Account must be one of: " + ACCOUNTS.join(", ");
  }

  // Only expense categories with types inside them (Ntorq) take one, and only a known type.
  const allowed = type === "expense" ? SUBCATEGORIES[category] : null;
  if (!allowed) subcategory = "";
  else if (subcategory && !allowed.some((s) => s.name === subcategory)) {
    return "Type must be one of: " + allowed.map((s) => s.name).join(", ");
  }

  if (type === "contra") {
    // Moves money between accounts; the reserve it belongs to stays the same.
    if (!toAccount) return "Choose the account the money goes to";
    if (account === toAccount) return "Choose two different accounts";
    reserve = reserve || GENERAL_RESERVE;
    toReserve = "";
    category = "";
  } else if (type === "transfer") {
    if (!reserve || !toReserve) return "Choose both reserves for the transfer";
    if (reserve === toReserve) return "Choose two different reserves";
    category = "";
    toAccount = "";
  } else {
    toAccount = "";
    if (!category && !description) return "Choose a category";
    toReserve = "";
    // Income pours into the reserve named after its type unless another reserve is chosen;
    // expenses are paid from General Reserve unless another reserve is chosen.
    if (type === "income") reserve = reserve || category || GENERAL_RESERVE;
    else reserve = reserve || GENERAL_RESERVE;
  }

  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e12) return "Amount must be a positive number";
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) {
    return "Date must be in YYYY-MM-DD format";
  }
  // Only a reimbursement is set against expenses: each expense once, a positive amount each, and
  // together no more than the reimbursement (checked against the expenses in checkAllocations).
  let allocations = [];
  if (type === "income" && category === REIMBURSEMENT) {
    const list = body.allocations ?? [];
    if (!Array.isArray(list) || list.length > 500) return "Allocations must be a list";
    const seen = new Set();
    for (const a of list) {
      const expenseId = String(a?.expenseId ?? "");
      const share = Math.round(Number(a?.amount) * 100) / 100;
      if (!/^\d+$/.test(expenseId)) return "Each allocation needs an expense";
      if (!Number.isFinite(share) || share <= 0) return "Each allocation needs a positive amount";
      if (seen.has(expenseId)) return "An expense can only be chosen once";
      seen.add(expenseId);
      allocations.push({ expenseId: Number(expenseId), amount: share });
    }
    const total = Math.round(allocations.reduce((s, a) => s + a.amount, 0) * 100) / 100;
    if (total > amount) return "Allocated more than the reimbursement";
  }
  return { type, category, subcategory, description, reserve, toReserve, account, toAccount, amount, date, allocations };
}

// Every allocated expense must exist and still have that much left to reimburse (other
// reimbursements count; `selfId` is the reimbursement being edited).
async function checkAllocations(entry, selfId = null) {
  if (!entry.allocations.length) return null;
  const { rows } = await query(
    "SELECT id, type, category, amount, allocations, created_at AS \"createdAt\", to_char(entry_date, 'YYYY-MM-DD') AS date FROM entries WHERE type = 'expense' OR (type = 'income' AND category = $1)",
    [REIMBURSEMENT]
  );
  const others = rows.filter((r) => selfId === null || String(r.id) !== String(selfId));
  const { paidBack } = reimbursements(others);
  for (const a of entry.allocations) {
    const expense = others.find((r) => r.type === "expense" && String(r.id) === String(a.expenseId));
    if (!expense) return "An allocated expense no longer exists";
    const left = Math.round((expense.amount - (paidBack.get(String(expense.id)) || 0)) * 100) / 100;
    if (a.amount > left + 0.001) return `Only ${left.toFixed(2)} of that expense is left to reimburse`;
  }
  return null;
}

const SELECT_COLUMNS =
  "id, type, category, subcategory, allocations, description, reserve, to_reserve AS \"toReserve\", account, to_account AS \"toAccount\", amount, created_at AS \"createdAt\", to_char(entry_date, 'YYYY-MM-DD') AS date";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { rows } = await query(
        `SELECT ${SELECT_COLUMNS} FROM entries ORDER BY entry_date DESC, id DESC`
      );
      return send(res, 200, rows);
    }

    if (req.method === "POST") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "Invalid JSON" });
      }
      const entry = validate(body || {});
      if (typeof entry === "string") return send(res, 400, { error: entry });
      const bad = await checkAllocations(entry);
      if (bad) return send(res, 400, { error: bad });

      const { rows } = await query(
        `INSERT INTO entries
           (type, category, description, reserve, to_reserve, account, to_account, amount, entry_date, subcategory, allocations)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${SELECT_COLUMNS}`,
        [entry.type, entry.category, entry.description, entry.reserve, entry.toReserve,
         entry.account, entry.toAccount, entry.amount, entry.date, entry.subcategory, JSON.stringify(entry.allocations)]
      );
      return send(res, 201, rows[0]);
    }

    const id = new URL(req.url, "http://localhost").searchParams.get("id");

    if (req.method === "PUT") {
      if (!/^\d+$/.test(id || "")) return send(res, 400, { error: "Invalid id" });
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "Invalid JSON" });
      }
      const entry = validate(body || {});
      if (typeof entry === "string") return send(res, 400, { error: entry });
      const bad = await checkAllocations(entry, id);
      if (bad) return send(res, 400, { error: bad });

      const { rows } = await query(
        `UPDATE entries
         SET type = $1, category = $2, description = $3, reserve = $4, to_reserve = $5,
             account = $6, to_account = $7, amount = $8, entry_date = $9, subcategory = $10, allocations = $11
         WHERE id = $12
         RETURNING ${SELECT_COLUMNS}`,
        [entry.type, entry.category, entry.description, entry.reserve, entry.toReserve,
         entry.account, entry.toAccount, entry.amount, entry.date, entry.subcategory, JSON.stringify(entry.allocations), id]
      );
      return rows.length ? send(res, 200, rows[0]) : send(res, 404, { error: "Entry not found" });
    }

    if (req.method === "DELETE") {
      if (!/^\d+$/.test(id || "")) return send(res, 400, { error: "Invalid id" });
      const { rowCount } = await query("DELETE FROM entries WHERE id = $1", [id]);
      return rowCount ? send(res, 200, { ok: true }) : send(res, 404, { error: "Entry not found" });
    }

    res.setHeader("Allow", "GET, POST, PUT, DELETE");
    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    if (err instanceof DatabaseConfigError) {
      return send(res, 500, { error: err.message });
    }
    return send(res, 500, { error: "Database error: " + (err.message || err.code || "unknown error") });
  }
}
