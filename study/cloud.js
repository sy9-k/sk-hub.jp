// SK Study と SK Hub Systems（Firestore）。クラス・配信・提出・採点（指導者メニュー）
//   ・ログインしていない人には Firebase を読み込まない（ヘッダーの表示用の情報 skhub_account があるときだけ確認する）
//   ・データの形と権限は y-filter リポジトリの systems/firestore.rules の「SK Study」
//       studyTeacherApps/{UID}・studyTeachers/{UID}・studyJoinCodes/{コード}・studyClasses/{cid}
//       studyClasses/{cid}/members/{UID}・/assignments/{aid}・/assignments/{aid}/submissions/{UID}・/grades/{UID}
//       accounts/{UID}/studyClasses/{cid}（本人の、参加しているクラスの一覧）
//   ・クラスに参加するには、アカウントを SK Study に接続しておく（/account/?connect=study）
const FIRESTORE = "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 見まちがえやすい I・O・0・1 は使わない
export const PRINT_MAX_BYTES = 950000; // Firestore は 1 件 1MB まで

let mods = null;
async function load() {
  if (!mods) mods = Promise.all([import("/assets/hub/account.js"), import(FIRESTORE)]).then(([hub, fs]) => ({ hub, fs }));
  return mods;
}

function hasHint() {
  try { return !!localStorage.getItem("skhub_account"); } catch (e) { return false; }
}

// いまの状態。status: signed-out / offline / unregistered / not-connected / ready
//   ready のときは { user, account, name, hub, fs, db }
let cached = null;
export async function session({ fresh = false } = {}) {
  if (cached && !fresh) return cached;
  if (!hasHint()) return (cached = { status: "signed-out" });
  let m;
  try { m = await load(); } catch (e) { return { status: "offline" }; }
  const { hub, fs } = m;
  const user = await hub.currentUser();
  if (!user) return (cached = { status: "signed-out" });
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

export async function joinClass(info, name) {
  const { fs, db, user } = await ready();
  const b = fs.writeBatch(db);
  b.set(fs.doc(db, "studyClasses", info.classId, "members", user.uid), { name: String(name).slice(0, 40), code: info.code, joinedAt: fs.serverTimestamp() });
  b.set(fs.doc(db, "accounts", user.uid, "studyClasses", info.classId), { name: info.className, teacherName: info.teacherName || "", joinedAt: fs.serverTimestamp() });
  try {
    await b.commit();
  } catch (e) {
    if (e.code === "permission-denied") { const err = new Error("参加できませんでした（参加の受け付けが終わっているかもしれません）。"); err.code = "closed"; throw err; }
    throw e;
  }
}

export async function leaveClass(cid) {
  const { fs, db, user } = await ready();
  await fs.deleteDoc(fs.doc(db, "studyClasses", cid, "members", user.uid)).catch(() => {});
  await fs.deleteDoc(fs.doc(db, "accounts", user.uid, "studyClasses", cid));
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
  const { fs, db, user } = await ready();
  const snap = await fs.getDoc(fs.doc(db, "studyClasses", cid, "assignments", aid, "submissions", user.uid));
  return snap.exists() ? withId(snap) : null;
}

// 結果が公開されていなければ null
export async function myGrade(cid, aid) {
  const { fs, db, user } = await ready();
  try {
    const snap = await fs.getDoc(fs.doc(db, "studyClasses", cid, "assignments", aid, "grades", user.uid));
    return snap.exists() ? withId(snap) : null;
  } catch (e) {
    if (e.code === "permission-denied") return null;
    throw e;
  }
}

// 提出する。score = { ok, total }、data = 答えなど（JSON にする）。update は単語帳の進み具合を送り直すとき
export async function submit(cid, aid, score, data, { update = false } = {}) {
  const { fs, db, user, name } = await ready();
  const json = JSON.stringify(data || {});
  if (json.length > 200000) throw new Error("提出する内容が大きすぎます。");
  const ok = Number(score.ok) || 0, total = Number(score.total) || 0;
  const body = { name: String(name).slice(0, 40), score: { ok, total, pct: total ? Math.round((ok / total) * 100) : 0 }, data: json, updatedAt: fs.serverTimestamp() };
  const ref = fs.doc(db, "studyClasses", cid, "assignments", aid, "submissions", user.uid);
  if (update) await fs.updateDoc(ref, body);
  else await fs.setDoc(ref, { ...body, submittedAt: fs.serverTimestamp() });
}

// ---------- 指導者 ----------

// { teacher: { name, org } | null, app: 申し込み | null }
export async function teacherState() {
  const { fs, db, user } = await ready();
  const [t, a] = await Promise.all([
    fs.getDoc(fs.doc(db, "studyTeachers", user.uid)).catch(() => null),
    fs.getDoc(fs.doc(db, "studyTeacherApps", user.uid)).catch(() => null)
  ]);
  return { teacher: t && t.exists() ? t.data() : null, app: a && a.exists() ? a.data() : null };
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
export async function createClass(name, teacherName) {
  const { fs, db, user } = await ready();
  const cid = newId();
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const b = fs.writeBatch(db);
    b.set(fs.doc(db, "studyClasses", cid), {
      ownerUid: user.uid, name: String(name).trim().slice(0, 60), teacherName: String(teacherName || "").slice(0, 40),
      joinCode: code, open: true, createdAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp()
    });
    b.set(fs.doc(db, "studyJoinCodes", code), { classId: cid, ownerUid: user.uid, className: String(name).trim().slice(0, 60), teacherName: String(teacherName || "").slice(0, 40), createdAt: fs.serverTimestamp() });
    try { await b.commit(); return cid; } catch (e) { if (e.code !== "permission-denied") throw e; }
  }
  throw new Error("クラスを作れませんでした。もう一度ためしてください。");
}

export async function updateClass(cls, patch) {
  const { fs, db } = await ready();
  const next = { ownerUid: cls.ownerUid, name: cls.name, teacherName: cls.teacherName || "", joinCode: cls.joinCode, open: !!cls.open, createdAt: cls.createdAt, ...patch, updatedAt: fs.serverTimestamp() };
  await fs.setDoc(fs.doc(db, "studyClasses", cls.id), next);
}

// 参加コードを作り直す（前のコードは使えなくなる）
export async function renewCode(cls) {
  const { fs, db, user } = await ready();
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    const b = fs.writeBatch(db);
    b.set(fs.doc(db, "studyJoinCodes", code), { classId: cls.id, ownerUid: user.uid, className: cls.name, teacherName: cls.teacherName || "", createdAt: fs.serverTimestamp() });
    b.set(fs.doc(db, "studyClasses", cls.id), { ownerUid: cls.ownerUid, name: cls.name, teacherName: cls.teacherName || "", joinCode: code, open: !!cls.open, createdAt: cls.createdAt, updatedAt: fs.serverTimestamp() });
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
    published: !!data.published, resultsOpen: !!data.resultsOpen,
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
