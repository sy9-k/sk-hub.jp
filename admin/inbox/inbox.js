// お問い合わせ（/inbox/）。もとは /inbox/（そこからはここへ転送する）
// 届いたものは contacts。対応済みにすると expireAt（1 年後）が入る。期限を過ぎたものは自動の掃除（/shared/housekeeping.js）で消える
// アカウントでログインして送られたもの（uid がある）は、アカウントのお知らせ（accounts/{UID}/notices）で返事ができる
// 公式 LINE から来たもの（via: line・line-chat）は、LINE のトークに返事ができる（api.sk-hub.jp の /line/reply。プッシュなので月の無料枠を使う）
import {
  Timestamp, addDoc, collection, deleteDoc, deleteField, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  YEAR_MS, $, $$, badge, button, confirmDialog, copyText, db, el, empty, errorNote, explain, fmtDate, fmtDateTime, icon, logAction, me, num,
  setBadge, startAdmin, toast
} from "/shared/admin.js";
import { autoCleanup } from "/shared/housekeeping.js";

const KIND = { bug: "不具合の報告", question: "質問", request: "要望・アイデア", data: "データの確認・削除", other: "その他" };
const PRODUCT = { "y-filter": "Y-FILTER.", malu: "MALU", hub: "SK Hub Systems・管理コンソール", account: "SK Hub Systems アカウント", lab: "SK's Lab", site: "このサイト", other: "その他" };

const listEl = $("[data-inbox-list]");
const baseTitle = document.title;
let items = [];
let filter = "new";
const replyOpen = new Set(); // 返事の欄を開いているお問い合わせ
const lineOpen = new Set(); // LINE の返事の欄を開いているお問い合わせ
const LINE_API = "https://api.sk-hub.jp/line/reply";
const fromLine = (item) => item.via === "line" || item.via === "line-chat";
const drafts = {}; // 書きかけの返事（一覧は届くたびに描き直すので、ここに取っておく）

const receipt = (id) => id.slice(0, 8).toUpperCase();

function render() {
  const counts = { new: items.filter((i) => i.status !== "done").length, done: items.filter((i) => i.status === "done").length };
  $$("[data-inbox-count]").forEach((c) => { c.textContent = counts[c.dataset.inboxCount] ? num(counts[c.dataset.inboxCount]) : ""; });
  $$("[data-inbox-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.inboxFilter === filter)));
  document.title = counts.new ? `(${counts.new}) ${baseTitle}` : baseTitle;
  setBadge("inbox", counts.new);

  const shown = items.filter((i) => !filter || (filter === "done" ? i.status === "done" : i.status !== "done"));
  if (!shown.length) {
    listEl.replaceChildren(empty(filter === "new" ? "未対応のお問い合わせはありません。" : "お問い合わせはありません。", "inbox"));
    return;
  }
  listEl.replaceChildren(...shown.map(itemCard));
}

function itemCard(item) {
  const done = item.status === "done";
  const box = el("article", `ad-card${done ? " is-done" : ""}`);
  const meta = el("div", "ad-row");
  meta.append(
    done ? badge("対応済み", "ok") : badge("未対応", "error"),
    badge(KIND[item.kind] || item.kind, "info"),
    badge(PRODUCT[item.product] || item.product),
    el("span", "ad-hint", fmtDateTime(item.createdAt))
  );

  const info = el("dl", "ad-dl");
  const addInfo = (label, node) => { info.append(el("dt", null, label)); const dd = el("dd"); dd.append(node); info.append(dd); };
  addInfo("受付番号", el("code", "ad-mono", receipt(item.id)));
  if (item.email) {
    const a = el("a", null, item.email);
    a.href = `mailto:${encodeURIComponent(item.email)}?subject=${encodeURIComponent(`お問い合わせについて（受付番号 ${receipt(item.id)}）`)}`;
    addInfo("返信先", a);
  } else {
    addInfo("返信先", el("span", "ad-muted", "なし（返信不要）"));
  }
  if (item.supportId) {
    const a = el("a", "ad-mono", item.supportId);
    a.href = `/accounts/?sid=${encodeURIComponent(item.supportId)}`;
    a.title = "このサポート ID を調べる";
    addInfo("サポート ID", a);
  }
  if (item.userAgent) addInfo("ブラウザ", el("span", "ad-muted", `${item.userAgent}${item.language ? `（${item.language}）` : ""}`));
  if (done && item.handledAt) addInfo("対応", el("span", "ad-muted", `${fmtDate(item.handledAt)} に対応済み（${fmtDate(item.expireAt)} に自動で削除）`));
  if (item.uid) {
    const acct = el("span");
    const a = el("a", null, "アカウントを見る");
    a.href = `/accounts/?uid=${encodeURIComponent(item.uid)}`;
    acct.append(el("span", "ad-muted", item.repliedAt ? `${fmtDateTime(item.repliedAt)} にお知らせで返事済み・` : "アカウントのお知らせで返事できます・"), a);
    addInfo("アカウント", acct);
  }

  if (fromLine(item)) {
    addInfo("LINE", el("span", "ad-muted", item.via === "line-chat"
      ? "公式 LINE のチャットで相談中。LINE のトークに返事できます（LINE Official Account Manager のチャットからも返せます）"
      : "公式 LINE のトークから届きました。LINE のトークに返事できます"));
  }

  const actions = el("div", "ad-row");
  if (fromLine(item)) {
    actions.append(button("LINE で返事を送る", {
      iconName: "chat", small: true,
      onClick: () => { if (lineOpen.has(item.id)) lineOpen.delete(item.id); else lineOpen.add(item.id); render(); }
    }));
  }
  if (item.uid) {
    actions.append(button(item.repliedAt ? "もう一度返事を送る" : "アカウントに返事を送る", {
      iconName: "reply", small: true,
      onClick: () => { if (replyOpen.has(item.id)) replyOpen.delete(item.id); else replyOpen.add(item.id); render(); }
    }));
  } else if (item.email) {
    actions.append(button("メールアドレスをコピー", { kind: "m3-btn m3-btn--tonal", iconName: "content_copy", small: true, onClick: () => copyText(item.email) }));
  }
  const toggle = button(done ? "未対応に戻す" : "対応済みにする", { kind: "m3-btn m3-btn--tonal", iconName: done ? "undo" : "done", small: true });
  toggle.addEventListener("click", () => setDone(item, !done, toggle));
  const del = button("削除", { kind: "text-btn", iconName: "delete" });
  del.classList.add("ad-danger");
  del.addEventListener("click", async () => {
    const ok = await confirmDialog({ title: "削除しますか？", text: `受付番号 ${receipt(item.id)} を削除します。元に戻せません。`, ok: "削除", danger: true, icon: "delete" });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, "contacts", item.id));
      logAction("contact.delete", item.id, `受付番号 ${receipt(item.id)}`);
      toast("削除しました");
    } catch (err) { toast(explain(err)); }
  });
  actions.append(el("span", "ad-grow"), toggle, del);

  box.append(meta, el("p", "ad-msg", item.message || ""), info, actions);
  if (item.uid && replyOpen.has(item.id)) box.append(replyForm(item));
  if (fromLine(item) && lineOpen.has(item.id)) box.append(lineReplyForm(item));
  return box;
}

// LINE のトークに返事をする（api.sk-hub.jp が相手の LINE に送り、お問い合わせの中身にも【SK の返事】として足す）
//   「内容をまとめて送る」で来たもの（via: line）は、送ったら対応済みにする。チャットで相談中のもの（line-chat）は、続くので未対応のまま
function lineReplyForm(item) {
  const form = el("form", "ad-form");
  const field = el("label", "m3-field");
  const text = el("textarea");
  text.rows = 5;
  text.maxLength = 4000;
  text.required = true;
  text.value = drafts[`line:${item.id}`] || "";
  text.addEventListener("input", () => { drafts[`line:${item.id}`] = text.value; });
  field.append(el("span", "m3-field__label", "返事（相手の LINE のトークに届きます。公式 LINE の月の無料枠を 1 通使います）"), text);
  const send = button("LINE で送る", { iconName: "send", type: "submit" });
  const cancel = button("やめる", { kind: "text-btn", onClick: () => { lineOpen.delete(item.id); render(); } });
  const row = el("div", "ad-row ad-row--end");
  row.append(cancel, send);
  form.append(field, row);
  requestAnimationFrame(() => text.focus());

  const REASONS = {
    "not-from-line": "このお問い合わせは、LINE で返事をする仕組みができる前に届いたため、LINE では返せません。LINE Official Account Manager のチャットから返してください。",
    "not-friend": "相手が公式 LINE をブロックしているか、友だちではないため送れませんでした。",
    "not-developer": "開発者のアカウントでログインしてください。",
    "signed-out": "ログインし直してください。"
  };
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const bodyText = text.value.trim();
    if (!bodyText) return;
    send.disabled = true;
    send.classList.add("is-busy");
    try {
      const user = me();
      if (!user) throw Object.assign(new Error("signed-out"), { reason: "signed-out" });
      const res = await fetch(LINE_API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({ contactId: item.id, text: bodyText })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || "line-error"), { reason: data.error });
      delete drafts[`line:${item.id}`];
      lineOpen.delete(item.id);
      await updateDoc(doc(db, "contacts", item.id), item.via === "line-chat"
        ? { repliedAt: serverTimestamp() }
        : { repliedAt: serverTimestamp(), status: "done", handledAt: serverTimestamp(), expireAt: Timestamp.fromMillis(Date.now() + YEAR_MS) });
      logAction("contact.reply", item.id, `受付番号 ${receipt(item.id)}（LINE）`);
      toast("LINE で返事を送りました");
    } catch (err) {
      toast(REASONS[err.reason] || (err instanceof TypeError ? "api.sk-hub.jp に届きませんでした。インターネットの接続を確認してください。" : `送れませんでした（${err.message}）`));
      send.disabled = false;
      send.classList.remove("is-busy");
    }
  });
  return form;
}

// アカウントのお知らせで返事をする。送ったら対応済みにする
function replyForm(item) {
  const form = el("form", "ad-form");
  const field = el("label", "m3-field");
  const text = el("textarea");
  text.rows = 6;
  text.maxLength = 5000;
  text.required = true;
  text.value = drafts[item.id] || "";
  text.addEventListener("input", () => { drafts[item.id] = text.value; });
  field.append(el("span", "m3-field__label", "返事（相手のアカウントの「お知らせ」に届きます）"), text);
  const send = button("送信する", { iconName: "send", type: "submit" });
  const cancel = button("やめる", { kind: "text-btn", onClick: () => { replyOpen.delete(item.id); render(); } });
  const row = el("div", "ad-row ad-row--end");
  row.append(cancel, send);
  form.append(field, row);
  requestAnimationFrame(() => text.focus());

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const bodyText = text.value.trim();
    if (!bodyText) return;
    send.disabled = true;
    send.classList.add("is-busy");
    try {
      await addDoc(collection(db, "accounts", item.uid, "notices"), {
        kind: "reply",
        title: `お問い合わせ（受付番号 ${receipt(item.id)}）への返事`,
        body: bodyText,
        contactId: item.id,
        createdAt: serverTimestamp()
      });
      delete drafts[item.id];
      replyOpen.delete(item.id);
      await updateDoc(doc(db, "contacts", item.id), {
        repliedAt: serverTimestamp(),
        status: "done",
        handledAt: serverTimestamp(),
        expireAt: Timestamp.fromMillis(Date.now() + YEAR_MS)
      });
      logAction("contact.reply", item.id, `受付番号 ${receipt(item.id)}`);
      toast("返事を送りました");
    } catch (err) {
      toast(err.code === "permission-denied" ? "送れませんでした。相手のアカウントが削除されている可能性があります。" : explain(err));
      send.disabled = false;
      send.classList.remove("is-busy");
    }
  });
  return form;
}

async function setDone(item, isDone, btn) {
  btn.disabled = true;
  try {
    await updateDoc(doc(db, "contacts", item.id), isDone
      ? { status: "done", handledAt: serverTimestamp(), expireAt: Timestamp.fromMillis(Date.now() + YEAR_MS) }
      : { status: "new", handledAt: deleteField(), expireAt: deleteField() });
    logAction(isDone ? "contact.done" : "contact.reopen", item.id, `受付番号 ${receipt(item.id)}`);
  } catch (err) {
    toast(explain(err));
    btn.disabled = false;
  }
}

$$("[data-inbox-filter]").forEach((b) => b.addEventListener("click", () => { filter = b.dataset.inboxFilter; render(); }));

startAdmin({
  page: "inbox",
  onReady: () => {
    autoCleanup().then((done) => {
      if (!done || !done.total) return;
      const hint = $("[data-inbox-hint]");
      hint.replaceChildren(icon("cleaning_services"), el("span", null, `保存期間を過ぎたものを ${num(done.total)} 件削除しました。`));
      hint.hidden = false;
    }, () => {});
    return onSnapshot(
      query(collection(db, "contacts"), orderBy("createdAt", "desc"), limit(300)),
      (snap) => { items = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render(); },
      (err) => listEl.replaceChildren(errorNote(err))
    );
  }
});
