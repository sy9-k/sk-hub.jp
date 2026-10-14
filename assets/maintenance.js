// メンテナンス・障害のお知らせ（帯と、ページを閉じる画面）
//   中身は SK Hub Systems の config/maintenance（管理画面 /admin/maintenance/ で変える。だれでも読める）
//     { active, close, level: info|warning|maintenance, message, services: [], startsAt, endsAt, updatedAt, updatedBy }
//     close: false … ページのいちばん上に帯を出す（閉じるボタンで消せる。同じお知らせはこのタブでは出さない）
//     close: true  … ページ全体を「ただいまメンテナンス中です」の画面でおおって、使えなくする（閉じられない）
//                    1 分ごとに確かめ直し、終わったらページを開き直す。稼働状況・規約・同意と制限の画面（NEVER_CLOSE）は閉じない
//                    閉じているあいだに自分で確かめるときは、URL の最後に ?maintenance=skip（そのタブだけ帯に戻る）
//     services が空ならすべてのページ。指定があれば、そのサービスのページと、ホーム・稼働状況・サポートにだけ出す（閉じるのはそのサービスのページだけ）
//   読み込みはログインなしの REST（support/articles.js と同じ）。結果は 5 分だけ sessionStorage に取っておく
//   読めない・ない・期間の外のときは、何もしない
//   文字は M PLUS 1（/assets/fonts.js と同じく、EU・英国・スイスなどのタイムゾーンでは Google Fonts を読み込まず端末の文字で出す）
//   sy9-k/sy9-k.github.io と sy9-k/sk-hub.jp の 2 つのリポジトリに、同じファイルを置く（直すときは両方を同じに）
//   管理画面のプレビュー: <script src="/assets/maintenance.js" data-manual> で読み込むと自分では出さず、
//     window.SKMaintenance.render(data, closable)（帯）・renderClosed(data)（閉じた画面）を使える
(function () {
  "use strict";
  var HUB = { projectId: "y-filter-systems", apiKey: "AIzaSyB4gqzPEPyP0NrEJw33-OTAxUrF48MmiuI" }; // frameworks/check.js と同じ
  var URL_ = "https://firestore.googleapis.com/v1/projects/" + HUB.projectId + "/databases/(default)/documents/config/maintenance?key=" + HUB.apiKey;
  var CACHE_KEY = "sk_maintenance";
  var CLOSED_KEY = "sk_maintenance_closed";
  var SKIP_KEY = "sk_maintenance_skip";
  var CACHE_MS = 5 * 60 * 1000;
  var RECHECK_MS = 60 * 1000;
  var FONT_URL = "https://fonts.googleapis.com/css2?family=M+PLUS+1:wght@400;500;700;800&display=swap";
  var FONT = "\"M PLUS 1\",\"Hiragino Sans\",\"Hiragino Kaku Gothic ProN\",\"Noto Sans JP\",\"Yu Gothic UI\",Meiryo,system-ui,sans-serif";
  var SERVICE_PATHS = {
    "y-filter": ["/y-filter/", "/products/y-filter/"],
    malu: ["/dictionary/", "/products/malu/"],
    nagi: ["/nagi/", "/products/nagi/"],
    toolbox: ["/toolbox/"],
    account: ["/account/", "/sk-hub-systems/"],
    lab: ["/lab/", "/qr-prj/", "/smart-dash/"],
    view: ["/view/"]
  };
  var ALWAYS = /^\/(status\/|support\/)?$/;                    // 帯は、ホーム・稼働状況・サポートにはいつも出す
  var NEVER_CLOSE = /^\/(status|policies|usercheck|admin)\//;  // 閉じない（いまの状況・規約・同意と制限の画面・管理画面）
  var LEVEL = {
    info: { label: "お知らせ", title: "ただいま使えません", icon: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z" },
    warning: { label: "障害", title: "ただいま障害のため使えません", icon: "M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z" },
    maintenance: { label: "メンテナンス", title: "ただいまメンテナンス中です", icon: "M22.7 19 13.6 9.9c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4Z" }
  };
  var t = function (s) { return window.SKI18N ? window.SKI18N.t(s) : s; };

  // REST の値（{ stringValue } など）をふつうの値に
  function plain(v) {
    if (!v) return null;
    if ("stringValue" in v) return v.stringValue;
    if ("booleanValue" in v) return v.booleanValue;
    if ("integerValue" in v) return Number(v.integerValue);
    if ("timestampValue" in v) return Date.parse(v.timestampValue);
    if ("nullValue" in v) return null;
    if ("arrayValue" in v) return (v.arrayValue.values || []).map(plain);
    return null;
  }
  function fromRest(doc) {
    var f = (doc && doc.fields) || {};
    var out = {};
    Object.keys(f).forEach(function (k) { out[k] = plain(f[k]); });
    return out;
  }
  function ms(v) { return v == null ? null : typeof v === "number" ? v : v.toMillis ? v.toMillis() : Date.parse(v); }

  function live(m, now) {
    if (!m || !m.active || !(m.message || m.close)) return false;
    var start = ms(m.startsAt), end = ms(m.endsAt);
    return (!start || start <= now) && (!end || end > now);
  }
  function inService(m, path) {
    var services = m.services || [];
    if (!services.length) return true;
    return services.some(function (s) { return (SERVICE_PATHS[s] || []).some(function (p) { return path.indexOf(p) === 0; }); });
  }
  // SK Hub Support（support.sk-hub.jp）は、困った人が来るところなので、帯はいつも出し、閉じない
  var SUPPORT_SITE = location.hostname === "support.sk-hub.jp";
  function forThisPage(m, path) { return SUPPORT_SITE || ALWAYS.test(path) || inService(m, path); }
  function closesThisPage(m, path) { return !!m.close && !SUPPORT_SITE && !NEVER_CLOSE.test(path) && inService(m, path); }
  function skipping() { try { return sessionStorage.getItem(SKIP_KEY) === "1"; } catch (e) { return false; } }

  // M PLUS 1（Google Fonts。EU などでは読み込まない）
  function loadFont() {
    if (document.getElementById("skm-font")) return;
    var zone = "";
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* 判定できなければ読み込む */ }
    if (/^(Europe\/|Atlantic\/(Canary|Madeira|Azores|Reykjavik|Faroe)|Africa\/Ceuta|Asia\/(Nicosia|Famagusta)|Arctic\/)/.test(zone)) return;
    var link = document.createElement("link");
    link.id = "skm-font";
    link.rel = "stylesheet";
    link.href = FONT_URL;
    document.head.appendChild(link);
  }

  var STYLE = ".skm{position:relative;z-index:60;display:flex;align-items:flex-start;gap:10px;margin:0;padding:10px max(16px,env(safe-area-inset-right)) 10px max(16px,env(safe-area-inset-left));font:500 14px/1.6 " + FONT + ";color:#1b1b1f;background:#dbe4ff}" +
    ".skm--warning{background:#ffe2a8}.skm--maintenance{background:#ffd8c2}" +
    ".skm svg{flex:none;width:20px;height:20px;margin-top:1px;fill:currentColor}" +
    ".skm p{flex:1;min-width:0;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}" +
    ".skm strong{margin-right:8px;font-weight:800}.skm small{display:block;font-size:12.5px;opacity:.8}" +
    ".skm button{flex:none;width:32px;height:32px;margin:-4px -6px -4px 0;border:0;border-radius:16px;background:none;color:inherit;font-size:20px;line-height:1;cursor:pointer}" +
    ".skm button:hover{background:rgba(0,0,0,.08)}" +
    // 閉じた画面（Material 3 の見た目。色は SK's Blue）
    ".skm-closed{position:fixed;z-index:2147483000;inset:0;display:flex;align-items:center;justify-content:center;overflow-y:auto;padding:max(24px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));background:#faf8ff;color:#191b23;font:400 15px/1.7 " + FONT + ";text-align:center;-webkit-font-smoothing:antialiased}" +
    ".skm-closed__card{width:100%;max-width:480px;padding:36px 28px 28px;border-radius:28px;background:#f3f3fe;animation:skm-rise .5s cubic-bezier(.2,0,0,1) both}" +
    ".skm-closed__icon{display:inline-grid;place-items:center;width:80px;height:80px;border-radius:28px;background:#ffdbcc;color:#7a2e00}" +
    ".skm-closed--warning .skm-closed__icon{background:#ffdad6;color:#93000a}.skm-closed--info .skm-closed__icon{background:#dce2ff;color:#394c84}" +
    ".skm-closed__icon svg{width:40px;height:40px;fill:currentColor}" +
    ".skm-closed__logo{display:block;width:32px;height:32px;margin:0 auto 20px;border-radius:9px}" +
    ".skm-closed h1{margin:22px 0 0;font-size:clamp(21px,5.6vw,28px);font-weight:800;line-height:1.4;text-wrap:balance;word-break:auto-phrase}" +
    ".skm-closed__msg{margin:12px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;word-break:auto-phrase;color:#434655}" +
    ".skm-closed__when{display:inline-block;margin:18px 0 0;padding:6px 14px;border-radius:10px;background:#dce2ff;color:#394c84;font-size:13.5px;font-weight:500}" +
    ".skm-closed__actions{display:flex;flex-direction:column;gap:8px;margin-top:24px}" +
    ".skm-closed__actions a,.skm-closed__actions button{display:inline-flex;align-items:center;justify-content:center;height:48px;padding:0 24px;border:0;border-radius:24px;font:500 15px/1 " + FONT + ";text-decoration:none;cursor:pointer}" +
    ".skm-closed__reload{background:#004ac6;color:#fff}.skm-closed__status{background:none;color:#004ac6}" +
    ".skm-closed__foot{margin:16px 0 0;font-size:12.5px;color:#737686}" +
    "html.skm-locked,html.skm-locked body{overflow:hidden!important}" +
    // 閉じているあいだは、同意のカードと右下のマーク（frameworks/check.js）も出さない（閉じた画面の上に重なるため）
    "html.skm-locked .RedCheckOSS-consent-card,html.skm-locked .RedCheckOSS-info-widget{display:none!important}" +
    "@keyframes skm-rise{from{opacity:0;transform:translateY(16px)}}" +
    "@media (prefers-reduced-motion:reduce){.skm-closed__card{animation:none}}" +
    "@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .skm{color:#e4e1e6;background:#24365e}:root:not([data-theme=light]) .skm--warning{background:#5a4300}:root:not([data-theme=light]) .skm--maintenance{background:#6a2f12}" +
    ":root:not([data-theme=light]) .skm-closed{background:#11131b;color:#e1e2ed}:root:not([data-theme=light]) .skm-closed__card{background:#191b23}:root:not([data-theme=light]) .skm-closed__msg{color:#c3c6d7}" +
    ":root:not([data-theme=light]) .skm-closed__icon{background:#7a2e00;color:#ffdbcc}:root:not([data-theme=light]) .skm-closed--warning .skm-closed__icon{background:#93000a;color:#ffdad6}:root:not([data-theme=light]) .skm-closed--info .skm-closed__icon{background:#33467e;color:#dce2ff}" +
    ":root:not([data-theme=light]) .skm-closed__when{background:#33467e;color:#dce2ff}:root:not([data-theme=light]) .skm-closed__reload{background:#b4c5ff;color:#002a78}:root:not([data-theme=light]) .skm-closed__status{color:#b4c5ff}}" +
    ":root[data-theme=dark] .skm{color:#e4e1e6;background:#24365e}:root[data-theme=dark] .skm--warning{background:#5a4300}:root[data-theme=dark] .skm--maintenance{background:#6a2f12}" +
    ":root[data-theme=dark] .skm-closed{background:#11131b;color:#e1e2ed}:root[data-theme=dark] .skm-closed__card{background:#191b23}:root[data-theme=dark] .skm-closed__msg{color:#c3c6d7}" +
    ":root[data-theme=dark] .skm-closed__icon{background:#7a2e00;color:#ffdbcc}:root[data-theme=dark] .skm-closed--warning .skm-closed__icon{background:#93000a;color:#ffdad6}:root[data-theme=dark] .skm-closed--info .skm-closed__icon{background:#33467e;color:#dce2ff}" +
    ":root[data-theme=dark] .skm-closed__when{background:#33467e;color:#dce2ff}:root[data-theme=dark] .skm-closed__reload{background:#b4c5ff;color:#002a78}:root[data-theme=dark] .skm-closed__status{color:#b4c5ff}";

  function addStyle() {
    loadFont();
    if (document.getElementById("skm-style")) return;
    var st = document.createElement("style");
    st.id = "skm-style";
    st.textContent = STYLE;
    document.head.appendChild(st);
  }
  function fmt(v) {
    var d = new Date(ms(v));
    return (d.getMonth() + 1) + "/" + d.getDate() + " " + d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function svgIcon(level) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", LEVEL[level].icon);
    svg.appendChild(path);
    return svg;
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  // 帯（closable: 閉じるボタンを出すか）
  function render(m, closable) {
    addStyle();
    var level = LEVEL[m.level] ? m.level : "info";
    var box = el("div", "skm skm--" + level);
    box.setAttribute("role", level === "info" ? "status" : "alert");
    var p = el("p");
    p.appendChild(el("strong", null, t(LEVEL[level].label)));
    p.appendChild(document.createTextNode(m.message || ""));
    if (m.startsAt || m.endsAt) p.appendChild(el("small", null, (m.startsAt ? fmt(m.startsAt) : "") + " 〜 " + (m.endsAt ? fmt(m.endsAt) : "")));
    box.appendChild(svgIcon(level));
    box.appendChild(p);
    if (closable) {
      var close = el("button", null, "×");
      close.type = "button";
      close.setAttribute("aria-label", t("閉じる"));
      close.addEventListener("click", function () {
        box.remove();
        try { sessionStorage.setItem(CLOSED_KEY, String(ms(m.updatedAt) || m.message)); } catch (e) { /* 何もしない */ }
      });
      box.appendChild(close);
    }
    return box;
  }

  // 閉じた画面（ページ全体をおおう）
  function renderClosed(m) {
    addStyle();
    var level = LEVEL[m.level] ? m.level : "maintenance";
    var wrap = el("div", "skm-closed skm-closed--" + level);
    wrap.setAttribute("role", "alertdialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.setAttribute("aria-labelledby", "skm-closed-title");
    var card = el("div", "skm-closed__card");
    var logo = el("img", "skm-closed__logo");
    logo.src = "/assets/logo.svg";
    logo.alt = "SK";
    var icon = el("span", "skm-closed__icon");
    icon.appendChild(svgIcon(level));
    var h1 = el("h1", null, t(LEVEL[level].title));
    h1.id = "skm-closed-title";
    card.appendChild(logo);
    card.appendChild(icon);
    card.appendChild(h1);
    card.appendChild(el("p", "skm-closed__msg", m.message || t("ご不便をおかけしてすみません。終わるまで、しばらくお待ちください。")));
    if (m.endsAt) card.appendChild(el("p", "skm-closed__when", t("再開の予定") + " " + fmt(m.endsAt)));
    var actions = el("div", "skm-closed__actions");
    var reload = el("button", "skm-closed__reload", t("もう一度読み込む"));
    reload.type = "button";
    reload.addEventListener("click", function () {
      try { sessionStorage.removeItem(CACHE_KEY); } catch (e) { /* 何もしない */ }
      location.reload();
    });
    var status = el("a", "skm-closed__status", t("稼働状況を見る"));
    status.href = "https://sk-hub.online/"; // sk-hub.jp とは別の場所で動くステータスページ
    actions.appendChild(reload);
    actions.appendChild(status);
    card.appendChild(actions);
    card.appendChild(el("p", "skm-closed__foot", t("終わると、このページは自動で開き直します。")));
    wrap.appendChild(card);
    return wrap;
  }

  function load(fresh) {
    if (!fresh) {
      try {
        var cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
        if (cached && Date.now() - cached.at < CACHE_MS) return Promise.resolve(cached.data);
      } catch (e) { /* 読み直す */ }
    }
    return fetch(URL_, { cache: "no-store", credentials: "omit" })
      .then(function (res) { return res.ok ? res.json().then(fromRest) : null; })
      .catch(function () { return undefined; }) // つながらないときは undefined（覚えている結果は書きかえない）
      .then(function (data) {
        if (data === undefined) return undefined;
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: data })); } catch (e) { /* 何もしない */ }
        return data;
      });
  }

  // 閉じる。終わったか 1 分ごとに確かめて、終わったら開き直す
  function close(m) {
    if (document.querySelector(".skm-closed")) return;
    document.documentElement.classList.add("skm-locked");
    var screen = renderClosed(m);
    document.body.appendChild(screen);
    // うしろのページを、読み上げやキーボードでもさわれないようにする
    Array.prototype.forEach.call(document.body.children, function (c) { if (c !== screen) c.setAttribute("inert", ""); });
    var timer = setInterval(function () {
      load(true).then(function (next) {
        if (next === undefined) return; // つながらないときは、閉じたまま次を待つ
        if (!next || !live(next, Date.now()) || !closesThisPage(next, location.pathname)) { clearInterval(timer); location.reload(); }
      });
    }, RECHECK_MS);
  }

  function show(m) {
    var path = location.pathname;
    if (!live(m, Date.now())) return;
    if (closesThisPage(m, path) && !skipping()) { close(m); return; }
    if (!forThisPage(m, path) || (!m.message)) return;
    try { if (sessionStorage.getItem(CLOSED_KEY) === String(ms(m.updatedAt) || m.message)) return; } catch (e) { /* 出す */ }
    if (document.querySelector(".skm")) return;
    document.body.insertBefore(render(m, true), document.body.firstChild);
  }

  window.SKMaintenance = { render: render, renderClosed: renderClosed, live: live, SERVICE_PATHS: SERVICE_PATHS };
  var me = document.currentScript;
  if (me && me.hasAttribute("data-manual")) return;
  // LINE のミニアプリ・埋め込みでは出さない
  if (/[?&](embed|line)\b/.test(location.search)) return;
  // ?maintenance=skip … 閉じているあいだに自分で確かめる（このタブだけ）
  if (/[?&]maintenance=skip\b/.test(location.search)) { try { sessionStorage.setItem(SKIP_KEY, "1"); } catch (e) { /* 何もしない */ } }
  var start = function () { load(false).then(show); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})();
