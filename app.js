const DB_NAME = "expense-tracker";
const STORE = "expenses";
const SHEET_STORE = "sheets";
const LAST_SHEET_KEY = "expense-tracker:last-sheet-id";
let db;
let editingId = null;
let currentSheetId = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const idb = req.result;
      let store;
      if (!idb.objectStoreNames.contains(STORE)) {
        store = idb.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
        store.createIndex("date", "date");
      } else {
        store = req.transaction.objectStore(STORE);
      }
      if (!store.indexNames.contains("sheetId")) {
        store.createIndex("sheetId", "sheetId");
      }
      if (!idb.objectStoreNames.contains(SHEET_STORE)) {
        idb.createObjectStore(SHEET_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function ensureDefaultSheetAndMigrate() {
  const sheets = await getAllSheets();
  const allExpenses = await getAllExpensesRaw();
  const unassigned = allExpenses.filter((it) => it.sheetId === undefined || it.sheetId === null);

  let defaultSheetId = sheets.length > 0 ? sheets[0].id : null;
  if (sheets.length === 0) {
    defaultSheetId = await addSheet({ name: "ทั่วไป", createdAt: new Date().toISOString() });
  }

  if (unassigned.length > 0) {
    for (const it of unassigned) {
      it.sheetId = defaultSheetId;
      await updateExpense(it);
    }
  }

  const saved = localStorage.getItem(LAST_SHEET_KEY);
  const freshSheets = await getAllSheets();
  const validIds = freshSheets.map((s) => s.id);
  if (saved && validIds.includes(Number(saved))) {
    currentSheetId = Number(saved);
  } else {
    currentSheetId = freshSheets[0].id;
  }
}

function getAllSheets() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SHEET_STORE, "readonly");
    const req = tx.objectStore(SHEET_STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.id - b.id));
    req.onerror = () => reject(req.error);
  });
}

function addSheet(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SHEET_STORE, "readwrite");
    const req = tx.objectStore(SHEET_STORE).add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function renameSheet(id, name) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SHEET_STORE, "readwrite");
    const store = tx.objectStore(SHEET_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const rec = getReq.result;
      if (!rec) return resolve();
      rec.name = name;
      const putReq = store.put(rec);
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

function deleteSheet(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STORE, SHEET_STORE], "readwrite");
    const expStore = tx.objectStore(STORE);
    const idx = expStore.index("sheetId");
    const range = IDBKeyRange.only(id);
    idx.openCursor(range).onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.objectStore(SHEET_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getAllExpensesRaw() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => a.id - b.id));
    req.onerror = () => reject(req.error);
  });
}

function getAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(
      req.result
        .filter((it) => it.sheetId === currentSheetId)
        .sort((a, b) => a.id - b.id)
    );
    req.onerror = () => reject(req.error);
  });
}

function addExpense(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function updateExpense(record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function deleteExpense(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function clearAll() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const idx = store.index("sheetId");
    const range = IDBKeyRange.only(currentSheetId);
    idx.openCursor(range).onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fmtMoney(n) {
  return Number(n).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

async function render() {
  const items = await getAll();
  const listEl = document.getElementById("list");
  const totalEl = document.getElementById("total-amount");

  const total = items.reduce((sum, it) => sum + Number(it.amount), 0);
  totalEl.textContent = fmtMoney(total) + " บาท";

  if (items.length === 0) {
    listEl.innerHTML = '<div class="empty">ยังไม่มีรายการ</div>';
    return;
  }

  listEl.innerHTML = items.map((it, idx) => {
    let thumb = "📄";
    if (it.attachment && it.attachment.dataUrl && it.attachment.type.startsWith("image/")) {
      thumb = `<img class="thumb" src="${it.attachment.dataUrl}" data-id="${it.id}">`;
    } else if (it.attachment) {
      thumb = `<div class="thumb" data-id="${it.id}">📄</div>`;
    } else {
      thumb = `<div class="thumb" style="opacity:.3">—</div>`;
    }
    return `
      <div class="item">
        <div class="seq">${idx + 1}</div>
        ${thumb}
        <div class="info">
          <div class="name">${escapeHtml(it.name)}</div>
          <div class="date">${it.date}</div>
        </div>
        <div class="amount">${fmtMoney(it.amount)}</div>
        <button class="edit" data-edit="${it.id}">✎</button>
        <button class="del" data-del="${it.id}">✕</button>
      </div>
    `;
  }).join("");

  listEl.querySelectorAll(".thumb[data-id]").forEach((el) => {
    el.addEventListener("click", () => openAttachment(Number(el.dataset.id)));
  });
  listEl.querySelectorAll("[data-del]").forEach((el) => {
    el.addEventListener("click", async () => {
      if (confirm("ลบรายการนี้?")) {
        await deleteExpense(Number(el.dataset.del));
        if (editingId === Number(el.dataset.del)) cancelEdit();
        render();
      }
    });
  });
  listEl.querySelectorAll("[data-edit]").forEach((el) => {
    el.addEventListener("click", () => startEdit(Number(el.dataset.edit)));
  });
}

async function startEdit(id) {
  const items = await getAll();
  const item = items.find((i) => i.id === id);
  if (!item) return;
  editingId = id;

  document.getElementById("name").value = item.name;
  document.getElementById("amount").value = item.amount;
  document.getElementById("date").value = item.date;
  document.getElementById("attachment").value = "";

  const wrap = document.getElementById("preview-wrap");
  if (item.attachment) {
    if (item.attachment.type.startsWith("image/")) {
      wrap.innerHTML = `<img src="${item.attachment.dataUrl}"><div class="file-chip">เอกสารแนบเดิม (เลือกไฟล์ใหม่เพื่อเปลี่ยน)</div>`;
    } else {
      wrap.innerHTML = `<span class="file-chip">📄 ${escapeHtml(item.attachment.name)} (เอกสารแนบเดิม)</span>`;
    }
  } else {
    wrap.innerHTML = "";
  }

  document.getElementById("form-title").textContent = "แก้ไขรายการ";
  document.getElementById("submit-btn").textContent = "บันทึกการแก้ไข";
  document.getElementById("cancel-edit-btn").classList.remove("hidden");
  document.getElementById("form-card").scrollIntoView({ behavior: "smooth" });
}

function cancelEdit() {
  editingId = null;
  document.getElementById("expense-form").reset();
  document.getElementById("preview-wrap").innerHTML = "";
  document.getElementById("date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("form-title").textContent = "เพิ่มรายการ";
  document.getElementById("submit-btn").textContent = "บันทึกรายการ";
  document.getElementById("cancel-edit-btn").classList.add("hidden");
}

async function openAttachment(id) {
  const items = await getAll();
  const item = items.find((i) => i.id === id);
  if (!item || !item.attachment) return;
  const modal = document.getElementById("modal");
  const body = document.getElementById("modal-body");
  if (item.attachment.type.startsWith("image/")) {
    body.innerHTML = `<img src="${item.attachment.dataUrl}">`;
  } else if (item.attachment.type === "application/pdf") {
    body.innerHTML = `<iframe src="${item.attachment.dataUrl}"></iframe>`;
  } else {
    body.innerHTML = `<a href="${item.attachment.dataUrl}" download="${escapeHtml(item.attachment.name)}">ดาวน์โหลดไฟล์แนบ</a>`;
  }
  modal.classList.remove("hidden");
}

document.getElementById("modal-close").addEventListener("click", () => {
  document.getElementById("modal").classList.add("hidden");
});
document.getElementById("modal").addEventListener("click", (e) => {
  if (e.target.id === "modal") e.target.classList.add("hidden");
});

document.getElementById("attachment").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const wrap = document.getElementById("preview-wrap");
  wrap.innerHTML = "";
  if (!file) return;
  if (file.type.startsWith("image/")) {
    const url = await fileToDataURL(file);
    wrap.innerHTML = `<img src="${url}">`;
  } else {
    wrap.innerHTML = `<span class="file-chip">📄 ${escapeHtml(file.name)}</span>`;
  }
});

document.getElementById("expense-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("name").value.trim();
  const amount = parseFloat(document.getElementById("amount").value);
  const date = document.getElementById("date").value;
  const fileInput = document.getElementById("attachment");
  const file = fileInput.files[0];

  let attachment = null;
  if (file) {
    const dataUrl = await fileToDataURL(file);
    attachment = { name: file.name, type: file.type, dataUrl };
  }

  if (editingId !== null) {
    const items = await getAll();
    const existing = items.find((i) => i.id === editingId);
    if (!attachment && existing) attachment = existing.attachment;
    await updateExpense({ id: editingId, name, amount, date, attachment, sheetId: currentSheetId });
    cancelEdit();
  } else {
    await addExpense({ name, amount, date, attachment, sheetId: currentSheetId });
    e.target.reset();
    document.getElementById("preview-wrap").innerHTML = "";
    document.getElementById("date").value = new Date().toISOString().slice(0, 10);
  }
  render();
});

document.getElementById("cancel-edit-btn").addEventListener("click", cancelEdit);

document.getElementById("add-next-btn").addEventListener("click", () => {
  cancelEdit();
  document.getElementById("form-card").scrollIntoView({ behavior: "smooth" });
  document.getElementById("name").focus();
});

document.getElementById("export-btn").addEventListener("click", async () => {
  const items = await getAll();
  if (items.length === 0) {
    alert("ไม่มีข้อมูลให้ส่งออก");
    return;
  }
  const header = ["ลำดับ", "ชื่อรายการ", "ยอด", "วันที่", "เอกสารแนบ"];
  const rows = items.map((it, idx) => [
    idx + 1,
    it.name,
    it.amount,
    it.date,
    it.attachment ? it.attachment.name : "-",
  ]);
  const total = items.reduce((s, it) => s + Number(it.amount), 0);
  rows.push(["", "รวมทั้งหมด", total, "", ""]);

  const csv = "﻿" + [header, ...rows]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const sheets = await getAllSheets();
  const sheetName = sheets.find((s) => s.id === currentSheetId)?.name || "รายงาน";
  a.download = `${sheetName}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("export-pdf-btn").addEventListener("click", async () => {
  const items = await getAll();
  if (items.length === 0) {
    alert("ไม่มีข้อมูลให้ส่งออก");
    return;
  }
  const total = items.reduce((s, it) => s + Number(it.amount), 0);
  const today = new Date().toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric" });
  const sheets = await getAllSheets();
  const sheetName = sheets.find((s) => s.id === currentSheetId)?.name || "";

  const rowsHtml = items.map((it, idx) => {
    let attachCell = "-";
    if (it.attachment) {
      if (it.attachment.type.startsWith("image/")) {
        attachCell = `<img class="attach-img" src="${it.attachment.dataUrl}">`;
      } else {
        attachCell = escapeHtml(it.attachment.name);
      }
    }
    return `
      <tr>
        <td>${idx + 1}</td>
        <td>${escapeHtml(it.name)}</td>
        <td>${it.date}</td>
        <td class="num">${fmtMoney(it.amount)}</td>
        <td>${attachCell}</td>
      </tr>
    `;
  }).join("");

  document.getElementById("print-report").innerHTML = `
    <h1>รายงานสรุปค่าใช้จ่าย: ${escapeHtml(sheetName)}</h1>
    <div class="meta">วันที่ออกรายงาน: ${today} | จำนวนรายการ: ${items.length}</div>
    <table>
      <thead>
        <tr>
          <th>ลำดับ</th>
          <th>ชื่อรายการ</th>
          <th>วันที่</th>
          <th class="num">ยอด (บาท)</th>
          <th>เอกสารแนบ</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
      <tfoot>
        <tr>
          <td colspan="3">รวมทั้งหมด</td>
          <td class="num">${fmtMoney(total)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
  `;

  window.print();
});

document.getElementById("clear-btn").addEventListener("click", async () => {
  if (confirm("ยืนยันลบข้อมูลทั้งหมด? การกระทำนี้ไม่สามารถย้อนกลับได้")) {
    await clearAll();
    render();
  }
});

async function renderSheetSelector() {
  const sheets = await getAllSheets();
  const select = document.getElementById("sheet-select");
  select.innerHTML = sheets.map((s) =>
    `<option value="${s.id}" ${s.id === currentSheetId ? "selected" : ""}>${escapeHtml(s.name)}</option>`
  ).join("");
}

document.getElementById("sheet-select").addEventListener("change", async (e) => {
  currentSheetId = Number(e.target.value);
  localStorage.setItem(LAST_SHEET_KEY, String(currentSheetId));
  cancelEdit();
  render();
});

document.getElementById("new-sheet-btn").addEventListener("click", async () => {
  const name = prompt("ตั้งชื่อค่าใช้จ่ายหลัก (เช่น เดือนมิถุนายน, โปรเจกต์ A):");
  if (!name || !name.trim()) return;
  const id = await addSheet({ name: name.trim(), createdAt: new Date().toISOString() });
  currentSheetId = id;
  localStorage.setItem(LAST_SHEET_KEY, String(currentSheetId));
  cancelEdit();
  await renderSheetSelector();
  render();
});

document.getElementById("rename-sheet-btn").addEventListener("click", async () => {
  const sheets = await getAllSheets();
  const current = sheets.find((s) => s.id === currentSheetId);
  if (!current) return;
  const name = prompt("เปลี่ยนชื่อค่าใช้จ่ายหลัก:", current.name);
  if (!name || !name.trim()) return;
  await renameSheet(currentSheetId, name.trim());
  await renderSheetSelector();
});

document.getElementById("delete-sheet-btn").addEventListener("click", async () => {
  const sheets = await getAllSheets();
  if (sheets.length <= 1) {
    alert("ต้องมีอย่างน้อย 1 รายการหลักเสมอ");
    return;
  }
  const current = sheets.find((s) => s.id === currentSheetId);
  if (!current) return;
  if (!confirm(`ลบ "${current.name}" และรายการค่าใช้จ่ายทั้งหมดในนี้? การกระทำนี้ไม่สามารถย้อนกลับได้`)) return;
  await deleteSheet(currentSheetId);
  const remaining = await getAllSheets();
  currentSheetId = remaining[0].id;
  localStorage.setItem(LAST_SHEET_KEY, String(currentSheetId));
  cancelEdit();
  await renderSheetSelector();
  render();
});

(async function init() {
  db = await openDB();
  await ensureDefaultSheetAndMigrate();
  await renderSheetSelector();
  document.getElementById("date").value = new Date().toISOString().slice(0, 10);
  render();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();
