// SK Study の指導者（/teachers/）。開発者だけ
//   申し込み studyTeacherApps/{UID}（pending / approved / rejected）を確かめ、承認すると studyTeachers/{UID} を作る
//   承認・却下・取り消しは、本人のアカウントの「お知らせ」（accounts/{UID}/notices、kind: info）でも知らせる
//   データの形と権限は y-filter リポジトリの systems/firestore.rules の「SK Study」
import {
  collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  $, badge, busy, button, card, confirmDialog, db, el, empty, errorNote, fmtDateTime, listItem, logAction, note, promptDialog, startAdmin, toast
} from "/shared/admin.js";

const root = $("[data-page]");
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 見まちがえやすい I・O・0・1 は使わない
const newCode = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
const STATUS = { pending: ["確認待ち", "warn"], approved: ["承認ずみ", "ok"], rejected: ["却下", ""] };

function noticeRef(batch, uid, title, body) {
  batch.set(doc(collection(db, "accounts", uid, "notices")), { kind: "info", title, body, createdAt: serverTimestamp() });
}

async function load() {
  root.replaceChildren(note("読み込み中…"));
  let apps, teachers, admins, codes;
  try {
    [apps, teachers, admins, codes] = await Promise.all([getDocs(collection(db, "studyTeacherApps")), getDocs(collection(db, "studyTeachers")), getDocs(collection(db, "studyAdmins")), getDocs(collection(db, "studyStaffCodes"))]);
  } catch (err) {
    root.replaceChildren(errorNote(err));
    return;
  }
  const order = { pending: 0, rejected: 1, approved: 2 };
  const list = apps.docs.map((d) => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
  const pending = list.filter((a) => a.status === "pending");

  const appList = el("ul", "ad-list");
  if (!list.length) appList.append(empty("申し込みはまだありません。", "school"));
  for (const a of list) {
    const [label, kind] = STATUS[a.status] || [a.status, ""];
    const sub = el("span", "ad-li__sub");
    sub.append(document.createTextNode(`${a.org || "（所属なし）"} ・ ${fmtDateTime(a.createdAt)} ・ UID ${a.uid}`));
    if (a.purpose) { sub.append(document.createElement("br"), document.createTextNode(`使い方: ${a.purpose}`)); }
    if (a.note) { sub.append(document.createElement("br"), document.createTextNode(`メモ: ${a.note}`)); }
    const end = [badge(label, kind)];
    if (a.status !== "approved") {
      const ok = button("承認", { iconName: "check", small: true });
      ok.addEventListener("click", () => busy(ok, () => approve(a)));
      end.push(ok);
    }
    if (a.status === "pending") {
      const ng = button("却下", { kind: "text-btn", iconName: "close", small: true });
      ng.addEventListener("click", () => busy(ng, () => reject(a)));
      end.push(ng);
    }
    appList.append(listItem({ iconName: "person", title: a.name, sub, end }));
  }

  const tList = el("ul", "ad-list");
  if (!teachers.size) tList.append(empty("まだ指導者はいません。", "school"));
  for (const d of teachers.docs) {
    const t = d.data();
    const rm = button("取り消す", { kind: "text-btn", iconName: "person_remove", small: true });
    rm.addEventListener("click", () => busy(rm, () => revoke(d.id, t)));
    tList.append(listItem({ iconName: "school", title: t.name, sub: `${t.org || "（所属なし）"} ・ ${fmtDateTime(t.approvedAt)} に承認 ・ UID ${d.id}`, end: [rm] }));
  }

  // 総合管理者（学校を作り、先生にコードを配う人）。ここでコードを作って渡す
  const adminCodes = codes.docs.map((d) => ({ code: d.id, ...d.data() })).filter((c) => c.role === "admin" && !c.claimedBy);
  const aList = el("ul", "ad-list");
  if (!admins.size && !adminCodes.length) aList.append(empty("まだ総合管理者はいません。", "admin_panel_settings"));
  for (const c of adminCodes) {
    const copy = button("コピー", { kind: "text-btn", iconName: "content_copy", small: true });
    copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(c.code); toast("コピーしました"); } catch (e) { toast("コピーできませんでした"); } });
    const pdf = button("案内 PDF", { kind: "text-btn", iconName: "picture_as_pdf", small: true });
    pdf.addEventListener("click", () => sheet([c]));
    const del = button("取り消す", { kind: "text-btn", iconName: "delete", small: true });
    del.addEventListener("click", () => busy(del, async () => { await deleteDoc(doc(db, "studyStaffCodes", c.code)); toast("取り消しました"); load(); }));
    aList.append(listItem({ iconName: "key", title: c.name, sub: `コード ${c.code} ・ ${fmtDateTime(c.createdAt)} に作成 ・ まだ使われていません`, end: [badge("コード待ち", "warn"), copy, pdf, del] }));
  }
  for (const d of admins.docs) {
    const a = d.data();
    const rm = button("取り消す", { kind: "text-btn", iconName: "person_remove", small: true });
    rm.addEventListener("click", () => busy(rm, () => revokeAdmin(d.id, a)));
    aList.append(listItem({ iconName: "admin_panel_settings", title: a.name, sub: `${fmtDateTime(a.createdAt)} に参加 ・ UID ${d.id}`, end: [rm] }));
  }
  const sheet = async (list) => {
    if (!list.length) { toast("コード待ちの総合管理者がいません"); return; }
    const { openInviteSheet } = await import("/study/invite-pdf.js");
    if (!openInviteSheet({ kind: "admin", orgName: "SK Study の総合管理者", items: list.map((c) => ({ name: c.name, code: c.code })) })) toast("案内を開けませんでした。ポップアップを許可してください");
  };
  const allSheet = button("案内 PDF（コード待ちの全員）", { kind: "text-btn", iconName: "picture_as_pdf" });
  allSheet.addEventListener("click", () => sheet(adminCodes));
  const issue = button("総合管理者のコードを作る", { iconName: "add" });
  issue.addEventListener("click", () => busy(issue, issueAdminCode));

  root.replaceChildren(
    card("admin_panel_settings", `総合管理者（${admins.size}）`,
      note("総合管理者は、学校を作り、先生にコードを配れます。自分の学校のクラスの生徒・提出も見られます。ここで名前ごとにコードを作って渡してください（コードは 1 回だけ使えます）。"),
      issue, allSheet, aList),
    card("how_to_reg", `申し込み（確認待ち ${pending.length}）`,
      note("指導者は、自分のクラスの生徒の名前・答え・点数・試験の記録を見られます。所属や使い方を確かめてから承認してください。"),
      appList),
    card("school", `指導者（${teachers.size}）`,
      note("取り消すと、その人はクラスを作る・配信する・結果を見ることができなくなります（作ったクラスと生徒の提出は残ります）。"),
      tList));
}

async function approve(a) {
  const ok = await confirmDialog({ title: `${a.name} さんを指導者として承認しますか？`, text: "クラスを作って、生徒の答えを預かれるようになります。", ok: "承認する" });
  if (!ok) return;
  try {
    const b = writeBatch(db);
    b.set(doc(db, "studyTeachers", a.uid), { name: String(a.name).slice(0, 40), org: String(a.org || "").slice(0, 80), approvedAt: serverTimestamp(), approvedBy: currentUid });
    b.update(doc(db, "studyTeacherApps", a.uid), { status: "approved", decidedAt: serverTimestamp() });
    noticeRef(b, a.uid, "SK Study の指導者になりました", "申し込みを承認しました。SK Study（https://sk-hub.jp/study/#/teach）の指導者メニューから、クラスを作って生徒を招待できます。");
    await b.commit();
    await logAction("teacher.approve", a.uid, a.name);
    toast("承認しました");
  } catch (err) {
    root.prepend(errorNote(err));
  }
  load();
}

async function issueAdminCode() {
  const name = await promptDialog({ title: "総合管理者のコードを作ります", label: "総合管理者の名前", placeholder: "例: 山田 太郎", ok: "作る", maxLength: 40 });
  if (!name || !name.trim()) return;
  for (let i = 0; i < 5; i++) {
    try {
      await setDoc(doc(db, "studyStaffCodes", newCode()), { role: "admin", name: name.trim().slice(0, 40), ownerUid: currentUid, claimedBy: null, createdAt: serverTimestamp() });
      await logAction("studyadmin.code", currentUid, name.trim());
      toast("コードを作りました");
      load();
      return;
    } catch (err) {
      if (err.code !== "permission-denied") { root.prepend(errorNote(err)); return; }
    }
  }
  root.prepend(errorNote(new Error("コードを作れませんでした。もう一度ためしてください。")));
}

async function revokeAdmin(uid, a) {
  const ok = await confirmDialog({ title: `${a.name} さんの総合管理者を取り消しますか？`, text: "学校を作る・先生のコードを配ることができなくなります。作った学校とクラスは残ります。", ok: "取り消す" });
  if (!ok) return;
  try {
    await deleteDoc(doc(db, "studyAdmins", uid));
    await logAction("studyadmin.revoke", uid, a.name);
    toast("取り消しました");
  } catch (err) {
    root.prepend(errorNote(err));
  }
  load();
}

async function reject(a) {
  const reason = await promptDialog({ title: "申し込みを却下します", label: "本人に伝える理由（空でもよい）", placeholder: "例: 所属が確かめられませんでした", ok: "却下する", maxLength: 300 });
  if (reason === null) return;
  try {
    const b = writeBatch(db);
    b.update(doc(db, "studyTeacherApps", a.uid), { status: "rejected", decidedAt: serverTimestamp(), note: String(reason).slice(0, 500) });
    noticeRef(b, a.uid, "SK Study の指導者の申し込みについて", `申し込みは承認されませんでした。${reason ? `理由: ${reason}` : ""}内容を見直して、もう一度申し込めます。`);
    await b.commit();
    await logAction("teacher.reject", a.uid, reason);
    toast("却下しました");
  } catch (err) {
    root.prepend(errorNote(err));
  }
  load();
}

async function revoke(uid, t) {
  const ok = await confirmDialog({ title: `${t.name} さんの指導者を取り消しますか？`, text: "クラスを作る・配信する・結果を見ることができなくなります。作ったクラスと生徒の提出は残ります。", ok: "取り消す" });
  if (!ok) return;
  try {
    const b = writeBatch(db);
    b.delete(doc(db, "studyTeachers", uid));
    // 申し込みは「却下」にしておく（もう一度申し込めるように）
    b.set(doc(db, "studyTeacherApps", uid), { status: "rejected", decidedAt: serverTimestamp(), note: "指導者を取り消しました" }, { merge: true });
    await b.commit();
    await logAction("teacher.revoke", uid, t.name);
    toast("取り消しました");
  } catch (err) {
    root.prepend(errorNote(err));
  }
  load();
}

let currentUid = "";
startAdmin({
  page: "teachers",
  onReady: ({ user }) => {
    currentUid = user.uid;
    load();
  }
});
