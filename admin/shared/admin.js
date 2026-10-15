// 管理画面（https://admin.sk-hub.jp/）の共通部分。どのページも startAdmin({ page, onReady }) を呼ぶだけで、
//   上のバー・左のナビゲーション・ログインの確認（ログインしていない／管理者ではない／管理者）・トーストがそろう
// 管理者 = 開発者（config/developers に UID がある Google ログイン）。config/developers は登録された本人だけが読めるので、
//   読めたら管理者（/inbox/・/studio/・/view/editor/ と同じ確かめ方）。データそのものは Firestore のルールで守られている
// ファイルは sk-hub.jp の admin/ に置き、admin.sk-hub.jp（_workers/admin/ の Worker）から開く。中のパスは admin.sk-hub.jp での形（/inbox/・/shared/…）で書く
import { db, signIn, signOutAccount, watchAccount } from "/assets/hub/account.js";
import {
  Timestamp, addDoc, collection, doc, getCountFromServer, getDoc, getDocs, query, serverTimestamp, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export { db };
export const NEW_ORIGIN = "https://sk-hub.jp";

// 旧ドメイン（sy9-k.github.io/admin/）から移ってきたときに、そのブラウザの設定（表示・並べかえ・返事の定型文など）を受け取る。
//   旧ドメインの転送ページが #from-old=…（JSON を base64url にしたもの）を付けて開く。# のあとはサーバーに送られない
//   こちらにすでにある設定は上書きしない
(function takeOverOldSettings() {
  const m = location.hash.match(/^#from-old=([A-Za-z0-9_-]+)$/);
  if (!m) return;
  history.replaceState(null, "", location.pathname + location.search);
  try {
    const bin = atob(m[1].replace(/-/g, "+").replace(/_/g, "/"));
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
    Object.entries(data || {}).forEach(([k, v]) => {
      if (!/^sk_(theme|admin_[a-z_]+)$/.test(k) || typeof v !== "string" || localStorage.getItem(k) !== null) return;
      localStorage.setItem(k, v);
    });
  } catch (e) { /* 読めなければ受け取らない */ }
})();
export const DAY_MS = 24 * 60 * 60 * 1000;
export const YEAR_MS = 365 * DAY_MS;

// ナビゲーション（上から順に。heading で区切る）
export const NAV = [
  { id: "dashboard", href: "/", icon: "dashboard", label: "ダッシュボード" },
  { heading: "連絡" },
  { id: "inbox", href: "/inbox/", icon: "inbox", label: "お問い合わせ" },
  { id: "notices", href: "/notices/", icon: "campaign", label: "お知らせを送る" },
  { id: "articles", href: "/articles/", icon: "edit_note", label: "記事エディター" },
  { id: "maintenance", href: "/maintenance/", icon: "construction", label: "メンテナンスの告知" },
  { heading: "ユーザー" },
  { id: "accounts", href: "/accounts/", icon: "manage_search", label: "アカウントを探す" },
  { id: "access", href: "/access/", icon: "shield_person", label: "アクセスの制限" },
  { heading: "コンテンツ" },
  { id: "share", href: "/share/", icon: "lock_open", label: "SK Share" },
  { id: "files", href: "/files/", icon: "folder_open", label: "試作品のファイル" },
  { heading: "運用" },
  { id: "cleanup", href: "/cleanup/", icon: "cleaning_services", label: "期限切れの掃除" },
  { id: "migration", href: "/migration/", icon: "moving", label: "移行の進み具合" },
  { id: "settings", href: "/settings/", icon: "tune", label: "設定と情報" },
  { id: "logs", href: "/logs/", icon: "history", label: "操作の記録" }
];

// ---------- 小さな道具 ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}
export function icon(name, fill) {
  const s = el("span", `msr${fill ? " msr--fill" : ""}`, name);
  s.setAttribute("aria-hidden", "true");
  return s;
}
export function button(label, { kind = "m3-btn", iconName, small, onClick, type = "button" } = {}) {
  const b = el("button", `${kind} m3-state${small ? " ad-btn-sm" : ""}`);
  b.type = type;
  if (iconName) b.append(icon(iconName));
  if (kind === "m3-btn" || kind.startsWith("m3-btn")) b.append(el("span", "vw-spinner"));
  b.append(document.createTextNode(label));
  if (onClick) b.addEventListener("click", onClick);
  return b;
}
export function iconButton(name, label, onClick) {
  const b = el("button", "icon-btn m3-state");
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.append(icon(name));
  if (onClick) b.addEventListener("click", onClick);
  return b;
}
export function badge(text, kind) { return el("span", `ad-badge${kind ? ` ad-badge--${kind}` : ""}`, text); }
export function card(titleIcon, title, ...children) {
  const c = el("section", "ad-card");
  const h = el("h2", "ad-card__title");
  h.append(icon(titleIcon), document.createTextNode(title));
  c.append(h, ...children);
  return c;
}
export function listItem({ iconName, title, sub, end, href }) {
  const li = el(href ? "a" : "li", "ad-li");
  if (href) li.href = href;
  if (iconName) { const i = el("span", "ad-li__icon"); i.append(icon(iconName)); li.append(i); }
  const t = el("span", "ad-li__text");
  t.append(el("span", "ad-li__title", title));
  if (sub != null) t.append(typeof sub === "string" ? el("span", "ad-li__sub", sub) : sub);
  li.append(t);
  if (end) { const e = el("span", "ad-li__end"); e.append(...[].concat(end)); li.append(e); }
  return li;
}
export function empty(text, iconName = "inbox") {
  const p = el("p", "ad-empty");
  p.append(icon(iconName), document.createTextNode(text));
  return p;
}
export async function busy(btn, fn) {
  if (btn.disabled) return undefined;
  btn.disabled = true;
  btn.classList.add("is-busy");
  try { return await fn(); } finally { btn.disabled = false; btn.classList.remove("is-busy"); }
}

// 日時
export const toMillis = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : v instanceof Date ? v.getTime() : null);
export function fmtDate(v) {
  const ms = toMillis(v);
  return ms == null ? "-" : new Date(ms).toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" });
}
export function fmtDateTime(v) {
  const ms = toMillis(v);
  return ms == null ? "-" : new Date(ms).toLocaleString("ja-JP", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
export function fmtAgo(v) {
  const ms = toMillis(v);
  if (ms == null) return "-";
  const diff = Date.now() - ms;
  if (diff < 60 * 1000) return "たった今";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分前`;
  if (diff < DAY_MS) return `${Math.floor(diff / 3600000)} 時間前`;
  if (diff < 30 * DAY_MS) return `${Math.floor(diff / DAY_MS)} 日前`;
  return fmtDate(ms);
}
export const ago = (ms) => Timestamp.fromMillis(Date.now() - ms);
export const num = (n) => (n == null ? "-" : Number(n).toLocaleString("ja-JP"));

// エラーの説明。permission-denied は、たいてい Firestore のルールがまだ反映されていないとき
export function explain(err) {
  const code = (err && err.code) || "";
  if (code === "permission-denied") return "読み書きする権限がありません。Firestore のルール（y-filter リポジトリの systems/firestore.rules）が反映されているか確かめてください。";
  if (code === "failed-precondition") return `インデックスが必要です（${err.message || code}）。Firebase コンソールのエラーのリンクから作れます。`;
  if (code === "unavailable") return "SK Hub Systems に接続できませんでした。ネットワークを確かめてください。";
  return `うまくいきませんでした（${code || (err && err.message) || err}）`;
}
export function errorNote(err) {
  const p = el("p", "ad-note ad-note--error");
  p.append(icon("error"), el("span", null, explain(err)));
  return p;
}
export function note(text, kind, iconName = "info") {
  const p = el("p", `ad-note${kind ? ` ad-note--${kind}` : ""}`);
  p.append(icon(iconName), el("span", null, text));
  return p;
}

export function toast(text) {
  let box = $("[data-ad-toast]");
  if (!box) {
    box = el("div", "snackbar");
    box.dataset.adToast = "";
    box.setAttribute("role", "status");
    box.setAttribute("aria-live", "polite");
    box.append(el("span"));
    document.body.append(box);
  }
  box.firstChild.textContent = text;
  box.classList.add("is-on");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove("is-on"), 4000);
}
export function confirmDialog(opts) {
  return window.M3 ? window.M3.confirm(opts) : Promise.resolve(window.confirm(`${opts.title}\n${opts.text || ""}`));
}
export function promptDialog(opts) {
  return window.M3 ? window.M3.prompt(opts) : Promise.resolve(window.prompt(opts.title, opts.value || ""));
}
export async function copyText(text, done = "コピーしました") {
  try { await navigator.clipboard.writeText(text); toast(done); } catch (e) { toast("コピーできませんでした"); }
}

// ---------- Firestore の道具 ----------
// 数だけ数える（ドキュメントを読まないので安い）
export async function countWhere(q) {
  const snap = await getCountFromServer(q);
  return snap.data().count;
}
// 条件に合うものを消す。q には limit(400) を付けておく（1 回に最大 2000 件。/inbox/ から移したもの）
export async function purgeWhere(q, filter) {
  let total = 0;
  for (let round = 0; round < 5; round += 1) {
    const snap = await getDocs(q);
    const docs = filter ? snap.docs.filter(filter) : snap.docs;
    if (docs.length) {
      const batch = writeBatch(db);
      docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      total += docs.length;
    }
    if (snap.size < 400 || (filter && docs.length < snap.size)) break;
  }
  return total;
}

// 操作の記録（adminLogs）。だれが・いつ・何をしたか。1 年で消す（/cleanup/）
//   action: 決まった名前（LOG_LABEL）/ target: 相手の ID など / detail: 短い説明
export const LOG_LABEL = {
  "account.view": "アカウントを見た",
  "notice.send": "お知らせを送った",
  "notice.broadcast": "お知らせをまとめて送った",
  "contact.reply": "お問い合わせに返事した",
  "contact.done": "お問い合わせを対応済みにした",
  "contact.reopen": "お問い合わせを未対応に戻した",
  "contact.delete": "お問い合わせを削除した",
  "article.save": "記事を保存した",
  "article.delete": "記事を削除した",
  "share.save": "SK Share を保存した",
  "share.delete": "SK Share を削除した",
  "block.add": "アクセスを制限した",
  "block.remove": "アクセスの制限を解除した",
  "maintenance.save": "メンテナンスの告知を変えた",
  "cleanup.run": "期限切れのデータを消した",
  "cleanup.auto": "期限切れのデータを自動で消した"
};
let currentUser = null;
let logWarned = false;
export async function logAction(action, target = "", detail = "") {
  if (!currentUser) return;
  try {
    await addDoc(collection(db, "adminLogs"), {
      action,
      target: String(target).slice(0, 200),
      detail: String(detail).slice(0, 500),
      uid: currentUser.uid,
      createdAt: serverTimestamp(),
      expireAt: Timestamp.fromMillis(Date.now() + YEAR_MS)
    });
  } catch (err) {
    // ルールがまだ反映されていないときは、操作そのものは止めない
    if (!logWarned) { logWarned = true; console.warn("[admin] 操作の記録を残せませんでした", err); }
  }
}
export const me = () => currentUser;

// ---------- 画面の組み立て ----------
function buildShell(page) {
  const main = $("[data-ad-ready]");
  const app = el("div", "ad-app");
  const bar = el("header", "ad-bar");
  const menu = iconButton("menu", "メニュー", () => app.classList.toggle("is-nav-open"));
  menu.classList.add("ad-bar__menu");
  const brand = el("a", "vw-brand m3-state");
  brand.href = "/";
  const logo = el("img");
  logo.src = "/assets/logo.svg";
  logo.alt = "";
  logo.width = logo.height = 28;
  brand.append(logo, el("span", null, "SK 管理"));
  const who = el("span", "ad-bar__who");
  who.dataset.adWho = "";
  const site = el("a", "icon-btn m3-state");
  site.href = `${NEW_ORIGIN}/`;
  site.target = "_blank";
  site.rel = "noopener";
  site.title = "sk-hub.jp を開く";
  site.setAttribute("aria-label", "sk-hub.jp を開く");
  site.append(icon("open_in_new"));
  const out = iconButton("logout", "ログアウト", () => signOutAccount());
  out.dataset.adSignout = "";
  out.hidden = true;
  bar.append(menu, brand, el("span", "vw-bar__space"), who, site, out);

  const body = el("div", "ad-body is-gate");
  const nav = el("nav", "ad-nav");
  nav.setAttribute("aria-label", "管理画面のメニュー");
  NAV.forEach((n) => {
    if (n.heading) { nav.append(el("p", "ad-nav__heading", n.heading)); return; }
    const a = el("a", "ad-nav__item m3-state");
    a.href = n.href;
    if (n.id === page) a.setAttribute("aria-current", "page");
    const b = el("span", "ad-nav__badge");
    b.dataset.adBadge = n.id;
    a.append(icon(n.icon), el("span", "ad-nav__label", n.label), b);
    nav.append(a);
  });
  const scrim = el("div", "ad-scrim");
  scrim.addEventListener("click", () => app.classList.remove("is-nav-open"));

  // ゲート
  const loading = el("div", "ad-gate");
  loading.dataset.adView = "loading";
  loading.append(el("span", "vw-spinner"));
  const gate = (view, iconName, title, lead, actions, error) => {
    const g = el("div", "ad-gate");
    g.dataset.adView = view;
    g.hidden = true;
    const c = el("div", "vw-gate__card");
    const i = el("span", `vw-gate__icon${error ? " ad-gate__icon--error" : ""}`);
    i.append(icon(iconName, true));
    const l = el("p", "vw-gate__lead", lead);
    l.dataset.adLead = view;
    c.append(i, el("h1", "vw-gate__title", title), l, ...actions);
    g.append(c);
    return g;
  };
  const signInBtn = button("Google でログイン", { iconName: "login", onClick: () => signIn().catch((err) => toast(explain(err))) });
  signInBtn.classList.add("vw-gate__submit");
  const newSite = el("a", "text-btn m3-state", "sk-hub.jp へ");
  newSite.href = `${NEW_ORIGIN}/`;
  const links = el("div", "ad-gate__links");
  links.append(newSite);
  const signedOut = gate("signed-out", "admin_panel_settings", "管理者のログイン", "SK の管理画面です。管理者の Google アカウントでログインしてください。", [signInBtn, links]);
  const otherBtn = button("別のアカウントでログイン", { kind: "m3-btn m3-btn--tonal", onClick: () => signOutAccount() });
  otherBtn.classList.add("vw-gate__submit");
  const newSite2 = newSite.cloneNode(true);
  const links2 = el("div", "ad-gate__links");
  links2.append(newSite2);
  const denied = gate("denied", "block", "管理者専用です", "", [otherBtn, links2], true);

  main.classList.add("ad-main");
  main.dataset.adView = "ready";
  main.hidden = true;
  body.append(nav, scrim, loading, signedOut, denied);
  main.replaceWith(app);
  body.append(main);
  app.append(bar, body);
  return { app, body };
}

function showView(shell, name) {
  $$("[data-ad-view]").forEach((v) => { v.hidden = v.dataset.adView !== name; });
  shell.body.classList.toggle("is-gate", name !== "ready");
  $("[data-ad-signout]").hidden = name !== "ready";
}

export function setBadge(id, n) {
  const b = $(`[data-ad-badge="${id}"]`);
  if (b) b.textContent = n ? (n > 99 ? "99+" : String(n)) : "";
}

// ページを始める。onReady({ user }) は管理者だと分かったときに呼ばれる（後始末の関数を返せる。ログアウトしたときに呼ぶ）
export function startAdmin({ page, onReady }) {
  const shell = buildShell(page);
  let cleanup = null;
  let generation = 0;
  watchAccount(async ({ status, user }) => {
    const gen = ++generation;
    if (typeof cleanup === "function") { try { cleanup(); } catch (e) { /* 何もしない */ } }
    cleanup = null;
    currentUser = null;
    if (status === "signed-out" || !user) { $("[data-ad-who]").textContent = ""; showView(shell, "signed-out"); return; }
    showView(shell, "loading");
    try {
      await getDoc(doc(db, "config", "developers"));
    } catch (err) {
      if (gen !== generation) return;
      $('[data-ad-lead="denied"]').textContent = `ログインしているアカウント（${user.email || user.uid}）には、管理画面を使う権限がありません。SK のサービスは sk-hub.jp でお使いください。`;
      showView(shell, "denied");
      return;
    }
    if (gen !== generation) return;
    currentUser = user;
    $("[data-ad-who]").textContent = user.email || "";
    showView(shell, "ready");
    // 未対応のお問い合わせの数（ナビゲーションのバッジ）
    countWhere(query(collection(db, "contacts"), where("status", "==", "new"))).then((n) => setBadge("inbox", n), () => {});
    try {
      cleanup = await onReady({ user });
    } catch (err) {
      console.error(err);
      toast(explain(err));
    }
  });
}
