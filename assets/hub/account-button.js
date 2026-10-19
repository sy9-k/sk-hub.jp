// SK Hub Systems アカウントのボタンと、アプリ共通のアカウントの画面
//   MALU・Nagi など、SK Hub Systems アカウントを使うアプリの上の帯に置く。
//     <script src="/assets/hub/account-button.js" defer></script>
//     <sk-account-button app="nagi"></sk-account-button>   … app は assets/hub/account.js の SERVICES の key（いま開いているアプリ）
//   ・Firebase は読み込まない。名前とアイコンは assets/hub/account.js がこのブラウザに保存したもの（skhub_account）を使う
//     （サイトのヘッダーと同じ。ログインや設定の変更は /account/ で行う）
//   ・見た目はアプリの CSS に左右されないように、Shadow DOM の中に閉じこめる。文字の書体はアプリのものを引きつぐ
//   ・明るさはアプリに合わせる（<html data-theme="dark|light">。なければ端末の設定）
//   ・ボタンの大きさは CSS の --ska-size（既定 36px）で変えられる
(function () {
  "use strict";
  if (window.customElements && customElements.get("sk-account-button")) return;

  var HINT_KEY = "skhub_account";
  var t = function (s, p) {
    if (window.SKI18N) return window.SKI18N.t(s, p);
    return p ? s.replace(/\{(\w+)\}/g, function (m, k) { return p[k] != null ? p[k] : m; }) : s;
  };
  var lp = function (u) { return window.SKI18N ? window.SKI18N.path(u) : u; };

  // SK Hub Systems アカウントで使えるアプリ（assets/hub/account.js の SERVICES と同じ）
  var APPS = [
    { key: "malu", name: "MALU", url: "/dictionary/", icon: "/dictionary/ico/icon-192.png" },
    { key: "nagi", name: "Nagi", url: "/nagi/", icon: "/nagi/ico/icon-192.png" },
    { key: "study", name: "SK Study", url: "/study/", icon: "/study/icon.svg" },
    { key: "yfilter", name: "Y-FILTER. 管理コンソール", short: "管理コンソール", url: "/y-filter/", icon: "/y-filter/shared/icon.svg", dark: true }
  ];

  function readHint() {
    try { return JSON.parse(localStorage.getItem(HINT_KEY) || "null"); } catch (e) { return null; }
  }

  var ICON = {
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3"/></svg>',
    chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>'
  };

  var CSS = [
    ":host { --ska-size: 36px; --ska-accent: #2563eb; position: relative; display: inline-flex; flex: none; font: inherit; }",
    "*, *::before, *::after { box-sizing: border-box; }",
    // ボタン
    ".btn { position: relative; display: grid; place-items: center; width: calc(var(--ska-size) + 8px); height: calc(var(--ska-size) + 8px); padding: 0; border: 0; border-radius: 50%; background: transparent; color: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: background .2s ease; }",
    ".btn:hover { background: color-mix(in srgb, currentColor 8%, transparent); }",
    ".btn:focus-visible { outline: 2px solid var(--ska-accent); outline-offset: 2px; }",
    ".btn .av { width: var(--ska-size); height: var(--ska-size); font-size: calc(var(--ska-size) * .44); }",
    ".btn .av.is-empty { background: transparent; color: inherit; box-shadow: inset 0 0 0 1.8px currentColor; opacity: .8; }",
    ".btn .av.is-empty svg { width: 58%; height: 58%; }",
    ".dot { position: absolute; top: 3px; right: 3px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: #e11d48; color: #fff; font: 700 10px/16px system-ui, sans-serif; text-align: center; box-shadow: 0 0 0 2px var(--ska-ring, #fff); }",
    // アイコン（写真か、頭文字）
    ".av { display: grid; place-items: center; overflow: hidden; border-radius: 50%; background: var(--c, #2563eb); color: #fff; font-weight: 800; line-height: 1; flex: none; }",
    ".av img { width: 100%; height: 100%; object-fit: cover; }",
    ".av svg { width: 55%; height: 55%; }",
    // 画面
    ".scrim { position: fixed; inset: 0; z-index: 2147482000; background: transparent; }",
    ".panel { position: fixed; z-index: 2147482001; width: min(380px, calc(100vw - 16px)); max-height: calc(100dvh - 16px); overflow: auto; overscroll-behavior: contain; padding: 10px; border-radius: 30px; background: var(--bg); color: var(--ink); box-shadow: 0 0 0 1px var(--line), 0 24px 60px rgba(0, 0, 0, .22); transform-origin: top right; animation: in .28s cubic-bezier(.22, 1, .36, 1); scrollbar-width: thin; }",
    ".panel.out { animation: out .16s ease forwards; }",
    "@keyframes in { from { opacity: 0; transform: translateY(-6px) scale(.94); } }",
    "@keyframes out { to { opacity: 0; transform: translateY(-4px) scale(.97); } }",
    "@media (max-width: 480px) {",
    "  .panel { left: 8px !important; right: 8px !important; top: auto !important; bottom: 8px; width: auto; border-radius: 30px; transform-origin: bottom center; animation-name: up; }",
    "  .panel.out { animation-name: down; }",
    "  .scrim { background: rgba(0, 0, 0, .32); animation: fade .2s ease; }",
    "}",
    "@keyframes up { from { transform: translateY(40px); opacity: 0; } }",
    "@keyframes down { to { transform: translateY(40px); opacity: 0; } }",
    "@keyframes fade { from { opacity: 0; } }",
    "@media (prefers-reduced-motion: reduce) { .panel, .panel.out, .scrim { animation: none !important; } }",
    // 明るさ（アプリに合わせる）
    ".panel { --bg: #f3f5f8; --card: #ffffff; --ink: #0d1014; --muted: #5a6371; --line: rgba(13, 16, 20, .08); --hover: rgba(13, 16, 20, .05); --link: #1d4ed8; }",
    ".panel.dark { --bg: #1b1f26; --card: #262b34; --ink: #eef1f5; --muted: #a3acb9; --line: rgba(255, 255, 255, .08); --hover: rgba(255, 255, 255, .06); --link: #8fb4ff; }",
    // 上の段
    ".head { display: flex; align-items: center; gap: 8px; padding: 6px 6px 10px 12px; }",
    ".brand { display: flex; align-items: center; gap: 8px; margin-right: auto; font-size: 13px; font-weight: 700; color: var(--muted); }",
    ".brand img { width: 20px; height: 20px; }",
    ".x { display: grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; color: var(--muted); cursor: pointer; }",
    ".x:hover { background: var(--hover); color: var(--ink); }",
    ".x svg { width: 20px; height: 20px; }",
    // プロフィール
    ".me { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 22px 18px 20px; border-radius: 24px; background: var(--card); }",
    ".me .av { width: 76px; height: 76px; font-size: 32px; box-shadow: 0 0 0 4px var(--card), 0 0 0 6px color-mix(in srgb, var(--c, #2563eb) 35%, transparent); }",
    ".me .av.is-empty { background: color-mix(in srgb, var(--ska-accent) 12%, var(--card)); color: var(--ska-accent); box-shadow: none; }",
    ".name { margin-top: 14px; font-size: 20px; font-weight: 800; letter-spacing: -.01em; overflow-wrap: anywhere; }",
    ".sub { margin-top: 2px; font-size: 13px; color: var(--muted); overflow-wrap: anywhere; }",
    ".lead { margin-top: 8px; font-size: 13.5px; line-height: 1.6; color: var(--muted); }",
    ".pill { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 42px; margin-top: 16px; padding: 0 22px; border-radius: 999px; background: var(--ska-accent); color: #fff; font-size: 14.5px; font-weight: 700; text-decoration: none; transition: filter .2s ease, transform .2s ease; }",
    ".pill:hover { filter: brightness(1.08); transform: scale(1.02); }",
    ".pill.ghost { background: transparent; color: var(--link); box-shadow: inset 0 0 0 1.5px var(--line); }",
    ".pills { display: flex; flex-wrap: wrap; justify-content: center; gap: 0 8px; }",
    // アプリ
    ".label { margin: 16px 12px 8px; font-size: 12px; font-weight: 700; color: var(--muted); letter-spacing: .02em; }",
    ".apps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; padding: 8px; border-radius: 24px; background: var(--card); }",
    ".app { position: relative; display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 12px 4px 10px; border-radius: 18px; color: var(--ink); text-decoration: none; font-size: 12px; font-weight: 700; text-align: center; line-height: 1.3; transition: background .15s ease; }",
    ".app:hover { background: var(--hover); }",
    ".app img { width: 44px; height: 44px; border-radius: 14px; background: var(--bg); }",
    ".app img.dark { padding: 7px; background: #0d1014; }",
    ".app.is-here { background: color-mix(in srgb, var(--ska-accent) 10%, transparent); }",
    ".app.is-here::after { content: attr(data-here); position: absolute; top: 6px; right: 6px; padding: 1px 6px; border-radius: 999px; background: var(--ska-accent); color: #fff; font-size: 9.5px; font-weight: 800; }",
    ".app small { display: block; font-size: 10.5px; font-weight: 600; color: var(--muted); }",
    // 項目
    ".list { margin-top: 10px; padding: 6px; border-radius: 24px; background: var(--card); }",
    ".row { display: flex; align-items: center; gap: 14px; min-height: 50px; padding: 0 12px; border-radius: 16px; color: var(--ink); text-decoration: none; font-size: 14.5px; font-weight: 600; transition: background .15s ease; }",
    ".row:hover { background: var(--hover); }",
    ".row > svg:first-child { width: 20px; height: 20px; color: var(--muted); flex: none; }",
    ".row > span { flex: 1; min-width: 0; }",
    ".row > .chev { display: grid; flex: none; color: var(--muted); opacity: .6; }",
    ".row > .chev svg { width: 18px; height: 18px; }",
    ".count { min-width: 22px; height: 22px; padding: 0 7px; border-radius: 999px; background: #e11d48; color: #fff; font-size: 12px; font-weight: 800; line-height: 22px; text-align: center; }",
    ".row:focus-visible, .app:focus-visible, .pill:focus-visible, .x:focus-visible, .foot a:focus-visible { outline: 2px solid var(--ska-accent); outline-offset: 2px; }",
    // 下の段
    ".foot { display: flex; justify-content: center; flex-wrap: wrap; gap: 4px 14px; padding: 14px 8px 6px; font-size: 12px; }",
    ".foot a { color: var(--muted); text-decoration: none; }",
    ".foot a:hover { color: var(--ink); text-decoration: underline; }"
  ].join("\n");

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }

  // アイコン（写真・頭文字・ログインしていないとき）
  function avatar(hint, extra) {
    if (!hint) return '<span class="av is-empty ' + (extra || "") + '">' + ICON.person + "</span>";
    if (hint.photo) return '<span class="av ' + (extra || "") + '"><img src="' + esc(hint.photo) + '" alt="" referrerpolicy="no-referrer"></span>';
    return '<span class="av ' + (extra || "") + '" style="--c:' + esc(hint.color || "#2563eb") + '">' + esc(hint.letter || "?") + "</span>";
  }

  function isDark() {
    var theme = document.documentElement.getAttribute("data-theme");
    if (theme === "dark") return true;
    if (theme === "light") return false;
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function here() {
    return location.pathname + location.search + location.hash;
  }

  class SKAccountButton extends HTMLElement {
    constructor() {
      super();
      this.root = this.attachShadow({ mode: "open" });
      this.open = false;
      this.onKey = this.onKey.bind(this);
      this.refresh = this.refresh.bind(this);
      this.place = this.place.bind(this);
      // ボタンや画面の中で押したキーを、アプリのショートカット（Nagi の Space など）に渡さない
      this.root.addEventListener("keydown", function (e) { if (e.key !== "Escape") e.stopPropagation(); });
    }

    connectedCallback() {
      this.render();
      document.addEventListener("skhub:account", this.refresh);
      window.addEventListener("storage", this.onStorage = (e) => { if (e.key === HINT_KEY) this.refresh(); });
    }

    disconnectedCallback() {
      document.removeEventListener("skhub:account", this.refresh);
      window.removeEventListener("storage", this.onStorage);
      this.close(true);
    }

    refresh() {
      var wasOpen = this.open;
      this.render();
      if (wasOpen) this.show(false);
    }

    render() {
      var hint = readHint();
      var unread = hint && hint.unread ? Number(hint.unread) : 0;
      var label = hint ? t("SK Hub Systems アカウント: {name}", { name: hint.name || "" }) : t("SK Hub Systems アカウント（ログインしていません）");
      this.root.innerHTML =
        "<style>" + CSS + "</style>" +
        '<button class="btn" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="' + esc(label) + '" title="' + esc(label) + '">' +
        avatar(hint) + (unread ? '<span class="dot">' + (unread > 9 ? "9+" : unread) + "</span>" : "") +
        "</button>";
      this.button = this.root.querySelector(".btn");
      // キーボードで開いたときだけ、画面の中にフォーカスを移す（e.detail はマウスで押すと 1 以上）
      this.button.addEventListener("click", (e) => (this.open ? this.close() : this.show(e.detail === 0)));
    }

    panelHTML() {
      var hint = readHint();
      var current = this.getAttribute("app") || "";
      var unread = hint && hint.unread ? Number(hint.unread) : 0;
      var connected = (hint && hint.services) || [];
      var me;
      if (hint) {
        me = '<div class="me">' + avatar(hint) +
          '<div class="name">' + esc(hint.name || hint.email || t("SK Hub Systems アカウント")) + "</div>" +
          (hint.email ? '<div class="sub">' + esc(hint.email) + "</div>" : "") +
          '<a class="pill" href="' + lp("/account/") + '">' + esc(t("アカウントを管理")) + "</a></div>";
      } else {
        me = '<div class="me">' + avatar(null) +
          '<div class="name">' + esc(t("SK Hub Systems アカウント")) + "</div>" +
          '<p class="lead">' + esc(t("ログインすると、SK のアプリの記録や設定を、ほかの端末とまとめられます。")) + "</p>" +
          '<div class="pills"><a class="pill" href="' + lp("/account/") + "?next=" + encodeURIComponent(here()) + '">' + esc(t("ログイン")) + "</a>" +
          '<a class="pill ghost" href="' + lp("/sk-hub-systems/account/") + '">' + esc(t("詳しく")) + "</a></div></div>";
      }

      var apps = APPS.map(function (a) {
        var isHere = a.key === current;
        var note = hint && connected.indexOf(a.key) >= 0 ? "<small>" + esc(t("接続中")) + "</small>" : "";
        return '<a class="app' + (isHere ? " is-here" : "") + '" href="' + a.url + '"' + (isHere ? ' aria-current="page" data-here="' + esc(t("いまここ")) + '"' : "") + ">" +
          '<img src="' + a.icon + '" alt=""' + (a.dark ? ' class="dark"' : "") + ">" +
          "<span>" + esc(t(a.short || a.name)) + note + "</span></a>";
      }).join("");

      var rows = hint ?
        '<div class="list">' +
          '<a class="row" href="' + lp("/account/#notices") + '">' + ICON.bell + "<span>" + esc(t("お知らせ")) + "</span>" + (unread ? '<span class="count">' + unread + "</span>" : "") + '<span class="chev">' + ICON.chev + "</span></a>" +
          '<a class="row" href="' + lp("/account/#privacy") + '">' + ICON.shield + "<span>" + esc(t("データのダウンロード・削除")) + '</span><span class="chev">' + ICON.chev + "</span></a>" +
          '<a class="row" href="' + lp("/account/?signout=1") + '">' + ICON.out + "<span>" + esc(t("ログアウト")) + "</span></a>" +
        "</div>" : "";

      return '<div class="panel' + (isDark() ? " dark" : "") + '" role="dialog" aria-modal="false" aria-label="' + esc(t("SK Hub Systems アカウント")) + '" tabindex="-1">' +
        '<div class="head"><span class="brand"><img src="/assets/logo.svg" alt="">' + esc(t("SK Hub Systems アカウント")) + "</span>" +
        '<button class="x" type="button" aria-label="' + esc(t("閉じる")) + '">' + ICON.close + "</button></div>" +
        me +
        '<div class="label">' + esc(t("SK のアプリ")) + "</div>" +
        '<div class="apps">' + apps + "</div>" +
        rows +
        '<div class="foot"><a href="' + lp("/policies/privacy/") + '">' + esc(t("プライバシーポリシー")) + "</a>" +
        '<a href="' + lp("/policies/#sk-hub-account") + '">' + esc(t("アカウント規約")) + "</a>" +
        '<a href="' + lp("/sk-hub-systems/account/") + '">' + esc(t("SK Hub Systems アカウントについて")) + "</a></div>" +
        "</div>";
    }

    show(focus) {
      this.close(true);
      this.open = true;
      var wrap = document.createElement("div");
      wrap.innerHTML = '<div class="scrim"></div>' + this.panelHTML();
      this.scrim = wrap.firstChild;
      this.panel = wrap.lastChild;
      this.root.append(this.scrim, this.panel);
      this.scrim.addEventListener("click", () => this.close());
      this.panel.querySelector(".x").addEventListener("click", () => this.close());
      this.button.setAttribute("aria-expanded", "true");
      this.place();
      window.addEventListener("resize", this.place);
      document.addEventListener("keydown", this.onKey, true);
      if (focus) (this.panel.querySelector(".pill") || this.panel).focus({ preventScroll: true });
    }

    // ボタンの右下にそろえて開く（スマホでは下から出る。CSS）
    place() {
      if (!this.panel) return;
      var r = this.button.getBoundingClientRect();
      var right = Math.max(8, window.innerWidth - r.right);
      this.panel.style.right = right + "px";
      this.panel.style.left = "auto";
      this.panel.style.top = Math.min(r.bottom + 8, window.innerHeight - 80) + "px";
    }

    close(instant) {
      if (!this.panel) { this.open = false; return; }
      var panel = this.panel, scrim = this.scrim;
      this.panel = this.scrim = null;
      this.open = false;
      this.button.setAttribute("aria-expanded", "false");
      window.removeEventListener("resize", this.place);
      document.removeEventListener("keydown", this.onKey, true);
      var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (instant || reduced) { panel.remove(); scrim.remove(); return; }
      panel.classList.add("out");
      scrim.remove();
      setTimeout(function () { panel.remove(); }, 170);
      if (!instant) this.button.focus({ preventScroll: true });
    }

    onKey(e) {
      if (e.key === "Escape") { e.stopPropagation(); this.close(); }
    }
  }

  customElements.define("sk-account-button", SKAccountButton);
})();
