/* 家庭サーバーのページに右下のメニューボタンを出す（SK Material）。
 * server.py が各 HTML の </body> 直前に読み込ませる。
 * 見た目は Shadow DOM の中に閉じ込め、元ページの CSS の影響を受けないようにする。 */
(() => {
  "use strict";
  if (document.getElementById("sk-home-shell")) return;

  const host = document.createElement("div");
  host.id = "sk-home-shell";
  host.style.cssText =
    "all:initial;position:fixed;right:0;bottom:0;width:0;height:0;z-index:2147483647;";
  document.body.appendChild(host);

  const root = host.attachShadow({ mode: "open" });

  const fonts = document.createElement("link");
  fonts.rel = "stylesheet";
  fonts.href =
    "https://fonts.googleapis.com/css2?family=M+PLUS+1:wght@400;500;700;800&display=swap" +
    "&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0&display=block";

  const style = document.createElement("style");
  style.textContent = `
    :host {
      --md-primary: #004ac6; --md-on-primary: #ffffff;
      --md-primary-container: #dbe1ff; --md-on-primary-container: #00174b;
      --md-secondary-container: #acbfff; --md-on-secondary-container: #394c84;
      --md-surface: #faf8ff; --md-surface-container-high: #e7e7f3;
      --md-on-surface: #191b23; --md-on-surface-variant: #434655;
      --md-outline-variant: #c3c6d7;
      --md-font: "M PLUS 1", "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", Meiryo, system-ui, sans-serif;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --md-primary: #b4c5ff; --md-on-primary: #002a78;
        --md-primary-container: #2563eb; --md-on-primary-container: #eeefff;
        --md-secondary-container: #33467e; --md-on-secondary-container: #a4b6f5;
        --md-surface: #11131b; --md-surface-container-high: #282a32;
        --md-on-surface: #e1e2ed; --md-on-surface-variant: #c3c6d7;
        --md-outline-variant: #434655;
      }
    }
    .msr {
      font-family: "Material Symbols Rounded"; font-weight: normal; font-style: normal; font-size: 24px;
      line-height: 1; letter-spacing: normal; text-transform: none; white-space: nowrap; direction: ltr;
      display: inline-block; flex: none; -webkit-font-feature-settings: "liga"; font-feature-settings: "liga";
      font-variation-settings: "FILL" 0, "wght" 400, "GRAD" 0, "opsz" 24;
    }
    .fab {
      position: absolute; right: 16px; bottom: 16px; width: 56px; height: 56px; border: 0; padding: 0;
      border-radius: 16px; background: var(--md-primary-container); color: var(--md-on-primary-container);
      display: grid; place-items: center; cursor: pointer; font-family: var(--md-font);
      box-shadow: 0 3px 8px rgba(0, 0, 0, .18), 0 1px 3px rgba(0, 0, 0, .12);
      transition: transform .18s cubic-bezier(.34, 1.4, .64, 1);
    }
    .fab:active { transform: scale(.95); }
    .fab:focus-visible { outline: 2px solid var(--md-primary); outline-offset: 2px; }
    .menu {
      position: absolute; right: 16px; bottom: 84px; width: min(320px, calc(100vw - 32px));
      max-height: min(60vh, 480px); overflow: auto; box-sizing: border-box; padding: 8px;
      border-radius: 20px; background: var(--md-surface-container-high); color: var(--md-on-surface);
      box-shadow: 0 6px 20px rgba(0, 0, 0, .2); font-family: var(--md-font);
    }
    .menu[hidden] { display: none; }
    .head { padding: 8px 12px 4px; font-size: 12px; line-height: 16px; font-weight: 500;
      letter-spacing: .04em; color: var(--md-on-surface-variant); }
    .item {
      display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-radius: 12px;
      color: inherit; text-decoration: none; font-size: 14px; line-height: 20px;
    }
    .item .msr { color: var(--md-primary); }
    .item:hover, .item:focus-visible { background: color-mix(in srgb, var(--md-on-surface) 8%, transparent); outline: none; }
    .item[aria-current="page"] { background: var(--md-secondary-container); color: var(--md-on-secondary-container); }
    .item[aria-current="page"] .msr { color: inherit; }
    .text { min-width: 0; display: flex; flex-direction: column; }
    .text .sub { font-size: 11px; line-height: 14px; color: var(--md-on-surface-variant); overflow-wrap: anywhere; }
    .empty { padding: 10px 12px; font-size: 14px; color: var(--md-on-surface-variant); }
  `;

  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "fab";
  fab.setAttribute("aria-label", "ページメニュー");
  fab.setAttribute("aria-expanded", "false");
  const fabIcon = document.createElement("span");
  fabIcon.className = "msr";
  fabIcon.setAttribute("aria-hidden", "true");
  fabIcon.textContent = "menu";
  fab.append(fabIcon);

  const menu = document.createElement("nav");
  menu.className = "menu";
  menu.setAttribute("aria-label", "ページ一覧");
  menu.hidden = true;

  const head = document.createElement("div");
  head.className = "head";
  head.textContent = "ページ一覧";
  const list = document.createElement("div");
  menu.append(head, list);

  root.append(fonts, style, fab, menu);

  const current = decodeURIComponent(location.pathname);

  function makeIcon(name) {
    const i = document.createElement("span");
    i.className = "msr";
    i.setAttribute("aria-hidden", "true");
    i.textContent = name;
    return i;
  }

  function makeLink(title, url, sub, icon) {
    const a = document.createElement("a");
    a.className = "item";
    a.href = url;
    a.append(makeIcon(icon));
    const text = document.createElement("span");
    text.className = "text";
    const t = document.createElement("span");
    t.textContent = title;
    text.append(t);
    if (sub) {
      const s = document.createElement("span");
      s.className = "sub";
      s.textContent = sub;
      text.append(s);
    }
    a.append(text);
    if (url === current) a.setAttribute("aria-current", "page");
    return a;
  }

  function showMessage(text) {
    const div = document.createElement("div");
    div.className = "empty";
    div.textContent = text;
    list.replaceChildren(div);
  }

  async function load() {
    showMessage("読み込み中…");
    try {
      const res = await fetch("/api/pages", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const items = await res.json();
      const nodes = [makeLink("ホーム", "/", "", "home")];
      for (const it of items) {
        if (it.url === "/") continue;
        nodes.push(makeLink(it.title, it.url, it.path === "." ? it.modified : `${it.path} ・ ${it.modified}`, "description"));
      }
      nodes.push(makeLink("ページの管理", "/manage", "追加・削除", "edit_note"));
      list.replaceChildren(...nodes);
    } catch (e) {
      showMessage("一覧を読み込めませんでした");
    }
  }

  function setOpen(open) {
    menu.hidden = !open;
    fab.setAttribute("aria-expanded", String(open));
    fabIcon.textContent = open ? "close" : "menu";
    if (open) load();
  }

  fab.addEventListener("click", (e) => {
    e.stopPropagation();
    setOpen(menu.hidden);
  });

  document.addEventListener("click", (e) => {
    if (!menu.hidden && !e.composedPath().includes(host)) setOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) {
      setOpen(false);
      fab.focus();
    }
  });
})();
