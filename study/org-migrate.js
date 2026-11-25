// 従来の方式（クラスの生徒プロファイル・学校の先生名簿）から、組織モデル（学校の名簿 → 担任・在籍）への移行
//   設計は _study-org-model-design.md の 4。原則: 消さない・書き換えない・足すだけ・何度やっても同じ結果
//   ・planMigration … 読むだけ。何を足すかの一覧（確認一覧）を返す。書きこみはしない
//   ・runMigration  … 一覧のとおりに足す。途中で止まっても、もう一度やれば足りないものだけ足す
//   ・adoptOrgLinks … 本人がログインしたとき、自分の「入っている学校」の目印（accounts/{UID}/studyOrgs）を作る（本人の領域は本人しか書けないため）
//   移し方
//     生徒 … クラスのプロファイルを、学校の名簿のユーザーにする（ID は同じ）。同じアカウントが同じ学校の複数のクラスに別のプロファイルで入っていたら、
//            ユーザーを 1 つにまとめる（先に作られたクラスのプロファイルの ID）。あとのクラスの提出は、在籍の slotId に前のプロファイルの ID を入れて、そのまま使う
//            まだ使われていないプロファイルは、結びつけずに名簿に入れ、新しい専用コードを付ける（従来のコードは、クラスの受け付けを止めて使えなくする）
//     先生 … 学校の先生名簿（staff）を、先生のユーザーにする（ID は先生の UID）。コード待ちの先生は、新しいコードで名簿に入れ、従来のコードは消す
//     クラス … orgModel: true にして、従来の参加の受け付けを止める（joinCode・members・profiles は残す）。担任は、クラスを作った先生
import { tx } from "./i18n.js";
import * as org from "./org.js";

export const MIGRATE_BATCH = 4; // 結びつきずみのユーザーを作る書きこみは、確かめのアクセスが多いので少なめに

const ms = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : 0);
const withId = (d) => ({ id: d.id, ...d.data() });
const chunks = (list, n) => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

async function legacyClasses(c, sid) {
  const { fs, db } = c;
  const snap = await fs.getDocs(fs.query(fs.collection(db, "studyClasses"), fs.where("schoolId", "==", sid)));
  return snap.docs.map(withId).filter((k) => !!k.joinCode).sort((a, b) => ms(a.createdAt) - ms(b.createdAt)); // 従来のクラス（参加コードがある）
}

// ---------- 確認一覧（読むだけ） ----------
// 戻り値: { school, classes: [...], newStudents, newTeachers, pendingTeachers, conflicts, warnings, totals }
export async function planMigration(c, school) {
  const { fs, db } = c;
  const [classes, people, staffSnap, codesSnap] = await Promise.all([
    legacyClasses(c, school.id),
    org.schoolPeople(c, school.id),
    fs.getDocs(fs.collection(db, "studySchools", school.id, "staff")),
    fs.getDocs(fs.query(fs.collection(db, "studyStaffCodes"), fs.where("ownerUid", "==", c.user.uid)))
  ]);
  const staff = staffSnap.docs.map(withId);
  const pendingCodes = codesSnap.docs.map(withId).filter((x) => x.schoolId === school.id && !x.claimedBy && x.role === "teacher");
  const profiles = await Promise.all(classes.map((k) => fs.getDocs(fs.collection(db, "studyClasses", k.id, "profiles")).then((s) => s.docs.map(withId))));
  const enrolled = await Promise.all(classes.map((k) => org.classPeople(c, k.id)));

  const byId = new Map(people.map((p) => [p.id, p]));
  const studentByUid = new Map(people.filter((p) => p.role === "student" && p.claimedBy).map((p) => [p.claimedBy, p]));
  const teacherByUid = new Map(people.filter((p) => p.role === "teacher" && p.claimedBy).map((p) => [p.claimedBy, p]));
  const newStudents = [];
  const conflicts = [];
  const warnings = [];

  const planned = classes.map((k, i) => {
    const haveStudents = new Set(enrolled[i].students.map((e) => e.id));
    const haveTeachers = new Set(enrolled[i].teachers.map((e) => e.id));
    const rows = [];
    for (const pr of profiles[i]) {
      let person = null;
      if (pr.claimedBy) {
        person = studentByUid.get(pr.claimedBy) || null;
        if (!person) {
          const there = byId.get(pr.id);
          if (there) { conflicts.push({ cls: k, profile: pr, reason: tx("移行のあとに、従来のコードで結びついたプロファイルです。結びつけを外して、新しいコードで入り直してください。") }); continue; }
          person = { id: pr.id, name: pr.name, role: "student", claimedBy: pr.claimedBy, status: "active", legacyClassId: k.id, isNew: true };
          studentByUid.set(pr.claimedBy, person);
          newStudents.push(person);
        } else if (person.name !== pr.name) {
          warnings.push(tx("{name}: 「{name2}」は、同じアカウントの名簿の名前「{name3}」と書き方がちがいます（名簿の名前を使います）", { name: k.name, name2: pr.name, name3: person.name }));
        }
      } else {
        person = byId.get(pr.id) || null;
        if (!person) {
          person = { id: pr.id, name: pr.name, role: "student", claimedBy: null, status: "active", isNew: true };
          byId.set(pr.id, person);
          newStudents.push(person);
        }
      }
      rows.push({ profile: pr, person, slotId: person.id !== pr.id ? pr.id : null, enrolled: haveStudents.has(person.id) });
    }
    return { cls: k, rows, haveTeachers };
  });

  // 先生
  const newTeachers = [];
  for (const s of staff) {
    if (teacherByUid.has(s.id) || byId.has(s.id)) continue;
    const t = { id: s.id, name: s.name, role: "teacher", claimedBy: s.id, status: "active", legacyStaff: true, isNew: true };
    teacherByUid.set(s.id, t);
    newTeachers.push(t);
  }
  const pendingTeachers = pendingCodes.map((x) => ({ staffCode: x.id, name: x.name }));

  const classRows = planned.map(({ cls, rows, haveTeachers }) => {
    const teacher = teacherByUid.get(cls.ownerUid) || null;
    if (!teacher) warnings.push(tx("{name}: 担任（クラスを作った先生）が、学校の先生名簿にいません。担任なしで移します", { name: cls.name }));
    return {
      cls, teacher, rows,
      convert: cls.orgModel !== true,
      addTeacher: !!teacher && !haveTeachers.has(teacher.id),
      addStudents: rows.filter((r) => !r.enrolled).length
    };
  });
  const totals = {
    classes: classRows.length,
    classesToConvert: classRows.filter((x) => x.convert).length,
    newStudents: newStudents.length,
    newStudentsClaimed: newStudents.filter((p) => p.claimedBy).length,
    newStudentsPending: newStudents.filter((p) => !p.claimedBy).length,
    newTeachers: newTeachers.length,
    pendingTeachers: pendingTeachers.length,
    enrollments: classRows.reduce((n, x) => n + x.addStudents, 0),
    teacherLinks: classRows.filter((x) => x.addTeacher).length,
    merged: classRows.reduce((n, x) => n + x.rows.filter((r) => r.slotId).length, 0)
  };
  totals.writes = totals.newStudentsClaimed + totals.newStudentsPending * 3 + totals.newTeachers + totals.pendingTeachers * 4 + totals.enrollments * 2 + totals.teacherLinks * 2 + totals.classesToConvert;
  totals.done = !totals.newStudents && !totals.newTeachers && !totals.pendingTeachers && !totals.enrollments && !totals.teacherLinks && !totals.classesToConvert && !conflicts.length;
  return { school, classes: classRows, newStudents, newTeachers, pendingTeachers, conflicts, warnings, totals };
}

// ---------- 実行（足すだけ） ----------
export async function runMigration(c, school, plan, { onProgress = () => {} } = {}) {
  const { fs, db, user } = c;
  const stamp = () => fs.serverTimestamp();
  let step = 0;
  const total = plan.newStudents.length + plan.newTeachers.length + plan.pendingTeachers.length + plan.classes.length;
  const tick = (what, n = 1) => { step += n; onProgress({ step, total, what }); };

  // 1. 生徒のユーザー
  for (const group of chunks(plan.newStudents, MIGRATE_BATCH)) {
    const b = fs.writeBatch(db);
    for (const p of group) {
      b.set(fs.doc(db, "studySchools", school.id, "people", p.id), {
        name: p.name, role: "student", claimedBy: p.claimedBy || null, ...(p.claimedBy ? { claimedAt: stamp(), legacyClassId: p.legacyClassId } : {}),
        status: "active", createdAt: stamp(), updatedAt: stamp()
      });
      if (!p.claimedBy) org.setCodeOps(b, c, school, p.id, "student", p.name, org.newCode());
    }
    await commitWithRetry(b, group, c, school, "student");
    tick(tx("生徒のユーザー"), group.length);
  }
  // 2. 先生のユーザー（学校の先生名簿から）
  for (const group of chunks(plan.newTeachers, MIGRATE_BATCH)) {
    const b = fs.writeBatch(db);
    for (const t of group) {
      b.set(fs.doc(db, "studySchools", school.id, "people", t.id), { name: t.name, role: "teacher", claimedBy: t.claimedBy, claimedAt: stamp(), legacyStaff: true, status: "active", createdAt: stamp(), updatedAt: stamp() });
    }
    await b.commit();
    tick(tx("先生のユーザー"), group.length);
  }
  // 3. コード待ちの先生: 名簿に入れて新しいコードを付け、従来のコードを消す（同じ書きこみで）
  for (const t of plan.pendingTeachers) {
    const pid = org.newId();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = org.newCode();
      const b = fs.writeBatch(db);
      b.set(fs.doc(db, "studySchools", school.id, "people", pid), { name: t.name, role: "teacher", claimedBy: null, status: "active", createdAt: stamp(), updatedAt: stamp() });
      org.setCodeOps(b, c, school, pid, "teacher", t.name, code);
      b.delete(fs.doc(db, "studyStaffCodes", t.staffCode));
      try { await b.commit(); break; } catch (e) { if (e.code !== "permission-denied" || attempt === 4) throw e; }
    }
    tick(tx("コード待ちの先生"));
  }
  // 4. クラス: 組織モデルに切りかえ（従来の参加の受け付けを止める）→ 担任 → 在籍
  for (const row of plan.classes) {
    const k = { id: row.cls.id, name: row.cls.name, schoolId: school.id };
    if (row.convert) await fs.updateDoc(fs.doc(db, "studyClasses", k.id), { orgModel: true, open: false, schoolName: String(school.name).slice(0, 60), updatedAt: stamp() });
    if (row.addTeacher) await org.enrollPeople(c, k, [row.teacher], "teacher");
    const todo = row.rows.filter((r) => !r.enrolled);
    if (todo.length) {
      const slots = new Map(todo.filter((r) => r.slotId).map((r) => [r.person.id, r.slotId]));
      await org.enrollPeople(c, k, todo.map((r) => r.person), "student", { slots });
    }
    tick(tx("クラス「{name}」", { name: k.name }));
  }
  return { ok: true, uid: user.uid };
}

// 結びつきずみのユーザーを作る書きこみは、まれにコードが重なって拒まれる（コード待ちの生徒の分）。コードを作り直してやり直す
async function commitWithRetry(batch, group, c, school) {
  try { await batch.commit(); return; } catch (e) {
    if (e.code !== "permission-denied") throw e;
  }
  const { fs, db } = c;
  for (let attempt = 0; attempt < 5; attempt++) {
    const b = fs.writeBatch(db);
    for (const p of group) {
      b.set(fs.doc(db, "studySchools", school.id, "people", p.id), {
        name: p.name, role: "student", claimedBy: p.claimedBy || null, ...(p.claimedBy ? { claimedAt: fs.serverTimestamp(), legacyClassId: p.legacyClassId } : {}),
        status: "active", createdAt: fs.serverTimestamp(), updatedAt: fs.serverTimestamp()
      });
      if (!p.claimedBy) org.setCodeOps(b, c, school, p.id, "student", p.name, org.newCode());
    }
    try { await b.commit(); return; } catch (e) { if (e.code !== "permission-denied" || attempt === 4) throw e; }
  }
}

// クラスを従来の方式に戻す（組織モデルの印を外し、従来の参加の受け付けを open にする）
export async function rollbackClass(c, cls, { open = false } = {}) {
  const { fs, db } = c;
  await fs.updateDoc(fs.doc(db, "studyClasses", cls.id), { orgModel: false, open: !!open, updatedAt: fs.serverTimestamp() });
}

// ---------- 本人のログイン時: 「入っている学校」の目印を作る ----------
//   従来のクラスに入っていた生徒・学校の先生は、移行のあと、最初にログインしたときに、自分のユーザーを探して accounts/{UID}/studyOrgs/{sid} を作る
//   戻り値: 作った学校の ID の配列
export async function adoptOrgLinks(c) {
  const { fs, db, user } = c;
  const [mine, classLinks, staffLinks] = await Promise.all([
    fs.getDocs(fs.collection(db, "accounts", user.uid, "studyOrgs")),
    fs.getDocs(fs.collection(db, "accounts", user.uid, "studyClasses")),
    fs.getDocs(fs.collection(db, "accounts", user.uid, "studyStaff"))
  ]);
  const schools = new Map(); // sid → { name, from: student / teacher }
  for (const d of staffLinks.docs) schools.set(d.id, { name: d.data().schoolName || "", from: "teacher" });
  await Promise.all(classLinks.docs.map(async (d) => {
    const cls = await fs.getDoc(fs.doc(db, "studyClasses", d.id)).catch(() => null);
    if (!cls || !cls.exists() || cls.data().orgModel !== true || !cls.data().schoolId) return;
    const sid = cls.data().schoolId;
    if (!schools.has(sid)) schools.set(sid, { name: cls.data().schoolName || "", from: "student" });
    else if (!schools.get(sid).name) schools.get(sid).name = cls.data().schoolName || "";
  }));
  const made = [];
  const linkOf = new Map(mine.docs.map((d) => [d.id, d.data()]));
  for (const [sid, info] of schools) {
    const snap = await fs.getDocs(fs.query(fs.collection(db, "studySchools", sid, "people"), fs.where("claimedBy", "==", user.uid))).catch(() => null);
    if (!snap || snap.empty) continue;
    const list = snap.docs.map(withId);
    const t = list.find((p) => p.role === "teacher");
    const st = list.find((p) => p.role === "student");
    const old = linkOf.get(sid) || null;
    // 先生と生徒の両方のとき、どちらの目印も持つ。主な役割（personId・role）は、すでにあればそのまま
    const oldT = org.linkPid(old, "teacher"), oldS = org.linkPid(old, "student");
    if (old && (!t || oldT === t.id) && (!st || oldS === st.id)) continue; // すでにそろっている
    const primary = old && old.personId ? { personId: old.personId, role: old.role } : (list.find((p) => p.role === info.from) || list[0]);
    const link = { schoolName: String(info.name || (old && old.schoolName) || "").slice(0, 60), personId: primary.personId || primary.id, role: primary.role, joinedAt: old && old.joinedAt ? old.joinedAt : fs.serverTimestamp() };
    if (t) link.teacherPid = t.id;
    if (st) link.studentPid = st.id;
    await fs.setDoc(fs.doc(db, "accounts", user.uid, "studyOrgs", sid), link);
    made.push(sid);
  }
  return made;
}
