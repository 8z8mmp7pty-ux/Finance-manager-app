// Monthly budgets per expense category. GET lists, PUT sets one, DELETE ?category= removes one.
import { query, DatabaseConfigError } from "../lib/db.js";
import { send, readBody, text, parseAmount, queryParam } from "../lib/http.js";

const COLUMNS = "category, amount";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const { rows } = await query(`SELECT ${COLUMNS} FROM budgets ORDER BY category`);
      return send(res, 200, rows);
    }

    if (req.method === "PUT") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        return send(res, 400, { error: "Invalid JSON" });
      }
      const category = text(body?.category);
      const amount = parseAmount(body?.amount);
      if (!category || category.length > 40) return send(res, 400, { error: "Choose a category" });
      if (amount === null) return send(res, 400, { error: "Budget must be a positive amount" });
      const { rows } = await query(
        `INSERT INTO budgets (category, amount) VALUES ($1, $2)
         ON CONFLICT (category) DO UPDATE SET amount = EXCLUDED.amount, updated_at = now()
         RETURNING ${COLUMNS}`,
        [category, amount]
      );
      return send(res, 200, rows[0]);
    }

    if (req.method === "DELETE") {
      const category = text(queryParam(req, "category"));
      if (!category) return send(res, 400, { error: "Choose a category" });
      await query("DELETE FROM budgets WHERE category = $1", [category]);
      return send(res, 200, { ok: true });
    }

    res.setHeader("Allow", "GET, PUT, DELETE");
    return send(res, 405, { error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    if (err instanceof DatabaseConfigError) return send(res, 500, { error: err.message });
    return send(res, 500, { error: "Database error: " + (err.message || err.code || "unknown error") });
  }
}
