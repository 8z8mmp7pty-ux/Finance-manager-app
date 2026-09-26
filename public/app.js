import {
  GENERAL,
  DEFAULT_ACCOUNT,
  reserveBalances,
  reserveMonths,
  reserveReport,
  reserveAccountGrid,
  accountBalances,
  transferAllPlan,
  ACCOUNTS,
  addMonths,
  filterEntries,
  totalsOf,
  spendingByCategory,
  reserveReceipts,
  receiptReport,
  budgetStatus,
  cashflowForecast,
  availableToSpend,
  forecastEnd,
  FORECAST_MONTHS,
  planDates,
  availableExplanation,
  UNCATEGORISED,
  autoPlans as autoPlanLines,
  SUBCATEGORIES,
  UNCLASSIFIED,
} from "./ledger.js";

const CATEGORIES = {
  income: [
    { name: "Salary", icon: "💼" },
    { name: "Business", icon: "🏪" },
    { name: "Freelance", icon: "💻" },
    { name: "Investments", icon: "📈" },
    { name: "Interest", icon: "🏦" },
    { name: "Rental", icon: "🏠" },
    { name: "Gift", icon: "🎁" },
    { name: "Refund", icon: "↩️" },
    { name: "Other", icon: "➕" },
  ],
  expense: [
    { name: "Mandatory Food", icon: "🍛" },
    { name: "Optional Food", icon: "🍕" },
    { name: "Ntorq", icon: "🛵" },
    { name: "Bills & Utilities", icon: "💡" },
    { name: "Transport", icon: "🚗" },
    { name: "Dress", icon: "👗" },
    { name: "Health", icon: "💊" },
    { name: "Education", icon: "📚" },
    { name: "Entertainment", icon: "🎬" },
    { name: "For Mom, Dad, Muthu", icon: "❤️" },
    { name: "Other", icon: "➖" },
  ],
};

const TYPE_LABEL = { income: "Income", expense: "Expense", transfer: "Transfer", contra: "Contra" };

// Icons for categories that were replaced, so entries saved with them keep their look.
const RETIRED_ICONS = { Rent: "🏠", "EMI & Loans": "💳", "Food & Dining": "🍽️", Groceries: "🛒", Shopping: "🛍️", Travel: "✈️" };

function categoryIcon(type, name) {
  const found = (CATEGORIES[type] || []).find((c) => c.name === name);
  if (found) return found.icon;
  if (type === "expense" && RETIRED_ICONS[name]) return RETIRED_ICONS[name];
  return type === "income" ? "↓" : type === "expense" ? "↑" : "⇄";
}

// "Ntorq · Petrol" for entries with a type inside their category.
function categoryTitle(e) {
  const name = e.category || e.description;
  return e.subcategory ? `${name} · ${e.subcategory}` : name;
}

function subcategoryIcon(category, sub) {
  const found = (SUBCATEGORIES[category] || []).find((s) => s.name === sub);
  return found ? found.icon : categoryIcon("expense", category);
}

function reserveIcon(name) {
  if (name === GENERAL) return "🛡️";
  const found = CATEGORIES.income.find((c) => c.name === name);
  return found ? found.icon : "🪣";
}

const ACCOUNT_ICONS = { "Super Money": "🏦", GPay: "📱", Cash: "💵" };

function accountIcon(name) {
  return ACCOUNT_ICONS[name] || "🏧";
}

function reserveLabel(name) {
  return name === GENERAL ? GENERAL : name + " Reserve";
}

const appSection = document.getElementById("app");
const statusEl = document.getElementById("status");
const list = document.getElementById("entries");
const emptyMsg = document.getElementById("empty");
const balanceEl = document.getElementById("balance");
const reservesEl = document.getElementById("reserves");
const accountsEl = document.getElementById("accounts");

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
// Drops ".00" for whole rupees, for tight spaces (account cards, grid).
const compactCurrency = new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2,
});

let entries = [];
let budgets = []; // [{ category, amount }]
let plans = []; // [{ id, type, category, description, amount, nextDate, repeat }]

// `path` is the API endpoint: entries, budgets or plans.
async function api(method, query = "", body, path = "entries") {
  const res = await fetch("/api/" + path + query, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
  return data;
}

function showStatus(message, isError = true) {
  // While the Add Entry popup is open, its messages show inside it (the page behind is covered).
  const addStatus = document.getElementById("add-status");
  const inPopup = document.getElementById("add-dialog").open;
  // The popup's messages never wipe one shown on the page behind it.
  for (const node of inPopup ? [addStatus] : [statusEl, addStatus]) {
    node.textContent = node === (inPopup ? addStatus : statusEl) ? message || "" : "";
    node.classList.toggle("info", !isError);
    node.hidden = !node.textContent;
  }
}

function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function formatDate(value) {
  return new Date(value + "T00:00:00").toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function parseAmount(value) {
  return Math.round(parseFloat(value) * 100) / 100;
}

function el(tag, className, textContent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

// ---------- Reserves and accounts ----------

// Balance of every reserve (General Reserve first, then income types), plus this month's inflow.
// `skipId` leaves one entry out, so the editor shows balances without the entry being edited.
function computeReserves(skipId = null) {
  const order = [GENERAL, ...CATEGORIES.income.map((c) => c.name)];
  const rank = (name) => (order.includes(name) ? order.indexOf(name) : order.length);
  return reserveBalances(without(skipId), today()).sort(
    (a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name)
  );
}

function without(skipId) {
  return skipId === null ? entries : entries.filter((e) => e.id !== skipId);
}

function computeAccounts(skipId = null) {
  return accountBalances(without(skipId));
}

// Money of one reserve held in one account.
function cellBalance(reserve, account, skipId = null) {
  return reserveAccountGrid(without(skipId)).cell(reserve, account);
}

function reserveBalance(name) {
  const r = computeReserves().find((x) => x.name === name);
  return r ? r.balance : 0;
}

function renderReserves() {
  reservesEl.innerHTML = "";
  for (const r of computeReserves()) {
    const card = el("button", "reserve-card" + (r.name === GENERAL ? " general" : ""));
    card.type = "button";
    card.setAttribute("aria-label", `${reserveLabel(r.name)}: ${currency.format(r.balance)}. Tap to transfer`);
    const top = el("span", "reserve-top");
    top.append(el("span", "reserve-icon", reserveIcon(r.name)), el("span", "reserve-name", reserveLabel(r.name)));
    const bal = el("span", "reserve-balance" + (r.balance < 0 ? " expense" : ""), currency.format(r.balance));
    const month = el("span", "reserve-month", r.monthIn > 0 ? "+" + currency.format(r.monthIn) + " this month" : " ");
    card.append(top, bal, month);
    card.addEventListener("click", () => startTransferFrom(r.name));
    reservesEl.append(card);
  }
}

function renderAccounts() {
  accountsEl.innerHTML = "";
  for (const a of computeAccounts()) {
    const card = el("button", "account-card");
    card.type = "button";
    card.setAttribute("aria-label", `${a.name}: ${currency.format(a.balance)}. Tap for a contra entry`);
    card.append(
      el("span", "account-icon", accountIcon(a.name)),
      el("span", "account-name", a.name),
      el("span", "account-balance" + (a.balance < 0 ? " expense" : ""), compactCurrency.format(a.balance))
    );
    card.addEventListener("click", () => startContraFrom(a.name));
    accountsEl.append(card);
  }
}

function renderChips(container, options, { selected, onSelect, exclude }) {
  container.innerHTML = "";
  for (const o of options) {
    if (o.name === exclude) continue;
    const chip = el("button", "chip");
    chip.type = "button";
    chip.setAttribute("role", "radio");
    chip.setAttribute("aria-checked", String(o.name === selected));
    chip.append(
      el("span", "chip-icon", o.icon),
      el("span", "chip-name", o.name),
      el("span", "chip-amount" + (o.amount < 0 ? " expense" : ""), currency.format(o.amount))
    );
    chip.addEventListener("click", () => onSelect(o.name));
    container.append(chip);
  }
}

// Reserve chips. `first` puts that reserve first, adding it if it has no money yet (e.g. a new
// income type). `amountFor` overrides the amount shown (e.g. the reserve's money in one account).
function renderReserveChips(container, { selected, onSelect, exclude, first, skipId = null, amountFor }) {
  let options = computeReserves(skipId);
  if (first) {
    const existing = options.find((r) => r.name === first) || { name: first, balance: 0 };
    options = [existing, ...options.filter((r) => r.name !== first)];
  }
  renderChips(
    container,
    options.map((r) => ({ name: r.name, icon: reserveIcon(r.name), amount: amountFor ? amountFor(r.name) : r.balance })),
    { selected, onSelect, exclude }
  );
}

function renderAccountChips(container, { selected, onSelect, exclude, skipId = null, amountFor }) {
  renderChips(
    container,
    computeAccounts(skipId).map((a) => ({ name: a.name, icon: accountIcon(a.name), amount: amountFor ? amountFor(a.name) : a.balance })),
    { selected, onSelect, exclude }
  );
}

// ---------- Entries list ----------

function describe(entry) {
  const account = entry.account || DEFAULT_ACCOUNT;
  const accountNote = account !== DEFAULT_ACCOUNT ? account : "";
  if (entry.type === "transfer") {
    return { title: `${entry.reserve} → ${entry.toReserve}`, icon: "⇄", meta: [entry.description, accountNote] };
  }
  if (entry.type === "contra") {
    const reserveNote = entry.reserve && entry.reserve !== GENERAL ? entry.reserve + " money" : "";
    return { title: `${account} → ${entry.toAccount}`, icon: "🔁", meta: [entry.description, reserveNote] };
  }
  const note = entry.category ? entry.description : "";
  const via =
    entry.type === "expense" && entry.reserve && entry.reserve !== GENERAL
      ? "from " + entry.reserve
      : entry.type === "income" && entry.reserve && entry.reserve !== entry.category
      ? "into " + entry.reserve
      : "";
  return {
    title: categoryTitle(entry),
    icon: categoryIcon(entry.type, entry.category), // Ntorq keeps its scooter logo (R7); the type is in the title
    meta: [note, via, accountNote],
  };
}

function entryCard(entry) {
  const li = document.createElement("li");
  const card = el("button", "entry-card " + entry.type);
  card.type = "button";
  const { title, icon: iconText, meta } = describe(entry);
  card.setAttribute("aria-label", `${title}, ${entry.type}, ${currency.format(entry.amount)}. Tap to edit`);

  const icon = el("span", "type-icon", iconText);
  icon.setAttribute("aria-hidden", "true");
  const info = el("div", "entry-info");
  info.append(el("p", "entry-desc", title), el("p", "entry-date", [...meta, formatDate(entry.date)].filter(Boolean).join(" · ")));
  const sign = entry.type === "income" ? "+" : entry.type === "expense" ? "−" : "";
  const amount = el("span", "entry-amount " + entry.type, sign + currency.format(entry.amount));

  card.append(icon, info, amount);
  card.addEventListener("click", () => openEditor(entry));
  li.append(card);
  return li;
}

function monthHeading(month) {
  return new Date(month + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

// The Entries screen: filtered list, grouped by month.
function renderEntriesList() {
  list.innerHTML = "";
  const shown = filterEntries(entries, filters, today());
  let month = null;
  for (const entry of shown) {
    if (entry.date.slice(0, 7) !== month) {
      month = entry.date.slice(0, 7);
      list.append(el("li", "month-heading", monthHeading(month)));
    }
    list.append(entryCard(entry));
  }
  emptyMsg.hidden = shown.length > 0;
  emptyMsg.textContent = entries.length ? "No entries match these filters." : "No entries yet.";
  const t = totalsOf(shown);
  filterSummary.textContent =
    (filters.subcategory ? `${filters.category} · ${filters.subcategory}: ` : "") +
    `${shown.length} ${shown.length === 1 ? "entry" : "entries"}` +
    (t.income ? ` · In ${currency.format(t.income)}` : "") +
    (t.expense ? ` · Out ${currency.format(t.expense)}` : "");
  renderFilterControls();
}

function render() {
  renderEntriesList();

  const balance = totalsOf(entries).net;
  balanceEl.textContent = currency.format(balance);
  balanceEl.className = "balance " + (balance < 0 ? "expense" : "");
  renderAccounts();
  renderReserves();
  renderReport();
  renderBudget();
  renderAvailable();
  refreshTransferAll();
  fitPage();
}

// The + button needs room under the last card only when the page scrolls anyway; a page that fits
// on the screen stays exactly one screen tall, so dragging it does nothing.
const mainEl = document.querySelector("main.container");
function fitPage() {
  const contentBottom = document.getElementById("app").getBoundingClientRect().bottom + window.scrollY;
  const fits = contentBottom <= window.innerHeight;
  mainEl.classList.toggle("fits", fits);
  mainEl.classList.toggle("fab-room", !fits);
}
// #app changes size with the screen; the page's message above it moves it without resizing it.
new ResizeObserver(fitPage).observe(document.getElementById("app"));
new ResizeObserver(fitPage).observe(statusEl);
window.addEventListener("resize", fitPage);

// Keep a "Transfer all" amount in step with the data (e.g. after an entry is edited).
function refreshTransferAll() {
  if (!draft.transferAll || draft.flow !== "transfer") return;
  const total = planTotal(reserveSplit(draft.from));
  draft.transferAll = total > 0;
  amountInput.value = total > 0 ? total.toFixed(2) : "";
  renderAmountChoices();
}

function sortEntries() {
  entries.sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));
}

async function loadEntries() {
  showStatus("Loading…", false);
  try {
    [entries, budgets, plans] = await Promise.all([api("GET"), api("GET", "", null, "budgets"), api("GET", "", null, "plans")]);
    sortEntries();
    appSection.hidden = false;
    showStatus("");
    render();
    if (addFab.hidden) {
      // First load: the + button appears and the Add Entry popup opens straight away.
      addFab.hidden = false;
      openAdd();
    }
  } catch (err) {
    showStatus(err.message);
  }
}

// ---------- Screens ----------

const SCREENS = { home: "Finance Manager", entries: "Entries", reports: "Reports", budget: "Budget & Plans" };
const pageTitle = document.getElementById("page-title");
const navBack = document.getElementById("nav-back");

// The screen comes from the URL hash (#entries, #reports, #budget), so the phone's back button works.
let currentScreen = null; // null until the first screen is shown (e.g. the app opened on #budget)

function showScreen() {
  const name = location.hash.slice(1);
  const screen = SCREENS[name] ? name : "home";
  // An open sheet belongs to the screen being left (e.g. the phone's back button was pressed).
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  cameFromApp = currentScreen !== null && currentScreen !== screen;
  currentScreen = screen;
  for (const key of Object.keys(SCREENS)) {
    document.getElementById("screen-" + key).hidden = key !== screen;
  }
  pageTitle.textContent = SCREENS[screen];
  navBack.hidden = screen === "home";
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", showScreen);
// true when the current screen was reached from another screen of the app, so ← can simply go
// back in history (then the phone's back button leaves the app instead of reopening this screen).
let cameFromApp = false;

navBack.addEventListener("click", (event) => {
  event.preventDefault();
  if (cameFromApp) history.back();
  else location.replace("#");
});

function goTo(screen) {
  location.hash = screen === "home" ? "" : screen;
}

// ---------- Entries screen filters ----------

const filterSummary = document.getElementById("filter-summary");
const EMPTY_FILTERS = { period: "all", type: "", category: "", subcategory: "", reserve: "", account: "", from: "", to: "", search: "" };
const filters = { ...EMPTY_FILTERS };
const filterInputs = {
  category: document.getElementById("f-category"),
  reserve: document.getElementById("f-reserve"),
  account: document.getElementById("f-account"),
  from: document.getElementById("f-from"),
  to: document.getElementById("f-to"),
  search: document.getElementById("f-search"),
};

function fillSelect(select, allLabel, values, selected) {
  const options = [["", allLabel], ...values.map((v) => [v, v])];
  const key = JSON.stringify(options);
  if (select.dataset.options !== key) {
    select.innerHTML = "";
    for (const [value, label] of options) {
      const option = el("option", "", label);
      option.value = value;
      select.append(option);
    }
    select.dataset.options = key;
  }
  select.value = selected;
}

function renderFilterControls() {
  const used = [...new Set(entries.map((e) => e.category).filter(Boolean))];
  const known = [...CATEGORIES.income, ...CATEGORIES.expense].map((c) => c.name);
  const categories = [...new Set([...known, ...used])];
  if (entries.some((e) => !e.category && e.type !== "transfer" && e.type !== "contra")) categories.push(UNCATEGORISED);
  fillSelect(filterInputs.category, "All categories", categories, filters.category);
  fillSelect(filterInputs.reserve, "All reserves", computeReserves().map((r) => r.name), filters.reserve);
  fillSelect(filterInputs.account, "All accounts", ACCOUNTS, filters.account);
  for (const key of ["from", "to", "search"]) {
    if (filterInputs[key].value !== filters[key]) filterInputs[key].value = filters[key];
  }
  document.querySelectorAll("#quick-period .qf").forEach((b) => b.classList.toggle("active", b.dataset.period === filters.period));
  document.querySelectorAll("#quick-type .qf").forEach((b) => b.classList.toggle("active", b.dataset.type === filters.type));
  const extra = ["category", "subcategory", "reserve", "account", "from", "to", "search"].filter((k) => filters[k]).length;
  const count = document.getElementById("filter-count");
  count.hidden = extra === 0;
  count.textContent = String(extra);
  document.getElementById("f-clear-quick").hidden = Object.keys(EMPTY_FILTERS).every((k) => filters[k] === EMPTY_FILTERS[k]);
}

function setFilters(changes) {
  Object.assign(filters, changes);
  renderEntriesList();
}

// Opens the Entries screen with only the given filters applied.
function showEntries(changes) {
  Object.assign(filters, EMPTY_FILTERS, changes);
  renderEntriesList();
  goTo("entries");
}

document.querySelectorAll("#quick-period .qf").forEach((b) =>
  b.addEventListener("click", () => setFilters({ period: b.dataset.period }))
);
document.querySelectorAll("#quick-type .qf").forEach((b) =>
  b.addEventListener("click", () => setFilters({ type: b.dataset.type }))
);
for (const [key, input] of Object.entries(filterInputs)) {
  input.addEventListener(key === "search" ? "input" : "change", () =>
    // Picking another category drops a type filter from inside the old one (e.g. Ntorq · Petrol).
    setFilters(key === "category" ? { category: input.value, subcategory: "" } : { [key]: input.value })
  );
}
document.getElementById("f-clear").addEventListener("click", () => setFilters({ ...EMPTY_FILTERS }));
document.getElementById("f-clear-quick").addEventListener("click", () => setFilters({ ...EMPTY_FILTERS }));

// ---------- Add entry: step-by-step cards ----------

const FLOWS = {
  income: ["type", "category", "amount"],
  expense: ["type", "category", "amount"],
  transfer: ["type", "from", "to", "amount"],
  contra: ["type", "fromAccount", "toAccount", "amount"],
};

// The steps of the current flow: an expense whose card has types inside it (Ntorq) asks for the type.
function flowStages() {
  if (draft.flow === "expense" && SUBCATEGORIES[draft.category]) return ["type", "category", "sub", "amount"];
  return FLOWS[draft.flow];
}

const wizard = document.getElementById("wizard");
const wizardTitle = document.getElementById("wizard-title");
const backBtn = document.getElementById("wizard-back");
const stepsEl = document.getElementById("steps");
const stepPanels = [...wizard.querySelectorAll(".step")];
const pickHint = document.getElementById("pick-hint");
const pickGrid = document.getElementById("pick-grid");
const amountForm = document.getElementById("amount-form");
const amountInput = document.getElementById("amount");
const noteInput = document.getElementById("note");
const dateInput = document.getElementById("date");
const postBtn = document.getElementById("post-btn");
const postedMsg = document.getElementById("posted");
const addDialog = document.getElementById("add-dialog");
const addFab = document.getElementById("add-fab");
const accountGroup = document.getElementById("account-group");
const accountChips = document.getElementById("account-chips");
const payFrom = document.getElementById("pay-from");
const payFromChips = document.getElementById("pay-from-chips");
const transferAvailable = document.getElementById("transfer-available");
const availableText = document.getElementById("available-text");
const moveAllBtn = document.getElementById("transfer-all");

const EMPTY_DRAFT = {
  flow: null, index: 0, category: null, subcategory: "", reserve: GENERAL, from: null, to: null,
  account: DEFAULT_ACCOUNT, fromAccount: null, toAccount: null,
  transferAll: false, // "Transfer all": move the reserve's money out of every account that holds it
};
const draft = { ...EMPTY_DRAFT };
let postedTimer;
let addOpenedOn = null; // the day the Add Entry popup was last opened fresh

function goToStage(stage, direction = "forward") {
  const stages = draft.flow ? flowStages() : ["type", "category", "amount"];
  draft.index = stages.indexOf(stage);
  const panel = stage === "type" ? "type" : stage === "amount" ? "amount" : "pick";
  showStatus(""); // messages belong to the step they were shown on
  if (stage !== "amount" && draft.transferAll) {
    // Leaving the amount step cancels "Transfer all" (the reserves may change).
    draft.transferAll = false;
    amountInput.value = "";
  }

  stepPanels.forEach((p) => {
    const active = p.dataset.step === panel;
    p.hidden = !active;
    p.classList.remove("slide-forward", "slide-back");
    if (active) {
      void p.offsetWidth; // restart the animation
      p.classList.add(direction === "back" ? "slide-back" : "slide-forward");
    }
  });

  stepsEl.innerHTML = "";
  stages.forEach((_, i) => stepsEl.append(el("span", "dot" + (i <= draft.index ? " active" : ""))));
  backBtn.hidden = stage === "type";
  wizard.dataset.type = stage === "type" ? "" : draft.flow;

  if (stage === "type") {
    wizardTitle.textContent = "Add Entry";
  } else if (stage === "category") {
    wizardTitle.textContent = TYPE_LABEL[draft.flow];
    pickHint.textContent = draft.flow === "income" ? "Where did the money come from?" : "What did you spend on?";
    renderPickCards(
      CATEGORIES[draft.flow].map((c) => ({ key: c.name, icon: c.icon, name: c.name })),
      (name) => {
        draft.category = name;
        draft.subcategory = "";
        // Income goes into its own reserve unless you pick another one on the next step.
        if (draft.flow === "income") draft.reserve = name;
        goToStage(flowStages()[draft.index + 1]);
      }
    );
  } else if (stage === "sub") {
    wizardTitle.textContent = draft.category;
    pickHint.textContent = `${draft.category}: what was it for?`;
    renderPickCards(
      SUBCATEGORIES[draft.category].map((s) => ({ key: s.name, icon: s.icon, name: s.name })),
      (name) => {
        draft.subcategory = name;
        goToStage("amount");
      }
    );
  } else if (stage === "from" || stage === "to") {
    wizardTitle.textContent = "Transfer";
    pickHint.textContent =
      stage === "from" ? "Move money out of which reserve?" : `Move from ${draft.from} into which reserve?`;
    const reserves = computeReserves().filter((r) => stage === "from" || r.name !== draft.from);
    renderPickCards(
      reserves.map((r) => ({ key: r.name, icon: reserveIcon(r.name), name: r.name, sub: currency.format(r.balance) })),
      (name) => {
        if (stage === "from") {
          if (draft.to === name) draft.to = null;
          draft.from = name;
          goToStage("to");
        } else {
          draft.to = name;
          goToStage("amount");
        }
      }
    );
  } else if (stage === "fromAccount" || stage === "toAccount") {
    wizardTitle.textContent = "Contra";
    pickHint.textContent =
      stage === "fromAccount" ? "Take money out of which account?" : `Move from ${draft.fromAccount} into which account?`;
    const accounts = computeAccounts().filter((a) => stage === "fromAccount" || a.name !== draft.fromAccount);
    renderPickCards(
      accounts.map((a) => ({ key: a.name, icon: accountIcon(a.name), name: a.name, sub: currency.format(a.balance) })),
      (name) => {
        if (stage === "fromAccount") {
          if (draft.toAccount === name) draft.toAccount = null;
          draft.fromAccount = name;
          goToStage("toAccount");
        } else {
          draft.toAccount = name;
          goToStage("amount");
        }
      }
    );
  } else {
    showAmountStage();
  }
}

function renderPickCards(items, onPick) {
  pickGrid.innerHTML = "";
  for (const item of items) {
    const btn = el("button", "category-card " + draft.flow);
    btn.type = "button";
    const icon = el("span", "category-icon", item.icon);
    icon.setAttribute("aria-hidden", "true");
    btn.append(icon, el("span", "category-name", item.name));
    if (item.sub) btn.append(el("span", "category-sub", item.sub));
    btn.addEventListener("click", () => onPick(item.key));
    pickGrid.append(btn);
  }
}

// "Transfer all": how much to move out of each account so the reserve ends at exactly zero.
function reserveSplit(reserve) {
  return transferAllPlan(entries, reserve);
}

function planTotal(parts) {
  return Math.round(parts.reduce((s, p) => s + p.amount, 0) * 100) / 100;
}

// How much "Transfer all" / "Move all" can move for the current draft.
function draftAvailable() {
  if (draft.flow === "transfer") return cellBalance(draft.from, draft.account);
  if (draft.flow === "contra") return cellBalance(draft.reserve, draft.fromAccount);
  return 0;
}

function showAmountStage() {
  const chosenIcon = document.getElementById("chosen-icon");
  const chosenType = document.getElementById("chosen-type");
  const chosenCategory = document.getElementById("chosen-category");
  const flow = draft.flow;

  wizardTitle.textContent = flow === "transfer" || flow === "contra" ? TYPE_LABEL[flow] : "Amount";
  chosenType.textContent = TYPE_LABEL[flow];
  if (flow === "transfer") {
    chosenIcon.textContent = "⇄";
    chosenCategory.textContent = `${draft.from} → ${draft.to}`;
    postBtn.textContent = "Transfer";
  } else if (flow === "contra") {
    chosenIcon.textContent = "🔁";
    chosenCategory.textContent = `${draft.fromAccount} → ${draft.toAccount}`;
    postBtn.textContent = "Post Contra";
  } else {
    chosenIcon.textContent = draft.subcategory ? subcategoryIcon(draft.category, draft.subcategory) : categoryIcon(flow, draft.category);
    chosenCategory.textContent = categoryTitle({ category: draft.category, subcategory: draft.subcategory });
    postBtn.textContent = "Post " + TYPE_LABEL[flow];
  }

  accountGroup.hidden = flow === "contra";
  payFrom.hidden = flow === "transfer";
  transferAvailable.hidden = flow !== "transfer" && flow !== "contra";
  moveAllBtn.textContent = flow === "contra" ? "Move all" : "Transfer all";
  renderAmountChoices();
  amountInput.focus();
}

function renderAmountChoices() {
  const flow = draft.flow;
  if (flow !== "contra") {
    document.getElementById("account-label").textContent =
      flow === "income" ? "Received in account" : flow === "expense" ? "Paid from account" : "In account";
    renderAccountChips(accountChips, {
      selected: draft.transferAll ? null : draft.account,
      onSelect: (name) => {
        draft.account = name;
        if (draft.transferAll) {
          draft.transferAll = false;
          amountInput.value = "";
        }
        renderAmountChoices();
      },
      amountFor: flow === "transfer" ? (a) => cellBalance(draft.from, a) : undefined,
    });
  }

  if (flow !== "transfer") {
    const label = { income: "Goes into reserve", expense: "Paid from reserve", contra: "Whose money (reserve)" }[flow];
    document.getElementById("pay-from-label").textContent = label;
    renderReserveChips(payFromChips, {
      selected: draft.reserve,
      onSelect: (name) => {
        draft.reserve = name;
        renderAmountChoices();
      },
      first: flow === "income" ? draft.category : GENERAL,
      amountFor: flow === "contra" ? (r) => cellBalance(r, draft.fromAccount) : undefined,
    });
  }

  if (flow === "transfer" && draft.transferAll) {
    const parts = reserveSplit(draft.from).map((p) => `${p.account} ${currency.format(p.amount)}`);
    availableText.textContent = `All of ${draft.from}: ` + (parts.length ? parts.join(" + ") : "nothing to move");
  } else if (flow === "transfer") {
    availableText.textContent = `${draft.from} money in ${draft.account}: ${currency.format(draftAvailable())}`;
  } else if (flow === "contra") {
    availableText.textContent = `${draft.reserve} money in ${draft.fromAccount}: ${currency.format(draftAvailable())}`;
  }
}

function startFlow(flow) {
  // Starting from the type cards always begins a fresh choice (no leftover Ntorq type step).
  Object.assign(draft, { category: null, subcategory: "", from: null, to: null, fromAccount: null, toAccount: null });
  draft.flow = flow;
  draft.reserve = GENERAL;
  draft.account = DEFAULT_ACCOUNT;
  postedMsg.hidden = true;
  goToStage(flowStages()[1]);
}

function startTransferFrom(name) {
  openAdd();
  Object.assign(draft, { flow: "transfer", from: name, to: null, account: DEFAULT_ACCOUNT });
  goToStage("to");
}

function startContraFrom(name) {
  openAdd();
  Object.assign(draft, { flow: "contra", fromAccount: name, toAccount: null, reserve: GENERAL });
  goToStage("toAccount");
}

// ---------- Add Entry popup ----------

// Opens the popup at the first step with a fresh entry.
function openAdd() {
  postedMsg.hidden = true;
  if (!addDialog.open) addDialog.showModal();
  addDialog.focus(); // not the ✕ button (no focus ring on open)
  resetWizard();
}

function closeAdd() {
  if (addDialog.open) addDialog.close();
}

// An entry is ready to post once its amount is typed on the last step.
function entryReady() {
  return !amountForm.hidden && parseAmount(amountInput.value) > 0;
}

addFab.addEventListener("click", openAdd);
document.getElementById("add-close").addEventListener("click", closeAdd);
addDialog.addEventListener("close", () => {
  document.getElementById("add-status").hidden = true;
});

// A tap anywhere outside the sheet closes the popup, or posts the entry first if one is ready (the
// popup stays open if posting fails or is cancelled, so the message can be seen). The dialog fills
// the screen, so "outside" is the dialog itself. A drag from a field inside that ends outside
// does nothing.
let pressedOutside = false;
addDialog.addEventListener("pointerdown", (event) => {
  pressedOutside = event.target === addDialog;
});
addDialog.addEventListener("click", async (event) => {
  // A mouse press outside that is released on the sheet also reports the dialog: check where it landed.
  const r = wizard.getBoundingClientRect();
  const onSheet = event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
  const outside = event.target === addDialog && pressedOutside && !onSheet;
  pressedOutside = false;
  if (!outside || postBtn.disabled) return; // postBtn is disabled while a post is on its way
  if (!entryReady()) return closeAdd();
  if (!(await postDraft()) && addDialog.open && document.getElementById("add-status").hidden) {
    showStatus("Not posted. Tap Post to try again, or ✕ to discard it.");
  }
});

// Opening the app again (coming back to it) also opens the popup, unless a sheet is already open
// or a field on the page is being typed in. A popup left open since an earlier day moves to today.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || appSection.hidden) return;
  if (addDialog.open) {
    if (dateInput.value === addOpenedOn && addOpenedOn !== today()) dateInput.value = addOpenedOn = today();
    return;
  }
  const typing = document.activeElement?.matches?.("input, select, textarea");
  if (!document.querySelector("dialog[open]") && !typing) openAdd();
});

// Reopening from a home-screen shortcut after closing the browser can bring the page back from the
// browser's cache without loading it again: open the popup then too, with a fresh entry.
window.addEventListener("pageshow", (event) => {
  if (event.persisted && !appSection.hidden && !document.querySelector("dialog[open]:not(#add-dialog)")) openAdd();
});

function resetWizard() {
  amountInput.value = "";
  noteInput.value = "";
  dateInput.value = addOpenedOn = today();
  Object.assign(draft, EMPTY_DRAFT);
  goToStage("type", "back");
}

wizard.querySelectorAll(".type-card[data-flow]").forEach((card) => {
  card.addEventListener("click", () => startFlow(card.dataset.flow));
});

backBtn.addEventListener("click", () => {
  const stages = flowStages();
  goToStage(stages[Math.max(0, draft.index - 1)], "back");
});

document.getElementById("chosen").addEventListener("click", () => {
  goToStage(flowStages()[1], "back");
});

moveAllBtn.addEventListener("click", () => {
  if (draft.flow === "transfer") {
    // Move the whole reserve, from every account that holds some of it.
    const total = planTotal(reserveSplit(draft.from));
    draft.transferAll = total > 0;
    amountInput.value = total > 0 ? total.toFixed(2) : "";
    if (!(total > 0)) showStatus(`${draft.from} has nothing to move.`);
    renderAmountChoices();
  } else {
    const available = draftAvailable();
    amountInput.value = available > 0 ? available.toFixed(2) : "";
  }
  amountInput.focus();
});

// Typing an amount by hand means a normal transfer from the selected account.
amountInput.addEventListener("input", () => {
  if (draft.transferAll) {
    draft.transferAll = false;
    renderAmountChoices();
  }
});

amountForm.addEventListener("submit", (event) => {
  event.preventDefault();
  postDraft();
});

// Posts the entry being added. True when it was saved (the popup then closes).
async function postDraft() {
  if (postBtn.disabled) return false; // a post is already on its way (Post, then a tap outside)
  const amount = parseAmount(amountInput.value);
  if (!(amount > 0) || !draft.flow) return false;

  if (draft.flow === "transfer" && draft.transferAll) {
    return postTransferAll();
  }

  let body;
  if (draft.flow === "transfer" || draft.flow === "contra") {
    const isTransfer = draft.flow === "transfer";
    if (isTransfer ? !draft.from || !draft.to : !draft.fromAccount || !draft.toAccount) return false;
    const available = draftAvailable();
    const source = isTransfer ? `${draft.from} in ${draft.account}` : `${draft.reserve} in ${draft.fromAccount}`;
    if (amount > available && !confirm(`${source} only has ${currency.format(available)}. Continue anyway?`)) {
      return false;
    }
    body = isTransfer
      ? { type: "transfer", reserve: draft.from, toReserve: draft.to, account: draft.account }
      : { type: "contra", reserve: draft.reserve, account: draft.fromAccount, toAccount: draft.toAccount };
  } else {
    if (!draft.category) return false;
    body = {
      type: draft.flow,
      category: draft.category,
      subcategory: draft.flow === "expense" ? draft.subcategory : "",
      reserve: draft.reserve,
      account: draft.account,
    };
  }
  Object.assign(body, { description: noteInput.value.trim(), amount, date: dateInput.value || today() });

  postBtn.disabled = true;
  try {
    const created = await api("POST", "", body);
    entries.push(created);
    sortEntries();
    showStatus("");
    render();

    showPosted({
      transfer: () => `✓ Moved ${currency.format(created.amount)} to ${created.toReserve}`,
      contra: () => `✓ Moved ${currency.format(created.amount)} from ${created.account} to ${created.toAccount}`,
      income: () => `✓ Added to ${reserveLabel(created.reserve)} · ${created.account}`,
      expense: () => `✓ ${categoryTitle(created)} paid from ${reserveLabel(created.reserve)} · ${created.account}`,
    }[created.type]());
    return true;
  } catch (err) {
    showStatus(err.message);
    return false;
  } finally {
    postBtn.disabled = false;
  }
}

// After a post: the popup closes and a short confirmation shows over the page.
function showPosted(message) {
  resetWizard(); // while the popup is still open, so the page's own message stays
  closeAdd();
  postedMsg.textContent = message;
  postedMsg.hidden = false;
  clearTimeout(postedTimer);
  postedTimer = setTimeout(() => (postedMsg.hidden = true), 3000);
}

// "Transfer all": one transfer per account that holds some of the reserve's money.
async function postTransferAll() {
  const parts = reserveSplit(draft.from);
  if (!draft.to) return false;
  if (!parts.length) {
    showStatus(`${draft.from} has nothing to move.`);
    return false;
  }
  const total = planTotal(parts);
  const common = { type: "transfer", reserve: draft.from, toReserve: draft.to, description: noteInput.value.trim(), date: dateInput.value || today() };

  postBtn.disabled = true;
  let moved = 0;
  try {
    for (const p of parts) {
      const created = await api("POST", "", { ...common, account: p.account, amount: p.amount });
      entries.push(created);
      moved += created.amount;
    }
    sortEntries();
    showStatus("");
    render();
    const from = parts.length > 1 ? ` (from ${parts.length} accounts)` : "";
    showPosted(`✓ Moved all ${currency.format(moved)} to ${common.toReserve}${from}`);
    return true;
  } catch (err) {
    // Some transfers may have been saved: reload, then show what is left to move.
    const message = err.message;
    await loadEntries();
    const rest = planTotal(reserveSplit(draft.from));
    amountInput.value = rest > 0 ? rest.toFixed(2) : "";
    draft.transferAll = rest > 0;
    renderAmountChoices();
    showStatus(
      moved > 0
        ? `Moved ${currency.format(moved)} of ${currency.format(total)}, then: ${message}. Tap Transfer to move the rest.`
        : message
    );
    return false;
  } finally {
    postBtn.disabled = false;
  }
}

// ---------- Edit sheet ----------

const editDialog = document.getElementById("edit-dialog");
const editForm = document.getElementById("edit-form");
const editTitle = document.getElementById("edit-title");
const editEntryFields = document.getElementById("edit-entry-fields");
const editTransferFields = document.getElementById("edit-transfer-fields");
const editContraFields = document.getElementById("edit-contra-fields");
const editAccountGroup = document.getElementById("edit-account-group");
const editCategories = document.getElementById("edit-categories");
const editAmount = document.getElementById("edit-amount");
const editNote = document.getElementById("edit-note");
const editDate = document.getElementById("edit-date");
const editSave = document.getElementById("edit-save");
const editDelete = document.getElementById("edit-delete");
// kind: "entry" (income/expense), "transfer" or "contra"
const edit = { id: null, kind: "entry", category: "", subcategory: "", reserve: GENERAL, from: "", to: "", account: DEFAULT_ACCOUNT, toAccount: "" };

function renderEditFields() {
  const skipId = edit.id;
  const rerender = (changes) => () => {
    Object.assign(edit, changes());
    renderEditFields();
  };

  if (edit.kind === "contra") {
    renderAccountChips(document.getElementById("edit-from-account-chips"), {
      selected: edit.account,
      skipId,
      onSelect: (name) => {
        edit.account = name;
        if (edit.toAccount === name) edit.toAccount = "";
        renderEditFields();
      },
    });
    renderAccountChips(document.getElementById("edit-to-account-chips"), {
      selected: edit.toAccount,
      skipId,
      exclude: edit.account,
      onSelect: (name) => rerender(() => ({ toAccount: name }))(),
    });
    renderReserveChips(document.getElementById("edit-contra-reserve-chips"), {
      selected: edit.reserve,
      skipId,
      first: GENERAL,
      amountFor: (r) => cellBalance(r, edit.account, skipId),
      onSelect: (name) => rerender(() => ({ reserve: name }))(),
    });
    return;
  }

  document.getElementById("edit-account-label").textContent =
    edit.kind === "transfer" ? "In account" : editForm.elements.type.value === "income" ? "Received in account" : "Paid from account";
  renderAccountChips(document.getElementById("edit-account-chips"), {
    selected: edit.account,
    skipId,
    onSelect: (name) => rerender(() => ({ account: name }))(),
  });

  if (edit.kind === "transfer") {
    renderReserveChips(document.getElementById("edit-from-chips"), {
      selected: edit.from,
      skipId,
      amountFor: (r) => cellBalance(r, edit.account, skipId),
      onSelect: (name) => rerender(() => ({ from: name, to: edit.to === name ? "" : edit.to }))(),
    });
    renderReserveChips(document.getElementById("edit-to-chips"), {
      selected: edit.to,
      skipId,
      amountFor: (r) => cellBalance(r, edit.account, skipId),
      exclude: edit.from,
      onSelect: (name) => rerender(() => ({ to: name }))(),
    });
    return;
  }

  const type = editForm.elements.type.value;
  editCategories.innerHTML = "";
  // An entry saved with a category that no longer has a card (e.g. "Rent") shows it as an
  // extra, selected card so it is clear what the entry is; picking another card replaces it.
  const cards = [...CATEGORIES[type]];
  if (edit.category && !cards.some((c) => c.name === edit.category)) {
    cards.unshift({ name: edit.category, icon: categoryIcon(type, edit.category) });
  }
  for (const cat of cards) {
    const btn = el("button", "category-card " + type);
    btn.type = "button";
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(cat.name === edit.category));
    const icon = el("span", "category-icon", cat.icon);
    icon.setAttribute("aria-hidden", "true");
    btn.append(icon, el("span", "category-name", cat.name));
    btn.addEventListener("click", () => {
      // An income that was in its own type's reserve follows the new type.
      if (type === "income" && edit.reserve === (edit.category || GENERAL)) edit.reserve = cat.name;
      if (edit.category !== cat.name) edit.subcategory = "";
      edit.category = cat.name;
      renderEditFields();
    });
    editCategories.append(btn);
  }

  // Type inside the category (e.g. Ntorq: Petrol or Repair / Accessory).
  const subs = type === "expense" ? SUBCATEGORIES[edit.category] : null;
  const subGroup = document.getElementById("edit-sub-group");
  subGroup.hidden = !subs;
  if (subs) {
    document.getElementById("edit-sub-label").textContent = `${edit.category} type`;
    const chips = document.getElementById("edit-sub-chips");
    chips.innerHTML = "";
    for (const sub of subs) {
      const chip = el("button", "chip");
      chip.type = "button";
      chip.setAttribute("role", "radio");
      chip.setAttribute("aria-checked", String(sub.name === edit.subcategory));
      chip.append(el("span", "chip-icon", sub.icon), el("span", "chip-name", sub.name));
      chip.addEventListener("click", () => {
        edit.subcategory = sub.name;
        renderEditFields();
      });
      chips.append(chip);
    }
  } else {
    edit.subcategory = "";
  }

  document.getElementById("edit-pay-from-label").textContent =
    type === "income" ? "Goes into reserve" : "Paid from reserve";
  renderReserveChips(document.getElementById("edit-pay-from-chips"), {
    selected: edit.reserve,
    skipId,
    first: type === "income" ? edit.category || GENERAL : GENERAL,
    onSelect: (name) => rerender(() => ({ reserve: name }))(),
  });
}

function openEditor(entry) {
  const kind = entry.type === "transfer" || entry.type === "contra" ? entry.type : "entry";
  Object.assign(edit, {
    id: entry.id,
    kind,
    category: entry.category,
    subcategory: entry.subcategory || "",
    reserve: kind === "transfer" ? GENERAL : entry.reserve || entry.category || GENERAL,
    from: kind === "transfer" ? entry.reserve : "",
    to: kind === "transfer" ? entry.toReserve : "",
    account: entry.account || DEFAULT_ACCOUNT,
    toAccount: entry.toAccount || "",
  });
  editTitle.textContent = { entry: "Edit Entry", transfer: "Edit Transfer", contra: "Edit Contra" }[kind];
  editEntryFields.hidden = kind !== "entry";
  editTransferFields.hidden = kind !== "transfer";
  editContraFields.hidden = kind !== "contra";
  editAccountGroup.hidden = kind === "contra";
  if (kind === "entry") editForm.elements.type.value = entry.type;
  // Older entries without a category keep their text as the note.
  editNote.value = entry.description;
  editAmount.value = entry.amount;
  editDate.value = entry.date;
  editSave.disabled = false;
  editDelete.disabled = false;
  renderEditFields();
  editDialog.showModal();
}

function closeEditor() {
  edit.id = null;
  editDialog.close();
}

editForm.querySelectorAll("input[name=type]").forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!CATEGORIES[radio.value].some((c) => c.name === edit.category)) edit.category = "";
    edit.reserve = radio.value === "income" ? edit.category || GENERAL : GENERAL;
    renderEditFields();
  });
});

document.getElementById("edit-close").addEventListener("click", closeEditor);

// Tap outside the sheet to close it.
editDialog.addEventListener("click", (event) => {
  if (event.target === editDialog) closeEditor();
});

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = parseAmount(editAmount.value);
  const note = editNote.value.trim();
  if (!(amount > 0) || edit.id === null) return;

  let body;
  if (edit.kind === "transfer") {
    if (!edit.from || !edit.to) {
      alert("Choose both reserves");
      return;
    }
    body = { type: "transfer", reserve: edit.from, toReserve: edit.to, account: edit.account };
  } else if (edit.kind === "contra") {
    if (!edit.account || !edit.toAccount) {
      alert("Choose both accounts");
      return;
    }
    body = { type: "contra", reserve: edit.reserve, account: edit.account, toAccount: edit.toAccount };
  } else {
    if (!edit.category && !note) {
      alert("Choose a category");
      return;
    }
    const type = editForm.elements.type.value;
    body = { type, category: edit.category, subcategory: edit.subcategory, reserve: edit.reserve, account: edit.account };
  }
  Object.assign(body, { description: note, amount, date: editDate.value });

  editSave.disabled = true;
  try {
    const updated = await api("PUT", "?id=" + encodeURIComponent(edit.id), body);
    entries = entries.map((e) => (e.id === updated.id ? updated : e));
    sortEntries();
    showStatus("");
    render();
    closeEditor();
  } catch (err) {
    editSave.disabled = false;
    closeEditor();
    showStatus(err.message);
  }
});

editDelete.addEventListener("click", async () => {
  const entry = entries.find((e) => e.id === edit.id);
  if (!entry) return;
  const name =
    entry.type === "transfer" ? "this transfer" : entry.type === "contra" ? "this contra entry" : `"${entry.category || entry.description}"`;
  if (!confirm(`Delete ${name}?`)) return;

  editDelete.disabled = true;
  try {
    await api("DELETE", "?id=" + encodeURIComponent(entry.id));
    entries = entries.filter((e) => e.id !== entry.id);
    showStatus("");
    render();
    closeEditor();
  } catch (err) {
    editDelete.disabled = false;
    closeEditor();
    showStatus(err.message);
  }
});

// ---------- Report: what happened to a month's money? ----------

const reportBody = document.getElementById("report-body");
const reportTitle = document.getElementById("report-title");
const reportBack = document.getElementById("report-back");
const report = { stage: "menu", reserve: null, month: null, lotId: null, period: "this-month", bySubcategory: false };

function monthLabel(month) {
  return new Date(month + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function moneyName(reserve, month) {
  return reserve === GENERAL ? `${GENERAL} money of ${monthLabel(month)}` : `${reserve} of ${monthLabel(month)}`;
}

function showReportStage(stage) {
  report.stage = stage;
  renderReport();
}

const REPORT_BACK = {
  spending: "menu",
  grid: "menu",
  "util-reserve": "menu",
  receipts: "util-reserve",
  receipt: "receipts",
  reserve: "menu",
  month: "reserve",
  view: "month",
};

function renderReport() {
  reportBody.innerHTML = "";
  reportBack.hidden = report.stage === "menu";
  const stages = {
    menu: renderReportMenu,
    spending: renderSpending,
    grid: () => {
      reportTitle.textContent = "Reserves × Accounts";
      renderGrid();
    },
    "util-reserve": () => renderReservePick("Reserve utilisation", "Pick a reserve to see how its receipts were used.", "receipts"),
    receipts: renderReceipts,
    receipt: renderReceipt,
    reserve: () => renderReservePick("A month's money", "What happened to my money? Pick a reserve.", "month"),
    month: renderMonthPick,
    view: renderMonthView,
  };
  (stages[report.stage] || renderReportMenu)();
}

function reportMenuCard(icon, name, sub, stage) {
  const card = el("button", "type-card wide report-card");
  card.type = "button";
  card.dataset.report = stage;
  const i = el("span", "type-icon", icon);
  i.setAttribute("aria-hidden", "true");
  const t = el("span", "type-text");
  t.append(el("span", "type-name", name), el("span", "type-sub", sub));
  card.append(i, t);
  card.addEventListener("click", () => showReportStage(stage));
  return card;
}

function renderReportMenu() {
  report.stage = "menu";
  reportBack.hidden = true;
  reportTitle.textContent = "Choose a report";
  reportBody.append(
    reportMenuCard("🧾", "Spending by category", "Where your money goes, by classification", "spending"),
    reportMenuCard("🪣", "Reserve utilisation", "Every receipt in a reserve: how much is used and left", "util-reserve"),
    reportMenuCard("📅", "A month's money", "What happened to Salary of August?", "reserve"),
    reportMenuCard("▦", "Reserves × Accounts", "Where each reserve's money is kept", "grid")
  );
}

function renderReservePick(title, hint, next) {
  reportTitle.textContent = title;
  reportBody.append(el("p", "step-hint", hint));
  const grid = el("div", "category-grid");
  for (const r of computeReserves()) {
    if (!reserveMonths(entries, r.name).length) continue;
    const btn = el("button", "category-card report-pick");
    btn.type = "button";
    btn.append(
      el("span", "category-icon", reserveIcon(r.name)),
      el("span", "category-name", r.name),
      el("span", "category-sub", currency.format(r.balance))
    );
    btn.addEventListener("click", () => {
      report.reserve = r.name;
      showReportStage(next);
    });
    grid.append(btn);
  }
  if (!grid.children.length) reportBody.append(el("p", "empty", "Add some income to see reports."));
  else reportBody.append(grid);
}

const SPENDING_PERIODS = [
  ["this-month", "This month"],
  ["last-month", "Last month"],
  ["this-year", "This year"],
  ["all", "All time"],
];

function usageBar(share, over = false) {
  const bar = el("div", "usage-bar small");
  const fill = el("span", "usage-fill" + (over ? " over" : ""));
  fill.style.width = Math.min(100, Math.max(0, share * 100)) + "%";
  bar.append(fill);
  return bar;
}

function renderSpending() {
  reportTitle.textContent = "Spending by category";
  const chips = el("div", "quick-filters");
  for (const [period, label] of SPENDING_PERIODS) {
    const b = el("button", "qf" + (report.period === period ? " active" : ""), label);
    b.type = "button";
    b.dataset.period = period;
    b.addEventListener("click", () => {
      report.period = period;
      renderReport();
    });
    chips.append(b);
  }
  reportBody.append(chips);

  // Categories with types inside them (Ntorq): one line, or one line per type.
  const split = el("div", "quick-filters split-switch");
  split.append(el("span", "switch-label", "Ntorq as"));
  for (const [value, label] of [[false, "One line"], [true, "Petrol / Repair"]]) {
    const b = el("button", "qf" + (report.bySubcategory === value ? " active" : ""), label);
    b.type = "button";
    b.dataset.split = String(value);
    b.addEventListener("click", () => {
      report.bySubcategory = value;
      renderReport();
    });
    split.append(b);
  }
  reportBody.append(split);
  if (report.bySubcategory && report.period === "this-month") {
    const parentBudgets = budgets.filter((b) => SUBCATEGORIES[b.category]);
    for (const b of parentBudgets) {
      reportBody.append(el("p", "step-hint", `${b.category} budget this month: ${currency.format(b.amount)} (for all its types together)`));
    }
  }

  const { total, rows } = spendingByCategory(entries, { period: report.period }, today(), { bySubcategory: report.bySubcategory });
  const budgetOf = new Map(budgets.map((b) => [b.category, b.amount]));
  const tile = el("div", "report-tile spend-total");
  tile.append(el("span", "label", "Total spent"), el("span", "tile-value expense", currency.format(total)));
  reportBody.append(tile);
  if (!rows.length) {
    reportBody.append(el("p", "empty", "No expenses in this period."));
    return;
  }
  reportBody.append(el("p", "step-hint", "Tap a category to see its entries."));
  const listEl = el("ul", "report-list");
  for (const row of rows) {
    const li = el("li");
    const btn = el("button", "report-row spend-row");
    btn.type = "button";
    const info = el("div", "entry-info");
    const pct = row.share > 0 && row.share < 0.005 ? "<1%" : Math.round(row.share * 100) + "%";
    const details = [`${row.count} ${row.count === 1 ? "entry" : "entries"}`, pct];
    const budget = budgetOf.get(row.category);
    if (budget && report.period === "this-month") details.push(`budget ${currency.format(budget)}`);
    info.append(el("p", "entry-desc", row.category), el("p", "entry-date", details.join(" · ")), usageBar(row.share));
    const icon = row.subcategory ? subcategoryIcon(row.parent, row.subcategory) : categoryIcon("expense", row.category);
    btn.append(el("span", "row-icon", icon), info, el("span", "entry-amount expense", currency.format(row.amount)));
    btn.addEventListener("click", () =>
      showEntries({ period: report.period, type: "expense", category: row.parent, subcategory: row.subcategory })
    );
    li.append(btn);
    listEl.append(li);
  }
  reportBody.append(listEl);
}

function renderReceipts() {
  const receipts = reserveReceipts(entries, report.reserve);
  if (!receipts.length) return showReportStage("util-reserve");
  reportTitle.textContent = report.reserve;
  const received = receipts.reduce((s, r) => s + r.amount, 0);
  const used = receipts.reduce((s, r) => s + r.used, 0);
  reportBody.append(summaryTiles(received, used, received - used));
  reportBody.append(el("p", "step-hint", "Every receipt in this reserve, newest first. The oldest money is used first. Tap one to see where it went."));
  const listEl = el("ul", "report-list");
  for (const r of receipts) {
    const li = el("li");
    const btn = el("button", "report-row receipt-row");
    btn.type = "button";
    const info = el("div", "entry-info");
    const status = r.remaining <= 0.004 ? "Fully used" : r.used > 0 ? `${currency.format(r.used)} used · ${currency.format(r.remaining)} left` : "Not used yet";
    info.append(el("p", "entry-desc", `${r.label} · ${formatDate(r.date)}`), el("p", "entry-date", status), usageBar(r.amount ? r.used / r.amount : 0));
    const icon = r.lot.entry.type === "transfer" ? "⇄" : categoryIcon("income", r.lot.entry.category);
    btn.append(el("span", "row-icon", icon), info, el("span", "entry-amount income", "+" + currency.format(r.amount)));
    btn.addEventListener("click", () => {
      report.lotId = r.id;
      showReportStage("receipt");
    });
    li.append(btn);
    listEl.append(li);
  }
  reportBody.append(listEl);
}

function renderReceipt() {
  const r = receiptReport(entries, report.reserve, report.lotId);
  if (!r) return showReportStage("receipts");
  reportTitle.textContent = "Receipt";
  renderUsage(r, `Where did ${r.lot.label} of ${formatDate(r.lot.date)} go?`);
}

function renderMonthPick() {
  reportTitle.textContent = report.reserve;
  reportBody.append(el("p", "step-hint", "Which month's money?"));
  const grid = el("div", "category-grid");
  for (const m of reserveMonths(entries, report.reserve)) {
    const btn = el("button", "category-card report-pick");
    btn.type = "button";
    btn.append(
      el("span", "category-name month-name", monthLabel(m.month)),
      el("span", "category-sub", currency.format(m.received) + " in"),
      el("span", "month-left" + (m.remaining > 0 ? "" : " done"), m.remaining > 0 ? currency.format(m.remaining) + " left" : "Fully used")
    );
    btn.addEventListener("click", () => {
      report.month = m.month;
      showReportStage("view");
    });
    grid.append(btn);
  }
  if (!grid.children.length) return showReportStage("reserve");
  reportBody.append(grid);
}

function renderMonthView() {
  const r = reserveReport(entries, report.reserve, report.month);
  if (!r.lots.length) return showReportStage("month");
  reportTitle.textContent = "Report";
  renderUsage(r, "What happened to " + moneyName(r.reserve, r.month) + "?");
}

function summaryTiles(received, used, left) {
  const tiles = el("div", "report-tiles");
  for (const [label, value, cls] of [
    ["Received", received, "income"],
    ["Used", used, "expense"],
    ["Left", left, ""],
  ]) {
    const tile = el("div", "report-tile");
    tile.append(el("span", "label", label), el("span", "tile-value " + cls, currency.format(value)));
    tiles.append(tile);
  }
  return tiles;
}

// Received / used / left, the story, money in and where it went, for a month or a single receipt.
function renderUsage(r, heading) {
  reportBody.append(el("h3", "report-heading", heading));
  reportBody.append(summaryTiles(r.received, r.used, r.remaining));

  const bar = el("div", "usage-bar");
  const fill = el("span", "usage-fill");
  fill.style.width = (r.received ? Math.min(100, (r.used / r.received) * 100) : 0) + "%";
  bar.append(fill);
  reportBody.append(bar);

  // Story: when it started being used and when it ran out.
  const story = [];
  if (!r.firstUsedOn) {
    story.push("Not used yet.");
    if (r.earlierMoneyLeft > 0) {
      story.push(`Older money (${currency.format(r.earlierMoneyLeft)}) in this reserve is used first.`);
    }
  } else {
    story.push(
      `First used on ${formatDate(r.firstUsedOn)}` +
        (r.hadEarlierMoney ? ", after the older money in this reserve was used up." : ".")
    );
    if (r.exhaustedOn) story.push(`Fully used by ${formatDate(r.exhaustedOn)}.`);
  }
  reportBody.append(el("p", "report-story", story.join(" ")));

  reportBody.append(el("h4", "report-sub", "Money in"));
  const ins = el("ul", "report-list");
  for (const lot of r.lots) {
    const li = el("li", "report-row");
    const name = lot.entry.type === "transfer" ? lot.label : lot.label + (lot.entry.description && lot.entry.category ? " · " + lot.entry.description : "");
    const info = el("div", "entry-info");
    info.append(el("p", "entry-desc", name), el("p", "entry-date", formatDate(lot.date)));
    li.append(el("span", "row-icon", lot.entry.type === "transfer" ? "⇄" : categoryIcon("income", lot.entry.category)), info, el("span", "entry-amount income", "+" + currency.format(lot.amount)));
    ins.append(li);
  }
  reportBody.append(ins);

  reportBody.append(el("h4", "report-sub", "Where it went"));
  if (!r.items.length) {
    reportBody.append(el("p", "empty", "Nothing has been spent from it yet."));
  } else {
    const outs = el("ul", "report-list");
    for (const item of r.items) {
      const e = item.entry;
      const li = el("li", "report-row");
      const title = e.type === "transfer" ? "Transferred to " + e.toReserve : categoryTitle(e);
      const details = [formatDate(e.date)];
      if (e.type !== "transfer" && e.category && e.description) details.unshift(e.description);
      if (item.amount < e.amount) {
        let split = `${currency.format(item.amount)} of ${currency.format(e.amount)}`;
        const others = item.otherSources.map((o) => `${currency.format(o.amount)} from ${moneyName(o.reserve, o.month)}`);
        if (item.uncovered > 0) others.push(`${currency.format(item.uncovered)} not covered yet`);
        if (others.length) split += " — " + others.join(", ");
        details.push(split);
      }
      if (item.before) details.push("spent before this money arrived");
      const info = el("div", "entry-info");
      info.append(el("p", "entry-desc", title), el("p", "entry-date", details.join(" · ")));
      const icon = e.type === "transfer" ? "⇄" : categoryIcon("expense", e.category);
      li.append(el("span", "row-icon", icon), info, el("span", "entry-amount " + e.type, (e.type === "expense" ? "−" : "") + currency.format(item.amount)));
      outs.append(li);
    }
    reportBody.append(outs);
  }

  const left = el("p", "report-left");
  left.textContent = r.remaining > 0 ? `${currency.format(r.remaining)} of it is still in ${reserveLabel(r.reserve)}.` : "All of it has been used.";
  reportBody.append(left);
}

// Table of reserves (rows) x accounts (columns) with totals.
function renderGrid() {
  const grid = reserveAccountGrid(entries);
  const order = computeReserves().map((r) => r.name);
  const reserves = [...grid.reserves].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const cellText = (v) => (Math.abs(v) < 0.005 ? "–" : compactCurrency.format(v));
  const td = (tag, text, cls = "") => el(tag, cls, text);

  const wrap = el("div", "grid-wrap");
  const table = el("table", "grid-table");
  const head = el("tr");
  head.append(td("th", "Reserve", "grid-corner"));
  for (const a of grid.accounts) {
    const th = el("th", "grid-account");
    th.append(el("span", "grid-account-icon", accountIcon(a)), el("span", "", a));
    head.append(th);
  }
  head.append(td("th", "Total", "grid-total"));
  const thead = el("thead");
  thead.append(head);

  const tbody = el("tbody");
  for (const r of reserves) {
    const tr = el("tr");
    const th = el("th", "grid-reserve");
    th.append(el("span", "", reserveIcon(r) + " " + r));
    tr.append(th);
    for (const a of grid.accounts) {
      const v = grid.cell(r, a);
      tr.append(td("td", cellText(v), v < -0.005 ? "expense" : ""));
    }
    const total = grid.rowTotals[r];
    tr.append(td("td", cellText(total), "grid-total" + (total < -0.005 ? " expense" : "")));
    tbody.append(tr);
  }

  const foot = el("tr", "grid-foot");
  foot.append(td("th", "Total", "grid-reserve"));
  for (const a of grid.accounts) {
    const v = grid.columnTotals[a];
    foot.append(td("td", cellText(v), v < -0.005 ? "expense" : ""));
  }
  foot.append(td("td", cellText(grid.total), "grid-total" + (grid.total < -0.005 ? " expense" : "")));
  const tfoot = el("tfoot");
  tfoot.append(foot);

  table.append(thead, tbody, tfoot);
  wrap.append(table);
  reportBody.append(
    el("p", "step-hint", "How much of each reserve is kept in each account. Rows add up to reserve balances, columns to account balances."),
    wrap
  );
}

reportBack.addEventListener("click", () => showReportStage(REPORT_BACK[report.stage] || "menu"));

// ---------- Available to spend: balance × (income − payments) ÷ income over the 3-month forecast ----------

function shortDate(date) {
  return new Date(date + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function renderAvailable() {
  const a = availableToSpend(entries, budgets, plans, today(), autoPlanLines(entries, today()));
  const amountEl = document.getElementById("available-amount");
  amountEl.textContent = currency.format(a.available);
  amountEl.classList.toggle("expense", a.available < 0);
  document.getElementById("available").classList.toggle("negative", a.available < 0);
  // A dip below zero along the way matters even when the end result is positive.
  const dip = a.lowest.balance < 0 && a.lowest.balance < a.available ? ` · lowest ${currency.format(a.lowest.balance)} on ${shortDate(a.lowest.date)}` : "";
  // Each part stays on one line when the text wraps ("+₹1,20,000 in" never splits after the sign).
  const meta = document.getElementById("available-meta");
  meta.innerHTML = "";
  const parts = [`until ${shortDate(a.until)}`, `+${currency.format(a.income)} in`, `−${currency.format(a.expected)} out`];
  if (dip) parts.push(dip.slice(3));
  // The "·" ends the part before it, so a wrapped line never starts with one.
  parts.forEach((text, i) => {
    if (i) meta.append(" ");
    meta.append(el("span", "nowrap", i < parts.length - 1 ? text + " ·" : text));
  });

  // Breakdown on the Budget screen.
  document.getElementById("available-sub").textContent = `Next 3 months · until ${shortDate(a.until)}`;
  const summaryEl = document.getElementById("available-summary");
  summaryEl.innerHTML = "";
  const calc = availableExplanation(a);
  for (const group of calc.groups) {
    const box = el("div", "calc-group");
    for (const step of group) {
      const row = el("div", "calc-row" + (step.total ? " calc-total" : ""));
      const value =
        step.percent !== undefined ? step.percent.toFixed(2) + "%" : (step.sign || (step.amount < 0 ? "−" : "")) + currency.format(Math.abs(step.amount));
      const cls = step.sign === "+" ? " income" : step.sign === "−" || (step.total && step.amount < 0) ? " expense" : "";
      row.append(el("span", "calc-label", step.label), el("span", "calc-value" + cls, value));
      box.append(row);
    }
    summaryEl.append(box);
  }
  if (calc.note) summaryEl.append(el("p", "calc-note", calc.note));
  const closing = el("p", "calc-note", `Balance on ${shortDate(a.until)} if all goes to plan: `);
  closing.append(el("span", "nowrap", (calc.closing < 0 ? "−" : "") + currency.format(Math.abs(calc.closing))), ".");
  summaryEl.append(closing);
  const listEl = document.getElementById("available-list");
  listEl.innerHTML = "";
  if (!a.rows.length) listEl.append(el("li", "empty", "No payments expected in the forecast."));
  for (const r of a.rows) {
    const li = el("li", "report-row");
    const info = el("div", "entry-info");
    const basis = r.budget >= r.planned ? "budget" : "planned + Auto";
    info.append(el("p", "entry-desc", r.category), el("p", "entry-date", basis));
    li.append(el("span", "row-icon", categoryIcon("expense", r.category)), info, el("span", "entry-amount expense", "−" + currency.format(r.expected)));
    listEl.append(li);
  }
}

// ---------- Budget & planned cashflows ----------

const budgetSummary = document.getElementById("budget-summary");
const budgetList = document.getElementById("budget-list");
const planList = document.getElementById("plan-list");
const forecastTable = document.getElementById("forecast-table");

function renderBudget() {
  // This month's budget per category.
  const status = budgetStatus(entries, budgets, today());
  budgetList.innerHTML = "";
  if (!status.rows.length) {
    budgetSummary.textContent = "No budgets yet. Tap + Set budget to give a category a monthly limit.";
  } else {
    const left = status.left >= 0 ? `${currency.format(status.left)} left` : `${currency.format(-status.left)} over`;
    budgetSummary.textContent = `Spent ${currency.format(status.spent)} of ${currency.format(status.budget)} · ${left}`;
  }
  for (const row of status.rows) {
    const li = el("li");
    const btn = el("button", "report-row budget-row");
    btn.type = "button";
    const over = row.left < 0;
    const info = el("div", "entry-info");
    info.append(
      el("p", "entry-desc", row.category),
      el("p", "entry-date", `${currency.format(row.spent)} of ${currency.format(row.budget)}`),
      usageBar(row.share, over)
    );
    const leftText = over ? `${currency.format(-row.left)} over` : `${currency.format(row.left)} left`;
    btn.append(el("span", "row-icon", categoryIcon("expense", row.category)), info, el("span", "entry-amount " + (over ? "expense" : "income"), leftText));
    btn.addEventListener("click", () => openBudget(row.category));
    li.append(btn);
    budgetList.append(li);
  }

  // Planned cashflows: the automatic lines first (food, Ntorq), then the plans you added.
  planList.innerHTML = "";
  const autoPlans = autoPlanLines(entries, today());
  for (const auto of autoPlans) {
    const li = el("li", "plan-item auto-plan");
    const btn = el("button", "report-row plan-row");
    btn.type = "button";
    const name = categoryTitle(auto);
    btn.setAttribute("aria-label", `${name}: automatic plan for the ${auto.horizon}. Tap to see the ${auto.basis}`);
    const info = el("div", "entry-info");
    const meta = `${auto.horizon} · ${currency.format(auto.rate)}/${auto.unit} (${auto.basis}' average)`;
    info.append(el("p", "entry-desc", name), el("p", "entry-date", meta));
    const icon = auto.subcategory ? subcategoryIcon(auto.category, auto.subcategory) : categoryIcon("expense", auto.category);
    btn.append(el("span", "row-icon", icon), info, el("span", "entry-amount expense", "−" + currency.format(auto.amount)));
    btn.addEventListener("click", () =>
      showEntries({ type: "expense", category: auto.category, subcategory: auto.subcategory, from: auto.since, to: today() })
    );
    li.append(btn, el("span", "auto-badge", "Auto"));
    planList.append(li);
  }
  // One line per date in the 3-month forecast (a monthly plan shows each month); a plan with no
  // date in the forecast shows once. Only a plan's next date can be recorded.
  const lines = [];
  for (const plan of plans) {
    const dates = planDates(plan, today());
    if (!dates.length) lines.push({ plan, date: plan.nextDate, first: true, beyond: true, n: 1, of: 1 });
    dates.forEach((date, i) => lines.push({ plan, date, first: i === 0, n: i + 1, of: dates.length }));
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || Number(a.plan.id) - Number(b.plan.id));
  if (!lines.length) planList.append(el("li", "empty", "Nothing else planned yet. Tap + Plan to add expected income or expenses."));
  for (const line of lines) {
    const { plan, date } = line;
    const li = el("li", "plan-item" + (line.first ? "" : " plan-repeat"));
    li.dataset.planId = plan.id;
    const btn = el("button", "report-row plan-row");
    btn.type = "button";
    const info = el("div", "entry-info");
    const overdue = line.first && plan.nextDate < today();
    const when = overdue ? "due " + formatDate(plan.nextDate) : date === today() ? "due today" : formatDate(date);
    const repeat = plan.repeat === "monthly" ? (line.of > 1 ? `every month · ${line.n} of ${line.of}` : "every month") : "one time";
    const meta = [when, repeat, plan.description, line.beyond ? "after the 3-month forecast" : ""].filter(Boolean);
    info.append(el("p", "entry-desc", plan.category), el("p", "entry-date" + (date <= today() ? " due" : ""), meta.join(" · ")));
    const sign = plan.type === "income" ? "+" : "−";
    btn.append(el("span", "row-icon", categoryIcon(plan.type, plan.category)), info, el("span", "entry-amount " + plan.type, sign + currency.format(plan.amount)));
    btn.addEventListener("click", () => openPlan(plan));
    li.append(btn);
    if (line.first) {
      const record = el("button", "record-btn", "✓ Record");
      record.type = "button";
      record.setAttribute("aria-label", `Record ${plan.category} ${currency.format(plan.amount)} as an entry`);
      record.addEventListener("click", () => recordPlan(plan));
      li.append(record);
    }
    planList.append(li);
  }

  // Forecast.
  const forecast = cashflowForecast(entries, budgets, plans, today(), FORECAST_MONTHS, autoPlans);
  forecastTable.innerHTML = "";
  const head = el("tr");
  for (const h of ["Month", "In", "Out", "Balance"]) head.append(el("th", h === "Month" ? "grid-corner" : "", h));
  const thead = el("thead");
  thead.append(head);
  const tbody = el("tbody");
  const startRow = el("tr", "forecast-start");
  startRow.append(el("th", "grid-reserve", "Today"), el("td", "", ""), el("td", "", ""), el("td", "grid-total", compactCurrency.format(forecast.start)));
  tbody.append(startRow);
  for (const row of forecast.rows) {
    const tr = el("tr");
    // Short labels that fit a phone: "26–30 Sept", "Oct", "1–25 Dec" (year only when it differs).
    const monthDate = new Date(row.month + "-01T00:00:00");
    let monthName = monthDate.toLocaleDateString("en-IN", { month: "short" });
    if (row.month.slice(0, 4) !== today().slice(0, 4)) monthName += " ’" + row.month.slice(2, 4);
    const label = row.partial ? `${Number(row.from.slice(8))}–${Number(row.to.slice(8))} ${monthName}` : monthName;
    tr.append(
      el("th", "grid-reserve", label),
      el("td", "income", row.income ? "+" + compactCurrency.format(row.income) : "–"),
      el("td", "expense", row.expense ? "−" + compactCurrency.format(row.expense) : "–"),
      el("td", "grid-total" + (row.balance < 0 ? " expense" : ""), compactCurrency.format(row.balance))
    );
    tbody.append(tr);
  }
  forecastTable.append(thead, tbody);
}

// Budget sheet
const budgetDialog = document.getElementById("budget-dialog");
const budgetForm = document.getElementById("budget-form");
const budgetCategories = document.getElementById("budget-categories");
const budgetAmount = document.getElementById("budget-amount");
const budgetRemove = document.getElementById("budget-remove");
let budgetCategory = "";

function renderCategoryChoice(container, type, selected, onPick) {
  container.innerHTML = "";
  const cards = [...CATEGORIES[type]];
  if (selected && !cards.some((c) => c.name === selected)) cards.unshift({ name: selected, icon: categoryIcon(type, selected) });
  for (const cat of cards) {
    const btn = el("button", "category-card " + type);
    btn.type = "button";
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(cat.name === selected));
    const icon = el("span", "category-icon", cat.icon);
    icon.setAttribute("aria-hidden", "true");
    btn.append(icon, el("span", "category-name", cat.name));
    btn.addEventListener("click", () => onPick(cat.name));
    container.append(btn);
  }
}

function renderBudgetSheet() {
  renderCategoryChoice(budgetCategories, "expense", budgetCategory, (name) => {
    budgetCategory = name;
    const existing = budgets.find((b) => b.category === name);
    if (existing) budgetAmount.value = existing.amount;
    renderBudgetSheet();
  });
  budgetRemove.hidden = !budgets.some((b) => b.category === budgetCategory);
}

function openBudget(category = "") {
  budgetCategory = category;
  const existing = budgets.find((b) => b.category === category);
  budgetAmount.value = existing ? existing.amount : "";
  renderBudgetSheet();
  budgetDialog.showModal();
}

document.getElementById("budget-add").addEventListener("click", () => openBudget(""));
document.getElementById("budget-close").addEventListener("click", () => budgetDialog.close());
budgetDialog.addEventListener("click", (event) => {
  if (event.target === budgetDialog) budgetDialog.close();
});

budgetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = parseAmount(budgetAmount.value);
  if (!budgetCategory) return alert("Choose a category");
  if (!(amount > 0)) return;
  try {
    const saved = await api("PUT", "", { category: budgetCategory, amount }, "budgets");
    budgets = [...budgets.filter((b) => b.category !== saved.category), saved];
    budgetDialog.close();
    showStatus("");
    render();
  } catch (err) {
    budgetDialog.close();
    showStatus(err.message);
  }
});

budgetRemove.addEventListener("click", async () => {
  if (!confirm(`Remove the ${budgetCategory} budget?`)) return;
  try {
    await api("DELETE", "?category=" + encodeURIComponent(budgetCategory), null, "budgets");
    budgets = budgets.filter((b) => b.category !== budgetCategory);
    budgetDialog.close();
    render();
  } catch (err) {
    budgetDialog.close();
    showStatus(err.message);
  }
});

// Plan sheet
const planDialog = document.getElementById("plan-dialog");
const planForm = document.getElementById("plan-form");
const planCategories = document.getElementById("plan-categories");
const planAmount = document.getElementById("plan-amount");
const planDate = document.getElementById("plan-date");
const planNote = document.getElementById("plan-note");
const planDelete = document.getElementById("plan-delete");
const planDraft = { id: null, category: "" };

function planType() {
  return planForm.elements["plan-type"].value;
}

function renderPlanSheet() {
  renderCategoryChoice(planCategories, planType(), planDraft.category, (name) => {
    planDraft.category = name;
    renderPlanSheet();
  });
}

function openPlan(plan = null) {
  planDraft.id = plan ? plan.id : null;
  planDraft.category = plan ? plan.category : "";
  planForm.elements["plan-type"].value = plan ? plan.type : "expense";
  planForm.elements["plan-repeat"].value = plan ? plan.repeat : "none";
  planAmount.value = plan ? plan.amount : "";
  planDate.value = plan ? plan.nextDate : today();
  // New plans can only be dated within the forecast (the next FORECAST_MONTHS months). An existing
  // plan that is already later (e.g. moved on by an early Record) can still be edited.
  const limit = forecastEnd(today());
  planDate.max = plan && (plan.repeat === "monthly" || plan.nextDate > limit) ? "" : limit;
  planNote.value = plan ? plan.description : "";
  document.getElementById("plan-title").textContent = plan ? "Edit plan" : "Plan a cashflow";
  planDelete.hidden = !plan;
  renderPlanSheet();
  planDialog.showModal();
}

planForm.querySelectorAll("input[name=plan-type]").forEach((radio) =>
  radio.addEventListener("change", () => {
    if (!CATEGORIES[planType()].some((c) => c.name === planDraft.category)) planDraft.category = "";
    renderPlanSheet();
  })
);
document.getElementById("plan-add").addEventListener("click", () => openPlan());
document.getElementById("plan-close").addEventListener("click", () => planDialog.close());
planDialog.addEventListener("click", (event) => {
  if (event.target === planDialog) planDialog.close();
});

planForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = parseAmount(planAmount.value);
  if (!planDraft.category) return alert("Choose a category");
  if (!(amount > 0) || !planDate.value) return;
  const body = {
    type: planType(),
    category: planDraft.category,
    amount,
    nextDate: planDate.value,
    day: Number(planDate.value.slice(8, 10)),
    repeat: planForm.elements["plan-repeat"].value,
    description: planNote.value.trim(),
  };
  try {
    const saved = planDraft.id
      ? await api("PUT", "?id=" + encodeURIComponent(planDraft.id), body, "plans")
      : await api("POST", "", body, "plans");
    plans = [...plans.filter((p) => p.id !== saved.id), saved];
    planDialog.close();
    showStatus("");
    render();
  } catch (err) {
    planDialog.close();
    showStatus(err.message);
  }
});

planDelete.addEventListener("click", async () => {
  if (!confirm("Delete this plan?")) return;
  try {
    await api("DELETE", "?id=" + encodeURIComponent(planDraft.id), null, "plans");
    plans = plans.filter((p) => p.id !== planDraft.id);
    planDialog.close();
    render();
  } catch (err) {
    planDialog.close();
    showStatus(err.message);
  }
});

// A planned cashflow happened: add it as an entry today, then move a monthly plan to next month
// (a one-time plan is removed). It uses the usual defaults: income into its own reserve,
// expenses from General Reserve, Super Money account; edit the entry afterwards to change them.
async function recordPlan(plan) {
  if (!confirm(`Record ${plan.category} ${currency.format(plan.amount)} as ${plan.type} today?`)) return;
  try {
    const created = await api("POST", "", {
      type: plan.type,
      category: plan.category,
      description: plan.description,
      amount: plan.amount,
      date: today(),
      reserve: plan.type === "income" ? plan.category : GENERAL,
      account: DEFAULT_ACCOUNT,
    });
    entries.push(created);
    sortEntries();
    try {
      if (plan.repeat === "monthly") {
        const nextDate = addMonths(plan.nextDate, 1, plan.day);
        const next = await api("PUT", "?id=" + encodeURIComponent(plan.id), { ...plan, nextDate }, "plans");
        plans = plans.map((p) => (p.id === next.id ? next : p));
      } else {
        await api("DELETE", "?id=" + encodeURIComponent(plan.id), null, "plans");
        plans = plans.filter((p) => p.id !== plan.id);
      }
    } catch (err) {
      // The entry is saved; only updating the plan failed. Say so, so it is not recorded twice.
      render();
      const what = plan.repeat === "monthly" ? "move the plan to next month" : "remove the plan";
      showStatus(`Recorded ${plan.category}, but could not ${what} (${err.message}). Edit or delete the plan so it isn't recorded again.`);
      return;
    }
    showStatus(`Recorded ${plan.category} ${currency.format(plan.amount)}.`, false);
    render();
  } catch (err) {
    const message = err.message;
    await loadEntries();
    showStatus(message);
  }
}

dateInput.value = today();
goToStage("type");
showScreen();
loadEntries();
