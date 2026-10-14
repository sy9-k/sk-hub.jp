// LINE の中の SK Hub アカウントセンター（/line/。LIFF アプリ「SK Hub アカウントセンター」）
//   ・LIFF のアクセストークンで SK Hub Systems アカウントにログインする（assets/hub/account.js の signInWithLiff。LINE ログインと同じアカウント）
//   ・この LINE につながったアカウントがなければ、新しく作るか、持っているアカウントにつなぐ（ブラウザで開く）
//   ・アカウントの作成（規約への同意）がまだなら /account/ で行い、ここに戻る
//   ・お知らせ（accounts/{UID}/notices）を読む・LINE で受け取るかを切りかえる・公式 LINE を友だちに追加する
//   公式 LINE のボタン（お知らせを見る・アカウントセンター）と、画面の下のメニューから開く。?view=notices（#notices）でお知らせから
import {
  ACCOUNT_TERMS_VERSION, accountPageUrl, currentUser, db, lineStatus, markNoticesSeen, profileOf, rememberAccount, setLineNotify, signInWithLiff
} from "/assets/hub/account.js";
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const LIFF_ID = "2012009401-6XZgXLIL";
const SDK = "https://static.line-scdn.net/liff/edge/2/sdk.js";
const MINI = "https://miniapp.line.me/2011967992-h4iZeucd";
const BOT_ID = "@324czrsr";
const BOT_URL = `https://line.me/R/ti/p/${encodeURIComponent(BOT_ID)}`;
// 公式 LINE のトークを開いて「お問い合わせ」を入れておく（送ると、トークでのお問い合わせが始まる）
const CONTACT_URL = `https://line.me/R/oaMessage/${encodeURIComponent(BOT_ID)}/?${encodeURIComponent("お問い合わせ")}`;
// 持っているアカウントにつなぐ: ふつうのブラウザで開き、ログインしたら LINE ログインでつなぐ（account-page.js の ?link=line）
const LINK_PAGE = "https://sk-hub.jp/account/?link=line";

const app = document.getElementById("app");
const toastEl = document.getElementById("toast");
let liff = null;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const icon = (name) => { const s = el("span", "msr", name); s.setAttribute("aria-hidden", "true"); return s; };
let toastTimer = null;
function toast(text) {
  toastEl.textContent = text;
  toastEl.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("on"), 3500);
}
function btn(cls, label, ic, onClick) {
  const b = el("button", `btn ${cls}`);
  b.type = "button";
  if (ic) b.appendChild(icon(ic));
  b.appendChild(el("span", "", label));
  b.addEventListener("click", onClick);
  return b;
}
function card(title, ic, extra) {
  const c = el("section", "card");
  if (title) {
    const h = el("h2", "h");
    if (ic) h.appendChild(icon(ic));
    h.appendChild(el("span", "", title));
    if (extra) h.appendChild(extra);
    c.appendChild(h);
  }
  return c;
}
// 行（アイコン・見出し・説明・右側）
function row(ic, color, title, sub, right, onClick) {
  const r = el(onClick ? "button" : "div", "row");
  if (onClick) { r.type = "button"; r.addEventListener("click", onClick); }
  const i = el("span", "ic");
  i.style.background = color;
  i.appendChild(icon(ic));
  const lb = el("span", "lb");
  lb.appendChild(el("b", "", title));
  if (sub) lb.appendChild(el("small", "", sub));
  r.append(i, lb);
  if (right) r.appendChild(right);
  else if (onClick) r.appendChild(Object.assign(icon("chevron_right"), { className: "msr go" }));
  return r;
}
function screen(ic, title, text, ...buttons) {
  app.textContent = "";
  const c = el("div", "card center");
  c.append(icon(ic), el("h1", "", title));
  if (text) c.appendChild(el("p", "text", text));
  buttons.forEach((b) => c.appendChild(b));
  app.appendChild(c);
}
// LINE の中では LIFF で開く（ほかのミニアプリ・トーク・ブラウザ）
function open(url, external = false) {
  if (liff && liff.isInClient && liff.isInClient()) {
    try { liff.openWindow({ url, external }); return; } catch (e) { /* 下へ */ }
  }
  location.href = url;
}

function loadLiff() {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK;
    s.onload = () => window.liff.init({ liffId: LIFF_ID }).then(() => resolve(window.liff), reject);
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ---------- ログイン ----------
async function signIn(create) {
  const token = liff && liff.getAccessToken && liff.getAccessToken();
  if (!token) { const e = new Error("no-liff"); e.code = "sk/no-liff"; throw e; }
  return (await signInWithLiff(token, create)).user;
}

function notLinked() {
  screen("link", "SK Hub Systems アカウントにつなぐ",
    "この LINE は、まだ SK Hub Systems アカウントにつながっていません。はじめての人は「新しく作る」、Google などで作ったアカウントがある人は「持っているアカウントにつなぐ」（ブラウザが開きます）を選んでください。",
    btn("btn--line", "新しく作る", "person_add", async (e) => {
      e.currentTarget.disabled = true;
      try { await signIn(true); start(); } catch (err) { e.currentTarget.disabled = false; toast("作れませんでした。時間をおいてもう一度お試しください。"); }
    }),
    btn("btn--tonal", "持っているアカウントにつなぐ", "open_in_browser", () => open(LINK_PAGE, true))
  );
}

// ---------- 画面 ----------
async function start() {
  let user = await currentUser();
  if (!user) {
    if (!liff) { screen("error", "LINE で開いてください", "このページは、LINE の中で開くと使えます。", btn("btn--primary", "アカウントのページへ", "open_in_new", () => { location.href = "/account/"; })); return; }
    if (!liff.isLoggedIn()) {
      // LINE の外のブラウザで開いたとき: LINE でログインしてから戻ってくる
      screen("login", "LINE でログイン", "アカウントセンターを使うには、LINE でログインします。", btn("btn--line", "LINE でログイン", "login", () => liff.login({ redirectUri: location.href })));
      return;
    }
    try {
      user = await signIn(false);
    } catch (err) {
      if (err.code === "sk/not-linked") { notLinked(); return; }
      screen("cloud_off", "読み込めませんでした", err.code === "sk/api-unreachable" || err.code === "auth/network-request-failed"
        ? "ログインのサーバーに接続できませんでした。インターネットの接続を確認してください。"
        : "時間をおいてもう一度お試しください。", btn("btn--primary", "もう一度", "refresh", () => location.reload()));
      return;
    }
  }
  const snap = await getDoc(doc(db, "accounts", user.uid));
  const account = snap.exists() ? snap.data() : null;
  if (!account || account.termsVersion !== ACCOUNT_TERMS_VERSION) {
    screen("verified_user", account ? "規約が新しくなりました" : "アカウントを作成",
      account ? "引き続き使うには、新しい規約を確認して同意してください。" : "SK Hub Systems アカウントの規約を確認して、同意するとアカウントができます。",
      btn("btn--primary", "規約を確認する", "description", () => { location.href = accountPageUrl("/line/"); }));
    return;
  }
  rememberAccount(user, account);
  renderMain(user, account);
}

function renderMain(user, account) {
  app.textContent = "";
  const p = profileOf(user, account);

  // ---- 自分 ----
  const meCard = card();
  const me = el("div", "me");
  const av = el("div", "av");
  if (p.photo) { const img = el("img"); img.src = p.photo; img.alt = ""; img.referrerPolicy = "no-referrer"; av.appendChild(img); }
  else { av.textContent = p.letter; av.style.background = p.colorValue; }
  const who = el("div");
  who.appendChild(el("b", "", p.name || "SK Hub Systems アカウント"));
  const chip = el("span", "chip");
  chip.append(icon("check_circle"), el("span", "", "LINE とつながっています"));
  who.appendChild(chip);
  me.append(av, who);
  meCard.appendChild(me);
  app.appendChild(meCard);

  // ---- お知らせ ----
  const count = el("span", "count");
  count.hidden = true;
  const nCard = card("お知らせ", "notifications", count);
  nCard.id = "notices";
  const list = el("div");
  list.appendChild(el("p", "empty", "読み込んでいます…"));
  nCard.appendChild(list);
  app.appendChild(nCard);
  loadNotices(user, account, list, count);

  // ---- 公式 LINE ----
  const lCard = card("LINE で受け取る", "chat");
  lCard.appendChild(el("p", "text", "新しいお知らせ（お問い合わせへの返事など）があると、SK Hub の公式 LINE で知らせます。お知らせの中身は LINE に送りません。"));
  const lBox = el("div");
  lBox.appendChild(el("p", "empty", "読み込んでいます…"));
  lCard.appendChild(lBox);
  app.appendChild(lCard);
  loadLine(user, lBox);

  // ---- ほか ----
  const oCard = card("ほかのこと", "apps");
  oCard.append(
    row("apps", "#334155", "SK's Toolbox", "時計・Todo・時間割など", null, () => open(MINI)),
    row("sync", "#007f9d", "同期・Toolbox の設定", "オンライン同期・テーマなど", null, () => open(`${MINI}/settings/`)),
    row("chat", "#7c3aed", "お問い合わせ", "公式 LINE のトークで送る", null, () => open(CONTACT_URL)),
    row("manage_accounts", "#2563eb", "アカウントのくわしい設定", "プロフィール・データのダウンロード・削除", null, () => { location.href = "/account/"; })
  );
  app.appendChild(oCard);

  if (location.hash === "#notices" || /[?&]view=notices\b/.test(location.search)) setTimeout(() => nCard.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}

const fmt = new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const toDate = (v) => (v && typeof v.toDate === "function" ? v.toDate() : null);

async function loadNotices(user, account, list, count) {
  let docs;
  try {
    docs = (await getDocs(query(collection(db, "accounts", user.uid, "notices"), orderBy("createdAt", "desc"), limit(30)))).docs;
  } catch (e) {
    list.textContent = "";
    list.appendChild(el("p", "empty", "お知らせを読み込めませんでした。"));
    return;
  }
  list.textContent = "";
  if (!docs.length) { list.appendChild(el("p", "empty", "お知らせはありません。")); return; }
  const seen = toDate(account.noticesSeenAt);
  let unread = 0;
  docs.forEach((d) => {
    const n = d.data();
    const at = toDate(n.createdAt);
    const isNew = !seen || (at && at > seen);
    if (isNew) unread += 1;
    const item = el("div", "nt");
    const b = el("button");
    b.type = "button";
    const title = el("b");
    if (isNew) title.appendChild(el("i"));
    title.appendChild(el("span", "", String(n.title || "お知らせ")));
    const time = el("time", "", at ? fmt.format(at) : "");
    b.append(title, time);
    const body = el("p", "", String(n.body || ""));
    body.hidden = !isNew;
    b.addEventListener("click", () => { body.hidden = !body.hidden; });
    item.append(b, body);
    list.appendChild(item);
  });
  if (unread) {
    count.textContent = `${unread} 件の新着`;
    count.hidden = false;
    // 開いたので、読んだことにする（次に開いたときは新着にしない）
    markNoticesSeen(user).catch(() => {});
  }
}

async function loadLine(user, box) {
  let st;
  try { st = await lineStatus(user); } catch (e) { box.textContent = ""; box.appendChild(el("p", "empty", "読み込めませんでした。")); return; }
  box.textContent = "";
  const sw = el("input", "sw");
  sw.type = "checkbox";
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-label", "お知らせを LINE で受け取る");
  sw.checked = !!st.notify;
  sw.addEventListener("change", async () => {
    sw.disabled = true;
    try {
      const r = await setLineNotify(user, sw.checked);
      sw.checked = !!r.notify;
      toast(sw.checked ? "お知らせを LINE で受け取ります" : "お知らせを LINE で受け取りません");
    } catch (e) {
      sw.checked = !sw.checked;
      toast("変更できませんでした。時間をおいてもう一度お試しください。");
    }
    sw.disabled = false;
  });
  box.appendChild(row("notifications_active", "#cc4900", "お知らせを LINE で受け取る", st.friend === false ? "公式 LINE を友だちに追加すると届きます" : "公式 LINE「SK Hub」から知らせます", sw));
  if (st.friend === false) box.appendChild(row("person_add", "#06c755", "公式 LINE を友だちに追加", `SK Hub（${BOT_ID}）`, null, () => open(BOT_URL)));
}

(async () => {
  try { liff = await loadLiff(); } catch (e) { liff = null; }
  start().catch((e) => {
    console.error(e);
    screen("error", "読み込めませんでした", "時間をおいてもう一度お試しください。", btn("btn--primary", "もう一度", "refresh", () => location.reload()));
  });
})();
