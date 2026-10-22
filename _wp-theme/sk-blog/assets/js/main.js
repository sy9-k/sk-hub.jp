/* SK Blog — ヘッダーのメニュー（スマホ）とライト・ダークの切り替え */
(function () {
  var root = document.documentElement;
  var btn = document.querySelector(".hd-menu-btn");
  var menu = document.getElementById("hd-menu");
  var backdrop = document.getElementById("hd-backdrop");

  function setOpen(open) {
    if (!btn || !menu) return;
    btn.classList.toggle("is-open", open);
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    menu.classList.toggle("is-open", open);
    if (backdrop) backdrop.classList.toggle("is-open", open);
    if (open) {
      menu.style.height = menu.scrollHeight + "px";
      menu.querySelectorAll(".hd-menu-list li").forEach(function (li, i) { li.style.setProperty("--i", i); });
    } else {
      menu.style.height = "";
    }
  }

  if (btn && menu) {
    btn.addEventListener("click", function () { setOpen(!menu.classList.contains("is-open")); });
    if (backdrop) backdrop.addEventListener("click", function () { setOpen(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });
    window.addEventListener("resize", function () { if (window.innerWidth > 680) setOpen(false); });
  }

  // ライト・ダーク（SK のサイトと同じ localStorage の "sk_theme" に保存する）
  var toggle = document.querySelector("[data-mode-toggle]");
  function isDark() {
    var m = root.getAttribute("data-theme");
    if (m) return m === "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function syncThemeColor() {
    var meta = document.querySelector("meta[data-theme-color]");
    if (meta) meta.setAttribute("content", isDark() ? "#0b0e13" : "#ffffff");
  }
  if (toggle) {
    toggle.addEventListener("click", function () {
      var next = isDark() ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try {
        var t = JSON.parse(localStorage.getItem("sk_theme") || "{}");
        t.mode = next;
        localStorage.setItem("sk_theme", JSON.stringify(t));
      } catch (e) {}
      syncThemeColor();
    });
  }
  syncThemeColor();
})();
