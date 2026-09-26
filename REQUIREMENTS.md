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
| R3  | Data is stored in an **open-source database: PostgreSQL**. The table is created automatically, and upgrades never lose existing data (schema changes are additive migrations). Clear error messages when the database is not connected. | `tests/api.test.js` (R3), `tests/migration.test.js`, `tests/migration-previous.test.js` (budgets/plans tables are added alongside existing data) |
| R4  | **No password / login.** The app opens straight to the balance. | `tests/api.test.js` (R4), `tests/e2e/app.test.js` (R4) |
| R5  | Entries are shown as **tappable cards**; tapping one opens an editor to change or delete it. | `tests/api.test.js` (R5), `tests/e2e/app.test.js` (R5) |
| R6  | Adding an entry is a **ride through cards**: first *Income* or *Expense* (or *Transfer* / *Contra*), then a card for the type (category), then the amount, then **Post**. Only the current step is visible. | `tests/e2e/app.test.js` (R6/R7) |
| R7  | Categories — income: Salary, Business, Freelance, Investments, Interest, Rental, Gift, Refund, Other. Expense: Mandatory Food 🍛, Optional Food 🍕, Ntorq (scooter 🛵), Bills & Utilities, Transport, Shopping, Health, Education, Entertainment, Travel, "For Mom, Dad, Muthu", Other. Entries saved with a replaced category (Rent, EMI & Loans, Food & Dining, Groceries) keep their name and icon and can still be edited. | `tests/e2e/app.test.js` (R6/R7, R7, R14/R7, R7/R5) |
| R8  | **Every receipt acts as a reserve (bucket).** Each income type pours into its own reserve (e.g. Salary income every month pours into the Salary reserve). A **General Reserve** always exists. | `tests/ledger.test.js` (R8), `tests/api.test.js` (R8), `tests/e2e/app.test.js` (R8/R9/R10) |
| R9  | An income can be **allotted to another reserve** instead of its own (e.g. an income with no reserve of its own goes to General Reserve), when posting it or later in the editor. | `tests/api.test.js` (R9), `tests/ledger.test.js` (R12), `tests/e2e/app.test.js` (R8/R9/R10, R9) |
| R10 | Expenses are paid from **General Reserve** by default; the owner can choose to apply an expense to another reserve (e.g. Salary). | `tests/api.test.js` (R10), `tests/e2e/app.test.js` (R8/R9/R10) |
| R11 | **Transfer** an amount, or the **whole balance**, from one reserve to another (e.g. Salary → General Reserve). An amount moves within one account (Super Money by default); **Transfer all** moves the reserve's whole balance from every account that holds it, leaving the reserve at exactly zero (never overdrawn, even if it is negative in one account); if it fails halfway, the rest can still be moved. Tapping a reserve card starts a transfer from it. | `tests/api.test.js` (R11), `tests/ledger.test.js` (R11), `tests/e2e/app.test.js` (R11/R12, R11 ×4) |
| R12 | Reserves always **add up to the balance**, and so do accounts; transfers and contra entries never change the balance. | `tests/ledger.test.js` (R12), `tests/e2e/app.test.js` (R11/R12) |
| R13 | Within a reserve, money is used **oldest first (FIFO)**: August salary is only touched after July salary is exhausted. An expense made before money arrives is covered by the next money in. | `tests/ledger.test.js` (R13) |
| R14 | **Report**: "What happened to Salary of August?" — pick a reserve and a month; show the money received that month, **every expense and transfer allotted from it** (with split amounts when an expense drew on two months), and what is left. | `tests/ledger.test.js` (R14), `tests/e2e/app.test.js` (R14/R13) |
| R15 | Works well on a **phone** (touch-sized cards, bottom sheet editor) and supports **dark mode**. | Manual screenshot check |
| R17 | **Accounts**: every income, expense and transfer records the account it went through — **Super Money** (bank), **GPay** (bank) or **Cash**. Account balances are shown as cards. | `tests/api.test.js` (R17/R18), `tests/ledger.test.js` (R18), `tests/e2e/app.test.js` (R17/R18) |
| R18 | **Super Money is the default** account (for payments and receipts); existing entries count as Super Money. | `tests/api.test.js` (R17/R18), `tests/migration.test.js`, `tests/e2e/app.test.js` (R17/R18) |
| R19 | **Contra entries** move money between accounts (e.g. withdraw cash from Super Money). They don't change the balance or any reserve's total; they move one reserve's money (General Reserve by default) to another account. Tapping an account card starts a contra from it; "Move all" moves that reserve's whole amount in the account. | `tests/api.test.js` (R19), `tests/ledger.test.js` (R19), `tests/e2e/app.test.js` (R19) |
| R20 | **Grid report: reserves × accounts** — how much of each reserve is kept in each account, with row totals (= reserve balances), column totals (= account balances) and a grand total (= balance). | `tests/ledger.test.js` (R20), `tests/e2e/app.test.js` (R20) |
| R21 | The **entries list is not on the home page**; a separate **Entries** button (with Reports and Budget buttons) opens it on its own screen, and back returns home (← goes back without adding a history step; changing screen closes any open sheet). | `tests/e2e/app.test.js` (R21 ×2) |
| R22 | The Entries screen has **quick filter buttons** (All time / This month / Last month / Last 7 days / This year; All types / Income / Expenses / Transfers / Contra) and **more filters**: category, reserve, account, date range and search, with a clear-all button (also shown next to the summary whenever a filter is on) and a count / In / Out summary. | `tests/ledger.test.js` (R22), `tests/e2e/app.test.js` (R22) |
| R23 | **Spending report by classification**: expenses grouped by category for a period (this month, last month, this year, all time) with amount, share and entry count; tapping a category opens its entries. Old expenses saved without a category are grouped as **Uncategorised**. | `tests/ledger.test.js` (R23 ×2), `tests/e2e/app.test.js` (R23 ×2) |
| R24 | **Reserve utilisation report**: tap a reserve to see every receipt in it (income or transfer in) with how much is used and left; tap a receipt to see where it went (FIFO, R13). | `tests/ledger.test.js` (R24), `tests/e2e/app.test.js` (R24) |
| R25 | **Budgeting**: a monthly budget per expense category, showing this month's spending against it (left / over). | `tests/ledger.test.js` (R25), `tests/planning-api.test.js` (R25), `tests/e2e/app.test.js` (R25) |
| R26 | **Future cashflows**: record expected income/expenses (one time or every month); **Record** turns one into a real entry (a monthly plan moves to the next month, keeping its day: the 31st stays the 31st after February). A **6-month forecast** couples budgets with planned cashflows: from today's balance, planned income in, and per category the larger of its budget and what is planned (this month: the budget still left). | `tests/ledger.test.js` (R26), `tests/planning-api.test.js` (R26), `tests/e2e/app.test.js` (R26) |
| R27 | **Two food types: Mandatory Food and Optional Food** (replacing Food & Dining and Groceries). Existing data is converted once: every Food & Dining expense and planned payment is split 50:50 into the two types (same date, reserve, account and note; the odd paisa goes to Optional, and an amount of a single paisa goes to Mandatory), Groceries becomes Mandatory Food in full ("groceries are always needed"), and budgets are converted the same way. Totals never change and the conversion never runs twice. From now on food is entered separately. | `tests/migration-food.test.js` (R27), `tests/e2e/app.test.js` (R7) |
| R28 | The Planned section automatically shows, **for each food type, the next 14 days' amount = its average spending per day over the last 30 days × 14**. These lines update by themselves, are not recorded as entries, and count in the forecast day by day (days falling next month count there). | `tests/ledger.test.js` (R28 ×2), `tests/e2e/app.test.js` (R28) |
| R29 | Tapping the **Ntorq** card asks **⛽ Petrol or 🔧 Repair / Accessory** before the amount; the type is saved on the entry (shown as "Ntorq · Petrol", the card keeps its 🛵 logo) and can be changed in the editor. Older Ntorq entries count as **Unclassified**. | `tests/api.test.js` (R29), `tests/ledger.test.js` (R29/R30), `tests/e2e/app.test.js` (R29) |
| R30 | The spending report has a switch: **Ntorq as one line** or **one line per type** (Petrol / Repair / Accessory / Unclassified); tapping a type line opens exactly those entries. | `tests/ledger.test.js` (R29/R30), `tests/e2e/app.test.js` (R30) |
| R16 | A **requirements guardian** keeps every requirement in this file working as new requests are made (see `CLAUDE.md` and `.claude/agents/requirements-guardian.md`; CI runs all tests on every push). | `.github/workflows/test.yml` |

## History

- R1–R2: first version (income/expense entries, balance, Vercel).
- R3: PostgreSQL database. R4: password added, later **removed** at the owner's request.
- R5: entries as tap cards. R6–R7: step-by-step card flow with categories.
- R8, R10–R12: reserves, pay-from reserve, transfers.
- R9, R13, R14, R16: income allotted to other reserves, FIFO, "what happened to my salary" report, requirements guardian.
- R17–R20: accounts (Super Money default, GPay, Cash), contra entries, reserves × accounts grid. R6 and R12 extended for contra/accounts.
- R11 clarified with accounts: a typed amount moves within one account; Transfer all moves the whole reserve from every account. Accounts are limited to the three known ones (R17).
- R7: the "EMI & Loans" expense card was replaced by "For Mom, Dad, Muthu" at the owner's request.
- R7: the "Rent" expense card was replaced by "Ntorq" with a scooter icon at the owner's request.
- R21–R26: entries moved to their own screen with filters; spending-by-category and reserve-utilisation reports; budgets and planned cashflows with a forecast. R5 (entry cards) now lives on the Entries screen.
- R27–R28: food split into Mandatory Food / Optional Food (existing Food & Dining 50:50, Groceries 100% mandatory; entries, plans and budgets), plus automatic 14-day food plans from the last 30 days. R7 category list updated.
- R29–R30: Ntorq asks Petrol or Repair / Accessory (new additive `subcategory` column); spending report switch between Ntorq as one line and per type. Same-day entries are now ordered by when they were first saved, so split food halves stay together (R13).
