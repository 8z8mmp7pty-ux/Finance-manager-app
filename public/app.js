import {
  GENERAL,
  DEFAULT_ACCOUNT,
  reserveBalances,
  reserveMonths,
  reserveReport,
  reserveAccountGrid,
  accountBalances,
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
    { name: "Food & Dining", icon: "🍽️" },
    { name: "Groceries", icon: "🛒" },
    { name: "Rent", icon: "🏠" },
    { name: "Bills & Utilities", icon: "💡" },
    { name: "Transport", icon: "🚗" },
    { name: "Shopping", icon: "🛍️" },
    { name: "Health", icon: "💊" },
    { name: "Education", icon: "📚" },
    { name: "Entertainment", icon: "🎬" },
    { name: "Travel", icon: "✈️" },
    { name: "EMI & Loans", icon: "💳" },
    { name: "Other", icon: "➖" },
  ],
};

const TYPE_LABEL = { income: "Income", expense: "Expense", transfer: "Transfer", contra: "Contra" };

function categoryIcon(type, name) {
  const found = (CATEGORIES[type] || []).find((c) => c.name === name);
  return found ? found.icon : type === "income" ? "↓" : type === "expense" ? "↑" : "⇄";
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
const incomeEl = document.getElementById("total-income");
const expenseEl = document.getElementById("total-expense");
const reservesEl = document.getElementById("reserves");
const accountsEl = document.getElementById("accounts");

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });
// Drops ".00" for whole rupees, for tight spaces (account cards, grid).
const compactCurrency = new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", minimumFractionDigits: 0, maximumFractionDigits: 2,
});

let entries = [];

async function api(method, query = "", body) {
  const res = await fetch("/api/entries" + query, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
  return data;
}

function showStatus(message, isError = true) {
  statusEl.textContent = message || "";
  statusEl.classList.toggle("info", !isError);
  statusEl.hidden = !message;
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
    title: entry.category || entry.description,
    icon: categoryIcon(entry.type, entry.category),
    meta: [note, via, accountNote],
  };
}

function render() {
  list.innerHTML = "";

  for (const entry of entries) {
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
    list.append(li);
  }

  emptyMsg.hidden = entries.length > 0;

  const income = entries.filter((e) => e.type === "income").reduce((s, e) => s + e.amount, 0);
  const expense = entries.filter((e) => e.type === "expense").reduce((s, e) => s + e.amount, 0);
  const balance = income - expense;

  incomeEl.textContent = currency.format(income);
  expenseEl.textContent = currency.format(expense);
  balanceEl.textContent = currency.format(balance);
  balanceEl.className = "balance " + (balance < 0 ? "expense" : "");
  renderAccounts();
  renderReserves();
  renderReport();
}

function sortEntries() {
  entries.sort((a, b) => b.date.localeCompare(a.date) || Number(b.id) - Number(a.id));
}

async function loadEntries() {
  showStatus("Loading…", false);
  try {
    entries = await api("GET");
    sortEntries();
    appSection.hidden = false;
    showStatus("");
    render();
  } catch (err) {
    showStatus(err.message);
  }
}

// ---------- Add entry: step-by-step cards ----------

const FLOWS = {
  income: ["type", "category", "amount"],
  expense: ["type", "category", "amount"],
  transfer: ["type", "from", "to", "amount"],
  contra: ["type", "fromAccount", "toAccount", "amount"],
};

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
const accountGroup = document.getElementById("account-group");
const accountChips = document.getElementById("account-chips");
const payFrom = document.getElementById("pay-from");
const payFromChips = document.getElementById("pay-from-chips");
const transferAvailable = document.getElementById("transfer-available");
const availableText = document.getElementById("available-text");
const moveAllBtn = document.getElementById("transfer-all");

const EMPTY_DRAFT = {
  flow: null, index: 0, category: null, reserve: GENERAL, from: null, to: null,
  account: DEFAULT_ACCOUNT, fromAccount: null, toAccount: null,
  transferAll: false, // "Transfer all": move the reserve's money out of every account that holds it
};
const draft = { ...EMPTY_DRAFT };
let postedTimer;

function goToStage(stage, direction = "forward") {
  const stages = draft.flow ? FLOWS[draft.flow] : ["type", "category", "amount"];
  draft.index = stages.indexOf(stage);
  const panel = stage === "type" ? "type" : stage === "amount" ? "amount" : "pick";
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
        // Income goes into its own reserve unless you pick another one on the next step.
        if (draft.flow === "income") draft.reserve = name;
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

// Where a reserve's money is kept: accounts holding a positive amount of it.
function reserveSplit(reserve) {
  const grid = reserveAccountGrid(entries);
  return grid.accounts
    .map((account) => ({ account, amount: grid.cell(reserve, account) }))
    .filter((p) => p.amount > 0.004);
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
    chosenIcon.textContent = categoryIcon(flow, draft.category);
    chosenCategory.textContent = draft.category;
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
  if (draft.flow !== flow) Object.assign(draft, { category: null, from: null, to: null, fromAccount: null, toAccount: null });
  draft.flow = flow;
  draft.reserve = GENERAL;
  draft.account = DEFAULT_ACCOUNT;
  draft.transferAll = false;
  postedMsg.hidden = true;
  goToStage(FLOWS[flow][1]);
}

function startTransferFrom(name) {
  Object.assign(draft, { flow: "transfer", from: name, to: null, account: DEFAULT_ACCOUNT, transferAll: false });
  postedMsg.hidden = true;
  goToStage("to");
  wizard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function startContraFrom(name) {
  Object.assign(draft, { flow: "contra", fromAccount: name, toAccount: null, reserve: GENERAL });
  postedMsg.hidden = true;
  goToStage("toAccount");
  wizard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetWizard() {
  amountInput.value = "";
  noteInput.value = "";
  dateInput.value = today();
  Object.assign(draft, EMPTY_DRAFT);
  goToStage("type", "back");
}

wizard.querySelectorAll(".type-card[data-flow]").forEach((card) => {
  card.addEventListener("click", () => startFlow(card.dataset.flow));
});

backBtn.addEventListener("click", () => {
  const stages = FLOWS[draft.flow];
  goToStage(stages[Math.max(0, draft.index - 1)], "back");
});

document.getElementById("chosen").addEventListener("click", () => {
  goToStage(FLOWS[draft.flow][1], "back");
});

moveAllBtn.addEventListener("click", () => {
  if (draft.flow === "transfer") {
    // Move the whole reserve, from every account that holds some of it.
    const total = reserveSplit(draft.from).reduce((s, p) => s + p.amount, 0);
    draft.transferAll = total > 0;
    amountInput.value = total > 0 ? total.toFixed(2) : "";
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

amountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = parseAmount(amountInput.value);
  if (!(amount > 0) || !draft.flow) return;

  if (draft.flow === "transfer" && draft.transferAll) {
    return postTransferAll();
  }

  let body;
  if (draft.flow === "transfer" || draft.flow === "contra") {
    const isTransfer = draft.flow === "transfer";
    if (isTransfer ? !draft.from || !draft.to : !draft.fromAccount || !draft.toAccount) return;
    const available = draftAvailable();
    const source = isTransfer ? `${draft.from} in ${draft.account}` : `${draft.reserve} in ${draft.fromAccount}`;
    if (amount > available && !confirm(`${source} only has ${currency.format(available)}. Continue anyway?`)) {
      return;
    }
    body = isTransfer
      ? { type: "transfer", reserve: draft.from, toReserve: draft.to, account: draft.account }
      : { type: "contra", reserve: draft.reserve, account: draft.fromAccount, toAccount: draft.toAccount };
  } else {
    if (!draft.category) return;
    body = { type: draft.flow, category: draft.category, reserve: draft.reserve, account: draft.account };
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
      expense: () => `✓ Paid from ${reserveLabel(created.reserve)} · ${created.account}`,
    }[created.type]());
  } catch (err) {
    showStatus(err.message);
  } finally {
    postBtn.disabled = false;
  }
});

function showPosted(message) {
  resetWizard();
  postedMsg.textContent = message;
  postedMsg.hidden = false;
  clearTimeout(postedTimer);
  postedTimer = setTimeout(() => (postedMsg.hidden = true), 3000);
}

// "Transfer all": one transfer per account that holds some of the reserve's money.
async function postTransferAll() {
  const parts = reserveSplit(draft.from);
  if (!parts.length || !draft.to) return;
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
  } catch (err) {
    // Some transfers may have been saved; reload so the screen matches the database.
    const message = err.message;
    await loadEntries();
    showStatus(message);
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
const edit = { id: null, kind: "entry", category: "", reserve: GENERAL, from: "", to: "", account: DEFAULT_ACCOUNT, toAccount: "" };

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
  for (const cat of CATEGORIES[type]) {
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
      edit.category = cat.name;
      renderEditFields();
    });
    editCategories.append(btn);
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
    body = { type, category: edit.category, reserve: edit.reserve, account: edit.account };
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
const report = { stage: "reserve", reserve: null, month: null };

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

function renderReport() {
  reportBody.innerHTML = "";
  reportBack.hidden = report.stage === "reserve";

  if (report.stage === "reserve") {
    reportTitle.textContent = "Reports";
    const gridCard = el("button", "type-card wide grid-card");
    gridCard.type = "button";
    const gridIcon = el("span", "type-icon", "▦");
    gridIcon.setAttribute("aria-hidden", "true");
    const gridText = el("span", "type-text");
    gridText.append(el("span", "type-name", "Reserves × Accounts"), el("span", "type-sub", "Where each reserve's money is kept"));
    gridCard.append(gridIcon, gridText);
    gridCard.addEventListener("click", () => showReportStage("grid"));
    reportBody.append(gridCard);
    reportBody.append(el("p", "step-hint report-hint", "What happened to my money? Pick a reserve."));
    const grid = el("div", "category-grid");
    for (const r of computeReserves()) {
      if (!reserveMonths(entries, r.name).length) continue;
      const btn = el("button", "category-card report-pick");
      btn.type = "button";
      btn.append(el("span", "category-icon", reserveIcon(r.name)), el("span", "category-name", r.name));
      btn.addEventListener("click", () => {
        report.reserve = r.name;
        showReportStage("month");
      });
      grid.append(btn);
    }
    if (!grid.children.length) reportBody.append(el("p", "empty", "Add some income to see reports."));
    else reportBody.append(grid);
    return;
  }

  if (report.stage === "grid") {
    reportTitle.textContent = "Reserves × Accounts";
    renderGrid();
    return;
  }

  if (report.stage === "month") {
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
    if (!grid.children.length) {
      report.stage = "reserve";
      return renderReport();
    }
    reportBody.append(grid);
    return;
  }

  // Report view
  const r = reserveReport(entries, report.reserve, report.month);
  if (!r.lots.length) {
    report.stage = "month";
    return renderReport();
  }
  reportTitle.textContent = "Report";
  reportBody.append(el("h3", "report-heading", "What happened to " + moneyName(r.reserve, r.month) + "?"));

  const tiles = el("div", "report-tiles");
  for (const [label, value, cls] of [
    ["Received", r.received, "income"],
    ["Used", r.used, "expense"],
    ["Left", r.remaining, ""],
  ]) {
    const tile = el("div", "report-tile");
    tile.append(el("span", "label", label), el("span", "tile-value " + cls, currency.format(value)));
    tiles.append(tile);
  }
  reportBody.append(tiles);

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
      const title = e.type === "transfer" ? "Transferred to " + e.toReserve : e.category || e.description;
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

reportBack.addEventListener("click", () => showReportStage(report.stage === "view" ? "month" : "reserve"));

dateInput.value = today();
goToStage("type");
loadEntries();
