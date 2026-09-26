# Finance Manager — instructions for Claude

Personal finance app for the owner (INR). Static frontend in `public/`, Vercel serverless API in
`api/entries.js`, PostgreSQL via `lib/db.js`. FIFO/reserve logic lives in `public/ledger.js`
(pure functions, shared by the browser and the tests).

## Requirements are a contract

`REQUIREMENTS.md` lists every request the owner has made. Treat it as a contract:

1. **Before changing anything**, read `REQUIREMENTS.md`.
2. **When the owner asks for something new**, add it to `REQUIREMENTS.md` as a new `R<n>` row
   (or update the row it changes, and add a line under *History*). Never delete a requirement
   unless the owner explicitly asks for it to be removed.
3. **Add or update tests** for the requirement, labelled with its ID (e.g. `test("R13: ...")`).
   Logic → `tests/ledger.test.js`; API → `tests/api.test.js`; screens → `tests/e2e/app.test.js`.
4. **Before every commit**, run the `requirements-guardian` agent (`.claude/agents/requirements-guardian.md`).
   It runs all tests and checks the change against every requirement. Do not push while it reports a
   violation.

## Running tests

```
npm install
npm test                                              # logic tests (API tests skip without a DB)
TEST_DATABASE_URL=postgres://... npm test             # + API and migration tests
TEST_DATABASE_URL=postgres://... npm run test:e2e     # + browser tests (Playwright Chromium)
```

`TEST_DATABASE_URL` must be a throwaway database — tests drop the `entries` table.
Never point it at the production database. In a cloud session a local PostgreSQL 16 is usually
available at `/usr/lib/postgresql/16/bin` (`initdb` + `pg_ctl` as the `postgres` user).

## Conventions

- Schema changes must be additive migrations inside `lib/db.js` (`ADD COLUMN IF NOT EXISTS`, backfills
  with `WHERE` guards) so the owner's existing data survives (R3).
- Amounts are rounded to paise; format with `Intl.NumberFormat("en-IN", { currency: "INR" })`.
- Keep the UI card-based and phone-first (R5, R6, R15). Check both light and dark mode.
