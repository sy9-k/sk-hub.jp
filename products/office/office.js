// SK Hub Office の製品ページ（/products/office/）の動き
//   ・表紙: 見出しの下線をのばす・重なった紙をマウスに合わせて少し動かす
//   ・「ソフトを入れなくても、…」の文を、スクロールに合わせて 1 つずつ光らせる
//   ・3 つのアプリ: 読んでいるアプリに合わせて、左の画面を Doc・Sheet・Slide に切りかえる（Doc は文字を打ち、Sheet は合計を数え上げる）
//   ・data-reveal のついたものを、画面に入ったときに浮かび上がらせる
//   ・作る順番: スクロールに合わせて線をのばす
// <html class="of-js"> は <head> で付ける（build.py の EXTRA。これが読めなかったら 3 秒で外れて、ふつうに見せる）
(function () {
  "use strict";
  window.__ofReady = true;
  var root = document.documentElement;
  root.classList.add("of-js");
  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasIO = "IntersectionObserver" in window;

  // ---------- 表紙 ----------
  var hero = document.querySelector(".of-hero");
  if (hero) setTimeout(function () { hero.classList.add("is-ready"); }, reduced ? 0 : 700);
  var stack = document.querySelector("[data-of-stack]");
  if (stack && hero && !reduced && window.matchMedia("(pointer: fine)").matches) {
    hero.addEventListener("pointermove", function (e) {
      var r = hero.getBoundingClientRect();
      stack.style.setProperty("--px", ((e.clientX - r.left) / r.width * 2 - 1).toFixed(3));
      stack.style.setProperty("--py", ((e.clientY - r.top) / r.height * 2 - 1).toFixed(3));
    });
    hero.addEventListener("pointerleave", function () {
      stack.style.setProperty("--px", "0");
      stack.style.setProperty("--py", "0");
    });
  }

  // ---------- 文を 1 つずつ光らせる・線をのばす（スクロールのたび） ----------
  var parts = document.querySelectorAll("[data-of-statement] span");
  var road = document.querySelector("[data-of-road]");
  function onScroll() {
    var vh = window.innerHeight;
    parts.forEach(function (s) { s.classList.toggle("is-lit", reduced || s.getBoundingClientRect().top < vh * 0.7); });
    if (road) {
      var r = road.getBoundingClientRect();
      var p = reduced ? 1 : (vh * 0.8 - r.top) / (r.height + vh * 0.35);
      road.style.setProperty("--p", Math.max(0.1, Math.min(1, p)).toFixed(3));
    }
  }
  var ticking = false;
  window.addEventListener("scroll", function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { ticking = false; onScroll(); });
  }, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  // ---------- 3 つのアプリ ----------
  var stage = document.querySelector("[data-of-stage]");
  var steps = document.querySelectorAll("[data-of-step]");
  var typeEl = document.querySelector("[data-of-type]");
  var typeText = typeEl ? typeEl.textContent : "";
  var countEl = document.querySelector("[data-of-count]");
  var typeTimer = null, countFrame = null;

  function typeIt() {
    if (!typeEl || reduced) return;
    clearInterval(typeTimer);
    var i = 0;
    typeEl.textContent = "";
    typeTimer = setInterval(function () {
      i++;
      typeEl.textContent = typeText.slice(0, i);
      if (i >= typeText.length) clearInterval(typeTimer);
    }, 55);
  }
  function countIt() {
    if (!countEl || reduced) return;
    cancelAnimationFrame(countFrame);
    var to = parseInt(countEl.getAttribute("data-of-count"), 10), start = null;
    function step(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / 1100);
      countEl.textContent = Math.round(to * (1 - Math.pow(1 - p, 3))).toLocaleString("ja-JP");
      if (p < 1) countFrame = requestAnimationFrame(step);
    }
    countFrame = requestAnimationFrame(step);
  }
  function setApp(app) {
    if (!stage || stage.getAttribute("data-app") === app && stage.hasAttribute("data-shown")) return;
    stage.setAttribute("data-app", app);
    stage.setAttribute("data-shown", "");
    steps.forEach(function (s) { s.classList.toggle("is-active", s.getAttribute("data-of-step") === app); });
    if (app === "doc") typeIt();
    if (app === "sheet") countIt();
  }
  if (stage && steps.length) {
    if (hasIO) {
      // 画面のまん中あたりを通ったアプリを、いまのアプリにする
      var sio = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) setApp(e.target.getAttribute("data-of-step")); });
      }, { rootMargin: "-45% 0px -45% 0px" });
      steps.forEach(function (s) { sio.observe(s); });
    }
    steps[0].classList.add("is-active");
  }

  // ---------- 浮かび上がる ----------
  var reveals = document.querySelectorAll("[data-reveal]");
  if (!hasIO || reduced) {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-in");
        io.unobserve(e.target);
      });
    }, { rootMargin: "0px 0px -10% 0px" });
    reveals.forEach(function (el) { io.observe(el); });
  }
})();
