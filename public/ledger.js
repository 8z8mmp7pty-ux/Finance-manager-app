// Pure bookkeeping logic shared by the browser app and the tests (no DOM access here).
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
export const DEFAULT_ACCOUNT = "Super Money";
export const ACCOUNTS = ["Super Money", "GPay", "Cash"];

const EPSILON = 0.004;

function round(n) {
  return Math.round(n * 100) / 100;
}

export function chronological(entries) {
  return [...entries].sort((a, b) => a.date.localeCompare(b.date) || Number(a.id) - Number(b.id));
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

// Expenses grouped by category (classification), largest first.
export function spendingByCategory(entries, filters, today) {
  const expenses = filterEntries(entries, { ...filters, type: "expense" }, today);
  const groups = new Map();
  for (const e of expenses) {
    const key = e.category || UNCATEGORISED;
    if (!groups.has(key)) groups.set(key, { category: key, amount: 0, count: 0 });
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

// Automatic food plans: for each food type, its average spending per day over the last 30 days
// (today included), planned for each of the next 14 days (tomorrow onwards).
export function autoFoodPlans(entries, today, { pastDays = 30, nextDays = 14 } = {}) {
  const since = addDays(today, -(pastDays - 1));
  return FOOD_TYPES.map((category) => {
    const spent = entries
      .filter((e) => e.type === "expense" && e.category === category && e.date >= since && e.date <= today)
      .reduce((s, e) => s + e.amount, 0);
    const perDay = round(spent / pastDays);
    const from = addDays(today, 1);
    const to = addDays(today, nextDays);
    return { auto: true, type: "expense", category, perDay, amount: round(perDay * nextDays), from, to, pastDays, nextDays, spent: round(spent) };
  });
}

// Month-by-month forecast from the current balance: planned income in, and for each expense
// category the larger of its budget and what is planned for it (this month: the budget left).
// Automatic food plans count day by day, so days that fall in next month count there.
export function cashflowForecast(entries, budgets, plans, today, months = 6, autoPlans = []) {
  const first = monthOf(today);
  const until = addMonths(monthStart(first), months);
  const spentThisMonth = new Map(spendingByCategory(entries, { period: "this-month" }, today).rows.map((r) => [r.category, r.amount]));
  const budgetOf = new Map(budgets.map((b) => [b.category, b.amount]));

  const planned = new Map(); // month -> { income, expense: Map(category -> amount), items: [] }
  for (const plan of plans) {
    for (const date of planOccurrences(plan, today, until)) {
      const m = monthOf(date);
      if (!planned.has(m)) planned.set(m, { income: 0, expense: new Map(), items: [] });
      const bucket = planned.get(m);
      bucket.items.push({ plan, date });
      if (plan.type === "income") bucket.income = round(bucket.income + plan.amount);
      else bucket.expense.set(plan.category, round((bucket.expense.get(plan.category) || 0) + plan.amount));
    }
  }

  for (const auto of autoPlans) {
    if (!(auto.perDay > 0)) continue;
    for (let date = auto.from; date <= auto.to && date < until; date = addDays(date, 1)) {
      const m = monthOf(date);
      if (!planned.has(m)) planned.set(m, { income: 0, expense: new Map(), items: [] });
      const bucket = planned.get(m);
      bucket.expense.set(auto.category, round((bucket.expense.get(auto.category) || 0) + auto.perDay));
    }
  }

  let balance = totalsOf(entries).net;
  const start = balance;
  const rows = [];
  for (let i = 0; i < months; i++) {
    const m = monthOf(addMonths(monthStart(first), i));
    const bucket = planned.get(m) || { income: 0, expense: new Map(), items: [] };
    const categories = new Set([...budgetOf.keys(), ...bucket.expense.keys()]);
    let out = 0;
    for (const c of categories) {
      const budget = budgetOf.get(c) || 0;
      const budgetDue = i === 0 ? Math.max(0, budget - (spentThisMonth.get(c) || 0)) : budget;
      out += Math.max(budgetDue, bucket.expense.get(c) || 0);
    }
    out = round(out);
    balance = round(balance + bucket.income - out);
    rows.push({ month: m, income: bucket.income, expense: out, balance, items: bucket.items.sort((a, b) => a.date.localeCompare(b.date)) });
  }
  return { start, rows };
}
