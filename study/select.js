// 選択（<select class="field-select">）を、Material のメニューに置きかえる
//   もとの <select> は、見えない状態で残す（値・change の知らせはそのまま。呼ぶ側のコードは変えなくてよい）
//   ページに <select class="field-select"> が出てきたら、自動で置きかえる（MutationObserver）
//   メニューは popover（top layer）。ダイアログの中でも、いちばん上に出る
const ARROW = "arrow_drop_down";

function el(tag, attrs, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}

function upgrade(sel) {
  if (sel.dataset.mdSelect || !sel.classList.contains("field-select")) return;
  sel.dataset.mdSelect = "1";
  const wrap = el("div", { class: "md-select" });
  sel.before(wrap);
  wrap.append(sel);
  sel.tabIndex = -1;
  sel.setAttribute("aria-hidden", "true");

  const label = el("span", { class: "md-select-label" });
  const btn = el("button", { type: "button", class: `field-select md-select-btn ${sel.className.replace("field-select", "").trim()}`.trim(), "aria-haspopup": "listbox", "aria-expanded": "false" });
  const aria = sel.getAttribute("aria-label");
  if (aria) btn.setAttribute("aria-label", aria);
  btn.append(label, el("span", { class: "ms md-select-arrow", "aria-hidden": "true" }, ARROW));
  const menu = el("div", { class: "md-menu", role: "listbox", popover: "auto" });
  wrap.append(btn, menu);

  const options = () => [...sel.options];
  const sync = () => {
    const cur = sel.options[sel.selectedIndex];
    label.textContent = cur ? cur.textContent : "";
    btn.disabled = sel.disabled;
  };
  sync();
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true, attributes: true, characterData: true });
  sel.addEventListener("change", sync);

  let items = [];
  let active = -1;
  const focusItem = (i) => {
    if (!items.length) return;
    active = (i + items.length) % items.length;
    items.forEach((it, n) => it.classList.toggle("is-active", n === active));
    items[active].scrollIntoView({ block: "nearest" });
  };
  const pick = (opt) => {
    if (opt.disabled) return;
    const changed = sel.value !== opt.value;
    sel.value = opt.value;
    menu.hidePopover();
    sync();
    if (changed) {
      sel.dispatchEvent(new Event("input", { bubbles: true }));
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    btn.focus();
  };
  const place = () => {
    const r = btn.getBoundingClientRect();
    const room = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const h = Math.min(menu.scrollHeight, 320);
    const down = room >= h || room >= above;
    menu.style.minWidth = `${Math.max(r.width, 112)}px`;
    menu.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.maxHeight = `${Math.max(120, Math.min(320, down ? room : above))}px`;
    menu.style.top = down ? `${r.bottom}px` : "";
    menu.style.bottom = down ? "" : `${window.innerHeight - r.top}px`;
  };
  const open = () => {
    if (btn.disabled || menu.matches(":popover-open")) return;
    sync();
    menu.replaceChildren();
    items = options().map((opt) => {
      const it = el("div", { class: "md-menu-item", role: "option", "aria-selected": String(opt.value === sel.value), "aria-disabled": opt.disabled ? "true" : null }, opt.textContent);
      it.addEventListener("click", () => pick(opt));
      it.addEventListener("pointermove", () => { if (!opt.disabled) { active = items.indexOf(it); items.forEach((x) => x.classList.toggle("is-active", x === it)); } });
      menu.append(it);
      return it;
    });
    menu.showPopover();
    place();
    focusItem(Math.max(0, sel.selectedIndex));
    btn.setAttribute("aria-expanded", "true");
  };
  menu.addEventListener("toggle", (e) => { if (e.newState === "closed") btn.setAttribute("aria-expanded", "false"); });
  btn.addEventListener("click", () => (menu.matches(":popover-open") ? menu.hidePopover() : open()));
  btn.addEventListener("keydown", (e) => {
    const isOpen = menu.matches(":popover-open");
    if (!isOpen && (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ")) { e.preventDefault(); open(); return; }
    if (!isOpen) return;
    if (e.key === "ArrowDown") { e.preventDefault(); focusItem(active + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusItem(active - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusItem(0); }
    else if (e.key === "End") { e.preventDefault(); focusItem(items.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const opt = options()[active]; if (opt) pick(opt); }
    else if (e.key === "Tab") menu.hidePopover();
  });
  window.addEventListener("resize", () => { if (menu.matches(":popover-open")) menu.hidePopover(); });
  // <label> を押したときも開く
  const label_ = sel.closest("label");
  if (label_) label_.addEventListener("click", (e) => { if (!e.target.closest(".md-select")) { e.preventDefault(); btn.focus(); } });
}

function scan(root) {
  if (root.nodeType !== 1) return;
  if (root.matches && root.matches("select.field-select")) upgrade(root);
  root.querySelectorAll && root.querySelectorAll("select.field-select").forEach(upgrade);
}

if (typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype) {
  new MutationObserver((list) => { for (const m of list) m.addedNodes.forEach(scan); }).observe(document.documentElement, { childList: true, subtree: true });
  scan(document.documentElement);
}
