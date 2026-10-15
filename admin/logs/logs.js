// 操作の記録（/logs/）。adminLogs を新しい順に 300 件まで。種類で絞り込む
//   書くのは各ページの logAction()（/shared/admin.js）。1 年で消える（/cleanup/）
import {
  collection, getDocs, limit, orderBy, query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  $, LOG_LABEL, badge, button, card, db, el, empty, errorNote, fmtDateTime, me, num, startAdmin
} from "/shared/admin.js";

const GROUPS = [
  ["", "すべて", "list"],
  ["contact", "お問い合わせ", "inbox"],
  ["notice", "お知らせ", "campaign"],
  ["article", "記事", "edit_note"],
  ["share", "SK Share", "lock_open"],
  ["account", "アカウント", "manage_search"],
  ["block", "アクセスの制限", "shield_person"],
  ["maintenance", "メンテナンス", "construction"],
  ["cleanup", "掃除", "cleaning_services"]
];

const root = $("[data-page]");
const tabs = el("div", "ad-tabs");
const box = el("div");
let group = "";
let rows = [];

GROUPS.forEach(([v, label, ic]) => {
  const b = el("button", "tbs-chip m3-state");
  b.type = "button";
  b.dataset.g = v;
  const i = el("span", "msr", ic);
  i.setAttribute("aria-hidden", "true");
  b.append(i, document.createTextNode(label));
  b.addEventListener("click", () => { group = v; render(); });
  tabs.append(b);
});

function render() {
  tabs.querySelectorAll("[data-g]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.g === group)));
  const shown = rows.filter((r) => !group || String(r.action).startsWith(`${group}.`));
  if (!shown.length) { box.replaceChildren(empty("記録はありません。", "history")); return; }
  const wrap = el("div", "ad-table-wrap");
  const table = el("table", "ad-table ad-table--stack");
  const thead = el("thead");
  const hr = el("tr");
  ["日時", "操作", "内容", "対象", "管理者"].forEach((h) => hr.append(el("th", null, h)));
  thead.append(hr);
  const tbody = el("tbody");
  shown.forEach((r) => {
    const tr = el("tr");
    const cell = (label, node) => { const td = el("td"); td.dataset.label = label; td.append(node); tr.append(td); };
    cell("日時", document.createTextNode(fmtDateTime(r.createdAt)));
    cell("操作", badge(LOG_LABEL[r.action] || r.action, r.action.startsWith("block") || r.action.startsWith("cleanup") ? "warn" : "info"));
    cell("内容", document.createTextNode(r.detail || ""));
    let target = document.createTextNode(r.target || "");
    if (r.action === "account.view" || r.action.startsWith("block")) {
      target = el("a", "ad-mono", r.target);
      target.href = `/accounts/?${/^[0-9a-f]{8}-/i.test(r.target) ? "sid" : "uid"}=${encodeURIComponent(r.target)}`;
    }
    cell("対象", target);
    cell("管理者", el("span", "ad-muted", me() && r.uid === me().uid ? "自分" : (r.uid || "").slice(0, 8)));
    tbody.append(tr);
  });
  table.append(thead, tbody);
  wrap.append(table);
  box.replaceChildren(el("p", "ad-hint", `${num(shown.length)} 件${rows.length >= 300 ? "（新しい 300 件から）" : ""}`), wrap);
}

async function load() {
  box.replaceChildren(el("p", "ad-hint", "読み込み中…"));
  try {
    const snap = await getDocs(query(collection(db, "adminLogs"), orderBy("createdAt", "desc"), limit(300)));
    rows = snap.docs.map((d) => d.data());
    render();
  } catch (err) {
    box.replaceChildren(errorNote(err));
  }
}

const reload = button("読み込み直す", { kind: "m3-btn m3-btn--tonal", iconName: "refresh", small: true, onClick: load });
const head = el("div", "ad-row");
head.append(tabs, el("span", "ad-grow"), reload);
root.append(card("history", "記録", head, box));

startAdmin({ page: "logs", onReady: load });
