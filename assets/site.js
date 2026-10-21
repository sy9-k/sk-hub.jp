// SK — サイト共通スクリプト（ヘッダーメニュー・サポートID・規約・アップデート・お知らせ・トップのアニメーション）
// お問い合わせフォームは contact/contact.js
(function () {
  "use strict";

  const UUID_KEY = "skhub_uuid"; // frameworks/check.js の CONFIG.UUID_KEY と同じ

  // 多言語（assets/i18n.js）。t("日本語") で訳、lp("/about/") で同じ言語のページの URL
  const I18N = window.SKI18N || { lang: "ja", LANGS: [], t: (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m)) : s), path: (u) => u, date: (s) => s };
  const t = I18N.t;
  const lp = I18N.path;

  // ---------- ヘッダーのアカウント ----------
  // SK Hub Systems アカウントでログイン中なら、アイコンを出す（名前とアイコンは assets/hub/account.js がこのブラウザに保存する。
  // ここでは Firebase を読み込まない）
  //   hint = { name, photo（Google の写真。頭文字にしている人は空）, letter, color, unread（お知らせの未読の数） }
  let accountHint = null;
  let accountPhoto = "";
  let accountUnread = 0;
  function readAccountHint() {
    try { accountHint = JSON.parse(localStorage.getItem("skhub_account") || "null"); } catch (e) { accountHint = null; }
    accountPhoto = accountHint && /^https:\/\//.test(accountHint.photo || "") ? accountHint.photo : "";
    accountUnread = accountHint ? Math.max(0, Number(accountHint.unread) || 0) : 0;
  }
  readAccountHint();

  // 写真がなければ頭文字（プロフィールで選んだ色）
  function accountAvatar(className) {
    const letter = () => {
      const span = document.createElement("span");
      span.className = `${className} hd-avatar-letter`;
      span.textContent = accountHint.letter || "?";
      if (/^#[0-9a-f]{6}$/i.test(accountHint.color || "")) span.style.background = accountHint.color;
      span.setAttribute("aria-hidden", "true");
      return span;
    };
    if (!accountPhoto) return accountHint && accountHint.letter ? letter() : null;
    const img = document.createElement("img");
    img.className = className;
    img.src = accountPhoto;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", () => img.replaceWith(letter()));
    return img;
  }

  const accountLink = document.querySelector("[data-account-link]");
  function renderAccountLink() {
    if (!accountLink) return;
    accountLink.querySelectorAll(".hd-account-photo, .hd-account-badge").forEach((el) => el.remove());
    const avatar = accountHint && accountAvatar("hd-account-photo");
    if (avatar) accountLink.prepend(avatar);
    if (accountUnread) {
      const badge = document.createElement("span");
      badge.className = "hd-account-badge";
      badge.setAttribute("aria-hidden", "true");
      accountLink.appendChild(badge);
    }
    if (accountHint) {
      const label = t("アカウント（{name}）", { name: accountHint.name || t("ログイン中") });
      accountLink.setAttribute("aria-label", accountUnread ? `${label} ${t("未読のお知らせ {n} 件", { n: accountUnread })}` : label);
    } else {
      accountLink.removeAttribute("aria-label");
    }
  }
  renderAccountLink();

  // ヘッダーのアカウントのメニュー。ログイン中かどうかで中身を変える（profile があると、名前とアイコンを一覧の上に出す）
  function accountMenu() {
    return accountHint ? {
      title: t("SK Hub Systems アカウント"),
      profile: accountHint,
      appearance: true,
      items: [
        [t("アカウント"), lp("/account/")],
        [accountUnread ? t("お知らせ（{n}）", { n: accountUnread }) : t("お知らせ"), lp("/account/#notices")],
        // 接続しているサービスだけ（接続は、サービスを最初に使うときに確かめる）
        ...((accountHint.services || []).includes("yfilter") ? [[t("Y-FILTER. 管理コンソール"), "/y-filter/"]] : []),
        [t("データのダウンロード・削除"), lp("/account/#privacy")],
        [t("ログアウト"), lp("/account/?signout=1")]
      ]
    } : {
      title: t("SK Hub Systems アカウント"),
      appearance: true,
      items: [
        [t("ログイン・アカウントを作成"), lp("/account/")],
        [t("SK Hub Systems アカウントとは"), lp("https://support.sk-hub.jp/?a=account-about")],
        [t("Y-FILTER. 管理コンソール"), "/y-filter/"]
      ]
    };
  }

  // ---------- ヘッダーメニュー（search3958 の headerv2 と同じ動き） ----------
  // PC: 項目にマウスを乗せると白いパネルが下に開く。スマホ: 2 本線ボタン → 一覧 → 項目を選ぶとロゴが「戻る」になる。
  const MENUS = {
    // groups があると、見出しつきの列に分けて出す（スマホでは縦に並ぶ）
    products: {
      title: t("プロダクト"),
      groups: [
        {
          title: t("プロダクト"),
          items: [
            [t("すべてのプロダクト"), lp("/products/")],
            ["SK Hub Systems", lp("/sk-hub-systems/")],
            ["SK's Brand", lp("/brand/")],
            ["SK's Toolbox", lp("/toolbox/")]
          ]
        },
        {
          title: t("SK のプロダクト"),
          items: [
            ["Y-FILTER.", lp("/products/y-filter/")],
            ["MALU", lp("/products/malu/")],
            ["Nagi", lp("/products/nagi/")],
            ["SK Hub Office", lp("/products/office/")],
            ["SK's Lab", lp("/lab/")]
          ]
        }
      ]
    },
    support: {
      title: t("サポートと情報"),
      groups: [
        {
          title: t("困ったとき"),
          items: [
            [t("サポート記事"), lp("https://support.sk-hub.jp/")],
            [t("お知らせ"), lp("https://support.sk-hub.jp/?type=news")],
            [t("お問い合わせ"), lp("https://support.sk-hub.jp/contact/")],
            [t("システム稼働状況"), "https://sk-hub.online/"]
          ]
        },
        {
          title: t("情報"),
          items: [
            [t("アップデート"), lp("/updates/")],
            [t("利用規約とプライバシーポリシー"), lp("/policies/")],
            ["SK's Brand", lp("/brand/")],
            ["Link & Credit", lp("/credits/")],
            [t("私について"), lp("/about/")],
            [t("私のGitHub"), "https://github.com/sy9-k"]
          ]
        }
      ]
    },
    account: accountMenu()
  };
  // ページごとのメニュー（管理コンソールなど）。site.js より先に window.SK_HEADER = { menus: { 名前: メニュー } } を置くと差し替わる
  //   メニューはオブジェクトか、ログイン情報（名前・アイコン。未ログインなら null）を受け取って返す関数
  //   項目は [文字, URL] か { label, href, action }（action があるとメニューを閉じてから実行する）
  const customMenus = (window.SK_HEADER && window.SK_HEADER.menus) || {};
  function applyCustomMenus() {
    Object.entries(customMenus).forEach(([key, menu]) => {
      MENUS[key] = typeof menu === "function" ? menu(accountHint) : menu;
    });
  }
  applyCustomMenus();
  // ログイン・ログアウトしたら（assets/hub/account.js が知らせる）ヘッダーを更新する
  document.addEventListener("skhub:account", () => {
    readAccountHint();
    renderAccountLink();
    MENUS.account = accountMenu();
    applyCustomMenus();
  });
  const MOBILE_BREAKPOINT = 680;

  const header = document.querySelector(".site-header");
  const menu = document.getElementById("hd-menu");
  const backdrop = document.getElementById("hd-backdrop");

  if (header && menu && backdrop) {
    const inner = menu.querySelector(".hd-menu-inner");
    const content = menu.querySelector(".hd-menu-content");
    const menuBtn = header.querySelector(".hd-menu-btn");
    const logo = header.querySelector(".hd-logo");
    const headerItems = Array.from(header.children);
    const navItems = headerItems.filter(el => el.matches("a.hd-item"));
    const triggers = navItems.filter(el => el.dataset.menu);

    let activeType = null;
    let mobileLevel = "root";
    let closeTimer = null;
    let switchTimer = null;

    // 細いヘッダー（<html class="hd-compact">。SK's Toolbox をアプリとして開いたとき）は、幅によらずスマホと同じ
    const isMobile = () => window.innerWidth <= MOBILE_BREAKPOINT || document.documentElement.classList.contains("hd-compact");
    const fitHeight = () => { menu.style.height = `${inner.scrollHeight + (header.offsetHeight || 52)}px`; };
    const setExpanded = active => triggers.forEach(t => t.setAttribute("aria-expanded", String(t === active)));

    // start … 順番に出てくる動きの何番目から始めるか（列に分けたとき、前の列の続きから）
    function makeList(entries, start = 0) {
      const list = document.createElement("ul");
      list.className = "hd-menu-list";
      entries.forEach(([label, href, onClick], i) => {
        const li = document.createElement("li");
        li.style.setProperty("--i", String(start + i));
        const a = document.createElement("a");
        a.className = "hd-menu-link";
        a.href = href;
        a.textContent = label;
        if (/^https?:/.test(href)) { a.target = "_blank"; a.rel = "noopener"; }
        if (onClick) a.addEventListener("click", onClick);
        li.appendChild(a);
        list.appendChild(li);
      });
      return list;
    }

    const menuTitle = text => {
      const title = document.createElement("div");
      title.className = "hd-menu-title";
      title.textContent = text;
      return title;
    };
    const toEntries = items => items.map(item => {
      if (Array.isArray(item)) return item;
      if (!item.action) return [item.label, item.href];
      return [item.label, item.href || "#", e => { e.preventDefault(); closeMenu(); item.action(); }];
    });

    function renderMenu(type) {
      const data = MENUS[type];
      if (data.groups) {
        const groups = document.createElement("div");
        groups.className = "hd-menu-groups";
        let count = 0;
        data.groups.forEach(group => {
          const col = document.createElement("div");
          col.className = "hd-menu-group";
          col.append(menuTitle(group.title), makeList(toEntries(group.items), count));
          count += group.items.length;
          groups.appendChild(col);
        });
        content.replaceChildren(groups);
        return;
      }
      const nodes = [menuTitle(data.title)];
      if (data.profile) {
        const profile = document.createElement("div");
        profile.className = "hd-menu-profile";
        const avatar = accountAvatar("hd-menu-profile-photo");
        if (avatar) profile.appendChild(avatar);
        const text = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = data.profile.name || t("ログイン中");
        const sub = document.createElement("small");
        sub.textContent = t("ログイン中");
        text.append(name, sub);
        profile.appendChild(text);
        nodes.push(profile);
      }
      nodes.push(makeList(toEntries(data.items)));
      // アカウントのメニューのいちばん下に「表示」（ライト・ダーク・テーマカラー）
      if (data.appearance) nodes.push(themeMenuBlock());
      content.replaceChildren(...nodes);
    }

    function renderMobileRoot() {
      // hidden の項目（管理コンソールでログイン前の「端末」など）は出さない
      content.replaceChildren(makeList(navItems.filter(item => !item.hidden).map(item => {
        const type = item.dataset.menu;
        if (!type) return [item.textContent.trim(), item.getAttribute("href")];
        return [item.textContent.trim(), "#", e => { e.preventDefault(); openMobileSubmenu(type); }];
      })));
    }

    // 中身を入れ替えるときは一度フェードしてから高さを合わせ直す
    function swapContent(render) {
      clearTimeout(switchTimer);
      content.classList.add("is-fading");
      switchTimer = setTimeout(() => {
        render();
        fitHeight();
        requestAnimationFrame(() => content.classList.remove("is-fading"));
      }, 180);
    }

    function showPanel() {
      menu.classList.add("is-open");
      backdrop.classList.add("is-open");
      fitHeight();
    }

    function setMobileState(open, submenu) {
      if (menuBtn) {
        menuBtn.classList.toggle("is-open", open);
        menuBtn.setAttribute("aria-expanded", String(open));
        menuBtn.setAttribute("aria-label", open ? t("閉じる") : t("メニュー"));
      }
      logo.classList.toggle("is-back", submenu);
      logo.setAttribute("aria-label", submenu ? t("戻る") : t("ホーム"));
    }

    function openMenu(type, trigger) {
      if (isMobile() || !MENUS[type]) return;
      clearTimeout(closeTimer);
      setExpanded(trigger);
      if (activeType === type) return;
      if (activeType === null) {
        renderMenu(type);
        activeType = type;
        showPanel();
      } else {
        activeType = type;
        swapContent(() => renderMenu(type));
      }
    }

    function closeMenu() {
      clearTimeout(closeTimer);
      clearTimeout(switchTimer);
      activeType = null;
      mobileLevel = "root";
      setExpanded(null);
      menu.classList.remove("is-open");
      backdrop.classList.remove("is-open");
      menu.style.height = "0px";
      content.classList.remove("is-fading");
      setMobileState(false, false);
    }

    function scheduleClose() {
      if (isMobile()) return;
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => {
        const hovering = headerItems.some(el => el.matches(":hover")) || menu.matches(":hover");
        if (!hovering) closeMenu();
      }, 80);
    }

    function openMobileRoot() {
      renderMobileRoot();
      activeType = null;
      mobileLevel = "root";
      showPanel();
      setMobileState(true, false);
    }

    function openMobileSubmenu(type) {
      mobileLevel = "submenu";
      activeType = type;
      swapContent(() => renderMenu(type));
      setMobileState(true, true);
    }

    function backToMobileRoot() {
      mobileLevel = "root";
      activeType = null;
      swapContent(renderMobileRoot);
      setMobileState(true, false);
    }

    headerItems.forEach(item => {
      item.addEventListener("pointerenter", () => {
        if (isMobile()) return;
        clearTimeout(closeTimer);
        if (item.dataset.menu) openMenu(item.dataset.menu, item);
        else closeMenu();
      });
      item.addEventListener("pointerleave", scheduleClose);
    });

    triggers.forEach(trigger => {
      trigger.setAttribute("aria-haspopup", "true");
      trigger.setAttribute("aria-controls", "hd-menu");
      // キーボード操作でも開けるように
      trigger.addEventListener("focus", () => openMenu(trigger.dataset.menu, trigger));
      if (trigger.dataset.noNavigation === "true") {
        trigger.addEventListener("click", e => {
          e.preventDefault();
          openMenu(trigger.dataset.menu, trigger);
        });
      }
    });

    // 何もないところにマウスが来たら閉じる
    header.addEventListener("pointermove", e => {
      if (!isMobile() && e.target === header) closeMenu();
    });
    menu.addEventListener("pointerenter", () => { if (!isMobile()) clearTimeout(closeTimer); });
    menu.addEventListener("pointerleave", scheduleClose);
    menu.addEventListener("focusout", e => {
      if (!isMobile() && !menu.contains(e.relatedTarget) && !header.contains(e.relatedTarget)) closeMenu();
    });
    backdrop.addEventListener("pointerenter", scheduleClose);
    backdrop.addEventListener("click", closeMenu);

    if (menuBtn) {
      menuBtn.addEventListener("click", e => {
        if (!isMobile()) return;
        e.preventDefault();
        if (menu.classList.contains("is-open")) closeMenu();
        else openMobileRoot();
      });
    }

    logo.addEventListener("click", e => {
      if (!isMobile() || mobileLevel !== "submenu" || !menu.classList.contains("is-open")) return;
      e.preventDefault();
      backToMobileRoot();
    });

    document.addEventListener("keydown", e => {
      if (e.key !== "Escape" || !menu.classList.contains("is-open")) return;
      const focusBack = triggers.find(t => t.getAttribute("aria-expanded") === "true") || menuBtn;
      closeMenu();
      if (focusBack && !isMobile()) focusBack.focus({ preventScroll: true });
    });

    let lastMobile = isMobile();
    window.addEventListener("resize", () => {
      if (isMobile() !== lastMobile) {
        lastMobile = isMobile();
        closeMenu();
      } else if (menu.classList.contains("is-open")) {
        fitHeight();
      }
    }, { passive: true });

    // 同じページの中の移動（サポートの #malu など）でも、メニューを閉じる
    window.addEventListener("hashchange", () => { if (menu.classList.contains("is-open")) closeMenu(); });

    window.addEventListener("scroll", () => {
      if (menu.classList.contains("is-open") && !menu.contains(document.activeElement)) closeMenu();
    }, { passive: true });

    setMobileState(false, false);
  }

  // ---------- 言語の切り替え ----------
  // ヘッダーの地球のアイコン（スマホはメニューの「言語」）→ /lang/（戻り先つき）
  const here = location.pathname + location.search + location.hash;
  document.querySelectorAll("[data-lang-link]").forEach((a) => { a.href = `/lang/?next=${encodeURIComponent(here)}`; });

  // ---------- アクセス解析の設定（フッター。assets/analytics.js） ----------
  // 測定 ID が入っているときだけ出す。押すと、許可するかをもう一度たずねる
  function setupAnalyticsLink() {
    const a = window.SKAnalytics;
    document.querySelectorAll("[data-analytics-settings]").forEach((li) => {
      li.hidden = !(a && a.enabled());
      const link = li.querySelector("a");
      if (link && !link.dataset.bound) {
        link.dataset.bound = "1";
        link.addEventListener("click", (e) => { e.preventDefault(); if (window.SKAnalytics) window.SKAnalytics.open(); });
      }
    });
  }
  // analytics.js は site.js より後に読み込まれるので、読み込み終わってから
  if (document.readyState === "complete") setupAnalyticsLink();
  else window.addEventListener("load", setupAnalyticsLink);

  // ---------- このブラウザの Y-FILTER.（製品ページ・トップ） ----------
  // 拡張機能（y-filter リポジトリの site-bridge.js）が <html data-yfilter-version="7.0.2"> を付ける。
  //   data-yf-when="installed" / "missing" … 入っている・いないで出し分け（site.css。JS なしで効く）
  //   data-yf-version … 入っている版 / data-yf-latest … 最新の版（/y-filter/shared/version.json）
  //   data-yf-update  … 入っている版が古いときだけ出す / data-yf-uptodate … 最新のときだけ出す
  const olderThan = (a, b) => {
    const pa = String(a).split(".").map(Number);
    const pb = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0);
    }
    return false;
  };
  let yfChecked = false;
  function applyYFilter() {
    const installed = document.documentElement.dataset.yfilterVersion || "";
    if (!installed || yfChecked || !document.querySelector("[data-yf-version], [data-yf-update], [data-yf-uptodate]")) return;
    yfChecked = true;
    document.querySelectorAll("[data-yf-version]").forEach((el) => { el.textContent = installed; });
    fetch("/y-filter/shared/version.json", { cache: "no-cache" })
      .then((res) => res.json())
      .then(({ version: latest }) => {
        if (!latest) return;
        const old = olderThan(installed, latest);
        document.querySelectorAll("[data-yf-latest]").forEach((el) => { el.textContent = latest; });
        document.querySelectorAll("[data-yf-update]").forEach((el) => { el.hidden = !old; });
        document.querySelectorAll("[data-yf-uptodate]").forEach((el) => { el.hidden = old; });
      })
      .catch(() => { /* 最新の版がわからなければ、入っている版だけ出す */ });
  }
  applyYFilter();
  document.addEventListener("yfilter:present", applyYFilter);

  // ---------- 表示（ライト・ダーク・テーマカラー。ヘッダーのアカウントのメニューの「表示」） ----------
  // 選んだものは、このブラウザの localStorage（sk_theme = { mode: auto|light|dark, accent }）に保存する。
  // <html data-theme / data-accent> は、ちらつかないよう <head> の小さなスクリプト（index.html）が最初に付ける。色は site.css のトークン
  const THEME_KEY = "sk_theme";
  // site.css の :root[data-accent="…"] と同じ名前。color はボタンの色（ライトのときのテーマカラー）
  const ACCENTS = [
    { key: "blue", name: "SK's Blue", color: "#2563eb" },
    { key: "sakura", name: "SK's Sakura", color: "#db2777" },
    { key: "matcha", name: "SK's Matcha", color: "#16a34a" },
    { key: "mikan", name: "SK's Mikan", color: "#ea580c" },
    { key: "fuji", name: "SK's Fuji", color: "#7c3aed" },
    { key: "sora", name: "SK's Sora", color: "#0891b2" },
    { key: "sumi", name: "SK's Sumi", color: "#334155" }
  ];
  const ACCENT_NOTES = {
    blue: t("いつもの青"), sakura: t("さくら"), matcha: t("抹茶"), mikan: t("みかん"), fuji: t("藤"), sora: t("空"), sumi: t("墨")
  };

  function readTheme() {
    try {
      const v = JSON.parse(localStorage.getItem(THEME_KEY) || "{}");
      return {
        mode: v.mode === "light" || v.mode === "dark" ? v.mode : "auto",
        accent: ACCENTS.some((a) => a.key === v.accent) ? v.accent : "blue"
      };
    } catch (e) {
      return { mode: "auto", accent: "blue" };
    }
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    if (theme.mode === "auto") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme.mode);
    if (theme.accent === "blue") root.removeAttribute("data-accent");
    else root.setAttribute("data-accent", theme.accent);
    // スマホのブラウザの上の帯の色（ページの背景に合わせる）
    const meta = document.querySelector("meta[data-theme-color]");
    if (meta) meta.setAttribute("content", getComputedStyle(root).getPropertyValue("--bg").trim() || "#ffffff");
    renderThemePicker(theme);
    // ほかのスクリプト（SK's Brand のページなど）に知らせる
    document.dispatchEvent(new CustomEvent("sk:theme", { detail: theme }));
  }

  function saveTheme(theme) {
    try { localStorage.setItem(THEME_KEY, JSON.stringify(theme)); } catch (e) { /* 保存できなくても、このページでは変わる */ }
    applyTheme(theme);
  }

  // 押したボタンのところから、新しい色が円く広がって切り替わる（View Transitions）。
  // ページを移動するときの動き（header.css）は、切り替えのあいだだけ止める（html.sk-theme-switching。site.css）
  function switchTheme(next, button, event) {
    const current = readTheme();
    if (current.mode === next.mode && current.accent === next.accent) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || reduced) { saveTheme(next); return; }
    // キーボードで押したときは、ボタンの真ん中から
    let x = event && event.clientX, y = event && event.clientY;
    if (!x && !y && button) {
      const r = button.getBoundingClientRect();
      x = r.left + r.width / 2;
      y = r.top + r.height / 2;
    }
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const root = document.documentElement;
    root.classList.add("sk-theme-switching");
    const transition = document.startViewTransition(() => saveTheme(next));
    transition.ready.then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 560, easing: "cubic-bezier(.22, 1, .36, 1)", pseudoElement: "::view-transition-new(root)" }
      );
    }).catch(() => {});
    transition.finished.finally(() => root.classList.remove("sk-theme-switching"));
  }

  // root … まだページに入れていないメニューの中身のときは、その要素
  function renderThemePicker(theme, root = document) {
    root.querySelectorAll("[data-theme-mode]").forEach((btn) => {
      btn.setAttribute("aria-checked", String(btn.dataset.themeMode === theme.mode));
    });
    root.querySelectorAll("[data-theme-colors] button").forEach((btn) => {
      btn.setAttribute("aria-checked", String(btn.dataset.accent === theme.accent));
    });
    const accent = ACCENTS.find((a) => a.key === theme.accent) || ACCENTS[0];
    root.querySelectorAll("[data-theme-name]").forEach((el) => {
      const text = `${accent.name}（${ACCENT_NOTES[accent.key]}）`;
      if (el.textContent === text) return;
      // 名前が変わったときは、ふわっと入れ替える（最初に出すときは動かさない）
      const changed = !!el.textContent;
      el.textContent = text;
      if (changed) {
        el.classList.remove("is-changed");
        void el.offsetWidth;
        el.classList.add("is-changed");
      }
    });
  }

  // 「表示」のボタン（ヘッダーのアカウントのメニュー）に、色のボタンを入れて押せるようにする
  function bindThemeControls(root) {
    root.querySelectorAll("[data-theme-colors]:not([data-bound])").forEach((box) => {
      box.dataset.bound = "1";
      box.replaceChildren(...ACCENTS.map((a) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("role", "radio");
        btn.dataset.accent = a.key;
        btn.style.setProperty("--swatch", a.color);
        btn.setAttribute("aria-label", `${a.name}（${ACCENT_NOTES[a.key]}）`);
        btn.title = `${a.name}（${ACCENT_NOTES[a.key]}）`;
        btn.addEventListener("click", (e) => switchTheme({ ...readTheme(), accent: a.key }, btn, e));
        return btn;
      }));
    });
    root.querySelectorAll("[data-theme-mode]:not([data-bound])").forEach((btn) => {
      btn.dataset.bound = "1";
      btn.addEventListener("click", (e) => switchTheme({ ...readTheme(), mode: btn.dataset.themeMode }, btn, e));
    });
    renderThemePicker(readTheme(), root);
  }

  // ヘッダーのアカウントのメニューのいちばん下に出す「表示」
  function themeMenuBlock() {
    const block = document.createElement("div");
    block.className = "hd-menu-theme";
    block.innerHTML =
      '<div class="hd-menu-title"></div>' +
      '<div class="hd-theme-row"><div class="hd-theme-modes" role="radiogroup">' +
      '<button type="button" role="radio" data-theme-mode="auto"></button>' +
      '<button type="button" role="radio" data-theme-mode="light"></button>' +
      '<button type="button" role="radio" data-theme-mode="dark"></button></div>' +
      '<div class="hd-theme-colors" role="radiogroup" data-theme-colors></div>' +
      '<span class="hd-theme-name" data-theme-name></span></div>';
    block.querySelector(".hd-menu-title").textContent = t("表示");
    block.querySelector(".hd-theme-modes").setAttribute("aria-label", t("表示"));
    block.querySelector(".hd-theme-colors").setAttribute("aria-label", t("テーマカラー"));
    block.querySelector('[data-theme-mode="auto"]').textContent = t("自動");
    block.querySelector('[data-theme-mode="light"]').textContent = t("ライト");
    block.querySelector('[data-theme-mode="dark"]').textContent = t("ダーク");
    bindThemeControls(block);
    return block;
  }

  function setupThemePicker() {
    bindThemeControls(document);
    applyTheme(readTheme());
    // 読み込んだときは色の丸を弾ませない（選び直したときだけ。site.css の html.sk-theme-ready）
    requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.add("sk-theme-ready")));
    // ほかのタブで変えたときも合わせる
    window.addEventListener("storage", (e) => { if (e.key === THEME_KEY) applyTheme(readTheme()); });
    // 「自動」のときは、端末のライト・ダークが変わったらスマホの帯の色も合わせる
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => applyTheme(readTheme()));
  }
  setupThemePicker();
  // ほかのページのスクリプトから「表示」を変えるときの入口（/brand/brand.js）。set は切り替えのアニメーションつき
  window.SKTheme = {
    get: readTheme,
    set: (patch, button, event) => switchTheme({ ...readTheme(), ...patch }, button, event)
  };

  // ---------- サポートID ----------
  const idEls = document.querySelectorAll("[data-support-id]");
  const copyBtns = document.querySelectorAll("[data-copy-id]");

  function readId() {
    try { return localStorage.getItem(UUID_KEY) || ""; } catch (e) { return ""; }
  }

  function renderId() {
    const id = readId();
    idEls.forEach(el => { el.textContent = id || t("まだ発行されていません（利用規約に同意すると発行されます）"); });
    copyBtns.forEach(btn => { btn.hidden = !id; });
  }

  copyBtns.forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = readId();
      if (!id) return;
      try {
        await navigator.clipboard.writeText(id);
        btn.textContent = t("コピーしました");
      } catch (e) {
        btn.textContent = t("コピーできませんでした");
      }
      setTimeout(() => { btn.textContent = t("コピー"); }, 1800);
    });
  });

  if (idEls.length) {
    renderId();
    document.addEventListener("skhub:ready", renderId);
  }

  // ---------- 利用規約ページ ----------
  // 本文は /policies/docs/*.txt（Y-FILTER. の個別規約は拡張機能のリポジトリから systems/sync-console.mjs でコピーされる）
  // 訳文は /policies/docs/<名前>.<言語>.txt（参考訳。正文は日本語）。Y-FILTER. の規約はまだ訳していないので日本語で出す
  const viewer = document.querySelector("[data-policy-viewer]");
  if (viewer) {
    const DOCS = {
      "sk-terms": "sk-terms",
      "sk-privacy": "sk-privacy",
      "sk-hub-account": "sk-hub-account",
      "y-filter": "y-filter",
      "sk-hub-systems": "sk-hub-systems",
      "newtab": "newtab"
    };
    // 訳文がある規約（policies/docs/<名前>.<言語>.txt）。Y-FILTER. と Newtab の規約は日本語だけ
    const TRANSLATED = ["sk-terms", "sk-privacy", "sk-hub-account", "sk-hub-systems"];
    const fileOf = (id) => (I18N.lang !== "ja" && TRANSLATED.includes(id) ? `${DOCS[id]}.${I18N.lang}.txt` : `${DOCS[id]}.txt`);
    // 以前のページ内リンク
    const ALIASES = { terms: "sk-terms", privacy: "sk-privacy", products: "y-filter" };
    const links = document.querySelectorAll("[data-policy-link]");
    const layout = document.getElementById("policy-docs");
    let current = null;

    // URL をリンクにした段落を作る（本文は textContent で入れる）
    function paragraph(text, className) {
      const p = document.createElement("p");
      if (className) p.className = className;
      text.split(/(https?:\/\/[^\s）)」、。]+)/).forEach((part, i) => {
        if (i % 2 === 1) {
          const a = document.createElement("a");
          a.href = part;
          a.textContent = part;
          if (!part.startsWith(location.origin)) { a.target = "_blank"; a.rel = "noopener"; }
          p.appendChild(a);
        } else if (part) {
          p.appendChild(document.createTextNode(part));
        }
      });
      return p;
    }

    function render(text, file, id) {
      const nodes = [];
      let titled = false;
      if (I18N.lang !== "ja") {
        // 訳文は参考。まだ訳していない規約は日本語のまま出す
        const note = document.createElement("p");
        note.className = "doc-lang-note";
        note.textContent = TRANSLATED.includes(id)
          ? t("この訳文は参考です。内容に違いがある場合は、日本語版が正式なものになります。")
          : t("この規約は、まだ日本語でのみ提供しています。");
        nodes.push(note);
      }
      text.split(/\r?\n/).forEach(raw => {
        const line = raw.trim();
        if (!line) return;
        if (!titled) {
          const h = document.createElement("h2");
          h.className = "doc-title";
          h.textContent = line;
          nodes.push(h);
          titled = true;
        } else if (/^(制定日|Established|制定日期|제정일)/.test(line)) {
          nodes.push(paragraph(line, "meta"));
        } else if (/^(第[一二三四五六七八九十]+[条條]|附則|附则|Article \d+|Supplementary Provisions|제\d+조|부칙)/.test(line)) {
          const h = document.createElement("h3");
          h.textContent = line;
          nodes.push(h);
        } else if (/^\([a-z]\)/.test(line)) {
          nodes.push(paragraph(line, "sub"));
        } else {
          nodes.push(paragraph(line));
        }
      });
      const raw = document.createElement("p");
      raw.className = "raw-link";
      const a = document.createElement("a");
      a.href = `/policies/docs/${file}`;
      a.textContent = t("テキストファイルで見る");
      raw.appendChild(a);
      nodes.push(raw);
      viewer.replaceChildren(...nodes);
    }

    async function show(id, scroll) {
      if (current === id) return;
      current = id;
      links.forEach(l => l.classList.toggle("active", l.dataset.policyLink === id));
      viewer.setAttribute("aria-busy", "true");
      try {
        const res = await fetch(`/policies/docs/${fileOf(id)}`, { cache: "no-cache" });
        if (!res.ok) throw new Error(String(res.status));
        render(await res.text(), fileOf(id), id);
      } catch (e) {
        viewer.replaceChildren(paragraph(t("規約を読み込めませんでした。時間をおいて再度お試しください。")));
        current = null;
      } finally {
        viewer.removeAttribute("aria-busy");
      }
      if (scroll && layout) layout.scrollIntoView({ block: "start" });
    }

    function route(scroll) {
      const hash = decodeURIComponent(location.hash.slice(1));
      const id = ALIASES[hash] || hash;
      if (DOCS[id]) show(id, scroll);
      else if (!current) show("sk-terms", false);
    }

    window.addEventListener("hashchange", () => route(true));
    route(!!location.hash);
  }

  // ---------- アップデート情報（/updates/updates.json） ----------
  // <ol data-updates data-limit="3"> … 新しい順に表示する（data-limit がなければすべて）
  const updateLists = document.querySelectorAll("[data-updates]");
  if (updateLists.length) {
    const CATEGORY_CLASS = { "SK": "cat-sk", "Y-FILTER.": "cat-yf", "SK Hub Systems": "cat-hub", "MALU": "cat-malu", "Nagi": "cat-nagi", "Lab": "cat-lab" };
    const formatDate = (s) => I18N.date(s);
    // 訳は各項目の i18n: { "en": { title, body, label } }（なければ日本語）
    const localize = (it) => {
      const tr = (it.i18n && it.i18n[I18N.lang]) || {};
      return {
        ...it,
        title: tr.title || it.title,
        body: tr.body || it.body,
        link: it.link ? { href: lp(it.link.href), label: tr.label || it.link.label } : null
      };
    };
    const renderUpdates = (list, items) => {
      const limit = Number(list.dataset.limit || 0);
      const filter = list.dataset.category || "";
      const shown = items.filter((it) => !filter || it.category === filter).slice(0, limit || undefined);
      list.replaceChildren(...shown.map((it) => {
        const li = document.createElement("li");
        const time = document.createElement("time");
        time.dateTime = it.date;
        time.textContent = formatDate(it.date);
        const body = document.createElement("div");
        const cat = document.createElement("span");
        cat.className = `update-cat ${CATEGORY_CLASS[it.category] || ""}`;
        cat.textContent = it.category;
        const title = document.createElement("strong");
        title.textContent = it.title;
        const text = document.createElement("p");
        text.textContent = it.body;
        body.append(cat, title, text);
        if (it.link) {
          const a = document.createElement("a");
          a.className = "update-link";
          a.href = it.link.href;
          a.textContent = it.link.label;
          body.appendChild(a);
        }
        li.append(time, body);
        return li;
      }));
      if (!shown.length) {
        const li = document.createElement("li");
        li.className = "update-empty";
        li.textContent = t("このカテゴリのアップデートはまだありません。");
        list.replaceChildren(li);
      }
    };
    fetch("/updates/updates.json", { cache: "no-cache" })
      .then((res) => res.json())
      .then((data) => {
        const items = (data.items || []).map(localize).sort((a, b) => b.date.localeCompare(a.date));
        updateLists.forEach((list) => renderUpdates(list, items));
        // カテゴリで絞り込むボタン（アップデートのページ）
        document.querySelectorAll("[data-updates-filter]").forEach((btn) => {
          btn.addEventListener("click", () => {
            document.querySelectorAll("[data-updates-filter]").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
            updateLists.forEach((list) => { list.dataset.category = btn.dataset.updatesFilter; renderUpdates(list, items); });
          });
        });
      })
      .catch(() => {
        updateLists.forEach((list) => {
          const li = document.createElement("li");
          li.className = "update-empty";
          li.textContent = t("アップデート情報を読み込めませんでした。");
          list.replaceChildren(li);
        });
      });
  }

  // ---------- 最新のお知らせ（トップの帯） ----------
  // お知らせはサポートの記事（type: "news"。読み込みは support/articles.js）。いちばん新しいものを <a data-news-latest> に入れる
  const newsLatest = document.querySelector("[data-news-latest]");
  if (newsLatest && window.SKArticles) {
    window.SKArticles.load()
      .then((data) => {
        const latest = (data.articles || []).filter((a) => a.type === "news").sort((a, b) => b.date.localeCompare(a.date))[0];
        if (!latest) return;
        const text = newsLatest.querySelector("[data-news-latest-text]");
        if (text) text.textContent = latest.title;
        newsLatest.href = lp(`https://support.sk-hub.jp/?a=${encodeURIComponent(latest.id)}`);
        newsLatest.classList.toggle("is-important", !!latest.important);
        newsLatest.hidden = false;
      })
      .catch(() => { /* 帯は出さない */ });
  }

  // ---------- トップのアニメーション ----------
  // 最初の出てくる動きは CSS だけ。ここではスクロールで出てくる動きと、マウスに合わせて少し動くのをつける
  const hero = document.querySelector(".hero");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (hero && !reduceMotion) {
    const targets = [...document.querySelectorAll(
      "main > .section .section-head, #products .product-card, #products .lab-card, .home-updates-list, .home-updates-side .link-tile, .about-teaser, main > .section .grid-4 .link-tile"
    )];
    if ("IntersectionObserver" in window) {
      // 同じ親の中で並んでいるものは、少しずつずらして出す
      const order = new Map();
      targets.forEach((el) => {
        const i = order.get(el.parentElement) || 0;
        order.set(el.parentElement, i + 1);
        el.style.setProperty("--d", `${Math.min(i, 4) * 90}ms`);
        el.classList.add("reveal");
      });
      const io = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          io.unobserve(el);
          el.classList.add("is-in");
          // 出終わったら外して、ホバーなどの動きを元に戻す
          setTimeout(() => { el.classList.remove("reveal", "is-in"); el.style.removeProperty("--d"); }, 1800);
        });
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
      targets.forEach((el) => io.observe(el));
    }

    const visual = hero.querySelector(".hero-visual");
    if (visual && window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      let frame = 0;
      hero.addEventListener("pointermove", (e) => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          const r = hero.getBoundingClientRect();
          visual.classList.add("is-tracking");
          visual.style.setProperty("--px", (((e.clientX - r.left) / r.width) * 2 - 1).toFixed(3));
          visual.style.setProperty("--py", (((e.clientY - r.top) / r.height) * 2 - 1).toFixed(3));
        });
      });
      hero.addEventListener("pointerleave", () => {
        visual.style.setProperty("--px", "0");
        visual.style.setProperty("--py", "0");
      });
    }
  }
})();
