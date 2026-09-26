// Pure bookkeeping logic shared by the browser app and the tests (no DOM access here).
//
// Every inflow into a reserve (an income, or a transfer in) is a "lot". Outflows from a
// reserve (expenses, transfers out) use up lots first-in, first-out: August salary is only
// touched after July salary is used up. If a reserve has nothing left, the shortfall is
// covered by the next lot that arrives.

export const GENERAL = "General Reserve";

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
      rows.set(a.entry.id, { entry: a.entry, amount: 0, before: false, otherSources: [], uncovered: 0 });
    }
    const row = rows.get(a.entry.id);
    row.amount = round(row.amount + a.amount);
    row.before = row.before || a.before;
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
    firstUsedOn: items.length ? items[0].date : null,
    exhaustedOn: exhausted ? monthLots.map((l) => l.exhaustedOn).sort().pop() : null,
    hadEarlierMoney: earlierLots.length > 0,
    earlierMoneyLeft: round(earlierLots.reduce((s, l) => s + l.remaining, 0)),
  };
}
