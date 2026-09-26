const PASSWORD_KEY = "finance-manager-password";

const loginSection = document.getElementById("login");
const loginForm = document.getElementById("login-form");
const passwordInput = document.getElementById("password");
const logoutBtn = document.getElementById("logout");
const appSection = document.getElementById("app");
const statusEl = document.getElementById("status");

const form = document.getElementById("entry-form");
const submitBtn = form.querySelector("button[type=submit]");
const descriptionInput = document.getElementById("description");
const amountInput = document.getElementById("amount");
const dateInput = document.getElementById("date");
const list = document.getElementById("entries");
const emptyMsg = document.getElementById("empty");
const balanceEl = document.getElementById("balance");
const incomeEl = document.getElementById("total-income");
const expenseEl = document.getElementById("total-expense");

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

let entries = [];
let password = "";

try {
  password = localStorage.getItem(PASSWORD_KEY) || "";
} catch {
  // Storage unavailable; the password will be asked for each visit.
}

function rememberPassword(value) {
  password = value;
  try {
    if (value) localStorage.setItem(PASSWORD_KEY, value);
    else localStorage.removeItem(PASSWORD_KEY);
  } catch {
    // Ignore storage errors.
  }
}

class UnauthorizedError extends Error {}

async function api(method, query = "", body) {
  const res = await fetch("/api/entries" + query, {
    method,
    headers: {
      Authorization: "Bearer " + password,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new UnauthorizedError(data.error || "Wrong password");
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
  return data;
}

function showStatus(message, isError = true) {
  statusEl.textContent = message || "";
  statusEl.classList.toggle("info", !isError);
  statusEl.hidden = !message;
}

function showLogin(message) {
  rememberPassword("");
  appSection.hidden = true;
  logoutBtn.hidden = true;
  loginSection.hidden = false;
  showStatus(message);
  passwordInput.focus();
}

function showApp() {
  loginSection.hidden = true;
  appSection.hidden = false;
  logoutBtn.hidden = false;
}

function handleError(err) {
  if (err instanceof UnauthorizedError) showLogin(err.message);
  else showStatus(err.message);
}

function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function render() {
  list.innerHTML = "";

  for (const entry of entries) {
    const li = document.createElement("li");
    const card = document.createElement("button");
    card.type = "button";
    card.className = "entry-card " + entry.type;
    card.setAttribute("aria-label", `${entry.description}, ${entry.type}, ${currency.format(entry.amount)}. Tap to edit`);

    const icon = document.createElement("span");
    icon.className = "type-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = entry.type === "income" ? "↓" : "↑";

    const info = document.createElement("div");
    info.className = "entry-info";
    const desc = document.createElement("p");
    desc.className = "entry-desc";
    desc.textContent = entry.description;
    const date = document.createElement("p");
    date.className = "entry-date";
    date.textContent = new Date(entry.date + "T00:00:00").toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
    });
    info.append(desc, date);

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
    showApp();
    showStatus("");
    render();
  } catch (err) {
    handleError(err);
  }
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  rememberPassword(passwordInput.value);
  passwordInput.value = "";
  loadEntries();
});

logoutBtn.addEventListener("click", () => {
  entries = [];
  render();
  showLogin("");
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = Math.round(parseFloat(amountInput.value) * 100) / 100;
  const description = descriptionInput.value.trim();
  if (!description || !(amount > 0)) return;

  submitBtn.disabled = true;
  try {
    const created = await api("POST", "", {
      type: form.elements.type.value,
      description,
      amount,
      date: dateInput.value || today(),
    });
    entries.push(created);
    sortEntries();
    showStatus("");
    render();

    descriptionInput.value = "";
    amountInput.value = "";
    dateInput.value = today();
    descriptionInput.focus();
  } catch (err) {
    handleError(err);
  } finally {
    submitBtn.disabled = false;
  }
});

// Edit sheet
const editDialog = document.getElementById("edit-dialog");
const editForm = document.getElementById("edit-form");
const editDescription = document.getElementById("edit-description");
const editAmount = document.getElementById("edit-amount");
const editDate = document.getElementById("edit-date");
const editSave = document.getElementById("edit-save");
const editDelete = document.getElementById("edit-delete");
let editingId = null;

function openEditor(entry) {
  editingId = entry.id;
  editForm.elements.type.value = entry.type;
  editDescription.value = entry.description;
  editAmount.value = entry.amount;
  editDate.value = entry.date;
  editSave.disabled = false;
  editDelete.disabled = false;
  editDialog.showModal();
}

function closeEditor() {
  editingId = null;
  editDialog.close();
}

document.getElementById("edit-close").addEventListener("click", closeEditor);

// Tap outside the sheet to close it.
editDialog.addEventListener("click", (event) => {
  if (event.target === editDialog) closeEditor();
});

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const amount = Math.round(parseFloat(editAmount.value) * 100) / 100;
  const description = editDescription.value.trim();
  if (!description || !(amount > 0) || editingId === null) return;

  editSave.disabled = true;
  try {
    const updated = await api("PUT", "?id=" + encodeURIComponent(editingId), {
      type: editForm.elements.type.value,
      description,
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
    handleError(err);
  }
});

editDelete.addEventListener("click", async () => {
  const entry = entries.find((e) => e.id === editingId);
  if (!entry || !confirm(`Delete "${entry.description}"?`)) return;

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
    handleError(err);
  }
});

dateInput.value = today();
if (password) loadEntries();
else showLogin("");
