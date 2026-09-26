// Small helpers shared by the serverless API functions.

export function send(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}

export async function readBody(req) {
  if (req.body !== undefined) {
    return typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

export function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function parseAmount(value) {
  const amount = Math.round(Number(value) * 100) / 100;
  return Number.isFinite(amount) && amount > 0 && amount < 1e12 ? amount : null;
}

export function isDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !isNaN(Date.parse(value));
}

export function queryParam(req, name) {
  return new URL(req.url, "http://localhost").searchParams.get(name);
}
