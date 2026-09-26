# Requirements

Every request the owner has made for this app, in one place. **All of them must keep working
after every change.** New requests are added here (never silently dropped); if a new request
changes an older one, the older one is updated and the change is noted in its history line.

Each requirement lists the automated tests that prove it. Run them with:

```
npm test                                             # logic + API (API tests need TEST_DATABASE_URL)
TEST_DATABASE_URL=postgres://... npm test            # everything except the browser
TEST_DATABASE_URL=postgres://... npm run test:e2e    # browser tests on a phone-sized screen
```

`TEST_DATABASE_URL` must point at a throwaway database: the tests wipe the `entries` table.

| ID  | Requirement | Verified by |
| --- | ----------- | ----------- |
| R1  | Record **income** and **expense** entries (amount, date, optional note) and show the **current balance** with total income and total expenses. Invalid entries are rejected. Amounts in Indian Rupees, formatted `en-IN` (₹1,00,000.00). | `tests/api.test.js` (R1), `tests/e2e/app.test.js` (R6, R8) |
| R2  | Hosted on **Vercel**: static files in `public/`, serverless API in `api/`, no build step. | Deploy |
| R3  | Data is stored in an **open-source database: PostgreSQL**. The table is created automatically, and upgrades never lose existing data (schema changes are additive migrations). Clear error messages when the database is not connected. | `tests/api.test.js` (R3), `tests/migration.test.js`, `tests/migration-previous.test.js` |
| R4  | **No password / login.** The app opens straight to the balance. | `tests/api.test.js` (R4), `tests/e2e/app.test.js` (R4) |
| R5  | Entries are shown as **tappable cards**; tapping one opens an editor to change or delete it. | `tests/api.test.js` (R5), `tests/e2e/app.test.js` (R5) |
| R6  | Adding an entry is a **ride through cards**: first *Income* or *Expense* (or *Transfer* / *Contra*), then a card for the type (category), then the amount, then **Post**. Only the current step is visible. | `tests/e2e/app.test.js` (R6/R7) |
| R7  | Categories — income: Salary, Business, Freelance, Investments, Interest, Rental, Gift, Refund, Other. Expense: Food & Dining, Groceries, Rent, Bills & Utilities, Transport, Shopping, Health, Education, Entertainment, Travel, EMI & Loans, Other. | `tests/e2e/app.test.js` (R6/R7) |
| R8  | **Every receipt acts as a reserve (bucket).** Each income type pours into its own reserve (e.g. Salary income every month pours into the Salary reserve). A **General Reserve** always exists. | `tests/ledger.test.js` (R8), `tests/api.test.js` (R8), `tests/e2e/app.test.js` (R8/R9/R10) |
| R9  | An income can be **allotted to another reserve** instead of its own (e.g. an income with no reserve of its own goes to General Reserve), when posting it or later in the editor. | `tests/api.test.js` (R9), `tests/ledger.test.js` (R12), `tests/e2e/app.test.js` (R8/R9/R10, R9) |
| R10 | Expenses are paid from **General Reserve** by default; the owner can choose to apply an expense to another reserve (e.g. Salary). | `tests/api.test.js` (R10), `tests/e2e/app.test.js` (R8/R9/R10) |
| R11 | **Transfer** an amount, or the **whole balance**, from one reserve to another (e.g. Salary → General Reserve). An amount moves within one account (Super Money by default); **Transfer all** moves the reserve's whole balance from every account that holds it. Tapping a reserve card starts a transfer from it. | `tests/api.test.js` (R11), `tests/e2e/app.test.js` (R11/R12, R11) |
| R12 | Reserves always **add up to the balance**, and so do accounts; transfers and contra entries never change the balance. | `tests/ledger.test.js` (R12), `tests/e2e/app.test.js` (R11/R12) |
| R13 | Within a reserve, money is used **oldest first (FIFO)**: August salary is only touched after July salary is exhausted. An expense made before money arrives is covered by the next money in. | `tests/ledger.test.js` (R13) |
| R14 | **Report**: "What happened to Salary of August?" — pick a reserve and a month; show the money received that month, **every expense and transfer allotted from it** (with split amounts when an expense drew on two months), and what is left. | `tests/ledger.test.js` (R14), `tests/e2e/app.test.js` (R14/R13) |
| R15 | Works well on a **phone** (touch-sized cards, bottom sheet editor) and supports **dark mode**. | Manual screenshot check |
| R17 | **Accounts**: every income, expense and transfer records the account it went through — **Super Money** (bank), **GPay** (bank) or **Cash**. Account balances are shown as cards. | `tests/api.test.js` (R17/R18), `tests/ledger.test.js` (R18), `tests/e2e/app.test.js` (R17/R18) |
| R18 | **Super Money is the default** account (for payments and receipts); existing entries count as Super Money. | `tests/api.test.js` (R17/R18), `tests/migration.test.js`, `tests/e2e/app.test.js` (R17/R18) |
| R19 | **Contra entries** move money between accounts (e.g. withdraw cash from Super Money). They don't change the balance or any reserve's total; they move one reserve's money (General Reserve by default) to another account. Tapping an account card starts a contra from it; "Move all" moves that reserve's whole amount in the account. | `tests/api.test.js` (R19), `tests/ledger.test.js` (R19), `tests/e2e/app.test.js` (R19) |
| R20 | **Grid report: reserves × accounts** — how much of each reserve is kept in each account, with row totals (= reserve balances), column totals (= account balances) and a grand total (= balance). | `tests/ledger.test.js` (R20), `tests/e2e/app.test.js` (R20) |
| R16 | A **requirements guardian** keeps every requirement in this file working as new requests are made (see `CLAUDE.md` and `.claude/agents/requirements-guardian.md`; CI runs all tests on every push). | `.github/workflows/test.yml` |

## History

- R1–R2: first version (income/expense entries, balance, Vercel).
- R3: PostgreSQL database. R4: password added, later **removed** at the owner's request.
- R5: entries as tap cards. R6–R7: step-by-step card flow with categories.
- R8, R10–R12: reserves, pay-from reserve, transfers.
- R9, R13, R14, R16: income allotted to other reserves, FIFO, "what happened to my salary" report, requirements guardian.
- R17–R20: accounts (Super Money default, GPay, Cash), contra entries, reserves × accounts grid. R6 and R12 extended for contra/accounts.
- R11 clarified with accounts: a typed amount moves within one account; Transfer all moves the whole reserve from every account. Accounts are limited to the three known ones (R17).
