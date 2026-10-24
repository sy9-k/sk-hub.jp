// サポートの記事（お知らせ・サポート記事）の読み込みと、本文の変換（window.SKArticles）
// 記事は SK Hub Systems（Cloud Firestore の articles。公開中のものだけ誰でも読める）と /support/articles.json（予備。記事エディターの
// 「バックアップ」で書き出したもの）の両方から読む。同じ ID は SK Hub Systems のほうを使い、articles.json にしかない記事も出す。
// （そのため、記事エディターで記事を削除・非公開にしても articles.json に残っていれば出る。そのときは「バックアップ」で articles.json も新しくする）
// 記事を書くのは /studio/（開発者だけ）。
(function () {
  "use strict";

  const HUB = { projectId: "y-filter-systems", apiKey: "AIzaSyB4gqzPEPyP0NrEJw33-OTAxUrF48MmiuI" }; // frameworks/check.js と同じ
  const QUERY_URL = `https://firestore.googleapis.com/v1/projects/${HUB.projectId}/databases/(default)/documents:runQuery?key=${HUB.apiKey}`;
  const CACHE_KEY = "skhub_articles";
  const CACHE_MS = 5 * 60 * 1000; // 同じタブでは 5 分間は読み直さない（読み取りの回数を減らす）

  // カテゴリの並び順（記事にこれ以外のカテゴリがあれば後ろに足す）
  const CATEGORIES = ["MALU", "Nagi", "Y-FILTER.", "SK Hub Systems", "SK's Toolbox", "SK Hub Office", "アカウント", "SK's Lab", "このサイト", "情報と規約"];

  // ---------- 本文の書き方 ----------
  // 1 行 = 1 段落。行の頭で種類が決まる（空の行は無視）
  //   ## 見出し   > 補足   1. 手順（続けて書くと 1 つの手順にまとまる）   - 箇条書き
  //   文中の [文字](URL) はリンクになる
  function parseBody(text) {
    const blocks = [];
    String(text || "").split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      if (!line) return;
      let m;
      const last = blocks[blocks.length - 1];
      if ((m = line.match(/^##\s+(.*)$/))) blocks.push({ h: m[1] });
      else if ((m = line.match(/^>\s?(.*)$/))) blocks.push({ note: m[1] });
      else if ((m = line.match(/^\d+[.．)]\s*(.*)$/))) {
        if (last && last.steps) last.steps.push(m[1]); else blocks.push({ steps: [m[1]] });
      } else if ((m = line.match(/^[-・*]\s+(.*)$/))) {
        if (last && last.list) last.list.push(m[1]); else blocks.push({ list: [m[1]] });
      } else blocks.push({ p: line });
    });
    return blocks;
  }

  function bodyToText(blocks) {
    const lines = [];
    (blocks || []).forEach((b) => {
      if (b.h) lines.push(`## ${b.h}`);
      if (b.p) lines.push(b.p);
      if (b.note) lines.push(`> ${b.note}`);
      if (b.steps) b.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
      if (b.list) b.list.forEach((s) => lines.push(`- ${s}`));
    });
    return lines.join("\n");
  }

  // 文中の [文字](URL) をリンクに、`文字` をコード（ID・アドレスなど）にして、それ以外は文字として入れる
  function inline(parent, text) {
    const re = /\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`/g;
    let last = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      if (m[3] != null) {
        const code = document.createElement("code");
        code.textContent = m[3];
        parent.appendChild(code);
        last = re.lastIndex;
        continue;
      }
      const a = document.createElement("a");
      const href = /^(https?:|\/|#|mailto:)/.test(m[2]) ? m[2] : "#";
      // サイト内のページは、いまの言語のページへ
      a.href = href.startsWith("/") && window.SKI18N ? window.SKI18N.path(href) : href;
      a.textContent = m[1];
      if (/^https?:/.test(m[2])) { a.target = "_blank"; a.rel = "noopener"; }
      parent.appendChild(a);
      last = re.lastIndex;
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
    return parent;
  }

  // 本文（段落のリスト）を要素にする。サポートページと記事エディターのプレビューで使う
  function renderBody(blocks) {
    const body = document.createElement("div");
    body.className = "help-body";
    const add = (tag, className, text) => {
      const e = document.createElement(tag);
      if (className) e.className = className;
      body.appendChild(text == null ? e : inline(e, text));
      return e;
    };
    (blocks || []).forEach((b) => {
      if (b.h) { const h = document.createElement("h3"); h.textContent = b.h; body.appendChild(h); }
      if (b.p) add("p", null, b.p);
      if (b.note) add("p", "help-note", b.note);
      if (b.steps) { const ol = add("ol", "help-steps"); b.steps.forEach((s) => ol.appendChild(inline(document.createElement("li"), s))); }
      if (b.list) { const ul = add("ul", "help-bullets"); b.list.forEach((s) => ul.appendChild(inline(document.createElement("li"), s))); }
    });
    return body;
  }

  // ---------- 読み込み ----------
  // 訳は tr: { en: { title, summary, body（段落のリスト） } } にそろえる
  //   SK Hub Systems … translations: { en: { title, summary, body（書き方の文字列） } }
  //   articles.json   … i18n: { en: { title, summary, body（段落のリスト） } }
  function fromFirestore(fields) {
    const v = (f) => (f ? (f.stringValue ?? f.booleanValue ?? f.integerValue ?? f.doubleValue ?? f.timestampValue ?? null) : null);
    const tr = {};
    const map = fields.translations && fields.translations.mapValue && fields.translations.mapValue.fields;
    Object.entries(map || {}).forEach(([code, value]) => {
      const f = (value.mapValue && value.mapValue.fields) || {};
      if (v(f.title)) tr[code] = { title: v(f.title), summary: v(f.summary) || "", body: parseBody(v(f.body) || "") };
    });
    return {
      order: Number(v(fields.order) || 0),
      type: v(fields.type) || "guide",
      important: v(fields.important) === true,
      date: v(fields.date) || "",
      category: v(fields.category) || "",
      title: v(fields.title) || "",
      summary: v(fields.summary) || "",
      body: parseBody(v(fields.body) || ""),
      tr
    };
  }

  // いまの言語の記事にする（訳がなければ日本語のまま untranslated: true）
  function localize(a) {
    const lang = window.SKI18N ? window.SKI18N.lang : "ja";
    if (lang === "ja") return a;
    const tr = (a.tr || a.i18n || {})[lang];
    if (!tr || !tr.title) return { ...a, untranslated: true };
    return { ...a, title: tr.title, summary: tr.summary || "", body: tr.body || a.body };
  }

  async function fromHub() {
    const res = await fetch(QUERY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "articles" }],
          where: { fieldFilter: { field: { fieldPath: "published" }, op: "EQUAL", value: { booleanValue: true } } }
        }
      })
    });
    if (!res.ok) throw new Error(String(res.status));
    const rows = await res.json();
    return rows.filter((r) => r.document).map((r) => ({ id: r.document.name.split("/").pop(), ...fromFirestore(r.document.fields || {}) }));
  }

  async function fromJson() {
    const res = await fetch("/support/articles.json", { cache: "no-cache" });
    const data = await res.json();
    return data.articles || [];
  }

  function withCategories(articles) {
    const extra = [...new Set(articles.map((a) => a.category))].filter((c) => c && !CATEGORIES.includes(c));
    return { articles: articles.map(localize), categories: [...CATEGORIES, ...extra] };
  }

  let pending = null;
  function load() {
    if (pending) return pending;
    pending = (async () => {
      try {
        const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
        if (cached && Date.now() - cached.t < CACHE_MS) return withCategories(cached.articles);
      } catch (e) { /* 読めなければ読み直す */ }
      const [hub, json] = await Promise.all([fromHub().catch(() => []), fromJson().catch(() => [])]);
      const ids = new Set(hub.map((a) => a.id));
      const articles = hub.concat(json.filter((a) => !ids.has(a.id)));
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), articles })); } catch (e) { /* 保存できなくても動く */ }
      return withCategories(articles);
    })();
    return pending;
  }

  // 記事エディターで保存したあと、このタブの古い記事を使わないように
  function clearCache() {
    try { sessionStorage.removeItem(CACHE_KEY); } catch (e) { /* 同上 */ }
    pending = null;
  }

  window.SKArticles = { CATEGORIES, load, clearCache, parseBody, bodyToText, renderBody, inline, fromJson };
})();
