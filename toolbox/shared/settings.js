// SK's Toolbox の共通の設定（各アプリの <head> で、CSS のあとに読み込む）
//   <script src="/toolbox/shared/settings.js" data-app="calc"></script>   … Calc・Memo・Todo
//   <script src="/toolbox/shared/settings.js" data-app="clock" data-scope="clock"></script>   … Clock（テーマとテーマカラーは使わない）
//   <script src="/toolbox/shared/settings.js" data-scope="page"></script>   … /toolbox/settings/（設定のページ）
//   <script src="/toolbox/shared/settings.js" data-app="home" data-scope="site"></script>   … /toolbox/（サイトのヘッダーがあるホーム画面）
//       ライト・ダークは、Toolbox の設定が「端末に合わせる」ならサイトの「表示」（sk_theme。<head> の小さなスクリプトと assets/site.js が
//       <html data-theme> に付ける）のまま。ライト・ダークを選んでいれば Toolbox の設定を優先する（ヘッダーもいっしょに変わる）
//
//   ・設定は localStorage の sk_toolbox に保存する（オンライン同期をオンにしたときだけ、暗号化して SK Hub Systems アカウントにも保存する）
//       { theme: "auto|light|dark", color: "app|blue|sakura|…", motion: "auto|reduce", haptics: true|false, badge: true|false, homeStart: "last|widgets|apps",
//         apps: { clock: { notify }, calc: { history, group }, memo: { trashDays }, todo: { notify } },
//         titlebar: { center: "command|menu|island|chips|ticker|timeline|tabs|none", chips: ["class","todo","alarm","timer"], brand, name, apps, search, settings: true|false } }
//   ・テーマ: <html data-theme="light|dark">（auto のときは付けない。各アプリの CSS が端末の設定に合わせる）
//   ・テーマカラー: SK's Brand のテーマカラー（SK's Blue など 7 色）から作った Material 3 の配色で --md-* を上書きする
//       配色は Google の material-color-utilities（SchemeFidelity）で前もって計算したもの。
//       "app" のときは各アプリの色（Calc は青、Memo はオレンジ、Todo は緑）のまま
//   ・動きを減らす: <html data-motion="reduce">（/toolbox/shared/m3.css が動きを止める）
//   ・設定の画面: SKToolbox.openSettings()（全画面。MALU・Nagi の設定と同じ形で、左にカテゴリ、右に中身）。/toolbox/settings/ では SKToolbox.renderSettings(要素)
//   ・ほかのタブで変えたときも、storage イベントで反映する
//   ・設定の画面のいちばん上に、SK Hub Systems アカウントのログインの状態を出す（MALU・Nagi のアカウントの画面と同じ情報）
//       Firebase は読み込まない。assets/hub/account.js がこのブラウザに保存したもの（skhub_account）を読むだけ。ログイン・ログアウトは /account/ で行う
//   ・その下に「オンライン同期」（任意。最初はオフ）。中身は /toolbox/shared/sync.js（ここで読み込む）
(function () {
  "use strict";

  var script = document.currentScript;
  var scope = (script && script.dataset.scope) || "app";
  var currentApp = (script && script.dataset.app) || "";
  // SK's Toolbox のバージョン（大きく変えたときに上げる。設定の画面のいちばん下に出す）
  var VERSION = "1.0";
  var root = document.documentElement;
  var I18N = window.SKI18N;

  // LINE のミニアプリとして開いているか（?line=dev・?line=1 などで来て、このタブのあいだ覚える。/toolbox/shared/line.js も同じ）
  //   <html class="in-line"> を、画面が出る前に付ける（ヘッダーやボタンが一瞬見えないように）
  var IN_LINE = (function () {
    try {
      var p = new URLSearchParams(location.search).get("line");
      if (p) sessionStorage.setItem("sk_line", p === "dev" || p === "review" ? p : "prod");
      return !!sessionStorage.getItem("sk_line") || /[?&]liff\.state=/.test(location.search);
    } catch (e) { return /[?&]line=/.test(location.search); }
  })();
  if (IN_LINE) root.classList.add("in-line");

  // 画面の切りかえのアニメーションは /toolbox/shared/m3.css のもの（タイトルバーを動かさないフェードスルー）。
  // frameworks/check.js がサイト共通の切りかえを後から入れて上書きしないよう、check.js が見る印を付けておく
  if (!document.querySelector('[data-RedCheckOSS-style="view-transition"]')) {
    var vt = document.createElement("meta");
    vt.setAttribute("data-RedCheckOSS-style", "view-transition");
    vt.content = "toolbox";
    (document.head || root).appendChild(vt);
  }

  // /toolbox/ のホームをアプリとして開いたとき（PWA）は、サイトのヘッダーを細くする（<html class="hd-compact">。見た目は assets/header.css）
  if (scope === "site" && window.matchMedia) {
    var appMode = window.matchMedia("(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: fullscreen), (display-mode: minimal-ui)");
    var compact = function () { root.classList.toggle("hd-compact", appMode.matches || navigator.standalone === true); };
    compact();
    if (appMode.addEventListener) appMode.addEventListener("change", compact);
  }
  function t(s, p) { return I18N ? I18N.t(s, p) : s.replace(/\{(\w+)\}/g, function (m, k) { return p && k in p ? p[k] : m; }); }

  // ---- テーマカラー（SK's Brand の 7 色。[ライト, ダーク] の順に ROLES の色を 6 桁ずつつなげたもの）----
  var ROLES = ["primary", "on-primary", "primary-container", "on-primary-container", "secondary-container", "on-secondary-container", "tertiary", "tertiary-container", "on-tertiary-container", "error", "error-container", "on-error-container", "surface", "on-surface", "on-surface-variant", "surface-container-low", "surface-container", "surface-container-high", "surface-container-highest", "outline", "outline-variant", "inverse-surface", "inverse-on-surface", "inverse-primary"];
  var PALETTES = {
    blue: ["004ac6ffffff2563ebeeefffacbfff394c84943700bc4800ffede6ba1a1affdad693000afaf8ff191b23434655f3f3feededf9e7e7f3e1e2ed737686c3c6d72e3039f0f0fbb4c5ff", "b4c5ff002a782563ebeeefff33467ea4b6f5ffb596bc4800ffede6ffb4ab93000affdad611131be1e2edc3c6d7191b231d1f27282a3232343d8d90a0434655e1e2ed2e30390053db"],
    sakura: ["b7005effffffdb2777fffdfffc86ac761b40006c1c008826fafff4ba1a1affdad693000afff8f826171c594047fff0f2ffe8edfde1e7f7dce18d6f77e1bec63d2c30ffecefffb1c7", "ffb1c7650031db2777fffdff83254aff9bb96ede70008826fafff4ffb4ab93000affdad61d0f13f7dce1e1bec626171c2b1b2036262a413035a88990594047f7dce13d2c30ba0060"],
    matcha: ["006b2cffffff00873af7fff2baecbc406c46a72d51c74668fffbffba1a1affdad693000af4fcf0171d163e4a3deff6eae9f0e5e3eadfdde5d96e7b6cbdcaba2b322becf3e762df7d", "62df7d0039141ca64d002e0f23502c90c193ffb2bfec628455001fffb4ab93000affdad60e150fdde5d9bdcaba171d161b211a252c2430372f8794853e4a3ddde5d92b322b006e2d"],
    mikan: ["a33900ffffffcc4900fffbffff9971772f0f005da80076d2fdfcffba1a1affdad693000afff8f62618135a4138fff1ecffe9e2fee2d9f8ddd48e7166e2bfb23d2d27ffede7ffb599", "ffb5995a1c00f660184011007c3313ffa17ca4c9ff2192fd002141ffb4ab93000affdad61d100bf8ddd4e2bfb22618132b1c1736262142312ba98a7e5a4138f8ddd43d2d27a73a00"],
    fuji: ["630ed4ffffff7c3aedede0ffc4a7ff5237877d3d00a15100ffe0cdba1a1affdad693000afef7ff1d1a244a4455f9f1fff3ebfaede5f4e8dfee7b7487ccc3d8332f39f6eefcd2bbff", "d2bbff3f008e7c3aedede0ff523787c3a6ffffb784a15100ffe0cdffb4ab93000affdad615121be8dfeeccc3d81d1a24221e282c283337333e958da14a4455e8dfee332f39732ee4"],
    sora: ["00647cffffff007f9dfafdffc3e8f8466977894e00a86516fffbffba1a1affdad693000af6fafd171c1e3e484df0f4f7eaeef1e5e9ebdfe3e66e797ebdc8ce2c3133edf1f46cd3f7", "6cd3f7003543269dbe00212b2a4e5a9abecdffb873c98031301800ffb4ab93000affdad60f1416dfe3e6bdc8ce171c1e1b2022262b2d3135388792983e484ddfe3e62c3133006780"],
    sumi: ["1d2b3effffff3341559eadc5dee2ee5f656e38270a503d1ec3a881ba1a1affdad693000afbf9fa1b1b1d44474cf5f3f5efedefeae7e9e4e2e475777dc5c6cd303032f2f0f2b9c7e0", "b9c7e02331443341559eadc5424750b0b5c0dfc299503d1ec3a881ffb4ab93000affdad6131315e4e2e4c5c6cd1b1b1d1f1f212a2a2b3435368e919744474ce4e2e4303032515f74"]
  };
  // 名前と見本の色は SK's Brand（/brand/）と同じ
  var COLORS = [
    { key: "blue", name: "SK's Blue", note: t("いつもの青"), sw: "#2563eb" },
    { key: "sakura", name: "SK's Sakura", note: t("さくら"), sw: "#db2777" },
    { key: "matcha", name: "SK's Matcha", note: t("抹茶"), sw: "#16a34a" },
    { key: "mikan", name: "SK's Mikan", note: t("みかん"), sw: "#ea580c" },
    { key: "fuji", name: "SK's Fuji", note: t("藤"), sw: "#7c3aed" },
    { key: "sora", name: "SK's Sora", note: t("空"), sw: "#0891b2" },
    { key: "sumi", name: "SK's Sumi", note: t("墨"), sw: "#334155" }
  ];

  // ---- 設定の読み書き ----
  var STORE = "sk_toolbox";
  var TB_CENTERS = ["command", "menu", "island", "chips", "ticker", "timeline", "tabs", "none"];
  var TB_CHIPS = ["class", "todo", "alarm", "timer"];
  var TB_PARTS = ["brand", "name", "apps", "search", "settings"];
  var DEFAULTS = { theme: "auto", color: "app", motion: "auto", haptics: true, badge: true, homeStart: "last" };
  // アプリ別の設定（設定の画面の「アプリ」。各アプリは SKToolbox.app("calc") などで読む）
  //   clock.notify … アラームとタイマーを通知する（/toolbox/shared/remind.js）
  //   calc.history … 計算の履歴を残す / calc.group … 3 けたごとに区切る（/toolbox/calc/calc.js）
  //   memo.trashDays … ごみ箱に残す日数 7・30・90（/toolbox/memo/memo.js）
  //   todo.notify … リマインダーを通知する（/toolbox/shared/remind.js）
  var APP_DEFAULTS = { clock: { notify: true }, calc: { history: true, group: true }, memo: { trashDays: 30 }, todo: { notify: true } };
  function readApps(d) {
    var src = d.apps && typeof d.apps === "object" ? d.apps : {};
    var out = {};
    Object.keys(APP_DEFAULTS).forEach(function (app) {
      var def = APP_DEFAULTS[app], cur = src[app] && typeof src[app] === "object" ? src[app] : {};
      out[app] = {};
      Object.keys(def).forEach(function (k) {
        var v = cur[k];
        if (k === "trashDays") out[app][k] = [7, 30, 90].indexOf(v) >= 0 ? v : def[k];
        else out[app][k] = typeof v === typeof def[k] ? v : def[k];
      });
    });
    return out;
  }
  // タイトルバー（パソコンでアプリとして入れたとき。/toolbox/shared/titlebar.js・tbcenter.js）。前の「アイランド」のオン・オフ（island）も引き継ぐ
  function readTitlebar(d) {
    var tb = d.titlebar && typeof d.titlebar === "object" ? d.titlebar : {};
    var r = { center: TB_CENTERS.indexOf(tb.center) >= 0 ? tb.center : d.island === false ? "none" : "command" };
    r.chips = Array.isArray(tb.chips) ? TB_CHIPS.filter(function (k) { return tb.chips.indexOf(k) >= 0; }) : TB_CHIPS.slice();
    TB_PARTS.forEach(function (k) { r[k] = typeof tb[k] === "boolean" ? tb[k] : true; });
    return r;
  }
  var settings = {};
  function read() {
    var d = {};
    try { d = JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch (e) { /* 初期値 */ }
    settings = {
      theme: ["auto", "light", "dark"].indexOf(d.theme) >= 0 ? d.theme : DEFAULTS.theme,
      color: d.color === "app" || PALETTES[d.color] ? d.color : DEFAULTS.color,
      motion: d.motion === "reduce" ? "reduce" : "auto",
      haptics: typeof d.haptics === "boolean" ? d.haptics : DEFAULTS.haptics,
      badge: typeof d.badge === "boolean" ? d.badge : DEFAULTS.badge,
      homeStart: ["last", "widgets", "apps"].indexOf(d.homeStart) >= 0 ? d.homeStart : DEFAULTS.homeStart,
      apps: readApps(d),
      titlebar: readTitlebar(d)
    };
  }
  function write() {
    try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch (e) { /* 保存できなくても、このページでは反映する */ }
  }

  // ---- 反映 ----
  var darkMq = window.matchMedia("(prefers-color-scheme: dark)");
  var listeners = [];
  var styleEl = null;
  // サイトのページ（scope "site"）で、サイトの「表示」が付けた data-theme（Toolbox の設定で上書きしていないときの値）
  var siteTheme = scope === "site" ? root.getAttribute("data-theme") : null;
  var writing = false;
  function isDark() {
    if (settings.theme !== "auto") return settings.theme === "dark";
    if (scope === "site" && siteTheme) return siteTheme === "dark";
    return darkMq.matches;
  }
  function setThemeAttr(value) {
    if (root.getAttribute("data-theme") === value || (!value && !root.hasAttribute("data-theme"))) return;
    writing = true;
    if (value) root.setAttribute("data-theme", value); else root.removeAttribute("data-theme");
    writing = false;
  }
  function paletteCss(key, dark) {
    var hex = PALETTES[key][dark ? 1 : 0];
    return ROLES.map(function (r, i) { return "--md-" + r + ":#" + hex.slice(i * 6, i * 6 + 6) + ";"; }).join("");
  }
  function apply() {
    if (settings.motion === "reduce") root.setAttribute("data-motion", "reduce");
    else root.removeAttribute("data-motion");
    if (scope !== "clock") {
      if (settings.theme !== "auto") setThemeAttr(settings.theme);
      else setThemeAttr(scope === "site" ? siteTheme : null);
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = "sk-toolbox-color";
        document.head.appendChild(styleEl);
      }
      // html:root:root … アプリの :root[data-theme="dark"] などより強くする
      styleEl.textContent = PALETTES[settings.color] ? "html:root:root{" + paletteCss(settings.color, isDark()) + "}" : "";
      root.setAttribute("data-color", settings.color);
    }
    listeners.forEach(function (fn) { try { fn(settings); } catch (e) { /* ほかの処理は続ける */ } });
  }
  function set(patch) {
    Object.keys(patch).forEach(function (k) { settings[k] = patch[k]; });
    write();
    apply();
    refreshUi();
  }

  read();
  apply();
  darkMq.addEventListener("change", apply);
  // サイトのページ: ヘッダーの「表示」でライト・ダークを変えたとき
  if (scope === "site" && window.MutationObserver) {
    new MutationObserver(function () {
      if (writing) return;
      siteTheme = root.getAttribute("data-theme");
      apply();
    }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  }
  // アカウントの状態が変わったとき（ほかのタブでログインした・assets/hub/account.js が知らせた）
  document.addEventListener("skhub:account", function () { refreshUi(); });
  window.addEventListener("storage", function (e) {
    if (e.key === HINT_KEY) { refreshUi(); return; }
    if (e.key !== STORE && e.key !== null) return;
    read();
    apply();
    refreshUi();
  });

  // ---- 振動（Calc のキー・Todo のチェック）----
  function vibrate() {
    if (settings.haptics && navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* 対応していない */ } }
  }

  // ---- この端末のデータ ----
  var APPS = [
    { key: "sk_clock", app: "clock", name: "Clock", what: t("表示の設定・アラーム・世界時計"), extra: ["sk_clock_tools", "sk_clock_fired"] },
    { key: "sk_calc", app: "calc", name: "Calc", what: t("計算の履歴") },
    { key: "sk_memo", app: "memo", name: "Memo", what: t("メモと画像"), idb: "sk_toolbox_memo" },
    { key: "sk_todo", app: "todo", name: "Todo", what: t("タスク"), extra: ["sk_todo_notified"] },
    { key: "sk_countdown", app: "countdown", name: "Countdown", what: t("日の一覧") },
    { key: "sk_timetable", app: "timetable", name: "Timetable", what: t("時間割と、配信された時間割") },
    { key: "sk_roulette", app: "roulette", name: "Roulette", what: t("ルーレットと結果の履歴") }
  ];
  var sizeFmt = new Intl.NumberFormat((I18N && I18N.locale) || "ja-JP", { maximumFractionDigits: 1 });
  function sizeOf(key) {
    try {
      var v = localStorage.getItem(key);
      return v === null ? 0 : (key.length + v.length) * 2;
    } catch (e) { return 0; }
  }
  // IndexedDB に入れた画像の大きさ（Memo）
  function idbSize(name) {
    return new Promise(function (resolve) {
      if (!window.indexedDB) { resolve(0); return; }
      var req = indexedDB.open(name);
      req.onupgradeneeded = function () { req.transaction.abort(); resolve(0); };
      req.onerror = function () { resolve(0); };
      req.onsuccess = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains("images")) { db.close(); resolve(0); return; }
        var all = db.transaction("images").objectStore("images").getAll();
        all.onsuccess = function () { db.close(); resolve((all.result || []).reduce(function (s, b) { return s + (b && b.size || 0); }, 0)); };
        all.onerror = function () { db.close(); resolve(0); };
      };
    });
  }
  function syncOn() { return !!(window.SKToolboxSync && SKToolboxSync.isOn()); }
  function clearApp(a) {
    try { localStorage.removeItem(a.key); (a.extra || []).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* 消せないときはそのまま */ }
    // オンライン同期をしていれば、次に同期するときにアカウントから読み込み直す（消したことを、ほかの端末に広げない）
    if (window.SKToolboxSync) SKToolboxSync.forget([a.key]);
    if (a.idb && window.indexedDB) return new Promise(function (resolve) { var r = indexedDB.deleteDatabase(a.idb); r.onsuccess = r.onerror = r.onblocked = function () { resolve(); }; });
    return Promise.resolve();
  }
  function sizeText(bytes) {
    if (!bytes) return t("データなし");
    return bytes < 1024 ? t("{n} バイト", { n: bytes }) : t("{n} KB", { n: sizeFmt.format(bytes / 1024) });
  }

  // ---- SK Hub Systems アカウント（表示だけ）----
  var HINT_KEY = "skhub_account";
  function readHint() {
    try { return JSON.parse(localStorage.getItem(HINT_KEY) || "null"); } catch (e) { return null; }
  }
  function lp(u) { return I18N && I18N.path ? I18N.path(u) : u; }

  // ---- まとめてバックアップ ----
  var BACKUP_KEYS = ["sk_toolbox", "sk_toolbox_home", "sk_clock", "sk_clock_tools", "sk_calc", "sk_memo", "sk_todo", "sk_countdown", "sk_timetable", "sk_roulette"];
  function memoImages(mode, fn) {
    return new Promise(function (resolve) {
      if (!window.indexedDB) { resolve(null); return; }
      var req = indexedDB.open("sk_toolbox_memo", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("images"); };
      req.onerror = function () { resolve(null); };
      req.onsuccess = function () {
        var db = req.result, tx = db.transaction("images", mode), store = tx.objectStore("images");
        var result = fn(store);
        tx.oncomplete = function () { db.close(); resolve(result && result.result !== undefined ? result.result : result); };
        tx.onerror = function () { db.close(); resolve(null); };
      };
    });
  }
  function exportAll() {
    var storage = {};
    BACKUP_KEYS.forEach(function (k) { try { var v = localStorage.getItem(k); if (v !== null) storage[k] = v; } catch (e) { /* 読めないときは入れない */ } });
    var keys = [], blobs = [];
    memoImages("readonly", function (st) {
      var c = st.openCursor();
      c.onsuccess = function () { var cur = c.result; if (cur) { keys.push(cur.key); blobs.push(cur.value); cur.continue(); } };
      return null;
    }).then(function () {
      return Promise.all(blobs.map(function (b) { return new Promise(function (resolve) { var r = new FileReader(); r.onload = function () { resolve(r.result); }; r.onerror = function () { resolve(null); }; r.readAsDataURL(b); }); }));
    }).then(function (urls) {
      var images = {};
      keys.forEach(function (k, i) { if (urls[i]) images[k] = urls[i]; });
      var d = new Date(), stamp = d.getFullYear() + ("0" + (d.getMonth() + 1)).slice(-2) + ("0" + d.getDate()).slice(-2);
      var blob = new Blob([JSON.stringify({ app: "sk-toolbox", version: 1, exportedAt: d.toISOString(), storage: storage, images: images })], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "toolbox-backup-" + stamp + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
  }
  function importAll(file) {
    file.text().then(function (text) {
      var d = JSON.parse(text);
      if (!d || d.app !== "sk-toolbox" || !d.storage || typeof d.storage !== "object") throw new Error("not a backup");
      return confirmDialog(t("バックアップを読み込みますか？"), t("いまの Toolbox のデータは、バックアップの内容に置きかわります。元に戻すことはできません。"), t("読み込む")).then(function (ok) {
        if (!ok) return;
        BACKUP_KEYS.forEach(function (k) {
          try { if (typeof d.storage[k] === "string") localStorage.setItem(k, d.storage[k]); else localStorage.removeItem(k); } catch (e) { /* 容量がいっぱいなど */ }
        });
        // オンライン同期をしていれば、次に同期するときにアカウントのデータとまとめる（古いバックアップで、ほかの端末のデータを消さない）
        if (window.SKToolboxSync) SKToolboxSync.forget(BACKUP_KEYS);
        var images = d.images && typeof d.images === "object" ? d.images : {};
        var ids = Object.keys(images).filter(function (id) { return /^[a-z0-9]{6,40}$/.test(id) && /^data:image\//.test(images[id]); });
        return Promise.all(ids.map(function (id) { return fetch(images[id]).then(function (r) { return r.blob(); }); })).then(function (blobs) {
          return memoImages("readwrite", function (st) { st.clear(); ids.forEach(function (id, i) { st.put(blobs[i], id); }); return null; });
        }).then(function () { location.reload(); });
      });
    }).catch(function () { alertSay(t("読み込めませんでした。Toolbox のバックアップのファイルを選んでください")); });
  }
  function alertSay(text) { confirmDialog(t("読み込めませんでした"), text, "OK"); }

  // ---- 画面の部品 ----
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function icon(name) { var s = el("span", "msr", name); s.setAttribute("aria-hidden", "true"); return s; }
  function label(title, sub) {
    var box = el("span", "tbs-label");
    box.appendChild(el("span", "tbs-label__title", title));
    if (sub) box.appendChild(el("span", "tbs-label__sub", sub));
    return box;
  }
  function section(title) {
    var s = el("section", "tbs-section");
    s.appendChild(el("h3", "tbs-section__title", title));
    return s;
  }
  // スイッチ（M3）
  function switchRow(title, sub, get, onChange) {
    var row = el("label", "tbs-item tbs-item--switch m3-state");
    row.appendChild(label(title, sub));
    var input = el("input", "tbs-switch");
    input.type = "checkbox";
    input.setAttribute("role", "switch");
    row.appendChild(input);
    input.addEventListener("change", function () { onChange(input.checked); });
    updaters.push(function () { input.checked = get(); });
    return row;
  }

  // タイトルバーの設定: 真ん中に出すもの（7 種類）と、アイコン・名前・アプリの切りかえ・検索・設定のオン・オフ
  function setTitlebar(patch) {
    var tb = {};
    Object.keys(settings.titlebar).forEach(function (k) { tb[k] = settings.titlebar[k]; });
    Object.keys(patch).forEach(function (k) { tb[k] = patch[k]; });
    set({ titlebar: tb });
  }
  function titlebarSection() {
    var sec = section(t("タイトルバー"));
    sec.appendChild(el("p", "tbs-text", t("パソコンでアプリとして入れたときの、ウィンドウのいちばん上の帯。真ん中に出すものと、並べるボタンを選べます")));
    var row = el("div", "tbs-item tbs-item--col");
    row.appendChild(label(t("真ん中に出すもの")));
    var grid = el("div", "tbs-designs");
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", t("真ん中に出すもの"));
    [
      ["command", "search", t("コマンドバー"), t("検索欄の形。次の予定を薄く出し、押すと検索とコマンド（⌘K）")],
      ["menu", "menu", t("メニューバー"), t("Mac のアプリのように「ファイル」「編集」「表示」「移動」「ウィンドウ」「ヘルプ」を並べる。最初のメニューはアプリの名前")],
      ["island", "radio_button_checked", t("アイランド"), t("黒い小さな島に、いま大事なことを 1 つ。押すと今日のまとめ")],
      ["chips", "label", t("ステータスチップ"), t("授業・Todo・アラーム・タイマーを小さな札で並べる")],
      ["ticker", "text_rotation_none", t("ティッカー"), t("1 行の文字が数秒ごとに入れ替わる")],
      ["timeline", "view_timeline", t("今日のタイムライン"), t("今日の授業を色の帯で並べ、「今」の線が動く")],
      ["tabs", "tab", t("アプリのタブ"), t("アプリを名前のタブで並べる（アイコン・名前・アプリの切りかえの代わり）")],
      ["none", "block", t("なし"), t("何も出さない")]
    ].forEach(function (o) {
      var b = el("button", "tbs-design m3-state");
      b.type = "button";
      b.setAttribute("role", "radio");
      var ic = icon(o[1]);
      ic.classList.add("tbs-design__icon");
      var check = icon("check_circle");
      check.classList.add("tbs-design__check");
      b.append(ic, label(o[2], o[3]), check);
      b.addEventListener("click", function () { setTitlebar({ center: o[0] }); });
      updaters.push(function () { b.setAttribute("aria-checked", String(settings.titlebar.center === o[0])); });
      grid.appendChild(b);
    });
    row.appendChild(grid);
    sec.appendChild(row);

    // ステータスチップに出すもの（ステータスチップを選んだときだけ）
    var chipRow = el("div", "tbs-item tbs-item--col");
    chipRow.appendChild(label(t("チップに出すもの")));
    var chipBox = el("div", "tbs-chips");
    [["class", "school", t("授業")], ["todo", "checklist", "Todo"], ["alarm", "alarm", t("アラーム")], ["timer", "hourglass_top", t("タイマー")]].forEach(function (o) {
      var b = el("button", "tbs-chip m3-state");
      b.type = "button";
      b.setAttribute("aria-pressed", "false");
      b.append(icon(o[1]), el("span", "", o[2]));
      b.addEventListener("click", function () {
        var list = settings.titlebar.chips.slice(), i = list.indexOf(o[0]);
        if (i >= 0) list.splice(i, 1); else list.push(o[0]);
        setTitlebar({ chips: TB_CHIPS.filter(function (k) { return list.indexOf(k) >= 0; }) });
      });
      updaters.push(function () { b.setAttribute("aria-pressed", String(settings.titlebar.chips.indexOf(o[0]) >= 0)); });
      chipBox.appendChild(b);
    });
    chipRow.appendChild(chipBox);
    updaters.push(function () { chipRow.hidden = settings.titlebar.center !== "chips"; });
    sec.appendChild(chipRow);

    // 並べるもの
    var tabsNote = t("「アプリのタブ」のときは、タブが代わりに出ます");
    [
      ["brand", t("Toolbox のアイコン"), t("押すとホーム")],
      ["name", t("アプリの名前"), t("「SK's Toolbox › Clock」のように")],
      ["apps", t("アプリの切りかえ"), t("右のアプリのアイコン")],
      ["search", t("検索のボタン"), t("消しても ⌘K（Ctrl+K）で開けます")],
      ["settings", t("設定のボタン"), t("消しても、各アプリの上の歯車から開けます")]
    ].forEach(function (o) {
      var r = switchRow(o[1], o[2], function () { return settings.titlebar[o[0]]; }, function (on) { var p = {}; p[o[0]] = on; setTitlebar(p); });
      if (o[0] === "brand" || o[0] === "name" || o[0] === "apps") {
        var sub = r.querySelector(".tbs-label__sub");
        updaters.push(function () { sub.textContent = settings.titlebar.center === "tabs" ? o[2] + " · " + tabsNote : o[2]; });
      }
      sec.appendChild(r);
    });
    return sec;
  }

  // 確認のダイアログ（M3 の基本のダイアログ）
  function confirmDialog(title, text, ok) {
    return new Promise(function (resolve) {
      var scrim = el("div", "tbs-dialog-scrim");
      var dlg = el("div", "tbs-dialog");
      dlg.setAttribute("role", "alertdialog");
      dlg.setAttribute("aria-modal", "true");
      var h = el("h2", "tbs-dialog__title", title);
      h.id = "tbs-dialog-title";
      dlg.setAttribute("aria-labelledby", h.id);
      dlg.appendChild(icon("delete"));
      dlg.appendChild(h);
      dlg.appendChild(el("p", "tbs-dialog__text", text));
      var actions = el("div", "tbs-dialog__actions");
      var cancel = el("button", "text-btn m3-state", t("キャンセル"));
      var okBtn = el("button", "text-btn tbs-danger m3-state", ok);
      cancel.type = okBtn.type = "button";
      actions.append(cancel, okBtn);
      dlg.appendChild(actions);
      scrim.appendChild(dlg);
      document.body.appendChild(scrim);
      var before = document.activeElement;
      cancel.focus();
      function close(v) {
        scrim.remove();
        document.removeEventListener("keydown", onKey, true);
        if (before && before.focus) before.focus();
        resolve(v);
      }
      function onKey(e) {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false); }
        if (e.key === "Tab") { // ダイアログの中だけで移る
          var f = [cancel, okBtn], i = f.indexOf(document.activeElement);
          e.preventDefault();
          f[(i + (e.shiftKey ? f.length - 1 : 1)) % f.length].focus();
        }
      }
      document.addEventListener("keydown", onKey, true);
      cancel.addEventListener("click", function () { close(false); });
      okBtn.addEventListener("click", function () { close(true); });
      scrim.addEventListener("click", function (e) { if (e.target === scrim) close(false); });
    });
  }

  // ---- 設定の画面 ----
  var updaters = [];
  function refreshUi() { updaters.forEach(function (fn) { fn(); }); }

  function accountSection() {
    var sec = section(t("SK Hub Systems アカウント"));
    var card = el("div", "tbs-account");
    sec.appendChild(card);
    function draw() {
      var hint = readHint();
      card.textContent = "";
      // アイコン（写真・頭文字・ログインしていないとき）
      var av = el("span", "tbs-account__avatar" + (hint ? "" : " is-empty"));
      if (hint && hint.photo) {
        var img = el("img");
        img.src = hint.photo;
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        av.appendChild(img);
      } else if (hint) {
        av.textContent = hint.letter || "?";
        av.style.background = hint.color || "#2563eb";
      } else {
        av.appendChild(icon("person"));
      }
      var who = el("div", "tbs-account__who");
      who.appendChild(el("span", "tbs-account__name", hint ? (hint.name || hint.email || t("SK Hub Systems アカウント")) : t("ログインしていません")));
      if (hint && hint.email && hint.name) who.appendChild(el("span", "tbs-account__email", hint.email));
      var status = el("span", "tbs-account__status" + (hint ? " is-on" : ""));
      status.append(el("i"), document.createTextNode(hint ? t("ログイン中") : t("ログインしていません")));
      if (hint) who.appendChild(status);
      var top = el("div", "tbs-account__top");
      top.append(av, who);
      card.appendChild(top);

      if (!hint) card.appendChild(el("p", "tbs-account__lead", t("ログインすると、SK のアプリの記録や設定を、ほかの端末とまとめられます。")));
      var actions = el("div", "tbs-account__actions");
      function btn(cls, text, href) {
        var a = el("a", cls + " m3-state", text);
        a.href = href;
        actions.appendChild(a);
      }
      var here = location.pathname + location.search;
      if (hint) {
        btn("m3-btn m3-btn--tonal", t("アカウントを管理"), lp("/account/"));
        btn("text-btn", t("ログアウト"), lp("/account/?signout=1"));
      } else if (IN_LINE) {
        // LINE の中: LINE でログイン（Google などのログインの画面は、LINE の中では使えない）
        var lineBtn = el("button", "m3-btn m3-state tbs-line-login", t("LINE でログイン"));
        lineBtn.type = "button";
        lineBtn.addEventListener("click", function () { lineSignIn(lineBtn); });
        actions.appendChild(lineBtn);
        btn("text-btn", t("詳しく"), lp("/sk-hub-systems/account/"));
      } else {
        btn("m3-btn", t("ログイン"), lp("/account/") + "?next=" + encodeURIComponent(here));
        btn("text-btn", t("詳しく"), lp("/sk-hub-systems/account/"));
      }
      card.appendChild(actions);
    }
    updaters.push(draw);
    return sec;
  }

  // ---- LINE の中: SK Hub Systems アカウントにログイン（/toolbox/shared/line.js の SKLine.signIn）----
  function lineSignIn(button) {
    if (!window.SKLine || !SKLine.signIn) return;
    if (button) button.disabled = true;
    SKLine.signIn().then(function (r) {
      if (r === "ready") { refreshUi(); lineToast(t("ログインしました")); }
    }, function (e) {
      var code = e && e.code;
      lineToast(code === "sk/no-liff" ? t("LINE のアプリの中で開いたときだけ、LINE でログインできます。")
        : code === "sk/api-unreachable" || code === "auth/network-request-failed" ? t("ログインのサーバーに接続できませんでした。インターネットの接続を確認してください。")
          : t("時間をおいてもう一度お試しください。"), t("ログインできませんでした"));
    }).then(function () { if (button) button.disabled = false; });
  }
  function lineToast(text, title) {
    if (window.M3) M3.dialog({ title: title || "", body: el("p", "tbs-dialog__text", text), actions: [{ label: t("OK"), primary: true, value: null }] });
  }

  // ---- LINE の中: 公式 LINE（SK Hub）。友だちに追加・お知らせを LINE で受け取る ----
  //   状態は api.sk-hub.jp に聞く（/toolbox/shared/line-account.js の status()。ログインしているときだけ）
  function lineSection() {
    var sec = section(t("公式 LINE"));
    sec.appendChild(el("p", "tbs-text", t("SK Hub の公式 LINE を友だちに追加すると、SK Hub Systems アカウントのお知らせ（お問い合わせへの返事など）を LINE で受け取れます。お知らせの中身は LINE に送りません。")));
    var box = el("div");
    sec.appendChild(box);
    var state = null, loading = false, loadedFor = null;
    function note(title, sub) {
      var r = el("div", "tbs-item");
      r.appendChild(label(title, sub));
      box.appendChild(r);
    }
    function draw() {
      box.textContent = "";
      var hint = readHint();
      // 友だちに追加（いつでも出す）
      var friend = !!(hint && state && state.friend);
      var add = el("a", "tbs-item tbs-item--link m3-state");
      add.href = "https://line.me/R/ti/p/%40324czrsr";
      add.appendChild(icon(friend ? "check_circle" : "person_add"));
      add.appendChild(label(t("公式 LINE を友だちに追加"), friend ? t("友だちになっています") : "SK Hub（@324czrsr）"));
      add.appendChild(icon("open_in_new"));
      add.addEventListener("click", function (e) { if (window.SKLine) { e.preventDefault(); SKLine.addFriend(); } });
      box.appendChild(add);
      if (!hint) { note(t("お知らせを LINE で受け取る"), t("LINE でログインすると選べます")); return; }
      if (!state) { note(t("お知らせを LINE で受け取る"), loading ? t("確かめています…") : t("読み込めませんでした")); return; }
      if (!state.linked) { note(t("お知らせを LINE で受け取る"), t("このアカウントには LINE がつながっていません。アカウントのページの「サインインとセキュリティ」で LINE をつなぐと選べます")); return; }
      var row = el("label", "tbs-item tbs-item--switch m3-state");
      row.appendChild(label(t("お知らせを LINE で受け取る"), state.friend === false ? t("公式 LINE を友だちに追加すると届きます") : t("新しいお知らせがあると、公式 LINE で知らせます")));
      var input = el("input", "tbs-switch");
      input.type = "checkbox";
      input.setAttribute("role", "switch");
      input.checked = !!state.notify;
      row.appendChild(input);
      input.addEventListener("change", function () {
        input.disabled = true;
        SKLine.account().then(function (m) { return m.setNotify(input.checked); }).then(function (r) {
          state.notify = !!r.notify;
        }, function () {
          lineToast(t("時間をおいてもう一度お試しください。"), t("変更できませんでした"));
        }).then(draw);
      });
      box.appendChild(row);
    }
    function load() {
      var hint = readHint();
      loadedFor = hint ? hint.name + "|" + hint.photo : "";
      state = null;
      if (!hint || !window.SKLine || !SKLine.account) { draw(); return; }
      loading = true;
      draw();
      SKLine.account().then(function (m) { return m.status(); }).then(function (s) { state = s; }, function () { state = null; })
        .then(function () { loading = false; draw(); });
    }
    // ログイン・ログアウトしたら読み直す
    updaters.push(function () {
      var hint = readHint();
      if ((hint ? hint.name + "|" + hint.photo : "") !== loadedFor) load(); else draw();
    });
    // line.js は設定の画面より後に読み込まれるので、少し待ってから読む
    setTimeout(load, 0);
    return sec;
  }

  // 設定の画面（MALU・Nagi の設定と同じ形。左にカテゴリ、右に中身。スマホではカテゴリが上に横並び）
  //   全体 … 全般・アカウントと同期（LINE の中では LINE でログインし、公式 LINE の設定も）・見た目・操作・通知・データ・このアプリについて
  //   アプリ別 … Clock・Calc・Memo・Todo・Countdown・Timetable・Roulette（そのアプリの設定・データ・開く・ビルド）
  var APP_DESC = {
    clock: t("時計・アラーム・タイマー・世界時計"),
    calc: t("関数電卓にもなる電卓"),
    memo: t("画像も入るメモ帳"),
    todo: t("リマインダーと ToDo リスト"),
    countdown: t("あと何日を数える"),
    timetable: t("時間割とクラスへの配信"),
    roulette: t("回して決めるルーレット")
  };
  function linkRow(href, ic, title, sub) {
    var a = el("a", "tbs-item tbs-item--link m3-state");
    a.href = href;
    a.appendChild(icon(ic));
    a.appendChild(label(title, sub));
    a.appendChild(icon("chevron_right"));
    return a;
  }
  // 選ぶボタンの列（テーマ・ホームの最初の画面・ごみ箱の日数など）
  function segRow(title, sub, opts, get, onPick) {
    var row = el("div", "tbs-item tbs-item--col");
    row.appendChild(label(title, sub));
    var seg = el("div", "tbs-seg");
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", title);
    opts.forEach(function (o) {
      var b = el("button", "tbs-seg__btn m3-state");
      b.type = "button";
      b.setAttribute("role", "radio");
      var check = icon("check"), ic = icon(o[1]);
      check.classList.add("tbs-seg__check");
      ic.classList.add("tbs-seg__icon");
      b.append(check, ic, el("span", "", o[2]));
      b.addEventListener("click", function () { onPick(o[0]); });
      updaters.push(function () { b.setAttribute("aria-checked", String(get() === o[0])); });
      seg.appendChild(b);
    });
    row.appendChild(seg);
    return row;
  }
  // アプリ別の設定（settings.apps）
  function setApp(app, patch) {
    var apps = {};
    Object.keys(settings.apps).forEach(function (k) { apps[k] = settings.apps[k]; });
    var cur = {};
    Object.keys(apps[app] || {}).forEach(function (k) { cur[k] = apps[app][k]; });
    Object.keys(patch).forEach(function (k) { cur[k] = patch[k]; });
    apps[app] = cur;
    set({ apps: apps });
  }
  function appSwitch(app, key, title, sub) {
    return switchRow(title, sub, function () { return settings.apps[app][key]; }, function (on) { var p = {}; p[key] = on; setApp(app, p); });
  }
  // この端末に入っている Service Worker のキャッシュの番号（ビルド）。prefix は sk-toolbox・sk-clock など
  function builds() {
    if (!window.caches || !caches.keys) return Promise.resolve({});
    return caches.keys().then(function (names) {
      var out = {};
      names.forEach(function (c) {
        var m = /^sk-([a-z]+)-v(\d+)$/.exec(c);
        if (m) out[m[1]] = Math.max(out[m[1]] || 0, +m[2]);
      });
      return out;
    }).catch(function () { return {}; });
  }
  // アプリのデータ（大きさと消去）
  function dataRow(a) {
    var row = el("div", "tbs-item tbs-item--data");
    var img = el("img", "tbs-app-icon");
    img.src = "/toolbox/" + a.app + "/icon.svg";
    img.alt = "";
    img.width = img.height = 40;
    row.appendChild(img);
    var lab = label(a.name, " ");
    var sub = lab.querySelector(".tbs-label__sub");
    row.appendChild(lab);
    var btn = el("button", "text-btn m3-state", t("消去"));
    btn.type = "button";
    btn.setAttribute("aria-label", t("{app} のデータを消去", { app: a.name }));
    row.appendChild(btn);
    updaters.push(function () {
      var size = sizeOf(a.key) + (a.extra || []).reduce(function (s, k) { return s + sizeOf(k); }, 0);
      sub.textContent = a.what + " · " + sizeText(size);
      btn.disabled = !size;
      if (a.idb) idbSize(a.idb).then(function (img) {
        if (!img) return;
        sub.textContent = a.what + " · " + sizeText(size + img);
        btn.disabled = false;
      });
    });
    btn.addEventListener("click", function () {
      confirmDialog(t("{app} のデータを消去しますか？", { app: a.name }),
        t("この端末に保存されている {app} の{what}を消去します。元に戻すことはできません。", { app: a.name, what: a.what }), t("消去"))
        .then(function (ok) {
          if (!ok) return;
          clearApp(a).then(function () {
            if (a.app === currentApp || currentApp === "home") { location.reload(); return; }
            refreshUi();
          });
        });
    });
    return row;
  }
  // ページのいちばん上の、アイコンと名前（このアプリについて・アプリ別のページ）
  function aboutHead(src, name, desc) {
    var head = el("div", "tbs-about");
    var img = el("img", "tbs-about__icon");
    img.src = src;
    img.alt = "";
    img.width = img.height = 72;
    var text = el("div", "tbs-about__text");
    text.append(el("p", "tbs-about__name", name), el("p", "tbs-about__desc", desc));
    head.append(img, text);
    return head;
  }
  // 区切りの中で、続いている項目のいちばん上と下の角を丸くする（MALU の設定と同じ見た目。隠れている項目はとばす）
  function roundCards(box) {
    [].forEach.call(box.querySelectorAll(".tbs-section > .tbs-item"), function (c) {
      var prev = c.previousElementSibling, next = c.nextElementSibling;
      while (prev && prev.hidden) prev = prev.previousElementSibling;
      while (next && next.hidden) next = next.nextElementSibling;
      c.classList.toggle("is-first", !prev || !prev.classList.contains("tbs-item"));
      c.classList.toggle("is-last", !next || !next.classList.contains("tbs-item"));
    });
  }

  function buildSettings() {
    updaters = [];
    var layout = el("div", "tbs-layout");
    var side = el("nav", "tbs-nav");
    side.setAttribute("aria-label", t("設定のカテゴリ"));
    var body = el("div", "tbs-body");
    layout.append(side, body);
    var navBtns = [], pages = [];
    // カテゴリの一覧のいちばん上（Android の設定アプリと同じ: 大きな「設定」・右上のアカウント・「設定を検索」）
    var listHead = el("div", "tbs-listhead");
    var bigTitle = el("h2", "tbs-listhead__title", t("設定"));
    var me = el("a", "tbs-listhead__me");
    me.href = lp("/account/");
    function drawMe() {
      var hint = readHint();
      me.textContent = "";
      me.setAttribute("aria-label", hint ? (hint.name || hint.email || t("SK Hub Systems アカウント")) : t("ログイン"));
      if (hint && hint.photo) {
        var img = el("img");
        img.src = hint.photo;
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        me.appendChild(img);
      } else if (hint) {
        me.textContent = hint.letter || "?";
        me.style.background = hint.color || "#2563eb";
        me.style.color = "#fff";
      } else {
        me.appendChild(icon("account_circle"));
      }
    }
    updaters.push(drawMe);
    var search = el("label", "tbs-search");
    search.appendChild(icon("search"));
    var q = el("input");
    q.type = "search";
    q.placeholder = t("設定を検索");
    q.setAttribute("aria-label", t("設定を検索"));
    search.appendChild(q);
    var none = el("p", "tbs-search__none", t("見つかりませんでした"));
    none.hidden = true;
    if (!IN_LINE) listHead.appendChild(me);
    listHead.append(bigTitle, search);
    side.appendChild(listHead);
    // 検索: カテゴリの名前・要約と、そのページの中の文字で、一覧をしぼる
    q.addEventListener("input", function () {
      var v = q.value.trim().toLowerCase(), any = false;
      navBtns.forEach(function (b, i) {
        var hit = !v || (b.textContent + " " + pages[i].textContent).toLowerCase().indexOf(v) >= 0;
        b.hidden = !hit;
        if (hit) any = true;
      });
      [].forEach.call(side.querySelectorAll(".tbs-nav__heading"), function (h) {
        var n = h.nextElementSibling, vis = false;
        while (n && !n.classList.contains("tbs-nav__heading")) { if (n.classList.contains("tbs-nav__item") && !n.hidden) vis = true; n = n.nextElementSibling; }
        h.hidden = !vis;
      });
      none.hidden = any;
    });
    // スマホ（せまい画面）: 最初はカテゴリの一覧だけ。押すとその中身に切りかわり、戻るで一覧に戻る（is-detail）。パソコンでは左右に両方出す
    var back = el("button", "tbs-body__back m3-state");
    back.type = "button";
    back.append(icon("arrow_back"), el("span", "", t("設定")));
    back.addEventListener("click", function () { toList(); });
    body.appendChild(back);
    function toList() {
      layout.classList.remove("is-detail");
      side.scrollTop = 0;
    }
    layout.toList = toList;
    function show(id, open) {
      if (open) layout.classList.add("is-detail");
      pages.forEach(function (p) { p.hidden = p.getAttribute("data-page") !== id; });
      navBtns.forEach(function (b) {
        var on = b.getAttribute("data-page") === id;
        b.classList.toggle("is-active", on);
        if (on) {
          b.setAttribute("aria-current", "page");
          if (b.scrollIntoView && side.scrollWidth > side.clientWidth) b.scrollIntoView({ block: "nearest", inline: "nearest" });
        } else b.removeAttribute("aria-current");
      });
      body.scrollTop = 0;
      roundCards(body);
    }
    // カテゴリの行。スマホでは Android の設定アプリと同じ形（色つきの丸のアイコン・名前・中身の要約）。パソコンでは要約は出さない
    function page(id, ic, title, img, sub, color) {
      var b = el("button", "tbs-nav__item m3-state");
      b.type = "button";
      b.setAttribute("data-page", id);
      if (img) {
        var im = el("img", "tbs-nav__img");
        im.src = img;
        im.alt = "";
        b.appendChild(im);
      } else {
        var ics = el("span", "tbs-nav__ic");
        if (color) ics.style.setProperty("--c", color);
        ics.appendChild(icon(ic));
        b.appendChild(ics);
      }
      var txt = el("span", "tbs-nav__text");
      txt.appendChild(el("span", "tbs-nav__title", title));
      if (sub) txt.appendChild(el("span", "tbs-nav__sub", sub));
      b.appendChild(txt);
      b.addEventListener("click", function () { show(id, true); });
      side.appendChild(b);
      navBtns.push(b);
      var p = el("section", "tbs-page");
      p.setAttribute("data-page", id);
      p.setAttribute("aria-label", title);
      p.hidden = true;
      p.appendChild(el("h3", "tbs-page__title", title));
      body.appendChild(p);
      pages.push(p);
      return p;
    }
    var installed = (window.matchMedia && matchMedia("(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: minimal-ui)").matches) || navigator.standalone === true;

    // ---- 全般 ----
    var general = page("general", "tune", t("全般"), null, t("言語・ホームの最初の画面"), "#3b82f6");
    var basic = section(t("基本"));
    var langName = "";
    if (I18N) I18N.LANGS.forEach(function (l) { if (l.code === I18N.lang) langName = l.name; });
    // 言語を選んだら、いま開いているアプリ（またはこの設定のページ）に戻る（Toolbox の言語の画面 /toolbox/lang/?next=戻り先）
    var langLink = linkRow("/toolbox/lang/", "language", t("言語"), langName);
    updaters.push(function () { langLink.href = "/toolbox/lang/?next=" + encodeURIComponent(location.pathname + location.search + location.hash); });
    langLink.addEventListener("click", function () { langLink.href = "/toolbox/lang/?next=" + encodeURIComponent(location.pathname + location.search + location.hash); });
    basic.appendChild(langLink);
    // ホーム（/toolbox/）を開いたときに、ウィジェットとアプリ一覧のどちらを出すか（/toolbox/home.js と、ホームの <head> の小さなスクリプト）
    basic.appendChild(segRow(t("ホームの最初の画面"), t("SK's Toolbox のホームを開いたときに出す画面"),
      [["last", "history", t("前回の画面")], ["widgets", "dashboard", t("ウィジェット")], ["apps", "apps", t("アプリ一覧")]],
      function () { return settings.homeStart; }, function (v) { set({ homeStart: v }); }));
    general.appendChild(basic);
    var links = section(t("リンク"));
    links.appendChild(linkRow("/toolbox/", "apps", t("SK's Toolbox のアプリ一覧"), ""));
    // アプリとして入れる方法（/toolbox/install/。アプリとして開いているときは出さない）
    if (!installed && !IN_LINE) links.appendChild(linkRow("/toolbox/install/", "install_mobile", t("アプリとして入れる方法"), t("ホーム画面・Dock から開けて、オフラインでも使えます")));
    general.appendChild(links);

    // ---- アカウントと同期（LINE の中では、LINE でログインする。公式 LINE の設定も出す）----
    var acc = page("account", "account_circle", t("アカウントと同期"), null, IN_LINE ? t("LINE でログイン・オンライン同期・公式 LINE") : t("SK Hub Systems アカウント・オンライン同期"), "#0ea5a4");
    acc.appendChild(accountSection());
    // オンライン同期（任意。中身は /toolbox/shared/sync.js）
    var syncSec = section(t("オンライン同期"));
    var syncBox = el("div");
    syncBox.setAttribute("data-tb-sync", "");
    syncSec.appendChild(syncBox);
    if (window.SKToolboxSync) SKToolboxSync.mount(syncBox);
    acc.appendChild(syncSec);
    if (IN_LINE) acc.appendChild(lineSection());

    // ---- 見た目 ----
    var look = page("look", "palette", t("見た目"), null, t("テーマ・テーマカラー・動き"), "#8b5cf6");
    var lookSec = section(t("色"));
    var themeRow = segRow(t("テーマ"), scope === "clock" ? t("Clock は、時計の下のボタンでテーマを選びます") : "",
      [["auto", "brightness_auto", t("端末に合わせる")], ["light", "light_mode", t("ライト")], ["dark", "dark_mode", t("ダーク")]],
      function () { return settings.theme; }, function (v) { set({ theme: v }); });
    lookSec.appendChild(themeRow);
    var colorRow = el("div", "tbs-item tbs-item--col");
    colorRow.appendChild(label(t("テーマカラー"), t("Calc・Memo・Todo のボタンや背景の色。SK's Brand の色から選べます。Clock は空の色のままです")));
    var sw = el("div", "tbs-swatches");
    sw.setAttribute("role", "radiogroup");
    sw.setAttribute("aria-label", t("テーマカラー"));
    var current = el("p", "tbs-swatch-name");
    current.setAttribute("aria-live", "polite");
    [{ key: "app", name: t("アプリの色"), note: t("Calc は青、Memo はオレンジ、Todo は緑") }].concat(COLORS).forEach(function (c) {
      var b = el("button", "tbs-swatch m3-state" + (c.key === "app" ? " tbs-swatch--app" : ""));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", c.name + "（" + c.note + "）");
      b.title = c.name + "（" + c.note + "）";
      if (c.sw) b.style.setProperty("--sw", c.sw);
      b.appendChild(icon("check"));
      b.addEventListener("click", function () { set({ color: c.key }); });
      updaters.push(function () {
        var on = settings.color === c.key;
        b.setAttribute("aria-checked", String(on));
        if (on) current.textContent = c.name + " — " + c.note;
      });
      sw.appendChild(b);
    });
    colorRow.appendChild(sw);
    colorRow.appendChild(current);
    lookSec.appendChild(colorRow);
    look.appendChild(lookSec);
    var motionSec = section(t("動き"));
    motionSec.appendChild(switchRow(t("動きを減らす"), t("画面の切りかえや、ボタンのアニメーションを少なくします"),
      function () { return settings.motion === "reduce"; }, function (on) { set({ motion: on ? "reduce" : "auto" }); }));
    look.appendChild(motionSec);

    // ---- 操作 ----
    var usePage = page("use", "touch_app", t("操作"), null, navigator.windowControlsOverlay && !IN_LINE ? t("振動・アイコンの数字・タイトルバー") : t("振動・アイコンの数字"), "#f08c00");
    var use = section(t("タッチとアイコン"));
    use.appendChild(switchRow(t("押したときに振動する"), t("Calc のキーと、Todo のチェック。対応している端末（Android など）だけです"),
      function () { return settings.haptics; }, function (on) { set({ haptics: on }); vibrate(); }));
    // アプリのアイコンの数字（Badging API。対応しているブラウザで、アプリとして入れたとき）
    if (navigator.setAppBadge && !IN_LINE) {
      use.appendChild(switchRow(t("アイコンに数字を出す"), t("アプリとして入れたとき、Dock やホーム画面のアイコンに、期限切れと今日の Todo の数を出します"),
        function () { return settings.badge; }, function (on) {
          set({ badge: on });
          if (!on) navigator.clearAppBadge().catch(function () {});
          else if (window.SKReminders) SKReminders.check();
        }));
    }
    usePage.appendChild(use);
    // タイトルバー（パソコンの Chrome・Edge でアプリとして入れ、タイトルバーを Toolbox のものにしたとき）
    if (navigator.windowControlsOverlay && !IN_LINE) usePage.appendChild(titlebarSection());

    // ---- 通知（LINE の中では出さない）----
    if (!IN_LINE && "Notification" in window) {
      var notifyPage = page("notify", "notifications", t("通知"), null, t("許可・Todo・Clock"), "#ef4444");
      var perm = section(t("このブラウザ"));
      var permRow = el("div", "tbs-item");
      permRow.appendChild(icon("notifications_active"));
      var permLabel = label(t("通知の許可"), " ");
      permRow.appendChild(permLabel);
      var permBtn = el("button", "m3-btn m3-btn--tonal m3-state", t("許可する"));
      permBtn.type = "button";
      permRow.appendChild(permBtn);
      var permSub = permLabel.querySelector(".tbs-label__sub");
      updaters.push(function () {
        var p = Notification.permission;
        permSub.textContent = p === "granted" ? t("許可しています。Todo の期限やアラームを通知で知らせます")
          : p === "denied" ? t("ブロックされています。ブラウザのサイトの設定で許可してください")
          : t("まだ許可していません");
        permBtn.hidden = p !== "default";
      });
      permBtn.addEventListener("click", function () {
        Notification.requestPermission().then(function () { refreshUi(); }).catch(function () {});
      });
      perm.appendChild(permRow);
      notifyPage.appendChild(perm);
      var kinds = section(t("通知するもの"));
      kinds.appendChild(appSwitch("todo", "notify", t("Todo のリマインダー"), t("期限の日時になったタスクを知らせます")));
      kinds.appendChild(appSwitch("clock", "notify", t("Clock のアラームとタイマー"), t("Clock を開いていないときも、鳴った時刻に知らせます")));
      notifyPage.appendChild(kinds);
    }

    // ---- データ ----
    var dataPage = page("data", "storage", t("データ"), null, t("アプリごとのデータ・バックアップ"), "#22a06b");
    var data = section(t("この端末のデータ"));
    var dataNote = el("p", "tbs-text");
    data.appendChild(dataNote);
    // データを消されにくくする（storage.persist。アプリとして入れると、たいてい自動でオンになる）
    if (navigator.storage && navigator.storage.persisted && !IN_LINE) {
      var keep = el("div", "tbs-item tbs-item--keep");
      keep.appendChild(icon("verified_user"));
      var keepLabel = label(t("データの保護"), t("確認中…"));
      keep.appendChild(keepLabel);
      var keepBtn = el("button", "text-btn m3-state", t("オンにする"));
      keepBtn.type = "button";
      keepBtn.hidden = true;
      keep.appendChild(keepBtn);
      data.appendChild(keep);
      var keepSub = keepLabel.querySelector(".tbs-label__sub");
      var drawKeep = function () {
        navigator.storage.persisted().then(function (on) {
          keepSub.textContent = on
            ? t("オン: 端末の空きが少なくなっても、ブラウザが Toolbox のデータを自動で消しません")
            : t("オフ: 端末の空きが少ないとき、ブラウザが Toolbox のデータを消すことがあります");
          keepBtn.hidden = on || !navigator.storage.persist;
        }).catch(function () { keep.hidden = true; });
      };
      keepBtn.addEventListener("click", function () {
        navigator.storage.persist().then(function (ok) {
          drawKeep();
          if (!ok && window.M3) M3.dialog({ title: t("データの保護"), icon: "info", body: el("p", "tbs-dialog__text", t("ブラウザに許可されませんでした。Toolbox をアプリとして入れると、オンになりやすくなります")), actions: [{ label: "OK", primary: true, value: null }] });
        }).catch(drawKeep);
      });
      drawKeep();
    }
    updaters.push(function () {
      dataNote.textContent = syncOn()
        ? t("Toolbox のデータは、この端末のブラウザに保存し、オンライン同期で暗号化して SK Hub Systems アカウントにも保存しています。ここで消去しても、次に同期するときにアカウントから読み込み直します。")
        : t("Toolbox のデータは、この端末のブラウザにだけ保存されます。SK Hub Systems などには送られません。ブラウザのデータを消すと、Toolbox のデータも消えます。");
    });
    dataPage.appendChild(data);
    var appsData = section(t("アプリごとのデータ"));
    APPS.forEach(function (a) { appsData.appendChild(dataRow(a)); });
    dataPage.appendChild(appsData);
    // まとめてバックアップ（Clock・Calc・Memo（画像も）・Todo・Countdown・Timetable・Roulette・この設定）
    var backup = section(t("バックアップ"));
    var backupRow = el("div", "tbs-item tbs-item--backup");
    backupRow.appendChild(label(t("まとめてバックアップ"), t("すべてのアプリのデータを 1 つのファイルに。ほかの端末に移すときにも使えます")));
    var exportBtn = el("button", "m3-btn m3-btn--tonal m3-state");
    exportBtn.type = "button";
    exportBtn.append(icon("download"), el("span", "", t("書き出す")));
    var importBtn = el("button", "text-btn m3-state");
    importBtn.type = "button";
    importBtn.append(icon("upload"), el("span", "", t("読み込む")));
    var fileIn = el("input");
    fileIn.type = "file";
    fileIn.accept = "application/json,.json";
    fileIn.hidden = true;
    var btns = el("span", "tbs-backup__btns");
    btns.append(exportBtn, importBtn, fileIn);
    backupRow.appendChild(btns);
    exportBtn.addEventListener("click", exportAll);
    importBtn.addEventListener("click", function () { fileIn.click(); });
    fileIn.addEventListener("change", function () {
      var f = fileIn.files && fileIn.files[0];
      fileIn.value = "";
      if (f) importAll(f);
    });
    backup.appendChild(backupRow);
    var allRow = el("div", "tbs-item tbs-item--end");
    var allBtn = el("button", "text-btn tbs-danger m3-state", t("Toolbox のデータをすべて消去"));
    allBtn.type = "button";
    allBtn.addEventListener("click", function () {
      confirmDialog(t("Toolbox のデータをすべて消去しますか？"),
        t("Clock・Calc・Memo・Todo・Countdown・Timetable・Roulette のデータと、この設定を消去します。元に戻すことはできません。"), t("すべて消去"))
        .then(function (ok) {
          if (!ok) return;
          Promise.all(APPS.concat([{ key: STORE }]).map(clearApp)).then(function () { location.reload(); });
        });
    });
    allRow.appendChild(allBtn);
    backup.appendChild(allRow);
    dataPage.appendChild(backup);

    // ---- このアプリについて ----
    var about = page("about", "info", t("このアプリについて"), null, t("更新・バージョン・規約"), "#64748b");
    about.appendChild(aboutHead("/toolbox/icon.svg", "SK's Toolbox", t("毎日ちょっと使う、小さなアプリを集めた SK の道具箱です。")));
    var aboutSec = section("");
    // 更新の確認（Nagi・MALU と同じ。この画面の Service Worker に新しい版がないか確かめる。見つけたらボタンが「再読み込み」に変わる）
    var upd = el("div", "tbs-item tbs-item--update");
    var updMark = el("span", "tbs-update__mark");
    var updIcon = icon("check");
    updMark.appendChild(updIcon);
    upd.appendChild(updMark);
    var updLabel = label(t("SK's Toolbox は最新です"), t("更新は、開いたときに自動で確かめて反映します。"));
    upd.appendChild(updLabel);
    var updBtn = el("button", "m3-btn m3-btn--tonal m3-state", t("更新を確認"));
    updBtn.type = "button";
    upd.appendChild(updBtn);
    var updFound = false;
    function updState(state, text) {
      upd.setAttribute("data-state", state);
      updIcon.textContent = state === "checking" ? "progress_activity" : state === "new" ? "upgrade" : state === "error" ? "error" : "check";
      updLabel.querySelector(".tbs-label__title").textContent = text;
    }
    updBtn.addEventListener("click", function () {
      if (updFound) { location.reload(); return; }
      if (!navigator.serviceWorker) { updState("error", t("この端末では更新を確認できません")); return; }
      updBtn.disabled = true;
      updState("checking", t("更新を確認しています…"));
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (!reg) throw new Error("no registration");
        return reg.update().then(function () { return reg; });
      }).then(function (reg) {
        updFound = !!(reg.installing || reg.waiting);
        if (updFound) { updState("new", t("新しい版が見つかりました")); updBtn.textContent = t("再読み込み"); }
        else updState("ok", t("SK's Toolbox は最新です"));
      }).catch(function () {
        updState("error", t("更新を確認できませんでした。インターネットの接続を確かめてください"));
      }).then(function () { updBtn.disabled = false; });
    });
    aboutSec.appendChild(upd);
    // バージョン。「1.0（ビルド 22）」… ビルドは、この端末に入っている Service Worker のキャッシュの番号（/toolbox/sw.js の sk-toolbox-v…）
    var verRow = el("div", "tbs-item");
    var verLabel = label(t("バージョン"), VERSION);
    verRow.appendChild(verLabel);
    aboutSec.appendChild(verRow);
    builds().then(function (b) {
      if (b.toolbox) verLabel.querySelector(".tbs-label__sub").textContent = t("{version}（ビルド {build}）", { version: VERSION, build: b.toolbox });
    });
    // 最新の版に更新（古いファイルが残って、新しい機能が出てこないとき）
    var updRow = el("button", "tbs-item tbs-item--link tbs-item--button m3-state");
    updRow.type = "button";
    updRow.appendChild(icon("system_update"));
    var forceLabel = label(t("最新の版に更新"), t("保存してある古いファイルを消して、Toolbox を最新の状態で読み込み直します。データは消えません"));
    updRow.appendChild(forceLabel);
    updRow.appendChild(icon("refresh"));
    updRow.addEventListener("click", function () {
      if (updRow.disabled) return;
      updRow.disabled = true;
      forceLabel.querySelector(".tbs-label__title").textContent = t("更新しています…");
      forceUpdate();
    });
    aboutSec.appendChild(updRow);
    aboutSec.appendChild(linkRow("/policies/", "policy", t("利用規約・プライバシーポリシー"), t("SK's Toolbox は SK 利用規約・SK プライバシーポリシーのもとで提供しています。")));
    about.appendChild(aboutSec);

    // ---- アプリ別 ----
    side.appendChild(el("p", "tbs-nav__heading", t("アプリ")));
    APPS.forEach(function (a) {
      // LINE の中では、LINE 版で外している Calc・Memo のページは出さない（ホームの .tbh-app--noline と同じ）
      if (IN_LINE && (a.app === "calc" || a.app === "memo")) return;
      var p = page("app-" + a.app, null, a.name, "/toolbox/" + a.app + "/icon.svg", APP_DESC[a.app] || "");
      p.appendChild(aboutHead("/toolbox/" + a.app + "/icon.svg", a.name, APP_DESC[a.app] || ""));
      var opts = section(t("設定"));
      var any = true;
      if (a.app === "clock") {
        if (!IN_LINE && "Notification" in window) opts.appendChild(appSwitch("clock", "notify", t("アラームとタイマーを通知する"), t("Clock を開いていないときも、鳴った時刻に知らせます")));
        opts.appendChild(el("p", "tbs-text", t("時刻の表示（24 時間表示・秒・日付・文字の大きさ）とテーマは、Clock の画面の設定ボタンから変えられます。")));
      } else if (a.app === "calc") {
        opts.appendChild(appSwitch("calc", "history", t("計算の履歴を残す"), t("オフにすると、新しい計算を履歴に入れません")));
        opts.appendChild(appSwitch("calc", "group", t("3 けたごとに区切る"), t("答えを「1,234,567」のように表示します")));
      } else if (a.app === "memo") {
        opts.appendChild(segRow(t("ごみ箱に残す日数"), t("消したメモは、この日数がたつと自動で消えます"),
          [[7, "event", t("{n} 日", { n: 7 })], [30, "date_range", t("{n} 日", { n: 30 })], [90, "calendar_month", t("{n} 日", { n: 90 })]],
          function () { return settings.apps.memo.trashDays; }, function (v) { setApp("memo", { trashDays: v }); }));
      } else if (a.app === "todo") {
        if (!IN_LINE && "Notification" in window) opts.appendChild(appSwitch("todo", "notify", t("リマインダーを通知する"), t("期限の日時になったタスクを知らせます")));
        opts.appendChild(el("p", "tbs-text", t("完了済みの表示と並べ替えは、リストごとに Todo の画面で選べます。")));
      } else if (a.app === "roulette") {
        opts.appendChild(el("p", "tbs-text", t("効果音は、Roulette の画面のスピーカーのボタンで切りかえられます。")));
      } else if (a.app === "countdown") {
        opts.appendChild(el("p", "tbs-text", t("過ぎた日の表示は、Countdown の画面で切りかえられます。")));
      } else if (a.app === "timetable") {
        opts.appendChild(el("p", "tbs-text", t("時限の時刻・曜日・試験週などの特別な時間割は、Timetable の画面で編集できます。")));
      } else {
        any = false;
      }
      if (any) p.appendChild(opts);
      var dsec = section(t("データ"));
      dsec.appendChild(dataRow(a));
      p.appendChild(dsec);
      var more = section("");
      if (a.app !== currentApp) more.appendChild(linkRow("/toolbox/" + a.app + "/", "open_in_new", t("{app} を開く", { app: a.name }), ""));
      var bRow = el("div", "tbs-item");
      var bLabel = label(t("ビルド"), "—");
      bRow.appendChild(bLabel);
      more.appendChild(bRow);
      builds().then(function (b) { bLabel.querySelector(".tbs-label__sub").textContent = b[a.app] ? String(b[a.app]) : t("まだ開いていません"); });
      p.appendChild(more);
    });

    side.appendChild(none);
    show("general");
    refreshUi();
    var round = function () { roundCards(body); };
    updaters.push(round);
    round();
    return layout;
  }

  // ---- 最新の版に更新 ----
  //   1. Toolbox の Service Worker を外す（次に開いたときに、新しいものが入る）
  //   2. Toolbox の Service Worker が保存したファイル（sk-toolbox-・sk-todo- など）を消す
  //   3. このページが読み込んだファイルを、ブラウザのキャッシュを使わずに取り直す
  //   4. 開き直す。localStorage・IndexedDB（データ）には触らない
  function forceUpdate() {
    var jobs = [];
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (regs) {
        return Promise.all(regs.filter(function (r) { return new URL(r.scope).pathname.indexOf("/toolbox/") === 0; }).map(function (r) { return r.unregister(); }));
      }).catch(function () { /* 外せなくても続ける */ }));
    }
    if (window.caches) {
      jobs.push(caches.keys().then(function (keys) {
        return Promise.all(keys.filter(function (k) { return /^sk-(toolbox|clock|calc|memo|todo|countdown|timetable|roulette)-/.test(k); }).map(function (k) { return caches.delete(k); }));
      }).catch(function () { /* 同上 */ }));
    }
    Promise.all(jobs).then(function () {
      var urls = [location.pathname + location.search];
      try {
        performance.getEntriesByType("resource").forEach(function (e) {
          var u = new URL(e.name);
          if (u.origin === location.origin && urls.indexOf(u.pathname + u.search) < 0) urls.push(u.pathname + u.search);
        });
      } catch (e) { /* 取れなければ、このページだけ */ }
      return Promise.all(urls.map(function (u) { return fetch(u, { cache: "reload" }).catch(function () { /* オフラインなど */ }); }));
    }).then(function () { location.reload(); });
  }

  // 全画面のダイアログで開く（端末の「戻る」で閉じる）
  var dialog = null, opener = null;
  function openSettings() {
    if (dialog) return;
    opener = document.activeElement;
    dialog = el("div", "tbs-overlay" + (scope === "clock" ? " tbs-overlay--clock" : ""));
    var panel = el("div", "tbs-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "tbs-title");
    var bar = el("header", "tbs-bar");
    var close = el("button", "icon-btn m3-state");
    close.type = "button";
    close.setAttribute("aria-label", t("戻る"));
    close.appendChild(icon("arrow_back"));
    var h = el("h2", "tbs-bar__title", t("Toolbox の設定"));
    h.id = "tbs-title";
    bar.append(close, h);
    panel.append(bar, buildSettings());
    dialog.appendChild(panel);
    document.body.appendChild(dialog);
    document.body.classList.add("tbs-open");
    close.focus();
    close.addEventListener("click", function () {
      var lay = panel.querySelector(".tbs-layout");
      if (lay && lay.classList.contains("is-detail") && window.matchMedia("(max-width: 820px)").matches) lay.toList();
      else closeSettings();
    });
    dialog.addEventListener("click", function (e) { if (e.target === dialog) closeSettings(); });
    dialog.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); closeSettings(); } });
    history.pushState(Object.assign({}, history.state, { tbSettings: true }), "");
  }
  function closeSettings(fromPop) {
    if (!dialog) return;
    dialog.remove();
    dialog = null;
    updaters = [];
    document.body.classList.remove("tbs-open");
    if (opener && opener.focus) opener.focus();
    if (fromPop !== true && history.state && history.state.tbSettings) history.back();
  }
  window.addEventListener("popstate", function (e) {
    if (dialog && !(e.state && e.state.tbSettings)) closeSettings(true);
  }, true);
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-open-settings]");
    if (b) { e.preventDefault(); openSettings(); }
  });

  // /toolbox/settings/ のページに、そのまま出す
  function renderSettings(container) {
    container.textContent = "";
    container.appendChild(buildSettings());
  }

  window.SKToolbox = {
    get: function () { return settings; },
    // アプリ別の設定（例: SKToolbox.app("calc").history）
    app: function (name) { return settings.apps[name] || {}; },
    set: set,
    onChange: function (fn) { listeners.push(fn); fn(settings); },
    vibrate: vibrate,
    // テーマカラーの一覧（SK's Brand の色。"app" は各アプリの色）。ホーム画面の「見た目」でも使う
    colors: [{ key: "app", name: t("アプリの色"), note: t("Calc は青、Memo はオレンジ、Todo は緑") }].concat(COLORS),
    openSettings: openSettings,
    renderSettings: renderSettings,
    forceUpdate: forceUpdate,
    inLine: IN_LINE
  };

  // オンライン同期（任意）。見本（?embed）では読み込まない（LINE の中でも、LINE でログインすれば使える）
  if (!/[?&]embed\b/.test(location.search)) {
    var sync = document.createElement("script");
    sync.src = "/toolbox/shared/sync.js";
    (document.head || document.documentElement).appendChild(sync);
  }
})();
