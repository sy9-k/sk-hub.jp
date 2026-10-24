// SK Hub Support（https://support.sk-hub.jp/）のお知らせ・サポート記事
// 記事の読み込みと本文の表示は support/articles.js（window.SKArticles）。一覧は ?type=news|guide ・ #カテゴリ で絞り込み、記事は ?a=記事ID で開く。
// support/articles.js（ページの最後で読み込む）のあとに動かすため、読み込みが終わってから始める
document.addEventListener("DOMContentLoaded", function () {
  "use strict";

  const root = document.querySelector("[data-help]");
  if (!root || !window.SKArticles) return;
  const { inline, renderBody } = window.SKArticles;
  const I18N = window.SKI18N;
  const t = I18N.t;

  const listView = root.querySelector("[data-help-list-view]");
  const listEl = root.querySelector("[data-help-list]");
  const countEl = root.querySelector("[data-help-count]");
  const catsEl = root.querySelector("[data-help-cats]");
  const articleEl = root.querySelector("[data-help-article]");
  const searchEl = document.querySelector("[data-help-search]");
  const typeBtns = [...root.querySelectorAll("[data-help-type]")];
  const heroEl = document.querySelector(".help-hero");
  const topicsEl = document.querySelector("[data-help-topics]");
  const baseTitle = document.title;
  // 記事の URL。support.sk-hub.jp では /?a=…、sk-hub.jp の /support/ を手元で開いているときは /support/?a=…
  const SUPPORT = location.hostname === "support.sk-hub.jp" ? "/" : "/support/";

  // 以前のページ内リンク（/support/#y-filter など）とカテゴリの対応（カテゴリは日本語で持ち、表示するときに訳す）
  const HASH_CATEGORY = { malu: "MALU", nagi: "Nagi", "y-filter": "Y-FILTER.", hub: "SK Hub Systems", toolbox: "SK's Toolbox", office: "SK Hub Office", account: "アカウント", lab: "SK's Lab", site: "このサイト", privacy: "情報と規約" };
  const CATEGORY_CLASS = { "MALU": "cat-malu", "Nagi": "cat-nagi", "Y-FILTER.": "cat-yf", "SK Hub Systems": "cat-hub", "SK's Toolbox": "cat-sk", "SK Hub Office": "cat-hub", "アカウント": "cat-hub", "SK's Lab": "cat-lab", "このサイト": "cat-sk", "情報と規約": "cat-sk" };
  const TYPE_LABEL = { news: t("お知らせ"), guide: t("サポート記事") };
  const categoryName = (c) => t(c);

  let articles = [];
  let categories = [];
  const state = { type: "", category: "", query: "" };

  const el = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  };
  const articleUrl = (id) => `${SUPPORT}?a=${encodeURIComponent(id)}`;
  const plainText = (a) => [a.title, a.summary, ...(a.body || []).map((b) => [b.p, b.h, b.note, ...(b.steps || []), ...(b.list || [])].filter(Boolean).join(" "))].join(" ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").toLowerCase();

  function metaRow(a) {
    const meta = el("div", "help-meta");
    meta.appendChild(el("span", `help-type help-type--${a.type}`, TYPE_LABEL[a.type] || a.type));
    if (a.important) meta.appendChild(el("span", "news-tag", t("重要")));
    meta.appendChild(el("span", `update-cat ${CATEGORY_CLASS[a.category] || ""}`, categoryName(a.category)));
    const time = el("time", null, I18N.date(a.date));
    time.dateTime = a.date;
    meta.appendChild(time);
    return meta;
  }

  // ---------- トピック（上の大きなタイル。カテゴリごとの記事の数つき） ----------
  function renderTopics() {
    if (!topicsEl) return;
    topicsEl.replaceChildren(...categories.map((c) => {
      const b = el("button", `sp-topic ${CATEGORY_CLASS[c] || ""}`);
      b.type = "button";
      b.setAttribute("aria-pressed", String(state.category === c));
      b.append(el("span", "sp-topic-dot"), el("strong", null, categoryName(c)),
        el("small", null, t("{n} 件", { n: articles.filter((a) => a.category === c).length })));
      b.addEventListener("click", () => {
        state.category = state.category === c ? "" : c;
        state.query = "";
        if (searchEl) searchEl.value = "";
        syncUrl();
        renderList();
        document.getElementById("articles").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return b;
    }));
  }

  // ---------- 一覧 ----------
  function renderCats() {
    catsEl.replaceChildren(...["", ...categories].map((c) => {
      const b = el("button", null, c ? categoryName(c) : t("すべてのカテゴリ"));
      b.type = "button";
      b.setAttribute("aria-pressed", String(state.category === c));
      b.addEventListener("click", () => { state.category = c; syncUrl(); renderList(); });
      return b;
    }));
  }

  function renderList() {
    typeBtns.forEach((b) => b.setAttribute("aria-selected", String(b.dataset.helpType === state.type)));
    renderCats();
    renderTopics();
    const q = state.query.trim().toLowerCase();
    let shown = articles.filter((a) =>
      (!state.type || a.type === state.type) &&
      (!state.category || a.category === state.category) &&
      (!q || plainText(a).includes(q)));
    // 重要なお知らせ → お知らせ → サポート記事の順に、それぞれ新しい順（同じ日はデータの順）
    const rank = (a) => (a.type === "news" ? (a.important ? 0 : 1) : 2);
    shown = shown.slice().sort((x, y) => (rank(x) - rank(y)) || y.date.localeCompare(x.date) || (x._i - y._i));

    countEl.textContent = q || state.type || state.category ? t("{n} 件の記事", { n: shown.length }) : "";
    if (!shown.length) {
      const p = el("p", "faq-empty");
      inline(p, t("見つかりませんでした。ほかの言葉で探すか、[お問い合わせ](/contact/) ください。"));
      listEl.replaceChildren(p);
      return;
    }
    listEl.replaceChildren(...shown.map((a) => {
      const card = el("a", `help-card${a.type === "news" ? " help-card--news" : ""}${a.important ? " help-card--important" : ""}`);
      card.href = articleUrl(a.id);
      card.addEventListener("click", (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        openArticle(a.id, true);
      });
      card.append(metaRow(a), el("h2", null, a.title), el("p", null, a.summary || ""));
      return card;
    }));
  }

  // ---------- 記事 ----------
  function openArticle(id, push) {
    const a = articles.find((x) => x.id === id);
    if (!a) { showList(push); return; }
    if (push) history.pushState({ a: id }, "", articleUrl(id));

    const back = el("a", "help-back", t("記事の一覧へ"));
    back.href = SUPPORT;
    back.addEventListener("click", (e) => { e.preventDefault(); showList(true); });
    const crumbs = el("div", "help-crumbs");
    crumbs.append(back);

    const nodes = [crumbs, metaRow(a), el("h1", null, a.title)];
    // 訳がまだない記事は日本語で出す
    if (a.untranslated) nodes.push(el("p", "doc-lang-note", t("この記事は、まだ日本語でのみ提供しています。")));
    nodes.push(renderBody(a.body));

    // 同じカテゴリの記事
    const related = articles.filter((x) => x.id !== a.id && x.category === a.category).slice(0, 4);
    if (related.length) {
      const box = el("div", "help-related");
      box.appendChild(el("h2", null, t("{category} の記事", { category: categoryName(a.category) })));
      const ul = el("ul");
      related.forEach((r) => {
        const li = el("li");
        const link = el("a", null, r.title);
        link.href = articleUrl(r.id);
        link.addEventListener("click", (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); openArticle(r.id, true); });
        li.appendChild(link);
        ul.appendChild(li);
      });
      box.appendChild(ul);
      nodes.push(box);
    }
    const help = el("div", "help-solved");
    inline(help, t("解決しないときは、下のサポートIDを添えて [お問い合わせ](/contact/) ください。"));
    nodes.push(help);

    articleEl.replaceChildren(...nodes);
    articleEl.hidden = false;
    listView.hidden = true;
    if (heroEl) heroEl.hidden = true;
    document.title = `${a.title} | SK Hub Support`;
    document.dispatchEvent(new Event("sp:route"));
    window.scrollTo({ top: 0 });
  }

  function showList(push) {
    articleEl.hidden = true;
    listView.hidden = false;
    if (heroEl) heroEl.hidden = false;
    document.title = baseTitle;
    if (push) syncUrl(true);
    renderList();
    document.dispatchEvent(new Event("sp:route"));
  }

  // 一覧の絞り込みを URL に反映する（?type=news など）
  function syncUrl(push) {
    const params = new URLSearchParams();
    if (state.type) params.set("type", state.type);
    const url = `${SUPPORT}${params.toString() ? `?${params}` : ""}${state.category ? `#${Object.keys(HASH_CATEGORY).find((k) => HASH_CATEGORY[k] === state.category) || ""}` : ""}`;
    if (push) history.pushState({}, "", url); else history.replaceState({}, "", url);
    document.dispatchEvent(new Event("sp:route"));
  }

  function route() {
    const params = new URLSearchParams(location.search);
    const id = params.get("a");
    state.type = ["news", "guide"].includes(params.get("type")) ? params.get("type") : "";
    state.category = HASH_CATEGORY[location.hash.slice(1)] || "";
    if (id) openArticle(id, false); else showList(false);
  }

  typeBtns.forEach((b) => b.addEventListener("click", () => { state.type = b.dataset.helpType; syncUrl(); renderList(); }));
  if (searchEl) {
    searchEl.addEventListener("input", () => {
      state.query = searchEl.value;
      if (!listView.hidden) renderList(); else { showList(true); }
    });
  }
  window.addEventListener("popstate", route);
  window.addEventListener("hashchange", route);

  window.SKArticles.load()
    .then((data) => {
      // 同じ日付の記事の並び（記事エディターの「並び順」。なければ読み込んだ順）
      articles = data.articles.map((a, i) => ({ ...a, _i: typeof a.order === "number" ? a.order : i }));
      categories = data.categories;
      route();
    })
    .catch(() => {
      listEl.replaceChildren(el("p", "faq-empty", t("記事を読み込めませんでした。時間をおいて再度お試しください。")));
    });
});
