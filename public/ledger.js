// Pure bookkeeping logic shared by the browser app, the API (api/entries.js imports it) and the
// tests. Keep it free of DOM, browser-only globals and imports, or the serverless API breaks.
//
// Every inflow into a reserve (an income, or a transfer in) is a "lot". Outflows from a
// reserve (expenses, transfers out) use up lots first-in, first-out: August salary is only
// touched after July salary is used up. If a reserve has nothing left, the shortfall is
// covered by the next lot that arrives.

export const GENERAL = "General Reserve";
// Spending-report group (and entries filter value) for old expenses saved without a category.
export const UNCATEGORISED = "Uncategorised";
export const MANDATORY_FOOD = "Mandatory Food";
export const OPTIONAL_FOOD = "Optional Food";
export const FOOD_TYPES = [MANDATORY_FOOD, OPTIONAL_FOOD];
// Expense categories with a finer type inside them, asked for when the card is tapped.
export const SUBCATEGORIES = {
  Ntorq: [
    { name: "Petrol", icon: "⛽" },
    { name: "Repair / Accessory", icon: "🔧" },
  ],
  Transport: [
    { name: "Bus", icon: "🚌" },
    { name: "Auto / Rapido", icon: "🛺" },
    { name: "Train", icon: "🚆" },
  ],
};
// A reimbursement is an income in this category (its reserve has the same name). It can be set
// against specific expenses (`allocations`: [{ expenseId, amount }]): those expenses then cost only
// what was not paid back, and only the rest of the reimbursement goes into its reserve.
export const REIMBURSEMENT = "Reimbursement";
// Spending-report line / filter value for entries of such a category saved without a type.
export const UNCLASSIFIED = "Unclassified";
export const DEFAULT_ACCOUNT = "Super Money";
export const ACCOUNTS = ["Super Money", "GPay", "Cash"];

const EPSILON = 0.004;

function round(n) {
  return Math.round(n * 100) / 100;
}

// Oldest first: by date, then by when the entry was first saved (the two halves of a split
// food entry share that time, so they stay together), then by id.
export function chronological(entries) {
  return [...entries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) ||
      Number(a.id) - Number(b.id)
  );
}

export function isReimbursement(e) {
  return e.type === "income" && e.category === REIMBURSEMENT;
}

// How each reimbursement was set against expenses, oldest reimbursement first. An allocation never
// pays back more than is left of the expense or of the reimbursement; allocations to an expense
// that no longer exists are ignored (that money stays in the reimbursement).
// Returns { paidBack: Map(expenseId -> amount), allocated: Map(reimbursementId -> amount),
// effective: Map(reimbursementId -> [{ expenseId, amount }] as they actually apply) }.
export function reimbursements(entries) {
  const expenses = new Map(entries.filter((e) => e.type === "expense").map((e) => [String(e.id), e]));
  const paidBack = new Map();
  const allocated = new Map();
  const effective = new Map();
  for (const r of chronological(entries.filter(isReimbursement))) {
    let left = r.amount;
    const applied = [];
    effective.set(String(r.id), applied);
    for (const a of r.allocations || []) {
      const id = String(a.expenseId);
      const expense = expenses.get(id);
      if (!expense) continue;
      const amount = round(Math.min(Number(a.amount) || 0, expense.amount - (paidBack.get(id) || 0), left));
      if (amount <= EPSILON) continue;
      paidBack.set(id, round((paidBack.get(id) || 0) + amount));
      left = round(left - amount);
      applied.push({ expenseId: a.expenseId, amount });
    }
    allocated.set(String(r.id), round(r.amount - left));
  }
  return { paidBack, allocated, effective };
}

// The entries as the books see them: an expense counts only what was not reimbursed, and a
// reimbursement only what was not set against expenses (fully covered ones drop out). Balances,
// reserves, reports, budgets and the forecast use these; the Entries list shows the originals.
//
// The money paid back arrives in the reimbursement's account, though: when that is not the account
// the expense was paid from, a contra (expense's account → reimbursement's account, within the
// expense's reserve) keeps every account balance as it really is.
export function netOfReimbursements(entries) {
  const { paidBack, allocated, effective } = reimbursements(entries);
  if (!paidBack.size) return entries;
  const out = [];
  const byId = new Map(entries.map((e) => [String(e.id), e]));
  for (const e of entries) {
    const less = e.type === "expense" ? paidBack.get(String(e.id)) : isReimbursement(e) ? allocated.get(String(e.id)) : 0;
    if (!less) out.push(e);
    else if (e.amount - less > EPSILON) out.push({ ...e, amount: round(e.amount - less) });
    if (!isReimbursement(e)) continue;
    for (const a of effective.get(String(e.id)) || []) {
      const expense = byId.get(String(a.expenseId));
      if (!expense || !e.account || !expense.account || expense.account === e.account) continue;
      out.push({
        id: `reimb-${e.id}-${a.expenseId}`, type: "contra", category: "", subcategory: "", description: "",
        reserve: expense.reserve, toReserve: "", account: expense.account, toAccount: e.account,
        amount: a.amount, date: e.date, createdAt: e.createdAt,
      });
    }
  }
  return out;
}

// What a reimbursement is set against as it actually applies now (expenses deleted or lowered since
// are left out or capped): what the editor saves back, so an edit never fails on old allocations.
export function effectiveAllocations(entries, reimbursementId) {
  return (reimbursements(entries).effective.get(String(reimbursementId)) || []).map((a) => ({ ...a }));
}

// Expenses that still have something left to reimburse, newest first: { entry, left }.
// `except` leaves one reimbursement out (the one being edited).
export function reimbursableExpenses(entries, except = null) {
  const others = except === null ? entries : entries.filter((e) => String(e.id) !== String(except));
  const { paidBack } = reimbursements(others);
  return chronological(others.filter((e) => e.type === "expense"))
    .reverse()
    .map((entry) => ({ entry, left: round(entry.amount - (paidBack.get(String(entry.id)) || 0)) }))
    .filter((x) => x.left > EPSILON);
}

// The reserve the last entered expense was paid from (by when it was saved, not its date), or
// General Reserve when there is none: new expenses default to it.
export function lastExpenseReserve(entries) {
  let last = null;
  for (const e of entries) {
    if (e.type !== "expense" || !e.reserve) continue;
    const key = [String(e.createdAt ?? ""), Number(e.id)];
    if (!last || key[0] > last.key[0] || (key[0] === last.key[0] && key[1] > last.key[1])) last = { key, reserve: e.reserve };
  }
  return last ? last.reserve : GENERAL;
}

export function monthOf(date) {
  return date.slice(0, 7);
}

// Runs every entry through FIFO allocation.
// Returns lots (inflows) and allocations ({ lot, entry, amount, before }) where
// `before` means the money was spent before this lot arrived (a shortfall it covered).
export function allocate(entries) {
  const lots = [];
  const allocations = [];
  const queues = new Map(); // reserve -> lots that still have money, oldest first
  const shortfalls = new Map(); // reserve -> [{ entry, amount }] not yet covered
  const listFor = (map, key) => {
    if (!map.has(key)) map.set(key, []);
    return map.get(key);
  };

  function addLot(entry, reserve, label) {
    const lot = {
      id: entry.id,
      entry,
      reserve,
      date: entry.date,
      amount: entry.amount,
      remaining: entry.amount,
      label,
      exhaustedOn: null,
    };
    lots.push(lot);

    const pending = listFor(shortfalls, reserve);
    while (pending.length && lot.remaining > EPSILON) {
      const s = pending[0];
      const take = round(Math.min(s.amount, lot.remaining));
      allocations.push({ lot, entry: s.entry, amount: take, before: true });
      s.amount = round(s.amount - take);
      lot.remaining = round(lot.remaining - take);
      if (s.amount <= EPSILON) pending.shift();
    }

    if (lot.remaining <= EPSILON) lot.exhaustedOn = lot.date;
    else listFor(queues, reserve).push(lot);
  }

  function spend(entry, reserve) {
    let need = entry.amount;
    const queue = listFor(queues, reserve);
    while (need > EPSILON && queue.length) {
      const lot = queue[0];
      const take = round(Math.min(need, lot.remaining));
      allocations.push({ lot, entry, amount: take, before: false });
      lot.remaining = round(lot.remaining - take);
      need = round(need - take);
      if (lot.remaining <= EPSILON) {
        lot.exhaustedOn = entry.date;
        queue.shift();
      }
    }
    if (need > EPSILON) listFor(shortfalls, reserve).push({ entry, amount: need });
  }

  for (const e of chronological(entries)) {
    if (e.type === "income") {
      addLot(e, e.reserve || GENERAL, e.category || e.description || "Income");
    } else if (e.type === "expense") {
      spend(e, e.reserve || GENERAL);
    } else if (e.type === "transfer") {
      spend(e, e.reserve);
      addLot(e, e.toReserve, "Transfer from " + e.reserve);
    }
  }

  return { lots, allocations };
}

// Balance of every reserve and how much flowed in during the month of `today` (YYYY-MM-DD).
export function reserveBalances(entries, today) {
  const month = monthOf(today);
  const reserves = new Map([[GENERAL, { name: GENERAL, balance: 0, monthIn: 0 }]]);
  const get = (name) => {
    if (!reserves.has(name)) reserves.set(name, { name, balance: 0, monthIn: 0 });
    return reserves.get(name);
  };
  for (const e of entries) {
    const inMonth = monthOf(e.date) === month;
    if (e.type === "income") {
      const r = get(e.reserve || GENERAL);
      r.balance += e.amount;
      if (inMonth) r.monthIn += e.amount;
    } else if (e.type === "expense") {
      get(e.reserve || GENERAL).balance -= e.amount;
    } else if (e.type === "transfer") {
      get(e.reserve).balance -= e.amount;
      const to = get(e.toReserve);
      to.balance += e.amount;
      if (inMonth) to.monthIn += e.amount;
    }
  }
  return [...reserves.values()].map((r) => ({ ...r, balance: round(r.balance), monthIn: round(r.monthIn) }));
}

// Months in which money flowed into `reserve`, newest first.
export function reserveMonths(entries, reserve) {
  const { lots } = allocate(entries);
  const months = new Map();
  for (const lot of lots) {
    if (lot.reserve !== reserve) continue;
    const m = monthOf(lot.date);
    if (!months.has(m)) months.set(m, { month: m, received: 0, remaining: 0 });
    const row = months.get(m);
    row.received = round(row.received + lot.amount);
    row.remaining = round(row.remaining + lot.remaining);
  }
  return [...months.values()].sort((a, b) => b.month.localeCompare(a.month));
}

// "What happened to <reserve> money of <month>?"
// Where a set of lots (money received) went: one row per expense/transfer that used it.
function usageOf(selected, allocations) {
  const inSet = new Set(selected);
  const rows = new Map();
  for (const a of allocations) {
    if (!inSet.has(a.lot)) continue;
    if (!rows.has(a.entry.id)) {
      rows.set(a.entry.id, { entry: a.entry, amount: 0, before: false, otherSources: [], uncovered: 0, usedOn: null });
    }
    const row = rows.get(a.entry.id);
    row.amount = round(row.amount + a.amount);
    row.before = row.before || a.before;
    // Money can't be used before it arrives: an earlier expense is covered on the arrival date.
    const usedOn = a.before ? a.lot.date : a.entry.date;
    if (!row.usedOn || usedOn < row.usedOn) row.usedOn = usedOn;
  }

  // Where the rest of a split expense came from.
  for (const row of rows.values()) {
    const others = new Map();
    let fromLots = 0;
    for (const a of allocations) {
      if (a.entry !== row.entry) continue;
      fromLots = round(fromLots + a.amount);
      if (inSet.has(a.lot)) continue;
      const key = a.lot.reserve + "|" + monthOf(a.lot.date);
      if (!others.has(key)) others.set(key, { reserve: a.lot.reserve, month: monthOf(a.lot.date), amount: 0 });
      others.get(key).amount = round(others.get(key).amount + a.amount);
    }
    row.otherSources = [...others.values()].sort((a, b) => a.month.localeCompare(b.month));
    row.uncovered = round(Math.max(0, row.entry.amount - fromLots));
  }

  const items = chronological([...rows.values()].map((r) => ({ ...r, date: r.entry.date, id: r.entry.id })));
  const received = round(selected.reduce((s, l) => s + l.amount, 0));
  const remaining = round(selected.reduce((s, l) => s + l.remaining, 0));
  const exhausted = selected.length > 0 && remaining <= EPSILON;
  return {
    lots: selected,
    received,
    used: round(received - remaining),
    remaining,
    items,
    firstUsedOn: items.length ? items.map((i) => i.usedOn).sort()[0] : null,
    exhaustedOn: exhausted ? selected.map((l) => l.exhaustedOn).sort().pop() : null,
  };
}

// "What happened to <reserve> money of <month>?"
export function reserveReport(entries, reserve, month) {
  const { lots, allocations } = allocate(entries);
  const monthLots = lots.filter((l) => l.reserve === reserve && monthOf(l.date) === month);
  const earlierLots = lots.filter((l) => l.reserve === reserve && monthOf(l.date) < month);
  return {
    reserve,
    month,
    ...usageOf(monthLots, allocations),
    hadEarlierMoney: earlierLots.length > 0,
    earlierMoneyLeft: round(earlierLots.reduce((s, l) => s + l.remaining, 0)),
  };
}

// Reserve utilisation: every receipt (income or transfer in) of a reserve, newest first,
// with how much of it has been used and what is left.
export function reserveReceipts(entries, reserve) {
  const { lots } = allocate(entries);
  return lots
    .filter((l) => l.reserve === reserve)
    .map((l) => ({ lot: l, id: l.id, date: l.date, label: l.label, amount: l.amount, used: round(l.amount - l.remaining), remaining: l.remaining }))
    .sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));
}

// Where one receipt (the lot created by entry `lotId` in `reserve`) went.
export function receiptReport(entries, reserve, lotId) {
  const { lots, allocations } = allocate(entries);
  const lot = lots.find((l) => l.reserve === reserve && String(l.id) === String(lotId));
  if (!lot) return null;
  const older = lots.filter((l) => l.reserve === reserve && l !== lot && (l.date < lot.date || (l.date === lot.date && Number(l.id) < Number(lot.id))));
  return {
    reserve,
    lot,
    ...usageOf([lot], allocations),
    hadEarlierMoney: older.length > 0,
    earlierMoneyLeft: round(older.reduce((s, l) => s + l.remaining, 0)),
  };
}

// How each entry moves money between (reserve, account) cells.
function movements(e) {
  const account = e.account || DEFAULT_ACCOUNT;
  if (e.type === "income") return [[e.reserve || GENERAL, account, e.amount]];
  if (e.type === "expense") return [[e.reserve || GENERAL, account, -e.amount]];
  if (e.type === "transfer") return [[e.reserve, account, -e.amount], [e.toReserve, account, e.amount]];
  if (e.type === "contra") return [[e.reserve || GENERAL, account, -e.amount], [e.reserve || GENERAL, e.toAccount, e.amount]];
  return [];
}

// Grid of reserves (rows) x accounts (columns). Row totals are reserve balances, column totals
// are account balances, and the grand total is the overall balance.
export function reserveAccountGrid(entries) {
  const cells = new Map();
  const reserves = new Set([GENERAL]);
  const accounts = new Set(ACCOUNTS);
  for (const e of entries) {
    for (const [reserve, account, amount] of movements(e)) {
      reserves.add(reserve);
      accounts.add(account);
      const key = reserve + "|" + account;
      cells.set(key, round((cells.get(key) || 0) + amount));
    }
  }
  const cell = (reserve, account) => cells.get(reserve + "|" + account) || 0;
  const accountList = [...accounts];
  const reserveList = [...reserves];
  const rowTotals = Object.fromEntries(
    reserveList.map((r) => [r, round(accountList.reduce((s, a) => s + cell(r, a), 0))])
  );
  const columnTotals = Object.fromEntries(
    accountList.map((a) => [a, round(reserveList.reduce((s, r) => s + cell(r, a), 0))])
  );
  const total = round(Object.values(columnTotals).reduce((s, v) => s + v, 0));
  return { reserves: reserveList, accounts: accountList, cell, rowTotals, columnTotals, total };
}

// Balance of every account (the default accounts always appear).
export function accountBalances(entries) {
  const grid = reserveAccountGrid(entries);
  return grid.accounts.map((name) => ({ name, balance: grid.columnTotals[name] }));
}

// What "Transfer all" moves out of `reserve`: one part per account, adding up to exactly the
// reserve's balance. Money is only taken from accounts where the reserve has money; if it is
// overdrawn in another account, that shortfall is left behind (taken off the largest parts first),
// so the reserve ends at exactly zero. Nothing moves if the reserve's balance is zero or less.
export function transferAllPlan(entries, reserve) {
  const grid = reserveAccountGrid(entries);
  const total = grid.rowTotals[reserve] || 0;
  if (total <= EPSILON) return [];
  const parts = grid.accounts
    .map((account) => ({ account, amount: grid.cell(reserve, account) }))
    .filter((p) => p.amount > EPSILON)
    .sort((a, b) => b.amount - a.amount);
  let excess = round(parts.reduce((s, p) => s + p.amount, 0) - total);
  for (const p of parts) {
    if (excess <= EPSILON) break;
    const cut = Math.min(p.amount, excess);
    p.amount = round(p.amount - cut);
    excess = round(excess - cut);
  }
  const order = new Map(grid.accounts.map((a, i) => [a, i]));
  return parts.filter((p) => p.amount > EPSILON).sort((a, b) => order.get(a.account) - order.get(b.account));
}

// ---------- Dates ----------

// Adds months to a YYYY-MM-DD date, keeping the day where possible (31 Jan + 1 month = 28/29 Feb).
// `day` overrides the day to aim for, so a monthly date on the 31st returns to the 31st after February.
export function addMonths(date, months, day) {
  const [y, m, dateDay] = date.split("-").map(Number);
  const d = day || dateDay;
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

function monthStart(month) {
  return month + "-01";
}

// ---------- Entries filters ----------

// Date range of a quick period, relative to `today` (YYYY-MM-DD). null = no limit.
export function periodRange(period, today) {
  const month = monthOf(today);
  if (period === "this-month") return { from: monthStart(month), to: addMonths(monthStart(month), 1) };
  if (period === "last-month") {
    const last = monthOf(addMonths(monthStart(month), -1));
    return { from: monthStart(last), to: monthStart(month) };
  }
  if (period === "last-7") {
    const d = new Date(today + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - 6);
    return { from: d.toISOString().slice(0, 10), to: null, toInclusive: today };
  }
  if (period === "this-year") return { from: today.slice(0, 4) + "-01-01", to: String(Number(today.slice(0, 4)) + 1) + "-01-01" };
  return { from: null, to: null };
}

// Filters: { period, type, category, reserve, account, from, to, search }. Empty values match all.
// `from`/`to` are inclusive YYYY-MM-DD dates and apply on top of the period.
export function filterEntries(entries, filters, today) {
  const f = filters || {};
  const range = periodRange(f.period || "all", today);
  const search = (f.search || "").trim().toLowerCase();
  return entries.filter((e) => {
    if (range.from && e.date < range.from) return false;
    if (range.to && e.date >= range.to) return false;
    if (range.toInclusive && e.date > range.toInclusive) return false;
    if (f.from && e.date < f.from) return false;
    if (f.to && e.date > f.to) return false;
    if (f.type && e.type !== f.type) return false;
    if (f.category && (f.category === UNCATEGORISED ? e.category !== "" : e.category !== f.category)) return false;
    if (f.subcategory && (e.subcategory || UNCLASSIFIED) !== f.subcategory) return false;
    if (f.reserve && e.reserve !== f.reserve && e.toReserve !== f.reserve) return false;
    if (f.account && (e.account || DEFAULT_ACCOUNT) !== f.account && e.toAccount !== f.account) return false;
    if (search) {
      const haystack = [e.category, e.description, e.reserve, e.toReserve, e.account, e.toAccount].join(" ").toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

// Totals of a list of entries (transfers and contra entries move money, so they are not counted).
export function totalsOf(entries) {
  let income = 0;
  let expense = 0;
  for (const e of entries) {
    if (e.type === "income") income += e.amount;
    else if (e.type === "expense") expense += e.amount;
  }
  return { income: round(income), expense: round(expense), net: round(income - expense) };
}

// ---------- Spending by category ----------

// Expenses grouped by category (classification), largest first. With `bySubcategory`, categories
// that have types inside them (e.g. Ntorq) get one line per type ("Ntorq · Petrol").
export function spendingByCategory(entries, filters, today, { bySubcategory = false } = {}) {
  const expenses = filterEntries(entries, { ...filters, type: "expense" }, today);
  const groups = new Map();
  for (const e of expenses) {
    const category = e.category || UNCATEGORISED;
    const split = bySubcategory && SUBCATEGORIES[category];
    const subcategory = split ? e.subcategory || UNCLASSIFIED : "";
    const key = split ? `${category} · ${subcategory}` : category;
    if (!groups.has(key)) groups.set(key, { category: key, parent: category, subcategory, amount: 0, count: 0 });
    const g = groups.get(key);
    g.amount = round(g.amount + e.amount);
    g.count += 1;
  }
  const total = round([...groups.values()].reduce((s, g) => s + g.amount, 0));
  const rows = [...groups.values()]
    .map((g) => ({ ...g, share: total ? g.amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
  return { total, rows };
}

// ---------- Budgets and planned cashflows ----------

// Budget vs spending for the month of `today`, one row per budgeted category.
export function budgetStatus(entries, budgets, today) {
  const spent = new Map(spendingByCategory(entries, { period: "this-month" }, today).rows.map((r) => [r.category, r.amount]));
  const rows = budgets
    .map((b) => {
      const used = spent.get(b.category) || 0;
      return { category: b.category, budget: b.amount, spent: used, left: round(b.amount - used), share: b.amount ? used / b.amount : 0 };
    })
    .sort((a, b) => b.share - a.share || a.category.localeCompare(b.category));
  const budget = round(rows.reduce((s, r) => s + r.budget, 0));
  const spentTotal = round(rows.reduce((s, r) => s + r.spent, 0));
  return { rows, budget, spent: spentTotal, left: round(budget - spentTotal) };
}

// Dates on which a plan happens, from its next date up to (not including) `until`.
// Anything overdue counts as due today.
export function planOccurrences(plan, today, until) {
  const dates = [];
  let date = plan.nextDate;
  for (let i = 0; date < until && i < 240; i++) {
    dates.push(date < today ? today : date);
    if (plan.repeat !== "monthly") break;
    date = addMonths(plan.nextDate, i + 1, plan.day);
  }
  return dates;
}

function addDays(date, days) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysInclusive(from, to) {
  return Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000) + 1;
}

function spentOn(entries, category, subcategory, since, today) {
  return entries
    .filter(
      (e) =>
        e.type === "expense" &&
        e.category === category &&
        (subcategory === undefined || e.subcategory === subcategory) &&
        e.date >= since &&
        e.date <= today
    )
    .reduce((s, e) => s + e.amount, 0);
}

// One automatic plan line: `amount` is expected between `from` and `to` (inclusive), worked out from
// the average `rate` per `unit` over the spending since `since`.
function autoLine({ category, subcategory = "", spent, since, from, to, amount, rate, unit, horizon, basis }) {
  return {
    auto: true,
    type: "expense",
    category,
    subcategory,
    spent: round(spent),
    since,
    from,
    to,
    days: daysInclusive(from, to),
    amount: round(amount),
    rate: round(rate),
    unit,
    horizon,
    basis,
  };
}

// The automatic plans: look back over `back` ({ days } or { months }), average per `unit`, and plan
// for the whole forecast (tomorrow → forecastEnd). `subcategory` limits a line to one type (Ntorq).
export const AUTO_RULES = [
  { category: MANDATORY_FOOD, back: { days: 30 }, unit: "day" },
  { category: OPTIONAL_FOOD, back: { days: 30 }, unit: "day" },
  { category: "Ntorq", subcategory: "Petrol", back: { days: 28 }, unit: "week" },
  { category: "Ntorq", subcategory: "Repair / Accessory", back: { months: 3 }, unit: "month" },
  { category: "Transport", back: { months: 3 }, unit: "week" },
  { category: "Bills & Utilities", back: { months: 3 }, unit: "month" },
  { category: "Education", back: { months: 3 }, unit: "month" },
  { category: "Entertainment", back: { months: 3 }, unit: "month" },
];

// "last 30 days", "last 4 weeks", "last 3 months": weeks only for a per-week line.
function periodText(span, prefix, unit) {
  if (span.months) return span.months === 1 ? `${prefix} month` : `${prefix} ${span.months} months`;
  if (unit === "week" && span.days % 7 === 0) return span.days === 7 ? `${prefix} week` : `${prefix} ${span.days / 7} weeks`;
  return `${prefix} ${span.days} days`;
}

function autoLineFor(rule, entries, today) {
  // Look-back window, today included: N days, or from the day after the same date N months ago.
  const since = rule.back.months ? addDays(addMonths(today, -rule.back.months), 1) : addDays(today, -(rule.back.days - 1));
  // Planned for the whole forecast: tomorrow to its last day (today is already in the balance).
  const from = addDays(today, 1);
  const to = forecastEnd(today);
  const spent = spentOn(entries, rule.category, rule.subcategory, since, today);
  const backDays = daysInclusive(since, today);
  // The amount for the days ahead at the same pace: spent × days ahead ÷ days looked back. The rate
  // shown is per day / per week, or for a per-month line the amount per forecast month (so ×3 = amount).
  const amount = (spent * daysInclusive(from, to)) / backDays;
  const rate = rule.unit === "month" ? amount / FORECAST_MONTHS : (spent / backDays) * (rule.unit === "week" ? 7 : 1);
  return autoLine({
    category: rule.category,
    subcategory: rule.subcategory || "",
    spent,
    since,
    from,
    to,
    amount,
    rate,
    unit: rule.unit,
    horizon: `next ${FORECAST_MONTHS} months`,
    basis: periodText(rule.back, "last", rule.unit),
  });
}

// Every automatic plan line, in the order of AUTO_RULES.
export function autoPlans(entries, today) {
  return AUTO_RULES.map((rule) => autoLineFor(rule, entries, today));
}

// Automatic food plans: each food type's average per day over the last 30 days, for the forecast.
export function autoFoodPlans(entries, today) {
  return autoPlans(entries, today)
    .filter((l) => FOOD_TYPES.includes(l.category))
    .map((l) => ({ ...l, perDay: l.rate, pastDays: 30, nextDays: l.days }));
}

// Automatic Ntorq plans: petrol per week over the last 4 weeks; repair / accessory per month over
// the last 3 months; both for the forecast.
export function autoNtorqPlans(entries, today) {
  return autoPlans(entries, today).filter((l) => l.category === "Ntorq");
}

function daysInMonthOf(date) {
  const [y, m] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function lastDayOfMonth(date) {
  return date.slice(0, 8) + String(daysInMonthOf(date)).padStart(2, "0");
}

// How far the forecast looks ahead, and the last day it covers (26 Sep → 25 Dec for 3 months).
export const FORECAST_MONTHS = 3;

export function forecastEnd(today, months = FORECAST_MONTHS) {
  const same = addMonths(today, months);
  // If the target month is shorter (31 Jan → 30 Apr), its last day is already the day before the
  // "same date", so it is the end; otherwise the end is the day before the same date.
  return Number(today.slice(8)) > Number(same.slice(8)) ? same : addDays(same, -1);
}

// The dates a plan falls on within the forecast, in order. A plan that is overdue (possibly for
// several months) counts once, as due today; a monthly plan repeats on its day each month, at most
// `months` times besides that (at a month end the window can reach a 4th day, e.g. 31 Jan → 30 Apr).
export function planDates(plan, today, months = FORECAST_MONTHS) {
  const until = addDays(forecastEnd(today, months), 1);
  // Past dates collapse into one "due today"; a date that really falls on today stays its own.
  const raw = planOccurrences(plan, "", until);
  const ahead = raw.filter((d) => d >= today);
  const dates = plan.repeat === "monthly" ? ahead.slice(0, months) : ahead;
  return raw.length > ahead.length ? [today, ...dates] : dates;
}

// Forecast from today to forecastEnd(today, months), one row per (part of a) calendar month.
// Income: planned income. For each expense category, the larger of
//   (a) its budget for the days of the row — this month: the unspent part spread over the rest of
//       the month; later months: the budget prorated by days (a partial last month gets its share)
//   (b) its planned payments + automatic lines on those days (a plan adds on top of an Auto line).
// Overdue plans count as due today. Every row carries its per-category amounts.
export function cashflowForecast(entries, budgets, plans, today, months = FORECAST_MONTHS, autoLines = []) {
  const end = forecastEnd(today, months);
  const until = addDays(end, 1);
  const spentThisMonth = new Map(spendingByCategory(entries, { period: "this-month" }, today).rows.map((r) => [r.category, r.amount]));
  const budgetOf = new Map(budgets.map((b) => [b.category, b.amount]));

  // Planned amounts by day: income, and expense per category.
  const plannedIn = new Map(); // date -> amount
  const plannedOut = new Map(); // date -> Map(category -> amount)
  const items = []; // plan occurrences
  const addOut = (date, category, amount) => {
    if (!plannedOut.has(date)) plannedOut.set(date, new Map());
    const day = plannedOut.get(date);
    day.set(category, (day.get(category) || 0) + amount);
  };
  for (const plan of plans) {
    const dates = planDates(plan, today, months);
    for (const date of dates) {
      items.push({ plan, date });
      if (plan.type === "income") plannedIn.set(date, (plannedIn.get(date) || 0) + plan.amount);
      else addOut(date, plan.category, plan.amount);
    }
  }
  for (const auto of autoLines) {
    if (!(auto.amount > 0)) continue;
    let k = 0;
    for (let date = auto.from; date <= auto.to; date = addDays(date, 1), k++) {
      // Spread evenly in whole paise: day k gets round(A·(k+1)/n) − round(A·k/n), so the days
      // always add up to the amount shown and no day is negative.
      const share = round(round((auto.amount * (k + 1)) / auto.days) - round((auto.amount * k) / auto.days));
      if (date <= end) addOut(date, auto.category, share);
    }
  }

  let balance = totalsOf(entries).net;
  const start = balance;
  const rows = [];
  for (let from = today; from <= end; from = addDays(lastDayOfMonth(from), 1)) {
    const to = lastDayOfMonth(from) < end ? lastDayOfMonth(from) : end;
    const days = daysInclusive(from, to);
    let income = 0;
    const planned = new Map();
    for (let date = from; date <= to; date = addDays(date, 1)) {
      income += plannedIn.get(date) || 0;
      for (const [c, amount] of plannedOut.get(date) || []) planned.set(c, (planned.get(c) || 0) + amount);
    }
    const categories = [];
    for (const c of new Set([...budgetOf.keys(), ...planned.keys()])) {
      const budget = budgetOf.get(c) || 0;
      const budgetDue =
        monthOf(from) === monthOf(today)
          ? (Math.max(0, budget - (spentThisMonth.get(c) || 0)) * days) / daysInclusive(today, lastDayOfMonth(today))
          : (budget * days) / daysInMonthOf(from);
      const plannedAmount = round(planned.get(c) || 0);
      const out = round(Math.max(round(budgetDue), plannedAmount));
      if (out > 0) categories.push({ category: c, budget: round(budgetDue), planned: plannedAmount, out });
    }
    const expense = round(categories.reduce((s, x) => s + x.out, 0));
    income = round(income);
    balance = round(balance + income - expense);
    rows.push({
      month: monthOf(from),
      from,
      to,
      partial: from !== monthOf(from) + "-01" || to !== lastDayOfMonth(from),
      income,
      expense,
      balance,
      categories: categories.sort((x, y) => y.out - x.out || x.category.localeCompare(y.category)),
      items: items.filter((i) => i.date >= from && i.date <= to).sort((x, y) => x.date.localeCompare(y.date)),
    });
  }
  return { start, end, rows };
}

// ---------- Available to spend ----------

// Available to spend = current balance × (left at the period end ÷ total income of the period),
// where "left" = the period's income − its expected payments: today's money in the same share as the
// income the forecast leaves unspent, so never more than the balance. Other cases:
// - nothing in hand (balance ≤ 0): the balance, or the shortfall if bigger;
// - no income ahead: what the balance keeps after the payments (balance − payments);
// - payments use up all income: nothing free (0), or the shortfall if the balance can't cover them.
export function spendable(balance, income, expected) {
  const surplus = balance + income - expected;
  if (balance <= 0 || income <= 0) return round(Math.min(balance, surplus));
  if (expected >= income) return round(Math.min(0, surplus));
  return round((balance * (income - expected)) / income);
}

// The calculation behind Available to spend, as two small sums for the Budget screen:
// income − payments = left, then balance × share of income left = available. Each step is
// { label, amount } or { label, percent }; `total` marks the result line. `note` explains a case
// where the share can't be used (no income, payments above income, nothing in hand).
export function availableExplanation(a) {
  const left = round(a.income - a.expected);
  const share = a.income > 0 ? Math.round((left / a.income) * 10000) / 100 : null;
  const first = [
    { label: "Income expected", amount: a.income, sign: "+" },
    { label: "Payments expected", amount: a.expected, sign: "−" },
    { label: "Left at period end", amount: left, total: true },
  ];
  const usesShare = a.balance > 0 && a.income > 0 && a.expected < a.income;
  const second = [
    { label: "Balance now", amount: a.balance },
    ...(usesShare ? [{ label: "× Share of income left", percent: share }] : []),
    { label: "Available to spend", amount: a.available, total: true },
  ];
  const note = usesShare
    ? ""
    : a.surplus < 0 && a.surplus < a.balance
      ? "Payments are more than your balance and income together: this is the shortfall."
      : a.balance <= 0
        ? "Nothing in hand yet."
        : a.income <= 0
          ? "No income expected: your balance after the payments."
          : "Payments use up all the income, so nothing is free to spend.";
  return { groups: [first, second], note, closing: a.surplus };
}

// The surplus after every entry in the forecast: current balance + expected income − expected
// payments over the next FORECAST_MONTHS months (= the forecast's closing balance), and what is
// available to spend (spendable: balance × left ÷ income). Also reports the lowest month-end balance, in case money
// runs short before later income arrives.
export function availableToSpend(entries, budgets, plans, today, autoLines = [], months = FORECAST_MONTHS) {
  const f = cashflowForecast(entries, budgets, plans, today, months, autoLines);
  const byCategory = new Map();
  for (const row of f.rows) {
    for (const c of row.categories) {
      if (!byCategory.has(c.category)) byCategory.set(c.category, { category: c.category, out: 0, planned: 0, budget: 0 });
      const t = byCategory.get(c.category);
      t.out += c.out;
      t.planned += c.planned;
      t.budget += c.budget;
    }
  }
  const rows = [...byCategory.values()]
    .map((t) => ({ category: t.category, expected: round(t.out), planned: round(t.planned), budget: round(t.budget) }))
    .sort((a, b) => b.expected - a.expected || a.category.localeCompare(b.category));
  const income = round(f.rows.reduce((s, r) => s + r.income, 0));
  const expected = round(f.rows.reduce((s, r) => s + r.expense, 0));
  const lowest = f.rows.reduce((low, r) => (r.balance < low.balance ? { balance: r.balance, date: r.to } : low), {
    balance: f.start,
    date: today,
  });
  const surplus = f.rows.length ? f.rows[f.rows.length - 1].balance : f.start;
  return {
    balance: f.start,
    income,
    expected,
    surplus,
    available: spendable(f.start, income, expected),
    until: f.end,
    lowest,
    rows,
    forecast: f,
  };
}
