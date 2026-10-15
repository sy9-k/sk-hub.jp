// お知らせを送る（/notices/）。SK Hub Systems アカウントの「お知らせ」（accounts/{UID}/notices、kind: info）に届ける
//   送り先: UID を指定 / 全員 / サービスに接続している人（Y-FILTER.・MALU・Nagi）
//   まとめて送るときは accounts を一覧して、ブラウザで絞り込む（人数が少ないうちはこれで足りる）
//   送ったことは操作の記録（adminLogs）に残る。送ったお知らせの一覧はここには出さない（本人のアカウントにだけある）
import {
  collection, doc, getDocs, limit, orderBy, query, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  $, LOG_LABEL, busy, button, card, confirmDialog, db, el, empty, errorNote, explain, fmtAgo, listItem, logAction, note, num, startAdmin, toast
} from "/shared/admin.js";

const TITLE_MAX = 120;
const BODY_MAX = 5000;
const TARGETS = [
  { value: "uids", label: "UID を指定", icon: "person" },
  { value: "all", label: "全員", icon: "groups" },
  { value: "yfilter", label: "Y-FILTER. に接続している人", icon: "shield" },
  { value: "malu", label: "MALU に接続している人", icon: "menu_book" },
  { value: "nagi", label: "Nagi に接続している人", icon: "self_improvement" }
];

const root = $("[data-page]");
let target = "uids";

const form = el("form", "ad-form");
const chips = el("div", "ad-tabs");
chips.setAttribute("role", "radiogroup");
chips.setAttribute("aria-label", "送り先");
const uidField = el("label", "m3-field");
const uidInput = el("textarea");
uidInput.rows = 3;
uidInput.placeholder = "UID を 1 行に 1 つ（お問い合わせやアカウントを探すから開くと入ります）";
uidField.append(el("span", "m3-field__label", "送り先の UID"), uidInput);
const countHint = el("p", "ad-hint");
const titleField = el("label", "m3-field");
const titleInput = el("input", "m3-field__input");
titleInput.maxLength = TITLE_MAX;
titleInput.required = true;
titleInput.placeholder = "例: Y-FILTER. の新しいバージョンについて";
titleField.append(el("span", "m3-field__label", `タイトル（${TITLE_MAX} 文字まで）`), titleInput);
const bodyField = el("label", "m3-field");
const bodyInput = el("textarea");
bodyInput.rows = 8;
bodyInput.maxLength = BODY_MAX;
bodyInput.required = true;
bodyField.append(el("span", "m3-field__label", `本文（${BODY_MAX} 文字まで）`), bodyInput);
const send = button("送る", { iconName: "send", type: "submit" });
const countBtn = button("人数を数える", { kind: "text-btn", iconName: "calculate" });
const actions = el("div", "ad-row ad-row--end");
actions.append(countBtn, send);

TARGETS.forEach((t) => {
  const b = el("button", "tbs-chip m3-state");
  b.type = "button";
  b.dataset.target = t.value;
  b.setAttribute("role", "radio");
  b.append(el("span", "msr", t.icon), document.createTextNode(t.label));
  b.firstChild.setAttribute("aria-hidden", "true");
  b.addEventListener("click", () => { target = t.value; syncTarget(); });
  chips.append(b);
});
function syncTarget() {
  chips.querySelectorAll("[data-target]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.target === target));
    b.setAttribute("aria-checked", String(b.dataset.target === target));
  });
  uidField.hidden = target !== "uids";
  countBtn.hidden = target === "uids";
  countHint.textContent = target === "uids" ? "" : "「人数を数える」で、送る前に人数を確かめられます。";
}

form.append(chips, uidField, countHint, titleField, bodyField, actions);
const history = el("ul", "ad-list");

// 送り先の UID を集める
async function recipients() {
  if (target === "uids") {
    return [...new Set(uidInput.value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];
  }
  const snap = await getDocs(collection(db, "accounts"));
  return snap.docs.filter((d) => target === "all" || ((d.data().services || {})[target])).map((d) => d.id);
}

countBtn.addEventListener("click", () => busy(countBtn, async () => {
  try {
    const list = await recipients();
    countHint.textContent = `いま送ると ${num(list.length)} 人に届きます。`;
  } catch (err) {
    countHint.textContent = explain(err);
  }
}));

form.addEventListener("submit", (e) => {
  e.preventDefault();
  busy(send, async () => {
    const title = titleInput.value.trim();
    const body = bodyInput.value.trim();
    if (!title) { toast("タイトルを入れてください"); titleInput.focus(); return; }
    if (!body) { toast("本文を入れてください"); bodyInput.focus(); return; }
    let list;
    try { list = await recipients(); } catch (err) { toast(explain(err)); return; }
    if (!list.length) { toast(target === "uids" ? "UID を入れてください" : "送り先が 0 人です"); return; }
    const label = TARGETS.find((t) => t.value === target).label;
    const ok = await confirmDialog({
      title: `${num(list.length)} 人に送りますか？`,
      text: `送り先: ${label}。「${title}」は、相手が消すまで残ります（ここからは取り消せません）。`,
      ok: "送る", icon: "send"
    });
    if (!ok) return;
    let sent = 0;
    const failed = [];
    // 1 回の書き込みは 400 件まで。アカウントがない UID はルールで断られるので、その組だけ 1 件ずつ送り直す
    for (let i = 0; i < list.length; i += 400) {
      const chunk = list.slice(i, i + 400);
      const write = async (uids) => {
        const batch = writeBatch(db);
        uids.forEach((uid) => batch.set(doc(collection(db, "accounts", uid, "notices")), { kind: "info", title, body, createdAt: serverTimestamp() }));
        await batch.commit();
      };
      try {
        await write(chunk);
        sent += chunk.length;
      } catch (err) {
        for (const uid of chunk) {
          try { await write([uid]); sent += 1; } catch (e) { failed.push(uid); }
        }
      }
    }
    logAction(list.length > 1 || target !== "uids" ? "notice.broadcast" : "notice.send", target === "uids" ? list.slice(0, 5).join(",") : target, `「${title}」${num(sent)} 人`);
    if (failed.length) toast(`${num(sent)} 人に送りました。${num(failed.length)} 人には送れませんでした（アカウントがないか、ルールの反映が必要です）`);
    else toast(`${num(sent)} 人に送りました`);
    if (sent) { titleInput.value = ""; bodyInput.value = ""; }
    loadHistory();
  });
});

async function loadHistory() {
  try {
    const snap = await getDocs(query(collection(db, "adminLogs"), orderBy("createdAt", "desc"), limit(200)));
    const rows = snap.docs.map((d) => d.data()).filter((x) => x.action === "notice.send" || x.action === "notice.broadcast" || x.action === "contact.reply").slice(0, 15);
    if (!rows.length) { history.replaceChildren(empty("まだ送っていません。", "campaign")); return; }
    history.replaceChildren(...rows.map((x) => listItem({ iconName: x.action === "contact.reply" ? "reply" : "campaign", title: x.detail || LOG_LABEL[x.action], sub: `${LOG_LABEL[x.action]}・${fmtAgo(x.createdAt)}` })));
  } catch (err) {
    history.replaceChildren(errorNote(err));
  }
}

root.append(
  note("お知らせは本人のアカウントのページ（sk-hub.jp/account/ の「お知らせ」）と、ヘッダーの未読の印に出ます。メールは送りません。"),
  card("edit", "新しいお知らせ", form),
  card("history", "最近送ったもの", history)
);

startAdmin({
  page: "notices",
  onReady: () => {
    const params = new URLSearchParams(location.search);
    if (params.get("uid")) { target = "uids"; uidInput.value = params.get("uid"); }
    syncTarget();
    loadHistory();
  }
});
