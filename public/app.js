const GENERAL = "General Reserve";

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

// Balance of every reserve, plus how much flowed in this month.
function computeReserves() {
  const month = today().slice(0, 7);
  const reserves = new Map([[GENERAL, { balance: 0, monthIn: 0 }]]);
  const get = (name) => {
    if (!reserves.has(name)) reserves.set(name, { balance: 0, monthIn: 0 });
    return reserves.get(name);
  };
  for (const e of entries) {
    const inMonth = e.date.startsWith(month);
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
  const order = [GENERAL, ...CATEGORIES.income.map((c) => c.name)];
  const rank = (name) => (order.includes(name) ? order.indexOf(name) : order.length);
  return [...reserves.entries()]
    .map(([name, r]) => ({ name, balance: Math.round(r.balance * 100) / 100, monthIn: r.monthIn }))
    .sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name));
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
function renderReserveChips(container, selected, onSelect, exclude) {
  container.innerHTML = "";
  for (const r of computeReserves()) {
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
        entry.type === "expense" && entry.reserve && entry.reserve !== GENERAL ? "from " + entry.reserve : "";
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

  payFrom.hidden = draft.flow !== "expense";
  if (draft.flow === "expense") renderPayFrom();
  transferAvailable.hidden = draft.flow !== "transfer";
  amountInput.focus();
}

function renderPayFrom() {
  renderReserveChips(payFromChips, draft.reserve, (name) => {
    draft.reserve = name;
    renderPayFrom();
  });
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
    body = { type: draft.flow, category: draft.category, reserve: draft.flow === "expense" ? draft.reserve : "" };
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
      edit.category = cat.name;
      renderEditFields();
    });
    editCategories.append(btn);
  }

  editPayFrom.hidden = type !== "expense";
  if (type === "expense") {
    renderReserveChips(document.getElementById("edit-pay-from-chips"), edit.reserve, (name) => {
      edit.reserve = name;
      renderEditFields();
    });
  }
}

function openEditor(entry) {
  Object.assign(edit, {
    id: entry.id,
    isTransfer: entry.type === "transfer",
    category: entry.category,
    reserve: entry.type === "expense" ? entry.reserve || GENERAL : GENERAL,
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
    body = { type, category: edit.category, reserve: type === "expense" ? edit.reserve : "" };
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

dateInput.value = today();
goToStage("type");
loadEntries();
