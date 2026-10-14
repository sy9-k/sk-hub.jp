// SK's Toolbox のタイトルバー（パソコンの Chrome・Edge でアプリとして入れたとき。Window Controls Overlay）
//   ・manifest の display_override: ["window-controls-overlay"] で、ウィンドウのいちばん上の帯をページが使えるようになる
//     （右上・左上の閉じるボタンなどはブラウザが上に重ねる。タイトルバーの右の「∧」で、ふつうのタイトルバーに戻せる）
//   ・帯の中身: Toolbox のアイコンといまのアプリの名前・アプリの切りかえ・検索（⌘K）・設定。真ん中は /toolbox/shared/tbcenter.js
//     どれを出すかは Toolbox の設定の「タイトルバー」で選べる（settings.titlebar。消したものは <div class="tbt" data-off="apps search"> のように）
//     何もないところをドラッグすると、ウィンドウを動かせる（app-region: drag）
//   ・見た目と、中身をタイトルバーの分だけ下げるのは /toolbox/shared/m3.css（@media (display-mode: window-controls-overlay)）。
//     Clock は空をタイトルバーの下まで広げる（<html data-tbt="overlay">）
//   ・各ページの <head> で、/toolbox/shared/settings.js のあとに読み込む（対応していないブラウザでは何もしない）
//   ・画面の切りかえ（View Transitions）では、タイトルバーだけ切り出して動かさない（/toolbox/shared/m3.css）
(function () {
  "use strict";
  if (!navigator.windowControlsOverlay || document.querySelector(".tbt")) return;

  var I18N = window.SKI18N;
  function t(s) { return I18N ? I18N.t(s) : s; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function icon(name) { var s = el("span", "msr", name); s.setAttribute("aria-hidden", "true"); return s; }

  var APPS = [
    { path: "/toolbox/clock/", name: "Clock" },
    { path: "/toolbox/calc/", name: "Calc" },
    { path: "/toolbox/memo/", name: "Memo" },
    { path: "/toolbox/todo/", name: "Todo" },
    { path: "/toolbox/countdown/", name: "Countdown" },
    { path: "/toolbox/timetable/", name: "Timetable" },
    { path: "/toolbox/roulette/", name: "Roulette" }
  ];
  var path = location.pathname;
  var current = null;
  APPS.forEach(function (a) { if (path.indexOf(a.path) === 0) current = a; });
  var currentName = current ? current.name : path.indexOf("/toolbox/settings/") === 0 ? t("設定") : "";


  // ================================================================
  // メニューバー
  //   ・アプリの名前（太字）・ファイル・編集・表示・移動・ウィンドウ・ヘルプ
  //   ・中身はメニューを開いたときに作る。アプリごとの項目は、そのアプリの画面にあるボタン（「その他」のメニューなど）を押すのと同じ
  //   ・マウスで押しても、文字を書いているところからフォーカスを動かさない（「編集」の取り消し・コピーなどがそこに効くように）
  //   ・←→ でメニュー、↑↓ で項目、Enter で実行、Esc で閉じる。どれかを開いているときは、マウスを乗せるだけで隣に移る
  // ================================================================
  var isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  var MOD = isMac ? "⌘" : "Ctrl+";
  function shown(node) { return node && !node.hidden && !node.disabled && getComputedStyle(node).display !== "none"; }
  function labelOf(node) {
    var parts = [];
    node.querySelectorAll("span:not(.msr)").forEach(function (s) { if (!s.querySelector("span:not(.msr)") && s.textContent.trim()) parts.push(s.textContent.trim()); });
    return parts.join(" ") || node.getAttribute("aria-label") || node.title || node.textContent.trim();
  }
  // 画面にあるボタンを、メニューの項目にする（なければ出さない）
  function proxy(sel, label, extra) {
    return function () {
      var b = document.querySelector(sel);
      if (!b || (!shown(b) && !(extra && extra.evenHidden))) return null;
      var pressed = b.getAttribute("aria-pressed");
      return { label: label || labelOf(b), check: pressed === null ? undefined : pressed === "true", key: extra && extra.key, run: function () { b.click(); } };
    };
  }
  // そのアプリの「その他」（#menu の中の項目）
  function appMenuItems() {
    var list = [];
    document.querySelectorAll('#menu [role="menuitem"]').forEach(function (b) {
      if (b.hidden || getComputedStyle(b).display === "none") return;
      list.push({ label: labelOf(b), run: function () { b.click(); } });
    });
    return list;
  }
  var APP_FILE = {
    "/toolbox/memo/": [proxy("#btn-new", null, { evenHidden: true })],
    "/toolbox/todo/": [proxy("#btn-new"), proxy("#btn-add-list")],
    "/toolbox/countdown/": [proxy("#btn-add", t("新しい日を追加"))],
    "/toolbox/timetable/": [],
    "/toolbox/roulette/": []
  };
  var APP_VIEW = {
    "/toolbox/clock/": [proxy("#btn-24h", t("24 時間表示")), proxy("#btn-sec"), proxy("#btn-night"), proxy("#btn-wake"), proxy("#btn-theme", t("背景・大きさ…")), proxy("#btn-pip")],
    "/toolbox/calc/": [proxy("#btn-sci"), proxy("#btn-history")],
    "/toolbox/todo/": [proxy("#btn-cal")],
    "/toolbox/roulette/": [proxy("#btn-sound")]
  };
  var editTarget = null; // 「編集」を効かせるところ（メニューを開く前にフォーカスがあったところ）
  function editCmd(cmd) {
    return function () {
      if (editTarget && editTarget.focus && document.activeElement !== editTarget) editTarget.focus();
      if (cmd === "paste") {
        if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(function (text) { document.execCommand("insertText", false, text); }).catch(function () {});
        return;
      }
      try { document.execCommand(cmd); } catch (e) { /* できないときは何もしない */ }
    };
  }
  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(function () {});
  }
  function go(url) { return function () { location.href = url; }; }
  function setting(patch) { return function () { if (window.SKToolbox) SKToolbox.set(patch); }; }
  function openSettings() { if (window.SKToolbox) SKToolbox.openSettings(); }
  function appKey() { return current ? current.path : ""; }
  function resolve(list) {
    var out = [];
    list.forEach(function (x) { var r = typeof x === "function" ? x() : x; if (r) out.push(r); });
    return out;
  }
  // SK のホームページ（サイトのヘッダーと同じ）。タイトルバーを Toolbox のものにしているときは、サイトのヘッダーを隠し、
  // メニューバーの「SK」か、タイトルバーの SK のボタンから開く
  function sitePath(url) { return I18N && I18N.path ? I18N.path(url) : url; }
  function siteItems() {
    return [
      { label: t("SK のホームページ"), run: go(sitePath("/")) },
      "-",
      { label: t("私について"), run: go(sitePath("/about/")) },
      { label: t("プロダクト"), run: go(sitePath("/products/")) },
      { label: t("サポートと情報"), run: go(sitePath("https://support.sk-hub.jp/")) },
      { label: t("アカウント"), run: go(sitePath("/account/")) },
      "-",
      { label: t("言語…"), run: go("/toolbox/lang/?next=" + encodeURIComponent(location.pathname + location.search)) }
    ];
  }
  function menus() {
    var s = window.SKToolbox ? SKToolbox.get() : {};
    var editable = editTarget && (editTarget.isContentEditable || /^(INPUT|TEXTAREA)$/.test(editTarget.tagName));
    var fileApp = resolve(APP_FILE[appKey()] || []), more = appMenuItems(), viewApp = resolve(APP_VIEW[appKey()] || []);
    return [
      { title: currentName && current ? current.name : "SK's Toolbox", bold: true, items: [
        { label: t("Toolbox の設定…"), key: MOD + ",", run: openSettings },
        { label: t("最新の版に更新"), run: function () { if (window.SKToolbox && SKToolbox.forceUpdate) SKToolbox.forceUpdate(); else location.reload(); } },
        "-",
        { label: t("SK's Toolbox のホーム"), run: go("/toolbox/") }
      ] },
      { title: t("ファイル"), items: fileApp.concat(fileApp.length && more.length ? ["-"] : [], more, (fileApp.length || more.length) ? ["-"] : [], [
        { label: t("印刷…"), key: MOD + "P", run: function () { window.print(); } }
      ]) },
      { title: t("編集"), items: [
        { label: t("取り消す"), key: MOD + "Z", disabled: !editable, run: editCmd("undo") },
        { label: t("やり直す"), key: isMac ? "⇧⌘Z" : "Ctrl+Y", disabled: !editable, run: editCmd("redo") },
        "-",
        { label: t("カット"), key: MOD + "X", disabled: !editable, run: editCmd("cut") },
        { label: t("コピー"), key: MOD + "C", run: editCmd("copy") },
        { label: t("ペースト"), key: MOD + "V", disabled: !editable, run: editCmd("paste") },
        { label: t("すべてを選択"), key: MOD + "A", run: editCmd("selectAll") },
        "-",
        { label: t("検索・コマンド…"), key: MOD + "K", run: function () { if (window.SKSearch) SKSearch.open(); } }
      ] },
      { title: t("表示"), items: viewApp.concat(viewApp.length ? ["-"] : [], [
        { label: t("テーマ: 端末に合わせる"), check: s.theme === "auto", run: setting({ theme: "auto" }) },
        { label: t("テーマ: ライト"), check: s.theme === "light", run: setting({ theme: "light" }) },
        { label: t("テーマ: ダーク"), check: s.theme === "dark", run: setting({ theme: "dark" }) },
        "-",
        { label: t("動きを減らす"), check: s.motion === "reduce", run: setting({ motion: s.motion === "reduce" ? "auto" : "reduce" }) },
        { label: document.fullscreenElement ? t("全画面表示を終了") : t("全画面表示にする"), run: fullscreen },
        "-",
        { label: t("タイトルバーの設定…"), run: openSettings }
      ]) },
      { title: t("移動"), items: [
        { label: t("戻る"), key: isMac ? "⌘[" : "Alt+←", run: function () { history.back(); } },
        { label: t("進む"), key: isMac ? "⌘]" : "Alt+→", run: function () { history.forward(); } },
        "-",
        { label: t("ホーム"), check: path === "/toolbox/" || path === "/toolbox/index.html", run: go("/toolbox/") }
      ].concat(APPS.map(function (a) { return { label: a.name, check: a === current, run: go(a.path) }; }), ["-",
        { label: t("設定"), check: path.indexOf("/toolbox/settings/") === 0, run: go("/toolbox/settings/") }
      ]) },
      { title: t("ウィンドウ"), items: [
        { label: t("新しいウィンドウ"), run: function () { window.open(location.href, "_blank"); } },
        { label: document.fullscreenElement ? t("全画面表示を終了") : t("全画面表示にする"), run: fullscreen },
        "-",
        { label: t("ページを読み込み直す"), key: MOD + "R", run: function () { location.reload(); } }
      ] },
      { title: "SK", items: siteItems() },
      { title: t("ヘルプ"), items: [
        { label: t("検索・コマンド…"), key: MOD + "K", run: function () { if (window.SKSearch) SKSearch.open(); } },
        { label: t("ヘルプとサポート"), run: go("https://support.sk-hub.jp/") },
        { label: t("お問い合わせ"), run: go("https://support.sk-hub.jp/contact/") }
      ] }
    ];
  }

  function buildMenubar(bar, brand) {
    var mb = el("div", "tbt-menubar");
    mb.setAttribute("role", "menubar");
    mb.setAttribute("aria-label", t("メニュー"));
    var pop = el("div", "tbt-pop");
    pop.setAttribute("role", "menu");
    pop.hidden = true;
    var titles = [], openIdx = -1, items = [];
    // いつも同じ並び（中身だけ開くたびに作る）
    var shape = menus();
    shape.forEach(function (m, i) {
      var b = el("button", "tbt-menu" + (m.bold ? " tbt-menu--app" : ""), m.title);
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.setAttribute("aria-haspopup", "menu");
      b.setAttribute("aria-expanded", "false");
      b.tabIndex = i === 0 ? 0 : -1;
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      b.addEventListener("click", function () { if (openIdx === i) close(); else open(i, false); });
      b.addEventListener("mouseenter", function () { if (openIdx >= 0 && openIdx !== i) open(i, false); });
      b.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); open(i, true); }
        else if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); move(i, e.key === "ArrowRight" ? 1 : -1, false); }
      });
      titles.push(b);
      mb.appendChild(b);
    });
    bar.insertBefore(mb, brand.nextSibling);
    bar.appendChild(pop);
    // SK のボタン（メニューバーにしていないとき。右の検索の左）
    var siteBtn = el("button", "tbt-btn tbt-site");
    siteBtn.type = "button";
    siteBtn.title = t("SK のホームページ");
    siteBtn.setAttribute("aria-label", t("SK のホームページ"));
    siteBtn.setAttribute("aria-haspopup", "menu");
    siteBtn.setAttribute("aria-expanded", "false");
    var logo = el("img");
    logo.src = "/assets/logo.svg";
    logo.alt = "";
    siteBtn.appendChild(logo);
    siteBtn.addEventListener("mousedown", function (e) { e.preventDefault(); });
    siteBtn.addEventListener("click", function () { if (openIdx === "site") close(); else open("site", false); });
    siteBtn.addEventListener("keydown", function (e) { if (e.key === "ArrowDown") { e.preventDefault(); open("site", true); } });
    var searchBtn = bar.querySelector("[data-open-search]");
    if (searchBtn) bar.insertBefore(siteBtn, searchBtn); else bar.appendChild(siteBtn);
    function anchor(i) { return i === "site" ? siteBtn : titles[i]; }

    function move(i, d, keepOpen) {
      var n = (i + d + titles.length) % titles.length;
      titles.forEach(function (x, k) { x.tabIndex = k === n ? 0 : -1; });
      if (keepOpen) open(n, true); else titles[n].focus();
    }
    function open(i, focusFirst) {
      var a = document.activeElement;
      if (openIdx === -1 && a && !bar.contains(a)) editTarget = a;
      if (openIdx !== -1) close();
      openIdx = i;
      titles.forEach(function (x, k) { x.setAttribute("aria-expanded", String(k === i)); x.classList.toggle("is-open", k === i); });
      siteBtn.setAttribute("aria-expanded", String(i === "site"));
      siteBtn.classList.toggle("is-open", i === "site");
      var m = i === "site" ? { items: siteItems() } : menus()[i];
      pop.textContent = "";
      items = [];
      m.items.forEach(function (it) {
        if (it === "-") { if (pop.lastChild && !pop.lastChild.classList.contains("tbt-pop__sep")) pop.appendChild(el("div", "tbt-pop__sep")); return; }
        var b = el("button", "tbt-pop__item");
        b.type = "button";
        b.setAttribute("role", it.check === undefined ? "menuitem" : "menuitemcheckbox");
        if (it.check !== undefined) b.setAttribute("aria-checked", String(!!it.check));
        b.disabled = !!it.disabled;
        b.append(el("span", "tbt-pop__check", it.check ? "✓" : ""), el("span", "tbt-pop__label", it.label), el("span", "tbt-pop__key", it.key || ""));
        b.addEventListener("mousedown", function (e) { e.preventDefault(); });
        b.addEventListener("click", function () { close(); it.run(); });
        pop.appendChild(b);
        items.push(b);
      });
      if (pop.lastChild && pop.lastChild.classList.contains("tbt-pop__sep")) pop.lastChild.remove();
      pop.hidden = false;
      if (i === "site") pop.style.left = Math.max(0, siteBtn.offsetLeft + siteBtn.offsetWidth - pop.offsetWidth) + "px";
      else pop.style.left = Math.max(0, titles[i].offsetLeft - 4) + "px";
      if (focusFirst) { var f = items.filter(function (x) { return !x.disabled; })[0]; if (f) f.focus(); }
    }
    function close() {
      if (openIdx === -1) return;
      var hadFocus = pop.contains(document.activeElement), at = anchor(openIdx);
      at.setAttribute("aria-expanded", "false");
      at.classList.remove("is-open");
      if (hadFocus) at.focus();
      openIdx = -1;
      pop.hidden = true;
    }
    pop.addEventListener("keydown", function (e) {
      var live = items.filter(function (x) { return !x.disabled; }), k = live.indexOf(document.activeElement);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (live.length) live[(k + (e.key === "ArrowDown" ? 1 : live.length - 1)) % live.length].focus(); }
      else if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && openIdx !== "site") { e.preventDefault(); move(openIdx, e.key === "ArrowRight" ? 1 : -1, true); }
      else if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "Tab") close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && openIdx !== -1) close();
      // ⌘,（Ctrl+,）で Toolbox の設定（メニューバーを出しているとき）
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === "," && !bar.matches('[data-off~="menu"]')) { e.preventDefault(); openSettings(); }
    });
    document.addEventListener("pointerdown", function (e) { if (openIdx !== -1 && !mb.contains(e.target) && !pop.contains(e.target) && !siteBtn.contains(e.target)) close(); });
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
  }

  function build() {
    var bar = el("div", "tbt");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "SK's Toolbox");

    // Toolbox のアイコンと、いまのアプリ（押すとホーム）
    var brand = el("a", "tbt-brand");
    brand.href = "/toolbox/";
    brand.title = t("SK's Toolbox のホーム");
    var img = el("img");
    img.src = current ? current.path + "icon.svg" : "/toolbox/icon.svg";
    img.alt = "";
    brand.append(img, el("span", "tbt-name", "SK's Toolbox"));
    if (currentName) brand.append(el("span", "tbt-sep", "›"), el("span", "tbt-cur", currentName));
    bar.appendChild(brand);

    // 何もないところ（ここをドラッグしてウィンドウを動かす）
    bar.appendChild(el("span", "tbt-space"));

    // アプリの切りかえ
    var nav = el("nav", "tbt-apps");
    nav.setAttribute("aria-label", t("アプリの切りかえ"));
    APPS.forEach(function (a) {
      var link = el("a", "tbt-app");
      link.href = a.path;
      link.title = a.name;
      link.setAttribute("aria-label", a.name);
      if (a === current) link.setAttribute("aria-current", "page");
      var i = el("img");
      i.src = a.path + "icon.svg";
      i.alt = "";
      link.appendChild(i);
      nav.appendChild(link);
    });
    bar.appendChild(nav);

    // 検索・設定
    var search = el("button", "tbt-btn");
    search.type = "button";
    search.title = t("検索") + "（" + (/Mac/.test(navigator.platform) ? "⌘K" : "Ctrl+K") + "）";
    search.setAttribute("aria-label", t("検索"));
    search.appendChild(icon("search"));
    search.setAttribute("data-open-search", ""); // /toolbox/shared/search.js が開く
    var settings = el("button", "tbt-btn");
    settings.type = "button";
    settings.title = t("Toolbox の設定");
    settings.setAttribute("aria-label", t("Toolbox の設定"));
    settings.setAttribute("data-open-settings", ""); // /toolbox/shared/settings.js が開く
    settings.appendChild(icon("settings"));
    bar.append(search, settings);

    document.body.insertBefore(bar, document.body.firstChild);

    // メニューバー（設定でオンにしたとき。Mac のアプリの「ファイル」「編集」…のように）
    buildMenubar(bar, brand);

    // 設定で消したもの
    var parts = ["brand", "name", "apps", "search", "settings"];
    var applyParts = function () {
      var tb = window.SKToolbox && SKToolbox.get().titlebar;
      var off = tb ? parts.filter(function (k) { return tb[k] === false; }) : [];
      if (!tb || tb.center !== "menu") off.push("menu"); // メニューバーは「真ん中に出すもの」で選んだときだけ
      if (off.length) bar.setAttribute("data-off", off.join(" ")); else bar.removeAttribute("data-off");
    };
    applyParts();
    if (window.SKToolbox) SKToolbox.onChange(applyParts);

    // 色は、そのページの背景と同じに（アプリごと・テーマごとに違うため）。Clock は空の上に重ねるので、色を付けない
    if (document.documentElement.getAttribute("data-tbt") !== "overlay") {
      var paint = function () {
        var bg = getComputedStyle(document.body).backgroundColor;
        if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") bg = getComputedStyle(document.documentElement).backgroundColor;
        bar.style.backgroundColor = bg;
      };
      paint();
      if (window.SKToolbox) window.SKToolbox.onChange(function () { requestAnimationFrame(paint); });
      if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () { requestAnimationFrame(paint); });
      new MutationObserver(function () { requestAnimationFrame(paint); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] });
    }
  }

  // <head> で読み込むので、<body> ができたらすぐ入れる（画面の切りかえで、新しい画面にも最初からタイトルバーがあるように）
  if (document.body) build();
  else new MutationObserver(function (m, obs) {
    if (!document.body) return;
    obs.disconnect();
    build();
  }).observe(document.documentElement, { childList: true });
})();
