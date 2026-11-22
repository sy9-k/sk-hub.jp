// 招待と早期アクセス（/invites/）。SK Study・SK Office は、ここで招待した人（の Google アカウント）だけが開ける
//   招待 hub_invites/{メールアドレス（小文字）} = { products: ["study", "office"], createdAt, createdBy, mailedAt? }
//   早期アクセス hub_waitlist/{プロダクト}__{メールアドレス} = { product, email, createdAt }（/waiting/ から登録される）
//   権限は y-filter リポジトリの systems/firestore.rules（読み書きは開発者だけ。招待された本人は自分の分だけ読める）
//   招待すると、招待のメールを自動で送る（/api/invite-mail。_workers/admin/src/invite-mail.js。送れたら mailedAt を入れる）
import {
  collection, deleteDoc, doc, getDocs, limit, query, serverTimestamp, setDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  $, badge, busy, button, card, confirmDialog, db, el, empty, errorNote, explain, fmtDateTime, logAction, me, num, startAdmin, toMillis, toast
} from "/shared/admin.js";
import { INVITE_PRODUCTS, emailKey, validEmail } from "/assets/hub/invite.js";

const root = $("[data-page]");

// ---------- 招待のメール ----------
const MAIL_ERRORS = {
  "not-developer": "開発者のアカウントでログインしてください。",
  "signed-out": "ログインし直してください。",
  "not-invited": "招待が見つかりませんでした。",
  "mail-not-configured": "メールを送るしくみの設定（Resend の API キー）がまだです。_workers/admin/README.md の手順で設定してください。",
  "mail-failed": "メールを送れませんでした（Resend が断りました。送信元のドメインの確認・送れる数を確かめてください）。"
};
async function sendMail(email) {
  const user = me();
  if (!user) throw Object.assign(new Error("signed-out"), { reason: "signed-out" });
  let res;
  try {
    res = await fetch("/api/invite-mail", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` },
      body: JSON.stringify({ email })
    });
  } catch (err) {
    throw Object.assign(new Error("network"), { reason: "network" });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `http-${res.status}`), { reason: data.error });
  await updateDoc(doc(db, "hub_invites", email), { mailedAt: serverTimestamp() });
  logAction("invite.mail", email);
}
const mailError = (err) => MAIL_ERRORS[err.reason] || (err.reason === "network" ? "admin.sk-hub.jp に届きませんでした。インターネットの接続を確認してください。" : explain(err));

// 招待して、メールを送る。招待はできたのにメールが送れなかったときも、招待はそのまま（あとで「メールを送る」で送り直せる）
async function inviteAndMail(email, products) {
  const key = emailKey(email);
  await setDoc(doc(db, "hub_invites", key), { products, createdAt: serverTimestamp(), createdBy: me().uid });
  logAction("invite.add", key, productNames(products));
  try {
    await sendMail(key);
    toast("招待して、メールを送りました");
  } catch (err) {
    toast(`招待しました。ただし、${mailError(err)}`);
  }
  return key;
}

// ---------- 招待する ----------
const form = el("form", "ad-form");
const emailField = el("label", "m3-field");
const emailInput = el("input", "m3-field__input");
emailInput.type = "email";
emailInput.placeholder = "招待する人の Google アカウントのメールアドレス";
emailInput.autocomplete = "off";
emailInput.spellcheck = false;
emailField.append(el("span", "m3-field__label", "メールアドレス"), emailInput);
const checks = el("div", "ad-row");
const boxes = {};
Object.entries(INVITE_PRODUCTS).forEach(([key, name]) => {
  const label = el("label", "ad-check");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = key === "study";
  boxes[key] = box;
  label.append(box, document.createTextNode(` ${name}`));
  checks.append(label);
});
const addBtn = button("招待してメールを送る", { kind: "m3-btn", iconName: "person_add", type: "submit" });
const addRow = el("div", "ad-row ad-row--end");
addRow.append(addBtn);
form.append(emailField, checks, addRow, el("p", "ad-hint", "招待された人は、このメールアドレスの Google アカウントでログインしたときだけ開けます（Google 以外のログインでは開けません）。招待すると、使いはじめ方を書いたメールがこのアドレスに届きます。すでに招待している人は、選んだプロダクトに置きかわります。自分のアドレスも、ここで招待しておきます。"));

form.addEventListener("submit", (e) => {
  e.preventDefault();
  busy(addBtn, async () => {
    const email = emailKey(emailInput.value);
    const products = Object.keys(boxes).filter((k) => boxes[k].checked);
    if (!validEmail(email)) { toast("メールアドレスの形が違います"); emailInput.focus(); return; }
    if (!products.length) { toast("招待するプロダクトを 1 つ以上選んでください"); return; }
    try {
      await inviteAndMail(email, products);
      emailInput.value = "";
      loadInvites();
      loadWaitlist();
    } catch (err) { toast(explain(err)); }
  });
});

const productNames = (list) => (list || []).map((p) => (p === "*" ? "すべて" : INVITE_PRODUCTS[p] || p)).join("・");

function table(headers, rows) {
  const wrap = el("div", "ad-table-wrap");
  const t = el("table", "ad-table ad-table--stack");
  const hr = el("tr");
  headers.forEach((h) => hr.append(el("th", null, h)));
  const thead = el("thead");
  thead.append(hr);
  const tbody = el("tbody");
  rows.forEach((cells) => {
    const tr = el("tr");
    cells.forEach((c, i) => {
      const td = c instanceof Node ? c : el("td", null, String(c));
      if (headers[i]) td.dataset.label = headers[i];
      tr.append(td);
    });
    tbody.append(tr);
  });
  t.append(thead, tbody);
  wrap.append(t);
  return wrap;
}
const monoCell = (text) => el("td", "ad-mono", text);
function nodeCell(...nodes) {
  const td = el("td");
  td.append(...nodes);
  return td;
}

// ---------- 招待している人 ----------
const inviteBox = el("div");
let inviteDocs = [];
async function loadInvites() {
  try {
    const snap = await getDocs(query(collection(db, "hub_invites"), limit(500)));
    inviteDocs = snap.docs;
    if (snap.empty) { inviteBox.replaceChildren(empty("招待している人はいません。", "mail_lock")); return; }
    const unsent = snap.docs.filter((d) => !d.data().mailedAt).length;
    const rows = snap.docs
      .slice()
      .sort((a, b) => (toMillis(b.data().createdAt) || 0) - (toMillis(a.data().createdAt) || 0))
      .map((d) => {
        const x = d.data();
        return [
          monoCell(d.id),
          productNames(x.products),
          x.createdAt ? fmtDateTime(x.createdAt) : "-",
          x.mailedAt ? fmtDateTime(x.mailedAt) : nodeCell(badge("まだ送っていません", "warn")),
          nodeCell(
            button(x.mailedAt ? "送り直す" : "メールを送る", { kind: "text-btn", iconName: "forward_to_inbox", onClick: async (e) => {
              const btn = e.currentTarget;
              if (x.mailedAt && !(await confirmDialog({ title: "招待のメールを送り直しますか？", text: d.id, ok: "送る", icon: "forward_to_inbox" }))) return;
              busy(btn, async () => {
                try { await sendMail(d.id); toast("メールを送りました"); loadInvites(); } catch (err) { toast(mailError(err)); }
              });
            } }),
            button("取り消す", { kind: "text-btn", iconName: "person_remove", onClick: async () => {
              if (!(await confirmDialog({ title: "招待を取り消しますか？", text: `${d.id}。取り消すと、すぐに SK Study・SK Office を開けなくなります（クラスのデータも読めなくなります）。お知らせのメールは送りません。`, ok: "取り消す", icon: "person_remove" }))) return;
              try { await deleteDoc(d.ref); logAction("invite.remove", d.id, productNames(x.products)); toast("取り消しました"); loadInvites(); } catch (err) { toast(explain(err)); }
            } })
          )
        ];
      });
    inviteBox.replaceChildren(
      el("p", "ad-hint", `${num(snap.size)} 人${unsent ? `（メールをまだ送っていない人 ${num(unsent)} 人）` : ""}`),
      table(["メールアドレス", "プロダクト", "招待した日", "メール", ""], rows)
    );
  } catch (err) {
    inviteBox.replaceChildren(errorNote(err));
  }
}

// ---------- 早期アクセス ----------
const waitBox = el("div");
async function loadWaitlist() {
  try {
    const snap = await getDocs(query(collection(db, "hub_waitlist"), limit(500)));
    if (snap.empty) { waitBox.replaceChildren(empty("早期アクセスの人はいません。", "hourglass_empty")); return; }
    const rows = snap.docs
      .slice()
      .sort((a, b) => (toMillis(a.data().createdAt) || 0) - (toMillis(b.data().createdAt) || 0))
      .map((d, i) => {
        const x = d.data();
        const name = INVITE_PRODUCTS[x.product] || x.product || "";
        return [
          String(i + 1),
          monoCell(x.email || d.id),
          name,
          x.createdAt ? fmtDateTime(x.createdAt) : "-",
          nodeCell(
            button("招待する", { kind: "text-btn", iconName: "person_add", onClick: async (e) => {
              const btn = e.currentTarget;
              if (!(await confirmDialog({ title: "この人を招待しますか？", text: `${x.email}（${name}）。招待のメールが、このアドレスに届きます。`, ok: "招待する", icon: "person_add" }))) return;
              busy(btn, async () => {
                try {
                  // すでに招待している人には、プロダクトを足す
                  const key = emailKey(x.email);
                  const cur = inviteDocs.find((v) => v.id === key);
                  const products = Array.from(new Set([...(cur ? cur.data().products || [] : []), x.product]));
                  await inviteAndMail(x.email, products);
                  await deleteDoc(d.ref);
                  loadInvites();
                  loadWaitlist();
                } catch (err) { toast(explain(err)); }
              });
            } }),
            button("削除", { kind: "text-btn", iconName: "delete", onClick: async () => {
              if (!(await confirmDialog({ title: "早期アクセスから消しますか？", text: x.email, ok: "消す", icon: "delete" }))) return;
              try { await deleteDoc(d.ref); logAction("waitlist.remove", x.email, name); toast("消しました"); loadWaitlist(); } catch (err) { toast(explain(err)); }
            } })
          )
        ];
      });
    waitBox.replaceChildren(el("p", "ad-hint", `${num(snap.size)} 人（登録の早い順）`), table(["順", "メールアドレス", "プロダクト", "登録した日", ""], rows));
  } catch (err) {
    waitBox.replaceChildren(errorNote(err));
  }
}

root.append(
  card("person_add", "招待する", form),
  card("mail_lock", "招待している人", inviteBox),
  card("hourglass_top", "早期アクセス", waitBox)
);

startAdmin({
  page: "invites",
  onReady: () => { loadInvites(); loadWaitlist(); }
});
