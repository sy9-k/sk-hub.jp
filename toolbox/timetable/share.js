// Timetable の配信（ES モジュール。/toolbox/timetable/timetable.js が、ログインしているときだけ読み込む）
//   管理者（SK Hub Systems の開発者。config/developers に UID がある人）が、メールアドレスを入れた人に時間割を配信する。受け取る人は読むだけ
//   ・timetables/{ID}                  … { title, json: 時間割の JSON, ownerUid, updatedAt }。管理者と、配信先の人だけが読める
//   ・timetables/{ID}/private/members  … { emails: [配信先のメールアドレス], updatedAt }。管理者だけ（受け取る人どうしには見えない）
//   ・timetableInbox/{メールアドレス}   … { tids: [受け取る時間割の ID], updatedAt }。本人（Google のメールアドレスが一致し、確認済み）だけが読める
//   ・timetableUserInbox/{UID}         … { tids, updatedAt, joinCode }。招待コードで参加した時間割（アカウントあて。LINE などメールアドレスのないアカウントでも受け取れる）
//                                       本人が読む・有効な招待コードの時間割を 1 つ足す。管理者は外せる
//   ・timetableInvites/{コード}         … { tid, title, ownerUid, expiresAt, createdAt }。招待コード（管理者が作る。コードを知っている人だけが読める）
//   ・timetables/{ID}/joins/{UID}      … { email（ない人は ""）, name, photo, color, code, joinedAt }。参加している人（一覧は管理者だけ）
//                                       招待コードで参加したとき、またはメールアドレスの配信先の人が時間割を開いたとき（code は ""）に、本人が作る
//   権限は y-filter リポジトリの systems/firestore.rules（「SK's Toolbox の時間割の配信」）
import { ACCOUNT_TERMS_VERSION, currentUser, db, profileOf } from "/assets/hub/account.js";
import {
  arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function fail(code) { const e = new Error(code); e.code = code; return e; }
function newTid() {
  const b = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(b, (x) => x.toString(36).padStart(2, "0")).join("").slice(0, 20);
}
// たくさんの書き込みを、少しずつ並べて行う（1 回の書き込みごとに権限を確かめるため、まとめて 1 回にはしない）
async function inChunks(items, size, fn) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}
const inbox = (email) => doc(db, "timetableInbox", email);
const userInbox = (uid) => doc(db, "timetableUserInbox", uid);
const membersRef = (tid) => doc(db, "timetables", tid, "private", "members");
const tidsOf = (snap) => (snap && snap.exists() && Array.isArray(snap.data().tids) ? snap.data().tids.filter((x) => typeof x === "string") : []);

// 管理者か（config/developers は、登録された本人だけが読める）
export async function isAdmin() {
  const user = await currentUser();
  if (!user) return false;
  try { await getDoc(doc(db, "config", "developers")); return true; } catch (e) { return false; }
}

// 自分に配信された時間割
// 戻り値: { status: "signed-out" | "unregistered" | "ready", items: [{ tid, title, json, updatedAt }] }
export async function receive() {
  const user = await currentUser();
  if (!user) return { status: "signed-out", items: [] };
  const acc = await getDoc(doc(db, "accounts", user.uid));
  if (!acc.exists() || acc.data().termsVersion !== ACCOUNT_TERMS_VERSION) return { status: "unregistered", items: [] };
  // メールアドレスあて（管理者が配信先に入れた）と、アカウントあて（招待コードで参加した）の両方
  const email = (user.email || "").toLowerCase();
  const [byEmail, byUid] = await Promise.all([
    email ? getDoc(inbox(email)).catch(() => null) : null,
    getDoc(userInbox(user.uid)).catch(() => null)
  ]);
  const tids = [...new Set(tidsOf(byEmail).concat(tidsOf(byUid)))];
  const items = await Promise.all(tids.map(async (tid) => {
    try {
      const snap = await getDoc(doc(db, "timetables", tid));
      if (!snap.exists()) return null;
      const d = snap.data();
      return { tid, title: String(d.title || ""), json: String(d.json || ""), updatedAt: d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : 0 };
    } catch (e) { return null; }
  }));
  return { status: "ready", items: items.filter(Boolean) };
}

// 管理者: 配信先のメールアドレス
export async function loadMembers(tid) {
  const snap = await getDoc(membersRef(tid));
  return snap.exists() && Array.isArray(snap.data().emails) ? snap.data().emails : [];
}

// 管理者: 配信する（tid があれば更新）。配信先から外した人の受け取り箱からは、この時間割を消す
// 戻り値: 時間割の ID
export async function publish({ tid, title, json, emails }) {
  const user = await currentUser();
  if (!user) throw fail("signed-out");
  const id = tid || newTid();
  const before = tid ? await loadMembers(tid).catch(() => []) : [];
  const batch = writeBatch(db);
  batch.set(doc(db, "timetables", id), { title, json, ownerUid: user.uid, updatedAt: serverTimestamp() });
  batch.set(membersRef(id), { emails, updatedAt: serverTimestamp() });
  await batch.commit();
  await inChunks(emails, 20, (email) => setDoc(inbox(email), { tids: arrayUnion(id), updatedAt: serverTimestamp() }, { merge: true }));
  const removed = before.filter((e) => !emails.includes(e));
  await inChunks(removed, 20, (email) => setDoc(inbox(email), { tids: arrayRemove(id), updatedAt: serverTimestamp() }, { merge: true }));
  return id;
}

// 管理者: 配信をやめる（受け取り箱から消し、時間割と配信先を削除する）
export async function unpublish(tid) {
  const emails = await loadMembers(tid).catch(() => []);
  await inChunks(emails, 20, (email) => setDoc(inbox(email), { tids: arrayRemove(tid), updatedAt: serverTimestamp() }, { merge: true }));
  // 招待コードで参加した人（アカウントあての受け取り箱）
  const joined = (await listJoins(tid).catch(() => [])).filter((p) => p.code);
  await inChunks(joined, 20, (p) => setDoc(userInbox(p.uid), { tids: arrayRemove(tid), updatedAt: serverTimestamp() }, { merge: true }));
  await deleteDoc(membersRef(tid));
  await deleteDoc(doc(db, "timetables", tid));
}

// ================================================================
// 招待コード
// ================================================================
// コードは 8 文字（まぎらわしい 0 O 1 I L を使わない）。表示は XXXX-XXXX
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function normalizeCode(text) { return String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16); }
export function formatCode(code) { return code.length === 8 ? code.slice(0, 4) + "-" + code.slice(4) : code; }
function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(b, (x) => CODE_CHARS[x % CODE_CHARS.length]).join("");
}
const invite = (code) => doc(db, "timetableInvites", code);
const joinsCol = (tid) => collection(db, "timetables", tid, "joins");
const ms = (ts) => (ts && ts.toMillis ? ts.toMillis() : 0);

// 管理者: 招待コードを作る（days 日で使えなくなる）
export async function createInvite({ tid, title, days }) {
  const user = await currentUser();
  if (!user) throw fail("signed-out");
  const code = newCode();
  await setDoc(invite(code), { tid, title, ownerUid: user.uid, expiresAt: Timestamp.fromMillis(Date.now() + days * 864e5), createdAt: serverTimestamp() });
  return code;
}
// 管理者: その時間割の招待コード（期限切れも含む）
export async function listInvites(tid) {
  const snap = await getDocs(query(collection(db, "timetableInvites"), where("tid", "==", tid)));
  return snap.docs.map((d) => ({ code: d.id, title: String(d.data().title || ""), expiresAt: ms(d.data().expiresAt), createdAt: ms(d.data().createdAt) }))
    .sort((a, b) => b.createdAt - a.createdAt);
}
export async function deleteInvite(code) { await deleteDoc(invite(code)); }

// 管理者: 招待コードで参加した人
export async function listJoins(tid) {
  const snap = await getDocs(joinsCol(tid));
  return snap.docs.map((d) => ({ uid: d.id, email: String(d.data().email || ""), name: String(d.data().name || ""), photo: String(d.data().photo || ""), color: String(d.data().color || ""), code: String(d.data().code || ""), joinedAt: ms(d.data().joinedAt) }))
    .sort((a, b) => b.joinedAt - a.joinedAt);
}
// 管理者: 参加した人を外す（受け取り箱からも消す）
export async function removeJoin(tid, person) {
  if (person.uid) await deleteDoc(doc(db, "timetables", tid, "joins", person.uid));
  if (person.email) await setDoc(inbox(person.email), { tids: arrayRemove(tid), updatedAt: serverTimestamp() }, { merge: true });
  if (person.uid && person.code) await setDoc(userInbox(person.uid), { tids: arrayRemove(tid), updatedAt: serverTimestamp() }, { merge: true });
}
function safePhoto(url) { const u = String(url || ""); return /^https:\/\//.test(u) && u.length <= 500 ? u : ""; }

// 受け取る人: 時間割を開いたとき、管理者の「参加している人」に名前とアイコンを出す（メールアドレスの配信先の人。招待コードの人は名前・アイコンを新しく）
//   known … { tid: 前に書いた名前・アイコン } を返し、同じなら書かない
export async function registerSelf(tids, known) {
  const user = await currentUser();
  if (!user || !user.email || !user.emailVerified) return known || {};
  const acc = await getDoc(doc(db, "accounts", user.uid));
  if (!acc.exists()) return known || {};
  const prof = profileOf(user, acc.data());
  const fields = { name: prof.name.slice(0, 60), photo: safePhoto(prof.photo), color: String(prof.colorValue || "").slice(0, 20) };
  const sig = JSON.stringify(fields), out = Object.assign({}, known || {});
  for (const tid of tids) {
    if (out[tid] === sig) continue;
    const ref = doc(db, "timetables", tid, "joins", user.uid);
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) await updateDoc(ref, fields);
      else await setDoc(ref, Object.assign({ email: user.email.toLowerCase(), code: "", joinedAt: serverTimestamp() }, fields));
      out[tid] = sig;
    } catch (e) { /* 配信先から外れているなど。次に開いたときにまた試す */ }
  }
  return out;
}

// 参加する人: コードを確かめる
// 戻り値: { status: "signed-out" | "unregistered" | "not-found" | "expired" | "ready", code, title, tid, joined }
export async function checkInvite(text) {
  const code = normalizeCode(text);
  const user = await currentUser();
  if (!user) return { status: "signed-out", code };
  const acc = await getDoc(doc(db, "accounts", user.uid));
  if (!acc.exists() || acc.data().termsVersion !== ACCOUNT_TERMS_VERSION) return { status: "unregistered", code };
  if (code.length < 8) return { status: "not-found", code };
  let snap;
  try { snap = await getDoc(invite(code)); } catch (e) { return { status: "not-found", code }; }
  if (!snap.exists()) return { status: "not-found", code };
  const d = snap.data();
  if (ms(d.expiresAt) <= Date.now()) return { status: "expired", code, title: String(d.title || "") };
  const email = user.email && user.emailVerified ? user.email.toLowerCase() : "";
  const [byEmail, byUid] = await Promise.all([
    email ? getDoc(inbox(email)).catch(() => null) : null,
    getDoc(userInbox(user.uid)).catch(() => null)
  ]);
  const joined = tidsOf(byEmail).concat(tidsOf(byUid)).includes(d.tid);
  const prof = profileOf(user, acc.data());
  return { status: "ready", code, tid: d.tid, title: String(d.title || ""), joined, email, name: prof.name, photo: prof.photo, color: prof.colorValue };
}
// 参加する人: 参加する（管理者に、名前と（あれば）メールアドレスが伝わる）
//   受け取り箱はアカウントあて（timetableUserInbox/{UID}）。LINE などメールアドレスのないアカウントでも参加できる
export async function joinWithCode(info) {
  const user = await currentUser();
  if (!user) throw fail("signed-out");
  const email = user.email && user.emailVerified ? user.email.toLowerCase() : "";
  const box = await getDoc(userInbox(user.uid)).catch(() => null);
  const tids = tidsOf(box);
  if (tids.length >= 20 && !tids.includes(info.tid)) throw fail("too-many");
  const batch = writeBatch(db);
  batch.set(doc(db, "timetables", info.tid, "joins", user.uid), { email, name: String(info.name || "").slice(0, 60), photo: safePhoto(info.photo), color: String(info.color || "").slice(0, 20), code: info.code, joinedAt: serverTimestamp() });
  if (!tids.includes(info.tid)) batch.set(userInbox(user.uid), { tids: tids.concat([info.tid]), updatedAt: serverTimestamp(), joinCode: info.code });
  await batch.commit();
}
