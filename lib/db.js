import pg from "pg";

// NUMERIC columns come back as strings by default; amounts fit safely in a JS number.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, parseFloat);

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

let pool;
let schemaReady;

export function getPool() {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  if (!pool) {
    const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
    pool = new pg.Pool({
      connectionString,
      max: 1,
      ssl: isLocal ? false : { rejectUnauthorized: false },
    });
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
