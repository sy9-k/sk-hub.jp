// アカウントを探す（/accounts/）。UID かサポート ID で調べる
//   見てよいのは、お問い合わせ・障害・不正利用・法令に基づく要請への対応のときだけ（SK Hub Systems アカウント規約 第四条4）。
//   出すのは、規約で決めたもの: アカウントの情報（作成日・規約の版・接続しているサービス）と表示名、
//   利用の記録（使ったブラウザのタイムゾーン＝おおまかな地域とサポート ID・最後に使った日時）、そのアカウントからのお問い合わせ。
//   Y-FILTER. の情報（管理グループ・端末・リクエスト）は出さない（Y-FILTER. からは情報を取らない方針）。調べたら操作の記録（account.view）に残す
//   ?uid=… / ?sid=… で開くと、すぐに調べる（お問い合わせから来るとき）
import {
  collection, doc, getDoc, getDocs, limit, orderBy, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { ACCOUNT_TERMS_VERSION } from "/assets/hub/account.js";
import {
  $, badge, busy, button, card, confirmDialog, copyText, db, el, empty, errorNote, explain, fmtAgo, fmtDate, fmtDateTime,
  listItem, logAction, note, num, promptDialog, startAdmin, toMillis, toast
} from "/shared/admin.js";
import { SUPPORT_ID, block, isBlocked, unblock } from "/shared/blocklist.js";

const SERVICE_LABEL = { yfilter: "Y-FILTER.", malu: "MALU", nagi: "Nagi" };
const KIND = { bug: "不具合", question: "質問", request: "要望", data: "データ", other: "その他" };
// タイムゾーン → おおまかな地域（よくあるものだけ。ほかは大陸の名前）
const TZ_REGION = {
  "Asia/Tokyo": "日本", "Asia/Seoul": "韓国", "Asia/Shanghai": "中国", "Asia/Chongqing": "中国", "Asia/Harbin": "中国", "Asia/Urumqi": "中国",
  "Asia/Taipei": "台湾", "Asia/Hong_Kong": "香港", "Asia/Macau": "マカオ", "Asia/Singapore": "シンガポール", "Asia/Bangkok": "タイ",
  "Asia/Ho_Chi_Minh": "ベトナム", "Asia/Manila": "フィリピン", "Asia/Jakarta": "インドネシア", "Asia/Kolkata": "インド", "Asia/Calcutta": "インド",
  "Europe/London": "英国", "Europe/Paris": "フランス", "Europe/Berlin": "ドイツ", "Australia/Sydney": "オーストラリア", "Pacific/Auckland": "ニュージーランド",
  "Pacific/Honolulu": "米国（ハワイ）", "America/New_York": "米国（東部）", "America/Chicago": "米国（中部）", "America/Denver": "米国（山岳部）",
  "America/Los_Angeles": "米国（西部）", "America/Toronto": "カナダ", "America/Vancouver": "カナダ", "America/Sao_Paulo": "ブラジル"
};
const CONTINENT = { Asia: "アジア", Europe: "ヨーロッパ", America: "南北アメリカ", Africa: "アフリカ", Australia: "オセアニア", Pacific: "太平洋", Atlantic: "大西洋", Indian: "インド洋" };
const regionOf = (tz) => (!tz ? "分かりません" : TZ_REGION[tz] || CONTINENT[tz.split("/")[0]] || "分かりません");

const root = $("[data-page]");
const form = el("form", "ad-search");
const field = el("label", "m3-field");
const input = el("input", "m3-field__input ad-mono");
input.name = "q";
input.autocomplete = "off";
input.spellcheck = false;
input.placeholder = "UID（英数字 28 文字ほど）か、サポート ID（8-4-4-4-12）";
field.append(el("span", "m3-field__label", "UID かサポート ID"), input);
const go = button("調べる", { iconName: "search", type: "submit" });
form.append(field, go);
const result = el("div", "ad-stack");
const recent = el("div");

root.append(
  note("アカウントを確かめるのは、お問い合わせ・障害・不正利用・法令に基づく要請への対応のときだけです（SK Hub Systems アカウント規約 第四条4）。調べると操作の記録に残ります。Y-FILTER. の情報は出しません。", "warn", "policy"),
  form, result, card("person_add", "最近できたアカウント", recent)
);

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (!q) return;
  const isSid = SUPPORT_ID.test(q);
  history.replaceState(null, "", `?${isSid ? "sid" : "uid"}=${encodeURIComponent(q)}`);
  busy(go, () => (isSid ? showSupportId(q.toLowerCase()) : showAccount(q)));
});

function row(label, value) {
  const r = el("div");
  r.append(el("dt", null, label));
  const dd = el("dd");
  dd.append(value instanceof Node ? value : document.createTextNode(value == null ? "-" : String(value)));
  r.append(dd);
  return r;
}
function dl(...rows) {
  const d = el("dl", "ad-dl");
  rows.forEach((r) => d.append(...r.childNodes));
  return d;
}

// ---------- UID で調べる ----------
async function showAccount(uid) {
  result.replaceChildren(el("p", "ad-hint", "調べています…"));
  logAction("account.view", uid, "UID で調べた");
  const parts = [];
  const head = el("div", "ad-row");
  head.append(el("code", "ad-mono", uid), button("コピー", { kind: "text-btn", iconName: "content_copy", onClick: () => copyText(uid) }));
  const sendLink = el("a", "m3-btn m3-btn--tonal m3-state ad-btn-sm", "お知らせを送る");
  sendLink.href = `/notices/?uid=${encodeURIComponent(uid)}`;
  head.append(el("span", "ad-grow"), sendLink);

  // アカウント
  const acctBody = el("div", "ad-stack");
  let seen = null;
  try {
    const snap = await getDoc(doc(db, "accounts", uid));
    if (!snap.exists()) {
      acctBody.append(note("この UID のアカウントはありません（作っていないか、削除されています）。"));
    } else {
      const a = snap.data();
      seen = a.seen || null;
      const services = Object.keys(a.services || {}).filter((k) => SERVICE_LABEL[k]);
      const terms = el("span", "ad-row");
      terms.append(document.createTextNode(`${a.termsVersion || "-"}（${fmtDate(a.termsAgreedAt)} に同意）`), a.termsVersion === ACCOUNT_TERMS_VERSION ? badge("最新", "ok") : badge("同意し直しが必要", "warn"));
      const svc = el("span", "ad-row");
      if (services.length) services.forEach((k) => svc.append(badge(`${SERVICE_LABEL[k]}（${fmtDate(a.services[k].connectedAt)}〜）`, "info")));
      else svc.append(document.createTextNode("なし"));
      acctBody.append(dl(
        row("表示名", (a.profile && a.profile.name) || "（Google の名前のまま）"),
        row("作成", fmtDateTime(a.createdAt)),
        row("規約の版", terms),
        row("接続しているサービス", svc),
        row("お知らせを開いた", a.noticesSeenAt ? fmtAgo(a.noticesSeenAt) : "まだ")
      ));
    }
  } catch (err) {
    acctBody.append(errorNote(err));
  }
  parts.push(card("account_circle", "アカウント", head, acctBody));

  // 利用の記録（タイムゾーン・サポート ID）
  const usage = el("div", "ad-stack");
  if (seen) {
    usage.append(dl(
      row("おおまかな地域", `${regionOf(seen.tz)}${seen.tz ? `（${seen.tz}）` : ""}`),
      row("最後に使った", seen.at ? `${fmtDateTime(seen.at)}（${fmtAgo(seen.at)}）` : "-")
    ));
    const ids = Array.isArray(seen.ids) ? seen.ids : [];
    if (!ids.length) usage.append(el("p", "ad-hint", "サポート ID はありません（アクセスチェックに同意していないブラウザで使っています）。"));
    else {
      const list = el("ul", "ad-list");
      ids.forEach((sid, i) => {
        const end = badge("…");
        const li = listItem({ iconName: "fingerprint", title: sid, sub: i === 0 ? "いちばん新しく使ったブラウザ" : "", end, href: `?sid=${encodeURIComponent(sid)}` });
        li.querySelector(".ad-li__title").classList.add("ad-mono");
        li.addEventListener("click", (e) => { e.preventDefault(); input.value = sid; form.requestSubmit(); window.scrollTo({ top: 0, behavior: "smooth" }); });
        isBlocked(sid).then((b) => end.replaceWith(b ? badge("制限中", "error") : badge("制限なし", "ok")), () => end.replaceWith(badge("-")));
        list.append(li);
      });
      usage.append(list, el("p", "ad-hint", "サポート ID を選ぶと、そのブラウザのアクセスの記録と、アクセスの制限を見られます。"));
    }
  } else {
    usage.append(note("まだ利用の記録はありません（新しい規約に同意したあとにログインすると、記録されます）。"));
  }
  parts.push(card("travel_explore", "利用の記録", usage));

  // お問い合わせ
  const contacts = el("ul", "ad-list");
  try {
    const snap = await getDocs(query(collection(db, "contacts"), where("uid", "==", uid), limit(20)));
    if (snap.empty) contacts.append(empty("このアカウントからのお問い合わせはありません。", "mail"));
    snap.docs.sort((a, b) => (toMillis(b.data().createdAt) || 0) - (toMillis(a.data().createdAt) || 0)).forEach((d) => {
      const x = d.data();
      contacts.append(listItem({ iconName: "mail", title: (x.message || "").slice(0, 80), sub: `${KIND[x.kind] || x.kind}・${fmtDateTime(x.createdAt)}`, end: x.status === "done" ? badge("対応済み") : badge("未対応", "error"), href: "/inbox/" }));
    });
  } catch (err) {
    contacts.append(errorNote(err));
  }
  parts.push(card("mail", "お問い合わせ", contacts));
  result.replaceChildren(...parts);
}

// ---------- サポート ID で調べる ----------
async function showSupportId(sid) {
  result.replaceChildren(el("p", "ad-hint", "調べています…"));
  logAction("account.view", sid, "サポート ID で調べた");
  const parts = [];

  const state = el("div", "ad-stack");
  const head = el("div", "ad-row");
  head.append(el("code", "ad-mono", sid), button("コピー", { kind: "text-btn", iconName: "content_copy", onClick: () => copyText(sid) }));
  state.append(head);
  try {
    const blocked = await isBlocked(sid);
    const r = el("div", "ad-row");
    r.append(blocked ? badge("制限中", "error") : badge("制限していません", "ok"), el("span", "ad-grow"));
    if (blocked) {
      r.append(button("制限を解除", { kind: "m3-btn m3-btn--tonal", iconName: "lock_open", small: true, onClick: async () => {
        if (!(await confirmDialog({ title: "制限を解除しますか？", text: "このサポート ID のブラウザから、また SK のサイトを使えるようになります。", ok: "解除", icon: "lock_open" }))) return;
        try { await unblock(sid); toast("解除しました"); showSupportId(sid); } catch (err) { toast(explain(err)); }
      } }));
    } else {
      r.append(button("アクセスを制限", { kind: "m3-btn ad-danger-btn", iconName: "block", small: true, onClick: async () => {
        const reason = await promptDialog({ title: "アクセスを制限します", label: "理由（自分用のメモ）", placeholder: "例: いたずらのお問い合わせを繰り返す", ok: "制限する", maxLength: 200 });
        if (reason == null) return;
        try { await block(sid, reason); toast("制限しました"); showSupportId(sid); } catch (err) { toast(explain(err)); }
      } }));
    }
    state.append(r, el("p", "ad-hint", "サポート ID はブラウザごとの ID です。sy9-k.github.io と sk-hub.jp では別の ID になります（同じ人でも ID が 2 つあることがあります）。"));
  } catch (err) {
    state.append(errorNote(err));
  }
  parts.push(card("fingerprint", "サポート ID", state));

  // アクセスチェックの記録
  const logs = el("div");
  try {
    const snap = await getDocs(query(collection(db, "hub_access_logs"), where("uuid", "==", sid), limit(300)));
    const rows = snap.docs.map((d) => d.data()).sort((a, b) => (toMillis(b.createdAt) || 0) - (toMillis(a.createdAt) || 0));
    if (!rows.length) logs.append(empty("記録はありません（1 年より前のものは消えています）。", "receipt_long"));
    else {
      const first = rows[rows.length - 1];
      logs.append(el("p", "ad-hint", `${num(rows.length)} 件（${fmtDate(first.createdAt)} 〜 ${fmtDate(rows[0].createdAt)}）・言語 ${[...new Set(rows.map((r) => r.language))].join("・")}`));
      const list = el("ul", "ad-list");
      rows.slice(0, 30).forEach((r) => list.append(listItem({
        iconName: r.status === "blocked" ? "block" : "public",
        title: (r.page || "").replace(/^https?:\/\//, ""),
        sub: `${fmtDateTime(r.createdAt)}${r.referrer ? `・${r.referrer} から` : ""}`,
        end: r.status === "blocked" ? badge("制限中に開いた", "error") : null
      })));
      logs.append(list);
    }
  } catch (err) {
    logs.append(errorNote(err));
  }
  parts.push(card("receipt_long", "アクセスチェックの記録", logs));

  // お問い合わせ
  const contacts = el("ul", "ad-list");
  try {
    const snap = await getDocs(query(collection(db, "contacts"), where("supportId", "==", sid), limit(20)));
    if (snap.empty) contacts.append(empty("このサポート ID からのお問い合わせはありません。", "mail"));
    snap.docs.forEach((d) => {
      const x = d.data();
      const end = [x.status === "done" ? badge("対応済み") : badge("未対応", "error")];
      contacts.append(listItem({ iconName: "mail", title: (x.message || "").slice(0, 80), sub: `${KIND[x.kind] || x.kind}・${fmtDateTime(x.createdAt)}${x.uid ? "・アカウントあり" : ""}`, end, href: x.uid ? `/accounts/?uid=${encodeURIComponent(x.uid)}` : "/inbox/" }));
    });
  } catch (err) {
    contacts.append(errorNote(err));
  }
  parts.push(card("mail", "お問い合わせ", contacts));
  result.replaceChildren(...parts);
}

// ---------- 最近できたアカウント（UID と日付だけ） ----------
async function loadRecent() {
  try {
    const snap = await getDocs(query(collection(db, "accounts"), orderBy("createdAt", "desc"), limit(20)));
    if (snap.empty) { recent.replaceChildren(empty("まだアカウントはありません。", "group")); return; }
    const list = el("ul", "ad-list");
    snap.docs.forEach((d) => {
      const a = d.data();
      const services = Object.keys(a.services || {}).filter((k) => SERVICE_LABEL[k]).map((k) => SERVICE_LABEL[k]);
      const li = listItem({
        iconName: "person",
        title: d.id,
        sub: `${fmtDateTime(a.createdAt)}${services.length ? `・${services.join("・")}` : ""}`,
        end: a.termsVersion === ACCOUNT_TERMS_VERSION ? null : badge("規約が古い", "warn"),
        href: `?uid=${encodeURIComponent(d.id)}`
      });
      li.querySelector(".ad-li__title").classList.add("ad-mono");
      li.addEventListener("click", (e) => { e.preventDefault(); input.value = d.id; form.requestSubmit(); window.scrollTo({ top: 0, behavior: "smooth" }); });
      list.append(li);
    });
    recent.replaceChildren(list, el("p", "ad-hint", "一覧は UID と日付だけです。中身は、調べたいアカウントを選んだときだけ読みます。"));
  } catch (err) {
    recent.replaceChildren(errorNote(err));
  }
}

startAdmin({
  page: "accounts",
  onReady: () => {
    loadRecent();
    const params = new URLSearchParams(location.search);
    const q = params.get("uid") || params.get("sid");
    if (q) { input.value = q; form.requestSubmit(); }
  }
});
