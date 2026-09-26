// Test helpers: point the app at TEST_DATABASE_URL (never the real DATABASE_URL, since tests wipe data).
import pg from "pg";

export const TEST_DB = process.env.TEST_DATABASE_URL;
export const skip = TEST_DB ? false : "set TEST_DATABASE_URL to run database tests";

if (TEST_DB) {
  process.env.DATABASE_URL = TEST_DB;
  for (const key of Object.keys(process.env)) {
    if (key !== "DATABASE_URL" && /(DATABASE_URL|POSTGRES_URL)$/.test(key) && key !== "TEST_DATABASE_URL") {
      delete process.env[key];
    }
  }
}

export async function raw(sql) {
  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

// Calls the serverless handler the way Vercel does.
export async function call(handler, method, url = "/api/entries", body) {
  const req = { method, url, headers: {}, body };
  let status = 200;
  let payload = "";
  const res = {
    set statusCode(v) { status = v; },
    get statusCode() { return status; },
    setHeader() {},
    end(data) { payload = data; },
  };
  await handler(req, res);
  return { status, data: payload ? JSON.parse(payload) : null };
}
