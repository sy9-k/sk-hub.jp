// SK Hub Systems アカウントのページ（/account/）
// ログイン → アカウントの作成（規約への同意）→ アカウントの確認・プロフィール・お知らせ・設定の同期・データのダウンロード・削除
// サービスのページから ?next=/y-filter/ のように来たときは、使えるようになったら戻す。
import {
  LOGIN_PROVIDERS, PROFILE_COLORS, PROFILE_NAME_MAX, SERVICES, SYNC_AT_KEY, agreeLatestTerms, availableLogins, confirmIdentity,
  connectService, disconnectService, externalLoginsOf, externalResult, isConnected, db, deleteLogin, linkLogin, loadExternalLogins, loginsOf, markNoticesSeen,
  profileOf, register, rememberAccount,
  safeNext, saveLanguage, saveProfile, signIn, signInAndLinkPending, signOutAccount, syncSettings, unlinkLogin, watchAccount
} from "/assets/hub/account.js";
import {
  arrayRemove, collection, deleteDoc, deleteField, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, query, updateDoc, where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const root = document.querySelector("[data-acct]");
const $ = (sel) => root.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
let next = safeNext(new URLSearchParams(location.search).get("next"));
// サービスを最初に使うとき（?connect=yfilter）: アカウントが使えるようになったら、接続するか確かめる
let connectKey = SERVICES[new URLSearchParams(location.search).get("connect")] ? new URLSearchParams(location.search).get("connect") : "";
// 多言語（assets/i18n.js）
const I18N = window.SKI18N;
const t = I18N.t;

let current = { status: "loading", user: null, account: null };
let busy = false;

const errText = (err) => {
  const code = err?.code || "";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return t("ログインの画面が閉じられました。");
  if (code === "auth/popup-blocked") return t("ポップアップがブロックされました。ブラウザの設定でこのサイトのポップアップを許可してください。");
  if (code === "auth/network-request-failed" || code === "unavailable") return t("通信できませんでした。インターネットの接続を確認してください。");
  if (code === "permission-denied") return t("SK Hub Systems がこの操作を受け付けませんでした。時間をおいて再度お試しください。");
  if (code === "auth/operation-not-allowed") return t("このログインの方法は、まだ使えません。");
  if (code === "auth/credential-already-in-use" || code === "auth/email-already-in-use") return t("そのアカウントは、ほかの SK Hub Systems アカウントにつながっています。");
  if (code === "auth/provider-already-linked") return t("その方法は、もうつながっています。");
  if (code === "auth/requires-recent-login") return t("安全のため、もう一度ログインしてからお試しください。");
  if (code === "sk/last-login") return t("ログインの方法は、少なくとも 1 つ残す必要があります。");
  if (code === "sk/api-unreachable") return t("SK Hub のログインのサーバー（api.sk-hub.jp）に接続できませんでした。フィルタリングや広告ブロックのアプリ・設定が止めていないか確かめてください。");
  if (code === "sk/signed-out") return t("ログインが切れました。ページを開き直してから、もう一度お試しください。");
  if (code === "sk/unknown-provider") return t("このログインの方法は、まだ使えません。");
  if (code === "sk/cancelled") return t("ログインをやめました。");
  if (code === "sk/passkey-exists") return t("この端末のパスキーは、もう登録されています。");
  if (code === "sk/unknown-passkey") return t("このパスキーは、SK Hub Systems アカウントに登録されていません。ほかの方法でログインしてから、パスキーを登録してください。");
  if (code === "sk/too-many") return t("パスキーは 10 個まで登録できます。使っていないものを外してください。");
  if (code === "sk/mismatch") return t("このアカウントに登録されているパスキーで確認してください。");
  if (code === "sk/passkey-failed" || code === "sk/failed") return t("パスキーを確かめられませんでした。もう一度お試しください。");
  if (code === "TypeError" || err instanceof TypeError) return t("通信できませんでした。インターネットの接続を確認してください。");
  return t("うまくいきませんでした（{code}）", { code: code || err?.message || err });
};
const toDate = (v) => (v && typeof v.toDate === "function" ? v.toDate() : v ? new Date(v) : null);
const formatDate = (d) => (d ? I18N.date(d) : "-");

// 保護者の同意なしでアカウントを作れる年齢（SK Hub Systems アカウント規約 第六条4）。
// サーバーでは国が分からない（GitHub Pages）ので、ブラウザのタイムゾーンで地域を判断する。載っていない地域（日本を含む）は 18 歳
const CONSENT_AGES = [
  // EU の国ごとの年齢（GDPR 第8条）・英国・スイス
  [13, ["Europe/Brussels", "Europe/Copenhagen", "Europe/Tallinn", "Europe/Helsinki", "Europe/Mariehamn", "Europe/Riga", "Europe/Malta",
    "Europe/Lisbon", "Atlantic/Madeira", "Atlantic/Azores", "Europe/Stockholm", "Europe/Oslo", "Arctic/Longyearbyen", "Atlantic/Reykjavik",
    "Europe/London", "Europe/Belfast"]],
  [14, ["Europe/Vienna", "Europe/Sofia", "Asia/Nicosia", "Asia/Famagusta", "Europe/Nicosia", "Europe/Rome", "Europe/Vilnius",
    "Europe/Madrid", "Atlantic/Canary", "Africa/Ceuta"]],
  [15, ["Europe/Prague", "Europe/Paris", "Europe/Athens", "Europe/Ljubljana"]],
  [16, ["Europe/Berlin", "Europe/Busingen", "Europe/Zagreb", "Europe/Budapest", "Europe/Dublin", "Europe/Luxembourg", "Europe/Amsterdam",
    "Europe/Warsaw", "Europe/Bucharest", "Europe/Bratislava", "Europe/Vaduz", "Europe/Zurich"]],
  // 韓国（個人情報保護法）・中国（個人情報保護法）
  [14, ["Asia/Seoul", "ROK", "Asia/Shanghai", "Asia/Urumqi", "Asia/Chongqing", "Asia/Harbin", "PRC"]]
];
// 米国（COPPA）
const US_ZONE = /^(America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Juneau|Sitka|Metlakatla|Yakutat|Nome|Adak|Boise|Detroit|Menominee|Puerto_Rico|Indiana\/.+|Kentucky\/.+|North_Dakota\/.+)|Pacific\/(Honolulu|Guam|Saipan|Pago_Pago)|US\/.+)$/;
function consentAge() {
  let zone = "";
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* 分からなければ 18 歳 */ }
  if (US_ZONE.test(zone)) return 13;
  const hit = CONSENT_AGES.find(([, zones]) => zones.includes(zone));
  return hit ? hit[0] : 18;
}

function showView(name) {
  root.querySelectorAll("[data-acct-view]").forEach((el) => { el.hidden = el.dataset.acctView !== name; });
  // ログイン後だけ、ページの見出しの帯（ログアウトつき）を出す
  $("[data-acct-localnav]").hidden = name !== "ready";
  message("");
}

// ---------- 項目の切り替え（左の一覧 → 右の中身。URL の # で開く項目を決める） ----------
// ヘッダーのメニューの「お知らせ」「データのダウンロード・削除」は /account/#notices・#privacy に来る
const SECTIONS = ["overview", "profile", "security", "notices", "services", "settings", "privacy", "developer"];
let section = "";

function sectionFromHash() {
  const name = location.hash.replace(/^#/, "");
  if (!SECTIONS.includes(name)) return "overview";
  // 開発者の項目は、開発者のときだけ
  if (name === "developer" && $('[data-acct-nav="developer"]').hidden) return "overview";
  return name;
}

function showSection(name) {
  section = name;
  root.querySelectorAll("[data-acct-section]").forEach((el) => { el.hidden = el.dataset.acctSection !== name; });
  root.querySelectorAll("[data-acct-nav]").forEach((a) => {
    if (a.dataset.acctNav === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  message("");
  if (name === "notices") noticesOpened();
}

window.addEventListener("hashchange", () => {
  if (current.status !== "ready") return;
  showSection(sectionFromHash());
  // スマートフォンでは、項目の一覧が上にあるので中身の先頭へ
  if (window.matchMedia("(max-width: 860px)").matches) $(".acct-main").scrollIntoView({ block: "start" });
});

// 表示中の画面のメッセージ欄に出す
function message(text) {
  root.querySelectorAll("[data-acct-msg]").forEach((el) => {
    el.textContent = el.closest("[data-acct-view]")?.hidden ? "" : text;
  });
}

function setBusy(on, button) {
  busy = on;
  if (button) button.disabled = on;
  root.classList.toggle("is-busy", on);
}

function userChip(user) {
  const wrap = document.createElement("div");
  wrap.className = "acct-user-chip";
  if (user.photoURL) {
    const img = document.createElement("img");
    img.src = user.photoURL;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    wrap.appendChild(img);
  }
  const text = document.createElement("div");
  const name = document.createElement("strong");
  name.textContent = user.displayName || t("（名前なし）");
  const mail = document.createElement("small");
  mail.textContent = user.email || "";
  text.append(name, mail);
  wrap.appendChild(text);
  return wrap;
}

// ---------- 画面 ----------

// LINE・Kakao の画面から戻ってきたとき（/assets/hub/account.js の externalResult）の知らせ。画面を出したあとに 1 回だけ出す
let returned = null;
const RETURN_ERRORS = {
  cancelled: "ログインをやめました。",
  expired: "時間がたちすぎました。もう一度お試しください。",
  failed: "{name} で本人を確かめられませんでした。時間をおいて、もう一度お試しください。",
  "in-use": "その {name} アカウントは、ほかの SK Hub Systems アカウントにつながっています。",
  "already-linked": "このアカウントには、すでに別の {name} アカウントがつながっています。外してから、もう一度つないでください。",
  mismatch: "このアカウントにつながっている {name} アカウントで確認してください。"
};
externalResult.then((res) => {
  if (!res) return;
  returned = res;
  // つなぐ・本人の確認から戻ったときは、その項目を開く（render より先に # を決める）
  if (res.mode === "link" || res.error === "in-use" || res.error === "already-linked") history.replaceState(null, "", "#security");
  if (res.mode === "reauth" || res.error === "mismatch") history.replaceState(null, "", "#privacy");
});
function showReturned(status) {
  const res = returned;
  if (!res) return;
  returned = null;
  const name = LOGIN_PROVIDERS[res.provider]?.name || "LINE・Kakao";
  if (res.error) { message(t(RETURN_ERRORS[res.error] || RETURN_ERRORS.failed, { name })); return; }
  if (res.mode === "link") message(t("{name} をつなぎました。次から {name} でもログインできます。", { name }));
  // 本人の確認ができたら、削除の確認をもう一度出す（このあと 4 分のあいだに「削除する」を押せば、もう確認しない）
  if (res.mode === "reauth" && status === "ready") {
    document.querySelector("[data-acct-delete-reauthed]").hidden = false;
    $("[data-acct-delete]").click();
  }
}

function render(state) {
  renderView(state);
  showReturned(state.status);
}

function renderView(state) {
  current = state;
  const { status, user, account } = state;
  if (status === "signed-out") { showView("signed-out"); return; }
  if (status === "error") {
    showView("error");
    $("[data-acct-error]").textContent = errText(state.error);
    return;
  }
  if (status === "unregistered" || status === "outdated") {
    showView("register");
    $("[data-acct-user]").replaceChildren(userChip(user));
    const outdated = status === "outdated";
    $("[data-acct-register-title]").textContent = outdated ? t("規約が新しくなりました") : t("アカウントを作成");
    $("[data-acct-register-lead]").textContent = outdated
      ? t("SK Hub Systems アカウント規約が新しくなりました。引き続き使うには、内容を確認して同意してください。")
      : signinMode === "login"
        // 「ログイン」から入ったが、まだアカウントがない人
        ? t("このアカウントでは、まだ SK Hub Systems アカウントが作られていません。作成するには、内容を確認して同意してください。")
        : t("このアカウントで SK Hub Systems アカウントを作成します。内容を確認して、同意してください。");
    $("[data-acct-register]").textContent = outdated ? t("同意して続ける") : t("アカウントを作成");
    $("[data-acct-agree]").checked = false;
    // 年齢の確認は、アカウントを作るときだけ
    $("[data-acct-age-row]").hidden = outdated;
    $("[data-acct-age]").checked = false;
    $("[data-acct-age-text]").textContent = t("{age}歳以上です。または、保護者の同意を得ています。", { age: consentAge() });
    $("[data-acct-register]").disabled = true;
    return;
  }

  // ready
  if (connectKey && !isConnected(account, connectKey)) {
    showView("connect");
    fillConnect(connectKey);
    $("[data-acct-connect-user]").replaceChildren(userChip(user));
    return;
  }
  if (next) {
    $("[data-acct-next]").hidden = false;
    location.replace(next);
  }
  showView("ready");
  renderProfile(user, account);
  // LINE・Kakao だけの人はメールアドレスがない
  $("[data-acct-email]").textContent = user.email || "";
  $("[data-acct-email-tile]").textContent = user.email || t("なし（{name} でログイン）", { name: loginsOf(user).map((k) => LOGIN_PROVIDERS[k].name).join("・") || "-" });
  $("[data-acct-uid]").textContent = user.uid;
  $("[data-acct-created]").textContent = formatDate(toDate(account.createdAt) || toDate(user.metadata?.creationTime));
  $("[data-acct-terms]").textContent = t("{version} 版に {date} に同意", { version: account.termsVersion, date: formatDate(toDate(account.termsAgreedAt)) });
  showSection(sectionFromHash());
  renderServices(user, account);
  renderNotices(user, account);
  renderSettings();
  renderOverview(user, account);
  renderPrivacyTiles();
  renderLogins(user);
  // LINE・Kakao は api.sk-hub.jp に問い合わせてから、もう一度並べる
  loadExternalLogins(user).then(() => {
    if (current.user !== user) return;
    renderLogins(user);
    $("[data-acct-email-tile]").textContent = user.email || t("なし（{name} でログイン）", { name: loginsOf(user).map((k) => LOGIN_PROVIDERS[k].name).join("・") || "-" });
  });
  // 開発者なら受信箱・記事エディターの項目を出す（config/developers は登録された本人だけが読める）
  getDoc(doc(db, "config", "developers"))
    .then(() => {
      root.querySelectorAll("[data-acct-dev]").forEach((el) => { el.hidden = false; });
      if (location.hash === "#developer") showSection("developer");
    })
    .catch(() => { root.querySelectorAll("[data-acct-dev]").forEach((el) => { el.hidden = true; }); });
}

// ---------- ログインの方法（サインインとセキュリティ） ----------
// つないでいる方法を並べ、つなぐ・外す。最後の 1 つは外せない
function renderLogins(user) {
  const box = $("[data-acct-logins]");
  if (!box) return;
  const linked = loginsOf(user);
  const keys = availableLogins().concat(linked.filter((k) => !availableLogins().includes(k)));
  box.replaceChildren(...keys.map((key) => {
    const info = LOGIN_PROVIDERS[key], on = linked.includes(key);
    const row = document.createElement("div");
    row.className = "acct-login-row";
    const logo = document.createElement("span");
    logo.className = "acct-login-logo acct-login-logo--" + key;
    logo.setAttribute("aria-hidden", "true");
    const text = document.createElement("div");
    text.className = "acct-login-text";
    const name = document.createElement("strong");
    name.textContent = info.name;
    const state = document.createElement("small");
    // パスキーは、いくつ登録しているか
    const passkeys = key === "passkey" ? (externalLoginsOf(user).find((l) => l.provider === "passkey")?.count || 0) : 0;
    state.textContent = key === "passkey" && on ? t("{n} 個登録しています", { n: passkeys }) : on ? t("つながっています") : t("つないでいません");
    text.append(name, state);
    row.append(logo, text);
    if (on && info.security) {
      const sec = document.createElement("a");
      sec.className = "acct-login-link";
      sec.href = info.security;
      sec.target = "_blank";
      sec.rel = "noopener";
      sec.textContent = t("セキュリティ");
      row.appendChild(sec);
    }
    // パスキーは、登録したあとも別の端末の分を足せる
    if (key === "passkey" && on) row.appendChild(loginButton(t("追加"), "", async () => {
      await linkLogin(current.user, key);
      renderLogins(current.user);
      message(t("この端末のパスキーを登録しました。次からパスキーでもログインできます。"));
    }));
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "acct-login-btn" + (on ? " is-unlink" : "");
    btn.textContent = on ? t("外す") : key === "passkey" ? t("登録") : t("つなぐ");
    btn.disabled = on && linked.length <= 1;
    if (btn.disabled) btn.title = t("ログインの方法は、少なくとも 1 つ残す必要があります。");
    btn.addEventListener("click", async () => {
      if (busy) return;
      if (on && !confirm(key === "passkey"
        ? t("登録しているパスキーを全部外しますか？ 外したあとは、パスキーではログインできなくなります。")
        : t("{name} でのログインを外しますか？ 外したあとは、{name} ではログインできなくなります。", { name: info.name }))) return;
      setBusy(true, btn);
      try {
        if (on) await unlinkLogin(current.user, key);
        else await linkLogin(current.user, key);
        await current.user.reload();
        renderLogins(current.user);
        message(on ? t("{name} を外しました", { name: info.name })
          : key === "passkey" ? t("この端末のパスキーを登録しました。次からパスキーでもログインできます。")
          : t("{name} をつなぎました。次から {name} でもログインできます。", { name: info.name }));
      } catch (err) {
        message(errText(err));
      } finally {
        setBusy(false, btn);
      }
    });
    row.appendChild(btn);
    return row;
  }));
}

// 「サインインとセキュリティ」の小さなボタン（パスキーの「追加」）
function loginButton(label, extraClass, action) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "acct-login-btn" + (extraClass ? " " + extraClass : "");
  b.textContent = label;
  b.addEventListener("click", async () => {
    if (busy) return;
    setBusy(true, b);
    try {
      await action();
    } catch (err) {
      message(errText(err));
    } finally {
      setBusy(false, b);
    }
  });
  return b;
}

// ---------- プロフィール ----------

function paintAvatar(photoEl, letterEl, p) {
  photoEl.hidden = !p.photo;
  letterEl.hidden = !!p.photo;
  if (p.photo) photoEl.src = p.photo;
  letterEl.textContent = p.letter;
  letterEl.style.background = p.colorValue;
}

function renderProfile(user, account) {
  const p = profileOf(user, account);
  paintAvatar($("[data-acct-photo]"), $("[data-acct-letter]"), p);
  $("[data-acct-name]").textContent = p.name || t("（名前なし）");
  $("[data-acct-profile-summary]").textContent = `${p.name || t("（名前なし）")} · ${p.photo ? t("ログインに使っているアカウントの写真") : t("名前の頭文字")}`;
}

const profileDialog = document.querySelector("[data-acct-profile-dialog]");
const profileForm = profileDialog.querySelector("[data-acct-profile-form]");
const colorsEl = profileDialog.querySelector("[data-acct-colors]");
const COLOR_NAMES = { blue: t("青"), green: t("緑"), amber: t("オレンジ"), violet: t("紫"), pink: t("ピンク"), teal: t("青緑") };
let profileColor = "blue";

Object.entries(PROFILE_COLORS).forEach(([key, value]) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "acct-color";
  b.dataset.color = key;
  b.style.background = value;
  b.setAttribute("role", "radio");
  b.setAttribute("aria-label", COLOR_NAMES[key]);
  b.title = COLOR_NAMES[key];
  b.addEventListener("click", () => {
    profileColor = key;
    profileForm.elements.avatar.value = "letter";
    previewProfile();
  });
  colorsEl.appendChild(b);
});

// 編集中の内容を上のプレビューに出す
function draftProfile() {
  return { name: profileForm.elements.name.value, avatar: profileForm.elements.avatar.value, color: profileColor };
}
function previewProfile() {
  const { user } = current;
  const p = profileOf(user, { profile: draftProfile() });
  paintAvatar(profileDialog.querySelector("[data-acct-preview-photo]"), profileDialog.querySelector("[data-acct-preview-letter]"), p);
  profileDialog.querySelector("[data-acct-preview-name]").textContent = p.name || t("（名前なし）");
  colorsEl.querySelectorAll(".acct-color").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.color === profileColor)));
  colorsEl.classList.toggle("is-off", profileForm.elements.avatar.value !== "letter");
}

$("[data-acct-edit-profile]").addEventListener("click", () => {
  const { user, account } = current;
  if (busy || !user) return;
  const saved = (account && account.profile) || {};
  profileForm.elements.name.value = saved.name || "";
  profileForm.elements.name.placeholder = user.displayName || "";
  profileForm.elements.name.maxLength = PROFILE_NAME_MAX;
  // Google の写真がないアカウントは、頭文字だけ
  profileDialog.querySelector("[data-acct-avatar-google]").hidden = !user.photoURL;
  profileForm.elements.avatar.value = saved.avatar === "letter" || !user.photoURL ? "letter" : "google";
  profileColor = PROFILE_COLORS[saved.color] ? saved.color : "blue";
  previewProfile();
  profileDialog.returnValue = "";
  profileDialog.showModal();
});
profileForm.addEventListener("input", previewProfile);

profileDialog.addEventListener("close", async () => {
  if (profileDialog.returnValue !== "save" || !current.user) return;
  const { user, account } = current;
  const profile = draftProfile();
  const btn = $("[data-acct-edit-profile]");
  setBusy(true, btn);
  try {
    await saveProfile(user, profile);
    const next = { ...account, profile: { name: profile.name.trim(), avatar: profile.avatar, color: profile.color } };
    current = { ...current, account: next };
    renderProfile(user, next);
    renderOverview(user, next);
    rememberAccount(user, next);
    message(t("プロフィールを保存しました。"));
  } catch (err) {
    message(errText(err));
  } finally {
    setBusy(false, btn);
  }
});

// ---------- お知らせ ----------
// SK からの個別のお知らせ（accounts/{UID}/notices）と、サポートのお知らせ（記事の news）を新しい順に並べる。
// 前に開いたとき（noticesSeenAt）より新しいものに印を付け、開いたら既読にする
const NOTICE_MAX = 8;

async function renderNotices(user, account) {
  const list = $("[data-acct-notices]");
  const seen = toDate(account.noticesSeenAt);
  // サポートのお知らせ（日付だけ）は、前に開いた日（まだなら、アカウントを作った日）より後の日付のものを未読にする
  const since = seen || toDate(account.createdAt) || new Date();
  const newsSince = new Date(since.getFullYear(), since.getMonth(), since.getDate() + 1);

  const [personal, news] = await Promise.all([
    getDocs(query(collection(db, "accounts", user.uid, "notices"), orderBy("createdAt", "desc"), limit(30)))
      .then((snap) => snap.docs.map((d) => {
        const n = d.data();
        const at = toDate(n.createdAt) || new Date();
        return { source: "sk", id: d.id, at, unread: !seen || at > seen, ...n };
      }))
      .catch(() => []),
    (window.SKArticles ? window.SKArticles.load() : Promise.resolve({ articles: [] }))
      .then(({ articles }) => articles.filter((a) => a.type === "news" && a.date).map((a) => {
        const at = new Date(`${a.date}T00:00:00`);
        return { source: "news", id: a.id, at, unread: at >= newsSince, ...a };
      }))
      .catch(() => [])
  ]);

  const items = [...personal, ...news].sort((a, b) => b.at - a.at).slice(0, NOTICE_MAX);
  if (!items.length) {
    list.replaceChildren(el("li", "acct-notice-empty", t("お知らせはまだありません。")));
  } else {
    list.replaceChildren(...items.map((n) => noticeItem(user, n)));
  }
  const unread = items.filter((n) => n.unread).length;
  const badge = $("[data-acct-unread]");
  badge.hidden = !unread;
  badge.textContent = t("未読 {n} 件", { n: unread });
  const navCount = $("[data-acct-nav-unread]");
  navCount.hidden = !unread;
  navCount.textContent = String(unread);
  $("[data-acct-ov-notices]").textContent = unread ? t("未読 {n} 件", { n: unread }) : t("新しいお知らせはありません");
  // お知らせの項目を開いたら既読にする（印は、このページを開いているあいだは残す）
  noticesToMark = unread || !seen ? user : null;
  if (section === "notices") noticesOpened();
}

let noticesToMark = null;
function noticesOpened() {
  if (!noticesToMark) return;
  const user = noticesToMark;
  noticesToMark = null;
  markNoticesSeen(user).catch(() => {});
  $("[data-acct-nav-unread]").hidden = true;
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function noticeItem(user, n) {
  const li = el("li", `acct-notice${n.unread ? " is-unread" : ""}`);
  const head = el("div", "acct-notice-head");
  head.append(
    el("span", `acct-notice-kind${n.source === "sk" ? " is-sk" : ""}`, n.source === "sk" ? t("SK から") : t("お知らせ")),
    el("time", null, formatDate(n.at))
  );
  if (n.unread) head.appendChild(el("span", "acct-notice-new", t("新着")));
  li.appendChild(head);

  if (n.source === "news") {
    const a = el("a", "acct-notice-title", n.title);
    a.href = `https://support.sk-hub.jp/?a=${encodeURIComponent(n.id)}`;
    li.appendChild(a);
    if (n.summary) li.appendChild(el("p", "acct-notice-body", n.summary));
    return li;
  }

  // お問い合わせへの返事は、見出しをいまの言語で作る（受付番号 = お問い合わせの ID の先頭 8 文字）
  const title = n.kind === "reply" && n.contactId
    ? t("お問い合わせ（受付番号 {id}）への返事", { id: n.contactId.slice(0, 8).toUpperCase() })
    : n.title;
  li.appendChild(el("strong", "acct-notice-title", title));
  li.appendChild(el("p", "acct-notice-body is-full", n.body || ""));
  const del = el("button", "acct-notice-delete", t("削除"));
  del.type = "button";
  del.addEventListener("click", async () => {
    if (!confirm(t("このお知らせを削除しますか？"))) return;
    del.disabled = true;
    try {
      await deleteDoc(doc(db, "accounts", user.uid, "notices", n.id));
      li.remove();
      if (!$("[data-acct-notices]").children.length) $("[data-acct-notices]").appendChild(el("li", "acct-notice-empty", t("お知らせはまだありません。")));
    } catch (err) {
      del.disabled = false;
      message(errText(err));
    }
  });
  li.appendChild(del);
  return li;
}

// ---------- 設定の同期 ----------

// ---------- 概要 ----------

function renderOverview(user, account) {
  const p = profileOf(user, account);
  $("[data-acct-greeting]").textContent = p.name ? t("こんにちは、{name} さん", { name: p.name }) : t("概要");
  const connected = Object.keys(SERVICES).filter((key) => isConnected(account, key)).map((key) => SERVICE_NAMES[key]);
  $("[data-acct-ov-services]").textContent = connected.length
    ? t("{names} に接続しています", { names: connected.join("・") })
    : t("接続しているサービスはありません");
  renderOverviewSettings();
}

function renderOverviewSettings() {
  const code = I18N.stored() || "ja";
  const lang = (I18N.LANGS.find((l) => l.code === code) || I18N.LANGS[0]).name;
  let at = 0;
  try { at = Number(localStorage.getItem(SYNC_AT_KEY) || 0); } catch (e) { at = 0; }
  $("[data-acct-ov-settings]").textContent = at
    ? t("表示言語: {lang} · 最後の同期: {time}", { lang, time: new Date(at).toLocaleString(I18N.locale) })
    : t("表示言語: {lang}", { lang });
}

// ---------- プライバシー（このブラウザのアクセス解析・サポートID） ----------

function renderPrivacyTiles() {
  const a = window.SKAnalytics;
  const tile = $("[data-acct-analytics]");
  tile.hidden = !(a && a.enabled());
  if (a && a.enabled()) {
    const c = a.choice();
    $("[data-acct-analytics-state]").textContent = c === "granted" ? t("許可しています")
      : c === "denied" ? t("許可していません") : t("まだ選んでいません");
  }
  let id = "";
  try { id = localStorage.getItem("skhub_uuid") || ""; } catch (e) { id = ""; }
  $("[data-acct-support-id-value]").textContent = id || t("（まだありません）");
  $("[data-acct-support-id]").disabled = !id;
}

$("[data-acct-analytics]").addEventListener("click", () => { if (window.SKAnalytics) window.SKAnalytics.open(); });
document.addEventListener("sk:analytics", renderPrivacyTiles);

$("[data-acct-support-id]").addEventListener("click", async () => {
  const id = $("[data-acct-support-id-value]").textContent;
  const note = $("[data-acct-support-id-note]");
  try {
    await navigator.clipboard.writeText(id);
    note.textContent = t("コピーしました。");
  } catch (e) {
    note.textContent = t("コピーできませんでした。ID を長押しか選択してコピーしてください。");
  }
});

function renderSettings() {
  const select = $("[data-acct-lang]");
  if (!select.options.length) {
    I18N.LANGS.forEach((l) => select.appendChild(new Option(l.name, l.code)));
  }
  select.value = I18N.stored() || "ja";
  let at = 0;
  try { at = Number(localStorage.getItem(SYNC_AT_KEY) || 0); } catch (e) { at = 0; }
  $("[data-acct-sync-at]").textContent = at ? new Date(at).toLocaleString(I18N.locale) : "-";
  renderOverviewSettings();
}

$("[data-acct-lang]").addEventListener("change", async (e) => {
  const select = e.currentTarget;
  const code = select.value;
  if (busy || !current.user) return;
  setBusy(true, select);
  try {
    await saveLanguage(current.user, code);
    I18N.setLang(code);
  } catch (err) {
    message(errText(err));
    select.value = I18N.stored() || "ja";
    setBusy(false, select);
  }
});

$("[data-acct-sync]").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (busy || !current.user) return;
  setBusy(true, btn);
  try {
    const snap = await getDoc(doc(db, "accounts", current.user.uid));
    const result = await syncSettings(current.user, snap.data());
    if (result.pulled.includes("lang") && (I18N.stored() || "ja") !== I18N.lang) { location.reload(); return; }
    renderSettings();
    message(result.pulled.length ? t("アカウントに保存された設定を、この端末に読み込みました。")
      : result.pushed.length ? t("この端末の設定をアカウントに保存しました。")
        : t("設定はそろっています。"));
  } catch (err) {
    message(errText(err));
  } finally {
    setBusy(false, btn);
  }
});

// 管理コンソールを使っているか（自分の管理グループの端末の数・参加しているグループ）
// ---------- サービス（接続しているものだけ出す） ----------

// サービスごとの文言（接続の確認・接続の解除）
const SERVICE_NAMES = { yfilter: t("Y-FILTER. 管理コンソール"), malu: "MALU", nagi: "Nagi", toolbox: "SK's Toolbox" };
const SERVICE_TEXT = {
  yfilter: {
    lead: t("このアカウントを管理コンソールに接続すると、端末の設定をまとめて管理できるようになります。"),
    usesTitle: t("管理コンソールが使う情報"),
    uses: [t("表示名とメールアドレス（共同管理者どうしで表示されます）"), t("管理グループ・接続した端末・リクエスト（このアカウントに結び付けて保存します）")],
    note: t("閲覧履歴や検索語は使いません。接続は、アカウントのページの「サービス」からいつでも解除できます。"),
    termsName: t("SK Hub Systems 利用規約"),
    disconnect: t("解除すると、次に管理コンソールを開いたときに、もう一度接続するか確認します。管理グループと接続している端末は、そのまま残ります。"),
    wipe: t("管理コンソールのデータ（管理グループ・接続している端末・リクエスト）も削除する"),
    wipeNote: t("元に戻せません。接続していた端末の Y-FILTER. は、最後に配信された設定のままフィルタリングを続けます")
  },
  malu: {
    lead: t("このアカウントを MALU に接続すると、単語帳が使えるようになり、検索履歴をほかの端末と同期できるようになります。"),
    usesTitle: t("MALU が使う情報"),
    uses: [t("単語帳に保存した言葉"), t("検索履歴（MALU の設定で同期を有効にしたときだけ）")],
    note: t("保存した言葉と検索履歴は、あなただけが見られます。接続は、アカウントのページの「サービス」からいつでも解除できます。"),
    termsName: t("SK 利用規約"),
    disconnect: t("解除すると、単語帳と検索履歴の同期が使えなくなります。保存した言葉と同期した検索履歴は、そのまま残ります。"),
    wipe: t("単語帳と、同期した検索履歴も削除する"),
    wipeNote: t("元に戻せません。端末に保存されている検索履歴は消えません")
  },
  nagi: {
    lead: t("このアカウントを Nagi に接続すると、集中の記録と 1 日の目標を、スマホやパソコンなどのあいだで同期できるようになります。"),
    usesTitle: t("Nagi が使う情報"),
    uses: [t("集中の記録（始めた時刻と、集中した時間）"), t("1 日の目標")],
    note: t("記録は、あなただけが見られます。何の勉強をしたかなどは記録しません。接続は、アカウントのページの「サービス」からいつでも解除できます。"),
    termsName: t("SK 利用規約"),
    disconnect: t("解除すると、記録の同期が止まります。アカウントに保存した記録は、そのまま残ります。"),
    wipe: t("アカウントに保存した集中の記録も削除する"),
    wipeNote: t("元に戻せません。端末に保存されている記録は消えません")
  },
  toolbox: {
    lead: t("このアカウントを SK's Toolbox に接続すると、Todo・Memo・Countdown・Calc の履歴・Toolbox の設定を、スマホやパソコンなどのあいだで同期できるようになります。同期は任意で、Toolbox の設定で始めるまでは何も保存しません。"),
    usesTitle: t("SK's Toolbox が使う情報"),
    uses: [t("同期を始めたアプリのデータ（端末で暗号化したもの）"), t("同期用のパスフレーズが合っているかを確かめるための値（パスフレーズそのものは送りません）")],
    note: t("データは同期用のパスフレーズで暗号化してから保存するので、あなた以外（SK を含みます）は中身を読めません。Memo の画像と Clock は同期しません。接続は、アカウントのページの「サービス」からいつでも解除できます。"),
    termsName: t("SK 利用規約"),
    disconnect: t("解除すると、Toolbox の同期が止まります。アカウントに保存した暗号化されたデータは、そのまま残ります。"),
    wipe: t("アカウントに保存した Toolbox の同期のデータも削除する"),
    wipeNote: t("元に戻せません。端末に保存されている Toolbox のデータは消えません")
  }
};

function fillConnect(key) {
  const s = SERVICES[key];
  const text = SERVICE_TEXT[key];
  const icon = $("[data-acct-connect-icon]");
  icon.src = s.icon;
  icon.classList.toggle("yf-tile", key === "yfilter");
  $("[data-acct-connect-title]").textContent = t("{name} で SK Hub Systems アカウントを使いますか？", { name: SERVICE_NAMES[key] });
  $("[data-acct-connect-lead]").textContent = text.lead;
  $("[data-acct-connect-uses-title]").textContent = text.usesTitle;
  $("[data-acct-connect-uses]").replaceChildren(...text.uses.map((u) => el("li", null, u)));
  $("[data-acct-connect-note]").textContent = text.note;
  const link = `<a href="${s.terms}" target="_blank" rel="noopener">${text.termsName}</a>`;
  $("[data-acct-connect-terms]").innerHTML = t("「続ける」を選ぶと、{terms}に同意したことになります。", { terms: link });
}

function renderServices(user, account) {
  let count = 0;
  Object.keys(SERVICES).forEach((key) => {
    const on = isConnected(account, key);
    if (on) count += 1;
    root.querySelectorAll(`[data-acct-service="${key}"]`).forEach((e) => { e.hidden = !on; });
    root.querySelectorAll(`[data-acct-available="${key}"]`).forEach((e) => { e.hidden = on; });
    const since = toDate(account.services?.[key]?.connectedAt);
    const at = $(`[data-acct-connected-at="${key}"]`);
    if (at) at.textContent = since ? t("{date} に接続", { date: formatDate(since) }) : "";
  });
  $("[data-acct-no-services]").hidden = count > 0;
  if (isConnected(account, "yfilter")) renderConsole(user);
  if (isConnected(account, "malu")) renderMalu(user, account);
  if (isConnected(account, "nagi")) renderNagi(user);
  if (isConnected(account, "toolbox")) renderToolbox(user);
}

// SK's Toolbox: 同期を始めているか（中身は暗号化されているので、ここでは読めない）
async function renderToolbox(user) {
  const elToolbox = $("[data-acct-toolbox]");
  try {
    const snap = await getDoc(doc(db, "accounts", user.uid, "toolbox", "key"));
    elToolbox.textContent = snap.exists()
      ? t("同期を使っています（暗号化）")
      : t("まだ同期を始めていません");
  } catch (e) {
    elToolbox.textContent = t("同期の状態を確認できませんでした");
  }
}

// Nagi: 同期している集中の記録の合計と、1 日の目標
async function renderNagi(user) {
  const elNagi = $("[data-acct-nagi]");
  try {
    const snap = await getDoc(doc(db, "accounts", user.uid, "nagi", "data"));
    if (!snap.exists()) { elNagi.textContent = t("まだ同期した記録はありません"); return; }
    const data = snap.data();
    const minutes = Math.floor((data.sessions || []).reduce((a, x) => a + (Number(x.m) || 0), 0));
    const h = Math.floor(minutes / 60);
    const total = h ? t("{h}時間{m}分", { h, m: minutes % 60 }) : t("{m}分", { m: minutes });
    elNagi.textContent = `${t("集中した時間 {time}", { time: total })} · ${t("目標 1 日 {m} 分", { m: data.goal })}`;
  } catch (e) {
    elNagi.textContent = t("記録を確認できませんでした");
  }
}

// MALU: 単語帳の言葉の数と、検索履歴の同期
async function renderMalu(user, account) {
  const sync = account.services?.malu?.historySync ? t("検索履歴の同期: オン") : t("検索履歴の同期: オフ");
  const elMalu = $("[data-acct-malu]");
  try {
    const words = await getCountFromServer(collection(db, "accounts", user.uid, "maluWords"));
    elMalu.textContent = `${t("単語帳 {n} 語", { n: words.data().count })} · ${sync}`;
  } catch (e) {
    elMalu.textContent = sync;
  }
}

// 接続の確認: 続ける → 接続してサービスに戻る / キャンセル → アカウントのページ（サービス）
$("[data-acct-connect]").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const { user } = current;
  if (busy || !user || !connectKey) return;
  setBusy(true, btn);
  try {
    await connectService(user, connectKey);
    location.replace(next || SERVICES[connectKey].url);
  } catch (err) {
    message(errText(err));
    setBusy(false, btn);
  }
});

$("[data-acct-connect-cancel]").addEventListener("click", () => {
  connectKey = "";
  next = "";
  history.replaceState(null, "", `${I18N.path("/account/")}#services`);
  render(current);
});

// 接続の解除（管理コンソールのデータも消すかを選べる）
const disconnectDialog = document.querySelector("[data-acct-disconnect-dialog]");
const disconnectWipe = disconnectDialog.querySelector("[data-acct-disconnect-wipe]");
let disconnectKey = "";
root.querySelectorAll("[data-acct-disconnect]").forEach((btn) => btn.addEventListener("click", () => {
  if (busy || !current.user) return;
  disconnectKey = btn.dataset.acctDisconnect;
  const text = SERVICE_TEXT[disconnectKey];
  disconnectDialog.querySelector("[data-acct-disconnect-title]").textContent = t("{name} との接続を解除しますか？", { name: SERVICE_NAMES[disconnectKey] });
  disconnectDialog.querySelector("[data-acct-disconnect-text]").textContent = text.disconnect;
  disconnectDialog.querySelector("[data-acct-disconnect-wipe-label]").textContent = text.wipe;
  disconnectDialog.querySelector("[data-acct-disconnect-wipe-note]").textContent = text.wipeNote;
  disconnectWipe.checked = false;
  disconnectDialog.returnValue = "";
  disconnectDialog.showModal();
}));

disconnectDialog.addEventListener("close", async () => {
  if (disconnectDialog.returnValue !== "disconnect" || !current.user || !disconnectKey) return;
  const { user, account } = current;
  const btn = root.querySelector(`[data-acct-disconnect="${disconnectKey}"]`);
  setBusy(true, btn);
  try {
    const wipe = disconnectWipe.checked;
    if (wipe && disconnectKey === "yfilter") await deleteConsoleData(user.uid);
    // MALU は、接続を外すと単語帳に書けなくなるので、先に消す（消すのは接続していなくてもできる）
    if (wipe && disconnectKey === "malu") await deleteMaluData(user.uid);
    if (wipe && disconnectKey === "nagi") await deleteNagiData(user.uid);
    if (wipe && disconnectKey === "toolbox") await deleteToolboxData(user.uid);
    await disconnectService(user, disconnectKey);
    const services = { ...(account.services || {}) };
    delete services[disconnectKey];
    const updated = { ...account, services };
    current = { ...current, account: updated };
    rememberAccount(user, updated);
    renderServices(user, updated);
    renderOverview(user, updated);
    message(!wipe ? t("接続を解除しました。")
      : disconnectKey === "malu" ? t("接続を解除し、単語帳と同期した検索履歴を削除しました。")
        : disconnectKey === "nagi" ? t("接続を解除し、アカウントに保存した集中の記録を削除しました。")
          : disconnectKey === "toolbox" ? t("接続を解除し、アカウントに保存した Toolbox の同期のデータを削除しました。")
          : t("接続を解除し、管理コンソールのデータを削除しました。"));
  } catch (err) {
    message(errText(err));
  } finally {
    setBusy(false, btn);
  }
});

async function renderConsole(user) {
  const el = $("[data-acct-console]");
  try {
    const [own, joined] = await Promise.all([
      getCountFromServer(query(collection(db, "devices"), where("ownerUid", "==", user.uid))),
      getDocs(query(collection(db, "teams"), where("members", "array-contains", user.uid)))
    ]);
    const devices = own.data().count;
    const others = joined.docs.filter((d) => d.id !== user.uid).length;
    const parts = [];
    if (devices) parts.push(t("端末 {n} 台を管理中", { n: devices }));
    if (others) parts.push(t("ほかの {n} グループの共同管理者", { n: others }));
    el.textContent = parts.length ? parts.join(" · ") : t("端末の設定をまとめて管理できます");
  } catch (e) {
    el.textContent = t("端末の設定をまとめて管理できます");
  }
}

// ---------- 操作 ----------

// ログインのボタン（data-acct-signin="google" | "github" | "microsoft"）。使える方法（/assets/hub/account.js の availableLogins）だけ出す
const logins = availableLogins();
root.querySelectorAll("[data-acct-signin]").forEach((btn) => { btn.hidden = !logins.includes(btn.dataset.acctSignin || "google"); });
// ---------- ログインと新規登録 ----------
// 画面は分けるが、どちらから入っても同じ流れ（はじめての人は「アカウントを作成」、前からある人はそのまま使える）。
// 新規登録ではパスキー（アカウントを作ったあとに登録するもの）と準備中のボタンを出さない。?signup で新規登録から開く
const signedOutView = $('[data-acct-view="signed-out"]');
let signinMode = new URLSearchParams(location.search).has("signup") ? "signup" : "login";
// 説明の文は、使える方法に合わせる（例:「Google か GitHub」）。パスキーは「〜のアカウント」ではないので入れない
const accountNames = logins.filter((k) => k !== "passkey").map((k) => LOGIN_PROVIDERS[k].name);
const accountList = accountNames.length <= 1 ? (accountNames[0] || "Google")
  : t("{a} か {b}", { a: accountNames.slice(0, -1).join(", "), b: accountNames[accountNames.length - 1] });

function setSigninMode(mode, updateUrl) {
  signinMode = mode === "signup" ? "signup" : "login";
  signedOutView.dataset.acctMode = signinMode;
  signedOutView.querySelectorAll(".acct-mode-tab").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.acctModeTab === signinMode)));
  const signup = signinMode === "signup";
  $("[data-acct-signin-lead]").textContent = signup
    ? t("いつもの {names} のアカウントで、SK Hub Systems アカウントを作れます。パスワードを新しく作る必要はありません。", { names: accountList })
    : t("SK のサービスを、ひとつのアカウントで。前に使った方法でログインしてください。");
  $("[data-acct-signin-note]").textContent = signup
    ? t("選んだアカウントでログインしたあと、規約を確認して同意すると、アカウントができます。パスキーは、アカウントを作ったあとに登録できます。")
    : t("{names} のアカウントか、登録したパスキーでログインします。", { names: accountList });
  $("[data-acct-link]").hidden = true;
  message("");
  if (updateUrl) {
    const url = new URL(location.href);
    if (signup) url.searchParams.set("signup", "1");
    else url.searchParams.delete("signup");
    history.replaceState(history.state, "", url.pathname + url.search + url.hash);
  }
}
signedOutView.querySelectorAll("[data-acct-mode-tab]").forEach((btn) => btn.addEventListener("click", () => {
  if (busy) return;
  setSigninMode(btn.dataset.acctModeTab, true);
  signedOutView.querySelector(`.acct-mode-tab[data-acct-mode-tab="${signinMode}"]`)?.focus();
}));
setSigninMode(signinMode, false);
$("[data-acct-security-lead]").textContent = accountNames.length <= 1 && (accountNames[0] || "Google") === "Google"
  ? t("このアカウントには Google アカウントでログインします。SK がパスワードを発行・保存することはありません。")
  : t("このアカウントには、{names} のアカウントでログインします。SK がパスワードを発行・保存することはありません。2 段階認証などは、それぞれのアカウントで設定します。", { names: accountList });
root.querySelectorAll("[data-acct-signin]").forEach((btn) => btn.addEventListener("click", async () => {
  if (busy) return;
  setBusy(true, btn);
  $("[data-acct-link]").hidden = true;
  try {
    await signIn(btn.dataset.acctSignin || "google");
  } catch (err) {
    if (err?.code === "sk/link-needed") showLinkNeeded(btn.dataset.acctSignin || "google", err.others || []);
    else message(errText(err));
  } finally {
    setBusy(false, btn);
  }
}));
// 同じメールアドレスで、別の方法の SK Hub Systems アカウントがあるとき: 前に使った方法でログインしてもらい、今回の方法をつなぐ
function showLinkNeeded(key, others) {
  const box = $("[data-acct-link]");
  $("[data-acct-link-text]").textContent = t("このメールアドレスの SK Hub Systems アカウントは、前に別の方法で作られています。前に使った方法でログインすると、{name} もつないで、次からどちらでもログインできるようにします。", { name: LOGIN_PROVIDERS[key].name });
  const wrap = $("[data-acct-link-buttons]");
  wrap.replaceChildren(...others.map((k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "acct-google";
    b.textContent = t("{name} でログインしてつなぐ", { name: LOGIN_PROVIDERS[k].name });
    b.addEventListener("click", async () => {
      if (busy) return;
      setBusy(true, b);
      try {
        await signInAndLinkPending(k);
        box.hidden = true;
      } catch (err) {
        message(errText(err));
      } finally {
        setBusy(false, b);
      }
    });
    return b;
  }));
  box.hidden = false;
}

$$("[data-acct-signout], [data-acct-cancel]").forEach((btn) => btn.addEventListener("click", () => signOutAccount()));
$("[data-acct-retry]").addEventListener("click", () => location.reload());

// 規約への同意と（アカウントを作るときは）年齢の確認の両方がそろったら押せる
const canRegister = () => $("[data-acct-agree]").checked && ($("[data-acct-age-row]").hidden || $("[data-acct-age]").checked);
$$("[data-acct-agree], [data-acct-age]").forEach((box) => box.addEventListener("change", () => {
  $("[data-acct-register]").disabled = !canRegister() || busy;
}));

$("[data-acct-register]").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (busy || !canRegister() || !current.user) return;
  setBusy(true, btn);
  try {
    if (current.status === "outdated") await agreeLatestTerms(current.user);
    else await register(current.user);
    const snap = await getDoc(doc(db, "accounts", current.user.uid));
    render({ status: "ready", user: current.user, account: snap.data() });
  } catch (err) {
    message(errText(err));
  } finally {
    setBusy(false, btn);
  }
});

// データのダウンロード
$("[data-acct-export]").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const { user, account } = current;
  if (busy || !user) return;
  setBusy(true, btn);
  try {
    const [teams, devices, notices, maluWords, maluHistory, backups, nagiData, timetableInbox, timetableUserInbox, ...toolboxDocs] = await Promise.all([
      getDocs(query(collection(db, "teams"), where("members", "array-contains", user.uid))),
      getDocs(query(collection(db, "devices"), where("ownerUid", "==", user.uid))),
      getDocs(collection(db, "accounts", user.uid, "notices")),
      getDocs(collection(db, "accounts", user.uid, "maluWords")),
      getDoc(doc(db, "accounts", user.uid, "malu", "history")),
      getDocs(collection(db, "teams", user.uid, "backups")),
      getDoc(doc(db, "accounts", user.uid, "nagi", "data")),
      getDoc(inboxRef()).catch(() => null),
      getDoc(doc(db, "timetableUserInbox", user.uid)).catch(() => null),
      ...TOOLBOX_DOCS.map((id) => getDoc(doc(db, "accounts", user.uid, "toolbox", id)))
    ]);
    // 日時は ISO 8601、バイト列（Toolbox の暗号文）は Base64 にする
    const plain = (v) => JSON.parse(JSON.stringify(v, function (k, x) {
      const raw = this[k];
      if (raw && typeof raw.toBase64 === "function") return raw.toBase64();
      if (raw && typeof raw.toDate === "function") return raw.toDate().toISOString();
      return x;
    }));
    const data = {
      exportedAt: new Date().toISOString(),
      service: "SK Hub Systems アカウント",
      login: {
        uid: user.uid,
        name: user.displayName,
        email: user.email,
        photoURL: user.photoURL,
        provider: "google.com",
        createdAt: user.metadata?.creationTime,
        lastSignInAt: user.metadata?.lastSignInTime
      },
      // profile（表示名・アイコン）・settings（同期している設定）・noticesSeenAt・seen（利用の記録: タイムゾーンとサポートID）を含む
      account: plain(account),
      notices: notices.docs.map((d) => ({ id: d.id, ...plain(d.data()) })),
      malu: {
        words: maluWords.docs.map((d) => plain(d.data())),
        syncedHistory: maluHistory.exists() ? plain(maluHistory.data()) : null
      },
      // Nagi の集中の記録（s = 始めた時刻（ミリ秒）、m = 集中した分）と 1 日の目標
      nagi: nagiData.exists() ? plain(nagiData.data()) : null,
      // SK's Toolbox の同期のデータ（端末で暗号化したもの。同期用のパスフレーズがないと読めません）
      toolbox: Object.fromEntries(toolboxDocs.filter((d) => d.exists()).map((d) => [d.id, plain(d.data())])),
      // SK's Toolbox の時間割の配信で、このアカウントのメールアドレスあてに配信された時間割の ID
      timetableInbox: timetableInbox && timetableInbox.exists() ? plain(timetableInbox.data()) : null,
      // 招待コードで参加して、このアカウントで受け取っている時間割の ID
      timetableUserInbox: timetableUserInbox && timetableUserInbox.exists() ? plain(timetableUserInbox.data()) : null,
      yFilterConsole: {
        teams: teams.docs.map((d) => ({ id: d.id, role: d.id === user.uid ? "owner" : "co-admin", ...plain(d.data()) })),
        devices: devices.docs.map((d) => ({ id: d.id, ...plain(d.data()) })),
        // 自分の端末の設定のバックアップ（ID = 端末の ID）
        backups: backups.docs.map((d) => ({ id: d.id, ...plain(d.data()) }))
      }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sk-hub-account-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (err) {
    message(errText(err));
  } finally {
    setBusy(false, btn);
  }
});

// ---------- 削除 ----------
const dialog = document.querySelector("[data-acct-delete-dialog]");
// 「本人の確認ができました」は、LINE・Kakao の画面から戻ってきて出したときだけ
dialog.addEventListener("close", () => { dialog.querySelector("[data-acct-delete-reauthed]").hidden = true; });
const deleteAgree = dialog.querySelector("[data-acct-delete-agree]");
const deleteConfirm = dialog.querySelector("[data-acct-delete-confirm]");
deleteAgree.addEventListener("change", () => { deleteConfirm.disabled = !deleteAgree.checked; });

$("[data-acct-delete]").addEventListener("click", () => {
  if (busy || !current.user) return;
  deleteAgree.checked = false;
  deleteConfirm.disabled = true;
  dialog.returnValue = "";
  dialog.showModal();
});

dialog.addEventListener("close", async () => {
  if (dialog.returnValue !== "delete" || !deleteAgree.checked || !current.user) return;
  const btn = $("[data-acct-delete]");
  const user = current.user;
  setBusy(true, btn);
  const label = btn.querySelector("[data-acct-delete-label]");
  label.textContent = t("削除しています…");
  try {
    // 途中で止まらないように、データを消す前に本人を確認する（つないでいるログインの方法で）
    // LINE・Kakao だけの人は、LINE・Kakao の画面に移動して、このページに戻ってくる（showReturned がもう一度この確認を出す）
    await confirmIdentity(user, location.origin + location.pathname);
    await deleteServiceData(user.uid);
    await deleteDoc(doc(db, "accounts", user.uid));
    await deleteLogin(user);
    showView("signed-out");
    message(t("アカウントを削除しました。ご利用ありがとうございました。"));
  } catch (err) {
    message(t("削除できませんでした。{reason}", { reason: errText(err) }));
  } finally {
    label.textContent = t("アカウントを削除");
    setBusy(false, btn);
  }
});

// アカウントのお知らせと、管理コンソールのデータを消す（アカウントの削除）
async function deleteServiceData(uid) {
  const notices = await getDocs(collection(db, "accounts", uid, "notices"));
  await deleteRefs(notices.docs.map((d) => d.ref));
  await deleteMaluData(uid);
  await deleteNagiData(uid);
  await deleteToolboxData(uid);
  await deleteTimetableInbox();
  await deleteConsoleData(uid);
}

// SK's Toolbox の時間割の配信: 自分のメールアドレスあての受け取り箱（配信された時間割の ID の一覧）
const inboxRef = () => doc(db, "timetableInbox", String(current.user?.email || "").toLowerCase() || "-");
//   招待コードで参加した時間割は、アカウント（UID）あての受け取り箱（timetableUserInbox）
async function deleteTimetableInbox() {
  if (current.user) await deleteRefs([doc(db, "timetableUserInbox", current.user.uid)]).catch(() => { /* ない */ });
  if (!current.user?.email) return;
  await deleteRefs([inboxRef()]).catch(() => { /* ない・確認していないメールアドレス */ });
}

// SK's Toolbox のデータ: 同期した暗号化されたデータと、パスフレーズを確かめるための値
const TOOLBOX_DOCS = ["key", "settings", "todo", "memo", "countdown", "calc", "timetable", "roulette"];
async function deleteToolboxData(uid) {
  await deleteRefs(TOOLBOX_DOCS.map((id) => doc(db, "accounts", uid, "toolbox", id)));
}

// Nagi のデータ: 同期した集中の記録と目標
async function deleteNagiData(uid) {
  await deleteRefs([doc(db, "accounts", uid, "nagi", "data")]);
}

// MALU のデータ: 単語帳と、同期した検索履歴
async function deleteMaluData(uid) {
  const words = await getDocs(collection(db, "accounts", uid, "maluWords"));
  await deleteRefs([...words.docs.map((d) => d.ref), doc(db, "accounts", uid, "malu", "history")]);
}

async function deleteRefs(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

// 管理コンソールのデータ: 自分の管理グループ（端末・リクエスト・コード・自分の端末のバックアップ）を消し、ほかのグループからは抜ける
async function deleteConsoleData(uid) {
  const owned = await Promise.all([
    getDocs(query(collection(db, "devices"), where("ownerUid", "==", uid))),
    getDocs(query(collection(db, "requests"), where("ownerUid", "==", uid))),
    getDocs(query(collection(db, "pairingCodes"), where("ownerUid", "==", uid))),
    getDocs(query(collection(db, "teamInvites"), where("teamId", "==", uid))),
    getDocs(collection(db, "teams", uid, "backups"))
  ]);
  await deleteRefs(owned.flatMap((snap) => snap.docs.map((d) => d.ref)));

  const teams = await getDocs(query(collection(db, "teams"), where("members", "array-contains", uid)));
  for (const team of teams.docs) {
    if (team.id === uid) continue;
    await updateDoc(team.ref, { members: arrayRemove(uid), [`memberInfo.${uid}`]: deleteField() });
  }
  const own = await getDoc(doc(db, "teams", uid));
  if (own.exists()) await deleteDoc(own.ref);
}

// ヘッダーのメニューの「ログアウト」（/account/?signout=1）
if (new URLSearchParams(location.search).has("signout")) {
  history.replaceState(null, "", I18N.path("/account/"));
  signOutAccount().finally(() => watchAccount(render));
} else {
  watchAccount(render);
}
