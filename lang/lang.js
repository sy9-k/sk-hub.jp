// 地域と言語を選ぶページ（/lang/?next=戻り先）。Samsung の「Choose your location」のように、地域ごとに言語を並べて、押したらそのまま移る
//   ・同じ地域の言語を選んだら、localStorage の sk_lang に保存して、戻り先の同じ言語のページへ移る
//   ・別の地域（日本 ⇔ 韓国）を選んだら、その地域のサイト（sk-hub.jp / kr.sk-hub.jp）へ、?setlang= で言語を引き継いで移る
//   どこから開いたかは、<head> の小さなスクリプト（_build/build.py の EXTRA）が <html> に付けている
//     data-lang-from="malu|nagi|lab" … 戻り先のアプリ（Toolbox のときは、<head> で Toolbox の言語の画面 /toolbox/lang/ に移っている）
//     data-lang-app … アプリ（MALU・Nagi・SK's Lab・LINE の中・アプリとして入れたもの）から開いた。
//                     サイトのヘッダー・フッター・お知らせを隠し、上に戻るボタンとアプリの名前の帯を出す（/assets/site.css）
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

  // 地域: 日本（sk-hub.jp）・韓国（kr.sk-hub.jp）・その他（Global。サイトは日本と同じ）。韓国版は、韓国で出すものだけを出す（_workers/kr/）。
  //   本番のアドレスで開いているときだけ地域を切りかえる（手元の確認などでは、言語だけ）
  const SITES = { jp: "https://sk-hub.jp", kr: "https://kr.sk-hub.jp" };
  const onProd = /(^|\.)sk-hub\.jp$/.test(location.hostname);
  const hereSite = location.hostname === "kr.sk-hub.jp" ? "kr" : "jp";
  // 韓国版で開けるページ（_workers/kr/src/worker.js の MIRROR と BLOCKED と同じ）。それ以外は、韓国版のトップへ
  const KR_OK = [/^\/(products|policies|updates|brand|credits|sk-hub-systems)\/?$/, /^\/(products|policies|brand)\/.+\//];
  const KR_NG = /^\/(products\/(y-filter|malu)|lab|y-filter|dictionary|qr-prj|smart-dash)(\/|$)/;

  // 別の地域のサイトへ移る（戻り先は、その地域で開けるページなら同じページ、なければトップ。選んだ言語は ?setlang= で引き継ぐ）
  function switchSite(site, lang) {
    let path = back;
    const pathname = new URL(back, location.origin).pathname;
    if (site === "kr" && (KR_NG.test(pathname) || !(pathname === "/" || KR_OK.some((re) => re.test(pathname))))) path = "/";
    const u = new URL(path, SITES[site]);
    u.searchParams.set("setlang", lang);
    // 日本のトップは、韓国から開くと韓国版に出し分けられる。日本を選んだことを覚えさせる（30 日）
    if (site === "jp" && u.pathname === "/") u.searchParams.set("site", "jp");
    location.href = u.toString();
  }

  buttons.forEach((b) => b.addEventListener("click", () => {
    const lang = b.dataset.lang;
    const site = b.dataset.region === "kr" ? "kr" : "jp";
    if (onProd && site !== hereSite) switchSite(site, lang);
    else window.SKI18N.setLang(lang, back);
  }));

  // いま使っている地域と言語に印を付ける
  const cur = window.SKI18N.stored() || window.SKI18N.lang;
  const curRegion = hereSite === "kr" ? "kr" : (cur === "zh-CN" || cur === "zh-TW" ? "global" : "jp");
  buttons.forEach((b) => {
    const on = b.dataset.region === curRegion && b.dataset.lang === cur;
    b.classList.toggle("is-current", on);
    if (on) {
      b.setAttribute("aria-current", "true");
    }
  });
  // 地域のカード: 選ぶと、その地域の言語のボタンを出す（いまの地域から始める）
  const cards = [...card.querySelectorAll(".loc-card")];
  const panels = [...card.querySelectorAll(".loc-panel")];
  function showRegion(code) {
    cards.forEach((c) => c.setAttribute("aria-checked", String(c.dataset.region === code)));
    panels.forEach((p) => { p.hidden = p.dataset.panel !== code; });
  }
  cards.forEach((c) => c.addEventListener("click", () => showRegion(c.dataset.region)));
  showRegion(curRegion);
})();
