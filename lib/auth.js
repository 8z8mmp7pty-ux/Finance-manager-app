import { timingSafeEqual } from "node:crypto";

// Returns true if the request carries the correct APP_PASSWORD.
export function isAuthorized(req) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) return false;
  const header = req.headers.authorization || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
