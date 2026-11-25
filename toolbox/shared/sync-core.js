// SK's Toolbox のオンライン同期の本体（ES モジュール。/toolbox/shared/sync.js が、同期を使うときだけ読み込む）
//   ・保存先: SK Hub Systems アカウント accounts/{UID}/toolbox/{settings|todo|memo|countdown|calc|timetable|roulette}（アカウントで Toolbox に接続したときだけ書ける）
//   ・中身は端末で暗号化してから送る（エンドツーエンド暗号化）。SK（Firebase の管理者）にも中身は読めない
//       鍵 … 本人が決めた「同期用のパスフレーズ」から PBKDF2（SHA-256・31 万回）で作る AES-GCM 256 ビットの鍵。パスフレーズと鍵はサーバーに送らない
//       accounts/{UID}/toolbox/key … { v, id, salt, iter, iv, check }（パスフレーズが合っているかを確かめるための暗号文と、鍵を作るための salt）
//       各アプリ … { v, k: 鍵の id, z: 圧縮したか, iv, data: 暗号文, updatedAt }。暗号化の前に gzip で縮める
//       暗号文には「UID/アプリ名」を結び付ける（AES-GCM の追加データ）。ほかの場所にコピーされた暗号文は読めない
//   ・まとめ方は /toolbox/shared/sync-merge.js。2 台で同時に同期しても消えないよう、読み込みと書き込みはトランザクションで行う
//   ・Memo の画像（IndexedDB）は同期しない
//   ・同期を使っている端末では、SK Hub Systems アカウントのお知らせ（accounts/{UID}/notices。お問い合わせへの返事など）の未読も確かめる（notices()）
import { ACCOUNT_TERMS_VERSION, accountUsable, countUnread, currentUser, db, isConnected, rememberAccount, setUnreadHint } from "/assets/hub/account.js";
import {
  Bytes, collection, deleteDoc, doc, getDoc, getDocs, limit, orderBy, query, runTransaction, serverTimestamp, setDoc, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { APP_KEYS, Conflict, SYNC_APPS, baseOf, isEmpty, merge, readLocal, sameSnap, writeLocal } from "/toolbox/shared/sync-merge.js";

export { APP_KEYS };
const ITERATIONS = 310000;
const CHECK = "sk-toolbox-sync-v1";
// 暗号文の大きさの上限（バイト。Firestore のセキュリティルールと同じ）
export const LIMITS = { settings: 20000, todo: 400000, memo: 1000000, countdown: 100000, calc: 50000, timetable: 100000, roulette: 50000 };

const te = new TextEncoder();
const td = new TextDecoder();
const toolboxRef = (uid, id) => doc(db, "accounts", uid, "toolbox", id);

function fail(code) { const e = new Error(code); e.code = code; return e; }
function random(n) { return crypto.getRandomValues(new Uint8Array(n)); }
function hex(bytes) { return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""); }
function b64(bytes) { let s = ""; bytes.forEach((b) => { s += String.fromCharCode(b); }); return btoa(s); }
function unb64(s) { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); }

// ---------- 鍵 ----------
async function derive(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", te.encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}
async function exportKey(key) { return b64(new Uint8Array(await crypto.subtle.exportKey("raw", key))); }
function importKey(raw) { return crypto.subtle.importKey("raw", unb64(raw), "AES-GCM", false, ["encrypt", "decrypt"]); }

// ---------- 圧縮 ----------
async function pipe(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
const canZip = typeof CompressionStream === "function" && typeof DecompressionStream === "function";

async function seal(key, uid, app, snap) {
  let bytes = te.encode(JSON.stringify(snap));
  const z = canZip;
  if (z) bytes = await pipe(bytes, new CompressionStream("gzip"));
  const iv = random(12);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(uid + "/" + app) }, key, bytes));
  return { z, iv, data };
}
async function open(key, uid, app, d) {
  let bytes;
  try {
    bytes = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: d.iv.toUint8Array(), additionalData: te.encode(uid + "/" + app) }, key, d.data.toUint8Array()));
  } catch (e) { throw fail("decrypt"); }
  if (d.z) {
    if (!canZip) throw fail("unsupported");
    bytes = await pipe(bytes, new DecompressionStream("gzip"));
  }
  const snap = JSON.parse(td.decode(bytes));
  if (!snap || typeof snap !== "object" || typeof snap.l !== "object" || typeof snap.f !== "object") throw fail("decrypt");
  return snap;
}

// ---------- アカウント ----------
// status: signed-out … ログインしていない / unregistered … アカウントがまだない・規約に同意し直す必要がある
//         not-connected … Toolbox に接続していない / ready … 使える（hasKey: 同期用のパスフレーズがもう決まっているか）
export async function accountState() {
  const user = await currentUser();
  if (!user) return { status: "signed-out" };
  const snap = await getDoc(doc(db, "accounts", user.uid));
  if (!snap.exists() || !accountUsable(snap.data())) return { status: "unregistered", user };
  const account = snap.data();
  rememberAccount(user, account);
  if (!isConnected(account, "toolbox")) return { status: "not-connected", user, account };
  const key = await getDoc(toolboxRef(user.uid, "key"));
  return { status: "ready", user, account, hasKey: key.exists() };
}

// はじめて同期するとき: パスフレーズを決めて、確かめるための値をアカウントに保存する
// 戻り値: { uid, key: 鍵（base64。この端末にだけ保存する）, keyId }
export async function createKey(passphrase) {
  const user = await currentUser();
  if (!user) throw fail("signed-out");
  const salt = random(16), iv = random(12), id = hex(random(8));
  const key = await derive(passphrase, salt, ITERATIONS);
  const check = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode("key") }, key, te.encode(CHECK)));
  // すでにあれば書けない（ルールで作るだけ・変えられない）。ほかの端末で先に決めていたときは exists
  const ref = toolboxRef(user.uid, "key");
  if ((await getDoc(ref)).exists()) throw fail("exists");
  await setDoc(ref, {
    v: 1, id, iter: ITERATIONS, createdAt: serverTimestamp(),
    salt: Bytes.fromUint8Array(salt), iv: Bytes.fromUint8Array(iv), check: Bytes.fromUint8Array(check)
  });
  return { uid: user.uid, key: await exportKey(key), keyId: id };
}

// ほかの端末で決めたパスフレーズを入れたとき。違えば wrong
export async function unlock(passphrase) {
  const user = await currentUser();
  if (!user) throw fail("signed-out");
  const snap = await getDoc(toolboxRef(user.uid, "key"));
  if (!snap.exists()) throw fail("no-key");
  const d = snap.data();
  const key = await derive(passphrase, d.salt.toUint8Array(), d.iter);
  try {
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: d.iv.toUint8Array(), additionalData: te.encode("key") }, key, d.check.toUint8Array());
    if (td.decode(plain) !== CHECK) throw new Error();
  } catch (e) { throw fail("wrong"); }
  return { uid: user.uid, key: await exportKey(key), keyId: d.id };
}

// アカウントに保存した Toolbox の同期のデータを、すべて削除する（パスフレーズも。この端末のデータは消えない）
export async function wipe() {
  const user = await currentUser();
  if (!user) throw fail("signed-out");
  await Promise.all(APP_KEYS.concat(["key"]).map((id) => deleteDoc(toolboxRef(user.uid, id))));
}

// ---------- 同期 ----------
function rawOf(app) {
  const def = SYNC_APPS[app];
  const keys = def.keys ? Object.values(def.keys) : [def.storage];
  return keys.map((k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }).join("\u0000");
}

// cfg … { uid, key, keyId, base: { アプリ: 指紋 } }（この端末の設定。base を書きかえる）
// apps … 同期するアプリ
// 戻り値: { results: { アプリ: "same" | "pulled" | "pushed" | "both" | "too-big" | "memo-lock" | "error" }, changed: [書きかえた localStorage のキー] }
//   鍵がほかの端末で作り直されていたら key-changed を投げる（パスフレーズを入れ直してもらう）
export async function syncApps(cfg, apps) {
  const user = await currentUser();
  if (!user) throw fail("signed-out");
  if (user.uid !== cfg.uid) throw fail("other-user");
  const key = await importKey(cfg.key);
  const uid = user.uid;
  cfg.base = cfg.base || {};
  const results = {};
  const changed = [];

  for (const app of apps) {
    if (!SYNC_APPS[app]) continue;
    const ref = toolboxRef(uid, app);
    try {
      let raw = "";
      const r = await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        let remote = null;
        if (snap.exists()) {
          const d = snap.data();
          if (d.k !== cfg.keyId) throw fail("key-changed");
          remote = await open(key, uid, app, d);
        }
        raw = rawOf(app);
        const local = readLocal(app);
        const merged = merge(app, local, remote, cfg.base[app] || null);
        const pull = !sameSnap(merged, local);
        let push = remote ? !sameSnap(merged, remote) : !isEmpty(merged);
        let tooBig = false;
        if (push) {
          const box = await seal(key, uid, app, merged);
          if (box.data.length > LIMITS[app]) { tooBig = true; push = false; }
          else tx.set(ref, { v: 1, k: cfg.keyId, z: box.z, iv: Bytes.fromUint8Array(box.iv), data: Bytes.fromUint8Array(box.data), updatedAt: serverTimestamp() });
        }
        return { merged, remote, pull, push, tooBig };
      });
      // 同期のあいだに、この端末で書きかえていたら、こちらには書かない（前回そろえたときのまま。次の同期でまとめる）
      if (r.pull && rawOf(app) !== raw) { results[app] = "same"; continue; }
      if (r.pull) changed.push(...writeLocal(app, r.merged));
      // 大きすぎて送れなかったとき、アカウントとそろっているのは、アカウントにあるほう
      cfg.base[app] = r.tooBig ? (r.remote ? baseOf(app, r.remote) : null) : baseOf(app, r.merged);
      results[app] = r.tooBig ? "too-big" : r.pull && r.push ? "both" : r.pull ? "pulled" : r.push ? "pushed" : "same";
    } catch (e) {
      if (e.code === "key-changed") throw e;
      results[app] = e instanceof Conflict ? e.code : "error";
      if (!(e instanceof Conflict)) console.warn("[Toolbox sync]", app, e);
    }
  }
  return { results, changed };
}

// ---------- お知らせ ----------
// 未読のお知らせ（新しい順に 5 件まで）と未読の数。サイトのヘッダーの未読の数も更新する
// 戻り値: { unread, items: [{ id, kind, title, body, at }] } か null（ログインしていない）
export async function notices() {
  const user = await currentUser();
  if (!user) return null;
  const snap = await getDoc(doc(db, "accounts", user.uid));
  if (!snap.exists()) return null;
  const account = snap.data();
  const seen = account.noticesSeenAt;
  const base = collection(db, "accounts", user.uid, "notices");
  const q = seen
    ? query(base, where("createdAt", ">", seen), orderBy("createdAt", "desc"), limit(5))
    : query(base, orderBy("createdAt", "desc"), limit(5));
  const [list, unread] = await Promise.all([getDocs(q), countUnread(user, account)]);
  setUnreadHint(unread);
  return {
    unread,
    items: list.docs.map((d) => {
      const n = d.data();
      return {
        id: d.id,
        kind: n.kind,
        title: String(n.title || ""),
        body: String(n.body || "").slice(0, 200),
        at: n.createdAt && n.createdAt.toMillis ? n.createdAt.toMillis() : 0
      };
    })
  };
}
