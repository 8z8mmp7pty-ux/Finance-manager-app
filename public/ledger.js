// Pure bookkeeping logic shared by the browser app and the tests (no DOM access here).
//
// Every inflow into a reserve (an income, or a transfer in) is a "lot". Outflows from a
// reserve (expenses, transfers out) use up lots first-in, first-out: August salary is only
// touched after July salary is used up. If a reserve has nothing left, the shortfall is
// covered by the next lot that arrives.

export const GENERAL = "General Reserve";
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
export function reserveReport(entries, reserve, month) {
  const { lots, allocations } = allocate(entries);
  const monthLots = lots.filter((l) => l.reserve === reserve && monthOf(l.date) === month);
  const inMonth = new Set(monthLots);

  // One row per expense/transfer, even if it drew on several lots of this month.
  const rows = new Map();
  for (const a of allocations) {
    if (!inMonth.has(a.lot)) continue;
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
      if (inMonth.has(a.lot)) continue;
      const key = a.lot.reserve + "|" + monthOf(a.lot.date);
      if (!others.has(key)) others.set(key, { reserve: a.lot.reserve, month: monthOf(a.lot.date), amount: 0 });
      others.get(key).amount = round(others.get(key).amount + a.amount);
    }
    row.otherSources = [...others.values()].sort((a, b) => a.month.localeCompare(b.month));
    row.uncovered = round(Math.max(0, row.entry.amount - fromLots));
  }

  const items = chronological([...rows.values()].map((r) => ({ ...r, date: r.entry.date, id: r.entry.id })));
  const received = round(monthLots.reduce((s, l) => s + l.amount, 0));
  const remaining = round(monthLots.reduce((s, l) => s + l.remaining, 0));
  const exhausted = monthLots.length > 0 && remaining <= EPSILON;
  const earlierLots = lots.filter((l) => l.reserve === reserve && monthOf(l.date) < month);

  return {
    reserve,
    month,
    lots: monthLots,
    received,
    used: round(received - remaining),
    remaining,
    items,
    firstUsedOn: items.length ? items.map((i) => i.usedOn).sort()[0] : null,
    exhaustedOn: exhausted ? monthLots.map((l) => l.exhaustedOn).sort().pop() : null,
    hadEarlierMoney: earlierLots.length > 0,
    earlierMoneyLeft: round(earlierLots.reduce((s, l) => s + l.remaining, 0)),
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
