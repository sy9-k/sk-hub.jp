// SK Study と SK Hub Systems（Firestore）。クラス・配信・提出・採点（指導者メニュー）
//   ・ログインしていない人には Firebase を読み込まない（ヘッダーの表示用の情報 skhub_account があるときだけ確認する）
//   ・データの形と権限は y-filter リポジトリの systems/firestore.rules の「SK Study」
//       studyTeacherApps/{UID}・studyTeachers/{UID}・studyJoinCodes/{コード}・studyClasses/{cid}
//       studyClasses/{cid}/members/{UID}・/assignments/{aid}・/assignments/{aid}/submissions/{UID}・/grades/{UID}
//       accounts/{UID}/studyClasses/{cid}（本人の、参加しているクラスの一覧）
//       組織モデル（学校の名簿 people → クラスの担任・在籍）は org.js。下の「組織モデル」でそのまま使える形にしてある
//   ・クラスに参加するには、アカウントを SK Study に接続しておく（/account/?connect=study）
import * as org from "./org.js";
import * as migrate from "./org-migrate.js";
const FIRESTORE = "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 見まちがえやすい I・O・0・1 は使わない
export const PRINT_MAX_BYTES = 950000; // Firestore は 1 件 1MB まで

let mods = null;
async function load() {
  if (!mods) mods = Promise.all([import("/assets/hub/account.js"), import(FIRESTORE), import("/assets/hub/invite.js")]).then(([hub, fs, invite]) => ({ hub, fs, invite }));
  return mods;
}

// 招待制（assets/hub/invite.js）。招待を確かめられた端末には印を残す（ネットワークがないときも、前に招待された端末なら開ける）
const INVITED_KEY = "skhub_invited_study";
export function wasInvited() {
  try { return localStorage.getItem(INVITED_KEY) === "1"; } catch (e) { return false; }
}
function markInvited(on) {
  try { if (on) localStorage.setItem(INVITED_KEY, "1"); else localStorage.removeItem(INVITED_KEY); } catch (e) { /* 残せなくても使える */ }
}

function hasHint() {
  try { return !!localStorage.getItem("skhub_account"); } catch (e) { return false; }
}

// いまの状態。status: signed-out / offline / not-invited / unregistered / not-connected / ready
//   ready のときは { user, account, name, hub, fs, db }
let cached = null;
// ログアウトしたとき・ログインし直したときに、覚えている状態を消す
export function resetSession() { cached = null; }
export async function session({ fresh = false } = {}) {
  if (cached && !fresh) return cached;
  if (!hasHint()) return (cached = { status: "signed-out" });
  let m;
  try { m = await load(); } catch (e) { return { status: "offline" }; }
  const { hub, fs, invite } = m;
  const user = await hub.currentUser();
  if (!user) return (cached = { status: "signed-out" });
  // 招待されていない人は、ここから先（アカウントの登録・接続）に進ませない
  let inv;
  try { inv = await invite.inviteStatus(user, "study"); } catch (e) { return { status: "offline" }; }
  if (!inv.ok) { markInvited(false); return (cached = { status: "not-invited", reason: inv.reason, user }); }
  markInvited(true);
  let account = null;
  try {
    const snap = await fs.getDoc(fs.doc(hub.db, "accounts", user.uid));
    account = snap.exists() ? snap.data() : null;
  } catch (e) {
    return { status: "offline" };
  }
  const base = { user, account, hub, fs, db: hub.db, name: hub.profileOf(user, account).name || user.email || "名前なし" };
  if (!account || account.termsVersion !== hub.ACCOUNT_TERMS_VERSION) return (cached = { ...base, status: "unregistered" });
  hub.rememberAccount(user, account);
  if (!hub.isConnected(account, "study")) return (cached = { ...base, status: "not-connected" });
  return (cached = { ...base, status: "ready" });
}

export const accountUrl = (connect = true) =>
  `/account/?${connect ? "connect=study&" : ""}next=${encodeURIComponent(location.pathname + location.hash)}`;

async function ready() {
  const s = await session();
  if (s.status !== "ready") {
    const err = new Error(s.status);
    err.code = s.status;
    throw err;
  }
  return s;
}

const ms = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : null);
export const toMillis = ms;
const withId = (d) => ({ id: d.id, ...d.data() });

// エラーの説明
export function explain(err) {
  const code = (err && err.code) || "";
  if (code === "permission-denied") return "この操作をする権限がありません。";
  if (code === "unavailable" || code === "offline") return "SK Hub Systems に接続できませんでした。ネットワークを確かめてください。";
  if (code === "signed-out") return "SK Hub Systems アカウントでログインしてください。";
  if (code === "not-connected") return "SK Hub Systems アカウントを SK Study に接続してください。";
  if (code === "not-found") return "見つかりませんでした。";
  return (err && err.message) || "うまくいきませんでした。";
}

// ---------- 生徒 ----------

export async function myClasses() {
  const { fs, db, user } = await ready();
  const snap = await fs.getDocs(fs.collection(db, "accounts", user.uid, "studyClasses"));
  return snap.docs.map(withId).sort((a, b) => (ms(b.joinedAt) || 0) - (ms(a.joinedAt) || 0));
}

export const normCode = (s) => String(s || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function lookupCode(code) {
  const { fs, db } = await ready();
  const snap = await fs.getDoc(fs.doc(db, "studyJoinCodes", normCode(code)));
  if (!snap.exists()) { const e = new Error("参加コードが見つかりません。"); e.code = "bad-code"; throw e; }
  return { code: snap.id, ...snap.data() };
}

// 専用コードで、生徒プロファイル（指導者が名簿として作ったもの）を自分のアカウントに結びつける
export async function joinClass(info) {
  if (!info.profileId) { const e = new Error("このコードは使えません。先生に新しいコードを聞いてください。"); e.code = "bad-code"; throw e; }
  const { fs, db, user } = await ready();
  const b = fs.writeBatch(db);
  b.set(fs.doc(db, "studyClasses", info.classId, "members", user.uid), { name: info.profileName, code: info.code, profileId: info.profileId, joinedAt: fs.serverTimestamp() });
  b.update(fs.doc(db, "studyClasses", info.classId, "profiles", info.profileId), { claimedBy: user.uid, claimedAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() });
  b.set(fs.doc(db, "accounts", user.uid, "studyClasses", info.classId), { name: info.className, teacherName: info.teacherName || "", joinedAt: fs.serverTimestamp(), profileId: info.profileId, profileName: info.profileName });
  try {
    await b.commit();
  } catch (e) {
    if (e.code === "permission-denied") { const err = new Error("参加できませんでした（このコードはもう使われているか、参加の受け付けが終わっているかもしれません）。"); err.code = "closed"; throw err; }
    throw e;
  }
  slots.delete(info.classId);
}

export async function leaveClass(cid) {
  const { fs, db, user } = await ready();
  const mine = await fs.getDoc(fs.doc(db, "accounts", user.uid, "studyClasses", cid)).catch(() => null);
  const pid = mine && mine.exists() ? mine.data().profileId : null;
  if (pid) await fs.updateDoc(fs.doc(db, "studyClasses", cid, "profiles", pid), { claimedBy: null, claimedAt: null, updatedAt: fs.serverTimestamp() }).catch(() => {});
  await fs.deleteDoc(fs.doc(db, "studyClasses", cid, "members", user.uid)).catch(() => {});
  await fs.deleteDoc(fs.doc(db, "accounts", user.uid, "studyClasses", cid));
  slots.delete(cid);
}

// 提出・採点の ID。生徒プロファイルがあればその ID、なければ（前の参加の仕方では）UID
const slots = new Map();
async function slotOf(cid) {
  if (slots.has(cid)) return slots.get(cid);
  const { fs, db, user } = await ready();
  let id = user.uid;
  try {
    const snap = await fs.getDoc(fs.doc(db, "accounts", user.uid, "studyClasses", cid));
    if (snap.exists() && snap.data().profileId) id = snap.data().profileId;
  } catch (e) { /* UID のまま */ }
  // 従来の参加ではないとき: 組織モデルのクラスなら、学校の名簿の自分のユーザーの ID
  if (id === user.uid) {
    try {
      const cls = await fs.getDoc(fs.doc(db, "studyClasses", cid));
      if (cls.exists() && cls.data().orgModel === true) {
        const link = await fs.getDoc(fs.doc(db, "accounts", user.uid, "studyOrgs", cls.data().schoolId));
        const sp = link.exists() ? org.linkPid(link.data(), "student") : "";
        if (sp) id = sp;
      }
    } catch (e) { /* UID のまま */ }
  }
  slots.set(cid, id);
  return id;
}
// クラスの中での、自分の名前（プロファイルの名前）
export async function myProfileName(cid) {
  const { fs, db, user, name } = await ready();
  try {
    const snap = await fs.getDoc(fs.doc(db, "accounts", user.uid, "studyClasses", cid));
    if (snap.exists()) return snap.data().profileName || snap.data().name || name;
  } catch (e) { /* 下へ */ }
  // 組織モデルのクラス: 学校の名簿の、自分のユーザーの名前
  try {
    const cls = await fs.getDoc(fs.doc(db, "studyClasses", cid));
    if (cls.exists() && cls.data().orgModel === true) {
      const link = await fs.getDoc(fs.doc(db, "accounts", user.uid, "studyOrgs", cls.data().schoolId));
      const sp = link.exists() ? org.linkPid(link.data(), "student") : "";
      const p = sp ? await org.myPerson({ fs, db, user }, cls.data().schoolId, sp) : null;
      if (p) return p.name;
    }
  } catch (e) { /* 下へ */ }
  return name;
}

export async function getClass(cid) {
  const { fs, db } = await ready();
  const snap = await fs.getDoc(fs.doc(db, "studyClasses", cid));
  if (!snap.exists()) { const e = new Error("not-found"); e.code = "not-found"; throw e; }
  return withId(snap);
}

export async function publishedAssignments(cid) {
  const { fs, db } = await ready();
  const snap = await fs.getDocs(fs.query(fs.collection(db, "studyClasses", cid, "assignments"), fs.where("published", "==", true)));
  return snap.docs.map(withId).sort((a, b) => (ms(b.createdAt) || 0) - (ms(a.createdAt) || 0));
}

export async function getAssignment(cid, aid) {
  const { fs, db } = await ready();
  const snap = await fs.getDoc(fs.doc(db, "studyClasses", cid, "assignments", aid));
  if (!snap.exists()) { const e = new Error("not-found"); e.code = "not-found"; throw e; }
  return withId(snap);
}

export async function mySubmission(cid, aid) {
  const { fs, db } = await ready();
  const snap = await fs.getDoc(fs.doc(db, "studyClasses", cid, "assignments", aid, "submissions", await slotOf(cid)));
  return snap.exists() ? withId(snap) : null;
}

// 結果が公開されていなければ null
export async function myGrade(cid, aid) {
  const { fs, db } = await ready();
  try {
    const snap = await fs.getDoc(fs.doc(db, "studyClasses", cid, "assignments", aid, "grades", await slotOf(cid)));
    return snap.exists() ? withId(snap) : null;
  } catch (e) {
    if (e.code === "permission-denied") return null;
    throw e;
  }
}

// 提出する。score = { ok, total }、data = 答えなど（JSON にする）。update は単語帳の進み具合を送り直すとき
export async function submit(cid, aid, score, data, { update = false } = {}) {
  const { fs, db } = await ready();
  const name = await myProfileName(cid);
  const json = JSON.stringify(data || {});
  if (json.length > 200000) throw new Error("提出する内容が大きすぎます。");
  const ok = Number(score.ok) || 0, total = Number(score.total) || 0;
  const body = { name: String(name).slice(0, 40), score: { ok, total, pct: total ? Math.round((ok / total) * 100) : 0 }, data: json, updatedAt: fs.serverTimestamp() };
  const ref = fs.doc(db, "studyClasses", cid, "assignments", aid, "submissions", await slotOf(cid));
  if (update) await fs.updateDoc(ref, body);
  else await fs.setDoc(ref, { ...body, submittedAt: fs.serverTimestamp() });
}

// ---------- 指導者 ----------

// { teacher: { name, org } | null, admin: 総合管理者 | null, schools: 先生として入っている学校 [{ id, name }], app: 申し込み | null }
export async function teacherState() {
  const { fs, db, user } = await ready();
  const [t, a, ad, st] = await Promise.all([
    fs.getDoc(fs.doc(db, "studyTeachers", user.uid)).catch(() => null),
    fs.getDoc(fs.doc(db, "studyTeacherApps", user.uid)).catch(() => null),
    fs.getDoc(fs.doc(db, "studyAdmins", user.uid)).catch(() => null),
    fs.getDocs(fs.collection(db, "accounts", user.uid, "studyStaff")).catch(() => null)
  ]);
  // 学校から外されていたら、学校の読み取りが断られる。その学校は一覧に出さない
  const schools = (await Promise.all(((st && st.docs) || []).map(async (d) => {
    try { const sc = await fs.getDoc(fs.doc(db, "studySchools", d.id)); return sc.exists() ? { id: d.id, name: sc.data().name } : null; } catch (e) { return null; }
  }))).filter(Boolean);
  return { teacher: t && t.exists() ? t.data() : null, app: a && a.exists() ? a.data() : null, admin: ad && ad.exists() ? ad.data() : null, schools };
}

export async function applyTeacher({ name, org, purpose }) {
  const { fs, db, user } = await ready();
  await fs.setDoc(fs.doc(db, "studyTeacherApps", user.uid), {
    name: String(name).trim().slice(0, 40), org: String(org || "").trim().slice(0, 80), purpose: String(purpose || "").trim().slice(0, 500),
    status: "pending", createdAt: fs.serverTimestamp()
  });
}

export async function cancelTeacherApp() {
  const { fs, db, user } = await ready();
  await fs.deleteDoc(fs.doc(db, "studyTeacherApps", user.uid));
}

export async function teacherClasses() {
  const { fs, db, user } = await ready();
  const snap = await fs.getDocs(fs.query(fs.collection(db, "studyClasses"), fs.where("ownerUid", "==", user.uid)));
  return snap.docs.map(withId).sort((a, b) => (ms(b.createdAt) || 0) - (ms(a.createdAt) || 0));
}

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}
function newId() {
  return [...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// クラスを作る（参加コードがほかと重なったら作り直す）
export async function createClass(name, teacherName, schoolId) {
  const { fs, db, user } = await ready();
  const cid = newId();
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const b = fs.writeBatch(db);
    b.set(fs.doc(db, "studyClasses", cid), {
      ownerUid: user.uid, name: String(name).trim().slice(0, 60), teacherName: String(teacherName || "").slice(0, 40), schoolId: String(schoolId),
      joinCode: code, open: true, createdAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp()
    });
    b.set(fs.doc(db, "studyJoinCodes", code), { classId: cid, ownerUid: user.uid, className: String(name).trim().slice(0, 60), teacherName: String(teacherName || "").slice(0, 40), createdAt: fs.serverTimestamp() });
    try { await b.commit(); return cid; } catch (e) { if (e.code !== "permission-denied") throw e; }
  }
  throw new Error("クラスを作れませんでした。もう一度ためしてください。");
}

export async function updateClass(cls, patch) {
  const { fs, db } = await ready();
  const next = { ownerUid: cls.ownerUid, name: cls.name, teacherName: cls.teacherName || "", ...(cls.schoolId ? { schoolId: cls.schoolId } : {}), joinCode: cls.joinCode, open: !!cls.open, createdAt: cls.createdAt, ...patch, updatedAt: fs.serverTimestamp() };
  await fs.setDoc(fs.doc(db, "studyClasses", cls.id), next);
}

// 参加コードを作り直す（前のコードは使えなくなる）
export async function renewCode(cls) {
  const { fs, db, user } = await ready();
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const b = fs.writeBatch(db);
    b.set(fs.doc(db, "studyJoinCodes", code), { classId: cls.id, ownerUid: user.uid, className: cls.name, teacherName: cls.teacherName || "", createdAt: fs.serverTimestamp() });
    b.set(fs.doc(db, "studyClasses", cls.id), { ownerUid: cls.ownerUid, name: cls.name, teacherName: cls.teacherName || "", ...(cls.schoolId ? { schoolId: cls.schoolId } : {}), joinCode: code, open: !!cls.open, createdAt: cls.createdAt, updatedAt: fs.serverTimestamp() });
    b.delete(fs.doc(db, "studyJoinCodes", cls.joinCode));
    try { await b.commit(); return code; } catch (e) { if (e.code !== "permission-denied") throw e; }
  }
  throw new Error("参加コードを作り直せませんでした。");
}

async function deleteAll(refs) {
  const { fs, db } = await ready();
  for (let i = 0; i < refs.length; i += 400) {
    const b = fs.writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => b.delete(r));
    await b.commit();
  }
}

export async function deleteClass(cls) {
  const { fs, db } = await ready();
  const assigns = await fs.getDocs(fs.collection(db, "studyClasses", cls.id, "assignments"));
  for (const a of assigns.docs) await deleteAssignment(cls.id, a.id);
  const members = await fs.getDocs(fs.collection(db, "studyClasses", cls.id, "members"));
  await deleteAll(members.docs.map((d) => d.ref));
  const profs = await fs.getDocs(fs.collection(db, "studyClasses", cls.id, "profiles"));
  await deleteAll(profs.docs.flatMap((d) => [fs.doc(db, "studyJoinCodes", d.data().code), d.ref]));
  await deleteAll([fs.doc(db, "studyJoinCodes", cls.joinCode), fs.doc(db, "studyClasses", cls.id)]);
}

export async function members(cid) {
  const { fs, db } = await ready();
  const snap = await fs.getDocs(fs.collection(db, "studyClasses", cid, "members"));
  return snap.docs.map(withId).sort((a, b) => String(a.name).localeCompare(String(b.name), "ja"));
}

export async function removeMember(cid, uid) {
  const { fs, db } = await ready();
  await fs.deleteDoc(fs.doc(db, "studyClasses", cid, "members", uid));
}

// ---------- 総合管理者 → 学校 → 先生 ----------
//   総合管理者 … 開発者（SK）が配る「総合管理者のコード」で、本人がなる。学校を作り、先生にコードを配る
//   先生 … 総合管理者が学校ごとに作る「先生のコード」で、本人がなる。学校の中でクラスを作る
//   総合管理者は、自分の学校のクラス（生徒・配信・提出）を読める。書き換えられるのはクラスの持ち主の先生だけ

// 先生・総合管理者のコードを調べる
export async function lookupStaffCode(code) {
  const { fs, db } = await ready();
  const snap = await fs.getDoc(fs.doc(db, "studyStaffCodes", normCode(code)));
  if (!snap.exists()) { const e = new Error("コードが見つかりません。"); e.code = "bad-code"; throw e; }
  return { code: snap.id, ...snap.data() };
}

// コードを使って、総合管理者・先生になる
export async function redeemStaffCode(info) {
  if (info.claimedBy) { const e = new Error("このコードはもう使われています。"); e.code = "bad-code"; throw e; }
  const { fs, db, user } = await ready();
  const b = fs.writeBatch(db);
  if (info.role === "admin") {
    b.set(fs.doc(db, "studyAdmins", user.uid), { name: info.name, org: "", createdAt: fs.serverTimestamp(), code: info.code });
  } else {
    const t = await fs.getDoc(fs.doc(db, "studyTeachers", user.uid)).catch(() => null);
    if (!t || !t.exists()) b.set(fs.doc(db, "studyTeachers", user.uid), { name: info.name, org: info.schoolName || "", approvedAt: fs.serverTimestamp(), approvedBy: user.uid, code: info.code });
    b.set(fs.doc(db, "studySchools", info.schoolId, "staff", user.uid), { name: info.name, code: info.code, joinedAt: fs.serverTimestamp() });
    b.set(fs.doc(db, "accounts", user.uid, "studyStaff", info.schoolId), { schoolName: info.schoolName, joinedAt: fs.serverTimestamp() });
  }
  b.update(fs.doc(db, "studyStaffCodes", info.code), { claimedBy: user.uid, claimedAt: fs.serverTimestamp() });
  try { await b.commit(); } catch (e) {
    if (e.code === "permission-denied") { const err = new Error("使えませんでした（このコードはもう使われているか、取り消されたかもしれません）。"); err.code = "bad-code"; throw err; }
    throw e;
  }
}

// 自分が作ったコード（総合管理者のコード・先生のコード）
export async function myStaffCodes() {
  const { fs, db, user } = await ready();
  const snap = await fs.getDocs(fs.query(fs.collection(db, "studyStaffCodes"), fs.where("ownerUid", "==", user.uid)));
  return snap.docs.map(withId).sort((a, b) => (ms(a.createdAt) || 0) - (ms(b.createdAt) || 0));
}

// 名前（複数）から、コードを作る。role: "admin"（開発者）/ "teacher"（学校の総合管理者。school = { id, name }）
export async function issueStaffCodes(role, names, school = null) {
  const { fs, db, user } = await ready();
  const list = [...new Set(names.map((n) => String(n).trim().slice(0, 40)).filter(Boolean))];
  for (const name of list) {
    let done = false;
    for (let i = 0; i < 5 && !done; i++) {
      const body = { role, name, ownerUid: user.uid, claimedBy: null, createdAt: fs.serverTimestamp(), ...(role === "teacher" ? { schoolId: school.id, schoolName: school.name } : {}) };
      try { await fs.setDoc(fs.doc(db, "studyStaffCodes", newCode()), body); done = true; } catch (e) { if (e.code !== "permission-denied") throw e; }
    }
    if (!done) throw new Error("コードを作れませんでした。もう一度ためしてください。");
  }
  return list.length;
}

export async function deleteStaffCode(code) {
  const { fs, db } = await ready();
  await fs.deleteDoc(fs.doc(db, "studyStaffCodes", code));
}

export async function mySchools() {
  const { fs, db, user } = await ready();
  const snap = await fs.getDocs(fs.query(fs.collection(db, "studySchools"), fs.where("ownerUid", "==", user.uid)));
  return snap.docs.map(withId).sort((a, b) => (ms(a.createdAt) || 0) - (ms(b.createdAt) || 0));
}

export async function getSchool(sid) {
  const { fs, db } = await ready();
  const snap = await fs.getDoc(fs.doc(db, "studySchools", sid));
  if (!snap.exists()) { const e = new Error("not-found"); e.code = "not-found"; throw e; }
  return withId(snap);
}

export async function createSchool(name) {
  const { fs, db, user } = await ready();
  const ref = fs.doc(db, "studySchools", newId());
  await fs.setDoc(ref, { ownerUid: user.uid, name: String(name).trim().slice(0, 60), createdAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() });
  return ref.id;
}

export async function renameSchool(school, name) {
  const { fs, db } = await ready();
  await fs.setDoc(fs.doc(db, "studySchools", school.id), { ownerUid: school.ownerUid, name: String(name).trim().slice(0, 60), createdAt: school.createdAt, updatedAt: fs.serverTimestamp() });
}

// クラスが残っている学校は消せない。先生の名簿とコードも消す
export async function deleteSchool(school) {
  const { fs, db } = await ready();
  const [classes, staff, codes] = await Promise.all([schoolClasses(school.id), schoolStaff(school.id), myStaffCodes()]);
  if (classes.length) throw new Error("クラスが残っている学校は削除できません。先にクラスを削除してください。");
  await deleteAll([
    ...staff.map((m) => fs.doc(db, "studySchools", school.id, "staff", m.id)),
    ...codes.filter((c) => c.schoolId === school.id).map((c) => fs.doc(db, "studyStaffCodes", c.id)),
    fs.doc(db, "studySchools", school.id)
  ]);
}

export async function schoolStaff(sid) {
  const { fs, db } = await ready();
  const snap = await fs.getDocs(fs.collection(db, "studySchools", sid, "staff"));
  return snap.docs.map(withId).sort((a, b) => String(a.name).localeCompare(String(b.name), "ja"));
}

// 先生の名前を直す（総合管理者。学校の先生名簿の名前。コードは変わらない）
export async function renameStaff(sid, uid, name) {
  const { fs, db } = await ready();
  const n = String(name || "").trim().slice(0, 40);
  if (!n) throw new Error("名前を入れてください。");
  await fs.updateDoc(fs.doc(db, "studySchools", sid, "staff", uid), { name: n });
}

// 先生を学校から外す（その先生は、この学校のクラスを触れなくなる。クラスと生徒の提出は残る）
export async function removeStaff(sid, uid) {
  const { fs, db } = await ready();
  await fs.deleteDoc(fs.doc(db, "studySchools", sid, "staff", uid));
}

// 学校のクラス（総合管理者が読む）
export async function schoolClasses(sid) {
  const { fs, db } = await ready();
  const snap = await fs.getDocs(fs.query(fs.collection(db, "studyClasses"), fs.where("schoolId", "==", sid)));
  return snap.docs.map(withId).sort((a, b) => (ms(b.createdAt) || 0) - (ms(a.createdAt) || 0));
}

// ---------- 組織のプロファイル（先生・総合管理者）と、その学習の記録 ----------
//   プロファイルの ID（ctx）: クラスの生徒 = クラスの ID / 先生 = "staff-<学校の ID>" / 総合管理者 = "admin"
//   組織のプロファイルの学習の記録は、accounts/{UID}/studyRecords/{ctx} に保存して、どの端末からも同じものを使えるようにする
export const isStaffCtx = (c) => c === "admin" || String(c || "").startsWith("staff-");

// 先生・総合管理者として入っている組織のプロファイル [{ id, name, orgName }]
export async function staffProfiles() {
  const ts = await teacherState();
  const out = [];
  if (ts.admin) out.push({ id: "admin", name: ts.admin.name, orgName: "総合管理者" });
  const { fs, db, user } = await ready();
  for (const sc of ts.schools) {
    // 学校ごとの先生名簿の名前（総合管理者が直せる）。読めなければ、先生の申し込みの名前
    const mine = await fs.getDoc(fs.doc(db, "studySchools", sc.id, "staff", user.uid)).catch(() => null);
    const name = mine && mine.exists() && mine.data().name ? mine.data().name : ts.teacher ? ts.teacher.name : ts.admin ? ts.admin.name : "先生";
    out.push({ id: `staff-${sc.id}`, name, orgName: `${sc.name} の先生` });
  }
  return out;
}

export async function loadRecords(ctx) {
  const { fs, db, user } = await ready();
  const snap = await fs.getDoc(fs.doc(db, "accounts", user.uid, "studyRecords", ctx));
  if (!snap.exists()) return null;
  const d = snap.data();
  const parse = (v, fb) => { try { return JSON.parse(v || "null") || fb; } catch (e) { return fb; } };
  return { progress: parse(d.progress, {}), days: parse(d.days, {}), tests: parse(d.tests, []) };
}

export async function saveRecords(ctx, rec) {
  const { fs, db, user } = await ready();
  const body = { progress: JSON.stringify(rec.progress || {}), days: JSON.stringify(rec.days || {}), tests: JSON.stringify(rec.tests || []), updatedAt: fs.serverTimestamp() };
  if (body.progress.length > 600000 || body.days.length > 50000 || body.tests.length > 200000) throw new Error("記録が大きすぎて保存できません。");
  await fs.setDoc(fs.doc(db, "accounts", user.uid, "studyRecords", ctx), body);
}

// ---------- 生徒プロファイル（名簿）。名前ごとに専用の参加コード ----------

export async function profiles(cid) {
  const { fs, db } = await ready();
  const snap = await fs.getDocs(fs.collection(db, "studyClasses", cid, "profiles"));
  return snap.docs.map(withId).sort((a, b) => (ms(a.createdAt) || 0) - (ms(b.createdAt) || 0) || String(a.name).localeCompare(String(b.name), "ja"));
}

// 名簿: プロファイル + 前の参加の仕方（プロファイルなし）の生徒。結果の画面などで使う。id は提出・採点の ID
export async function roster(cid) {
  // 組織モデルのクラスは、在籍から名簿を作る
  const cls = await getClass(cid).catch(() => null);
  if (cls && cls.orgModel === true) return org.orgRoster(await ready(), cls);
  const [ps, ms_] = await Promise.all([profiles(cid), members(cid)]);
  const linked = new Set(ps.map((p) => p.claimedBy).filter(Boolean));
  return [
    ...ps.map((p) => ({ id: p.id, name: p.name, claimed: !!p.claimedBy, profile: p })),
    ...ms_.filter((m) => !m.profileId && !linked.has(m.id)).map((m) => ({ id: m.id, name: m.name, claimed: true, legacy: true }))
  ];
}

// 名前（複数）から、プロファイルと専用コードを作る
export async function createProfiles(cls, names) {
  const { fs, db, user } = await ready();
  const list = [...new Set(names.map((n) => String(n).trim().slice(0, 40)).filter(Boolean))];
  for (let i = 0; i < list.length; i += 150) {
    const b = fs.writeBatch(db);
    for (const name of list.slice(i, i + 150)) {
      const pid = newId();
      const code = newCode();
      b.set(fs.doc(db, "studyClasses", cls.id, "profiles", pid), { name, code, claimedBy: null, createdAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() });
      b.set(fs.doc(db, "studyJoinCodes", code), { classId: cls.id, profileId: pid, profileName: name, ownerUid: user.uid, className: cls.name, teacherName: cls.teacherName || "", createdAt: fs.serverTimestamp() });
    }
    try { await b.commit(); } catch (e) {
      if (e.code === "permission-denied") throw new Error("プロファイルを作れませんでした。もう一度ためしてください（コードが重なったときも、やり直すと直ります）。");
      throw e;
    }
  }
  return list.length;
}

function profileDoc(p, patch) {
  return { name: p.name, code: p.code, claimedBy: p.claimedBy || null, ...(p.claimedAt ? { claimedAt: p.claimedAt } : {}), createdAt: p.createdAt, ...patch };
}

// 名前を変える。まだ使われていないプロファイルは、コードも新しくなる（コードの中の名前を合わせるため）
export async function renameProfile(cls, p, name) {
  const { fs, db } = await ready();
  const nm = String(name).trim().slice(0, 40);
  if (!nm) return;
  if (!p.claimedBy) { await resetProfile(cls, p, { name: nm }); return; }
  await fs.setDoc(fs.doc(db, "studyClasses", cls.id, "profiles", p.id), profileDoc(p, { name: nm, updatedAt: fs.serverTimestamp() }));
}

// 専用コードを作り直す（前のコードは使えなくなる）。結びつけているアカウントがあれば、結びつけも外す（外すと、そのアカウントでは入れなくなる）
export async function resetProfile(cls, p, { release = false, name = p.name } = {}) {
  const { fs, db, user } = await ready();
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const b = fs.writeBatch(db);
    b.set(fs.doc(db, "studyJoinCodes", code), { classId: cls.id, profileId: p.id, profileName: name, ownerUid: user.uid, className: cls.name, teacherName: cls.teacherName || "", createdAt: fs.serverTimestamp() });
    b.set(fs.doc(db, "studyClasses", cls.id, "profiles", p.id), profileDoc(p, { name, code, ...(release ? { claimedBy: null, claimedAt: null } : {}), updatedAt: fs.serverTimestamp() }));
    b.delete(fs.doc(db, "studyJoinCodes", p.code));
    if (release && p.claimedBy) b.delete(fs.doc(db, "studyClasses", cls.id, "members", p.claimedBy));
    try { await b.commit(); return code; } catch (e) { if (e.code !== "permission-denied") throw e; }
  }
  throw new Error("コードを作り直せませんでした。");
}

export async function deleteProfile(cls, p) {
  const { fs, db } = await ready();
  const b = fs.writeBatch(db);
  if (p.claimedBy) b.delete(fs.doc(db, "studyClasses", cls.id, "members", p.claimedBy));
  b.delete(fs.doc(db, "studyJoinCodes", p.code));
  b.delete(fs.doc(db, "studyClasses", cls.id, "profiles", p.id));
  await b.commit();
}

export async function allAssignments(cid) {
  const { fs, db } = await ready();
  const snap = await fs.getDocs(fs.collection(db, "studyClasses", cid, "assignments"));
  return snap.docs.map(withId).sort((a, b) => (ms(b.createdAt) || 0) - (ms(a.createdAt) || 0));
}

// 配信を作る・直す。data = { kind, title, due(ms|null), published, resultsOpen, answerKey?, set?, test?, print? }
export async function saveAssignment(cid, aid, data, existing = null) {
  const { fs, db } = await ready();
  const body = {
    kind: data.kind, title: String(data.title).trim().slice(0, 80),
    due: data.due ? fs.Timestamp.fromMillis(data.due) : null,
    published: !!data.published, resultsOpen: !!data.resultsOpen, noCopy: !!data.noCopy,
    updatedAt: fs.serverTimestamp(),
    createdAt: existing ? existing.createdAt : fs.serverTimestamp()
  };
  if (data.answerKey) body.answerKey = String(data.answerKey).slice(0, 64);
  if (data.set) body.set = data.set;
  if (data.test) body.test = data.test;
  if (data.print) body.print = data.print;
  const id = aid || newId();
  await fs.setDoc(fs.doc(db, "studyClasses", cid, "assignments", id), body);
  return id;
}

export async function deleteAssignment(cid, aid) {
  const { fs, db } = await ready();
  const [subs, grades] = await Promise.all([
    fs.getDocs(fs.collection(db, "studyClasses", cid, "assignments", aid, "submissions")),
    fs.getDocs(fs.collection(db, "studyClasses", cid, "assignments", aid, "grades"))
  ]);
  await deleteAll([...subs.docs.map((d) => d.ref), ...grades.docs.map((d) => d.ref), fs.doc(db, "studyClasses", cid, "assignments", aid)]);
}

export async function submissions(cid, aid) {
  const { fs, db } = await ready();
  const [subs, grades] = await Promise.all([
    fs.getDocs(fs.collection(db, "studyClasses", cid, "assignments", aid, "submissions")),
    fs.getDocs(fs.collection(db, "studyClasses", cid, "assignments", aid, "grades"))
  ]);
  const g = new Map(grades.docs.map((d) => [d.id, d.data()]));
  return subs.docs.map((d) => ({ id: d.id, ...d.data(), grade: g.get(d.id) || null }));
}

// 提出をやり直せるようにする（提出と採点を消す）
export async function resetSubmission(cid, aid, uid) {
  const { fs, db } = await ready();
  await deleteAll([fs.doc(db, "studyClasses", cid, "assignments", aid, "submissions", uid), fs.doc(db, "studyClasses", cid, "assignments", aid, "grades", uid)]);
}

// 採点を書く。marks は解答欄ごとの ○△×（JSON）
export async function saveGrade(cid, aid, uid, { ok, total, marks, note = "" }) {
  const { fs, db } = await ready();
  await fs.setDoc(fs.doc(db, "studyClasses", cid, "assignments", aid, "grades", uid), {
    ok, total, pct: total ? Math.round((ok / total) * 100) : 0,
    marks: JSON.stringify(marks || {}).slice(0, 20000), note: String(note).slice(0, 1000), gradedAt: fs.serverTimestamp()
  });
}

// ---------- いま使っているプロファイル（個人 / クラスの生徒プロファイル）。この端末だけの印 ----------
const CTX_KEY = "sk_study_ctx";
// 個人のときは ""、クラスのプロファイルのときはクラスの ID
export function activeClass() {
  try { return localStorage.getItem(CTX_KEY) || ""; } catch (e) { return ""; }
}
export function setActiveClass(cid) {
  try { if (cid) localStorage.setItem(CTX_KEY, cid); else localStorage.removeItem(CTX_KEY); } catch (e) { /* 残せなくても動く */ }
  document.dispatchEvent(new CustomEvent("sk-study:ctx"));
}

// ---------- 組織モデル（学校の名簿 → クラスの担任・在籍）。実装は org.js。ログインして接続している状態（ready）でそのまま使える ----------
const withReady = (fn) => async (...args) => fn(await ready(), ...args);
export const myOrgs = withReady(org.myOrgs);
export const lookupOrgCode = withReady(org.lookupOrgCode);
export const joinOrg = withReady(org.joinOrg);
export const leaveOrg = withReady(org.leaveOrg);
export const myPerson = withReady(org.myPerson);
export const personClasses = withReady(org.personClasses);
export const schoolPeople = withReady(org.schoolPeople);
export const peopleCodes = withReady(org.peopleCodes);
export const createPeople = withReady(org.createPeople);
export const renamePerson = withReady(org.renamePerson);
export const reissueCode = withReady(org.reissueCode);
export const setPersonStatus = withReady(org.setPersonStatus);
export const releasePerson = withReady(org.releasePerson);
export const deletePerson = withReady(org.deletePerson);
export const deleteSchoolPeople = withReady(org.deleteSchoolPeople);
export const orgClasses = withReady(org.orgClasses);
export const createOrgClass = withReady(org.createOrgClass);
export const renameOrgClass = withReady(org.renameOrgClass);
export const classPeople = withReady(org.classPeople);
export const enrollPeople = withReady(org.enrollPeople);
export const unenroll = withReady(org.unenroll);
export const teacherClassesOf = withReady(org.teacherClassesOf);
export const deleteOrgClass = withReady(org.deleteOrgClass);
// 従来の方式 → 組織モデルへの移行（org-migrate.js）
export const planMigration = withReady(migrate.planMigration);
export const runMigration = withReady(migrate.runMigration);
export const rollbackClass = withReady(migrate.rollbackClass);
export const adoptOrgLinks = withReady(migrate.adoptOrgLinks);
export const isTeacherOf = withReady(org.isTeacherOf);
export const isOrgCtx = (c) => String(c || "").startsWith("org-");
export const syncTeacherName = withReady(org.syncTeacherName);
export const linkPid = org.linkPid;
export const linkRoles = org.linkRoles;
