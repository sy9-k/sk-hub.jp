// 私について（/about/）の動き。about.css と組みで使う。
// ・スクロールで要素を出す（.ab-reveal → .is-in）
// ・数字を数えて出す（.ab-count）
// 動きを減らす設定のときは、すべて最初から見える状態にする（about.css の prefers-reduced-motion）
(function () {
  var root = document.documentElement;
  root.classList.add("js");
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  var items = document.querySelectorAll(".ab-reveal:not(.ab-hero .ab-reveal)");
  if (reduce || !("IntersectionObserver" in window)) {
    for (var i = 0; i < items.length; i++) items[i].classList.add("is-in");
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
    for (var j = 0; j < items.length; j++) io.observe(items[j]);
  }

  var counts = document.querySelectorAll(".ab-count");
  counts.forEach(function (el) {
    var to = parseInt(el.getAttribute("data-count"), 10) || 0;
    if (reduce) return;
    var start = null, dur = 900;
    function step(t) {
      if (start === null) start = t;
      var p = Math.min((t - start) / dur, 1);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    }
    el.textContent = "0";
    var io2 = new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) { requestAnimationFrame(step); io2.disconnect(); }
    });
    io2.observe(el);
  });

})();
