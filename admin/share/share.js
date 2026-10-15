// SK Share の管理（/share/）。もとは /view/editor/（そこからはここへ転送する）
// データの形は /view/view-core.js。保存すると sk-hub.jp/view/ ですぐ見られる
//   ・ページの ID はパスワードから作るので、パスワードを変える = 新しい ID に中身ごと移して、前の ID を消す（1 回の書き込みでまとめて）
//   ・パスワードは private/admin に入れておく（開発者だけが読める）。配るときの URL・QR を作り直せるように
import {
  Timestamp, collection, doc, getDoc, onSnapshot, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { NEW_ORIGIN, confirmDialog, db, explain, logAction, startAdmin, toast } from "/shared/admin.js";
import {
  HTML_MAX, ITEMS_MAX, NOTE_MAX, PAGES, PASSWORD_MAX, PASSWORD_MIN, TITLE_MAX,
  DRIVE_KINDS, driveOf, driveOpenUrl, generatePassword, makeHtmlFrame, normalizePassword, pageIdOf, randomId, youtubeIdOf
} from "/view/view-core.js";

const $ = (sel) => document.querySelector(sel);
const el = (tag, className, text) => {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
};
const icon = (name) => { const s = el("span", "msr", name); s.setAttribute("aria-hidden", "true"); return s; };
const iconBtn = (name, label) => {
  const b = el("button", "icon-btn m3-state");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.title = label;
  b.append(icon(name));
  return b;
};
const bytesOf = (s) => new TextEncoder().encode(s).length;
const kb = (n) => `${Math.max(1, Math.round(n / 1024)).toLocaleString()}KB`;

// 一覧と編集を切りかえる幅（share.css の @media と同じ）
const NARROW = "(max-width: 1080px)";
const main = $("[data-ve-main]");
const form = $("[data-ve-form]");
const itemsEl = $("[data-ve-items]");
const fileInput = $("[data-ve-file]");

let pages = [];        // 一覧（viewPages）
let current = null;    // 編集中 { id, createdAt, items: [...], oldDocIds: [...] }。新しいページは id = null
let dirty = false;
let saving = false;
let fileTarget = null; // HTML ファイルを選んでいる中身

async function okToLeave() {
  if (!dirty) return true;
  return confirmDialog({ title: "保存していない変更があります", text: "変更を捨てて移りますか？", ok: "捨てる", danger: true, icon: "edit_off" });
}

// ---------- 一覧 ----------
function statusOf(p) {
  if (!p.enabled) return "off";
  if (p.expiresAt && p.expiresAt.toMillis() < Date.now()) return "expired";
  return "on";
}
const STATUS_LABEL = { on: "公開中", off: "停止中", expired: "期限切れ" };
const dateText = (ts) => (ts && ts.toDate ? ts.toDate().toLocaleDateString("ja-JP", { year: "numeric", month: "short", day: "numeric" }) : "");

function renderList() {
  const list = $("[data-ve-list]");
  const sorted = [...pages].sort((a, b) => (b.updatedAt ? b.updatedAt.toMillis() : Infinity) - (a.updatedAt ? a.updatedAt.toMillis() : Infinity));
  $("[data-ve-count]").textContent = pages.length ? `${pages.length} 件` : "";
  $("[data-ve-empty]").hidden = pages.length > 0;
  list.replaceChildren(...sorted.map((p) => {
    const status = statusOf(p);
    const b = el("button", "ve-li m3-state");
    b.type = "button";
    b.setAttribute("role", "listitem");
    if (current && current.id === p.id) b.setAttribute("aria-current", "true");
    const ico = el("span", `ve-li__icon${status === "on" ? " is-on" : ""}`);
    ico.append(icon(status === "on" ? "lock_open" : "lock"));
    const text = el("span", "ve-li__text");
    const sub = el("span", "ve-li__sub");
    const count = Array.isArray(p.items) ? p.items.length : 0;
    sub.append(el("span", `ve-badge ve-badge--${status}`, STATUS_LABEL[status]), document.createTextNode(
      [`${count} 件`, p.expiresAt ? `${dateText(p.expiresAt)} まで` : "", dateText(p.updatedAt) ? `更新 ${dateText(p.updatedAt)}` : ""].filter(Boolean).join(" · ")
    ));
    text.append(el("span", "ve-li__title", p.title || "（タイトルなし）"), sub);
    b.append(ico, text);
    b.addEventListener("click", async () => { if (current && current.id === p.id) { setEditing(true); return; } if (await okToLeave()) openPage(p.id); });
    return b;
  }));
}

// ---------- 編集 ----------
function setEditing(on) {
  main.classList.toggle("is-editing", on);
  $("[data-ve-back]").hidden = !on || !matchMedia(NARROW).matches;
  form.hidden = !current;
  $("[data-ve-placeholder]").hidden = !!current;
}

function blankItem(type) {
  if (type === "youtube") return { type, title: "", url: "", videoId: "" };
  if (type === "drive") return { type, title: "", url: "", kind: "", driveId: "" };
  return { type, title: "", docId: randomId(), html: "", fileName: "", changed: true };
}
// 中身の種類ごとのタイトルの欄
const ITEM_TITLE = {
  youtube: ["動画のタイトル", "例: 開会式"],
  html: ["文書のタイトル", "例: 当日のプログラム"],
  drive: ["ファイルのタイトル", "例: 学年通信 10 月号"]
};

function newPage() {
  current = { id: null, createdAt: null, items: [], oldDocIds: [], password: generatePassword() };
  fillForm({ title: "", note: "", enabled: true, expiresAt: null, memo: "" });
  $("[data-ve-mode]").textContent = "新しいページ";
  dirty = false;
  renderList();
  setEditing(true);
  form.elements.title.focus();
}

async function openPage(id) {
  const p = pages.find((x) => x.id === id);
  if (!p) return;
  current = { id, createdAt: p.createdAt || null, items: [], oldDocIds: [], password: "", loading: true };
  setEditing(true);
  $("[data-ve-mode]").textContent = "読み込み中…";
  renderList();
  try {
    const [priv, ...docs] = await Promise.all([
      getDoc(doc(db, PAGES, id, "private", "admin")),
      ...(p.items || []).filter((it) => it.type === "html").map((it) => getDoc(doc(db, PAGES, id, "docs", it.docId)))
    ]);
    if (!current || current.id !== id) return; // 読み込み中にほかのページを選んだ
    const html = Object.fromEntries(docs.map((d) => [d.id, d.exists() ? d.data().html : ""]));
    const admin = priv.exists() ? priv.data() : {};
    current.password = admin.password || "";
    current.items = (p.items || []).map((it) => {
      if (it.type === "youtube") return { type: "youtube", title: it.title || "", url: `https://youtu.be/${it.videoId}`, videoId: it.videoId };
      if (it.type === "drive") return { type: "drive", title: it.title || "", url: driveOpenUrl(it.kind, it.driveId), kind: it.kind, driveId: it.driveId };
      return { type: "html", title: it.title || "", docId: it.docId, html: html[it.docId] || "", fileName: "", changed: false };
    });
    current.oldDocIds = current.items.filter((it) => it.type === "html").map((it) => it.docId);
    current.loading = false;
    fillForm({ ...p, memo: admin.memo || "" });
    $("[data-ve-mode]").textContent = p.title || "（タイトルなし）";
    dirty = false;
  } catch (err) {
    toast(explain(err));
  }
}

function toDateInput(ts) {
  if (!ts || !ts.toDate) return "";
  const d = ts.toDate();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fillForm(p) {
  const f = form.elements;
  f.title.value = p.title || "";
  f.note.value = p.note || "";
  f.enabled.checked = p.enabled !== false;
  f.expires.value = toDateInput(p.expiresAt);
  f.memo.value = p.memo || "";
  f.password.value = current.password;
  $("[data-ve-delete]").hidden = !current.id;
  renderItems();
  renderShare();
}

// 中身の一覧
function renderItems() {
  const items = current.items;
  $("[data-ve-items-count]").textContent = items.length ? `${items.length} / ${ITEMS_MAX}` : "";
  document.querySelectorAll("[data-ve-add]").forEach((b) => { b.disabled = items.length >= ITEMS_MAX; });
  itemsEl.replaceChildren(...items.map((item, i) => {
    const box = el("div", `ve-item${item.isNew ? " is-new" : ""}`);
    delete item.isNew;
    const thumb = el("div", "ve-item__thumb");
    const fields = el("div", "ve-item__fields");

    const titleField = el("label", "m3-field");
    const titleInput = el("input", "m3-field__input");
    titleInput.maxLength = 120;
    titleInput.value = item.title;
    titleInput.placeholder = ITEM_TITLE[item.type][1];
    titleInput.addEventListener("input", () => { item.title = titleInput.value; markDirty(); });
    titleField.append(el("span", "m3-field__label", ITEM_TITLE[item.type][0]), titleInput);
    fields.append(titleField);

    if (item.type === "youtube") {
      const setThumb = () => {
        thumb.replaceChildren();
        if (item.videoId) {
          const img = el("img");
          img.src = `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`;
          img.alt = "";
          img.referrerPolicy = "no-referrer";
          thumb.append(img);
        } else thumb.append(icon("smart_display"));
      };
      setThumb();
      const urlField = el("label", "m3-field");
      const urlInput = el("input", "m3-field__input");
      urlInput.type = "url";
      urlInput.value = item.url;
      urlInput.placeholder = "https://youtu.be/…";
      urlInput.addEventListener("input", () => {
        item.url = urlInput.value;
        item.videoId = youtubeIdOf(urlInput.value);
        urlField.querySelector(".m3-field__label").textContent = item.url && !item.videoId ? "YouTube の URL（読み取れません）" : "YouTube の URL";
        setThumb();
        markDirty();
      });
      urlField.append(el("span", "m3-field__label", "YouTube の URL"), urlInput);
      fields.append(urlField);
    } else if (item.type === "drive") {
      // ファイルはドライブの縮小画像（共有が「リンクを知っている全員」でないと出ない）。フォルダは画像がないのでアイコン
      const setThumb = () => {
        thumb.replaceChildren();
        const kind = DRIVE_KINDS[item.kind];
        if (item.driveId && item.kind !== "folder") {
          const img = el("img");
          img.src = `https://drive.google.com/thumbnail?id=${encodeURIComponent(item.driveId)}&sz=w320`;
          img.alt = "";
          img.referrerPolicy = "no-referrer";
          img.addEventListener("error", () => img.replaceWith(icon(kind.icon)));
          thumb.append(img);
        } else thumb.append(icon(kind ? kind.icon : "add_to_drive"));
      };
      setThumb();
      const urlField = el("label", "m3-field");
      const urlInput = el("input", "m3-field__input");
      const label = el("span", "m3-field__label");
      const setLabel = () => {
        label.textContent = !item.url ? "Google ドライブの共有リンク"
          : item.driveId ? `Google ドライブの共有リンク（${DRIVE_KINDS[item.kind].label}）` : "Google ドライブの共有リンク（読み取れません）";
      };
      setLabel();
      urlInput.type = "url";
      urlInput.value = item.url;
      urlInput.placeholder = "https://drive.google.com/file/d/…";
      urlInput.addEventListener("input", () => {
        const found = driveOf(urlInput.value);
        item.url = urlInput.value;
        item.kind = found ? found.kind : "";
        item.driveId = found ? found.id : "";
        setLabel();
        setThumb();
        markDirty();
      });
      urlField.append(label, urlInput);
      fields.append(urlField);
    } else {
      thumb.append(icon("description"));
      const file = el("div", "ve-item__file");
      const pick = el("button", "m3-btn m3-btn--tonal m3-state");
      pick.type = "button";
      pick.append(icon("upload_file"), document.createTextNode(item.html ? "ファイルを選び直す" : "HTML ファイルを選ぶ"));
      pick.addEventListener("click", () => { fileTarget = item; fileInput.value = ""; fileInput.click(); });
      file.append(pick);
      if (item.html) {
        const size = bytesOf(item.html);
        if (size > HTML_MAX) file.classList.add("is-error");
        file.append(el("span", "", `${item.fileName || "保存済み"} · ${kb(size)}${size > HTML_MAX ? "（大きすぎます。900KB まで）" : ""}`));
        const preview = el("button", "text-btn m3-state", "プレビュー");
        preview.type = "button";
        preview.addEventListener("click", () => openFull(item.title || "プレビュー", item.html));
        file.append(preview);
      } else file.append(el("span", "", "まだ選んでいません"));
      fields.append(file);
    }

    const tools = el("div", "ve-item__tools");
    const up = iconBtn("arrow_upward", "上へ");
    up.disabled = i === 0;
    up.addEventListener("click", () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; markDirty(); renderItems(); });
    const down = iconBtn("arrow_downward", "下へ");
    down.disabled = i === items.length - 1;
    down.addEventListener("click", () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; markDirty(); renderItems(); });
    const remove = iconBtn("close", "外す");
    remove.addEventListener("click", () => { items.splice(i, 1); markDirty(); renderItems(); });
    tools.append(up, down, remove);

    box.append(thumb, fields, tools);
    return box;
  }));
}

fileInput.addEventListener("change", async () => {
  const f = fileInput.files && fileInput.files[0];
  if (!f || !fileTarget) return;
  const text = await f.text();
  fileTarget.html = text;
  fileTarget.fileName = f.name;
  fileTarget.changed = true;
  if (!fileTarget.title) {
    const m = /<title[^>]*>([^<]*)<\/title>/i.exec(text);
    fileTarget.title = (m && m[1].trim()) || f.name.replace(/\.html?$/i, "");
  }
  markDirty();
  renderItems();
});

document.querySelectorAll("[data-ve-add]").forEach((b) => b.addEventListener("click", () => {
  const item = blankItem(b.dataset.veAdd);
  item.isNew = true;
  current.items.push(item);
  markDirty();
  renderItems();
  const inputs = itemsEl.lastElementChild && itemsEl.lastElementChild.querySelectorAll("input");
  if (inputs && inputs.length) inputs[inputs.length - 1].focus();
  if (item.type === "html") { fileTarget = item; fileInput.value = ""; fileInput.click(); }
}));

function markDirty() { dirty = true; }
form.addEventListener("change", markDirty);
form.addEventListener("input", (e) => { markDirty(); if (e.target.name === "password") renderShare(); });
$("[data-ve-generate]").addEventListener("click", () => { form.elements.password.value = generatePassword(); markDirty(); renderShare(); });
$("[data-ve-clear-expires]").addEventListener("click", () => { form.elements.expires.value = ""; markDirty(); });

// ---------- 配る（URL・パスワード・QR） ----------
// 保存してあるパスワードと同じときだけ出す（保存前のパスワードの QR を配ってしまわないように）
function savedPassword() {
  return current && current.id && current.password && normalizePassword(form.elements.password.value) === normalizePassword(current.password) ? current.password : "";
}
// 見る人のページは sk-hub.jp（管理画面は旧ドメインにあるので location.origin は使わない）
const viewUrl = () => `${NEW_ORIGIN}/view/`;
const qrUrl = (pw) => `${viewUrl()}#p=${encodeURIComponent(normalizePassword(pw))}`;

function renderShare() {
  const pw = savedPassword();
  $("[data-ve-share]").hidden = !pw;
  const openLink = $("[data-ve-open]");
  openLink.hidden = !pw;
  if (!pw) return;
  openLink.href = qrUrl(pw);
  $("[data-ve-url]").textContent = viewUrl();
  $("[data-ve-share-pw]").textContent = pw;
  const box = $("[data-ve-qr]");
  box.replaceChildren();
  if (window.QRCode) new window.QRCode(box, { text: qrUrl(pw), width: 320, height: 320, correctLevel: window.QRCode.CorrectLevel.M });
  else box.append(el("span", "ve-hint", "QR コードを読み込めませんでした"));
}

async function copy(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); } catch (e) { toast("コピーできませんでした"); }
}
$("[data-ve-copy=text]").addEventListener("click", () => {
  const pw = savedPassword();
  const title = form.elements.title.value.trim();
  copy(`${title ? `「${title}」は、` : ""}次のページでパスワードを入れると見られます。\n${viewUrl()}\nパスワード: ${pw}\n（QR コードからひらくと、パスワードを入れずに見られます）`, "案内文をコピーしました");
});
$("[data-ve-copy=qr-url]").addEventListener("click", () => copy(qrUrl(savedPassword()), "QR の URL をコピーしました"));
$("[data-ve-qr-save]").addEventListener("click", () => {
  const box = $("[data-ve-qr]");
  const canvas = box.querySelector("canvas");
  const img = box.querySelector("img");
  const src = canvas ? canvas.toDataURL("image/png") : img && img.src;
  if (!src) return;
  const a = document.createElement("a");
  a.href = src;
  a.download = `${(form.elements.title.value.trim() || "view").replace(/[\\/:*?"<>|]/g, "_")}-qr.png`;
  a.click();
});

// ---------- 保存 ----------
function endOfDay(value) {
  const [y, m, d] = value.split("-").map(Number);
  return Timestamp.fromDate(new Date(y, m - 1, d, 23, 59, 59));
}

function validate() {
  const f = form.elements;
  const title = f.title.value.trim();
  const pw = normalizePassword(f.password.value);
  if (!title) return ["タイトルを入れてください", f.title];
  if (title.length > TITLE_MAX) return ["タイトルが長すぎます", f.title];
  if (f.note.value.length > NOTE_MAX) return ["説明が長すぎます", f.note];
  if (pw.length < PASSWORD_MIN) return [`パスワードは ${PASSWORD_MIN} 文字以上にしてください（空白・ハイフンは数えません）`, f.password];
  if (f.password.value.trim().length > PASSWORD_MAX) return ["パスワードが長すぎます", f.password];
  if (!current.items.length) return ["中身（動画か文書）を 1 つ以上入れてください", null];
  let total = 0;
  for (const [i, it] of current.items.entries()) {
    if (it.type === "youtube" && !it.videoId) return [`${i + 1} 番目: YouTube の URL を読み取れません`, null];
    if (it.type === "drive" && !it.driveId) return [`${i + 1} 番目: Google ドライブの共有リンクを読み取れません`, null];
    if (it.type === "html") {
      if (!it.html) return [`${i + 1} 番目: HTML ファイルを選んでください`, null];
      const size = bytesOf(it.html);
      if (size > HTML_MAX) return [`${i + 1} 番目: 文書が大きすぎます（${kb(size)}。900KB まで）`, null];
      total += size;
    }
  }
  if (total > 9 * 1024 * 1024) return ["文書の合計が大きすぎます（9MB まで）。ページを分けてください", null];
  return null;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (saving || !current || current.loading) return;
  const problem = validate();
  if (problem) { toast(problem[0]); if (problem[1]) problem[1].focus(); return; }
  const f = form.elements;
  const saveBtn = $("[data-ve-save]");
  saving = true;
  saveBtn.classList.add("is-busy");
  saveBtn.disabled = true;
  try {
    const password = f.password.value.trim();
    const newId = await pageIdOf(password);
    const oldId = current.id;
    const moving = !!oldId && newId !== oldId;
    if (newId !== oldId) {
      const taken = await getDoc(doc(db, PAGES, newId));
      if (taken.exists()) { toast("このパスワードは、ほかのページで使われています"); f.password.focus(); return; }
    }
    if (moving && !(await confirmDialog({
      title: "パスワードを変えますか？", text: "前のパスワードと、配った QR コードでは見られなくなります。", ok: "変える", icon: "key"
    }))) return;

    const batch = writeBatch(db);
    const pageRef = doc(db, PAGES, newId);
    const keepDocIds = new Set();
    batch.set(pageRef, {
      title: f.title.value.trim(),
      note: f.note.value.trim(),
      items: current.items.map((it) => {
        if (it.type === "youtube") return { type: "youtube", title: it.title.trim(), videoId: it.videoId };
        if (it.type === "drive") return { type: "drive", title: it.title.trim(), kind: it.kind, driveId: it.driveId };
        return { type: "html", title: it.title.trim(), docId: it.docId };
      }),
      enabled: f.enabled.checked,
      expiresAt: f.expires.value ? endOfDay(f.expires.value) : null,
      createdAt: current.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    for (const it of current.items) {
      if (it.type !== "html") continue;
      keepDocIds.add(it.docId);
      if (it.changed || newId !== oldId) batch.set(doc(db, PAGES, newId, "docs", it.docId), { html: it.html, updatedAt: serverTimestamp() });
    }
    batch.set(doc(db, PAGES, newId, "private", "admin"), { password, memo: f.memo.value.trim(), updatedAt: serverTimestamp() });
    if (moving) {
      // 前の ID は中身ごと消す
      current.oldDocIds.forEach((docId) => batch.delete(doc(db, PAGES, oldId, "docs", docId)));
      batch.delete(doc(db, PAGES, oldId, "private", "admin"));
      batch.delete(doc(db, PAGES, oldId));
    } else {
      current.oldDocIds.filter((docId) => !keepDocIds.has(docId)).forEach((docId) => batch.delete(doc(db, PAGES, newId, "docs", docId)));
    }
    await batch.commit();

    current.id = newId;
    current.password = password;
    current.oldDocIds = [...keepDocIds];
    current.items.forEach((it) => { it.changed = false; });
    if (!current.createdAt) current.createdAt = Timestamp.now();
    dirty = false;
    $("[data-ve-mode]").textContent = f.title.value.trim();
    $("[data-ve-delete]").hidden = false;
    renderItems();
    renderShare();
    logAction("share.save", newId, `「${f.title.value.trim()}」${moving ? "（パスワードを変えた）" : ""}`);
    toast(moving ? "保存しました（パスワードを変えました）" : "保存しました");
  } catch (err) {
    toast(explain(err));
  } finally {
    saving = false;
    saveBtn.classList.remove("is-busy");
    saveBtn.disabled = false;
  }
});

// ---------- 削除 ----------
$("[data-ve-delete]").addEventListener("click", async () => {
  if (!current || !current.id) return;
  const ok = await confirmDialog({
    title: "このページを削除しますか？", text: "パスワードと QR コードでは見られなくなります。元に戻せません。", ok: "削除", danger: true, icon: "delete"
  });
  if (!ok) return;
  try {
    const id = current.id;
    const title = form.elements.title.value.trim();
    const batch = writeBatch(db);
    current.oldDocIds.forEach((docId) => batch.delete(doc(db, PAGES, id, "docs", docId)));
    batch.delete(doc(db, PAGES, id, "private", "admin"));
    batch.delete(doc(db, PAGES, id));
    await batch.commit();
    current = null;
    dirty = false;
    setEditing(false);
    renderList();
    logAction("share.delete", id, `「${title}」`);
    toast("削除しました");
  } catch (err) {
    toast(explain(err));
  }
});

// ---------- プレビュー（全画面） ----------
const fullDialog = $("[data-vw-full]");
function openFull(title, html) {
  $("[data-vw-full-title]").textContent = title;
  const wrap = el("div", "vw-doc");
  wrap.append(makeHtmlFrame(html, title));
  $("[data-vw-full-body]").replaceChildren(wrap);
  fullDialog.showModal();
}
$("[data-vw-full-close]").addEventListener("click", () => fullDialog.close());
fullDialog.addEventListener("close", () => $("[data-vw-full-body]").replaceChildren());

// ---------- そのほかの操作 ----------
document.querySelectorAll("[data-ve-new]").forEach((b) => b.addEventListener("click", async () => { if (await okToLeave()) newPage(); }));
$("[data-ve-back]").addEventListener("click", async () => {
  if (!(await okToLeave())) return;
  if (current && !current.id) current = null;
  dirty = false;
  setEditing(false);
  renderList();
});
window.addEventListener("beforeunload", (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

startAdmin({
  page: "share",
  onReady: () => {
    document.body.classList.add("ve-ready");
    setEditing(false);
    const unsubscribe = onSnapshot(collection(db, PAGES), (snap) => {
      pages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderList();
    }, (err) => toast(explain(err)));
    return () => { unsubscribe(); document.body.classList.remove("ve-ready"); };
  }
});
