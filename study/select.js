// 項目を選ぶ部品（SK Material。M3 の「メニューのついた入力欄」）
//   画面にある <select class="field-select"> を、見た目と操作だけ M3 のメニューに置きかえる
//   ・値は今までどおり <select> が持つ（各画面は select.value と change・input を使ったまま）。<select> は見えなくして残す
//   ・ボタン（.select-anchor）に <select> と同じクラスを付けるので、大きさ（.mode-select など）はそのまま効く
//   ・メニューは popover（いちばん上の層）で出す。ダイアログの中でも上に出るよう、ダイアログの中に置く
//   ・キーボード: ↓↑ Enter Space で開く、↓↑ Home End で動く、Enter Space で選ぶ、Esc Tab で閉じる。文字を打つとその文字ではじまる項目へ
//   画面に入った <select> は MutationObserver で見つけるので、各画面で呼び出さなくてよい
const ANCHOR = Symbol("anchor");
let open = null; // いま開いているメニュー { select, anchor, menu, close }

const labelOf = (select) => select.getAttribute("aria-label")
  || (select.closest("label") && (select.closest("label").querySelector(".field-label") || {}).textContent)
  || "";

function sync(select) {
  const anchor = select[ANCHOR];
  if (!anchor) return;
  const opt = select.options[select.selectedIndex];
  anchor.querySelector(".select-anchor__text").textContent = opt ? opt.textContent : "";
  anchor.disabled = select.disabled;
  anchor.className = `${select.dataset.skClass || ""} select-anchor`.trim();
  // <select> がほかの場所に動かされたら、ボタンもいっしょに動かす
  if (select.previousElementSibling !== anchor && select.isConnected) select.before(anchor);
}

function enhance(select) {
  if (select[ANCHOR]) { sync(select); return; }
  select.dataset.skClass = select.className;
  const anchor = document.createElement("button");
  anchor.type = "button";
  anchor.setAttribute("aria-haspopup", "listbox");
  anchor.setAttribute("aria-expanded", "false");
  const label = labelOf(select).trim();
  if (label) anchor.setAttribute("aria-label", label);
  anchor.innerHTML = '<span class="select-anchor__text"></span><span class="ms select-anchor__arrow" aria-hidden="true">arrow_drop_down</span>';
  select[ANCHOR] = anchor;
  select.className = "select-native";
  select.tabIndex = -1;
  select.setAttribute("aria-hidden", "true");
  select.before(anchor);
  sync(select);

  anchor.addEventListener("click", () => (open && open.select === select ? closeMenu() : openMenu(select)));
  anchor.addEventListener("keydown", (e) => {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); openMenu(select); }
  });
  // ラベルを押したとき（<select> にフォーカスが来る）はボタンへ
  select.addEventListener("focus", () => anchor.focus());
  select.addEventListener("change", () => sync(select));
}

function choose(select, index) {
  if (select.selectedIndex !== index) {
    select.selectedIndex = index;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }
  sync(select);
}

function place(anchor, menu) {
  const r = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  menu.style.minWidth = `${Math.max(112, r.width)}px`;
  menu.style.maxWidth = `${vw - 16}px`;
  const below = vh - r.bottom - 8, above = r.top - 8;
  const up = below < Math.min(menu.scrollHeight, 240) && above > below;
  menu.style.maxHeight = `${Math.max(120, Math.min(360, up ? above : below))}px`;
  const w = menu.offsetWidth;
  menu.style.left = `${Math.min(Math.max(8, r.left), vw - w - 8)}px`;
  menu.style.top = up ? "" : `${r.bottom + 4}px`;
  menu.style.bottom = up ? `${vh - r.top + 4}px` : "";
  menu.classList.toggle("is-up", up);
}

function openMenu(select) {
  closeMenu();
  const anchor = select[ANCHOR];
  if (!anchor || anchor.disabled) return;
  sync(select);
  const menu = document.createElement("div");
  menu.className = "select-menu";
  menu.setAttribute("role", "listbox");
  if (anchor.getAttribute("aria-label")) menu.setAttribute("aria-label", anchor.getAttribute("aria-label"));
  const items = [...select.options].map((opt, i) => {
    const item = document.createElement("div");
    item.className = "select-menu__item";
    item.setAttribute("role", "option");
    item.tabIndex = -1;
    item.setAttribute("aria-selected", String(i === select.selectedIndex));
    if (opt.disabled) item.setAttribute("aria-disabled", "true");
    item.innerHTML = '<span class="ms select-menu__check" aria-hidden="true">check</span><span class="select-menu__text"></span>';
    item.querySelector(".select-menu__text").textContent = opt.textContent;
    item.addEventListener("click", () => { if (opt.disabled) return; choose(select, i); closeMenu(true); });
    return item;
  });
  menu.append(...items);
  // ダイアログの中ならダイアログの中に置く（外はさわれなくなっているので）
  (anchor.closest("dialog[open]") || document.body).append(menu);
  if (menu.showPopover) { menu.popover = "manual"; menu.showPopover(); }
  place(anchor, menu);
  anchor.setAttribute("aria-expanded", "true");
  anchor.classList.add("is-open");

  const focusAt = (i) => { const n = items.length; if (!n) return; const k = (i + n) % n; items[k].focus(); items[k].scrollIntoView({ block: "nearest" }); };
  let typed = "", typedAt = 0;
  menu.addEventListener("keydown", (e) => {
    const cur = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); focusAt(cur + 1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusAt(cur - 1); }
    else if (e.key === "Home") { e.preventDefault(); focusAt(0); }
    else if (e.key === "End") { e.preventDefault(); focusAt(items.length - 1); }
    else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (cur >= 0) items[cur].click(); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeMenu(true); } // ダイアログまで閉じないように
    else if (e.key === "Tab") { closeMenu(); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      typed = now - typedAt > 700 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
      typedAt = now;
      const hit = items.findIndex((it) => it.textContent.trim().toLowerCase().startsWith(typed));
      if (hit >= 0) focusAt(hit);
    }
  });
  const outside = (e) => { if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const onScroll = (e) => { if (!menu.contains(e.target)) closeMenu(); };
  const onResize = () => closeMenu();
  document.addEventListener("pointerdown", outside, true);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);
  open = {
    select, anchor, menu,
    close(focus) {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      anchor.setAttribute("aria-expanded", "false");
      anchor.classList.remove("is-open");
      menu.remove();
      if (focus) anchor.focus();
    }
  };
  focusAt(Math.max(0, select.selectedIndex));
}

function closeMenu(focus = false) {
  if (!open) return;
  const o = open;
  open = null;
  o.close(focus);
}

export function enhanceSelects(root = document) {
  root.querySelectorAll("select.field-select, select.select-native").forEach(enhance);
}

// 画面に入った <select> を見つけて置きかえる。<option> が変わったら表示を合わせる
export function watchSelects() {
  enhanceSelects();
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.target instanceof HTMLSelectElement) { sync(r.target); continue; }
      for (const n of r.addedNodes) {
        if (!(n instanceof Element)) continue;
        if (n.matches("select.field-select, select.select-native")) enhance(n);
        n.querySelectorAll && n.querySelectorAll("select.field-select, select.select-native").forEach(enhance);
      }
    }
  }).observe(document.body, { childList: true, subtree: true });
}
