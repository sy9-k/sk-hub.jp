// SK's Brand のページ（/brand/）の動き
//   ・表紙: ロゴの組み立て（CSS）と、マウスに合わせてロゴを少し傾ける
//   ・上の目次: いま読んでいる章を示す・読んだ量の線
//   ・ひとこと: スクロールに合わせて 1 文ずつ光らせる
//   ・data-reveal のついたものを、画面に入ったときに浮かび上がらせる
//   ・ロゴの組み立て図（分けて見る・方眼・線だけ）
//   ・テーマカラーの丸を押すと、そのテーマカラーを試せる（assets/site.js の window.SKTheme。ヘッダーの「表示」と同じ）
//     いまの色の濃淡・コントラスト比を、実際の色から計算して出す
//   ・書体を試す・なめらかな角・動きのカーブ・動きの見本・ことばの書き分け
//   ・色のコードをコピーする
(function () {
  "use strict";
  var t = window.SKI18N ? window.SKI18N.t : function (s, p) { return p ? s.replace(/\{(\w+)\}/g, function (m, k) { return p[k] != null ? p[k] : m; }) : s; };
  var root = document.documentElement;
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasIO = "IntersectionObserver" in window;
  root.classList.add("bx-js");
  window.__bxReady = true;

  var toastEl = document.querySelector("[data-brand-toast]");
  var toastTimer = null;
  function toast(text) {
    if (!toastEl) return;
    toastEl.textContent = text;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("show"); }, 2200);
  }

  function writeClipboard(text, done) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { toast(t("コピーできませんでした")); });
    } else {
      toast(t("コピーできませんでした"));
    }
  }

  // ---------- 色のコードをコピー ----------
  document.querySelectorAll("[data-copy]").forEach(function (el) {
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.title = t("押してコピー");
    var run = function (e) {
      e.stopPropagation(); e.preventDefault();
      var code = el.dataset.copy;
      writeClipboard(code, function () { toast(t("コピーしました: {code}", { code: code })); });
    };
    el.addEventListener("click", run);
    el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") run(e); });
  });

  // 色のコードをまとめて CSS の形でコピー
  var tokensBtn = document.querySelector("[data-bx-copy-tokens]");
  if (tokensBtn) {
    tokensBtn.addEventListener("click", function () {
      var lines = [":root {", "  /* SK — theme colors (-dark: dark mode) */"];
      document.querySelectorAll("[data-brand-accents] [data-accent]").forEach(function (btn) {
        var s = btn.style;
        lines.push("  --sk-" + btn.dataset.accent + ": " + s.getPropertyValue("--sw").trim() + ";");
        lines.push("  --sk-" + btn.dataset.accent + "-dark: " + s.getPropertyValue("--sw-d").trim() + ";");
      });
      lines.push("", "  /* base */");
      document.querySelectorAll(".bx-neutral").forEach(function (el) {
        var name = el.querySelector("strong").textContent.trim().toLowerCase();
        lines.push("  --sk-" + name + ": " + el.style.getPropertyValue("--l").trim() + ";");
        lines.push("  --sk-" + name + "-dark: " + el.style.getPropertyValue("--d").trim() + ";");
      });
      lines.push("", "  /* products */");
      document.querySelectorAll(".bx-product").forEach(function (el) {
        var name = el.querySelector("strong").textContent.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        lines.push("  --sk-" + name + ": " + el.style.getPropertyValue("--pc").trim() + ";");
      });
      lines.push("}");
      writeClipboard(lines.join("\n") + "\n", function () { toast(t("色のコードをコピーしました")); });
    });
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

  // ---------- スクロール: ひとこと・目次・読んだ量 ----------
  var statementParts = document.querySelectorAll("[data-bx-statement] span");
  var nav = document.querySelector("[data-bx-nav]");
  var progress = document.querySelector("[data-bx-progress]");
  var navLinks = nav ? Array.prototype.slice.call(nav.querySelectorAll(".bx-nav-links a")) : [];
  var chapters = navLinks.map(function (a) { return document.querySelector(a.getAttribute("href")); });
  var currentLink = null;
  var ticking = false;
  function onScroll() {
    ticking = false;
    var vh = window.innerHeight;
    var line = vh * 0.62;
    statementParts.forEach(function (s) { s.classList.toggle("is-lit", reduced || s.getBoundingClientRect().top < line); });

    if (progress) {
      var max = document.documentElement.scrollHeight - vh;
      progress.style.setProperty("--p", max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)).toFixed(4) : "0");
    }
    // いま読んでいる章: 画面の上から 3 分の 1 の線をこえた、いちばん下の章
    var active = null;
    chapters.forEach(function (sec, i) {
      if (sec && sec.getBoundingClientRect().top < vh * 0.34) active = navLinks[i];
    });
    if (active !== currentLink) {
      if (currentLink) currentLink.removeAttribute("aria-current");
      if (active) {
        active.setAttribute("aria-current", "true");
        // 目次が横にあふれているとき（スマホ）は、いまの章が見えるようにずらす
        var box = active.parentElement;
        if (box.scrollWidth > box.clientWidth) {
          box.scrollTo({ left: active.offsetLeft - box.offsetLeft - box.clientWidth / 2 + active.offsetWidth / 2, behavior: reduced ? "auto" : "smooth" });
        }
      }
      currentLink = active;
    }
  }
  function requestScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(onScroll);
  }
  window.addEventListener("scroll", requestScroll, { passive: true });
  window.addEventListener("resize", requestScroll);
  onScroll();

  // ---------- 表紙のロゴを、マウスに合わせて少し傾ける ----------
  var hero = document.querySelector(".bx-hero");
  var heroMark = document.querySelector(".bx-mark--hero");
  if (hero && heroMark && !reduced && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
    var target = { x: 0, y: 0 }, now = { x: 0, y: 0 }, raf = null;
    var step = function () {
      now.x += (target.x - now.x) * 0.08;
      now.y += (target.y - now.y) * 0.08;
      heroMark.style.setProperty("--ry", (now.x * 14).toFixed(2) + "deg");
      heroMark.style.setProperty("--rx", (-now.y * 12).toFixed(2) + "deg");
      heroMark.style.setProperty("--mx", now.x.toFixed(3));
      heroMark.style.setProperty("--my", now.y.toFixed(3));
      raf = Math.abs(target.x - now.x) + Math.abs(target.y - now.y) > 0.001 ? requestAnimationFrame(step) : null;
    };
    var kick = function () { if (!raf) raf = requestAnimationFrame(step); };
    hero.addEventListener("pointermove", function (e) {
      var r = heroMark.getBoundingClientRect();
      target.x = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2)));
      target.y = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2)));
      kick();
    });
    hero.addEventListener("pointerleave", function () { target.x = 0; target.y = 0; kick(); });
  }

  // ---------- ロゴの組み立て図 ----------
  var anatomy = document.querySelector("[data-bx-anatomy]");
  if (anatomy) {
    var touched = false;
    anatomy.querySelectorAll("[data-bx-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        touched = true;
        var on = btn.getAttribute("aria-pressed") !== "true";
        btn.setAttribute("aria-pressed", String(on));
        anatomy.classList.toggle("is-" + btn.dataset.bxToggle, on);
      });
    });
    // はじめて見えたとき、一度だけ分けて、また組み立てる
    if (hasIO && !reduced) {
      var aio = new IntersectionObserver(function (entries) {
        if (!entries[0].isIntersecting) return;
        aio.disconnect();
        setTimeout(function () { if (!touched) anatomy.classList.add("is-explode"); }, 700);
        setTimeout(function () { if (!touched) anatomy.classList.remove("is-explode"); }, 2100);
      }, { threshold: 0.6 });
      aio.observe(anatomy);
    }
  }

  // ---------- テーマカラー ----------
  var ACCENT_NAMES = { blue: "SK's Blue", sakura: "SK's Sakura", matcha: "SK's Matcha", mikan: "SK's Mikan", fuji: "SK's Fuji", sora: "SK's Sora", sumi: "SK's Sumi" };
  var probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
  document.body.appendChild(probe);

  // CSS の色（var(--…) や color-mix も）を [r, g, b]（0〜255）にする
  function resolve(cssColor) {
    probe.style.color = "";
    probe.style.color = cssColor;
    var c = getComputedStyle(probe).color;
    var m = c.match(/^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/);
    if (m) return [+m[1], +m[2], +m[3]];
    m = c.match(/^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)/);
    if (m) return [m[1] * 255, m[2] * 255, m[3] * 255];
    return null;
  }
  function hex(rgb) {
    return "#" + rgb.map(function (v) { return ("0" + Math.round(Math.max(0, Math.min(255, v))).toString(16)).slice(-2); }).join("");
  }
  function luminance(rgb) {
    var a = rgb.map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }
  function contrast(a, b) {
    var la = luminance(a), lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function isDark() {
    return root.dataset.theme === "dark" || (!root.dataset.theme && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }
  // 文字と背景のコントラスト比と、WCAG の目安（AA は 4.5 以上、AAA は 7 以上）
  function showContrast(el, fg, bg) {
    if (!el) return;
    var a = resolve(fg), b = resolve(bg);
    if (!a || !b) { el.textContent = "—"; return; }
    var r = contrast(a, b);
    el.textContent = r.toFixed(1) + " : 1";
    var badge = document.createElement("em");
    badge.textContent = r >= 7 ? "AAA" : r >= 4.5 ? "AA" : r >= 3 ? "AA Large" : "—";
    if (r < 4.5) badge.className = "is-low";
    el.appendChild(badge);
  }
  function renderLive() {
    var current = (window.SKTheme && window.SKTheme.get().accent) || "blue";
    document.querySelectorAll("[data-brand-accents] [data-accent]").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(btn.dataset.accent === current));
    });
    var name = document.querySelector("[data-bx-accent-name]");
    if (name) name.textContent = ACCENT_NAMES[current] || ACCENT_NAMES.blue;
    var mode = document.querySelector("[data-bx-mode]");
    if (mode) mode.textContent = isDark() ? t("ダーク") : t("ライト");
    document.querySelectorAll("[data-bx-tone]").forEach(function (el) {
      var rgb = resolve("var(" + el.dataset.bxTone + ")");
      el.textContent = rgb ? hex(rgb) : "";
    });
    showContrast(document.querySelector('[data-bx-contrast="button"]'), "var(--accent-ink)", "var(--accent)");
    showContrast(document.querySelector('[data-bx-contrast="link"]'), "var(--link)", "var(--surface)");
  }
  document.querySelectorAll("[data-brand-accents] [data-accent]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      if (!window.SKTheme) return;
      window.SKTheme.set({ accent: btn.dataset.accent }, btn, e);
    });
  });
  // 色が変わったら（このページ・ヘッダーの「表示」・ほかのタブ・端末の設定）、数字も作り直す
  var renderSoon = function () { requestAnimationFrame(function () { requestAnimationFrame(renderLive); }); };
  document.addEventListener("sk:theme", renderSoon);
  new MutationObserver(renderSoon).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-accent"] });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderSoon);
  renderLive();

  // ---------- 書体を試す ----------
  var tester = document.querySelector("[data-bx-tester]");
  if (tester) {
    var input = tester.querySelector("[data-bx-tester-text]");
    var size = tester.querySelector("[data-bx-tester-size]");
    var sizeOut = tester.querySelector("[data-bx-tester-size-out]");
    var outs = tester.querySelectorAll("[data-bx-tester-out]");
    var fallback = input.value;
    var renderText = function () {
      var text = input.value.trim() ? input.value : fallback;
      outs.forEach(function (o) { o.textContent = text; });
    };
    var renderSize = function () {
      tester.style.setProperty("--fs", size.value + "px");
      sizeOut.textContent = size.value + "px";
    };
    input.addEventListener("input", renderText);
    size.addEventListener("input", renderSize);
    tester.querySelectorAll("[data-bx-weight]").forEach(function (btn, _, all) {
      btn.addEventListener("click", function () {
        all.forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
        tester.style.setProperty("--fw", btn.dataset.bxWeight);
      });
    });
    renderText();
    renderSize();
  }

  // ---------- なめらかな角 ----------
  var corner = document.querySelector("[data-bx-corner]");
  if (corner) {
    if (!(window.CSS && CSS.supports && CSS.supports("corner-shape", "superellipse(1.5)"))) {
      var note = corner.querySelector("[data-bx-corner-note]");
      if (note) note.hidden = false;
    }
    corner.querySelectorAll("[data-bx-corner-mode]").forEach(function (btn, _, all) {
      btn.addEventListener("click", function () {
        all.forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
        corner.setAttribute("data-bx-corner", btn.dataset.bxCornerMode);
      });
    });
  }

  // ---------- 動きのカーブ ----------
  // cubic-bezier(x1, y1, x2, y2) の、時間 x のときの進み y を求める（x(s) = x をニュートン法で解く）
  function bezier(x1, y1, x2, y2) {
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    var sx = function (s) { return ((ax * s + bx) * s + cx) * s; };
    var sy = function (s) { return ((ay * s + by) * s + cy) * s; };
    var dx = function (s) { return (3 * ax * s + 2 * bx) * s + cx; };
    return function (x) {
      var s = x;
      for (var i = 0; i < 8; i++) {
        var d = dx(s);
        if (Math.abs(d) < 1e-6) break;
        s -= (sx(s) - x) / d;
      }
      return sy(Math.max(0, Math.min(1, s)));
    };
  }
  var SLOW = 3; // 見やすいように 3 倍ゆっくり動かす
  var curves = Array.prototype.slice.call(document.querySelectorAll("[data-bx-curve]")).map(function (card) {
    var p = card.dataset.bxCurve.split(",").map(parseFloat);
    var X = function (v) { return (v * 100).toFixed(2); };
    var Y = function (v) { return (100 - v * 100).toFixed(2); };
    card.querySelector(".bx-curve-path").setAttribute("d", "M0 100 C" + X(p[0]) + " " + Y(p[1]) + " " + X(p[2]) + " " + Y(p[3]) + " 100 0");
    card.querySelector(".bx-curve-handle").setAttribute("d", "M0 100 L" + X(p[0]) + " " + Y(p[1]) + " M100 0 L" + X(p[2]) + " " + Y(p[3]));
    var ease = bezier(p[0], p[1], p[2], p[3]);
    var dot = card.querySelector(".bx-curve-dot");
    var ball = card.querySelector(".bx-curve-track i");
    var track = card.querySelector(".bx-curve-track");
    var dur = parseFloat(card.dataset.bxDur) * SLOW;
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
  // はじめて見えたとき、3 つ同時に一度動かす
  var curveBox = document.querySelector(".bx-curves");
  if (curveBox && curves.length && hasIO && !reduced) {
    var cio = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      cio.disconnect();
      setTimeout(function () { curves.forEach(function (go) { go(); }); }, 400);
    }, { threshold: 0.5 });
    cio.observe(curveBox);
  }

  // ---------- 動きの見本 ----------
  function play(name, button, event) {
    if (name === "theme") {
      if (!window.SKTheme) return;
      window.SKTheme.set({ mode: isDark() ? "light" : "dark" }, button, event);
      return;
    }
    var el = document.querySelector('[data-motion="' + name + '"]');
    if (!el || !el.animate || reduced) return;
    if (name === "page") {
      el.animate([
        { transform: "scale(1)", opacity: 1 },
        { transform: "scale(.96)", opacity: 0, offset: .45 },
        { transform: "translateY(10px)", opacity: 0, offset: .55 },
        { transform: "none", opacity: 1 }
      ], { duration: 800, easing: "cubic-bezier(.4, .04, 0, 1)" });
    } else if (name === "pop") {
      el.animate([{ transform: "scale(.7)" }, { transform: "scale(1.22)", offset: .6 }, { transform: "scale(1)" }], { duration: 450, easing: "cubic-bezier(.34, 1.56, .64, 1)" });
    }
  }
  document.querySelectorAll("[data-play]").forEach(function (btn) {
    btn.addEventListener("click", function (e) { play(btn.dataset.play, btn, e); });
  });
  // 円く広がる見本は、ずっとゆっくり動かしておく（動きを減らす設定では止まる。CSS）

  // ---------- ことばの書き分け ----------
  var voice = document.querySelector("[data-bx-voice]");
  if (voice) {
    voice.querySelectorAll("[data-bx-voice-set]").forEach(function (btn, _, all) {
      btn.addEventListener("click", function () {
        all.forEach(function (b) { b.setAttribute("aria-pressed", String(b === btn)); });
        voice.setAttribute("data-bx-voice", btn.dataset.bxVoiceSet);
      });
    });
  }
})();
