// SK Hub Systems アカウント（ログインは Google・GitHub・Microsoft・LINE・Kakao・パスキー。GitHub は GITHUB_LOGIN、Microsoft は MICROSOFT_LOGIN、
// LINE は LINE_LOGIN、Kakao は KAKAO_LOGIN、パスキーは PASSKEY_LOGIN が true のときだけ出す）
// sk-hub.jp のページ（管理コンソール・これからのサービス）で共通に使うモジュール。
//   ・ログイン状態は同じサイトの中で共有される（Firebase Authentication がブラウザに保存する）
//   ・アカウントの登録 = accounts/{UID} に規約への同意を記録すること。Google の名前・メールアドレスは Firebase Authentication にだけある
//   ・accounts/{UID} には、本人が決めたプロフィール（profile）・同期する設定（settings）・お知らせを読んだ日時（noticesSeenAt）も入る
//   ・SK からのお知らせ（お問い合わせへの返信など）は accounts/{UID}/notices
//   ・データ構造と権限は y-filter リポジトリの systems/firestore.rules を参照
// 使い方（サービスのページ）:
//   import { watchAccount, accountPageUrl } from "/assets/hub/account.js";
//   watchAccount(({ status, user }) => { if (status !== "ready") location.href = accountPageUrl(); ... });
import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  GithubAuthProvider, GoogleAuthProvider, OAuthProvider, deleteUser, getAuth, linkWithCredential, linkWithPopup, onAuthStateChanged, reauthenticateWithPopup,
  signInWithCustomToken, signInWithPopup, signOut, unlink, updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection, deleteField, doc, getCountFromServer, getDoc, getFirestore, query, serverTimestamp, setDoc, updateDoc, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
// 管理コンソールと同じ設定を使う（同じ設定なら initializeApp は同じアプリを返す）
import { firebaseConfig } from "/y-filter/firebase-config.js";

export const ACCOUNT_NAME = "SK Hub Systems アカウント";
// アカウント規約（/policies/docs/sk-hub-account.txt）の版。変えると、次に使うときに同意し直してもらう
export const ACCOUNT_TERMS_VERSION = "2026-10-14";

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

const accountRef = (uid) => doc(db, "accounts", uid);
const noticesOf = (uid) => collection(db, "accounts", uid, "notices");

// ---------- プロフィール（表示名・アイコン） ----------
// 本人が決めていなければ Google の名前と写真を使う。avatar: "google"（Google の写真）/ "letter"（頭文字と色）
export const PROFILE_COLORS = {
  blue: "#2563eb", green: "#16a34a", amber: "#d97706", violet: "#7c3aed", pink: "#db2777", teal: "#0d9488"
};
export const PROFILE_NAME_MAX = 40;

export function profileOf(user, account) {
  const p = (account && account.profile) || {};
  const name = (p.name || user.displayName || "").trim();
  const photo = p.avatar !== "letter" && user.photoURL ? user.photoURL : "";
  const color = PROFILE_COLORS[p.color] ? p.color : "blue";
  return {
    name,
    photo,
    letter: (name || user.email || "?").trim().charAt(0).toUpperCase(),
    color,
    colorValue: PROFILE_COLORS[color]
  };
}

export async function saveProfile(user, profile) {
  await updateDoc(accountRef(user.uid), {
    profile: {
      name: String(profile.name || "").trim().slice(0, PROFILE_NAME_MAX),
      avatar: profile.avatar === "letter" ? "letter" : "google",
      color: PROFILE_COLORS[profile.color] ? profile.color : "blue"
    }
  });
}

// ---------- サービスの接続 ----------
// サービス（管理コンソールなど）は、最初に使うときに「このアカウントで使いますか？」と確かめてから接続する
// （/account/?connect=<key>&next=<サービスの URL>）。接続した記録は accounts/{UID}.services.<key> = { connectedAt }
// 接続していないサービスは、アカウントのページやヘッダーのメニューに出さない
// MALU のデータ: 単語帳 accounts/{UID}/maluWords/{ID}・同期した検索履歴 accounts/{UID}/malu/history
//   検索履歴の同期は、MALU で本人が有効にしたときだけ（services.malu.historySync）
export const SERVICES = {
  yfilter: { name: "Y-FILTER. 管理コンソール", url: "/y-filter/", icon: "/y-filter/shared/icon.svg", terms: "/policies/#sk-hub-systems" },
  malu: { name: "MALU", url: "/dictionary/", icon: "/dictionary/ico/icon-192.png", terms: "/policies/#sk-terms" },
  // Nagi のデータ: 集中の記録と 1 日の目標 accounts/{UID}/nagi/data（nagi/account.js）
  nagi: { name: "Nagi", url: "/nagi/", icon: "/nagi/ico/icon-192.png", terms: "/policies/#sk-terms" },
  // SK's Toolbox のオンライン同期（任意）: accounts/{UID}/toolbox/{key|settings|todo|memo|countdown|calc}（toolbox/shared/sync-core.js）
  //   中身は端末で暗号化したものだけ（同期用のパスフレーズは本人だけが知っている）。接続しても、Toolbox の設定で同期を始めるまでは何も保存しない
  toolbox: { name: "SK's Toolbox", url: "/toolbox/", icon: "/toolbox/icon-192.png", terms: "/policies/#sk-terms" }
};

export function isConnected(account, key) {
  return !!(account && account.services && account.services[key]);
}

export async function connectService(user, key) {
  if (!SERVICES[key]) return;
  await updateDoc(accountRef(user.uid), { [`services.${key}`]: { connectedAt: serverTimestamp() } });
}

export async function disconnectService(user, key) {
  await updateDoc(accountRef(user.uid), { [`services.${key}`]: deleteField() });
}

// ---------- ヘッダーの表示 ----------
// ヘッダーに出す名前とアイコン（このブラウザの中だけに保存。site.js が読む）
const HINT_KEY = "skhub_account";

function readHint() {
  try { return JSON.parse(localStorage.getItem(HINT_KEY) || "null"); } catch (e) { return null; }
}
// 変えたら、同じページのヘッダー（site.js）に知らせて表示を更新してもらう
function saveHint(user, account, extra) {
  const p = profileOf(user, account);
  const prev = readHint() || {};
  // services … 接続しているサービス（ヘッダーのメニューに出す）。アカウントを読み込む前（null）は前の値のまま
  const services = account ? Object.keys(account.services || {}).filter((k) => SERVICES[k]) : (prev.services || []);
  // email … アプリ共通のアカウントの画面（assets/hub/account-button.js）に出す
  const hint = { name: p.name, email: user.email || "", photo: p.photo, letter: p.letter, color: p.colorValue, unread: prev.unread || 0, services, ...extra };
  try { localStorage.setItem(HINT_KEY, JSON.stringify(hint)); } catch (e) { /* 保存できなくても動く */ }
  document.dispatchEvent(new CustomEvent("skhub:account"));
}
function clearHint() {
  try { localStorage.removeItem(HINT_KEY); } catch (e) { /* 同上 */ }
  document.dispatchEvent(new CustomEvent("skhub:account"));
}

// サービスのページで、アカウントが使える（ready）と確かめたときに呼ぶ（ヘッダーにログイン中と出す）
export function rememberAccount(user, account) {
  saveHint(user, account);
}

// お知らせの未読の数をヘッダーに出す（0 で消える）
export function setUnreadHint(count) {
  const hint = readHint();
  if (!hint || hint.unread === count) return;
  hint.unread = count;
  try { localStorage.setItem(HINT_KEY, JSON.stringify(hint)); } catch (e) { /* 同上 */ }
  document.dispatchEvent(new CustomEvent("skhub:account"));
}

// ---------- ログイン ----------
// ---------- ログインの方法 ----------
// GitHub は、GitHub に OAuth アプリを登録し、Firebase の「ログイン方法」で GitHub を有効にしてから true にする
export const GITHUB_LOGIN = true;
// Microsoft は、Azure にアプリを登録し（ディレクトリが必要）、Firebase で有効にしてから true にする（2026-10 時点では見送り）
export const MICROSOFT_LOGIN = false;
// LINE・Kakao は Firebase が対応していないので、api.sk-hub.jp（sk-api リポジトリの Cloudflare Workers）で本人を確かめ、
// カスタムトークンでログインする（external: true）。チャネル・アプリを登録して Worker を公開してから true にする
export const LINE_LOGIN = true;
export const KAKAO_LOGIN = true;
// パスキーも api.sk-hub.jp で確かめる（公開鍵だけを保存）。ほかの方法でログインしたあと「つなぐ」で登録し、次からパスキーだけで入れる
export const PASSKEY_LOGIN = true;
// 手元（http://localhost）で開いたページも本番の Worker を使う（api.sk-hub.jp は localhost から戻ることを許している）。
// 手元の Worker（sk-api で npm run dev）を試すときだけ、localStorage の skhub_api に "http://localhost:8788" を入れる
export const API_ORIGIN = (() => {
  try {
    const dev = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && localStorage.getItem("skhub_api");
    if (dev && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(dev)) return dev;
  } catch (e) { /* 読めなければ本番 */ }
  return "https://api.sk-hub.jp";
})();
export const LOGIN_PROVIDERS = {
  google: { id: "google.com", name: "Google", security: "https://myaccount.google.com/security" },
  github: { id: "github.com", name: "GitHub", security: "https://github.com/settings/security" },
  microsoft: { id: "microsoft.com", name: "Microsoft", security: "https://account.microsoft.com/security" },
  line: { id: "line", name: "LINE", security: "https://account.line.me/", external: true },
  kakao: { id: "kakao", name: "Kakao", security: "https://accounts.kakao.com/weblogin/account/info", external: true },
  passkey: { id: "passkey", name: "パスキー", security: "", external: true, passkey: true }
};
const LOGIN_FLAGS = { github: GITHUB_LOGIN, microsoft: MICROSOFT_LOGIN, line: LINE_LOGIN, kakao: KAKAO_LOGIN, passkey: PASSKEY_LOGIN };
// パスキーは、ブラウザが対応しているときだけ
const passkeySupported = () => typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;
// LINE の中のブラウザ（ミニアプリ・トークで開いたリンク）では、LINE だけ（Google などのログインの画面は LINE の中では開けない）
export const inLineApp = () => typeof navigator !== "undefined" && /\bLine\/\d/.test(navigator.userAgent);
export const availableLogins = () => Object.keys(LOGIN_PROVIDERS).filter((k) => LOGIN_FLAGS[k] !== false && (k !== "passkey" || passkeySupported()) && (!inLineApp() || k === "line"));
const isExternal = (key) => !!LOGIN_PROVIDERS[key]?.external;
function provider(key = "google") {
  if (key === "github") {
    // 名前・アイコンと、メールアドレス（非公開にしている人のも）を読む
    const p = new GithubAuthProvider();
    p.addScope("read:user");
    p.addScope("user:email");
    p.setCustomParameters({ allow_signup: "true" });
    return p;
  }
  if (key === "microsoft") {
    // 個人の Microsoft アカウントと、職場・学校のアカウントの両方（Azure の登録で「すべてのアカウント」）
    const p = new OAuthProvider("microsoft.com");
    p.setCustomParameters({ prompt: "select_account" });
    return p;
  }
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: "select_account" });
  return p;
}
// そのユーザーがつないでいるログインの方法（"google" | "github" | "line" など）
//   LINE・Kakao は api.sk-hub.jp に問い合わせた結果（loadExternalLogins）。読み込む前は Firebase の分だけ
export function loginsOf(user) {
  const ids = (user?.providerData || []).map((p) => p.providerId);
  if (user && externalLogins.uid === user.uid) ids.push(...externalLogins.list.map((l) => l.provider));
  return Object.keys(LOGIN_PROVIDERS).filter((k) => ids.includes(LOGIN_PROVIDERS[k].id));
}

// ---------- LINE・Kakao（api.sk-hub.jp） ----------
// ログイン・つなぐ・本人の確認は、LINE・Kakao の画面に移動して、終わったら元のページに戻ってくる（#sk-auth=<1 回だけのコード>）
//   戻ってきたら、このモジュールを読み込んだときに externalResult でコードを引き換えて、ログインする
let externalLogins = { uid: null, list: [] };

async function api(path, { method = "GET", body, user } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (user) headers.Authorization = `Bearer ${await user.getIdToken()}`;
  let res;
  try {
    res = await fetch(API_ORIGIN + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (err) {
    // ネットにはつながっているのに api.sk-hub.jp だけに届かない（フィルタリング・広告ブロックなど）こともあるので、分けて知らせる
    const e = new Error(navigator.onLine === false ? "offline" : "api-unreachable");
    e.code = navigator.onLine === false ? "auth/network-request-failed" : "sk/api-unreachable";
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `api-${res.status}`);
    e.code = `sk/${data.error || "api-error"}`;
    throw e;
  }
  return data;
}

// つないでいる LINE・Kakao を読み込む（アカウントのページの「サインインとセキュリティ」を出す前に）。読めなくても Firebase の分は出す
export async function loadExternalLogins(user) {
  if (!availableLogins().some(isExternal)) return [];
  try {
    const { logins } = await api("/logins", { user });
    externalLogins = { uid: user.uid, list: logins || [] };
  } catch (e) {
    externalLogins = { uid: user.uid, list: [] };
  }
  return externalLogins.list;
}

// 読み込んだ LINE・Kakao・パスキーの一覧（パスキーは { provider: "passkey", count }）
export function externalLoginsOf(user) {
  return user && externalLogins.uid === user.uid ? externalLogins.list : [];
}

// LINE・Kakao の画面に移動する（戻ってくるまで終わらない）
//   mode: "signin" | "link"（いまのアカウントにつなぐ）| "reauth"（本人の確認）
async function goExternal(key, mode, returnTo = location.href, user = null) {
  const { url } = await api("/auth/start", { method: "POST", body: { provider: key, mode, returnTo }, user });
  location.assign(url);
  return new Promise(() => {});
}

// ---------- LINE ミニアプリ（SK's Toolbox）の中 ----------
// LINE の中では LINE ログインの画面に移動しない。LIFF のアクセストークンを api.sk-hub.jp に送って、LINE ログインと同じアカウントに入る
//   create … つながったアカウントがないとき、新しく作るか（false なら code sk/not-linked で断られる）
export async function signInWithLiff(accessToken, create = false) {
  const res = await api("/auth/liff", { method: "POST", body: { accessToken, create } });
  const { user } = await signInWithCustomToken(auth, res.token);
  if (!user.displayName && (res.name || res.picture)) {
    await updateProfile(user, { displayName: res.name || null, photoURL: res.picture || null }).catch(() => {});
  }
  return { user, isNew: !!res.isNew };
}

// 公式 LINE（SK Hub）: 友だちか・お知らせを LINE で受け取るか（{ linked, friend, notify, bot: { id, url } }）
export const lineStatus = (user) => api("/line/status", { user });
export const setLineNotify = (user, on) => api("/line/notify", { method: "POST", user, body: { on: !!on } });

// ---------- パスキー（WebAuthn） ----------
// api.sk-hub.jp がくれたオプション（JSON。バイト列は base64url）を、ブラウザの形にする／ブラウザの結果を JSON にする
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)).buffer;
const toB64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const credList = (list) => (list || []).map((c) => ({ ...c, id: fromB64url(c.id) }));

function credentialJSON(cred) {
  if (typeof cred.toJSON === "function") return cred.toJSON();
  const r = cred.response, out = { id: cred.id, rawId: toB64url(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults?.() || {}, authenticatorAttachment: cred.authenticatorAttachment || undefined, response: { clientDataJSON: toB64url(r.clientDataJSON) } };
  if (r.attestationObject) {
    out.response.attestationObject = toB64url(r.attestationObject);
    out.response.transports = r.getTransports?.() || [];
  } else {
    out.response.authenticatorData = toB64url(r.authenticatorData);
    out.response.signature = toB64url(r.signature);
    if (r.userHandle) out.response.userHandle = toB64url(r.userHandle);
  }
  return out;
}

// やめた・この端末にもうある、などを、分かる理由にする
function passkeyError(err) {
  if (err?.code) return err;
  const e = new Error(err?.message || "passkey");
  e.code = err?.name === "NotAllowedError" || err?.name === "AbortError" ? "sk/cancelled"
    : err?.name === "InvalidStateError" ? "sk/passkey-exists"
    : "sk/passkey-failed";
  return e;
}

// この端末の呼び名（パスキーを見分けるため。例: Mac・Chrome）
function deviceLabel() {
  const ua = navigator.userAgent;
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [os, br].filter(Boolean).join("・");
}

// パスキーで署名して、カスタムトークンをもらう（expectUid … 本人の確認のとき。ほかの人のパスキーなら断られる）
async function passkeyToken(expectUid) {
  const { ticket, options } = await api("/passkey/login/options", { method: "POST" });
  let cred;
  try {
    cred = await navigator.credentials.get({ publicKey: { ...options, challenge: fromB64url(options.challenge), allowCredentials: credList(options.allowCredentials) } });
  } catch (err) {
    throw passkeyError(err);
  }
  const { token } = await api("/passkey/login/verify", { method: "POST", body: { ticket, response: credentialJSON(cred), expectUid } });
  return token;
}

// いまのアカウントに、この端末のパスキーを足す
async function registerPasskey(user) {
  const { ticket, options } = await api("/passkey/register/options", { method: "POST", user, body: { userName: user.email || user.displayName || "", displayName: user.displayName || "" } });
  let cred;
  try {
    cred = await navigator.credentials.create({
      publicKey: { ...options, challenge: fromB64url(options.challenge), user: { ...options.user, id: fromB64url(options.user.id) }, excludeCredentials: credList(options.excludeCredentials) }
    });
  } catch (err) {
    throw passkeyError(err);
  }
  await api("/passkey/register/verify", { method: "POST", user, body: { ticket, response: credentialJSON(cred), name: deviceLabel() } });
  await loadExternalLogins(user);
}

// 戻ってきたとき（#sk-auth=… / #sk-auth-error=…）。結果は { mode, provider, isNew } か { error }、戻ってきたのでなければ null
export const externalResult = (async () => {
  const hash = new URLSearchParams(location.hash.slice(1));
  const code = hash.get("sk-auth"), error = hash.get("sk-auth-error");
  if (!code && !error) return null;
  history.replaceState(history.state, "", location.pathname + location.search);
  if (error) return { error };
  let provider;
  try {
    const res = await api("/auth/exchange", { method: "POST", body: { code } });
    provider = res.provider;
    if (res.token) {
      const { user } = await signInWithCustomToken(auth, res.token);
      // はじめての人は、LINE・Kakao の名前とアイコンを使う（あとでプロフィールから変えられる）
      if (!user.displayName && (res.name || res.picture)) {
        await updateProfile(user, { displayName: res.name || null, photoURL: res.picture || null }).catch(() => {});
      }
    }
    return { mode: res.mode, provider: res.provider, isNew: !!res.isNew };
  } catch (e) {
    return { provider, error: e.message === "expired" ? "expired" : "failed" };
  }
})();
// 同じメールアドレスで、別の方法のアカウントがすでにあるとき（例: Google で作った人が Microsoft で入ろうとした）
//   いったんその方法でログインしてもらい、あとから linkPending() で今回の方法をつなぐ
let pending = null;

// いまログインしているユーザー（ログイン状態が読み込まれるのを待つ。ログインしていなければ null）
export function currentUser() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => { stop(); resolve(user); });
  });
}

export async function signIn(key = "google") {
  if (key === "passkey") return signInWithCustomToken(auth, await passkeyToken());
  if (isExternal(key)) return goExternal(key, "signin");
  try {
    return await signInWithPopup(auth, provider(key));
  } catch (err) {
    if (err?.code === "auth/account-exists-with-different-credential") {
      const cred = key === "github" ? GithubAuthProvider.credentialFromError(err) : key === "google" ? GoogleAuthProvider.credentialFromError(err) : OAuthProvider.credentialFromError(err);
      pending = { key, credential: cred };
      const e = new Error("link-needed");
      e.code = "sk/link-needed";
      // どの方法で作ったかは（なりすまし対策で）教えてもらえないので、ほかの方法を全部出す
      e.others = availableLogins().filter((k) => k !== key && !isExternal(k));
      e.email = err.customData?.email || "";
      throw e;
    }
    throw err;
  }
}
// 上の続き: 前からある方法でログインしたあと、今回の方法をつなぐ（ボタンを押してから呼ぶ。ポップアップが止められないように）
export async function signInAndLinkPending(existingKey) {
  const res = await signInWithPopup(auth, provider(existingKey));
  if (pending?.credential) {
    try { await linkWithCredential(res.user, pending.credential); } finally { pending = null; }
  }
  return res;
}
// ログインの方法を足す・外す（アカウントのページの「サインインとセキュリティ」）。最後の 1 つは外せない
//   LINE・Kakao をつなぐときは、LINE・Kakao の画面に移動する（戻ってきたら externalResult が { mode: "link" }）
//   パスキーは、この端末で作って登録する（ページは移動しない）
export function linkLogin(user, key) {
  if (key === "passkey") return registerPasskey(user);
  if (isExternal(key)) return goExternal(key, "link", location.href, user);
  return linkWithPopup(user, provider(key));
}
export async function unlinkLogin(user, key) {
  if (loginsOf(user).length <= 1) { const e = new Error("last-login"); e.code = "sk/last-login"; throw e; }
  if (isExternal(key)) {
    await api(`/logins/${key}`, { method: "DELETE", user });
    externalLogins.list = externalLogins.list.filter((l) => l.provider !== key);
    return;
  }
  return unlink(user, LOGIN_PROVIDERS[key].id);
}

// SK's Toolbox のオンライン同期の、この端末の設定（暗号化の鍵を含む）。ログアウトしたら消す
const TOOLBOX_SYNC_KEY = "sk_toolbox_sync";

export function signOutAccount() {
  clearHint();
  try { localStorage.removeItem(SYNC_BASE_KEY); localStorage.removeItem(TOOLBOX_SYNC_KEY); } catch (e) { /* 同上 */ }
  return signOut(auth);
}

// 大事な操作（アカウントの削除）の前に、もう一度確認する（つないでいる方法で。Google があれば Google）
//   LINE・Kakao・パスキーだけの人は、パスキー（その場で）か LINE・Kakao の画面に移動して確認する（returnTo に戻ってくる。戻ったあとの 4 分間は確認済みとして扱う）
const RECENT_LOGIN_MS = 4 * 60 * 1000;
export async function confirmIdentity(user, returnTo = location.href) {
  if (externalLogins.uid !== user.uid) await loadExternalLogins(user);
  const logins = loginsOf(user);
  const popup = logins.filter((k) => !isExternal(k));
  if (popup.length) return reauthenticateWithPopup(user, provider(popup.includes("google") ? "google" : popup[0]));
  const { authTime } = await user.getIdTokenResult();
  if (Date.now() - new Date(authTime).getTime() < RECENT_LOGIN_MS) return;
  if (!logins.length) { const e = new Error("signed-out"); e.code = "sk/signed-out"; throw e; }
  // パスキーがあれば、ページを移動せずにその場で確かめる（同じアカウントでログインし直す）
  if (logins.includes("passkey")) return signInWithCustomToken(auth, await passkeyToken(user.uid));
  return goExternal(logins[0], "reauth", returnTo, user);
}
export const confirmWithGoogle = confirmIdentity; // 前の名前（互換）

export async function deleteLogin(user) {
  // LINE・Kakao とのつながりを先に消す（Firebase のユーザーを消すと、api.sk-hub.jp で本人を確かめられなくなる）
  //   LINE・Kakao をつないでいなければ、api.sk-hub.jp が止まっていても削除できるようにする
  //   Firebase はログインから 5 分を過ぎると削除を断るので、つながりを外す前に確かめる（外したあとで断られると、LINE・Kakao だけの人が入れなくなる）
  const { authTime } = await user.getIdTokenResult();
  if (Date.now() - new Date(authTime).getTime() > RECENT_LOGIN_MS) {
    const e = new Error("requires-recent-login");
    e.code = "auth/requires-recent-login";
    throw e;
  }
  if (availableLogins().some(isExternal)) {
    if (externalLogins.uid !== user.uid) await loadExternalLogins(user);
    const unlinkAll = api("/logins", { method: "DELETE", user });
    if (loginsOf(user).some(isExternal)) await unlinkAll;
    else await unlinkAll.catch(() => {});
  }
  await deleteUser(user);
  clearHint();
  try { localStorage.removeItem(SYNC_BASE_KEY); localStorage.removeItem(TOOLBOX_SYNC_KEY); } catch (e) { /* 同上 */ }
}

// ---------- 設定の同期 ----------
// このブラウザの設定（localStorage）とアカウントの settings をそろえる。
//   前回そろえたときの値（SYNC_BASE_KEY）と比べて、変わったほうを正とする（両方変わっていたら、この端末を正とする）。
//   この端末ではじめて同期するときは、アカウントに保存された設定を使う。
export const SYNC_ITEMS = [
  { key: "lang", storage: "sk_lang", label: "表示言語" },
  { key: "malu", storage: "dictionarySettings", label: "MALU の設定" },
  { key: "qrdrop", storage: "qr-drop-settings", label: "QR Drop の設定" }
];
const LANG_CODES = ["ja", "en", "zh-CN", "zh-TW", "ko"];
const SYNC_MAX = 4000;
const SYNC_BASE_KEY = "skhub_sync_base";
export const SYNC_AT_KEY = "skhub_sync_at"; // 最後に同期した時刻（assets/hub/sync-loader.js が間隔をあけるのに使う）

function readLocal(item) {
  let v = null;
  try { v = localStorage.getItem(item.storage); } catch (e) { return null; }
  if (v == null || v === "") return null;
  if (item.key === "lang" && !LANG_CODES.includes(v)) return null;
  if (item.key !== "lang") {
    try { JSON.parse(v); } catch (e) { return null; }
    if (v.length > SYNC_MAX) return null;
  }
  return v;
}

// 戻り値: { pulled: [アカウントから読み込んだ key], pushed: [アカウントに保存した key] }
export async function syncSettings(user, account) {
  let base = {};
  try { base = JSON.parse(localStorage.getItem(SYNC_BASE_KEY) || "{}"); } catch (e) { base = {}; }
  const known = base.uid === user.uid ? (base.values || {}) : {};
  const remote = (account && account.settings) || {};
  const values = {};
  const pulled = [];
  const push = {};

  SYNC_ITEMS.forEach((item) => {
    const local = readLocal(item);
    const r = typeof remote[item.key] === "string" ? remote[item.key] : null;
    const firstTime = !(item.key in known);
    let result = local;
    if (local === r) {
      result = local;
    } else if (r != null && (firstTime || local === known[item.key])) {
      // この端末ではまだ変えていない（または、はじめて同期する）: アカウントの設定を使う
      try { localStorage.setItem(item.storage, r); } catch (e) { /* 保存できなければそのまま */ }
      pulled.push(item.key);
      result = r;
    } else if (local != null) {
      push[item.key] = local;
    }
    values[item.key] = result;
  });

  const pushed = Object.keys(push);
  if (pushed.length) {
    const update = {};
    pushed.forEach((k) => { update[`settings.${k}`] = push[k]; });
    await updateDoc(accountRef(user.uid), update);
  }
  try {
    localStorage.setItem(SYNC_BASE_KEY, JSON.stringify({ uid: user.uid, values }));
    localStorage.setItem(SYNC_AT_KEY, String(Date.now()));
  } catch (e) { /* 同上 */ }
  return { pulled, pushed };
}

// アカウントのページで表示言語を選んだとき: この端末とアカウントの両方に保存する
export async function saveLanguage(user, code) {
  if (!LANG_CODES.includes(code)) return;
  await updateDoc(accountRef(user.uid), { "settings.lang": code });
  try {
    localStorage.setItem("sk_lang", code);
    const base = JSON.parse(localStorage.getItem(SYNC_BASE_KEY) || "{}");
    if (base.uid === user.uid) {
      base.values = { ...(base.values || {}), lang: code };
      localStorage.setItem(SYNC_BASE_KEY, JSON.stringify(base));
    }
  } catch (e) { /* 同上 */ }
}

// 同期で表示言語が変わり、いまのページの言語と違うとき
function languageChanged(result) {
  if (!result.pulled.includes("lang") || !window.SKI18N) return false;
  let lang = "ja";
  try { lang = localStorage.getItem("sk_lang") || "ja"; } catch (e) { /* 日本語のまま */ }
  const allowed = (document.documentElement.getAttribute("data-i18n-langs") || "").split(/\s+/).filter(Boolean);
  if (allowed.length && !allowed.includes(lang)) lang = allowed.includes("en") ? "en" : allowed[0];
  return lang !== window.SKI18N.lang;
}

// ---------- お知らせ ----------
// 未読 = noticesSeenAt より新しい個別のお知らせ（accounts/{UID}/notices）
export async function countUnread(user, account) {
  const seen = account && account.noticesSeenAt;
  const q = seen ? query(noticesOf(user.uid), where("createdAt", ">", seen)) : noticesOf(user.uid);
  const snap = await getCountFromServer(q);
  return snap.data().count;
}

export async function markNoticesSeen(user) {
  await updateDoc(accountRef(user.uid), { noticesSeenAt: serverTimestamp() });
  setUnreadHint(0);
}

// ---------- 利用の記録（アカウント規約 第三条1項(j)） ----------
// このブラウザのタイムゾーン（おおまかな地域）とサポートID（frameworks/check.js の skhub_uuid。新しいものから 5 つまで）と、最後に使った日時。
// 規約の最新の版に同意した人だけ（watchAccount の ready のとき）。変わらなければ 1 日 1 回まで書く。
// 開発者が管理画面（admin.sk-hub.jp/accounts/）で、お問い合わせ・不正利用への対応のために確認する（同 第四条4）
const SEEN_IDS_MAX = 5;
const SUPPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
async function recordSeen(user, account) {
  let tz = "";
  try { tz = (Intl.DateTimeFormat().resolvedOptions().timeZone || "").slice(0, 64); } catch (e) { /* 分からなければ空 */ }
  let id = "";
  try { id = localStorage.getItem("skhub_uuid") || ""; } catch (e) { /* 読めなければ入れない */ }
  const prev = account.seen || {};
  const ids = [SUPPORT_ID.test(id) ? id : "", ...(Array.isArray(prev.ids) ? prev.ids : []).filter((x) => x !== id)].filter(Boolean).slice(0, SEEN_IDS_MAX);
  const at = prev.at && typeof prev.at.toMillis === "function" ? prev.at.toMillis() : 0;
  const same = prev.tz === tz && JSON.stringify(prev.ids || []) === JSON.stringify(ids);
  if (same && Date.now() - at < 24 * 60 * 60 * 1000) return;
  await updateDoc(accountRef(user.uid), { seen: { tz, ids, at: serverTimestamp() } });
}

// ---------- アカウントの状態 ----------
// ログイン状態とアカウントの状態を知らせる
//   status: "signed-out"   … ログインしていない
//           "unregistered" … Google でログインしたが、まだアカウントを作っていない（規約に未同意）
//           "outdated"     … アカウント規約が変わり、同意し直す必要がある
//           "ready"        … 使える（このとき設定の同期もする。同期で表示言語が変わったら、ページを開き直す）
//           "error"        … 読み込めなかった（error に理由）
export function watchAccount(callback) {
  let stopped = false, stop = () => { stopped = true; };
  // LINE・Kakao から戻ってきたときは、ログインし終わってから知らせる（一瞬「ログインしていない」と出ないように）
  externalResult.finally(() => { if (!stopped) stop = watchAuth(callback); });
  return () => stop();
}
function watchAuth(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (!user) {
      clearHint();
      callback({ status: "signed-out", user: null, account: null });
      return;
    }
    try {
      const snap = await getDoc(accountRef(user.uid));
      if (!snap.exists()) {
        callback({ status: "unregistered", user, account: null });
        return;
      }
      const account = snap.data();
      saveHint(user, account);
      const ready = account.termsVersion === ACCOUNT_TERMS_VERSION;
      if (ready) {
        recordSeen(user, account).catch(() => { /* 書けなくても使える */ });
        const result = await syncSettings(user, account).catch(() => ({ pulled: [], pushed: [] }));
        if (languageChanged(result)) { location.reload(); return; }
        countUnread(user, account).then(setUnreadHint, () => {});
      }
      callback({ status: ready ? "ready" : "outdated", user, account });
    } catch (error) {
      callback({ status: "error", user, account: null, error });
    }
  });
}

// アカウントを使わないページ（トップ・MALU など）で、ときどき裏で行う確認（assets/hub/sync-loader.js から呼ぶ）
//   ログインが切れていたらヘッダーの表示を消す・設定を同期する・未読の数を更新する
//   戻り値: { pulled: [...], languageChanged: true/false } か null（ログインしていない・アカウントが使えない）
export function backgroundSync() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, async (user) => {
      stop();
      if (!user) { clearHint(); resolve(null); return; }
      try {
        const snap = await getDoc(accountRef(user.uid));
        if (!snap.exists() || snap.data().termsVersion !== ACCOUNT_TERMS_VERSION) { resolve(null); return; }
        const account = snap.data();
        saveHint(user, account);
        const result = await syncSettings(user, account);
        countUnread(user, account).then(setUnreadHint, () => {});
        resolve({ pulled: result.pulled, languageChanged: languageChanged(result) });
      } catch (e) {
        resolve(null);
      }
    });
  });
}

// アカウントを作る（規約に同意する）
export async function register(user) {
  await setDoc(accountRef(user.uid), {
    createdAt: serverTimestamp(),
    termsVersion: ACCOUNT_TERMS_VERSION,
    termsAgreedAt: serverTimestamp()
  });
  saveHint(user, null);
}

// 新しいアカウント規約に同意し直す
export async function agreeLatestTerms(user) {
  await updateDoc(accountRef(user.uid), { termsVersion: ACCOUNT_TERMS_VERSION, termsAgreedAt: serverTimestamp() });
}

// サービスのページから、ログイン・アカウントの作成・サービスの接続を頼むときの URL（終わったら戻ってくる）
//   connect … サービスの key（SERVICES）。アカウントが使えるようになったあと、そのサービスに接続するか確かめる
export function accountPageUrl(next = location.pathname + location.search + location.hash, connect = "") {
  // いまの言語のアカウントのページ（assets/i18n.js があれば）
  const base = window.SKI18N ? window.SKI18N.path("/account/") : "/account/";
  return `${base}?${connect ? `connect=${encodeURIComponent(connect)}&` : ""}next=${encodeURIComponent(next)}`;
}

// ?next= で受け取った戻り先。このサイトの中のページだけ許可する
export function safeNext(raw) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "";
  return raw;
}
