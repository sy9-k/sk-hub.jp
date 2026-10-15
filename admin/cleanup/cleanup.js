// 期限切れの掃除（/cleanup/）。消すものの一覧は /shared/housekeeping.js の TASKS
//   開くと全部の数を数える（ドキュメントは読まない）。消すときは確認してから
import {
  $, badge, busy, button, card, confirmDialog, el, explain, listItem, logAction, note, num, startAdmin, toast
} from "/shared/admin.js";
import { TASKS, countTask, runTask } from "/shared/housekeeping.js";

const root = $("[data-page]");
const list = el("ul", "ad-list");
const rows = new Map();

TASKS.forEach((task) => {
  const count = badge("…");
  const run = button("消す", { kind: task.danger ? "m3-btn ad-danger-btn" : "m3-btn m3-btn--tonal", iconName: "delete_sweep", small: true });
  run.disabled = true;
  const sub = el("span", "ad-li__sub", `${task.desc}${task.auto ? "（自動でも消えます）" : ""}`);
  const li = listItem({ iconName: task.icon, title: task.label, sub, end: [count, run] });
  list.append(li);
  rows.set(task.id, { task, count, run, li });
  run.addEventListener("click", () => busy(run, async () => {
    const ok = await confirmDialog({
      title: `${task.label}を消しますか？`,
      text: `${task.desc} 元に戻せません。`,
      ok: "消す", danger: true, icon: "delete_sweep"
    });
    if (!ok) return;
    try {
      const n = await runTask(task);
      logAction("cleanup.run", task.id, `${task.label} ${n} 件`);
      toast(`${num(n)} 件消しました`);
    } catch (err) {
      toast(explain(err));
    }
    refresh(task.id);
  }));
});

async function refresh(id) {
  const r = rows.get(id);
  r.count.replaceWith((r.count = badge("…")));
  r.run.disabled = true;
  try {
    const n = await countTask(r.task);
    const b = badge(n ? `${num(n)} 件` : "なし", n ? "warn" : "ok");
    r.count.replaceWith(b);
    r.count = b;
    r.run.disabled = !n;
  } catch (err) {
    const b = badge(err.code === "permission-denied" ? "権限なし" : "数えられません", "error");
    b.title = explain(err);
    r.count.replaceWith(b);
    r.count = b;
  }
}

const recount = button("数え直す", { kind: "m3-btn m3-btn--tonal", iconName: "refresh", small: true, onClick: () => TASKS.forEach((t) => refresh(t.id)) });
const head = el("div", "ad-row ad-row--end");
head.append(recount);

const manual = el("div", "ad-stack");
manual.append(
  el("p", "ad-hint", "2 年以上ログインのないアカウント（アカウント規約 第五条4）は、ログインの日時が Firebase Authentication にしかないため、ここからは数えられません。次の順に、Firebase コンソールで行います。"),
  (() => {
    const ol = el("ol", "ad-hint");
    [
      "Authentication →「ユーザー」で「ログイン日時」の古い順に並べ、2 年以上前のユーザーの UID を控える",
      "管理画面の「アカウントを探す」でその UID を調べ、管理グループ・端末を確かめる",
      "Firestore で accounts/<UID>（と、その下の notices・maluWords・malu・nagi）と、持ち主の管理グループ（teams/<UID>・ownerUid が同じ devices・requests・pairingCodes）を消す",
      "Authentication のユーザーを削除する"
    ].forEach((s) => ol.append(el("li", null, s)));
    return ol;
  })()
);
const consoleLink = el("a", "m3-btn m3-btn--tonal m3-state ad-btn-sm", "Firebase コンソール（Authentication）");
consoleLink.href = "https://console.firebase.google.com/project/y-filter-systems/authentication/users";
consoleLink.target = "_blank";
consoleLink.rel = "noopener";
const linkRow = el("div", "ad-row");
linkRow.append(consoleLink);
manual.append(linkRow);

root.append(
  note("Firestore の自動削除（TTL）は有料プランが必要なので、ここで消します。数えるだけなら、データは読みません。"),
  card("cleaning_services", "消せるもの", head, list),
  card("person_off", "2 年以上ログインのないアカウント", manual)
);

startAdmin({ page: "cleanup", onReady: () => TASKS.forEach((t) => refresh(t.id)) });
