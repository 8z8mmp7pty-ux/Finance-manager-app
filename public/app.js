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

const TYPE_LABEL = { income: "Income", expense: "Expense" };

function categoryIcon(type, name) {
  const found = CATEGORIES[type].find((c) => c.name === name);
  return found ? found.icon : type === "income" ? "↓" : "↑";
}

const appSection = document.getElementById("app");
const statusEl = document.getElementById("status");
const list = document.getElementById("entries");
const emptyMsg = document.getElementById("empty");
const balanceEl = document.getElementById("balance");
const incomeEl = document.getElementById("total-income");
const expenseEl = document.getElementById("total-expense");

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

// ---------- Entries list ----------

function render() {
  list.innerHTML = "";

  for (const entry of entries) {
    const li = document.createElement("li");
    const card = document.createElement("button");
    card.type = "button";
    card.className = "entry-card " + entry.type;

    const title = entry.category || entry.description;
    const note = entry.category ? entry.description : "";
    card.setAttribute("aria-label", `${title}, ${entry.type}, ${currency.format(entry.amount)}. Tap to edit`);

    const icon = document.createElement("span");
    icon.className = "type-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = categoryIcon(entry.type, entry.category);

    const info = document.createElement("div");
    info.className = "entry-info";
    const desc = document.createElement("p");
    desc.className = "entry-desc";
    desc.textContent = title;
    const meta = document.createElement("p");
    meta.className = "entry-date";
    meta.textContent = (note ? note + " · " : "") + formatDate(entry.date);
    info.append(desc, meta);

    const amount = document.createElement("span");
    amount.className = "entry-amount " + entry.type;
    amount.textContent = (entry.type === "income" ? "+" : "−") + currency.format(entry.amount);

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

const wizard = document.getElementById("wizard");
const wizardTitle = document.getElementById("wizard-title");
const backBtn = document.getElementById("wizard-back");
const steps = [...wizard.querySelectorAll(".step")];
const dots = [...wizard.querySelectorAll(".steps .dot")];
const categoryGrid = document.getElementById("category-grid");
const categoryHint = document.getElementById("category-hint");
const amountForm = document.getElementById("amount-form");
const amountInput = document.getElementById("amount");
const noteInput = document.getElementById("note");
const dateInput = document.getElementById("date");
const postBtn = document.getElementById("post-btn");
const postedMsg = document.getElementById("posted");

const draft = { step: 1, type: null, category: null };
let postedTimer;

function goToStep(step, direction = "forward") {
  draft.step = step;
  steps.forEach((el) => {
    const active = Number(el.dataset.step) === step;
    el.hidden = !active;
    el.classList.remove("slide-forward", "slide-back");
    if (active) {
      void el.offsetWidth; // restart the animation
      el.classList.add(direction === "back" ? "slide-back" : "slide-forward");
    }
  });
  dots.forEach((dot, i) => dot.classList.toggle("active", i < step));
  backBtn.hidden = step === 1;
  wizard.dataset.type = step === 1 ? "" : draft.type;

  if (step === 1) {
    wizardTitle.textContent = "Add Entry";
  } else if (step === 2) {
    wizardTitle.textContent = TYPE_LABEL[draft.type];
    categoryHint.textContent = draft.type === "income" ? "Where did the money come from?" : "What did you spend on?";
    renderCategoryCards();
  } else {
    wizardTitle.textContent = "Amount";
    document.getElementById("chosen-icon").textContent = categoryIcon(draft.type, draft.category);
    document.getElementById("chosen-type").textContent = TYPE_LABEL[draft.type];
    document.getElementById("chosen-category").textContent = draft.category;
    postBtn.textContent = "Post " + TYPE_LABEL[draft.type];
    amountInput.focus();
  }
}

function renderCategoryCards() {
  categoryGrid.innerHTML = "";
  for (const cat of CATEGORIES[draft.type]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-card " + draft.type;
    const icon = document.createElement("span");
    icon.className = "category-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = cat.icon;
    const name = document.createElement("span");
    name.className = "category-name";
    name.textContent = cat.name;
    btn.append(icon, name);
    btn.addEventListener("click", () => {
      draft.category = cat.name;
      goToStep(3);
    });
    categoryGrid.append(btn);
  }
}

wizard.querySelectorAll(".step[data-step='1'] .type-card").forEach((card) => {
  card.addEventListener("click", () => {
    if (draft.type !== card.dataset.type) draft.category = null;
    draft.type = card.dataset.type;
    postedMsg.hidden = true;
    goToStep(2);
  });
});

backBtn.addEventListener("click", () => goToStep(draft.step - 1, "back"));
document.getElementById("chosen").addEventListener("click", () => goToStep(2, "back"));

amountForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = parseAmount(amountInput.value);
  if (!(amount > 0) || !draft.type || !draft.category) return;

  postBtn.disabled = true;
  try {
    const created = await api("POST", "", {
      type: draft.type,
      category: draft.category,
      description: noteInput.value.trim(),
      amount,
      date: dateInput.value || today(),
    });
    entries.push(created);
    sortEntries();
    showStatus("");
    render();

    amountInput.value = "";
    noteInput.value = "";
    dateInput.value = today();
    draft.type = null;
    draft.category = null;
    goToStep(1, "back");
    postedMsg.hidden = false;
    clearTimeout(postedTimer);
    postedTimer = setTimeout(() => (postedMsg.hidden = true), 2500);
  } catch (err) {
    showStatus(err.message);
  } finally {
    postBtn.disabled = false;
  }
});

// ---------- Edit sheet ----------

const editDialog = document.getElementById("edit-dialog");
const editForm = document.getElementById("edit-form");
const editCategories = document.getElementById("edit-categories");
const editAmount = document.getElementById("edit-amount");
const editNote = document.getElementById("edit-note");
const editDate = document.getElementById("edit-date");
const editSave = document.getElementById("edit-save");
const editDelete = document.getElementById("edit-delete");
let editingId = null;
let editCategory = "";

function renderEditCategories() {
  const type = editForm.elements.type.value;
  editCategories.innerHTML = "";
  for (const cat of CATEGORIES[type]) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "category-card " + type;
    btn.setAttribute("role", "radio");
    btn.setAttribute("aria-checked", String(cat.name === editCategory));
    const icon = document.createElement("span");
    icon.className = "category-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = cat.icon;
    const name = document.createElement("span");
    name.className = "category-name";
    name.textContent = cat.name;
    btn.append(icon, name);
    btn.addEventListener("click", () => {
      editCategory = cat.name;
      renderEditCategories();
    });
    editCategories.append(btn);
  }
}

function openEditor(entry) {
  editingId = entry.id;
  editForm.elements.type.value = entry.type;
  editCategory = entry.category;
  // Older entries without a category keep their text as the note.
  editNote.value = entry.description;
  editAmount.value = entry.amount;
  editDate.value = entry.date;
  editSave.disabled = false;
  editDelete.disabled = false;
  renderEditCategories();
  editDialog.showModal();
}

function closeEditor() {
  editingId = null;
  editDialog.close();
}

editForm.querySelectorAll("input[name=type]").forEach((radio) => {
  radio.addEventListener("change", () => {
    if (!CATEGORIES[radio.value].some((c) => c.name === editCategory)) editCategory = "";
    renderEditCategories();
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
  if (!(amount > 0) || editingId === null) return;
  if (!editCategory && !note) {
    alert("Choose a category");
    return;
  }

  editSave.disabled = true;
  try {
    const updated = await api("PUT", "?id=" + encodeURIComponent(editingId), {
      type: editForm.elements.type.value,
      category: editCategory,
      description: note,
      amount,
      date: editDate.value,
    });
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
  const entry = entries.find((e) => e.id === editingId);
  if (!entry || !confirm(`Delete "${entry.category || entry.description}"?`)) return;

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
goToStep(1);
loadEntries();
