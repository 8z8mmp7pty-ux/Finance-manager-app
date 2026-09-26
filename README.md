# Finance Manager

A simple personal finance manager: record income and expense entries and see your current balance.
Entries are stored in a **PostgreSQL** database (open source), so they are available on every device.

- Add entries step by step with tap cards: Income or Expense → category (Salary, Rent, Groceries…) → amount → Post
- See total income, total expenses and current balance
- Reserves (buckets): every income type pours into its own reserve (e.g. Salary Reserve),
  plus a General Reserve. Expenses are paid from General Reserve by default, or from any reserve you pick.
  Transfer an amount (or the whole balance) between reserves. Reserves always add up to the balance.
- Entries shown as tap cards: tap a card to edit or delete it

## Project structure

```
public/          Static frontend (HTML, CSS, JS)
api/entries.js   Serverless API: GET / POST / PUT / DELETE entries
lib/db.js        PostgreSQL connection (creates the `entries` table automatically)
dev-server.js    Local development server
```

## Environment variables

| Variable       | Description                                              |
| -------------- | -------------------------------------------------------- |
| `DATABASE_URL` | PostgreSQL connection string (`POSTGRES_URL` or a prefixed name like `STORAGE_DATABASE_URL` also works) |

## Deploy to Vercel

1. Go to https://vercel.com/new and import this GitHub repository.
   Framework preset: **Other**. Leave build settings empty.
2. Click **Deploy**.
3. Add a free PostgreSQL database: open the project → **Storage** → **Create Database** →
   choose **Neon** (Serverless Postgres) → connect it to this project. This sets `DATABASE_URL` automatically.
   (Or use any other PostgreSQL, e.g. Supabase, and set `DATABASE_URL` yourself.)
4. Go to **Deployments** → **⋯** on the latest deployment → **Redeploy** so it picks up the database.

The `entries` table is created automatically on the first request.

## Run locally

```
npm install
DATABASE_URL=postgres://user:pass@localhost:5432/finance npm run dev
```

Then open http://localhost:3000.

> Note: the app has no login, so anyone with the link can view and edit entries.
