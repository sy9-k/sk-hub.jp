// 地域と言語を選ぶページ（/lang/?next=戻り先）。地域をカードで選ぶと、その地域の言語のボタンが出て、押したらそのまま移る
//   ・同じ地域の言語を選んだら、localStorage の sk_lang に保存して、戻り先の同じ言語のページへ移る
//   ・別の地域を選んだら、その地域の専用サイト（sk-hub.jp・kr / cn / tw / eu / global.sk-hub.jp）へ、?setlang= で言語を引き継いで移る
//   地域ごとに出すプロダクトは _workers/kr/src/worker.js の REGIONS で決める（ここに出す説明は、それに合わせる）
//   どこから開いたかは、<head> の小さなスクリプト（_build/build.py の EXTRA）が <html> に付けている
//     data-lang-from="malu|nagi|lab" … 戻り先のアプリ（Toolbox のときは、<head> で Toolbox の言語の画面 /toolbox/lang/ に移っている）
//     data-lang-app … アプリ（MALU・Nagi・SK's Lab・LINE の中・アプリとして入れたもの）から開いた。
//                     サイトのヘッダー・フッター・お知らせを隠し、上に戻るボタンとアプリの名前の帯を出す（/assets/site.css）
//   ※ 要素の印は data-loc（data-region は、Worker が地域版で消す印なので、ここでは使わない）
(function () {
  "use strict";

  const card = document.querySelector("[data-lang-card]");
  if (!card || !window.SKI18N) return;
  const root = document.documentElement;
  const buttons = [...card.querySelectorAll(".loc-link")];
  const backs = [...document.querySelectorAll("[data-lang-back]")];

  const BACK = { ja: "戻る", en: "Back", "zh-CN": "返回", "zh-TW": "返回", ko: "뒤로" };

  // 開いていたアプリ（上の帯に出す）
  const APPS = {
    malu: { name: "MALU", icon: "/dictionary/ico/icon-192.png" },
    nagi: { name: "Nagi", icon: "/nagi/ico/apple-touch-icon.png" },
    lab: { name: "SK's Lab", icon: "/assets/logo.svg" }
  };
  const inApp = root.hasAttribute("data-lang-app");
  const app = APPS[root.getAttribute("data-lang-from")];
  if (inApp && app) {
    document.querySelector("[data-lang-app-name]").textContent = app.name;
    document.querySelector("[data-lang-app-icon]").src = app.icon;
  }

  // 戻り先（このサイトの中だけ。「//」「/\」で始まるものは、ほかのサイトに出てしまうので使わない）
  const raw = new URLSearchParams(location.search).get("next") || "/";
  const back = /^\/(?![\/\\])/.test(raw) ? raw : "/";

  // 戻る: 戻り先から来たときは履歴を戻る（アプリの画面をそのまま戻す）。直接開いたときは戻り先へ
  function goBack() {
    let fromBack = false;
    try {
      const ref = new URL(document.referrer);
      fromBack = ref.origin === location.origin && ref.pathname === new URL(back, location.origin).pathname;
    } catch (e) { /* referrer がない */ }
    if (fromBack && history.length > 1) history.back();
    else location.replace(back);
  }
  const backLabel = BACK[window.SKI18N.lang] || BACK.en;
  backs.forEach((a) => {
    a.href = back;
    if (a.getAttribute("aria-label")) a.setAttribute("aria-label", backLabel);
    else a.textContent = backLabel;
    a.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
      e.preventDefault();
      goBack();
    });
  });
  // アプリから開いたときは Esc でも戻る
  if (inApp) document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.defaultPrevented) goBack(); });

  // 地域ごとの専用サイト。日本は sk-hub.jp。本番のアドレスで開いているときだけ地域を切りかえる（手元の確認などでは、言語だけ）
  const SITES = {
    jp: "https://sk-hub.jp", kr: "https://kr.sk-hub.jp", cn: "https://cn.sk-hub.jp",
    tw: "https://tw.sk-hub.jp", eu: "https://eu.sk-hub.jp", global: "https://global.sk-hub.jp"
  };
  const onProd = /(^|\.)sk-hub\.jp$/.test(location.hostname);
  const hereRegion = Object.keys(SITES).find((k) => k !== "jp" && SITES[k].endsWith("//" + location.hostname)) || "jp";
  // どの地域のサイトでも、そのまま開けるページ。それ以外（プロダクトのページなど）は、地域のトップへ
  const GENERIC = /^\/(policies|updates|brand|credits)(\/|$)/;

  // 別の地域のサイトへ移る（選んだ言語は ?setlang= で引き継ぐ）
  function switchRegion(region, lang) {
    const pathname = new URL(back, location.origin).pathname;
    const path = pathname === "/" || GENERIC.test(pathname) ? back : "/";
    const u = new URL(path, SITES[region]);
    u.searchParams.set("setlang", lang);
    // 日本のトップは、その国から開くと地域版に出し分けられる。日本を選んだことを覚えさせる（30 日）
    if (region === "jp" && u.pathname === "/") u.searchParams.set("site", "jp");
    location.href = u.toString();
  }

  buttons.forEach((b) => b.addEventListener("click", () => {
    const lang = b.dataset.lang;
    const region = b.dataset.loc;
    if (onProd && region !== hereRegion) switchRegion(region, lang);
    else window.SKI18N.setLang(lang, back);
  }));

  // いま使っている地域と言語に印を付ける
  const cur = window.SKI18N.stored() || window.SKI18N.lang;
  buttons.forEach((b) => {
    const on = b.dataset.loc === hereRegion && b.dataset.lang === cur;
    b.classList.toggle("is-current", on);
    if (on) b.setAttribute("aria-current", "true");
  });

  // 地域のカード: 選ぶと、その地域の言語のボタンを出す（いまの地域から始める）
  const cards = [...card.querySelectorAll(".loc-card")];
  const panels = [...card.querySelectorAll(".loc-panel")];
  function showRegion(code) {
    cards.forEach((c) => c.setAttribute("aria-checked", String(c.dataset.loc === code)));
    panels.forEach((p) => { p.hidden = p.dataset.panel !== code; });
  }
  cards.forEach((c) => c.addEventListener("click", () => showRegion(c.dataset.loc)));
  cards.forEach((c) => c.classList.toggle("is-current", c.dataset.loc === hereRegion));
  showRegion(hereRegion);
})();
