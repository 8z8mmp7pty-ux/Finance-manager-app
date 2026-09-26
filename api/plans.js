// Planned future cashflows (expected income / expenses). GET, POST, PUT ?id=, DELETE ?id=.
import { query, DatabaseConfigError } from "../lib/db.js";
import { send, readBody, text, parseAmount, isDate, queryParam } from "../lib/http.js";

const COLUMNS =
  "id, type, category, description, amount, to_char(next_date, 'YYYY-MM-DD') AS \"nextDate\", repeat";

function validate(body) {
  const type = body.type;
  const category = text(body.category);
  const description = text(body.description);
  const amount = parseAmount(body.amount);
  const nextDate = body.nextDate;
  const repeat = body.repeat || "none";
  if (type !== "income" && type !== "expense") return "Type must be income or expense";
  if (!category || category.length > 40) return "Choose a category";
  if (description.length > 100) return "Note is too long (max 100 characters)";
  if (amount === null) return "Amount must be a positive number";
  if (!isDate(nextDate)) return "Date must be in YYYY-MM-DD format";
  if (repeat !== "none" && repeat !== "monthly") return "Repeat must be none or monthly";
  return { type, category, description, amount, nextDate, repeat };
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { rows } = await query(`SELECT ${COLUMNS} FROM plans ORDER BY next_date, id`);
      return send(res, 200, rows);
    }

    const id = queryParam(req, "id");

    if (req.method === "POST" || req.method === "PUT") {
      if (req.method === "PUT" && !/^\d+$/.test(id || "")) return send(res, 400, { error: "Invalid id" });
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "Invalid JSON" });
      }
      const plan = validate(body || {});
      if (typeof plan === "string") return send(res, 400, { error: plan });
      const values = [plan.type, plan.category, plan.description, plan.amount, plan.nextDate, plan.repeat];
      if (req.method === "POST") {
        const { rows } = await query(
          `INSERT INTO plans (type, category, description, amount, next_date, repeat)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
          values
        );
        return send(res, 201, rows[0]);
      }
      const { rows } = await query(
        `UPDATE plans SET type = $1, category = $2, description = $3, amount = $4, next_date = $5, repeat = $6
         WHERE id = $7 RETURNING ${COLUMNS}`,
        [...values, id]
      );
      return rows.length ? send(res, 200, rows[0]) : send(res, 404, { error: "Plan not found" });
    }

    if (req.method === "DELETE") {
      if (!/^\d+$/.test(id || "")) return send(res, 400, { error: "Invalid id" });
      const { rowCount } = await query("DELETE FROM plans WHERE id = $1", [id]);
      return rowCount ? send(res, 200, { ok: true }) : send(res, 404, { error: "Plan not found" });
    }

    res.setHeader("Allow", "GET, POST, PUT, DELETE");
    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    if (err instanceof DatabaseConfigError) return send(res, 500, { error: err.message });
    return send(res, 500, { error: "Database error: " + (err.message || err.code || "unknown error") });
  }
}
