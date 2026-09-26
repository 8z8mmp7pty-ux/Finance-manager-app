import pg from "pg";

// NUMERIC columns come back as strings by default; amounts fit safely in a JS number.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, parseFloat);

export const GENERAL_RESERVE = "General Reserve";
export const DEFAULT_ACCOUNT = "Super Money";
export const ACCOUNTS = ["Super Money", "GPay", "Cash"];

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

export const MANDATORY_FOOD = "Mandatory Food";
export const OPTIONAL_FOOD = "Optional Food";
const FOOD_MIGRATION = "2026-09 split food into mandatory and optional";

// Creates and upgrades the schema. Everything is idempotent, so it is safe to run on every cold start.
export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS entries (
    id          BIGSERIAL PRIMARY KEY,
    type        TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer', 'contra')),
    description TEXT NOT NULL,
    amount      NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    entry_date  DATE NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ALTER TABLE entries ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';
  -- income: the reserve it pours into; expense: the reserve it is paid from;
  -- transfer: the reserve money moves from (to_reserve: where it goes);
  -- contra: the reserve whose money moves between accounts.
  ALTER TABLE entries ADD COLUMN IF NOT EXISTS reserve TEXT NOT NULL DEFAULT '';
  ALTER TABLE entries ADD COLUMN IF NOT EXISTS to_reserve TEXT NOT NULL DEFAULT '';
  -- account: the bank/cash account used (contra: the account money leaves; to_account: where it goes).
  ALTER TABLE entries ADD COLUMN IF NOT EXISTS account TEXT NOT NULL DEFAULT '';
  ALTER TABLE entries ADD COLUMN IF NOT EXISTS to_account TEXT NOT NULL DEFAULT '';
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'entries_type_check'
        AND pg_get_constraintdef(oid) LIKE '%contra%'
    ) THEN
      ALTER TABLE entries DROP CONSTRAINT IF EXISTS entries_type_check;
      ALTER TABLE entries ADD CONSTRAINT entries_type_check
        CHECK (type IN ('income', 'expense', 'transfer', 'contra'));
    END IF;
  END $$;
  UPDATE entries
  SET reserve = CASE WHEN type = 'income' AND category <> '' THEN category ELSE '${GENERAL_RESERVE}' END
  WHERE reserve = '';
  UPDATE entries SET account = '${DEFAULT_ACCOUNT}' WHERE account = '';
  -- Monthly budget per expense category.
  CREATE TABLE IF NOT EXISTS budgets (
    category    TEXT PRIMARY KEY,
    amount      NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- Planned (future) cashflows: one-off, or repeating monthly from next_date.
  CREATE TABLE IF NOT EXISTS plans (
    id          BIGSERIAL PRIMARY KEY,
    type        TEXT NOT NULL CHECK (type IN ('income', 'expense')),
    category    TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    amount      NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
    next_date   DATE NOT NULL,
    repeat      TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'monthly')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  -- Day of the month a monthly plan aims for (so the 31st stays the 31st after February).
  ALTER TABLE plans ADD COLUMN IF NOT EXISTS day INTEGER CHECK (day BETWEEN 1 AND 31);
  UPDATE plans SET day = EXTRACT(DAY FROM next_date) WHERE day IS NULL;
  -- One-time data changes, applied once per database (guarded by a lock + marker row).
  CREATE TABLE IF NOT EXISTS app_migrations (
    name        TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  DO $$
  BEGIN
    PERFORM pg_advisory_xact_lock(727401);
    IF NOT EXISTS (SELECT 1 FROM app_migrations WHERE name = '${FOOD_MIGRATION}') THEN
      -- Food & Dining is split 50:50 into Mandatory Food and Optional Food (the odd paisa goes to
      -- Optional); Groceries is always needed, so it becomes Mandatory Food in full.
      INSERT INTO entries (type, category, description, reserve, to_reserve, account, to_account, amount, entry_date, created_at)
        SELECT type, '${OPTIONAL_FOOD}', description, reserve, to_reserve, account, to_account,
               amount - floor(amount * 50) / 100, entry_date, created_at
        FROM entries WHERE type = 'expense' AND category = 'Food & Dining' AND amount >= 0.02;
      UPDATE entries SET category = '${MANDATORY_FOOD}',
                         amount = CASE WHEN amount >= 0.02 THEN floor(amount * 50) / 100 ELSE amount END
        WHERE type = 'expense' AND category = 'Food & Dining';
      UPDATE entries SET category = '${MANDATORY_FOOD}' WHERE type = 'expense' AND category = 'Groceries';

      INSERT INTO plans (type, category, description, amount, next_date, repeat, day, created_at)
        SELECT type, '${OPTIONAL_FOOD}', description, amount - floor(amount * 50) / 100, next_date, repeat, day, created_at
        FROM plans WHERE type = 'expense' AND category = 'Food & Dining' AND amount >= 0.02;
      UPDATE plans SET category = '${MANDATORY_FOOD}',
                       amount = CASE WHEN amount >= 0.02 THEN floor(amount * 50) / 100 ELSE amount END
        WHERE type = 'expense' AND category = 'Food & Dining';
      UPDATE plans SET category = '${MANDATORY_FOOD}' WHERE type = 'expense' AND category = 'Groceries';

      INSERT INTO budgets (category, amount)
        SELECT '${MANDATORY_FOOD}', sum(CASE WHEN category = 'Groceries' THEN amount ELSE floor(amount * 50) / 100 END)
        FROM budgets WHERE category IN ('Food & Dining', 'Groceries')
        HAVING sum(CASE WHEN category = 'Groceries' THEN amount ELSE floor(amount * 50) / 100 END) > 0
        ON CONFLICT (category) DO UPDATE SET amount = budgets.amount + EXCLUDED.amount, updated_at = now();
      INSERT INTO budgets (category, amount)
        SELECT '${OPTIONAL_FOOD}', sum(amount - floor(amount * 50) / 100)
        FROM budgets WHERE category = 'Food & Dining'
        HAVING sum(amount - floor(amount * 50) / 100) > 0
        ON CONFLICT (category) DO UPDATE SET amount = budgets.amount + EXCLUDED.amount, updated_at = now();
      DELETE FROM budgets WHERE category IN ('Food & Dining', 'Groceries');

      INSERT INTO app_migrations (name) VALUES ('${FOOD_MIGRATION}');
    END IF;
  END $$
`;

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
      .query(SCHEMA_SQL)
      .catch((err) => {
        schemaReady = undefined;
        throw err;
      });
  }
  await schemaReady;
  return db.query(text, params);
}
