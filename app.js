const STORAGE_KEY = "finance-manager-entries";

const form = document.getElementById("entry-form");
const descriptionInput = document.getElementById("description");
const amountInput = document.getElementById("amount");
const dateInput = document.getElementById("date");
const list = document.getElementById("entries");
const emptyMsg = document.getElementById("empty");
const balanceEl = document.getElementById("balance");
const incomeEl = document.getElementById("total-income");
const expenseEl = document.getElementById("total-expense");

const currency = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

function loadEntries() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveEntries() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable (e.g. private mode); entries stay in memory only.
  }
}

let entries = loadEntries();

function today() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function render() {
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  list.innerHTML = "";

  for (const entry of sorted) {
    const li = document.createElement("li");

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

    const del = document.createElement("button");
    del.className = "delete";
    del.title = "Delete entry";
    del.setAttribute("aria-label", "Delete " + entry.description);
    del.textContent = "✕";
    del.addEventListener("click", () => {
      if (!confirm(`Delete "${entry.description}"?`)) return;
      entries = entries.filter((e) => e.id !== entry.id);
      saveEntries();
      render();
    });

    li.append(info, amount, del);
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

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const amount = Math.round(parseFloat(amountInput.value) * 100) / 100;
  const description = descriptionInput.value.trim();
  if (!description || !(amount > 0)) return;

  entries.push({
    id: Date.now(),
    type: form.elements.type.value,
    description,
    amount,
    date: dateInput.value || today(),
  });
  saveEntries();
  render();

  descriptionInput.value = "";
  amountInput.value = "";
  dateInput.value = today();
  descriptionInput.focus();
});

dateInput.value = today();
render();
