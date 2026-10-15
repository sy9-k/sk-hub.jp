// 設定と情報（/settings/）
//   ・Y-FILTER. のブロックリスト（config/categories）の版・カテゴリ・変更履歴を見るだけ。
//     編集は今までどおり、開発者の PC で動かす y-filter リポジトリの systems/blocklist-editor（ルールの決まりで、Web には置かない）
//   ・開発者（config/developers の UID）を見るだけ。増やす・減らすのは Firebase コンソールで
//   ・運用のリンクと、この管理画面の表示（ライト・ダーク。サイトと同じ sk_theme の mode）
import {
  collection, doc, getDoc, getDocs, limit, orderBy, query
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  $, NEW_ORIGIN, badge, card, db, el, errorNote, fmtDateTime, listItem, me, num, startAdmin
} from "/shared/admin.js";

const root = $("[data-page]");
const blocklist = el("div", "ad-stack");
const developers = el("div", "ad-stack");

async function loadBlocklist() {
  try {
    const [snap, hist] = await Promise.all([
      getDoc(doc(db, "config", "categories")),
      getDocs(query(collection(db, "categoryHistory"), orderBy("savedAt", "desc"), limit(10))).catch(() => null)
    ]);
    if (!snap.exists()) { blocklist.replaceChildren(el("p", "ad-hint", "config/categories がありません。")); return; }
    const c = snap.data();
    let data = {};
    try { data = JSON.parse(c.json || "{}"); } catch (e) { /* 読めないときは数だけ出さない */ }
    const names = Object.keys(data);
    const domains = names.reduce((a, k) => a + ((data[k] && data[k].domains) || []).length, 0);
    const keywords = names.reduce((a, k) => a + ((data[k] && data[k].keywords) || []).length, 0);
    const stat = el("p", "ad-stat", `v${num(c.version)}`);
    stat.append(el("small", null, `${fmtDateTime(c.updatedAt)} に更新・${c.updatedBy || ""}`));
    const size = new Blob([c.json || ""]).size;
    const sizeRow = el("div", "ad-row");
    sizeRow.append(badge(`${num(names.length)} カテゴリ`, "info"), badge(`ドメイン ${num(domains)}`), badge(`キーワード ${num(keywords)}`),
      badge(`${num(Math.round(size / 1024))}KB / 879KB`, size > 800000 ? "warn" : ""));
    const wrap = el("div", "ad-table-wrap");
    const table = el("table", "ad-table");
    const hr = el("tr");
    hr.append(el("th", null, "カテゴリ"), el("th", "ad-num", "ドメイン"), el("th", "ad-num", "キーワード"));
    const thead = el("thead");
    thead.append(hr);
    const tbody = el("tbody");
    names.forEach((k) => {
      const tr = el("tr");
      tr.append(el("td", null, k), el("td", "ad-num", num(((data[k] && data[k].domains) || []).length)), el("td", "ad-num", num(((data[k] && data[k].keywords) || []).length)));
      tbody.append(tr);
    });
    table.append(thead, tbody);
    wrap.append(table);
    const details = el("details");
    details.append(el("summary", "ad-hint", "カテゴリごとの数"), wrap);
    blocklist.replaceChildren(stat, sizeRow, details);
    if (hist && !hist.empty) {
      const list = el("ul", "ad-list");
      hist.docs.forEach((d) => {
        const h = d.data();
        list.append(listItem({ iconName: "history", title: `v${num(h.version)}`, sub: `${fmtDateTime(h.savedAt)}・${h.savedBy || ""}` }));
      });
      const hd = el("details");
      hd.append(el("summary", "ad-hint", "変更履歴（新しい 10 件）"), list);
      blocklist.append(hd);
    }
    blocklist.append(el("p", "ad-hint", "編集は、y-filter リポジトリで node systems/blocklist-editor/serve.mjs を動かして、http://localhost:5178/systems/blocklist-editor/ から行います（保存すると、すべての Y-FILTER. にすぐ届きます）。"));
  } catch (err) {
    blocklist.replaceChildren(errorNote(err));
  }
}

async function loadDevelopers() {
  try {
    const snap = await getDoc(doc(db, "config", "developers"));
    const uids = (snap.exists() && snap.data().uids) || [];
    const list = el("ul", "ad-list");
    uids.forEach((uid) => {
      const li = listItem({ iconName: "admin_panel_settings", title: uid, end: me() && uid === me().uid ? badge("自分", "info") : null, href: `/accounts/?uid=${encodeURIComponent(uid)}` });
      li.querySelector(".ad-li__title").classList.add("ad-mono");
      list.append(li);
    });
    developers.replaceChildren(list, el("p", "ad-hint", "開発者を増やす・減らすときは、Firebase コンソールの Firestore で config/developers の uids を直します。開発者は、この管理画面と、ブロックリスト・記事・お問い合わせ・SK Share のすべてを読み書きできます。"));
  } catch (err) {
    developers.replaceChildren(errorNote(err));
  }
}

// 運用のリンク
const LINKS = [
  ["Firebase コンソール（Authentication のユーザー）", "https://console.firebase.google.com/project/y-filter-systems/authentication/users", "group"],
  ["Firebase コンソール（承認済みドメイン）", "https://console.firebase.google.com/project/y-filter-systems/authentication/settings", "domain_verification"],
  ["Firestore のデータ", "https://console.firebase.google.com/project/y-filter-systems/firestore/databases/-default-/data", "database"],
  ["Firestore のルール", "https://console.firebase.google.com/project/y-filter-systems/firestore/databases/-default-/rules", "gavel"],
  ["Firestore の使用量", "https://console.firebase.google.com/project/y-filter-systems/firestore/databases/-default-/usage", "monitoring"],
  ["Google アナリティクス", "https://analytics.google.com/", "insights"],
  ["稼働状況（sk-hub.online）", "https://sk-hub.online/", "monitor_heart"],
  ["GitHub: sy9-k/sk-hub.jp（サイト・この管理画面）", "https://github.com/sy9-k/sk-hub.jp", "code"],
  ["GitHub: sy9-k/sy9-k.github.io（旧ドメイン・試作品のファイル）", "https://github.com/sy9-k/sy9-k.github.io", "code"],
  ["GitHub: sy9-k/y-filter（拡張機能・ルール）", "https://github.com/sy9-k/y-filter", "code"]
];
const links = el("ul", "ad-list");
LINKS.forEach(([label, href, ic]) => {
  const li = listItem({ iconName: ic, title: label, sub: href.replace(/^https:\/\//, ""), href });
  li.target = "_blank";
  li.rel = "noopener";
  links.append(li);
});

// 表示（サイトと同じ sk_theme の mode。アクセントの色は管理画面では使わない）
const theme = el("div", "tbs-seg");
theme.setAttribute("role", "radiogroup");
theme.setAttribute("aria-label", "表示");
const readMode = () => { try { return JSON.parse(localStorage.getItem("sk_theme") || "{}").mode || "auto"; } catch (e) { return "auto"; } };
[["auto", "自動", "brightness_auto"], ["light", "ライト", "light_mode"], ["dark", "ダーク", "dark_mode"]].forEach(([v, label, ic]) => {
  const b = el("button", "tbs-seg__btn m3-state");
  b.type = "button";
  b.setAttribute("role", "radio");
  b.dataset.mode = v;
  const i = el("span", "msr tbs-seg__icon", ic);
  i.setAttribute("aria-hidden", "true");
  const check = el("span", "msr tbs-seg__check", "check");
  check.setAttribute("aria-hidden", "true");
  b.append(check, i, document.createTextNode(label));
  b.addEventListener("click", () => {
    try {
      const t = JSON.parse(localStorage.getItem("sk_theme") || "{}");
      t.mode = v;
      localStorage.setItem("sk_theme", JSON.stringify(t));
    } catch (e) { /* 保存できないときは、このページだけ */ }
    if (v === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", v);
    syncTheme();
  });
  theme.append(b);
});
function syncTheme() {
  const mode = readMode();
  theme.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === mode)));
}
syncTheme();

root.append(
  card("filter_alt", "Y-FILTER. のブロックリスト", blocklist),
  card("admin_panel_settings", "開発者", developers),
  card("link", "運用のリンク", links),
  card("contrast", "管理画面の表示", theme, el("p", "ad-hint", "このブラウザの admin.sk-hub.jp の表示の設定です（sk-hub.jp とは別です）。"))
);

startAdmin({ page: "settings", onReady: () => { loadBlocklist(); loadDevelopers(); } });
