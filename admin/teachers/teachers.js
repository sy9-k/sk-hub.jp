// SK Study の指導者（/teachers/）。開発者だけ
//   申し込み studyTeacherApps/{UID}（pending / approved / rejected）を確かめ、承認すると studyTeachers/{UID} を作る
//   承認・却下・取り消しは、本人のアカウントの「お知らせ」（accounts/{UID}/notices、kind: info）でも知らせる
//   データの形と権限は y-filter リポジトリの systems/firestore.rules の「SK Study」
import {
  collection, doc, getDocs, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  $, badge, busy, button, card, confirmDialog, db, el, empty, errorNote, fmtDateTime, listItem, logAction, note, promptDialog, startAdmin, toast
} from "/shared/admin.js";

const root = $("[data-page]");
const STATUS = { pending: ["確認待ち", "warn"], approved: ["承認ずみ", "ok"], rejected: ["却下", ""] };

function noticeRef(batch, uid, title, body) {
  batch.set(doc(collection(db, "accounts", uid, "notices")), { kind: "info", title, body, createdAt: serverTimestamp() });
}

async function load() {
  root.replaceChildren(note("読み込み中…"));
  let apps, teachers;
  try {
    [apps, teachers] = await Promise.all([getDocs(collection(db, "studyTeacherApps")), getDocs(collection(db, "studyTeachers"))]);
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

  root.replaceChildren(
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
