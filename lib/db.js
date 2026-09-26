import pg from "pg";

// NUMERIC columns come back as strings by default; amounts fit safely in a JS number.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, parseFloat);

export class DatabaseConfigError extends Error {}

// Finds the connection string. Vercel storage integrations may add a custom prefix
// (e.g. STORAGE_DATABASE_URL), so accept any variable ending in DATABASE_URL / POSTGRES_URL.
function findConnectionString() {
  const env = process.env;
  if (env.DATABASE_URL) return env.DATABASE_URL;
  if (env.POSTGRES_URL) return env.POSTGRES_URL;
  const key = Object.keys(env)
    .sort()
    .find((k) => /_(DATABASE_URL|POSTGRES_URL)$/.test(k) && env[k]);
  return key ? env[key] : undefined;
}

// sslmode in the URL would override our ssl option (and make pg verify the full
// certificate chain, which fails on providers like Supabase), so strip it and set ssl ourselves.
function buildConfig(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new DatabaseConfigError("The database connection string is not a valid URL");
  }
  const sslmode = url.searchParams.get("sslmode");
  for (const param of ["sslmode", "channel_binding", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) {
    url.searchParams.delete(param);
  }
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  const useSsl = sslmode ? sslmode !== "disable" : !isLocal;
  return {
    connectionString: url.toString(),
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    max: 1,
    connectionTimeoutMillis: 10000,
  };
}

let pool;
let schemaReady;

export function getPool() {
  if (!pool) {
    const connectionString = findConnectionString();
    if (!connectionString) {
      throw new DatabaseConfigError(
        "Database is not connected. Set DATABASE_URL (in Vercel: Storage → connect a Postgres database) and redeploy."
      );
    }
    pool = new pg.Pool(buildConfig(connectionString));
    pool.on("error", (err) => console.error("Idle database client error", err));
  }
  return pool;
}

export async function query(text, params) {
  const db = getPool();
  if (!schemaReady) {
    schemaReady = db
      .query(`
        CREATE TABLE IF NOT EXISTS entries (
          id          BIGSERIAL PRIMARY KEY,
          type        TEXT NOT NULL CHECK (type IN ('income', 'expense')),
          description TEXT NOT NULL,
          amount      NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
          entry_date  DATE NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
      `)
      .catch((err) => {
        schemaReady = undefined;
        throw err;
      });
  }
  await schemaReady;
  return db.query(text, params);
}
