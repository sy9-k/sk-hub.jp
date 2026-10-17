// SK Material（/brand/material/）の動き
//   ・表紙: アプリの見本が、7 色の配色で順番に移り変わる（止められる。動きを減らす設定では動かない）
//   ・上の目次: いま読んでいる章・読んだ量の線。data-reveal を画面に入ったときに浮かび上がらせる
//   ・比べる見本: 表紙のアプリを写して、左に M3 の初期値、右に SK Material を重ね、つまみで境目を動かす
//   ・配色: テーマカラーを選ぶと、元の色 → 24 の役割の流れ・ライトとダークの役割・読みやすさ（コントラスト比）・見本の --md-* を入れ替える
//   ・部品の見本（波紋・切りかえ・スナックバー・ダイアログ）、重ね色を試す、動きのカーブ
// 配色（ROLES・PALETTES）は /toolbox/shared/settings.js と同じもの。あちらを作り直したら、ここも写す
(function () {
  "use strict";
  var t = window.SKI18N ? window.SKI18N.t : function (s, p) { return p ? s.replace(/\{(\w+)\}/g, function (m, k) { return p[k] != null ? p[k] : m; }) : s; };
  var root = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasIO = "IntersectionObserver" in window;
  root.classList.add("mt-js");
  window.__mtReady = true;

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
  // M3 の初期値（ベースラインの紫）。比べる見本の左側だけで使う（Material Design 3 の公開されている初期の配色）
  var BASELINE = {
    light: { "primary": "#6750a4", "on-primary": "#ffffff", "primary-container": "#eaddff", "on-primary-container": "#21005d", "secondary-container": "#e8def8", "on-secondary-container": "#1d192b", "tertiary": "#7d5260", "surface": "#fef7ff", "on-surface": "#1d1b20", "on-surface-variant": "#49454f", "surface-container-low": "#f7f2fa", "surface-container": "#f3edf7", "surface-container-high": "#ece6f0", "surface-container-highest": "#e6e0e9", "outline": "#79747e", "outline-variant": "#cac4d0" },
    dark: { "primary": "#d0bcff", "on-primary": "#381e72", "primary-container": "#4f378b", "on-primary-container": "#eaddff", "secondary-container": "#4a4458", "on-secondary-container": "#e8def8", "tertiary": "#efb8c8", "surface": "#141218", "on-surface": "#e6e0e9", "on-surface-variant": "#cac4d0", "surface-container-low": "#1d1b20", "surface-container": "#211f26", "surface-container-high": "#2b2930", "surface-container-highest": "#36343b", "outline": "#938f99", "outline-variant": "#49454f" }
  };
  var ORDER = ["blue", "sakura", "matcha", "mikan", "fuji", "sora", "sumi"];
  var NAMES = { blue: "SK's Blue", sakura: "SK's Sakura", matcha: "SK's Matcha", mikan: "SK's Mikan", fuji: "SK's Fuji", sora: "SK's Sora", sumi: "SK's Sumi" };
  var SEEDS = { blue: "#2563eb", sakura: "#db2777", matcha: "#16a34a", mikan: "#ea580c", fuji: "#7c3aed", sora: "#0891b2", sumi: "#334155" };

  // [ライト, ダーク] の文字列を { 役割: "#rrggbb" } にする
  function scheme(key, dark) {
    var s = PALETTES[key][dark ? 1 : 0], out = {};
    ROLES.forEach(function (r, i) { out[r] = "#" + s.substr(i * 6, 6); });
    return out;
  }
  function paint(el, colors) {
    Object.keys(colors).forEach(function (r) { el.style.setProperty("--md-" + r, colors[r]); });
  }
  var siteDark = function () {
    return root.dataset.theme === "dark" || (!root.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  };

  var toastEl = document.querySelector("[data-mt-toast]");
  var toastTimer = null;
  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2000);
  }
  function copy(code) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(function () { toast(t("コピーしました: {code}", { code: code })); }, function () { toast(code); });
    } else {
      toast(code);
    }
  }

  // ---------- 浮かび上がる ----------
  var reveals = document.querySelectorAll("[data-reveal]");
  if (!hasIO || reduced) {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        rio.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -10% 0px" });
    reveals.forEach(function (el) { rio.observe(el); });
  }

  // ---------- 目次・読んだ量 ----------
  var nav = document.querySelector("[data-mt-nav]");
  var progress = document.querySelector("[data-mt-progress]");
  var navLinks = nav ? Array.prototype.slice.call(nav.querySelectorAll(".mt-nav-links a")) : [];
  var chapters = navLinks.map(function (a) { return document.querySelector(a.getAttribute("href")); });
  var currentLink = null, ticking = false;
  function onScroll() {
    ticking = false;
    var vh = window.innerHeight;
    if (progress) {
      var max = document.documentElement.scrollHeight - vh;
      progress.style.setProperty("--p", max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)).toFixed(4) : "0");
    }
    var active = null;
    chapters.forEach(function (sec, i) { if (sec && sec.getBoundingClientRect().top < vh * 0.34) active = navLinks[i]; });
    if (active !== currentLink) {
      if (currentLink) currentLink.removeAttribute("aria-current");
      if (active) {
        active.setAttribute("aria-current", "true");
        var box = active.parentElement;
        if (box.scrollWidth > box.clientWidth) box.scrollTo({ left: active.offsetLeft - box.offsetLeft - box.clientWidth / 2 + active.offsetWidth / 2, behavior: reduced ? "auto" : "smooth" });
      }
      currentLink = active;
    }
  }
  window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  // ---------- 表紙: 7 色で移り変わる ----------
  var hero = document.querySelector(".mt-hero");
  var heroScreen = document.querySelector("[data-mt-hero] [data-mt-screen]");
  var heroName = document.querySelector("[data-mt-hero-name]");
  var pauseBtn = document.querySelector("[data-mt-hero-pause]");
  var heroIndex = 0, heroTimer = null, heroPaused = reduced;
  function showHero(key) {
    var colors = scheme(key, siteDark());
    if (heroScreen) paint(heroScreen, colors);
    if (hero) {
      hero.style.setProperty("--hero-primary", colors["primary"]);
      hero.style.setProperty("--hero-tertiary", colors["primary-container"]);
    }
    if (heroName) heroName.textContent = NAMES[key];
  }
  function stepHero() {
    heroIndex = (heroIndex + 1) % ORDER.length;
    showHero(ORDER[heroIndex]);
  }
  function runHero() {
    clearInterval(heroTimer);
    if (!heroPaused && !document.hidden) heroTimer = setInterval(stepHero, 2800);
  }
  if (pauseBtn) {
    if (reduced) { pauseBtn.hidden = true; }
    pauseBtn.addEventListener("click", function () {
      heroPaused = !heroPaused;
      pauseBtn.setAttribute("aria-pressed", String(heroPaused));
      pauseBtn.textContent = heroPaused ? t("動かす") : t("止める");
      runHero();
    });
  }
  document.addEventListener("visibilitychange", runHero);

  // ---------- 比べる見本（表紙のアプリを写す。表紙は翻訳ずみなので、写したものも同じ言語） ----------
  var compare = document.querySelector("[data-mt-compare]");
  var cmpM3 = null, cmpSk = null;
  if (compare && heroScreen) {
    cmpM3 = heroScreen.cloneNode(true);
    cmpSk = heroScreen.cloneNode(true);
    cmpM3.removeAttribute("style"); cmpSk.removeAttribute("style");
    compare.querySelector("[data-mt-compare-m3]").appendChild(cmpM3);
    compare.querySelector("[data-mt-compare-sk]").appendChild(cmpSk);
    var stage = compare.querySelector("[data-mt-compare-stage]");
    var range = compare.querySelector("[data-mt-compare-range]");
    var setX = function (v) {
      v = Math.max(0, Math.min(100, v));
      stage.style.setProperty("--x", v + "%");
      range.value = String(Math.round(v));
    };
    range.addEventListener("input", function () { setX(+range.value); });
    var drag = function (e) {
      var r = stage.getBoundingClientRect();
      setX((e.clientX - r.left) / r.width * 100);
    };
    stage.addEventListener("pointerdown", function (e) {
      stage.setPointerCapture(e.pointerId);
      drag(e);
      var move = function (ev) { drag(ev); };
      var up = function () { stage.removeEventListener("pointermove", move); stage.removeEventListener("pointerup", up); stage.removeEventListener("pointercancel", up); };
      stage.addEventListener("pointermove", move);
      stage.addEventListener("pointerup", up);
      stage.addEventListener("pointercancel", up);
    });
    // はじめて見えたとき、つまみを左右に一度ゆらして「動かせる」ことを見せる
    if (hasIO && !reduced) {
      var cio = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        cio.disconnect();
        var start = null;
        var frame = function (ts) {
          if (start === null) start = ts;
          var p = Math.min(1, (ts - start) / 1600);
          setX(50 + Math.sin(p * Math.PI * 2) * 22 * (1 - p));
          if (p < 1) requestAnimationFrame(frame);
        };
        setTimeout(function () { requestAnimationFrame(frame); }, 500);
      }, { threshold: 0.6 });
      cio.observe(stage);
    }
  }

  // ---------- 配色 ----------
  // [背景の役割, 文字の役割, 横に 2 つ分] … M3 にない on-tertiary・on-error は、明るさが同じ on-primary で代わりにする
  var TILES = [
    ["primary", "on-primary", true], ["primary-container", "on-primary-container"], ["secondary-container", "on-secondary-container"],
    ["tertiary", "on-primary"], ["tertiary-container", "on-tertiary-container"], ["error", "on-primary"], ["error-container", "on-error-container"],
    ["surface", "on-surface", true], ["surface-container-low", "on-surface"], ["surface-container", "on-surface"],
    ["surface-container-high", "on-surface"], ["surface-container-highest", "on-surface"], ["on-surface", "surface"], ["on-surface-variant", "surface"],
    ["outline", "surface"], ["outline-variant", "on-surface"], ["inverse-surface", "inverse-on-surface"], ["inverse-primary", "inverse-surface"]
  ];
  // 読みやすさを確かめる組み合わせ [文字, 背景]
  var PAIRS = [
    ["on-primary", "primary"], ["on-primary-container", "primary-container"], ["on-secondary-container", "secondary-container"],
    ["on-tertiary-container", "tertiary-container"], ["on-error-container", "error-container"], ["on-surface", "surface"],
    ["on-surface-variant", "surface-container-highest"], ["inverse-on-surface", "inverse-surface"]
  ];
  function lum(hex) {
    return [1, 3, 5].map(function (i) { var v = parseInt(hex.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); })
      .reduce(function (s, v, i) { return s + v * [0.2126, 0.7152, 0.0722][i]; }, 0);
  }
  function ratio(a, b) {
    var x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function renderRoles(box, colors) {
    box.replaceChildren();
    TILES.forEach(function (tile) {
      var b = el("button", "mt-role" + (tile[2] ? " is-wide" : ""));
      b.type = "button";
      b.style.setProperty("--bg-c", colors[tile[0]]);
      b.style.setProperty("--fg-c", colors[tile[1]]);
      b.append(el("b", null, tile[0]), el("code", null, colors[tile[0]]));
      b.title = t("押してコピー");
      b.addEventListener("click", function () { copy(colors[tile[0]]); });
      box.appendChild(b);
    });
  }
  function contrastCell(fg, bg) {
    var cell = el("span", "mt-contrast-cell");
    var chip = el("span", "mt-contrast-chip", "Aa");
    chip.style.setProperty("--bg-c", bg);
    chip.style.setProperty("--fg-c", fg);
    var r = ratio(fg, bg);
    var badge = el("em", r < 4.5 ? "is-low" : null, r >= 7 ? "AAA" : r >= 4.5 ? "AA" : r >= 3 ? "AA Large" : "—");
    cell.append(chip, document.createTextNode(r.toFixed(1)), badge);
    return cell;
  }

  var demo = document.querySelector("[data-mt-demo]");
  var states = document.querySelector("[data-mt-states]");
  var state = { color: "blue", dark: siteDark() };
  try {
    var accent = window.SKTheme ? window.SKTheme.get().accent : "";
    if (accent && PALETTES[accent]) state.color = accent;
  } catch (e) { /* ふつうの青のまま */ }
  heroIndex = ORDER.indexOf(state.color);

  function render() {
    var light = scheme(state.color, false), dark = scheme(state.color, true);
    document.querySelectorAll("[data-mt-color]").forEach(function (b) { b.setAttribute("aria-checked", String(b.dataset.mtColor === state.color)); });
    document.querySelectorAll("[data-mt-scheme]").forEach(function (box) {
      renderRoles(box.querySelector("[data-mt-roles]"), box.dataset.mtScheme === "dark" ? dark : light);
    });
    // 元の色 → 24 の役割
    var seed = document.querySelector("[data-mt-seed]");
    if (seed) seed.style.setProperty("--seed", SEEDS[state.color]);
    var seedCode = document.querySelector("[data-mt-seed-code]");
    if (seedCode) seedCode.textContent = SEEDS[state.color];
    var flow = document.querySelector("[data-mt-flow-roles]");
    if (flow) {
      if (!flow.children.length) ROLES.forEach(function (r, i) { var d = el("i"); d.style.setProperty("--i", i); flow.appendChild(d); });
      Array.prototype.forEach.call(flow.children, function (d, i) { d.style.setProperty("--c", (i % 2 ? dark : light)[ROLES[i]]); });
    }
    // 読みやすさ
    var table = document.querySelector("[data-mt-contrast]");
    if (table) {
      table.replaceChildren();
      PAIRS.forEach(function (p) {
        var row = el("div", "mt-contrast-row");
        row.append(el("b", null, p[0] + " / " + p[1]), contrastCell(light[p[0]], light[p[1]]), contrastCell(dark[p[0]], dark[p[1]]));
        table.appendChild(row);
      });
    }
    // 見本
    var current = state.dark ? dark : light;
    if (demo) {
      paint(demo, current);
      demo.style.colorScheme = state.dark ? "dark" : "light";
      demo.querySelectorAll("[data-mt-mode]").forEach(function (b) { b.setAttribute("aria-checked", String((b.dataset.mtMode === "dark") === state.dark)); });
    }
    if (states) paint(states, current);
    if (cmpSk) paint(cmpSk, siteDark() ? dark : light);
    if (cmpM3) paint(cmpM3, BASELINE[siteDark() ? "dark" : "light"]);
  }
  document.querySelectorAll("[data-mt-color]").forEach(function (b) {
    b.addEventListener("click", function () {
      state.color = b.dataset.mtColor;
      heroIndex = ORDER.indexOf(state.color);
      showHero(state.color);
      runHero();
      render();
    });
  });
  // サイトのライト・ダークが変わったら、表紙・比べる見本も合わせる
  var follow = function () { showHero(ORDER[heroIndex]); render(); };
  new MutationObserver(follow).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", follow);
  showHero(state.color);
  render();
  runHero();

  // ---------- 部品の見本 ----------
  if (demo) {
    demo.querySelectorAll("[data-mt-mode]").forEach(function (b) {
      b.addEventListener("click", function () { state.dark = b.dataset.mtMode === "dark"; render(); });
    });
    // 押したところから広がる波紋（/toolbox/shared/m3.js と同じ）
    demo.addEventListener("pointerdown", function (e) {
      var target = e.target.closest && e.target.closest(".m3-state");
      if (!target || target.disabled || !demo.contains(target) || reduced) return;
      var r = target.getBoundingClientRect();
      var d = Math.hypot(r.width, r.height) * 2;
      var w = el("span", "ripple");
      w.style.width = w.style.height = d + "px";
      w.style.left = (e.clientX - r.left - d / 2) + "px";
      w.style.top = (e.clientY - r.top - d / 2) + "px";
      target.appendChild(w);
      w.addEventListener("animationend", function () { w.remove(); });
    });
    demo.querySelectorAll("[data-mt-toggle]").forEach(function (b) {
      b.addEventListener("click", function () { b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); });
    });
    demo.querySelectorAll(".mt-list-item").forEach(function (row) {
      var sw = row.querySelector(".mt-switch");
      var flip = function (e) { if (e.target !== sw) sw.checked = !sw.checked; };
      row.addEventListener("click", flip);
      row.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(e); } });
    });
    var snack = demo.querySelector("[data-mt-snackbar]");
    var snackTimer = null;
    demo.querySelector("[data-mt-snack]").addEventListener("click", function () {
      snack.classList.add("is-on");
      clearTimeout(snackTimer);
      snackTimer = setTimeout(function () { snack.classList.remove("is-on"); }, 4000);
    });
    demo.querySelector("[data-mt-snack-undo]").addEventListener("click", function () { clearTimeout(snackTimer); snack.classList.remove("is-on"); });
    var scrim = demo.querySelector("[data-mt-scrim]");
    var opener = null;
    var close = function () { scrim.hidden = true; if (opener) opener.focus(); };
    demo.querySelector("[data-mt-dialog]").addEventListener("click", function (e) {
      opener = e.currentTarget;
      scrim.hidden = false;
      scrim.querySelector("[data-mt-close]").focus();
    });
    scrim.querySelectorAll("[data-mt-close]").forEach(function (b) { b.addEventListener("click", close); });
    scrim.addEventListener("click", function (e) { if (e.target === scrim) close(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !scrim.hidden) close(); });
  }

  // ---------- 重ね色を試す ----------
  if (states) {
    var sBtn = states.querySelector("[data-mt-state-btn]");
    var sVal = states.querySelector("[data-mt-state-value]");
    states.querySelectorAll("[data-mt-state]").forEach(function (b, _, all) {
      b.addEventListener("click", function () {
        all.forEach(function (x) { x.setAttribute("aria-checked", String(x === b)); });
        sBtn.style.setProperty("--o", (+b.dataset.mtState / 100).toFixed(2));
        sBtn.classList.toggle("is-focus", b.hasAttribute("data-mt-state-focus"));
        sBtn.classList.toggle("is-press", b.hasAttribute("data-mt-state-press"));
        sVal.textContent = b.dataset.mtState + "%";
      });
    });
  }

  // ---------- 動きのカーブ ----------
  function bezier(x1, y1, x2, y2) {
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    var sx = function (s) { return ((ax * s + bx) * s + cx) * s; };
    var sy = function (s) { return ((ay * s + by) * s + cy) * s; };
    var dx = function (s) { return (3 * ax * s + 2 * bx) * s + cx; };
    return function (x) {
      var s = x;
      for (var i = 0; i < 8; i++) { var d = dx(s); if (Math.abs(d) < 1e-6) break; s -= (sx(s) - x) / d; }
      return sy(Math.max(0, Math.min(1, s)));
    };
  }
  var curves = Array.prototype.slice.call(document.querySelectorAll("[data-mt-curve]")).map(function (card) {
    var p = card.dataset.mtCurve.split(",").map(parseFloat);
    var X = function (v) { return (v * 100).toFixed(2); };
    var Y = function (v) { return (100 - v * 100).toFixed(2); };
    card.querySelector(".mt-curve-path").setAttribute("d", "M0 100 C" + X(p[0]) + " " + Y(p[1]) + " " + X(p[2]) + " " + Y(p[3]) + " 100 0");
    card.querySelector(".mt-curve-handle").setAttribute("d", "M0 100 L" + X(p[0]) + " " + Y(p[1]) + " M100 0 L" + X(p[2]) + " " + Y(p[3]));
    var ease = bezier(p[0], p[1], p[2], p[3]);
    var dot = card.querySelector(".mt-curve-dot");
    var ball = card.querySelector(".mt-curve-track i");
    var track = card.querySelector(".mt-curve-track");
    var dur = parseFloat(card.dataset.mtDur) * 3; // 見やすいように 3 倍ゆっくり
    var anim = null, rest = null;
    var draw = function (x) {
      var y = ease(x);
      dot.setAttribute("cx", X(x));
      dot.setAttribute("cy", Y(y));
      ball.style.transform = "translateX(" + (y * (track.clientWidth - 18)).toFixed(1) + "px)";
    };
    var play = function () {
      cancelAnimationFrame(anim);
      clearTimeout(rest);
      if (reduced) { draw(1); return; }
      var start = null;
      var frame = function (ts) {
        if (start === null) start = ts;
        var x = Math.min(1, (ts - start) / dur);
        draw(x);
        if (x < 1) anim = requestAnimationFrame(frame);
        else rest = setTimeout(function () { draw(0); }, 1200);
      };
      anim = requestAnimationFrame(frame);
    };
    card.addEventListener("click", play);
    draw(0);
    return play;
  });
  var curveBox = document.querySelector(".mt-curves");
  if (curveBox && curves.length && hasIO && !reduced) {
    var kio = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      kio.disconnect();
      setTimeout(function () { curves.forEach(function (go) { go(); }); }, 400);
    }, { threshold: 0.5 });
    kio.observe(curveBox);
  }
})();
