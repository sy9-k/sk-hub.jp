// 試作品のファイル（/files/）。リポジトリの公開していないフォルダ（_ で始まるので GitHub Pages では配信されない）を見る
//   一覧: GitHub API で main の最新コミットを 1 回だけ聞き（1 時間に 60 回まで）、jsDelivr の data API でそのコミットのファイル一覧を取る
//   中身: jsDelivr（https://cdn.jsdelivr.net/gh/…@コミット/…）から読む。リポジトリは公開なので、ログインはいらない
//   HTML のプレビュー: <base> を jsDelivr のフォルダにして、/ で始まるもの（/assets/… など）はこのサイトに向け直す。
//     iframe は sandbox="allow-scripts"（allow-same-origin なし）なので、試作品の中から管理画面のログインには触れられない
//     そのかわり、試作品の中では localStorage などが使えない（「新しいタブで開く」も同じく jsDelivr の別のアドレス）
//   見るフォルダを増やすときは ROOTS に足す
import {
  $, button, card, el, empty, icon, note, num, startAdmin
} from "/shared/admin.js";

const REPO = "sy9-k/sy9-k.github.io";
const ROOTS = [{ path: "_mockups", label: "試作品（_mockups）" }];
const TEXT = /\.(html?|css|m?js|json|md|txt|svg|xml|py|sh|ya?ml)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico)$/i;
const SITE = location.origin;

const root = $("[data-page]");
const tree = el("nav", "ad-tree");
tree.setAttribute("aria-label", "ファイル");
const viewer = el("section", "ad-card ad-viewer");
const layout = el("div", "ad-files");
layout.append(tree, viewer);
const status = el("p", "ad-hint");
let sha = "main";
let files = [];
let currentPath = "";
const open = new Set(ROOTS.map((r) => r.path));

const cdn = (path) => `https://cdn.jsdelivr.net/gh/${REPO}@${sha}/${path.split("/").map(encodeURIComponent).join("/")}`;
const kb = (n) => (n < 1024 ? `${n}B` : `${num(Math.round(n / 1024))}KB`);

async function loadList() {
  tree.replaceChildren(el("p", "ad-hint", "読み込み中…"));
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, { headers: { Accept: "application/vnd.github+json" } });
    if (res.ok) sha = (await res.json()).sha || "main";
  } catch (e) { /* 聞けないときは main（jsDelivr は最大 12 時間古いことがある） */ }
  try {
    const res = await fetch(`https://data.jsdelivr.com/v1/packages/gh/${REPO}@${sha}?structure=flat`);
    if (!res.ok) throw new Error(`jsDelivr ${res.status}`);
    const data = await res.json();
    files = (data.files || [])
      .map((f) => ({ path: f.name.replace(/^\//, ""), size: f.size || 0 }))
      .filter((f) => ROOTS.some((r) => f.path.startsWith(`${r.path}/`)))
      .sort((a, b) => a.path.localeCompare(b.path));
    status.textContent = `${num(files.length)} ファイル・コミット ${sha.slice(0, 7)}`;
    renderTree();
    const want = new URLSearchParams(location.search).get("path");
    if (want && files.some((f) => f.path === want)) show(want);
  } catch (err) {
    tree.replaceChildren(note(`一覧を読み込めませんでした（${err.message}）。少したってから開き直してください。`, "error", "error"));
  }
}

// フォルダ → 中身 の木にする
function buildTree() {
  const rootNode = { dirs: new Map(), files: [] };
  files.forEach((f) => {
    const parts = f.path.split("/");
    let node = rootNode;
    parts.slice(0, -1).forEach((p, i) => {
      if (!node.dirs.has(p)) node.dirs.set(p, { dirs: new Map(), files: [], path: parts.slice(0, i + 1).join("/") });
      node = node.dirs.get(p);
    });
    node.files.push(f);
  });
  return rootNode;
}

function renderTree() {
  const items = [];
  const walk = (node, depth) => {
    [...node.dirs.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([name, child]) => {
      const isOpen = open.has(child.path);
      const b = el("button", "ad-tree__item m3-state");
      b.type = "button";
      b.style.paddingLeft = `${10 + depth * 16}px`;
      b.setAttribute("aria-expanded", String(isOpen));
      const label = (ROOTS.find((r) => r.path === child.path) || {}).label || name;
      b.append(icon(isOpen ? "folder_open" : "folder"), el("span", null, label));
      b.addEventListener("click", () => { if (isOpen) open.delete(child.path); else open.add(child.path); renderTree(); });
      items.push(b);
      if (isOpen) walk(child, depth + 1);
    });
    node.files.forEach((f) => {
      const b = el("button", "ad-tree__item m3-state");
      b.type = "button";
      b.style.paddingLeft = `${10 + depth * 16}px`;
      if (f.path === currentPath) b.setAttribute("aria-current", "true");
      const name = f.path.split("/").pop();
      b.append(icon(/\.html?$/i.test(name) ? "web" : IMAGE.test(name) ? "image" : /\.css$/i.test(name) ? "palette" : /\.m?js$/i.test(name) ? "javascript" : "description"), el("span", null, name), el("span", "ad-tree__size", kb(f.size)));
      b.addEventListener("click", () => show(f.path));
      items.push(b);
    });
  };
  walk(buildTree(), 0);
  tree.replaceChildren(...(items.length ? items : [empty("ファイルがありません。", "folder_off")]));
}

// HTML のプレビュー用に、読み込むものの場所を直す
function previewHtml(html, path) {
  const dir = cdn(path.split("/").slice(0, -1).join("/")) + "/";
  const docu = new DOMParser().parseFromString(html, "text/html");
  docu.querySelectorAll("[src], [href]").forEach((n) => {
    ["src", "href"].forEach((attr) => {
      const v = n.getAttribute(attr);
      if (v && v.startsWith("/") && !v.startsWith("//")) n.setAttribute(attr, SITE + v);
    });
  });
  const base = docu.createElement("base");
  base.href = dir;
  docu.head.prepend(base);
  return "<!DOCTYPE html>\n" + docu.documentElement.outerHTML;
}

async function show(path) {
  currentPath = path;
  history.replaceState(null, "", `?path=${encodeURIComponent(path)}`);
  renderTree();
  const name = path.split("/").pop();
  const crumbs = el("div", "ad-crumbs");
  path.split("/").forEach((p, i, arr) => { crumbs.append(el("span", i === arr.length - 1 ? null : "ad-muted", p)); if (i < arr.length - 1) crumbs.append(icon("chevron_right")); });
  const actions = el("div", "ad-row");
  const raw = el("a", "text-btn m3-state");
  raw.href = cdn(path);
  raw.target = "_blank";
  raw.rel = "noopener";
  raw.append(icon("open_in_new"), document.createTextNode("ファイルを開く"));
  const gh = el("a", "text-btn m3-state");
  gh.href = `https://github.com/${REPO}/blob/${sha}/${path}`;
  gh.target = "_blank";
  gh.rel = "noopener";
  gh.append(icon("code"), document.createTextNode("GitHub で見る"));
  const body = el("div", "ad-stack");
  viewer.replaceChildren(crumbs, actions, body);
  body.append(el("p", "ad-hint", "読み込み中…"));

  if (IMAGE.test(name) && !/\.svg$/i.test(name)) {
    actions.append(raw, gh);
    const img = el("img", "ad-img");
    img.src = cdn(path);
    img.alt = name;
    body.replaceChildren(img);
    return;
  }
  if (!TEXT.test(name)) {
    actions.append(raw, gh);
    body.replaceChildren(note("このファイルはここでは表示できません。「ファイルを開く」から見てください。"));
    return;
  }
  let text;
  try {
    const res = await fetch(cdn(path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    body.replaceChildren(note(`読み込めませんでした（${err.message}）`, "error", "error"));
    return;
  }
  if (currentPath !== path) return;
  const code = () => { const pre = el("pre", "ad-code"); pre.textContent = text; return pre; };
  if (/\.html?$/i.test(name)) {
    let mode = "preview";
    const toggle = button("コードを見る", { kind: "m3-btn m3-btn--tonal", iconName: "code", small: true });
    const frame = () => {
      const f = el("iframe", "ad-frame");
      f.setAttribute("sandbox", "allow-scripts allow-popups allow-forms allow-modals");
      f.setAttribute("referrerpolicy", "no-referrer");
      f.title = `${name} のプレビュー`;
      f.srcdoc = previewHtml(text, path);
      return f;
    };
    const draw = () => {
      toggle.lastChild.textContent = mode === "preview" ? "コードを見る" : "プレビュー";
      body.replaceChildren(mode === "preview" ? frame() : code(), el("p", "ad-hint", "プレビューは管理画面から切り離して動かしています（試作品の中では、ログインや localStorage は使えません）。"));
    };
    toggle.addEventListener("click", () => { mode = mode === "preview" ? "code" : "preview"; draw(); });
    actions.append(toggle, raw, gh);
    draw();
    return;
  }
  actions.append(raw, gh);
  if (/\.svg$/i.test(name)) {
    const img = el("img", "ad-img");
    img.src = cdn(path);
    img.alt = name;
    body.replaceChildren(img, code());
    return;
  }
  body.replaceChildren(code(), el("p", "ad-hint", `${num(text.split("\n").length)} 行`));
}

const reload = button("読み込み直す", { kind: "m3-btn m3-btn--tonal", iconName: "refresh", small: true, onClick: loadList });
const head = el("div", "ad-row");
head.append(status, el("span", "ad-grow"), reload);
viewer.append(empty("左の一覧からファイルを選びます。", "draft"));
root.append(card("folder_open", "ファイル", head, layout));

startAdmin({ page: "files", onReady: loadList });
