import { GENERAL, reserveBalances, reserveMonths, reserveReport } from "./ledger.js";

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

const TYPE_LABEL = { income: "Income", expense: "Expense", transfer: "Transfer" };

function categoryIcon(type, name) {
  const found = (CATEGORIES[type] || []).find((c) => c.name === name);
  return found ? found.icon : type === "income" ? "↓" : type === "expense" ? "↑" : "⇄";
}

function reserveIcon(name) {
  if (name === GENERAL) return "🛡️";
  const found = CATEGORIES.income.find((c) => c.name === name);
  return found ? found.icon : "🪣";
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

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

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

// ---------- Reserves ----------

// Balance of every reserve (General Reserve first, then income types), plus this month's inflow.
function computeReserves() {
  const order = [GENERAL, ...CATEGORIES.income.map((c) => c.name)];
  const rank = (name) => (order.includes(name) ? order.indexOf(name) : order.length);
  return reserveBalances(entries, today()).sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
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

// Reserve chips: a row of tappable reserve buttons, one selected.
// `first` puts that reserve first, adding it if it has no money yet (e.g. a new income type).
function renderReserveChips(container, selected, onSelect, exclude, first) {
  container.innerHTML = "";
  let options = computeReserves();
  if (first) {
    const existing = options.find((r) => r.name === first) || { name: first, balance: 0 };
    options = [existing, ...options.filter((r) => r.name !== first)];
  }
  for (const r of options) {
    if (r.name === exclude) continue;
    const chip = el("button", "chip");
    chip.type = "button";
    chip.setAttribute("role", "radio");
    chip.setAttribute("aria-checked", String(r.name === selected));
    chip.append(
      el("span", "chip-icon", reserveIcon(r.name)),
      el("span", "chip-name", r.name),
      el("span", "chip-amount" + (r.balance < 0 ? " expense" : ""), currency.format(r.balance))
    );
    chip.addEventListener("click", () => onSelect(r.name));
    container.append(chip);
  }
}

// ---------- Entries list ----------

function render() {
  list.innerHTML = "";

  for (const entry of entries) {
    const li = document.createElement("li");
    const card = el("button", "entry-card " + entry.type);
    card.type = "button";

    let title, meta, iconText;
    const note = entry.category || entry.type === "transfer" ? entry.description : "";
    if (entry.type === "transfer") {
      title = `${entry.reserve} → ${entry.toReserve}`;
      iconText = "⇄";
      meta = [note, formatDate(entry.date)];
    } else {
      title = entry.category || entry.description;
      iconText = categoryIcon(entry.type, entry.category);
      const via =
        entry.type === "expense" && entry.reserve && entry.reserve !== GENERAL
          ? "from " + entry.reserve
          : entry.type === "income" && entry.reserve && entry.reserve !== entry.category
          ? "into " + entry.reserve
          : "";
      meta = [note, via, formatDate(entry.date)];
    }
    card.setAttribute("aria-label", `${title}, ${entry.type}, ${currency.format(entry.amount)}. Tap to edit`);

    const icon = el("span", "type-icon", iconText);
    icon.setAttribute("aria-hidden", "true");
    const info = el("div", "entry-info");
    info.append(el("p", "entry-desc", title), el("p", "entry-date", meta.filter(Boolean).join(" · ")));
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
const payFrom = document.getElementById("pay-from");
const payFromChips = document.getElementById("pay-from-chips");
const transferAvailable = document.getElementById("transfer-available");
const availableText = document.getElementById("available-text");

const draft = { flow: null, index: 0, category: null, reserve: GENERAL, from: null, to: null };
let postedTimer;

function currentStage() {
  return draft.flow ? FLOWS[draft.flow][draft.index] : "type";
}

function goToStage(stage, direction = "forward") {
  const stages = draft.flow ? FLOWS[draft.flow] : ["type", "category", "amount"];
  draft.index = stages.indexOf(stage);
  const panel = stage === "type" ? "type" : stage === "amount" ? "amount" : "pick";

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

function showAmountStage() {
  const chosenIcon = document.getElementById("chosen-icon");
  const chosenType = document.getElementById("chosen-type");
  const chosenCategory = document.getElementById("chosen-category");

  if (draft.flow === "transfer") {
    wizardTitle.textContent = "Transfer";
    chosenIcon.textContent = "⇄";
    chosenType.textContent = "Transfer";
    chosenCategory.textContent = `${draft.from} → ${draft.to}`;
    availableText.textContent = `Available in ${draft.from}: ${currency.format(reserveBalance(draft.from))}`;
    postBtn.textContent = "Transfer";
  } else {
    wizardTitle.textContent = "Amount";
    chosenIcon.textContent = categoryIcon(draft.flow, draft.category);
    chosenType.textContent = TYPE_LABEL[draft.flow];
    chosenCategory.textContent = draft.category;
    postBtn.textContent = "Post " + TYPE_LABEL[draft.flow];
  }

  payFrom.hidden = draft.flow === "transfer";
  if (draft.flow !== "transfer") renderPayFrom();
  transferAvailable.hidden = draft.flow !== "transfer";
  amountInput.focus();
}

function renderPayFrom() {
  const isIncome = draft.flow === "income";
  document.getElementById("pay-from-label").textContent = isIncome ? "Goes into reserve" : "Paid from reserve";
  renderReserveChips(
    payFromChips,
    draft.reserve,
    (name) => {
      draft.reserve = name;
      renderPayFrom();
    },
    null,
    isIncome ? draft.category : GENERAL
  );
}

function startFlow(flow) {
  if (draft.flow !== flow) {
    draft.category = null;
    draft.from = null;
    draft.to = null;
  }
  draft.flow = flow;
  draft.reserve = GENERAL;
  postedMsg.hidden = true;
  goToStage(FLOWS[flow][1]);
}

function startTransferFrom(name) {
  draft.flow = "transfer";
  draft.from = name;
  draft.to = null;
  postedMsg.hidden = true;
  goToStage("to");
  wizard.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetWizard() {
  amountInput.value = "";
  noteInput.value = "";
  dateInput.value = today();
  Object.assign(draft, { flow: null, index: 0, category: null, reserve: GENERAL, from: null, to: null });
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
  goToStage(draft.flow === "transfer" ? "from" : "category", "back");
});

document.getElementById("transfer-all").addEventListener("click", () => {
  const available = reserveBalance(draft.from);
  amountInput.value = available > 0 ? available.toFixed(2) : "";
  amountInput.focus();
});

amountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = parseAmount(amountInput.value);
  if (!(amount > 0) || !draft.flow) return;

  let body;
  if (draft.flow === "transfer") {
    if (!draft.from || !draft.to) return;
    const available = reserveBalance(draft.from);
    if (amount > available && !confirm(`${draft.from} only has ${currency.format(available)}. Transfer anyway?`)) {
      return;
    }
    body = { type: "transfer", reserve: draft.from, toReserve: draft.to };
  } else {
    if (!draft.category) return;
    body = { type: draft.flow, category: draft.category, reserve: draft.reserve };
  }
  Object.assign(body, { description: noteInput.value.trim(), amount, date: dateInput.value || today() });

  postBtn.disabled = true;
  try {
    const created = await api("POST", "", body);
    entries.push(created);
    sortEntries();
    showStatus("");
    render();

    postedMsg.textContent =
      created.type === "transfer"
        ? `✓ Moved ${currency.format(created.amount)} to ${created.toReserve}`
        : created.type === "income"
        ? `✓ Added to ${reserveLabel(created.reserve)}`
        : `✓ Paid from ${reserveLabel(created.reserve)}`;
    resetWizard();
    postedMsg.hidden = false;
    clearTimeout(postedTimer);
    postedTimer = setTimeout(() => (postedMsg.hidden = true), 3000);
  } catch (err) {
    showStatus(err.message);
  } finally {
    postBtn.disabled = false;
  }
});

// ---------- Edit sheet ----------

const editDialog = document.getElementById("edit-dialog");
const editForm = document.getElementById("edit-form");
const editTitle = document.getElementById("edit-title");
const editEntryFields = document.getElementById("edit-entry-fields");
const editTransferFields = document.getElementById("edit-transfer-fields");
const editCategories = document.getElementById("edit-categories");
const editPayFrom = document.getElementById("edit-pay-from");
const editAmount = document.getElementById("edit-amount");
const editNote = document.getElementById("edit-note");
const editDate = document.getElementById("edit-date");
const editSave = document.getElementById("edit-save");
const editDelete = document.getElementById("edit-delete");
const edit = { id: null, isTransfer: false, category: "", reserve: GENERAL, from: "", to: "" };

function renderEditFields() {
  if (edit.isTransfer) {
    renderReserveChips(document.getElementById("edit-from-chips"), edit.from, (name) => {
      edit.from = name;
      if (edit.to === name) edit.to = "";
      renderEditFields();
    });
    renderReserveChips(
      document.getElementById("edit-to-chips"),
      edit.to,
      (name) => {
        edit.to = name;
        renderEditFields();
      },
      edit.from
    );
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
  renderReserveChips(
    document.getElementById("edit-pay-from-chips"),
    edit.reserve,
    (name) => {
      edit.reserve = name;
      renderEditFields();
    },
    null,
    type === "income" ? edit.category || GENERAL : GENERAL
  );
}

function openEditor(entry) {
  Object.assign(edit, {
    id: entry.id,
    isTransfer: entry.type === "transfer",
    category: entry.category,
    reserve: entry.type === "transfer" ? GENERAL : entry.reserve || entry.category || GENERAL,
    from: entry.type === "transfer" ? entry.reserve : "",
    to: entry.type === "transfer" ? entry.toReserve : "",
  });
  editTitle.textContent = edit.isTransfer ? "Edit Transfer" : "Edit Entry";
  editEntryFields.hidden = edit.isTransfer;
  editTransferFields.hidden = !edit.isTransfer;
  if (!edit.isTransfer) editForm.elements.type.value = entry.type;
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
  if (edit.isTransfer) {
    if (!edit.from || !edit.to) {
      alert("Choose both reserves");
      return;
    }
    body = { type: "transfer", reserve: edit.from, toReserve: edit.to };
  } else {
    if (!edit.category && !note) {
      alert("Choose a category");
      return;
    }
    const type = editForm.elements.type.value;
    body = { type, category: edit.category, reserve: edit.reserve };
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
  const name = entry.type === "transfer" ? "this transfer" : `"${entry.category || entry.description}"`;
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
    reportBody.append(el("p", "step-hint", "What happened to my money? Pick a reserve."));
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

reportBack.addEventListener("click", () => showReportStage(report.stage === "view" ? "month" : "reserve"));

dateInput.value = today();
goToStage("type");
loadEntries();
