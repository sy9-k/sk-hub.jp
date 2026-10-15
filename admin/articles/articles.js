// 記事エディター（/articles/）。もとは /studio/（そこからはここへ転送する）
// 記事は Cloud Firestore の articles（ID = 記事 ID = URL の /support/?a=ID）。保存するとサポートページ（sk-hub.jp/support/）にすぐ出る。
// 本文の書き方・表示は support/articles.js（window.SKArticles）と同じ
import {
  collection, deleteDoc, doc, getDoc, onSnapshot, serverTimestamp, setDoc, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  NEW_ORIGIN, $, $$, badge, confirmDialog, db, el, empty, explain, logAction, startAdmin, toast
} from "/shared/admin.js";

const SK = () => window.SKArticles; // support/articles.js（defer で読み込む。使うときに取る）
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const TYPE_LABEL = { news: "お知らせ", guide: "サポート記事" };
const LANG_CODES = ["ja", "en", "zh-CN", "zh-TW", "ko"];

const form = $("[data-studio-form]");
const listEl = $("[data-studio-list]");
const previewEl = $("[data-studio-preview]");
const msgEl = $("[data-studio-msg]");

let items = [];          // Firestore の記事（下書きも含む）
let editingId = null;    // 編集中の記事 ID（新しい記事なら null）
let dirty = false;
// 言語ごとのタイトル・要約・本文。ja が元（title / summary / body）、ほかは translations に入る
let drafts = {};
let currentLang = "ja";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const formatDate = (s) => { const [y, m, d] = String(s).split("-").map(Number); return y ? `${y}年${m}月${d}日` : ""; };
const byDate = (a, b) => String(b.date).localeCompare(String(a.date)) || (Number(a.order) - Number(b.order));
const articleUrl = (id) => `${NEW_ORIGIN}/support/?a=${encodeURIComponent(id)}`;
function message(text, isError = false) {
  msgEl.textContent = text;
  msgEl.hidden = !text;
  msgEl.classList.toggle("ad-note--error", isError);
}

// ---------- 一覧 ----------
function renderList() {
  const q = $("[data-studio-search]").value.trim().toLowerCase();
  const shown = items.filter((a) => !q || `${a.title} ${a.summary} ${a.category} ${a.id}`.toLowerCase().includes(q)).sort(byDate);
  $("[data-studio-import]").hidden = items.length > 0;
  if (!shown.length) {
    listEl.replaceChildren(items.length ? empty("見つかりませんでした。", "search_off") : "");
    return;
  }
  listEl.replaceChildren(...shown.map((a) => {
    const b = el("button", "ad-li ad-li--btn m3-state");
    b.type = "button";
    if (a.id === editingId) b.setAttribute("aria-current", "true");
    const text = el("span", "ad-li__text");
    const meta = el("span", "ad-row");
    meta.append(badge(TYPE_LABEL[a.type] || a.type, a.type === "news" ? "info" : ""));
    if (!a.published) meta.append(badge("下書き", "warn"));
    if (a.important) meta.append(badge("重要", "error"));
    text.append(meta, el("span", "ad-li__title", a.title || "（タイトルなし）"), el("span", "ad-li__sub", `${formatDate(a.date)}・${a.category}`));
    b.append(text);
    b.addEventListener("click", () => openArticle(a.id));
    return b;
  }));
}

// ---------- 編集 ----------
function setLink(id) {
  const link = $("[data-studio-view-link]");
  link.hidden = !id;
  if (id) link.href = articleUrl(id);
}
function setForm(a) {
  form.elements.type.value = a.type || "guide";
  form.elements.category.value = a.category || SK().CATEGORIES[0];
  form.elements.date.value = a.date || today();
  form.elements.important.checked = !!a.important;
  drafts = { ja: { title: a.title || "", summary: a.summary || "", body: a.body || "" } };
  LANG_CODES.slice(1).forEach((code) => {
    const tr = (a.translations || {})[code] || {};
    drafts[code] = { title: tr.title || "", summary: tr.summary || "", body: tr.body || "" };
  });
  showLang("ja", false);
  form.elements.published.checked = a.published !== false;
  form.elements.id.value = a.id || "";
  form.elements.id.readOnly = !!a.id;
  form.elements.order.value = a.order ?? -Math.floor(Date.now() / 1000); // 新しいものほど上
  $("[data-studio-mode]").textContent = a.id ? "記事を編集" : "新しい記事";
  $("[data-studio-delete]").hidden = !a.id;
  setLink(a.id);
  syncImportant();
  renderPreview();
  dirty = false;
  message("");
}

// 言語のタブ: いまの欄の中身を覚えてから、選んだ言語の中身を出す
function keepLang() {
  drafts[currentLang] = { title: form.elements.title.value, summary: form.elements.summary.value, body: form.elements.body.value };
}
function showLang(code, keep = true) {
  if (keep) keepLang();
  currentLang = code;
  const d = drafts[code] || { title: "", summary: "", body: "" };
  form.elements.title.value = d.title;
  form.elements.summary.value = d.summary;
  form.elements.body.value = d.body;
  $$("[data-studio-lang]").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.studioLang === code));
    b.classList.toggle("has-text", b.dataset.studioLang !== "ja" && !!(drafts[b.dataset.studioLang] || {}).title);
  });
  // もとの /studio/ では、ここがセレクターになっておらず、言語を切りかえるたびにエラーになっていた
  $("[data-studio-lang-hint]").hidden = code === "ja";
  renderPreview();
}
$$("[data-studio-lang]").forEach((b) => b.addEventListener("click", () => showLang(b.dataset.studioLang)));

async function confirmDiscard() {
  return !dirty || confirmDialog({ title: "保存していない変更があります", text: "変更を捨てて移りますか？", ok: "捨てる", danger: true, icon: "edit_off" });
}

async function openArticle(id) {
  if (id === editingId || !(await confirmDiscard())) return;
  const a = items.find((x) => x.id === id);
  if (!a) return;
  editingId = id;
  setForm(a);
  renderList();
  if (window.innerWidth < 900) form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function newArticle() {
  if (!(await confirmDiscard())) return;
  editingId = null;
  setForm({});
  renderList();
  form.elements.title.focus();
}

function syncImportant() {
  const isNews = form.elements.type.value === "news";
  $("[data-studio-important]").hidden = !isNews;
  if (!isNews) form.elements.important.checked = false;
}

function renderPreview() {
  const f = form.elements;
  const meta = el("div", "ad-row");
  meta.append(badge(TYPE_LABEL[f.type.value], f.type.value === "news" ? "info" : ""));
  if (f.important.checked) meta.append(badge("重要", "error"));
  meta.append(badge(f.category.value || "カテゴリ"), el("span", "ad-hint", formatDate(f.date.value)));
  previewEl.replaceChildren(meta, el("h1", null, f.title.value || "タイトル"), SK().renderBody(SK().parseBody(f.body.value)));
}

form.addEventListener("input", () => { dirty = true; renderPreview(); });
form.elements.type.addEventListener("change", () => { syncImportant(); renderPreview(); });

function autoId(type, date) {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, "0")).join("");
  return `${type === "news" ? "news" : "guide"}-${date.replaceAll("-", "")}-${rand}`;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = form.elements;
  keepLang();
  // 訳: タイトルが入っている言語だけ保存する
  const translations = {};
  LANG_CODES.slice(1).forEach((code) => {
    const d = drafts[code];
    if (d && d.title.trim()) translations[code] = { title: d.title.trim(), summary: d.summary.trim(), body: d.body.replace(/\r\n/g, "\n").trim() };
  });
  const data = {
    type: f.type.value,
    important: f.type.value === "news" && f.important.checked,
    date: f.date.value,
    category: f.category.value.trim(),
    title: drafts.ja.title.trim(),
    summary: drafts.ja.summary.trim(),
    body: drafts.ja.body.replace(/\r\n/g, "\n").trim(),
    published: f.published.checked,
    order: Number(f.order.value) || 0,
    translations
  };
  if (!data.title) { showLang("ja"); message("日本語のタイトルを入れてください。", true); f.title.focus(); return; }
  if (!data.category) { message("カテゴリを入れてください。", true); f.category.focus(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) { message("日付を入れてください。", true); f.date.focus(); return; }
  const id = editingId || f.id.value.trim() || autoId(data.type, data.date);
  if (!ID_PATTERN.test(id)) { message("記事 ID は英小文字・数字・ハイフンで入れてください。", true); f.id.focus(); return; }

  const btn = $("[data-studio-save]");
  btn.disabled = true;
  btn.classList.add("is-busy");
  try {
    const ref = doc(db, "articles", id);
    if (!editingId && (await getDoc(ref)).exists()) { message("その記事 ID はもう使われています。", true); return; }
    const existing = items.find((x) => x.id === id);
    await setDoc(ref, { ...data, createdAt: (existing && existing.createdAt) || serverTimestamp(), updatedAt: serverTimestamp() });
    SK().clearCache();
    editingId = id;
    dirty = false;
    f.id.value = id;
    f.id.readOnly = true;
    $("[data-studio-mode]").textContent = "記事を編集";
    $("[data-studio-delete]").hidden = false;
    setLink(id);
    logAction("article.save", id, `${data.published ? "公開" : "下書き"}「${data.title}」`);
    message(data.published ? "保存しました。サポートのページに公開されています。" : "下書きとして保存しました（サイトには出ません）。");
  } catch (err) {
    message(explain(err), true);
  } finally {
    btn.disabled = false;
    btn.classList.remove("is-busy");
  }
});

$("[data-studio-delete]").addEventListener("click", async () => {
  if (!editingId) return;
  const ok = await confirmDialog({ title: "この記事を削除しますか？", text: "サポートのページから消えます。元に戻せません。", ok: "削除", danger: true, icon: "delete" });
  if (!ok) return;
  try {
    const id = editingId;
    const title = (items.find((x) => x.id === id) || {}).title || "";
    await deleteDoc(doc(db, "articles", id));
    SK().clearCache();
    editingId = null;
    setForm({});
    logAction("article.delete", id, `「${title}」`);
    toast("削除しました");
  } catch (err) {
    message(explain(err), true);
  }
});

$("[data-studio-new]").addEventListener("click", newArticle);
$("[data-studio-search]").addEventListener("input", renderList);
window.addEventListener("beforeunload", (e) => { if (dirty) e.preventDefault(); });

// ---------- 取り込み・バックアップ ----------
// 今の articles.json の記事を、すべて公開中として取り込む（記事がまだ 1 件もないときだけ出すボタン）
$("[data-studio-import-btn]").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  if (!(await confirmDialog({ title: "articles.json の記事を取り込みますか？", ok: "取り込む", icon: "upload" }))) return;
  btn.disabled = true;
  try {
    const articles = await SK().fromJson();
    const batch = writeBatch(db);
    articles.forEach((a, i) => {
      batch.set(doc(db, "articles", a.id), {
        type: a.type === "news" ? "news" : "guide",
        important: !!a.important,
        date: a.date,
        category: a.category,
        title: a.title,
        summary: a.summary || "",
        body: SK().bodyToText(a.body),
        published: true,
        order: i,
        translations: Object.fromEntries(Object.entries(a.i18n || {}).map(([code, tr]) => [code, { title: tr.title || "", summary: tr.summary || "", body: SK().bodyToText(tr.body) }])),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    });
    await batch.commit();
    SK().clearCache();
    message(`${articles.length} 件の記事を取り込みました。`);
  } catch (err) {
    message(explain(err), true);
  } finally {
    btn.disabled = false;
  }
});

// 公開中の記事を articles.json の形で書き出す。sk-hub.jp リポジトリの support/articles.json と入れ替えてプッシュすると、
// SK Hub Systems に届かないときの予備も新しくなる
$("[data-studio-backup]").addEventListener("click", () => {
  const published = items.filter((a) => a.published).sort(byDate);
  const data = {
    _note: "サポートの記事の予備（管理画面の記事エディターの「バックアップ」で書き出したもの）。ふだんは SK Hub Systems の記事が使われ、届かないときだけこのファイルが使われる。",
    categories: SK().CATEGORIES,
    articles: published.map((a) => {
      const out = { id: a.id, type: a.type };
      if (a.important) out.important = true;
      Object.assign(out, { date: a.date, category: a.category, title: a.title, summary: a.summary, order: a.order, body: SK().parseBody(a.body) });
      const i18n = Object.fromEntries(Object.entries(a.translations || {}).map(([code, tr]) => [code, { title: tr.title, summary: tr.summary, body: SK().parseBody(tr.body) }]));
      if (Object.keys(i18n).length) out.i18n = i18n;
      return out;
    })
  };
  const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "articles.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

startAdmin({
  page: "articles",
  onReady: async () => {
    // support/articles.js（defer）の読み込みを待つ
    await new Promise((r) => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", r, { once: true }) : r()));
    $("[data-studio-categories]").replaceChildren(...SK().CATEGORIES.map((c) => { const o = el("option"); o.value = c; return o; }));
    if (!form.elements.date.value) setForm({});
    return onSnapshot(collection(db, "articles"), (snap) => {
      items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderList();
    }, (err) => message(explain(err), true));
  }
});
