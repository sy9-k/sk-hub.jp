// アクセス解析（Google アナリティクス 4）。SK プライバシーポリシー 第四条の二
//   ・「許可する」を選んだ人だけ、Google アナリティクスを読み込む（選ぶまで・「許可しない」なら、何も読み込まない）
//   ・聞くのは、最初の「利用規約・プライバシーポリシーのお知らせ」（frameworks/check.js の同意カード）が済んでから
//   ・Google シグナルと広告のための機能は使わない。IP アドレスは GA4 が匿名化する
//   ・アカウントのページ・開発者用のページ・同意の画面は測らない（EXCLUDE）
//   ・選んだ結果はこのブラウザの localStorage（sk_analytics = granted / denied）。フッターの「アクセス解析の設定」で変えられる
// 使い方: <script src="/assets/analytics.js" defer></script>（サイトのテンプレート・MALU・SK's Lab のツール）
(function () {
  "use strict";
  // LINE のミニアプリ（SK's Toolbox）の中では、アクセス解析をしない（同意を聞くカードも出さないため）
  if ((function () { try { return /[?&]line=/.test(location.search) || /[?&]liff\.state=/.test(location.search) || !!sessionStorage.getItem("sk_line"); } catch (e) { return false; } })()) return;

  // Google アナリティクスの測定 ID（G-XXXXXXXXXX）。空のあいだは何もしない
  // （Firebase と一緒に作られたアカウント「Default Account for Firebase」のプロパティ、データストリーム「SK」）
  var MEASUREMENT_ID = "G-LLN7RGHRTE";
  var KEY = "sk_analytics";
  var EXCLUDE = /^\/(account|inbox|studio|y-filter|usercheck)\//;

  var t = window.SKI18N ? window.SKI18N.t : function (s) { return s; };

  function read() {
    try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; }
  }
  function write(value) {
    try { localStorage.setItem(KEY, value); } catch (e) { /* 保存できなければ、次に開いたときにもう一度聞く */ }
  }

  // ---------- Google アナリティクスの読み込み ----------
  var loaded = false;
  function load() {
    if (loaded || !MEASUREMENT_ID) return;
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("consent", "default", {
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "granted"
    });
    window.gtag("js", new Date());
    window.gtag("config", MEASUREMENT_ID, {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      // # 以降（アカウントのページの項目など）は送らない
      page_location: location.origin + location.pathname + location.search
    });
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(MEASUREMENT_ID);
    document.head.appendChild(s);
  }

  // 取り消したとき: 測定をやめ、Google アナリティクスの Cookie（_ga・_ga_XXXX）を消す
  function stop() {
    if (window.gtag) window.gtag("consent", "update", { analytics_storage: "denied" });
    document.cookie.split(";").forEach(function (c) {
      var name = c.split("=")[0].trim();
      if (/^_ga(_|$)/.test(name)) {
        document.cookie = name + "=; Max-Age=0; path=/";
        document.cookie = name + "=; Max-Age=0; path=/; domain=" + location.hostname;
      }
    });
  }

  // ---------- 許可をたずねるカード ----------
  var box = null;
  function ask() {
    if (box) return;
    box = document.createElement("div");
    box.className = "sk-analytics";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", t("アクセス解析"));
    box.style.cssText = "position:fixed;left:16px;bottom:16px;z-index:2147482000;width:min(360px,calc(100% - 32px));" +
      "padding:18px 18px 14px;border-radius:18px;background:#fff;color:#1d1d1f;box-shadow:0 12px 40px rgba(0,0,0,.18);" +
      "font:14px/1.6 system-ui,-apple-system,'Segoe UI','Noto Sans JP',sans-serif";
    var title = document.createElement("strong");
    title.textContent = t("アクセス解析へのご協力のお願い");
    title.style.cssText = "display:block;font-size:15px;margin-bottom:4px";
    var text = document.createElement("p");
    text.style.cssText = "margin:0;color:#48484d";
    text.textContent = t("サイトをよりよくするため、Google アナリティクスで、見られたページなどを集計してもいいですか？広告には使いません。");
    var more = document.createElement("a");
    more.href = "/policies/privacy/";
    more.textContent = t("詳しく");
    more.style.cssText = "color:#0066cc";
    text.append(" ", more);
    var row = document.createElement("div");
    row.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:12px";
    function button(label, primary, onClick) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.style.cssText = "border:0;border-radius:999px;padding:8px 16px;font:600 13.5px system-ui,sans-serif;cursor:pointer;" +
        (primary ? "background:#0071e3;color:#fff" : "background:#f0f0f3;color:#1d1d1f");
      b.addEventListener("click", onClick);
      return b;
    }
    row.append(
      button(t("許可しない"), false, function () { choose("denied"); }),
      button(t("許可する"), true, function () { choose("granted"); })
    );
    box.append(title, text, row);
    document.body.appendChild(box);
  }

  function choose(value) {
    write(value);
    if (box) { box.remove(); box = null; }
    // 測らないページ（アカウントのページなど）で選び直したときは、読み込みはせず、次に開いたほかのページから測る
    if (value === "granted") { if (!EXCLUDE.test(location.pathname)) load(); }
    else stop();
    document.dispatchEvent(new CustomEvent("sk:analytics", { detail: value }));
  }

  // EU・英国・韓国などでは、最初からオンにした同意は認められないので、日本以外では最初はオフにする。
  // サーバーでは国を判定できない（GitHub Pages）ので、外部に何も送らずに済むブラウザのタイムゾーンで見分ける
  function defaultOn() {
    try {
      var zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return zone === "Asia/Tokyo" || zone === "Japan";
    } catch (e) { return false; }
  }

  // ---------- 最初の同意カード（frameworks/check.js）に、アクセス解析のチェックを入れる ----------
  // カードで「同意して閉じる」を押したときに、スイッチの状態で許可・不許可を決める（日本のタイムゾーンでは最初はオン）。
  // 「同意しない」を押したときは許可しない。カードで選ばずに離れた人には、あとで左下のカード（ask）で聞く
  function attachToTermsCard(card) {
    if (!card || card.querySelector(".sk-analytics-opt")) return;
    // 帯の中の、選択肢を足す場所（check.js の __extra）
    var slot = card.querySelector("[data-RedCheckOSS-consent-extra]");
    if (!slot) return;
    if (!document.getElementById("sk-analytics-opt-style")) {
      var st = document.createElement("style");
      st.id = "sk-analytics-opt-style";
      st.textContent =
        ".sk-analytics-opt{display:flex;align-items:center;gap:8px;font-size:12.5px;line-height:1.4;color:#3a3a3c;cursor:pointer;white-space:nowrap}" +
        ".sk-analytics-opt input{position:absolute;opacity:0;width:1px;height:1px}" +
        ".sk-analytics-opt .sw{position:relative;width:34px;height:20px;border-radius:999px;background:#c7c9ce;flex:none;transition:background-color .15s ease}" +
        ".sk-analytics-opt .sw::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s ease}" +
        ".sk-analytics-opt input:checked+.sw{background:#2563eb}" +
        ".sk-analytics-opt input:checked+.sw::after{transform:translateX(14px)}" +
        ".sk-analytics-opt input:focus-visible+.sw{outline:2px solid #2563eb;outline-offset:2px}" +
        ".sk-analytics-opt a{color:#2563eb}" +
        "@media(max-width:720px){.sk-analytics-opt{white-space:normal}}";
      document.head.appendChild(st);
    }
    var label = document.createElement("label");
    label.className = "sk-analytics-opt";
    var input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    // 最初からオンにするのは、日本のタイムゾーンのときだけ（SK プライバシーポリシー 第四条の二）
    input.checked = defaultOn();
    var knob = document.createElement("span");
    knob.className = "sw";
    knob.setAttribute("aria-hidden", "true");
    var text = document.createElement("span");
    text.textContent = t("アクセス解析も許可");
    var more = document.createElement("a");
    more.href = "https://support.sk-hub.jp/?a=site-analytics";
    more.target = "_blank";
    more.rel = "noopener";
    more.textContent = t("詳しく");
    more.title = t("サイトの改善のため、アクセス解析（Google アナリティクス）も許可する（広告には使いません）");
    text.append(" ", more);
    label.append(input, knob, text);
    slot.appendChild(label);
    card.addEventListener("click", function (e) {
      var target = e.target instanceof Element ? e.target.closest("[data-RedCheckOSS-consent-action]") : null;
      if (!target) return;
      var action = target.getAttribute("data-RedCheckOSS-consent-action");
      if (action === "agree") choose(input.checked ? "granted" : "denied");
      else if (action === "deny") choose("denied");
    }, true);
  }

  function watchTermsCard() {
    var found = document.querySelector("[data-RedCheckOSS-consent-card]");
    if (found) { attachToTermsCard(found); return; }
    // check.js はあとからカードを出すので、しばらく見張る
    var observer = new MutationObserver(function () {
      var card = document.querySelector("[data-RedCheckOSS-consent-card]");
      if (card) { attachToTermsCard(card); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true });
    setTimeout(function () { observer.disconnect(); }, 15000);
  }

  // 最初の同意カード（check.js）が出ていないときだけ聞く
  function termsCardShown() {
    return !!document.querySelector("[data-RedCheckOSS-consent-card], .RedCheckOSS-consent-card");
  }
  function termsNoticeDone() {
    try {
      return localStorage.getItem("skhub_terms_notice_shown") === "true" || localStorage.getItem("skhub_terms_accepted") !== null;
    } catch (e) { return false; }
  }

  function start() {
    if (!MEASUREMENT_ID || EXCLUDE.test(location.pathname)) return;
    var choice = read();
    if (choice === "granted") { load(); return; }
    if (choice === "denied") return;
    // まだ選んでいない: 最初の同意カードが出たら、その中で聞く
    watchTermsCard();
    // 同意カードが済んでいれば、左下のカードで聞く（済んでいなければ、次に開いたページで聞く）
    setTimeout(function () {
      if (termsNoticeDone() && !termsCardShown()) ask();
    }, 1500);
  }

  // フッターの「アクセス解析の設定」などから開く
  window.SKAnalytics = {
    enabled: function () { return !!MEASUREMENT_ID; },
    choice: read,
    open: function () {
      if (!MEASUREMENT_ID) return;
      if (box) { box.remove(); box = null; }
      ask();
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
