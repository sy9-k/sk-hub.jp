// アクセスの制限（/access/）
//   上: 制限しているサポート ID（hub_blocklist）の一覧・追加・解除。前は Firebase コンソールで直接作っていた
//   下: アクセスチェックの記録（hub_access_logs）。新しい順・制限中に開いたものだけ・サポート ID で絞り込み
import {
  collection, getDocs, limit, orderBy, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  $, badge, busy, button, card, confirmDialog, db, el, empty, errorNote, explain, fmtDateTime, me, num, startAdmin, toMillis, toast
} from "/shared/admin.js";
import { REASON_MAX, SUPPORT_ID, block, unblock } from "/shared/blocklist.js";

const root = $("[data-page]");

// ---------- 制限しているサポート ID ----------
const blockList = el("div");
const addForm = el("form", "ad-form");
const fields = el("div", "ad-fields");
const sidField = el("label", "m3-field");
const sidInput = el("input", "m3-field__input ad-mono");
sidInput.placeholder = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx";
sidInput.spellcheck = false;
sidInput.autocomplete = "off";
sidField.append(el("span", "m3-field__label", "サポート ID"), sidInput);
const reasonField = el("label", "m3-field");
const reasonInput = el("input", "m3-field__input");
reasonInput.maxLength = REASON_MAX;
reasonInput.placeholder = "例: いたずらのお問い合わせを繰り返す";
reasonField.append(el("span", "m3-field__label", "理由（自分用のメモ）"), reasonInput);
fields.append(sidField, reasonField);
const addBtn = button("制限する", { kind: "m3-btn ad-danger-btn", iconName: "block", type: "submit" });
const addRow = el("div", "ad-row ad-row--end");
addRow.append(addBtn);
addForm.append(fields, addRow, el("p", "ad-hint", "制限すると、そのブラウザで SK のサイトを開いたときに「アクセスが制限されています」（/usercheck/blocked.html）に移ります。規約・サポート・お問い合わせのページは読めます。"));

addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  busy(addBtn, async () => {
    const sid = sidInput.value.trim();
    if (!SUPPORT_ID.test(sid)) { toast("サポート ID の形が違います（8-4-4-4-12 の英数字）"); sidInput.focus(); return; }
    try {
      await block(sid, reasonInput.value.trim());
      sidInput.value = "";
      reasonInput.value = "";
      toast("制限しました");
      loadBlocks();
    } catch (err) { toast(explain(err)); }
  });
});

async function loadBlocks() {
  try {
    const snap = await getDocs(collection(db, "hub_blocklist"));
    if (snap.empty) { blockList.replaceChildren(empty("制限しているサポート ID はありません。", "verified_user")); return; }
    const wrap = el("div", "ad-table-wrap");
    const table = el("table", "ad-table ad-table--stack");
    const thead = el("thead");
    const hr = el("tr");
    ["サポート ID", "理由", "制限した日", "", ""].forEach((h) => hr.append(el("th", null, h)));
    thead.append(hr);
    const tbody = el("tbody");
    snap.docs
      .sort((a, b) => (toMillis(b.data().createdAt) || 0) - (toMillis(a.data().createdAt) || 0))
      .forEach((d) => {
        const x = d.data();
        const tr = el("tr");
        const idCell = el("td");
        idCell.dataset.label = "サポート ID";
        const a = el("a", "ad-mono", d.id);
        a.href = `/accounts/?sid=${encodeURIComponent(d.id)}`;
        idCell.append(a);
        const reason = el("td", null, x.reason || "（理由なし・Firebase コンソールで作成）");
        reason.dataset.label = "理由";
        const date = el("td", null, x.createdAt ? fmtDateTime(x.createdAt) : "-");
        date.dataset.label = "制限した日";
        const by = el("td", "ad-muted", x.createdBy ? (me() && x.createdBy === me().uid ? "自分" : "別の管理者") : "");
        by.dataset.label = "制限した人";
        const act = el("td");
        act.append(button("解除", { kind: "text-btn", iconName: "lock_open", onClick: async () => {
          if (!(await confirmDialog({ title: "制限を解除しますか？", text: d.id, ok: "解除", icon: "lock_open" }))) return;
          try { await unblock(d.id); toast("解除しました"); loadBlocks(); } catch (err) { toast(explain(err)); }
        } }));
        tr.append(idCell, reason, date, by, act);
        tbody.append(tr);
      });
    table.append(thead, tbody);
    wrap.append(table);
    blockList.replaceChildren(el("p", "ad-hint", `${num(snap.size)} 件`), wrap);
  } catch (err) {
    blockList.replaceChildren(errorNote(err));
  }
}

// ---------- アクセスチェックの記録 ----------
let logFilter = "all";
const logBox = el("div");
const logTabs = el("div", "ad-tabs");
const FILTERS = [["all", "新しい順", "schedule"], ["blocked", "制限中に開いたもの", "block"], ["old", "sy9-k.github.io", "history"], ["new", "sk-hub.jp", "public"]];
FILTERS.forEach(([v, label, ic]) => {
  const b = el("button", "tbs-chip m3-state");
  b.type = "button";
  b.dataset.f = v;
  const i = el("span", "msr", ic);
  i.setAttribute("aria-hidden", "true");
  b.append(i, document.createTextNode(label));
  b.addEventListener("click", () => { logFilter = v; loadLogs(); });
  logTabs.append(b);
});
const sidFilter = el("form", "ad-search");
const sidFilterField = el("label", "m3-field");
const sidFilterInput = el("input", "m3-field__input ad-mono");
sidFilterInput.placeholder = "サポート ID で絞り込む（空なら全部）";
sidFilterField.append(el("span", "m3-field__label", "サポート ID"), sidFilterInput);
sidFilter.append(sidFilterField, button("絞り込む", { kind: "m3-btn m3-btn--tonal", iconName: "filter_alt", type: "submit" }));
sidFilter.addEventListener("submit", (e) => { e.preventDefault(); loadLogs(); });

async function loadLogs() {
  logTabs.querySelectorAll("[data-f]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.f === logFilter)));
  logBox.replaceChildren(el("p", "ad-hint", "読み込み中…"));
  const sid = sidFilterInput.value.trim().toLowerCase();
  try {
    // 並べかえと絞り込みを両方 Firestore でするとインデックスが要るので、絞り込むときは多めに読んでブラウザで並べる
    const col = collection(db, "hub_access_logs");
    let q;
    if (sid) q = query(col, where("uuid", "==", sid), limit(500));
    else if (logFilter === "blocked") q = query(col, where("status", "==", "blocked"), limit(500));
    else if (logFilter === "old") q = query(col, where("page", ">=", "https://sy9-k.github.io"), where("page", "<", "https://sy9-k.github.io"), limit(500));
    else if (logFilter === "new") q = query(col, where("page", ">=", "https://sk-hub.jp"), where("page", "<", "https://sk-hub.jp"), limit(500));
    else q = query(col, orderBy("createdAt", "desc"), limit(100));
    const snap = await getDocs(q);
    let rows = snap.docs.map((d) => d.data());
    if (sid && logFilter === "blocked") rows = rows.filter((r) => r.status === "blocked");
    rows.sort((a, b) => (toMillis(b.createdAt) || 0) - (toMillis(a.createdAt) || 0));
    rows = rows.slice(0, 100);
    if (!rows.length) { logBox.replaceChildren(empty("記録はありません。", "receipt_long")); return; }
    const wrap = el("div", "ad-table-wrap");
    const table = el("table", "ad-table ad-table--stack");
    const hr = el("tr");
    ["日時", "サポート ID", "ページ", "言語", "状態"].forEach((h) => hr.append(el("th", null, h)));
    const thead = el("thead");
    thead.append(hr);
    const tbody = el("tbody");
    rows.forEach((r) => {
      const tr = el("tr");
      const cell = (label, node) => { const td = el("td"); td.dataset.label = label; td.append(node); tr.append(td); };
      cell("日時", document.createTextNode(fmtDateTime(r.createdAt)));
      const a = el("a", "ad-mono", (r.uuid || "").slice(0, 8));
      a.href = `/accounts/?sid=${encodeURIComponent(r.uuid || "")}`;
      a.title = r.uuid || "";
      cell("サポート ID", a);
      cell("ページ", document.createTextNode((r.page || "").replace(/^https?:\/\//, "")));
      cell("言語", document.createTextNode(r.language || ""));
      cell("状態", r.status === "blocked" ? badge("制限中", "error") : badge("通常"));
      tbody.append(tr);
    });
    table.append(thead, tbody);
    wrap.append(table);
    logBox.replaceChildren(el("p", "ad-hint", `新しい ${num(rows.length)} 件`), wrap);
  } catch (err) {
    logBox.replaceChildren(errorNote(err));
  }
}

root.append(
  card("add_moderator", "サポート ID を制限する", addForm),
  card("gpp_bad", "制限しているサポート ID", blockList),
  card("receipt_long", "アクセスチェックの記録", logTabs, sidFilter, logBox)
);

startAdmin({
  page: "access",
  onReady: () => {
    const sid = new URLSearchParams(location.search).get("sid");
    if (sid) sidInput.value = sid;
    loadBlocks();
    loadLogs();
  }
});
