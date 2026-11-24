// 言語を選ぶページ（/lang/?next=戻り先）。選んだ言語は localStorage の sk_lang に保存し、戻り先の同じ言語のページへ移る
//   どこから開いたかは、<head> の小さなスクリプト（_build/build.py の EXTRA）が <html> に付けている
//     data-lang-from="malu|nagi|lab" … 戻り先のアプリ（Toolbox のときは、<head> で Toolbox の言語の画面 /toolbox/lang/ に移っている）
//     data-lang-app … アプリ（MALU・Nagi・SK's Lab・LINE の中・アプリとして入れたもの）から開いた。
//                     サイトのヘッダー・フッター・お知らせを隠し、上に戻るボタンとアプリの名前の帯を出す（/assets/site.css）
(function () {
  "use strict";

  const card = document.querySelector("[data-lang-card]");
  if (!card || !window.SKI18N) return;
  const root = document.documentElement;
  const title = card.querySelector("[data-lang-title]");
  const desc = card.querySelector("[data-lang-desc]");
  const note = card.querySelector("[data-lang-note]");
  const globe = card.querySelector("[data-lang-globe]");
  const next = card.querySelector("[data-lang-continue]");
  const items = [...card.querySelectorAll("[data-lang]")];
  const regionItems = [...card.querySelectorAll("[data-region]")];
  const regionLabel = card.querySelector("[data-lang-region-label]");
  const languageLabel = card.querySelector("[data-lang-language-label]");
  const backs = [...document.querySelectorAll("[data-lang-back]")];

  // 選んだ言語で、確かめの文を出す
  const TEXT = {
    ja: { title: "言語", desc: "日本語でよろしいですか？", btn: "続行", back: "戻る", note: "SK のサイトとすべてのアプリの言語が変わります", region: "地域", language: "言語", noteRegion: "地域を変えると、その地域のサイトに移ります" },
    en: { title: "Language", desc: "Is English correct?", btn: "Continue", back: "Back", note: "Applies to the SK website and all SK apps", region: "Region", language: "Language", noteRegion: "Changing the region takes you to that region's site" },
    "zh-CN": { title: "语言", desc: "确定使用简体中文吗？", btn: "继续", back: "返回", note: "将应用于 SK 网站和所有 SK 应用", region: "地区", language: "语言", noteRegion: "更改地区后将跳转到该地区的网站" },
    "zh-TW": { title: "語言", desc: "確定使用繁體中文嗎？", btn: "繼續", back: "返回", note: "將套用至 SK 網站與所有 SK 應用程式", region: "地區", language: "語言", noteRegion: "變更地區後將前往該地區的網站" },
    ko: { title: "언어", desc: "한국어로 설정할까요?", btn: "계속", back: "뒤로", note: "SK 웹사이트와 모든 SK 앱에 적용됩니다", region: "지역", language: "언어", noteRegion: "지역을 바꾸면 해당 지역의 사이트로 이동합니다" }
  };

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
  const backLabel = (TEXT[window.SKI18N.lang] || TEXT.en).back;
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

  // 地域: 日本（sk-hub.jp）と 韓国（kr.sk-hub.jp）。韓国版は、韓国で出すものだけを出す（_workers/kr/）。
  //   本番のアドレスで開いているときだけ切りかえる（手元の確認などでは、言語だけ）
  const SITES = { jp: "https://sk-hub.jp", kr: "https://kr.sk-hub.jp" };
  const onProd = /(^|\.)sk-hub\.jp$/.test(location.hostname);
  const hereRegion = location.hostname === "kr.sk-hub.jp" ? "kr" : "jp";
  // 韓国版で開けるページ（_workers/kr/src/worker.js の MIRROR と BLOCKED と同じ）。それ以外は、韓国版のトップへ
  const KR_OK = [/^\/(products|policies|updates|brand|credits|sk-hub-systems)\/?$/, /^\/(products|policies|brand)\/.+\//];
  const KR_NG = /^\/(products\/(y-filter|malu)|lab|y-filter|dictionary|qr-prj|smart-dash)(\/|$)/;
  let region = hereRegion;

  function pickRegion(code) {
    region = code;
    regionItems.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.region === code)));
    // 言語を選んでいなくても、地域だけ変えて続けられる
    next.disabled = false;
    card.classList.add("is-chosen");
    if (!chosen) {
      const text = TEXT[window.SKI18N.lang] || TEXT.en;
      next.textContent = text.btn;
      note.textContent = text.noteRegion;
    }
  }
  regionItems.forEach((b) => b.addEventListener("click", () => pickRegion(b.dataset.region)));
  regionItems.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.region === hereRegion)));

  // 別の地域のサイトへ移る（戻り先は、その地域で開けるページなら同じページ、なければトップ。選んだ言語は ?setlang= で引き継ぐ）
  function switchRegion(lang) {
    let path = back;
    const pathname = new URL(back, location.origin).pathname;
    if (region === "kr" && (KR_NG.test(pathname) || !(pathname === "/" || KR_OK.some((re) => re.test(pathname))))) path = "/";
    const u = new URL(path, SITES[region]);
    u.searchParams.set("setlang", lang);
    // 日本のトップは、韓国から開くと韓国版に出し分けられる。日本を選んだことを覚えさせる（30 日）
    if (region === "jp" && u.pathname === "/") u.searchParams.set("site", "jp");
    location.href = u.toString();
  }

  let chosen = "";
  let timer = null;

  function choose(code) {
    chosen = code;
    items.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.lang === code)));
    const text = TEXT[code];
    card.classList.add("is-switching");
    clearTimeout(timer);
    timer = setTimeout(() => {
      title.textContent = text.title;
      desc.textContent = text.desc;
      note.textContent = text.note;
      title.lang = desc.lang = note.lang = next.lang = code;
      next.textContent = text.btn;
      if (regionLabel) regionLabel.textContent = text.region;
      if (languageLabel) languageLabel.textContent = text.language;
      next.disabled = false;
      card.classList.remove("is-switching");
      card.classList.add("is-chosen");
    }, 220);
  }

  items.forEach((b) => b.addEventListener("click", () => choose(b.dataset.lang)));
  next.addEventListener("click", () => {
    const lang = chosen || window.SKI18N.stored() || window.SKI18N.lang;
    if (onProd && region !== hereRegion) switchRegion(lang);
    else if (chosen) window.SKI18N.setLang(chosen, back);
  });

  // いま使っている言語を選んだ状態から始める（選んだことがある人だけ）
  const current = window.SKI18N.stored();
  if (current && TEXT[current]) {
    items.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.lang === current)));
  }
  globe.classList.add("is-in");
})();
