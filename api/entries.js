import { query, DatabaseConfigError } from "../lib/db.js";

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  if (req.body !== undefined) {
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

function validate(body) {
  const type = body.type;
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const amount = Math.round(Number(body.amount) * 100) / 100;
  const date = body.date;

  if (type !== "income" && type !== "expense") return "Type must be income or expense";
  if (!description || description.length > 100) return "Description is required (max 100 characters)";
  if (!Number.isFinite(amount) || amount <= 0 || amount >= 1e12) return "Amount must be a positive number";
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(date))) {
    return "Date must be in YYYY-MM-DD format";
  }
  return { type, description, amount, date };
}

const SELECT_COLUMNS = "id, type, description, amount, to_char(entry_date, 'YYYY-MM-DD') AS date";

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

      const { rows } = await query(
        `INSERT INTO entries (type, description, amount, entry_date)
         VALUES ($1, $2, $3, $4)
         RETURNING ${SELECT_COLUMNS}`,
        [entry.type, entry.description, entry.amount, entry.date]
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

      const { rows } = await query(
        `UPDATE entries SET type = $1, description = $2, amount = $3, entry_date = $4
         WHERE id = $5
         RETURNING ${SELECT_COLUMNS}`,
        [entry.type, entry.description, entry.amount, entry.date, id]
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
