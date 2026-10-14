// ひみつのターミナル（どのページでも「`」キーで開く。assets/site.js が、押したときにこのファイルを読み込む）
// 見た目だけのお遊び。コマンドはこのファイルの COMMANDS にあるものだけで、どこにも送信しない。
// ウィンドウ: タイトルバーで移動・端や角で大きさを変える・赤（閉じる）黄（最小化）緑（最大化）・タイトルバーのダブルクリックで最大化。
// 位置と大きさはこのブラウザの localStorage（sk_terminal_window）に覚える。
(function () {
  "use strict";
  if (window.SKTerminal) return;

  var I18N = window.SKI18N || { lang: "ja", t: function (s, p) { return p ? s.replace(/\{(\w+)\}/g, function (m, k) { return p[k] != null ? p[k] : m; }) : s; }, path: function (u) { return u; } };
  var t = I18N.t;

  var WINDOW_KEY = "sk_terminal_window";
  var MIN_W = 320;
  var MIN_H = 200;
  var EDGE = 8; // 画面の端からの余白

  // open / cd で移動できるページ（ls で一覧）
  var PAGES = {
    home: "/", about: "/about/", "y-filter": "/products/y-filter/", malu: "/products/malu/", hub: "/sk-hub-systems/",
    lab: "/lab/", support: "https://support.sk-hub.jp/", updates: "/updates/", status: "https://sk-hub.online/", policies: "/policies/",
    contact: "https://support.sk-hub.jp/contact/", account: "/account/", console: "/y-filter/", credits: "/credits/", lang: "/lang/"
  };
  var LOGO = [
    "  ____  _  __",
    " / ___|| |/ /",
    " \\___ \\| ' / ",
    "  ___) | . \\ ",
    " |____/|_|\\_\\"
  ];

  var win = null, output = null, input = null, dock = null;
  var rect = null;        // { x, y, w, h }（最大化していないときの位置と大きさ）
  var maximized = false;
  var minimized = false;
  var history = [];
  var historyIndex = 0;

  // ターミナルの文字（M PLUS 1 Code。日本語も英数字も等幅）。開いたときにだけ Google Fonts から読み込む。
  // EU・英国・スイスなどのタイムゾーンでは読み込まず、端末にある等幅の文字で表示する（assets/fonts.js と同じ考え方）
  function loadFont() {
    if (document.getElementById("skt-font")) return;
    var zone = "";
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { /* 判定できなければ読み込む */ }
    if (/^(Europe\/|Atlantic\/(Canary|Madeira|Azores|Reykjavik|Faroe)|Africa\/Ceuta|Asia\/(Nicosia|Famagusta)|Arctic\/)/.test(zone)) return;
    var link = document.createElement("link");
    link.id = "skt-font";
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=M+PLUS+1+Code:wght@400;600;700&display=swap";
    document.head.appendChild(link);
  }

  function injectStyle() {
    loadFont();
    if (document.getElementById("skt-style")) return;
    var st = document.createElement("style");
    st.id = "skt-style";
    st.textContent =
      ".skt{position:fixed;z-index:2000;display:flex;flex-direction:column;min-width:" + MIN_W + "px;min-height:" + MIN_H + "px;border-radius:12px;overflow:hidden;" +
      "background:rgba(11,15,20,.97);color:#e6edf3;font:13.5px/1.55 'M PLUS 1 Code',ui-monospace,SFMono-Regular,Menlo,Consolas,'Noto Sans Mono','Noto Sans JP',monospace;" +
      "box-shadow:0 24px 60px rgba(0,0,0,.45),0 0 0 1px rgba(255,255,255,.08);animation:skt-in .18s cubic-bezier(.2,.8,.2,1)}" +
      ".skt.skt-max{border-radius:0}" +
      ".skt.skt-anim{transition:left .2s ease,top .2s ease,width .2s ease,height .2s ease,border-radius .2s ease}" +
      "@keyframes skt-in{from{opacity:0;transform:scale(.96)}}" +
      "@media(prefers-reduced-motion:reduce){.skt{animation:none}.skt.skt-anim{transition:none}}" +
      ".skt-bar{position:relative;display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid rgba(255,255,255,.08);" +
      "color:rgba(230,237,243,.55);font-size:12px;cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none}" +
      ".skt-bar.skt-dragging{cursor:grabbing}" +
      ".skt-title{position:absolute;left:0;right:0;text-align:center;pointer-events:none}" +
      ".skt-btn{position:relative;z-index:1;width:13px;height:13px;border:0;border-radius:50%;padding:0;cursor:pointer;display:grid;place-items:center;" +
      "color:transparent;font:700 10px/1 system-ui,sans-serif}" +
      ".skt-btn.close{background:#ff5f57}.skt-btn.min{background:#febc2e}.skt-btn.max{background:#28c840}" +
      ".skt-bar:hover .skt-btn,.skt-btn:focus-visible{color:rgba(0,0,0,.55)}" +
      ".skt-btn:focus-visible{outline:2px solid #79c0ff;outline-offset:2px}" +
      ".skt-out{flex:1;overflow:auto;padding:12px 16px 4px;white-space:pre-wrap;word-break:break-word}" +
      ".skt-line{min-height:1.55em}.skt-p{color:#3fb950}.skt-dim{color:rgba(230,237,243,.55)}.skt-accent{color:#79c0ff}.skt-warn{color:#ffa657}.skt-err{color:#ff7b72}" +
      ".skt-in{display:flex;align-items:center;gap:8px;padding:6px 16px 14px}" +
      ".skt-in input{flex:1;min-width:0;border:0;outline:0;background:none;color:inherit;font:inherit;caret-color:#3fb950}" +
      // 大きさを変えるつまみ（端 4 つ・角 4 つ。見えない）
      ".skt-rz{position:absolute;z-index:3;touch-action:none}" +
      ".skt-rz.n,.skt-rz.s{left:10px;right:10px;height:6px;cursor:ns-resize}.skt-rz.n{top:-3px}.skt-rz.s{bottom:-3px}" +
      ".skt-rz.e,.skt-rz.w{top:10px;bottom:10px;width:6px;cursor:ew-resize}.skt-rz.e{right:-3px}.skt-rz.w{left:-3px}" +
      ".skt-rz.ne,.skt-rz.nw,.skt-rz.se,.skt-rz.sw{width:14px;height:14px}" +
      ".skt-rz.ne{top:-3px;right:-3px;cursor:nesw-resize}.skt-rz.sw{bottom:-3px;left:-3px;cursor:nesw-resize}" +
      ".skt-rz.nw{top:-3px;left:-3px;cursor:nwse-resize}.skt-rz.se{bottom:-3px;right:-3px;cursor:nwse-resize}" +
      ".skt.skt-max .skt-rz{display:none}" +
      // 最小化したときに、画面の下に出るボタン
      ".skt-dock{position:fixed;left:16px;bottom:16px;z-index:2000;display:flex;align-items:center;gap:8px;padding:8px 14px 8px 10px;border:0;border-radius:999px;" +
      "background:rgba(11,15,20,.95);color:#e6edf3;font:600 12.5px/1 'M PLUS 1 Code',ui-monospace,Menlo,Consolas,monospace;cursor:pointer;box-shadow:0 10px 30px rgba(0,0,0,.35);animation:skt-in .18s ease}" +
      ".skt-dock i{width:9px;height:9px;border-radius:50%;background:#28c840}";
    document.head.appendChild(st);
  }

  // ---------- ウィンドウの位置と大きさ ----------

  function viewport() {
    return { w: window.innerWidth, h: window.innerHeight };
  }

  function defaultRect() {
    var v = viewport();
    var w = Math.min(760, v.w - EDGE * 2);
    var h = Math.min(460, v.h - 120);
    return { x: Math.round((v.w - w) / 2), y: Math.max(64, Math.round((v.h - h) / 3)), w: w, h: h };
  }

  // 画面の外に出ないようにする（タイトルバーが見えていれば、つかんで戻せる）
  function clampRect(r) {
    var v = viewport();
    var w = Math.max(Math.min(r.w, v.w - EDGE * 2), Math.min(MIN_W, v.w - EDGE * 2));
    var h = Math.max(Math.min(r.h, v.h - EDGE * 2), Math.min(MIN_H, v.h - EDGE * 2));
    var x = Math.min(Math.max(r.x, EDGE - w + 80), v.w - 80);
    var y = Math.min(Math.max(r.y, EDGE), v.h - 40);
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }

  function loadState() {
    try {
      var s = JSON.parse(localStorage.getItem(WINDOW_KEY) || "null");
      if (s && isFinite(s.x) && isFinite(s.y) && isFinite(s.w) && isFinite(s.h)) {
        rect = clampRect(s);
        maximized = !!s.max;
        return;
      }
    } catch (e) { /* 読めなければ最初の位置 */ }
    rect = defaultRect();
    maximized = false;
  }

  function saveState() {
    try {
      localStorage.setItem(WINDOW_KEY, JSON.stringify({ x: rect.x, y: rect.y, w: rect.w, h: rect.h, max: maximized }));
    } catch (e) { /* 覚えられなくても使える */ }
  }

  function applyRect(animate) {
    if (!win) return;
    if (animate) {
      win.classList.add("skt-anim");
      setTimeout(function () { if (win) win.classList.remove("skt-anim"); }, 220);
    }
    var r = maximized ? { x: 0, y: 0, w: viewport().w, h: viewport().h } : rect;
    win.style.left = r.x + "px";
    win.style.top = r.y + "px";
    win.style.width = r.w + "px";
    win.style.height = r.h + "px";
    win.classList.toggle("skt-max", maximized);
    var maxBtn = win.querySelector(".skt-btn.max");
    maxBtn.setAttribute("aria-label", maximized ? t("元の大きさに戻す") : t("最大化"));
    maxBtn.textContent = maximized ? "−" : "+";
  }

  function toggleMaximize() {
    maximized = !maximized;
    applyRect(true);
    saveState();
    input.focus();
  }

  function minimize() {
    if (!win) return;
    minimized = true;
    win.hidden = true;
    dock = document.createElement("button");
    dock.type = "button";
    dock.className = "skt-dock";
    dock.setAttribute("aria-label", t("ターミナルを開く"));
    dock.innerHTML = "<i></i>";
    dock.appendChild(document.createTextNode("sk@hub"));
    dock.addEventListener("click", restore);
    document.body.appendChild(dock);
  }

  function restore() {
    if (!win) return;
    minimized = false;
    win.hidden = false;
    if (dock) { dock.remove(); dock = null; }
    applyRect(false);
    input.focus();
  }

  // タイトルバーをつかんで動かす（最大化中につかむと、元の大きさに戻してから動かす）
  function startMove(e) {
    if (e.button !== 0 || e.target.closest(".skt-btn")) return;
    e.preventDefault();
    var bar = e.currentTarget;
    if (maximized) {
      var ratio = (e.clientX) / viewport().w;
      maximized = false;
      rect.x = Math.round(e.clientX - rect.w * ratio);
      rect.y = Math.max(EDGE, e.clientY - 18);
      applyRect(false);
    }
    var startX = e.clientX, startY = e.clientY, from = { x: rect.x, y: rect.y };
    bar.classList.add("skt-dragging");
    try { bar.setPointerCapture(e.pointerId); } catch (err) { /* つかめなくても動かせる（ウィンドウの外に出ると止まる） */ }
    function move(ev) {
      rect = clampRect({ x: from.x + ev.clientX - startX, y: from.y + ev.clientY - startY, w: rect.w, h: rect.h });
      applyRect(false);
    }
    function up() {
      bar.classList.remove("skt-dragging");
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
      bar.removeEventListener("pointercancel", up);
      saveState();
    }
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
    bar.addEventListener("pointercancel", up);
  }

  // 端や角をつかんで大きさを変える
  function startResize(e) {
    if (e.button !== 0 || maximized) return;
    e.preventDefault();
    e.stopPropagation();
    var handle = e.currentTarget;
    var dir = handle.dataset.dir;
    var startX = e.clientX, startY = e.clientY, from = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    var v = viewport();
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* つかめなくても動かせる */ }
    function move(ev) {
      var dx = ev.clientX - startX, dy = ev.clientY - startY;
      var r = { x: from.x, y: from.y, w: from.w, h: from.h };
      if (dir.indexOf("e") >= 0) r.w = Math.min(Math.max(MIN_W, from.w + dx), v.w - from.x - EDGE);
      if (dir.indexOf("s") >= 0) r.h = Math.min(Math.max(MIN_H, from.h + dy), v.h - from.y - EDGE);
      if (dir.indexOf("w") >= 0) {
        r.w = Math.min(Math.max(MIN_W, from.w - dx), from.x + from.w - EDGE);
        r.x = from.x + from.w - r.w;
      }
      if (dir.indexOf("n") >= 0) {
        r.h = Math.min(Math.max(MIN_H, from.h - dy), from.y + from.h - EDGE);
        r.y = from.y + from.h - r.h;
      }
      rect = r;
      applyRect(false);
    }
    function up() {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      saveState();
    }
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  function onWindowResize() {
    if (!win) return;
    rect = clampRect(rect);
    applyRect(false);
  }

  // ---------- 表示 ----------

  function line(text, cls) {
    var el = document.createElement("div");
    el.className = "skt-line" + (cls ? " " + cls : "");
    el.textContent = text;
    output.appendChild(el);
    output.scrollTop = output.scrollHeight;
    return el;
  }

  function promptLine(cmd) {
    var el = document.createElement("div");
    el.className = "skt-line";
    var p = document.createElement("span");
    p.className = "skt-p";
    p.textContent = "sk@hub:~$ ";
    el.append(p, document.createTextNode(cmd));
    output.appendChild(el);
  }

  function go(name) {
    var key = String(name || "").toLowerCase().replace(/\/$/, "");
    if (!key) { line(t("行き先を指定してください（ls で一覧）"), "skt-warn"); return; }
    if (!Object.prototype.hasOwnProperty.call(PAGES, key)) { line(t("見つかりません: {name}（ls で一覧）", { name: name }), "skt-err"); return; }
    line(t("{name} を開いています…", { name: key }), "skt-dim");
    location.href = I18N.path(PAGES[key]);
  }

  // ---------- コマンド ----------

  var COMMANDS = {
    help: {
      desc: "使えるコマンドの一覧",
      run: function () {
        Object.keys(COMMANDS).filter(function (k) { return !COMMANDS[k].hidden; }).forEach(function (k) {
          line(("  " + k + "            ").slice(0, 14) + t(COMMANDS[k].desc));
        });
        line(t("↑↓ で前に打ったコマンド、Tab で補完、Esc で閉じる"), "skt-dim");
      }
    },
    whoami: {
      desc: "私について",
      run: function () { line(t("SK — 高校生。趣味はアプリ開発。Y-FILTER. と MALU を作っています。")); }
    },
    ls: {
      desc: "ページの一覧",
      run: function () { line(Object.keys(PAGES).map(function (k) { return k + "/"; }).join("  "), "skt-accent"); }
    },
    open: {
      desc: "ページを開く（例: open malu）",
      run: function (args) { go(args[0]); }
    },
    cd: { desc: "open と同じ", hidden: true, run: function (args) { go(args[0]); } },
    neofetch: {
      desc: "このサイトの情報",
      run: function () {
        var info = [
          "sk@hub",
          "------",
          "OS: SK Hub Systems",
          "Host: GitHub Pages",
          "Kernel: HTML / CSS / JavaScript",
          t("製品: Y-FILTER. · MALU · SK Hub Systems"),
          t("言語: 日本語 · English · 简体中文 · 繁體中文 · 한국어"),
          t("画面: {w} × {h}", { w: window.innerWidth, h: window.innerHeight }),
          "Theme: SK Blue"
        ];
        var rows = Math.max(LOGO.length, info.length);
        for (var i = 0; i < rows; i++) {
          var el = line("");
          var logo = document.createElement("span");
          logo.className = "skt-accent";
          logo.textContent = ((LOGO[i] || "") + "                ").slice(0, 16);
          el.append(logo, document.createTextNode(info[i] || ""));
        }
      }
    },
    date: {
      desc: "今の日時",
      run: function () {
        try { line(new Date().toLocaleString(I18N.lang)); } catch (e) { line(new Date().toString()); }
      }
    },
    echo: {
      desc: "文字をそのまま表示",
      run: function (args) { line(args.join(" ")); }
    },
    history: {
      desc: "打ったコマンドの一覧",
      run: function () { history.forEach(function (h, i) { line(("   " + (i + 1)).slice(-4) + "  " + h, "skt-dim"); }); }
    },
    clear: { desc: "画面を消す", run: function () { output.replaceChildren(); } },
    exit: { desc: "閉じる", run: function () { close(); } },
    // 以下はひみつ（help に出さない）
    sudo: { hidden: true, run: function () { line(t("sk は sudoers ファイルに含まれていません。この件は報告されます。……というのは冗談です。"), "skt-err"); } },
    rm: { hidden: true, run: function () { line(t("それはだめです。"), "skt-err"); } },
    vim: { hidden: true, run: function () { line(t("終わり方がわからなくなる前に、やめておきましょう。"), "skt-warn"); } },
    emacs: { hidden: true, run: function () { line(t("終わり方がわからなくなる前に、やめておきましょう。"), "skt-warn"); } },
    coffee: { hidden: true, run: function () { line(t("コーヒーは、まだ実装されていません。"), "skt-warn"); } },
    hello: { hidden: true, run: function () { line(t("こんにちは！ 見つけてくれてありがとう。")); } },
    ping: { hidden: true, run: function () { line("pong"); } },
    quit: { hidden: true, run: function () { close(); } }
  };
  COMMANDS.hi = COMMANDS.hello;

  function run(raw) {
    var text = raw.trim();
    promptLine(raw);
    if (!text) return;
    history.push(text);
    if (history.length > 50) history.shift();
    historyIndex = history.length;
    var parts = text.split(/\s+/);
    var name = parts[0].toLowerCase();
    var cmd = COMMANDS[name];
    if (!cmd) { line(t("コマンドが見つかりません: {name}（help で一覧）", { name: parts[0] }), "skt-err"); return; }
    cmd.run(parts.slice(1));
  }

  // Tab で補完（コマンド名。open / cd のあとはページ名）
  function complete() {
    var value = input.value;
    var parts = value.split(/\s+/);
    var list, word;
    if (parts.length <= 1) {
      word = parts[0].toLowerCase();
      list = Object.keys(COMMANDS).filter(function (k) { return !COMMANDS[k].hidden && k.indexOf(word) === 0; });
      if (list.length === 1) input.value = list[0] + " ";
      else if (list.length > 1) { promptLine(value); line(list.join("  "), "skt-dim"); }
      return;
    }
    if (/^(open|cd)$/i.test(parts[0]) && parts.length === 2) {
      word = parts[1].toLowerCase();
      list = Object.keys(PAGES).filter(function (k) { return k.indexOf(word) === 0; });
      if (list.length === 1) input.value = parts[0] + " " + list[0];
      else if (list.length > 1) { promptLine(value); line(list.join("  "), "skt-dim"); }
    }
  }

  function onKey(e) {
    if (e.key === "Enter") { e.preventDefault(); var v = input.value; input.value = ""; run(v); return; }
    if (e.key === "Escape" || (e.key === "`" && !input.value)) { e.preventDefault(); close(); return; }
    if (e.key === "Tab") { e.preventDefault(); complete(); return; }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyIndex > 0) { historyIndex--; input.value = history[historyIndex]; }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex < history.length - 1) { historyIndex++; input.value = history[historyIndex]; }
      else { historyIndex = history.length; input.value = ""; }
    }
  }

  // ---------- 開く・閉じる ----------

  function open() {
    injectStyle();
    if (win) { if (minimized) restore(); else input.focus(); return; }
    loadState();
    win = document.createElement("div");
    win.className = "skt";
    win.setAttribute("role", "dialog");
    win.setAttribute("aria-label", t("ターミナル"));
    win.innerHTML =
      '<div class="skt-bar"><button type="button" class="skt-btn close">×</button><button type="button" class="skt-btn min">−</button>' +
      '<button type="button" class="skt-btn max">+</button><span class="skt-title">sk@hub — zsh</span></div>' +
      '<div class="skt-out" aria-live="polite"></div><label class="skt-in"><span class="skt-p">sk@hub:~$</span><input type="text" autocomplete="off" autocapitalize="off" spellcheck="false"></label>' +
      ["n", "s", "e", "w", "ne", "nw", "se", "sw"].map(function (d) { return '<div class="skt-rz ' + d + '" data-dir="' + d + '"></div>'; }).join("");
    output = win.querySelector(".skt-out");
    input = win.querySelector("input");
    input.setAttribute("aria-label", t("コマンド"));
    var bar = win.querySelector(".skt-bar");
    win.querySelector(".skt-btn.close").setAttribute("aria-label", t("閉じる"));
    win.querySelector(".skt-btn.min").setAttribute("aria-label", t("最小化"));
    win.querySelector(".skt-btn.close").addEventListener("click", close);
    win.querySelector(".skt-btn.min").addEventListener("click", minimize);
    win.querySelector(".skt-btn.max").addEventListener("click", toggleMaximize);
    bar.addEventListener("pointerdown", startMove);
    bar.addEventListener("dblclick", function (e) { if (!e.target.closest(".skt-btn")) toggleMaximize(); });
    win.querySelectorAll(".skt-rz").forEach(function (h) { h.addEventListener("pointerdown", startResize); });
    input.addEventListener("keydown", onKey);
    output.addEventListener("click", function () { if (!window.getSelection().toString()) input.focus(); });
    document.body.appendChild(win);
    applyRect(false);
    window.addEventListener("resize", onWindowResize);
    line(t("ようこそ、sk@hub へ。help でコマンドの一覧が出ます。"), "skt-dim");
    input.focus();
  }

  function close() {
    if (!win) return;
    win.remove();
    if (dock) dock.remove();
    window.removeEventListener("resize", onWindowResize);
    win = null;
    dock = null;
    output = null;
    input = null;
    minimized = false;
  }

  window.SKTerminal = {
    open: open,
    close: close,
    // 「`」キー: 閉じていれば開く・最小化していれば戻す・開いていれば閉じる
    toggle: function () {
      if (!win) open();
      else if (minimized) restore();
      else close();
    }
  };
})();
