// SK Study の組織モデル（学校の名簿 → クラスの担任・在籍）の Firestore の読み書き
//   設計は _study-org-model-design.md、権限は y-filter の systems/firestore.rules の「組織モデル」
//     studySchools/{sid}/people/{pid}                 学校のユーザー（名簿）。name・role（student / teacher）・claimedBy・status
//     studySchools/{sid}/people/{pid}/secret/code     専用コード（総合管理者だけ読める）
//     studySchools/{sid}/people/{pid}/classes/{cid}   このユーザーが入っているクラス（role: student / teacher）
//     studyClasses/{cid}（orgModel: true）/enrollments/{pid}・/teachers/{pid}   在籍・担任（上の classes と必ず同じ書きこみで作る）
//     studyJoinCodes/{コード}                          { schoolId, personId, role, personName, schoolName, ownerUid }
//     accounts/{UID}/studyOrgs/{sid}                   本人の「入っている学校」{ personId, role, code, schoolName }
//   どの関数も、第 1 引数 c = { fs, db, user }（cloud.js の ready() の結果。ブラウザの外（ルールの確かめ）でも動くように、ここでは Firebase を読み込まない）
//   ルールの上限（1 回の書きこみで、確かめのためのアクセスが 20 回まで）があるので、まとめて書くときは BATCH 人ずつに分ける
export const BATCH = 6;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 見まちがえやすい I・O・0・1 は使わない

const ms = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : null);
const withId = (d) => ({ id: d.id, ...d.data() });
const byName = (a, b) => String(a.name).localeCompare(String(b.name), "ja");
const trim = (s, n) => String(s == null ? "" : s).trim().slice(0, n);
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));
export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}
export function newId() {
  return [...crypto.getRandomValues(new Uint8Array(10))].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const normCode = (s) => String(s || "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
function fail(code, message) { const e = new Error(message); e.code = code; return e; }

// ---------- 本人（生徒・先生のユーザー） ----------

// 入っている学校の一覧 [{ id: 学校の ID, schoolName, personId, role, joinedAt }]
export async function myOrgs(c) {
  const { fs, db, user } = c;
  const snap = await fs.getDocs(fs.collection(db, "accounts", user.uid, "studyOrgs"));
  return snap.docs.map(withId).sort((a, b) => (ms(b.joinedAt) || 0) - (ms(a.joinedAt) || 0));
}

// 専用コードを調べる（学校のユーザー用のコードだけ）
export async function lookupOrgCode(c, code) {
  const { fs, db } = c;
  const snap = await fs.getDoc(fs.doc(db, "studyJoinCodes", normCode(code)));
  if (!snap.exists()) throw fail("bad-code", "コードが見つかりません。");
  const d = snap.data();
  if (!d.schoolId || !d.personId) throw fail("not-org-code", "このコードは、クラスの参加コードです。");
  return { code: snap.id, ...d };
}

// 専用コードで、学校の名簿のユーザーを自分のアカウントに結びつける
export async function joinOrg(c, info) {
  const { fs, db, user } = c;
  const b = fs.writeBatch(db);
  b.update(fs.doc(db, "studySchools", info.schoolId, "people", info.personId), { claimedBy: user.uid, claimedAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() });
  b.set(fs.doc(db, "accounts", user.uid, "studyOrgs", info.schoolId), { schoolName: info.schoolName, personId: info.personId, role: info.role, code: info.code, joinedAt: fs.serverTimestamp() });
  try {
    await b.commit();
  } catch (e) {
    if (e.code === "permission-denied") throw fail("closed", "入れませんでした（このコードはもう使われているか、停止されているかもしれません）。");
    throw e;
  }
}

// 学校から抜ける（名簿のユーザーは残り、結びつけだけ外れる。総合管理者がまた新しいコードを出せる）
export async function leaveOrg(c, sid) {
  const { fs, db, user } = c;
  const link = await fs.getDoc(fs.doc(db, "accounts", user.uid, "studyOrgs", sid)).catch(() => null);
  const pid = link && link.exists() ? link.data().personId : null;
  if (pid) await fs.updateDoc(fs.doc(db, "studySchools", sid, "people", pid), { claimedBy: null, claimedAt: null, updatedAt: fs.serverTimestamp() }).catch(() => {});
  await fs.deleteDoc(fs.doc(db, "accounts", user.uid, "studyOrgs", sid));
}

// 自分のユーザー（名簿の 1 件）。なければ null
export async function myPerson(c, sid, pid) {
  const { fs, db } = c;
  const snap = await fs.getDoc(fs.doc(db, "studySchools", sid, "people", pid)).catch(() => null);
  return snap && snap.exists() ? withId(snap) : null;
}

// ユーザーが入っているクラス [{ id: クラスの ID, className, role, addedAt }]
export async function personClasses(c, sid, pid) {
  const { fs, db } = c;
  const snap = await fs.getDocs(fs.collection(db, "studySchools", sid, "people", pid, "classes"));
  return snap.docs.map(withId).sort((a, b) => String(a.className).localeCompare(String(b.className), "ja"));
}

// ---------- 名簿（総合管理者） ----------

// 学校の名簿。role を渡すと、その役割だけ
export async function schoolPeople(c, sid, role = "") {
  const { fs, db } = c;
  const snap = await fs.getDocs(fs.collection(db, "studySchools", sid, "people"));
  return snap.docs.map(withId).filter((p) => !role || p.role === role).sort(byName);
}

// まだ使われていないユーザーの専用コード Map(pid → コード)（総合管理者だけ）
export async function peopleCodes(c, sid, people) {
  const { fs, db } = c;
  const out = new Map();
  await Promise.all(people.filter((p) => !p.claimedBy).map(async (p) => {
    const snap = await fs.getDoc(fs.doc(db, "studySchools", sid, "people", p.id, "secret", "code")).catch(() => null);
    if (snap && snap.exists()) out.set(p.id, snap.data().code);
  }));
  return out;
}

export function setCodeOps(b, c, school, pid, role, name, code) {
  const { fs, db, user } = c;
  b.set(fs.doc(db, "studySchools", school.id, "people", pid, "secret", "code"), { code, updatedAt: fs.serverTimestamp() });
  b.set(fs.doc(db, "studyJoinCodes", code), { schoolId: school.id, personId: pid, role, personName: name, schoolName: school.name, ownerUid: user.uid, createdAt: fs.serverTimestamp() });
}

// 名前（複数）から、ユーザーと専用コードを作る。[{ id, name, code }] を返す（コードが重なったら作り直す）
export async function createPeople(c, school, role, names) {
  const { fs, db } = c;
  if (!["student", "teacher"].includes(role)) throw fail("bad-role", "役割がまちがっています。");
  const list = [...new Set(names.map((n) => trim(n, 40)).filter(Boolean))];
  const made = [];
  for (const group of chunks(list, BATCH)) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const items = group.map((name) => ({ id: newId(), name, code: newCode() }));
      if (new Set(items.map((x) => x.code)).size !== items.length) continue;
      const b = fs.writeBatch(db);
      for (const it of items) {
        b.set(fs.doc(db, "studySchools", school.id, "people", it.id), { name: it.name, role, claimedBy: null, status: "active", createdAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() });
        setCodeOps(b, c, school, it.id, role, it.name, it.code);
      }
      try { await b.commit(); made.push(...items); break; } catch (e) {
        if (e.code !== "permission-denied" || attempt === 4) throw e; // コードが重なったときも拒まれる。作り直す
      }
    }
  }
  return made;
}

// 名前を変える。まだ使われていないユーザーは、専用コードも新しくなる（コードに名前が入っているため）
export async function renamePerson(c, school, person, name) {
  const { fs, db } = c;
  const n = trim(name, 40);
  if (!n) throw fail("empty", "名前を入れてください。");
  if (person.claimedBy) {
    await fs.updateDoc(fs.doc(db, "studySchools", school.id, "people", person.id), { name: n, updatedAt: fs.serverTimestamp() });
    return null;
  }
  return reissueCode(c, school, person, n);
}

// 専用コードを作り直す（前のコードは使えなくなる。まだ使われていないユーザーだけ）。新しいコードを返す
export async function reissueCode(c, school, person, name = person.name) {
  const { fs, db } = c;
  if (person.claimedBy) throw fail("claimed", "もう使われているユーザーのコードは作り直せません。先に結びつけを外してください。");
  const old = await fs.getDoc(fs.doc(db, "studySchools", school.id, "people", person.id, "secret", "code")).catch(() => null);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const b = fs.writeBatch(db);
    b.update(fs.doc(db, "studySchools", school.id, "people", person.id), { name, updatedAt: fs.serverTimestamp() });
    setCodeOps(b, c, school, person.id, person.role, name, code);
    if (old && old.exists()) b.delete(fs.doc(db, "studyJoinCodes", old.data().code));
    try { await b.commit(); return code; } catch (e) { if (e.code !== "permission-denied" || attempt === 4) throw e; }
  }
  return null;
}

// 停止する・戻す（停止すると、そのユーザーは使えなくなる。提出は残る）
export async function setPersonStatus(c, sid, person, status) {
  const { fs, db } = c;
  if (!["active", "suspended"].includes(status)) throw fail("bad-status", "状態がまちがっています。");
  await fs.updateDoc(fs.doc(db, "studySchools", sid, "people", person.id), { status, updatedAt: fs.serverTimestamp() });
}

// 結びつけを外す（そのアカウントは、このユーザーを使えなくなる。名簿・クラスの在籍・提出は残る）。新しいコードを返す
export async function releasePerson(c, school, person) {
  const { fs, db } = c;
  const code = newCode();
  const b = fs.writeBatch(db);
  b.update(fs.doc(db, "studySchools", school.id, "people", person.id), { claimedBy: null, claimedAt: null, updatedAt: fs.serverTimestamp() });
  setCodeOps(b, c, school, person.id, person.role, person.name, code);
  await b.commit();
  return code;
}

async function deleteAll(c, refs) {
  const { fs, db } = c;
  for (const group of chunks(refs, 100)) {
    const b = fs.writeBatch(db);
    group.forEach((r) => b.delete(r));
    await b.commit();
  }
}

// ユーザーを名簿から消す（入っているクラスの在籍・担任も外れる。提出は残る）
export async function deletePerson(c, school, person) {
  const { fs, db } = c;
  const classes = await personClasses(c, school.id, person.id);
  for (const k of classes) await unenroll(c, k.id, school.id, person.id, k.role);
  const old = await fs.getDoc(fs.doc(db, "studySchools", school.id, "people", person.id, "secret", "code")).catch(() => null);
  await deleteAll(c, [
    ...(old && old.exists() ? [fs.doc(db, "studyJoinCodes", old.data().code)] : []),
    fs.doc(db, "studySchools", school.id, "people", person.id, "secret", "code"),
    fs.doc(db, "studySchools", school.id, "people", person.id)
  ]);
}

// 学校を消すときのために、名簿を全部消す
export async function deleteSchoolPeople(c, school) {
  const people = await schoolPeople(c, school.id);
  for (const p of people) await deletePerson(c, school, p);
}

// ---------- クラス（組織モデル。orgModel: true） ----------

// 学校の組織モデルのクラス
export async function orgClasses(c, sid) {
  const { fs, db } = c;
  const snap = await fs.getDocs(fs.query(fs.collection(db, "studyClasses"), fs.where("schoolId", "==", sid)));
  return snap.docs.map(withId).filter((k) => k.orgModel === true).sort((a, b) => (ms(b.createdAt) || 0) - (ms(a.createdAt) || 0));
}

// クラスを作る。総合管理者は、担任を決めずに作れる（あとで担任を足す）。先生は me = { id, name }（自分のユーザー）を渡し、自分が担任になる
export async function createOrgClass(c, school, name, { me = null } = {}) {
  const { fs, db, user } = c;
  const cid = newId();
  const n = trim(name, 60);
  if (!n) throw fail("empty", "クラスの名前を入れてください。");
  const b = fs.writeBatch(db);
  b.set(fs.doc(db, "studyClasses", cid), { ownerUid: user.uid, name: n, teacherName: me ? trim(me.name, 40) : "", schoolId: school.id, schoolName: trim(school.name, 60), orgModel: true, createdAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp() });
  if (me) {
    b.set(fs.doc(db, "studyClasses", cid, "teachers", me.id), { personId: me.id, name: trim(me.name, 40), addedBy: user.uid, addedAt: fs.serverTimestamp() });
    b.set(fs.doc(db, "studySchools", school.id, "people", me.id, "classes", cid), { className: n, role: "teacher", addedAt: fs.serverTimestamp() });
  }
  await b.commit();
  return cid;
}

// クラスの名前を変える（本人の classes の className は作ったときの名前のまま。画面ではクラス本体の名前を使う）
export async function renameOrgClass(c, cls, name) {
  const { fs, db } = c;
  const n = trim(name, 60);
  if (!n) throw fail("empty", "クラスの名前を入れてください。");
  await fs.updateDoc(fs.doc(db, "studyClasses", cls.id), { name: n, updatedAt: fs.serverTimestamp() });
}

// クラスの担任と在籍 { teachers: [], students: [] }
export async function classPeople(c, cid) {
  const { fs, db } = c;
  const [t, s] = await Promise.all([
    fs.getDocs(fs.collection(db, "studyClasses", cid, "teachers")),
    fs.getDocs(fs.collection(db, "studyClasses", cid, "enrollments")).catch(() => ({ docs: [] }))
  ]);
  return { teachers: t.docs.map(withId).sort(byName), students: s.docs.map(withId).sort(byName) };
}

// 名簿から、クラスに入れる（role: student = 在籍 / teacher = 担任）。すでに入っている人は飛ばす。入れた人の数を返す
//   slots … Map(ユーザーの ID → 提出・採点の ID)。従来のプロファイルで提出していたクラスを移すときだけ使う（ふつうは要らない）
export async function enrollPeople(c, cls, persons, role = "student", { slots = null } = {}) {
  const { fs, db, user } = c;
  const part = role === "teacher" ? "teachers" : "enrollments";
  const have = await fs.getDocs(fs.collection(db, "studyClasses", cls.id, part)).catch(() => ({ docs: [] }));
  const already = new Set(have.docs.map((d) => d.id));
  const todo = persons.filter((p) => p.role === role && !already.has(p.id) && (p.status || "active") === "active");
  for (const group of chunks(todo, BATCH)) {
    const b = fs.writeBatch(db);
    for (const p of group) {
      const slot = slots && slots.get(p.id);
      b.set(fs.doc(db, "studyClasses", cls.id, part, p.id), { personId: p.id, name: trim(p.name, 40), ...(slot && slot !== p.id ? { slotId: slot } : {}), addedBy: user.uid, addedAt: fs.serverTimestamp() });
      b.set(fs.doc(db, "studySchools", cls.schoolId, "people", p.id, "classes", cls.id), { className: cls.name, role, addedAt: fs.serverTimestamp() });
    }
    await b.commit();
  }
  return todo.length;
}

// クラスから外す（在籍・担任と、本人の classes の両方）
export async function unenroll(c, cid, sid, pid, role = "student") {
  const { fs, db } = c;
  const b = fs.writeBatch(db);
  b.delete(fs.doc(db, "studyClasses", cid, role === "teacher" ? "teachers" : "enrollments", pid));
  b.delete(fs.doc(db, "studySchools", sid, "people", pid, "classes", cid));
  await b.commit();
}

// 先生が担任のクラス（本人の classes から）
export async function teacherClassesOf(c, sid, pid) {
  const { fs, db } = c;
  const mine = (await personClasses(c, sid, pid)).filter((k) => k.role === "teacher");
  const snaps = await Promise.all(mine.map((k) => fs.getDoc(fs.doc(db, "studyClasses", k.id)).catch(() => null)));
  return snaps.filter((s) => s && s.exists()).map(withId);
}

// クラスを消す。配信（提出・採点つき）・在籍・担任と、本人の classes を消してから、クラス本体を消す
export async function deleteOrgClass(c, cls) {
  const { fs, db } = c;
  const assigns = await fs.getDocs(fs.collection(db, "studyClasses", cls.id, "assignments"));
  for (const a of assigns.docs) {
    const [subs, grades] = await Promise.all([
      fs.getDocs(fs.collection(db, "studyClasses", cls.id, "assignments", a.id, "submissions")),
      fs.getDocs(fs.collection(db, "studyClasses", cls.id, "assignments", a.id, "grades"))
    ]);
    await deleteAll(c, [...subs.docs.map((d) => d.ref), ...grades.docs.map((d) => d.ref), a.ref]);
  }
  const { teachers, students } = await classPeople(c, cls.id);
  for (const p of students) await unenroll(c, cls.id, cls.schoolId, p.id, "student");
  for (const p of teachers) await unenroll(c, cls.id, cls.schoolId, p.id, "teacher");
  await fs.deleteDoc(fs.doc(db, "studyClasses", cls.id));
}

// 自分が、このクラスの担任か（組織モデル。クラスの teachers に、自分のユーザーがいるか）
export async function isTeacherOf(c, cls) {
  const { fs, db, user } = c;
  if (!cls || !cls.schoolId) return false;
  const link = await fs.getDoc(fs.doc(db, "accounts", user.uid, "studyOrgs", cls.schoolId)).catch(() => null);
  const pid = link && link.exists() ? link.data().personId : null;
  if (!pid) return false;
  const t = await fs.getDoc(fs.doc(db, "studyClasses", cls.id, "teachers", pid)).catch(() => null);
  return !!(t && t.exists());
}

// クラスの名簿（組織モデル）。結果の画面などで使う形 [{ id: 提出・採点の ID, personId, name, claimed }]
export async function orgRoster(c, cls) {
  const [cp, people] = await Promise.all([classPeople(c, cls.id), schoolPeople(c, cls.schoolId)]);
  const claimed = new Map(people.map((p) => [p.id, !!p.claimedBy]));
  return cp.students.map((e) => ({ id: e.slotId || e.id, personId: e.id, name: e.name, claimed: !!claimed.get(e.id), org: true }));
}
