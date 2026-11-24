// SK Study — 単語学習
//   画面は # のあとの場所で切りかえる（ページを読み込み直さない）
//   ログインしないと使えない（SK Hub Systems アカウントでログインして SK Study に接続したとき。cloud.js の session）
//   左に横のメニュー（MD1 の navigation drawer）。パソコンは出しっぱなし、スマートフォンは ☰ で出す
//     #/                 ホーム（あいさつ・今日の復習・記録・続きから・ショートカット）
//     #/sets             SK認定コンテンツ
//     #/mine             マイ単語帳
//     #/prints           プリント（print.js）
//     #/classes          クラス（classroom.js）
//     #/set/<ID>         単語セット（記憶度・学習の始め方・単語の一覧）
//     #/learn/<ID>?mode= 学習（learn = おまかせ学習 / card = 単語カード / test = 小テスト）。ID が review なら今日の復習
//       小テスト … 決まった数を、答え合わせなしで続けて解き、最後にまとめて採点する（まちがえても出し直さない）。点数は store.js に残す
//     #/edit/<ID|new>    マイ単語帳を作る・直す
//     #/import/<コード>   共有リンクで受け取った単語帳（share.js）
//     #/print/<ID>       プリントに答える（print.js）
//     #/maker            PDF からプリントを作る（maker.js）
//     #/class/<cid>・#/task/<cid>/<aid>  クラスと課題（生徒。classroom.js）
//     #/teach/…          指導者メニュー（teach.js）
//   おまかせ学習:
//     ・方向（外国語 → 日本語 / 日本語 → 外国語）は 1 問ごとにまぜる
//     ・問題の形式は単語の覚えぐあい（store.js の箱）で変わる（難易度の自動調整）
//         難易度 1（未学習・弱点）… 4 択
//         難易度 2（記憶中）      … 4 択＋「この中にはない」（正解が選択肢にないこともある）
//         難易度 3（ほぼ覚えた）  … 書き取り（ときどき「この中にはない」つきの 4 択）
//     ・まちがえた単語は、少しあとにもう一度出す（同じ単語は 2 回まで）
//   データの保存は store.js、書き取りの採点は grade.js
//   ほかの人が作った単語帳も表示するので、文字は必ず textContent で入れる（innerHTML は数字だけの SVG に使う）
import * as store from "./store.js";
import * as cloud from "./cloud.js";
import { grade, hint } from "./grade.js";
import { decodeSet, encodeSet, extractCode, shareUrl } from "./share.js";
import * as tts from "./speech.js";
import * as records from "./records.js";
import { printSection, renderPrint } from "./print.js";
import { renderMaker } from "./maker.js";
import { createKeyboard, KEYBOARD_LANGS } from "./keyboard.js";
import { classSection, renderClass, renderTask, reportProgress, GROUPS } from "./classroom.js";
import { renderTeach } from "./teach.js";

const app = document.getElementById("app");
const toastEl = document.getElementById("toast");
let keyHandler = null;

const COUNTS = [[10, "10 問"], [20, "20 問"], [30, "30 問"], [0, "すべて"]];
const FORMATS = [["auto", "おまかせ（難易度を自動で調整）"], ["choice", "4 択だけ"], ["write", "書き取りだけ"]];
const STATUS = {
  mastered: { label: "記憶済み", color: "var(--st-mastered)" },
  learning: { label: "記憶中", color: "var(--st-learning)" },
  weak: { label: "弱点", color: "var(--st-weak)" },
  new: { label: "未学習", color: "var(--st-new)" }
};
const NONE = "\u0000none"; // 「この中にはない」の選択肢
const RETRY_GAP = 3;       // まちがえた単語を何問あとにもう一度出すか
const RETRY_MAX = 2;

// ---------- 部品 ----------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}
const icon = (name, cls = "") => h("span", { class: `ms ${cls}`.trim(), "aria-hidden": "true" }, name);
function button(kind, label, iconName, onclick, extra = {}) {
  return h("button", { type: "button", class: `${kind}-btn`, onclick, ...extra }, iconName ? icon(iconName) : null, h("span", null, label));
}
function linkButton(kind, label, iconName, href) {
  return h("a", { class: `${kind}-btn`, href }, iconName ? icon(iconName) : null, h("span", null, label));
}
function backLink(label, href) {
  return h("a", { class: "back-link", href }, icon("arrow_back"), h("span", null, label));
}

let toastTimer = 0;
function toast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 4000);
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 文字の言語（読み上げ・書体・入力の切りかえに使う）
function langAttr(lang) {
  if (lang.key === "en") return "en";
  if (lang.key === "ko") return "ko";
  if (lang.key === "zh") return "zh-CN";
  return lang.speech || null;
}
function langBadge(lang) {
  return h("span", { class: `lang-badge lang-${lang.key}` }, lang.name);
}
// 単語セットの目じるし（言語の色の四角に 1〜2 文字）
function thumb(lang) {
  const glyph = { en: "Aa", ko: "가", zh: "中" }[lang.key] || [...(lang.name || "★")][0];
  return h("span", { class: `thumb lang-${lang.key}`, "aria-hidden": "true", lang: langAttr(lang) }, glyph);
}

// 輪のメーター（pct は 0〜1。数字と決まった色だけなので innerHTML で作る）
function ring(pct, { size = 44, stroke = 5, color = "var(--primary)", label = null, check = false } = {}) {
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(1, Number(pct) || 0));
  const el = h("span", { class: "ring", style: `width:${size}px;height:${size}px` });
  el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true">` +
    `<circle class="ring-bg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}"/>` +
    `<circle class="ring-fg" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${stroke}" stroke="${color}" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - p)}"/></svg>`;
  if (check) el.append(icon("check", "ring-check"));
  else if (label != null) el.append(h("span", { class: "ring-label" }, label));
  return el;
}

// 記憶度のドーナツ（記憶済み・記憶中・弱点・未学習）
function donut(s, size = 168) {
  const stroke = 26;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  let arcs = "";
  for (const key of ["mastered", "learning", "weak", "new"]) {
    const len = s.total ? (s[key] / s.total) * C : 0;
    if (len > 0) arcs += `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${STATUS[key].color}" stroke-width="${stroke}" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-offset}"/>`;
    offset += len;
  }
  const el = h("div", { class: "donut", style: `width:${size}px;height:${size}px`, role: "img",
    "aria-label": `記憶度 ${s.memory}%（記憶済み ${s.mastered}・記憶中 ${s.learning}・弱点 ${s.weak}・未学習 ${s.new}）` });
  el.innerHTML = `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true">${arcs}</svg>`;
  el.append(h("div", { class: "donut-center" }, h("strong", null, String(s.memory), h("small", null, "%")), h("span", null, "記憶度")));
  return el;
}

function wordRing(rec) {
  const st = store.statusOf(rec);
  if (st === "mastered") return ring(1, { size: 36, stroke: 4, color: STATUS.mastered.color, check: true });
  const pct = st === "weak" ? 0.12 : store.levelOf(rec);
  return ring(st === "learning" ? Math.max(pct, 0.2) : pct, { size: 36, stroke: 4, color: STATUS[st].color });
}

// ---------- 読み上げ ----------

// 声の選び方などは speech.js
function speakButton(text, speech) {
  if (!tts.canSpeak(speech)) return null;
  const b = h("button", {
    type: "button", class: "icon-btn speak", "aria-label": "読み上げ", title: "読み上げ",
    onclick: (e) => { e.stopPropagation(); tts.speak(text, speech, { button: b }); }
  }, icon("volume_up"));
  return b;
}
// 自動で読み上げる（設定で有効にしたときだけ）。そばの読み上げボタンを光らせる
function autoSpeak(text, speech, near) {
  if (!tts.getSettings().auto || !tts.canSpeak(speech)) return;
  const b = near ? near.querySelector(".speak") : null;
  tts.speak(text, speech, { button: b });
}

const VOICE_LANGS = [["en-US", "英語", "Hello. Nice to meet you."], ["ko-KR", "韓国語", "안녕하세요. 반갑습니다."], ["zh-CN", "中国語", "你好，很高兴认识你。"]];

// 読み上げの設定の中身（ダイアログと設定画面の両方で使う）。stop() で後始末
function speechPanel() {
  const body = h("div", { class: "speech-settings" });
  function draw() {
    const s = tts.getSettings();
    const auto = h("input", { type: "checkbox", checked: s.auto, onchange: (e) => tts.saveSettings({ auto: e.target.checked }) });
    const rates = h("div", { class: "segmented small", role: "radiogroup", "aria-label": "速さ" });
    const drawRates = (rate) => rates.replaceChildren(...tts.RATES.map(([v, label]) => h("button", {
      type: "button", role: "radio", "aria-checked": String(rate === v),
      onclick: () => { tts.saveSettings({ rate: v }); drawRates(v); }
    }, label)));
    drawRates(s.rate);
    const rows = VOICE_LANGS.map(([lang, name, sample]) => {
      const list = tts.voicesFor(lang);
      const sk = tts.hasSkVoice(lang) ? tts.SK_VOICES : [];
      const best = list[0];
      if (!list.length && !sk.length) {
        return h("div", { class: "voice-row" }, h("span", { class: "voice-name" }, name),
          h("p", { class: "muted small" }, icon("info"), `この端末には${name}の声がありません。端末の設定で追加できます。`));
      }
      const sel = h("select", { class: "field-select", "aria-label": `${name}の声`, onchange: (e) => {
        const voicesSaved = { ...tts.getSettings().voices };
        if (e.target.value) voicesSaved[lang] = e.target.value; else delete voicesSaved[lang];
        tts.saveSettings({ voices: voicesSaved });
        tts.speak(sample, lang);
      } },
      h("option", { value: "" }, best ? `おまかせ（${best.name}）` : "おまかせ"),
      sk.map(([id, label]) => h("option", { value: id, selected: s.voices[lang] === id }, label)),
      list.map((v) => h("option", { value: v.name, selected: s.voices[lang] === v.name }, `${v.name}${v.localService ? "" : "（ネット）"}`)));
      const test = h("button", { type: "button", class: "icon-btn speak", "aria-label": `${name}を試しに聞く`, title: "試しに聞く",
        onclick: () => tts.speak(sample, lang, { button: test }) }, icon("play_arrow"));
      return h("div", { class: "voice-row" }, h("span", { class: "voice-name" }, name), h("div", { class: "voice-pick" }, sel, test));
    });
    body.replaceChildren(
      h("label", { class: "switch-row" }, auto, h("span", null, h("strong", null, "自動で読み上げる"), h("small", null, "問題や答えに外国語が出たとき"))),
      h("div", { class: "setting-block" }, h("span", { class: "field-label" }, "速さ"), rates),
      h("div", { class: "setting-block" }, h("span", { class: "field-label" }, "声"), rows),
      h("p", { class: "muted small" }, icon("tips_and_updates"),
        "声は端末に入っているものを使います。Mac・iPhone は設定の「アクセシビリティ」→「読み上げコンテンツ」→「声」で「拡張」「プレミアム」の声を追加すると、より自然になります。"));
  }
  draw();
  const stopWatch = tts.onVoicesChanged(draw);
  return { body, stop: () => { stopWatch(); tts.stop(); } };
}

function openSpeechSettings() {
  if (!tts.supported) {
    const d0 = openDialog("読み上げ", h("p", null, "このブラウザは読み上げに対応していません。"), [button("filled", "閉じる", null, () => d0.close())]);
    return;
  }
  const panel = speechPanel();
  const d = openDialog("読み上げの設定", panel.body, [button("filled", "閉じる", null, () => d.close())]);
  d.addEventListener("close", panel.stop);
}

// ---------- ダイアログ ----------

function openDialog(title, body, actions) {
  const d = h("dialog", { class: "dialog" }, h("h2", null, title), body, h("div", { class: "dialog-actions" }, actions));
  document.body.append(d);
  // 閉じるときも動かす（縮みながら消える）。呼ぶ側はいつもどおり d.close() でよい
  const closeNow = HTMLDialogElement.prototype.close.bind(d);
  let closing = false;
  d.close = (value) => {
    if (closing || !d.open) return;
    if (motionOff.matches) { closeNow(value); return; }
    closing = true;
    d.classList.add("is-closing");
    let finished = false;
    const done = () => { if (finished) return; finished = true; clearTimeout(timer); closeNow(value); };
    const timer = setTimeout(done, 300); // 動きが終わった知らせが来ないときも閉じる
    d.addEventListener("animationend", (e) => { if (e.target === d) done(); }); // ボタンの波紋など、中の動きの知らせは見ない
  };
  d.addEventListener("cancel", (e) => { e.preventDefault(); d.close(); }); // Esc でも動かして閉じる
  d.addEventListener("close", () => d.remove());
  d.addEventListener("click", (e) => { if (e.target === d) d.close(); }); // 外側を押したら閉じる
  d.showModal();
  return d;
}
function confirmDialog(title, message, okLabel, danger = false) {
  return new Promise((resolve) => {
    let result = false;
    const d = openDialog(title, h("p", null, message), [
      button("text", "やめる", null, () => d.close()),
      button(danger ? "danger" : "filled", okLabel, null, () => { result = true; d.close(); })
    ]);
    d.addEventListener("close", () => resolve(result));
  });
}

// ---------- 画面の切りかえ ----------

function go(path, replace = false) {
  if (replace) {
    history.replaceState(null, "", `#${path}`);
    route();
  } else {
    location.hash = path;
  }
}

// 画面 → 横のメニューのどれを選んだ状態にするか
const SECTION_OF = { "": "home", sets: "sets", mine: "mine", edit: "mine", import: "mine", prints: "prints", print: "prints", maker: "maker", classes: "classes", class: "classes", task: "classes", teach: "teach", settings: "settings" };
const TITLES = { home: "ホーム", sets: "SK認定コンテンツ", mine: "マイ単語帳", prints: "プリント", maker: "PDF からプリントを作る", classes: "クラス", teach: "指導者メニュー", settings: "設定" };

// ---------- 画面の切りかえの動き（Android と同じ） ----------
//   深さ: 0 = メニューの画面（ホーム・単語セット…）、1 = 中の画面（単語セットの中・編集・クラス…）、2 = 全面の画面（学習・プリント）
//   深くなる（forward）… 新しい画面が右の端から上にかぶさって入り、前の画面は少し左へずれて暗くなる（Android のアクティビティを開く動き）
//   浅くなる（back）  … いまの画面が右へ抜けて、下から前の画面が戻ってくる
//   メニューで移る（fade）… 前の画面が消えてから、新しい画面が少し小さい大きさから広がって出る（Android の fade through）
//   View Transitions API があれば前の画面も動かして入れかえる（上の帯と横のメニューは動かさない）。なければ新しい画面だけ動かす
const motionOff = window.matchMedia("(prefers-reduced-motion: reduce)");
let lastNav = null;

function depthOf(view, parts) {
  if (view === "learn" || view === "print") return 2;
  if (["set", "edit", "import", "class", "task"].includes(view)) return 1;
  if (view === "teach" && parts.length > 1) return 1;
  return 0;
}

function motionFor(prev, nav) {
  if (!prev) return "none";
  if (prev.gate !== nav.gate) return "fade";
  if (prev.key === nav.key) return "none";
  if (nav.depth > prev.depth) return "forward";
  if (nav.depth < prev.depth) return "back";
  return "fade";
}

function route() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch (e) { return p; } });
  const nav = { key: path, parts, q: new URLSearchParams(qs), depth: depthOf(parts[0], parts), gate: !allowed(auth) };
  const motion = motionOff.matches ? "none" : motionFor(lastNav, nav);
  lastNav = nav;
  // 横に入れかわるときは、一覧が下から浮かぶ動きを止める（動きが重ならないように）
  app.classList.toggle("is-sliding", motion === "forward" || motion === "back");
  if (motion === "none") { renderRoute(nav); return; }
  const root = document.documentElement;
  if (document.startViewTransition) {
    root.dataset.motion = motion;
    const vt = document.startViewTransition(() => renderRoute(nav));
    vt.finished.finally(() => { if (root.dataset.motion === motion) delete root.dataset.motion; });
  } else {
    renderRoute(nav);
    app.classList.remove("enter-forward", "enter-back", "enter-fade");
    void app.offsetWidth; // 動きを最初からやり直す
    app.classList.add(`enter-${motion}`);
  }
}

function renderRoute(nav) {
  keyHandler = null;
  endTestMode();
  tts.stop();
  closeDrawer();
  const { parts, q } = nav;
  const [view, id] = parts;
  app.replaceChildren();
  window.scrollTo(0, 0);
  // ログインしていなければ、どの画面もログインの案内にする（ログインしたら、もとの場所に戻ってくる）
  if (!allowed(auth)) {
    renderGate(auth);
    return;
  }
  // クラスのプロファイルでは、そのクラスの画面だけ（個人の単語帳・プリントなどは出さない）
  if (cloud.activeClass() && ctxInfo && !ctxInfo.staff) {
    const CLASS_VIEWS = ["class", "task", "set", "learn", "print", "settings"];
    if (!view || !CLASS_VIEWS.includes(view)) {
      document.body.dataset.view = "class";
      const k = !view && GROUPS[q.get("k")] ? q.get("k") : "";
      setActive(k || "home");
      topTitle.textContent = k ? GROUPS[k].name : ctxInfo.className;
      renderClass(ctxInfo.cid, printUi, k).catch(showError);
      app.focus({ preventScroll: true });
      return;
    }
  }
  document.body.dataset.view = view || "home";
  let section = SECTION_OF[view || ""] || null;
  if (view === "set") {
    const set = store.getSet(id);
    section = set && set.classRef ? "classes" : set && set.source === "sk" ? "sets" : "mine";
  }
  setActive(section);
  topTitle.textContent = TITLES[section] || "";
  try {
    if (!view) renderHome();
    else if (view === "sets") renderSets();
    else if (view === "mine") renderMine();
    else if (view === "prints") { document.title = "プリント - SK Study"; app.append(printSection(printUi)); }
    else if (view === "classes") { document.title = "クラス - SK Study"; app.append(classSection(printUi)); }
    else if (view === "set") renderSet(id);
    else if (view === "learn") renderLearn(id, q);
    else if (view === "edit") renderEdit(id);
    else if (view === "import") renderImport(parts.slice(1).join("/"));
    else if (view === "print") renderPrint(id, printUi).catch((e) => { console.error(e); renderMessage("うまく表示できませんでした", String(e && e.message || e)); });
    else if (view === "maker") renderMaker(printUi);
    else if (view === "class") renderClass(id, printUi).catch(showError);
    else if (view === "task") renderTask(id, parts[2], printUi).catch(showError);
    else if (view === "teach") renderTeach(parts.slice(1), printUi).catch(showError);
    else if (view === "settings") renderSettings();
    else renderMessage("ページが見つかりません", "リンクがまちがっているかもしれません。");
  } catch (e) {
    console.error(e);
    renderMessage("うまく表示できませんでした", String(e && e.message || e));
  }
  app.focus({ preventScroll: true });
}

function showError(e) {
  console.error(e);
  renderMessage("うまく表示できませんでした", String(e && e.message || e));
}

function renderMessage(title, text) {
  document.title = "SK Study";
  document.body.dataset.view = "message";
  app.replaceChildren(h("section", { class: "message" },
    icon("sentiment_dissatisfied", "message-icon"),
    h("h1", null, title),
    h("p", null, text),
    linkButton("filled", "ホームへ", "home", "#/")));
}

// ---------- ログイン（SK Hub Systems アカウント。cloud.js） ----------
//   使えるのは、ログインして SK Study に接続したとき（ready）だけ
//   前にログインしていた端末がオフラインのとき（offline）は、このブラウザの記録で学習を続けられる

let auth = null; // cloud.session() の結果（確かめる前は null）

function readHint() {
  try { return JSON.parse(localStorage.getItem("skhub_account") || "null"); } catch (e) { return null; }
}
const allowed = (s) => !!s && (s.status === "ready" || (s.status === "offline" && !!readHint() && cloud.wasInvited()));

const GATE = {
  "not-invited": ["招待制です", "SK Study は、いまは招待した方だけが使えます。早期アクセスに登録しておくと、順番がきたらメールでお知らせします。", "早期アクセスに登録する", "hourglass_top"],
  "signed-out": ["ログインしてください", "SK Study を使うには、SK Hub Systems アカウントでログインします。アカウントは無料で作れます。", "ログイン", "login"],
  unregistered: ["アカウントの登録を完了してください", "SK Hub Systems アカウントの利用規約に同意すると、SK Study を使えるようになります。", "登録を続ける", "how_to_reg"],
  "not-connected": ["SK Study に接続してください", "SK Hub Systems アカウントを SK Study に接続すると、学習をはじめられます。", "SK Study に接続する", "link"],
  offline: ["接続できませんでした", "SK Hub Systems に接続できませんでした。ネットワークを確かめて、もう一度お試しください。", "もう一度", "refresh"]
};

function renderGate(s) {
  document.title = "ログイン - SK Study";
  document.body.dataset.view = "gate";
  setActive(null);
  const status = s ? s.status : "checking";
  const info = GATE[status];
  const feature = (ic, title, text) => h("li", null, icon(ic), h("span", null, h("strong", null, title), h("small", null, text)));
  app.replaceChildren(h("section", { class: "gate" },
    h("div", { class: "gate-card" },
      h("div", { class: "gate-hero" },
        h("img", { src: "icon.svg", alt: "", width: 56, height: 56 }),
        h("p", { class: "gate-name" }, "SK Study", h("span", { class: "beta" }, "試作")),
        h("p", { class: "gate-tagline" }, "単語カード・4 択・書き取りで、英語・韓国語・中国語や自分で作った単語帳を覚える")),
      h("div", { class: "gate-body" },
        info ? [
          h("h1", null, info[0]),
          h("p", { class: "muted" }, info[1]),
          status === "not-invited" && s.reason === "not-google"
            ? h("p", { class: "muted" }, "招待された Google アカウントでログインしてください。Google 以外のログインでは開けません。")
            : null,
          status === "offline"
            ? button("filled", info[2], info[3], recheckAuth, { class: "filled-btn gate-btn" })
            : linkButton("filled", info[2], info[3], status === "not-invited" ? "/waiting/?product=study" : cloud.accountUrl(true)),
          status === "not-invited" ? linkButton("outlined", "別のアカウントでログイン", "switch_account", cloud.accountUrl(false)) : null
        ] : h("p", { class: "loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), "ログインを確かめています…"),
        h("ul", { class: "gate-features" },
          feature("style", "単語を覚える", "SK認定コンテンツとマイ単語帳。記憶度に合わせて出題"),
          feature("assignment", "プリント・小テスト", "HTML・PDF のプリントに答えて自動で採点"),
          feature("groups", "クラス", "先生のクラスに参加して、課題を提出"))))));
  const btn = app.querySelector(".gate-body a.filled-btn");
  if (btn) btn.classList.add("gate-btn");
}

async function recheckAuth() {
  cloud.resetSession();
  auth = null;
  renderGate(null);
  auth = await cloud.session({ fresh: true });
  await refreshCtx();
  drawDrawer();
  route();
}

async function logout() {
  closeDrawer();
  if (!await confirmDialog("ログアウトしますか？", "学習の記録・マイ単語帳・プリントは、このブラウザに残ります。もう一度ログインすると続きから使えます。", "ログアウト")) return;
  try {
    const hub = await import("/assets/hub/account.js");
    await hub.signOutAccount();
  } catch (e) {
    console.error(e);
    toast("ログアウトできませんでした");
    return;
  }
  cloud.resetSession();
  auth = { status: "signed-out" };
  go("/", true);
}

// ---------- 横のメニュー（MD1 の navigation drawer） ----------

const NAV = [
  { key: "home", href: "#/", icon: "home", label: "ホーム" },
  { key: "sets", href: "#/sets", icon: "library_books", label: "SK認定コンテンツ" },
  { key: "mine", href: "#/mine", icon: "bookmarks", label: "マイ単語帳" },
  { key: "prints", href: "#/prints", icon: "assignment", label: "プリント" },
  { key: "classes", href: "#/classes", icon: "groups", label: "クラス" },
  null,
  { sub: "ツール" },
  { key: "maker", href: "#/maker", icon: "picture_as_pdf", label: "PDF からプリントを作る" },
  { key: "teach", href: "#/teach", icon: "school", label: "指導者メニュー" }
];
const drawer = document.getElementById("drawer");
const scrim = document.getElementById("scrim");
const navToggle = document.getElementById("nav-toggle");
const topTitle = document.getElementById("top-title");
const wide = window.matchMedia("(min-width: 1024px)");
const DRAWER_KEY = "sk_study_drawer_closed";
let activeNav = null;

// いま使っているプロファイル。個人なら null、クラスのプロファイルなら { cid, className, profileName }
let ctxInfo = null;
const CLASS_NAV = [
  { key: "home", href: "#/", icon: "home", label: "ホーム" },
  null,
  ...Object.entries(GROUPS).map(([k, g]) => ({ key: k, href: `#/?k=${k}`, icon: g.icon, label: g.name }))
];
async function refreshCtx() {
  const cid = cloud.activeClass();
  if (!cid) { ctxInfo = null; return; }
  if (!auth || auth.status !== "ready") { ctxInfo = ctxInfo && ctxInfo.cid === cid ? ctxInfo : null; return; }
  try {
    if (cloud.isStaffCtx(cid)) {
      // 先生・総合管理者のプロファイル（組織のプロファイル）
      const mine = (await cloud.staffProfiles()).find((p) => p.id === cid);
      if (mine) ctxInfo = { cid, staff: true, className: mine.orgName, profileName: mine.name };
      else { ctxInfo = null; cloud.setActiveClass(""); }
      return;
    }
    const mine = (await cloud.myClasses()).find((c) => c.id === cid && c.profileId);
    if (mine) ctxInfo = { cid, className: mine.name, profileName: mine.profileName || mine.name };
    else { ctxInfo = null; cloud.setActiveClass(""); }
  } catch (e) { /* ネットワークがないときは、前の表示のまま */ }
}
// 個人 / クラスのプロファイルを選ぶ
async function openProfileSwitcher() {
  if (!auth || auth.status !== "ready") { toast("ログインしてから切り替えられます"); return; }
  let classes = [], staff = [];
  try { [classes, staff] = await Promise.all([cloud.myClasses().then((l) => l.filter((c) => c.profileId)), cloud.staffProfiles().catch(() => [])]); } catch (e) { toast(cloud.explain(e)); return; }
  const cur = cloud.activeClass();
  const options = [["", `個人（${auth.name}）`], ...staff.map((p) => [p.id, `${p.name}（${p.orgName}）`]), ...classes.map((c) => [c.id, `${c.profileName || c.name}（${c.name}）`])];
  const d = choiceDialog("プロファイルを切り替え", options, cur, (v) => { cloud.setActiveClass(v); });
  d.querySelector(".radio-list").after(h("p", { class: "muted small" }, classes.length || staff.length ? "組織（クラス・先生）のプロファイルの学習の記録は、オンラインに保存され、どの端末でも同じものを使えます。クラスのプロファイルでは、そのクラスの課題だけが表示されます。" : "組織のプロファイルはまだありません。「クラス」で専用コードで参加すると、クラスのプロファイルが加わります。先生・総合管理者は、指導者メニューでコードを入れると加わります。"));
}
document.addEventListener("sk-study:ctx", async () => {
  await refreshCtx();
  records.switchTo(ctxInfo ? ctxInfo.cid : ""); // 組織のプロファイルは、記録を別に持つ
  drawDrawer();
  if (location.hash === "#/" || location.hash === "" || location.hash === "#") route(); else go("/", true);
  records.sync().then((changed) => { if (changed) route(); });
});

function drawDrawer() {
  const hint = readHint() || {};
  const name = (auth && auth.name) || hint.name || "";
  const email = hint.email || (auth && auth.user && auth.user.email) || "";
  const color = /^(#[0-9a-f]{3,8}|rgb\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*\))$/i.test(hint.color || "") ? hint.color : null;
  const shown = ctxInfo ? ctxInfo.profileName : name;
  const avatar = !ctxInfo && hint.photo && /^https:\/\//.test(hint.photo)
    ? h("img", { class: "drawer-avatar", src: hint.photo, alt: "", referrerpolicy: "no-referrer" })
    : h("span", { class: "drawer-avatar", style: !ctxInfo && color ? `background:${color}` : null, "aria-hidden": "true" }, ctxInfo ? shown.slice(0, 1) || "?" : hint.letter || name.slice(0, 1) || "?");
  const item = (n) => h("a", { class: "drawer-item", href: n.href, "data-nav": n.key }, icon(n.icon), h("span", null, n.label));
  const canSwitch = !!auth && auth.status === "ready";
  const who = h(canSwitch ? "button" : "div", canSwitch ? { type: "button", class: `drawer-head drawer-switch${ctxInfo ? " is-class" : ""}`, "aria-label": "プロファイルを切り替え", onclick: openProfileSwitcher } : { class: `drawer-head${ctxInfo ? " is-class" : ""}` },
    avatar,
    h("div", { class: "drawer-who" },
      h("strong", null, shown || "SK Hub Systems アカウント"),
      ctxInfo ? h("span", null, `${ctxInfo.staff ? "" : "クラス: "}${ctxInfo.className}`) : email ? h("span", null, email) : null),
    canSwitch ? icon("unfold_more", "drawer-switch-icon") : null);
  const nav = ctxInfo && !ctxInfo.staff ? CLASS_NAV : NAV;
  drawer.replaceChildren(
    who,
    h("div", { class: "drawer-list" },
      nav.map((n) => (n === null ? h("hr", { class: "drawer-divider" }) : n.sub ? h("p", { class: "drawer-sub" }, n.sub) : item(n))),
      h("hr", { class: "drawer-divider" }),
      h("a", { class: "drawer-item", href: "#/settings", "data-nav": "settings" }, icon("settings"), h("span", null, "設定")),
      h("a", { class: "drawer-item", href: "/account/" }, icon("manage_accounts"), h("span", null, "アカウント")),
      h("button", { type: "button", class: "drawer-item", onclick: logout }, icon("logout"), h("span", null, "ログアウト"))),
    h("p", { class: "drawer-foot" }, ctxInfo ? `${ctxInfo.staff ? "先生・総合管理者のプロファイル。" : "クラスのプロファイルでは、そのクラスの課題だけを表示します。"}学習の記録はオンラインに保存されます。` : "学習の記録・マイ単語帳・プリントは、このブラウザの中に保存されます。"));
  markActive();
}
function setActive(key) { activeNav = key; markActive(); }
function markActive() {
  drawer.querySelectorAll("[data-nav]").forEach((a) => {
    if (a.dataset.nav === activeNav) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
}
// スマートフォン: 左から出す（後ろは暗くして押せないように）。パソコン: 出しっぱなし（☰ でしまえる）
function syncDrawer() {
  const open = document.body.classList.contains("drawer-open");
  drawer.inert = wide.matches ? document.body.classList.contains("drawer-closed") : !open;
  navToggle.setAttribute("aria-expanded", String(wide.matches ? !document.body.classList.contains("drawer-closed") : open));
}
function openDrawer() {
  document.body.classList.add("drawer-open");
  scrim.hidden = false;
  syncDrawer();
  const current = drawer.querySelector("[aria-current]") || drawer.querySelector(".drawer-item");
  if (current) current.focus({ preventScroll: true });
}
function closeDrawer() {
  if (!document.body.classList.contains("drawer-open")) return;
  document.body.classList.remove("drawer-open");
  scrim.hidden = true;
  syncDrawer();
}
navToggle.addEventListener("click", () => {
  if (wide.matches) {
    const closed = document.body.classList.toggle("drawer-closed");
    try { localStorage.setItem(DRAWER_KEY, closed ? "1" : "0"); } catch (e) { /* 保存できなくても動く */ }
    syncDrawer();
  } else if (document.body.classList.contains("drawer-open")) {
    closeDrawer();
    navToggle.focus();
  } else {
    openDrawer();
  }
});
scrim.addEventListener("click", closeDrawer);
drawer.addEventListener("click", (e) => { if (e.target.closest("a.drawer-item")) closeDrawer(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && document.body.classList.contains("drawer-open")) { closeDrawer(); navToggle.focus(); }
});
wide.addEventListener("change", () => { closeDrawer(); syncDrawer(); });
try { if (localStorage.getItem(DRAWER_KEY) === "1") document.body.classList.add("drawer-closed"); } catch (e) { /* 同上 */ }
syncDrawer();

// ほかのところ（右上のアカウントのボタン・ほかのタブ）でログイン・ログアウトしたとき
function onAccountChange() {
  if (!readHint()) {
    if (auth && auth.status !== "signed-out") {
      cloud.resetSession();
      auth = { status: "signed-out" };
      records.switchTo("");
      route();
    }
  } else if (!allowed(auth) && auth) {
    recheckAuth();
    return;
  }
  drawDrawer();
}
document.addEventListener("skhub:account", onAccountChange);
window.addEventListener("storage", (e) => { if (e.key === "skhub_account" || e.key === null) onAccountChange(); });

// ページの上の見出し（タイトル・説明・右のボタン）
function pageHead(title, text, actions) {
  return h("header", { class: "page-head" },
    h("div", { class: "page-head-text" }, h("h1", null, title), text ? h("p", null, text) : null),
    actions ? h("div", { class: "page-head-actions" }, actions) : null);
}

// ---------- 設定（Material Design 1 の Settings パターンにそろえる） ----------
//   ・「設定」というラベルで、横のメニューの下の方に置く（アカウント・アプリの情報は入れない）
//   ・よく使うものを上に。グループの間にだけ区切り線を引き、グループには具体的な見出しを付ける
//   ・ラベルは画面タイトルの左端にそろえる。スイッチ以外は、2 行目に今の値（状態）だけを出す
//   ・値の変更は、ラジオボタンの簡単なダイアログ

function choiceDialog(title, options, value, onPick) {
  const name = `choice-${Math.random().toString(36).slice(2)}`;
  const list = h("div", { class: "radio-list", role: "radiogroup", "aria-label": title },
    options.map(([v, label]) => h("label", { class: "radio-row" },
      h("input", { type: "radio", name, value: String(v), checked: String(value) === String(v),
        onchange: () => { onPick(v); setTimeout(() => d.close(), 180); } }),
      h("span", null, label))));
  const d = openDialog(title, list, []);
  d.classList.add("dialog-simple");
  return d;
}

function renderSettings() {
  document.title = "設定 - SK Study";
  const root = h("div", { class: "settings" });
  const group = (title, ...rows) => h("section", { class: "settings-group" }, title ? h("h2", null, title) : null, ...rows.filter(Boolean));

  // 値を選ぶ行（2 行目は今の値）
  const choiceRow = (label, status, onclick, disabled = false) => h("button", { type: "button", class: "setting-item", onclick, disabled },
    h("strong", null, label), h("small", null, status));
  const find = (opts, v) => (opts.find(([x]) => String(x) === String(v)) || opts[0])[1];

  function draw() {
    const prefs = store.getPrefs();
    const rows = [
      group("学習",
        choiceRow("問題の数", find(COUNTS, prefs.count), () => choiceDialog("問題の数", COUNTS, prefs.count, (v) => { store.setPrefs({ count: Number(v) }); draw(); })),
        choiceRow("問題の形式", find(FORMATS, prefs.format), () => choiceDialog("問題の形式", FORMATS, prefs.format, (v) => { store.setPrefs({ format: v }); draw(); })))
    ];

    if (tts.supported) {
      const s = tts.getSettings();
      const auto = h("input", { type: "checkbox", checked: s.auto, "aria-label": "自動で読み上げる",
        onchange: (e) => { tts.saveSettings({ auto: e.target.checked }); draw(); } });
      const voiceRows = VOICE_LANGS.map(([lang, name, sample]) => {
        const list = tts.voicesFor(lang);
        const sk = tts.hasSkVoice(lang) ? tts.SK_VOICES : [];
        if (!list.length && !sk.length) return choiceRow(`${name}の声`, "この端末には入っていません", null, true);
        const current = s.voices[lang];
        const auto = list.length ? `おまかせ（${list[0].name}）` : "おまかせ";
        const opts = [["", auto], ...sk, ...list.map((v) => [v.name, `${v.name}${v.localService ? "" : "（ネット）"}`])];
        const shown = opts.some(([v]) => v && v === current) ? current : null;
        const status = shown ? opts.find(([v]) => v === shown)[1] : auto;
        return choiceRow(`${name}の声`, status, () => choiceDialog(`${name}の声`, opts, shown || "", (v) => {
          const saved = { ...tts.getSettings().voices };
          if (v) saved[lang] = v; else delete saved[lang];
          tts.saveSettings({ voices: saved });
          tts.speak(sample, lang);
          draw();
        }));
      });
      rows.push(
        h("hr", { class: "settings-divider" }),
        group("読み上げ",
          h("label", { class: "setting-item switch-row" }, auto,
            h("span", null, h("strong", null, "自動で読み上げ"), h("small", null, "外国語を声で再生する"))),
          choiceRow("速さ", find(tts.RATES, s.rate), () => choiceDialog("読み上げの速さ", tts.RATES, s.rate, (v) => { tts.saveSettings({ rate: Number(v) }); draw(); })),
          ...voiceRows));
    }
    root.replaceChildren(...rows);
  }
  draw();
  const stopWatch = tts.supported ? tts.onVoicesChanged(draw) : null;
  const leave = () => { window.removeEventListener("hashchange", leave); if (stopWatch) stopWatch(); tts.stop(); };
  window.addEventListener("hashchange", leave);
  app.append(pageHead("設定"), root);
}

// ---------- ホーム ----------

function sourceLabel(set) {
  if (set.source === "sk") return set.level ? `SK ・ ${set.level}` : "SK";
  if (set.source === "shared") return "共有された単語帳";
  return "マイ単語帳";
}

// 単語セットの行。start があれば右に「学習」ボタンを出す
function setRow(set, { start = false } = {}) {
  const lang = store.langOf(set);
  const s = store.setStats(set);
  return h("div", { class: "set-row" },
    thumb(lang),
    h("div", { class: "set-row-body" },
      h("a", { class: "set-row-link", href: `#/set/${encodeURIComponent(set.id)}` },
        h("span", { class: "set-row-sub" }, langBadge(lang), h("span", null, sourceLabel(set))),
        h("span", { class: "set-row-title" }, set.title)),
      h("span", { class: "set-row-meta" },
        h("span", null, icon("format_list_bulleted"), `${s.total} 語`),
        s.due ? h("span", { class: "due" }, icon("event_repeat"), `復習 ${s.due}`) : null)),
    h("div", { class: "set-row-end" },
      ring(s.memory / 100, { size: 52, stroke: 5, color: s.memory >= 100 ? "var(--st-mastered)" : "var(--primary)", label: `${s.memory}%` }),
      start ? button("pill", "学習", null, () => go(`/learn/${encodeURIComponent(set.id)}?mode=learn`)) : null));
}

// カードの形の単語セット（ホームの「続きから」「おすすめ」）
function setCard(set) {
  const lang = store.langOf(set);
  const s = store.setStats(set);
  const href = `#/set/${encodeURIComponent(set.id)}`;
  return h("article", { class: "set-card" },
    h("a", { class: "set-card-main", href },
      h("span", { class: "set-card-top" },
        thumb(lang),
        ring(s.memory / 100, { size: 44, stroke: 4, color: s.memory >= 100 ? "var(--st-mastered)" : "var(--primary)", label: `${s.memory}%` })),
      h("span", { class: "set-row-sub" }, langBadge(lang), h("span", null, sourceLabel(set))),
      h("span", { class: "set-card-title" }, set.title),
      h("span", { class: "set-row-meta" },
        h("span", null, icon("format_list_bulleted"), `${s.total} 語`),
        s.due ? h("span", { class: "due" }, icon("event_repeat"), `復習 ${s.due}`) : null)),
    h("div", { class: "set-card-actions" },
      linkButton("text", "開く", null, href),
      button("text", "学習する", null, () => go(`/learn/${encodeURIComponent(set.id)}?mode=learn`))));
}

function renderHome() {
  document.title = "SK Study";
  const due = store.dueItems();
  const o = store.overall();
  const name = (auth && auth.name) || (readHint() || {}).name || "";
  const hour = new Date().getHours();
  const hello = hour >= 5 && hour < 11 ? "おはようございます" : hour >= 11 && hour < 18 ? "こんにちは" : "こんばんは";
  const dateText = new Date().toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "long" });

  const today = h("section", { class: "today" },
    h("div", { class: "today-main" },
      h("p", { class: "today-label" }, icon("event_repeat"), "今日の復習"),
      h("p", { class: "today-count" }, String(due.length), h("small", null, "語")),
      h("p", { class: "today-sub" },
        due.length ? "忘れかけたころに復習すると、記憶に残ります。"
          : o.learned ? "今日の復習はおわりました。新しい単語に進みましょう。"
            : "SK認定コンテンツを選んで、学習をはじめましょう。")),
    due.length ? button("filled", "復習する", "play_arrow", () => go("/learn/review?mode=learn"), { class: "filled-btn today-start" })
      : linkButton("filled", "SK認定コンテンツを選ぶ", "library_books", "#/sets"));
  const startBtn = today.querySelector("a.filled-btn");
  if (startBtn) startBtn.classList.add("today-start");

  const stat = (ic, value, unit, label, tone) => h("div", { class: `stat-card tone-${tone}` },
    h("span", { class: "stat-icon" }, icon(ic)),
    h("span", { class: "stat-text" }, h("strong", null, String(value), h("small", null, unit)), h("span", null, label)));

  // 続きから（答えたことのあるセット。復習の多い順）。まだなければ SK のおすすめ
  const started = store.allSets()
    .map((set) => ({ set, s: store.setStats(set) }))
    .filter(({ s }) => s.started > 0)
    .sort((a, b) => b.s.due - a.s.due || a.s.memory - b.s.memory)
    .map(({ set }) => set);
  const picks = started.length ? started.slice(0, 6) : store.getSkSets().slice(0, 3);

  const tile = (ic, label, sub, target) => h(typeof target === "string" ? "a" : "button",
    typeof target === "string" ? { class: "tile", href: target } : { class: "tile", type: "button", onclick: target },
    h("span", { class: "tile-icon" }, icon(ic)), h("strong", null, label), h("span", null, sub));

  app.append(
    h("header", { class: "home-head" },
      h("p", { class: "home-date" }, dateText),
      h("h1", null, name ? `${hello}、${name} さん` : hello)),
    h("div", { class: "home-top" },
      today,
      h("div", { class: "stat-grid" },
        stat("local_fire_department", o.streak, "日", "連続で学習", "fire"),
        stat("verified", o.mastered, "語", "記憶済み", "good"),
        stat("task_alt", o.today, "問", "今日答えた", "primary"))),
    h("section", { class: "section" },
      h("div", { class: "section-head" },
        h("h2", null, started.length ? "続きから" : "おすすめの単語セット"),
        linkButton("text", "すべて見る", null, "#/sets")),
      h("div", { class: "card-grid" }, picks.map(setCard))),
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, "ショートカット")),
      h("div", { class: "tile-grid" },
        tile("note_add", "単語帳を作る", "自分だけの単語帳", "#/edit/new"),
        tile("link", "リンクから追加", "友だちの単語帳を受け取る", openImportDialog),
        tile("assignment", "プリント", "HTML・PDF のプリントに答える", "#/prints"),
        tile("groups", "クラス", "参加コードでクラスに入る", "#/classes"))));
}

// SK認定コンテンツ（言語でしぼりこむ）
function renderSets() {
  document.title = "SK認定コンテンツ - SK Study";
  const prefs = store.getPrefs();
  const filters = [["all", "すべて"], ["en", "英語"], ["ko", "韓国語"], ["zh", "中国語"]];
  const list = h("div", { class: "set-list" });
  const chips = h("div", { class: "chips", role: "group", "aria-label": "言語でしぼりこむ" });
  function draw(filter) {
    chips.replaceChildren(...filters.map(([key, label]) => h("button", {
      type: "button", class: "chip", "aria-pressed": String(filter === key),
      onclick: () => { store.setPrefs({ filter: key }); draw(key); }
    }, filter === key ? icon("check") : null, label)));
    const sets = store.getSkSets().filter((s) => filter === "all" || s.lang === filter);
    list.replaceChildren(...(sets.length ? sets.map((s) => setRow(s, { start: true })) : [h("p", { class: "empty" }, "この言語のセットはまだありません。")]));
  }
  draw(prefs.filter);
  app.append(
    pageHead("SK認定コンテンツ", "SK が認定したコンテンツです。「自分用にコピー」すると、自由に編集できます。"),
    chips, list);
}

// マイ単語帳（自分で作ったもの・共有リンクで受け取ったもの）
function renderMine() {
  document.title = "マイ単語帳 - SK Study";
  const mine = store.getMySets().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  app.append(
    pageHead("マイ単語帳", "自分で作った単語帳と、共有リンクで受け取った単語帳です。",
      [button("text", "リンクから追加", "link", openImportDialog), linkButton("filled", "新しく作る", "add", "#/edit/new")]),
    mine.length ? h("div", { class: "set-list" }, mine.map((s) => setRow(s, { start: true })))
      : h("div", { class: "empty-card" },
        icon("library_add", "empty-icon"),
        h("p", null, "自分の単語帳を作れます。テストに出る言葉、好きな言語、漢字や理科の用語など、なんでも。"),
        h("p", { class: "muted" }, "作った単語帳は、リンクで友だちに共有できます。"),
        linkButton("filled", "新しく作る", "add", "#/edit/new")),
    // MD1 の FAB（スマートフォン）
    h("a", { class: "fab", href: "#/edit/new", "aria-label": "新しい単語帳を作る", title: "新しい単語帳を作る" }, icon("add")));
}

function openImportDialog() {
  const input = h("input", { type: "url", class: "field-input", placeholder: "https://sk-hub.jp/study/#/import/…", "aria-label": "共有リンク" });
  const d = openDialog("共有リンクから追加",
    h("div", null, h("p", null, "友だちから受け取った単語帳のリンクを貼りつけてください。"), input),
    [button("text", "やめる", null, () => d.close()),
      button("filled", "開く", null, () => {
        const code = extractCode(input.value);
        if (!code) { toast("SK Study の共有リンクではないようです"); input.focus(); return; }
        d.close();
        go(`/import/${code}`);
      })]);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) d.querySelector(".filled-btn").click(); });
  input.focus();
}

// ---------- 単語セット ----------

function sourceText(set) {
  if (set.source === "sk") return "SK認定コンテンツ";
  if (set.source === "class") return set.teacherName ? `${set.teacherName} 先生が配信` : "先生が配信";
  if (set.source === "shared") return `共有リンクから追加${set.from && set.from !== set.title ? `（もとの名前: ${set.from}）` : ""}`;
  if (set.source === "copy") return `SK認定コンテンツの「${set.from || ""}」をコピー`;
  return "マイ単語帳";
}

// 小テストの前回・最高の点
function testNote(set) {
  const tests = store.testsOf(set.id);
  if (!tests.length) return h("p", { class: "start-note" }, "小テスト: 答え合わせは最後にまとめて。点数が記録されます。");
  const pct = (t) => (t.total ? Math.round((t.ok / t.total) * 100) : 0);
  const last = tests[tests.length - 1];
  const best = Math.max(...tests.map(pct));
  return h("p", { class: "start-note test-note" }, icon("quiz"), `小テスト ${tests.length} 回 ・ 前回 ${pct(last)}%（${last.ok}/${last.total}）・ 最高 ${best}%`);
}

function renderSet(id) {
  const set = store.getSet(id);
  if (!set) {
    renderMessage("単語セットが見つかりません", "消されたか、ほかのブラウザで作ったマイ単語帳かもしれません。");
    return;
  }
  document.title = `${set.title} - SK Study`;
  const lang = store.langOf(set);
  const s = store.setStats(set);
  const prefs = store.getPrefs();
  const la = langAttr(lang);
  const learnUrl = (mode) => `/learn/${encodeURIComponent(set.id)}?mode=${mode}`;

  const countSelect = h("select", { class: "field-select", "aria-label": "問題の数", onchange: (e) => store.setPrefs({ count: Number(e.target.value) }) },
    COUNTS.map(([v, label]) => h("option", { value: String(v), selected: prefs.count === v }, label)));
  const formatSelect = h("select", { class: "field-select", "aria-label": "問題の形式", onchange: (e) => store.setPrefs({ format: e.target.value }) },
    FORMATS.map(([v, label]) => h("option", { value: v, selected: prefs.format === v }, label)));

  const mine = set.source !== "sk" && set.source !== "class";
  const fromClass = set.source === "class" && set.classRef;
  const actions = h("div", { class: "set-actions" },
    mine ? linkButton("outlined", "編集", "edit", `#/edit/${encodeURIComponent(set.id)}`) : null,
    fromClass ? null : button("outlined", "共有", "share", () => openShare(set)),
    !mine && !set.noCopy ? button("outlined", "自分用にコピー", "content_copy", () => {
      const copy = store.copySet(set);
      toast("マイ単語帳にコピーしました。自由に編集できます");
      go(`/set/${encodeURIComponent(copy.id)}`);
    }) : null,
    mine ? button("outlined", "削除", "delete", async () => {
      if (await confirmDialog("この単語帳を削除しますか？", `「${set.title}」と、その学習の記録を消します。もとに戻せません。`, "削除する", true)) {
        store.deleteMySet(set.id);
        toast("削除しました");
        go("/mine", true);
      }
    }, { "data-danger": "" }) : null);

  // 単語の一覧（上が外国語、下が日本語。右は記憶度の輪）
  const p = store.progressOf(set.id);
  const list = h("ol", { class: set.noCopy ? "word-list no-copy" : "word-list" }, set.words.map((w) => {
    const rec = p[w.w];
    return h("li", { class: "word-row" },
      h("div", { class: "word-pair" },
        h("div", { class: "word-line" },
          h("span", { class: `word-tag lang-${lang.key}` }, lang.name),
          h("span", { class: "word-text" },
            h("span", { class: "word-w", lang: la }, w.w),
            w.r ? h("span", { class: "word-r" }, w.r) : null)),
        h("div", { class: "word-line" },
          h("span", { class: "word-tag lang-ja" }, "日本語"),
          h("span", { class: "word-text" }, h("span", { class: "word-m" }, w.m))),
        w.ex ? h("div", { class: "word-ex" }, h("span", { lang: la }, w.ex), w.exm ? h("span", null, w.exm) : null) : null),
      speakButton(w.w, lang.speech),
      h("span", { class: "word-status", title: STATUS[store.statusOf(rec)].label }, wordRing(rec)));
  }));

  if (set.noCopy) for (const t of ["copy", "cut", "contextmenu", "dragstart", "selectstart"]) list.addEventListener(t, (e) => e.preventDefault());
  app.append(
    fromClass ? backLink("クラス", `#/class/${encodeURIComponent(set.classRef.cid)}`) : set.source === "sk" ? backLink("SK認定コンテンツ", "#/sets") : backLink("マイ単語帳", "#/mine"),
    fromClass ? h("p", { class: "class-banner" }, icon("groups"), `${set.teacherName ? `${set.teacherName} 先生が配信した` : "先生が配信した"}課題「${set.assignTitle || set.title}」。学習すると、覚えた語の数が先生に届きます。${set.noCopy ? "この単語帳はコピーできません。" : ""}`) : "",
    h("section", { class: "set-head" },
      thumb(lang),
      h("div", null,
        h("p", { class: "set-row-sub" }, langBadge(lang), set.level ? h("span", null, set.level) : null),
        h("h1", null, set.title),
        set.description ? h("p", { class: "set-desc" }, set.description) : null,
        h("p", { class: "muted small" }, icon(set.source === "sk" ? "verified" : set.source === "class" ? "school" : "person"), sourceText(set), set.noCopy ? " ・ コピー禁止" : ""))),
    h("section", { class: "memory-card" },
      h("h2", null, "記憶度"),
      h("div", { class: "memory-body" },
        donut(s),
        h("ul", { class: "legend" },
          ["mastered", "learning", "weak", "new"].map((key) => h("li", null,
            h("i", { style: `background:${STATUS[key].color}` }),
            h("span", null, STATUS[key].label),
            h("strong", null, String(s[key])))),
          h("li", { class: "legend-due" }, icon("event_repeat"), h("span", null, "今日の復習"), h("strong", null, String(s.due)))))),
    h("section", { class: "start-card" },
      button("filled", "学習する", "play_arrow", () => go(learnUrl("learn")), { class: "filled-btn start-btn" }),
      h("p", { class: "start-note" }, `${lang.name} ↔ 日本語 を両方向でまぜて出題。4 択・書き取りの難易度は、覚えぐあいに合わせて自動で変わります。`),
      h("div", { class: "start-options" },
        h("label", { class: "option" }, h("span", null, "問題の数"), countSelect),
        h("label", { class: "option" }, h("span", null, "形式"), formatSelect)),
      h("div", { class: "start-more" },
        button("tonal", "単語カードで覚える", "style", () => go(learnUrl("card")), { class: "tonal-btn" }),
        button("outlined", "小テスト", "quiz", () => go(learnUrl("test")), { class: "outlined-btn" })),
      testNote(set)),
    actions,
    h("section", { class: "section" },
      h("h2", null, `単語（${set.words.length}）`),
      list));
}

async function openShare(set) {
  const isSk = set.source === "sk";
  let url;
  try {
    url = isSk ? `${location.origin}/study/#/set/${encodeURIComponent(set.id)}` : shareUrl(await encodeSet(set));
  } catch (e) {
    toast("共有リンクを作れませんでした");
    return;
  }
  const field = h("textarea", { class: "field-input share-url", readonly: true, rows: "3", "aria-label": "共有リンク" }, url);
  const notes = isSk
    ? [h("p", null, "SK認定コンテンツのページへのリンクです。")]
    : [h("p", null, "リンクに単語帳がまるごと入っています（サーバーには保存しません）。受け取った人は、自分のマイ単語帳にコピーして使えます。"),
      h("p", { class: "muted small" }, "リンクを知っている人はだれでも見られます。あとで単語帳を直しても、送ったリンクの中身は変わりません。"),
      url.length > 6000 ? h("p", { class: "warn small" }, icon("warning"), "単語が多いのでリンクが長くなっています。アプリによっては途中で切れることがあります。") : null];
  const d = openDialog("共有する", h("div", null, notes, field), [
    navigator.share ? button("text", "ほかのアプリで", "ios_share", () => navigator.share({ title: set.title, url }).catch(() => {})) : null,
    button("text", "閉じる", null, () => d.close()),
    button("filled", "コピー", "content_copy", async () => {
      try { await navigator.clipboard.writeText(url); toast("リンクをコピーしました"); }
      catch (e) { field.select(); toast("選んだ文字をコピーしてください"); }
    })
  ]);
  field.addEventListener("focus", () => field.select());
}

// ---------- 学習 ----------

// 出す単語を選ぶ。弱点・未学習・記憶度の低いものを先に
function pickItems(set, count) {
  const p = store.progressOf(set.id);
  const score = (w) => {
    const r = p[w.w];
    if (!r) return 1;
    if (r.b === 0) return 0;
    return 2 + r.b;
  };
  const today = store.dayNumber();
  // 復習の日が来ていないもの（覚えたばかり）は後ろへ
  const words = shuffle(set.words).sort((a, b) => {
    const ra = p[a.w], rb = p[b.w];
    const wa = ra && ra.due > today ? 10 : 0, wb = rb && rb.due > today ? 10 : 0;
    return wa + score(a) - (wb + score(b));
  });
  const n = count > 0 ? Math.min(count, words.length) : words.length;
  return shuffle(words.slice(0, n)).map((word) => ({ set, word }));
}

function renderLearn(id, q) {
  const mode = ["card", "test"].includes(q.get("mode")) ? q.get("mode") : "learn";
  const prefs = store.getPrefs();
  if (id === "review") {
    const items = store.dueItems().slice(0, 20).map(({ set, word }) => ({ set, word }));
    if (!items.length) {
      renderMessage("今日の復習はありません", "単語セットを選んで、新しい単語を学習しましょう。");
      return;
    }
    runSession({ items: shuffle(items), mode, format: prefs.format, title: "今日の復習", backHref: "#/" });
    return;
  }
  const set = store.getSet(id);
  if (!set) {
    renderMessage("単語セットが見つかりません", "消されたか、ほかのブラウザで作ったマイ単語帳かもしれません。");
    return;
  }
  // 小テストは、覚えぐあいに関係なく全体からえらぶ
  const items = mode === "test"
    ? shuffle(set.words).slice(0, prefs.count > 0 ? prefs.count : set.words.length).map((word) => ({ set, word }))
    : pickItems(set, prefs.count);
  runSession({ items, mode, format: prefs.format, title: set.title, backHref: `#/set/${encodeURIComponent(set.id)}` });
}

// 選択肢に使える言葉（同じセット。足りなければ同じ言語のほかのセットから）
function choicePool(item, key) {
  const correct = item.word[key];
  const seen = new Set([correct]);
  const pick = (words) => shuffle(words).map((w) => w[key]).filter((v) => !seen.has(v) && seen.add(v));
  let out = pick(item.set.words);
  if (out.length < 4) {
    const others = store.allSets().filter((s) => s !== item.set && s.lang === item.set.lang && (s.lang !== "custom" || s.langName === item.set.langName));
    out = out.concat(pick(others.flatMap((s) => s.words)));
  }
  return out;
}

// 単語の難易度（1〜3）
function tierOf(item) {
  const r = store.progressOf(item.set.id)[item.word.w];
  if (!r || r.b === 0) return 1;
  if (r.b <= 2) return 2;
  return 3;
}

// 1 問を作る。{ type: choice|write, dir: fw（外国語 → 日本語）|bw（日本語 → 外国語）, tier, options, answer }
function makeQuestion(item, format, retry, forceBw = false) {
  const tier = retry ? 1 : tierOf(item);
  let dir = Math.random() < 0.5 ? "fw" : "bw";
  let type;
  if (format === "choice") type = "choice";
  else if (format === "write") type = "write";
  else type = tier === 3 && Math.random() < 0.7 ? "write" : "choice";
  if (format === "auto" && type === "write" && Math.random() < 0.75) dir = "bw"; // 書き取りは外国語を答えるほうを多めに
  if (forceBw && type === "write") dir = "bw"; // 画面のキーボードで答えられるように、外国語を答える形にする（日本語はかな漢字変換が要る）
  const key = dir === "fw" ? "m" : "w";
  const pool = choicePool(item, key);
  if (type === "choice" && pool.length < 3) type = "write";
  if (type === "write") return { type, dir, tier, answer: item.word[key] };
  // 難易度 2 から「この中にはない」を付ける。4 回に 1 回は正解を選択肢から外す
  const withNone = tier >= 2;
  const hideCorrect = withNone && pool.length >= 4 && Math.random() < 0.25;
  const options = hideCorrect ? shuffle(pool.slice(0, 4)) : shuffle([item.word[key], ...pool.slice(0, 3)]);
  if (withNone) options.push(NONE);
  return { type, dir, tier, options, answer: hideCorrect ? NONE : item.word[key] };
}

const isTyping = (e) => !!e.target.closest && !!e.target.closest("input, textarea, select");
const isControl = (e) => !!e.target.closest && !!e.target.closest("button, a, [role=button], input, textarea, select");

// ---------- クラスの小テスト: 全画面（パソコン）・提出前の確認 ----------
const testMode = { fs: false };
const isPc = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
function endTestMode() {
  testMode.fs = false;
  hideFsGuard();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
function hideFsGuard() {
  const g = document.getElementById("fs-guard");
  if (g) g.remove();
  app.inert = false;
}
// 全画面でないあいだは、警告の画面でさえぎる（後ろの問題は操作できない）
function showFsGuard() {
  if (document.getElementById("fs-guard")) return;
  app.inert = true;
  document.body.append(h("div", { id: "fs-guard", class: "fs-guard", role: "alertdialog", "aria-labelledby": "fs-guard-title" },
    icon("fullscreen", "fs-guard-icon"),
    h("h2", { id: "fs-guard-title" }, "全画面で受けてください"),
    h("p", null, "全画面ではありません。小テストは、全画面で受けます。続けるには、全画面にしてください。"),
    button("filled", "全画面にする", "fullscreen", () => document.documentElement.requestFullscreen().catch(() => toast("全画面にできませんでした。ブラウザの設定を確かめてください"))),
    h("p", { class: "muted small" }, "ブラウザが全画面を許可していないときは、設定で許可してください。")));
}
document.addEventListener("fullscreenchange", () => {
  if (!testMode.fs) return;
  if (document.fullscreenElement) hideFsGuard(); else showFsGuard();
});

function runSession(cfg) {
  const { mode } = cfg;
  const isTest = mode === "test";
  // クラスの小テスト: 全画面（パソコン）・上の帯なし・提出前に全部の答えを確認・結果は先生が返却するまで見えない
  const classTest = isTest && !!cfg.classTest;
  let editing = -1; // 提出前の確認で直している問題の番号
  if (classTest) {
    document.body.dataset.view = "learn"; // 上の帯と横のメニューを出さない
    if (isPc() && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      testMode.fs = true;
      document.documentElement.requestFullscreen().catch(() => showFsGuard());
    }
  }
  let curQn = null;  // いまの問題（小テストの結果に出す）
  let given = "";    // いまの問題に答えたもの（同上）
  const queue = cfg.items.map((item) => ({ item, retry: 0 }));
  const firstTry = new Map(); // 単語ごとの、はじめに答えたときの結果
  let pos = 0;
  let pending = null; // いまの問題の結果（次へ進むときに記録する。「正解にする」で変えられる）
  let autoNext = 0;
  document.title = `${{ card: "単語カード", test: "小テスト" }[mode] || "学習"} - SK Study`;

  const barFill = h("span");
  const counter = h("span", { class: "learn-count" });
  const levelEl = h("span", { class: "learn-level" });
  const body = h("div", { class: "learn-body" });
  const judge = h("div", { class: "judge", "aria-hidden": "true" });
  app.replaceChildren(h("section", { class: `learn learn-${mode}` },
    h("header", { class: "learn-head" },
      h("a", { class: "icon-btn", href: cfg.backHref, "aria-label": "やめる", title: "やめる" }, icon("close")),
      h("span", { class: "learn-title" }, isTest ? h("span", { class: "test-pill" }, "小テスト") : null, cfg.title),
      levelEl,
      counter,
      h("button", { type: "button", class: "icon-btn", "aria-label": "読み上げの設定", title: "読み上げの設定", onclick: openSpeechSettings }, icon("record_voice_over"))),
    h("div", { class: "learn-line", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(cfg.items.length) }, barFill),
    body));

  const keyOf = (item) => `${item.set.id}\n${item.word.w}`;

  // 答え合わせ: 下から出るシート（Android の bottom sheet）。問題と選択肢は上に残し、問題の場所を小さくして見えるようにする
  const learnEl = body.parentElement;
  let sheetHost = null;
  function newSheetHost() {
    sheetHost = h("div", { class: "sheet-host", "aria-live": "polite" });
    return sheetHost;
  }
  function setVerdict(sheet, ok, title) {
    sheet.classList.toggle("is-ok", ok);
    sheet.classList.toggle("is-ng", !ok);
    sheet.querySelector(".sheet-verdict").replaceChildren(icon(ok ? "check_circle" : "cancel"), h("span", null, title));
  }
  function openSheet(ok, title, children, nextBtn) {
    const sheet = h("section", { class: "result-sheet", "aria-label": "答え合わせ" },
      h("p", { class: "sheet-verdict" }),
      h("div", { class: "sheet-body" }, children),
      nextBtn);
    setVerdict(sheet, ok, title);
    nextBtn.hidden = false;
    sheetHost.replaceChildren(sheet);
    learnEl.classList.add("is-answered");
    body.style.paddingBottom = `${sheet.offsetHeight + 16}px`; // シートの下にかくれないように
    requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: motionOff.matches ? "auto" : "smooth" }));
    return sheet;
  }
  function closeSheet() {
    learnEl.classList.remove("is-answered");
    body.style.paddingBottom = "";
  }

  // ○・× を問題の上に出す
  function showJudge(ok) {
    const area = body.querySelector(".q-area");
    if (area) area.append(judge);
    judge.className = `judge ${ok ? "is-ok" : "is-ng"}`;
    void judge.offsetWidth; // 動きを最初からやり直す
    judge.classList.add("show");
  }

  function next() {
    clearTimeout(autoNext);
    closeSheet();
    judge.className = "judge";
    if (pending !== null) {
      const { item, retry } = queue[pos];
      if (!classTest) store.recordAnswer(item.set.id, item.word.w, pending); // クラスの小テストは、記憶の記録に混ぜない（結果が見えてしまうため）
      if (editing >= 0 || !firstTry.has(keyOf(item))) firstTry.set(keyOf(item), { item, ok: pending, qn: curQn, given });
      // まちがえたら、少しあとにもう一度（学習のときだけ）
      if (!pending && mode === "learn" && retry < RETRY_MAX) {
        queue.splice(Math.min(pos + 1 + RETRY_GAP, queue.length), 0, { item, retry: retry + 1 });
      }
      pending = null;
    }
    if (editing >= 0) { editing = -1; pos = queue.length; showReview(); return; }
    pos++;
    if (pos >= queue.length) finish();
    else show();
  }

  function show() {
    const done = firstTry.size;
    counter.textContent = `${pos + 1} / ${queue.length}`;
    barFill.style.width = `${(done / cfg.items.length) * 100}%`;
    barFill.parentElement.setAttribute("aria-valuenow", String(done));
    tts.stop();
    body.replaceChildren();
    const { item, retry } = queue[pos];
    if (mode === "card") { levelEl.replaceChildren(); showCard(item); return; }
    // 小テスト: 書き取りは、画面のキーボード（keyboard.js）で答えられる外国語を答える形にする
    const qn = makeQuestion(item, cfg.format, retry > 0, isTest && KEYBOARD_LANGS.includes(store.langOf(item.set).key));
    curQn = qn;
    given = "";
    levelEl.replaceChildren(...[
      retry ? h("span", { class: "retry-pill" }, icon("replay"), "もう一度") : null,
      h("span", { class: "level-dots", title: `難易度 ${qn.tier}`, "aria-label": `難易度 ${qn.tier}` },
        [1, 2, 3].map((n) => h("i", { class: n <= qn.tier ? "on" : "" })))
    ].filter(Boolean));
    if (qn.type === "choice") showChoice(item, qn);
    else showWrite(item, qn);
    if (qn.dir === "fw") autoSpeak(item.word.w, store.langOf(item.set).speech, body.querySelector(".q-area"));
  }

  // 問題（外国語 → 日本語なら外国語を、日本語 → 外国語なら日本語を大きく出す）
  function questionArea(item, dir) {
    const lang = store.langOf(item.set);
    const fw = dir === "fw";
    return h("div", { class: "q-area" },
      h("p", { class: "q-tag" }, h("span", { class: `lang-badge ${fw ? `lang-${lang.key}` : "lang-ja"}` }, fw ? lang.name : "日本語"),
        icon("sync_alt"), h("span", { class: `lang-badge ${fw ? "lang-ja" : `lang-${lang.key}`}` }, fw ? "日本語" : lang.name)),
      h("p", { class: "q-text", lang: fw ? langAttr(lang) : "ja" }, fw ? item.word.w : item.word.m),
      fw && item.word.r ? h("p", { class: "q-reading" }, item.word.r) : null,
      fw ? speakButton(item.word.w, lang.speech) : null);
  }

  // 答え合わせの説明（単語・読み・意味・例文）
  function detail(item) {
    const lang = store.langOf(item.set);
    const la = langAttr(lang);
    const w = item.word;
    return h("div", { class: "detail" },
      h("div", { class: "detail-row" },
        h("span", { class: "detail-w", lang: la }, w.w),
        w.r ? h("span", { class: "detail-r" }, w.r) : null,
        speakButton(w.w, lang.speech)),
      h("p", { class: "detail-m" }, w.m),
      w.ex ? h("p", { class: "detail-ex" }, h("span", { lang: la }, w.ex), w.exm ? h("span", null, w.exm) : null) : null);
  }

  // ---- 4 択（＋この中にはない） ----
  function showChoice(item, qn) {
    const lang = store.langOf(item.set);
    const answerLang = qn.dir === "fw" ? "ja" : langAttr(lang);
    const host = newSheetHost();
    const nextBtn = button("filled", "次へ", "arrow_forward", next, { class: "filled-btn next-btn", hidden: true });
    let answered = false;
    const optionEls = qn.options.map((text, i) => h("button", {
      type: "button", class: `choice${text === NONE ? " choice-none" : ""}`, lang: text === NONE ? "ja" : answerLang,
      onclick: () => pick(i)
    }, h("span", { class: "choice-num" }, String(i + 1)), h("span", { class: "choice-text" }, text === NONE ? "この中にはない" : text)));
    function pick(i) {
      if (answered) return;
      answered = true;
      const ok = qn.options[i] === qn.answer;
      pending = ok;
      if (isTest) {
        // 小テスト: 正解は見せずに次へ
        given = qn.options[i] === NONE ? "この中にはない" : qn.options[i];
        optionEls.forEach((el, j) => { el.disabled = true; if (j === i) el.classList.add("is-picked"); });
        autoNext = setTimeout(next, 250);
        return;
      }
      optionEls.forEach((el, j) => {
        el.disabled = true;
        if (qn.options[j] === qn.answer) el.classList.add("is-correct");
        else if (j === i) el.classList.add("is-wrong");
      });
      showJudge(ok);
      const sheet = openSheet(ok, ok ? "正解！" : qn.answer === NONE ? "正解は「この中にはない」でした" : "ざんねん…", detail(item), nextBtn);
      if (qn.dir === "bw") autoSpeak(item.word.w, lang.speech, sheet);
      nextBtn.focus({ preventScroll: true });
      if (ok) autoNext = setTimeout(next, 1100);
    }
    body.append(questionArea(item, qn.dir),
      h("div", { class: "a-area" }, h("div", { class: "choices" }, optionEls)), host);
    keyHandler = (e) => {
      if (isTyping(e)) return;
      const n = Number(e.key);
      if (!answered && n >= 1 && n <= qn.options.length) { e.preventDefault(); pick(n - 1); }
      else if (answered && e.key === "Enter" && !isControl(e)) { e.preventDefault(); next(); }
    };
  }

  // ---- 書き取り ----
  function showWrite(item, qn) {
    const lang = store.langOf(item.set);
    const fw = qn.dir === "fw";
    const target = qn.answer;
    const reading = !fw && lang.key === "zh" ? item.word.r || "" : "";
    const input = h("input", {
      type: "text", class: "write-input", autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: "false",
      lang: fw ? "ja" : langAttr(lang), "aria-label": "答え", inputmode: "text", enterkeyhint: "done",
      placeholder: fw ? "日本語で答える" : reading ? `${lang.name}で（ピンインでも OK）` : `${lang.name}で答える`
    });
    const hintEl = h("p", { class: "hint", hidden: true });
    const host = newSheetHost();
    const submitBtn = h("button", { type: "submit", class: "filled-btn" }, h("span", null, "確定"));
    // 外国語を答える問題は、端末のキーボードではなく、画面のキーボード（keyboard.js）で答える。日本語を答える問題だけ、端末のキーボード
    const touch = window.matchMedia("(pointer: coarse)").matches;
    const useKb = !fw && KEYBOARD_LANGS.includes(lang.key);
    const kbBtn = !useKb && touch ? button("tonal", "キーボードを表示", "keyboard", () => input.focus()) : null;
    const helpers = h("div", { class: "write-helpers" },
      kbBtn,
      isTest ? null : button("text", "ヒント", "lightbulb", () => { hintEl.textContent = hint(target); hintEl.hidden = false; input.focus(); }),
      button("text", isTest ? "わからない（とばす）" : "わからない", "help", () => settle(false, "")));
    const nextBtn = button("filled", "次へ", "arrow_forward", next, { class: "filled-btn next-btn", hidden: true });
    let answered = false;

    function settle(ok, typed, close = false) {
      answered = true;
      pending = ok;
      if (isTest) { given = typed; next(); return; }
      input.disabled = true;
      submitBtn.hidden = true;
      helpers.hidden = true;
      if (typed) showJudge(ok);
      let sheet = null;
      const fix = !ok && typed ? button("text", "正解にする", "done", () => {
        pending = true;
        setVerdict(sheet, true, "正解にしました");
        fix.closest(".fix-row").remove();
        nextBtn.focus({ preventScroll: true });
      }) : null;
      sheet = openSheet(ok, ok ? "正解！" : close ? "おしい！" : typed ? "ざんねん…" : "答え", [
        !ok && typed ? h("p", { class: "your-answer" }, "あなたの答え: ", h("span", { lang: input.lang }, typed)) : null,
        detail(item),
        fix ? h("p", { class: "fix-row" }, fix, h("span", { class: "muted small" }, "打ちまちがい・同じ意味の言葉のとき")) : null
      ], nextBtn);
      if (!fw) autoSpeak(item.word.w, lang.speech, sheet);
      nextBtn.focus({ preventScroll: true });
      if (ok) autoNext = setTimeout(next, 1100);
    }

    const form = h("form", { class: "write-form", onsubmit: (e) => {
      e.preventDefault();
      if (answered) return;
      const typed = input.value.trim();
      if (!typed) { input.focus(); return; }
      const r = grade(typed, target, { lang: fw ? "ja" : lang.key, reading });
      settle(r.ok, typed, r.close);
    } }, input, submitBtn);

    const q = questionArea(item, qn.dir);
    q.append(form, hintEl, helpers);
    body.append(q, host);
    if (useKb) {
      const kb = createKeyboard({ h, lang: lang.key, input, touch, onEnter: () => form.requestSubmit() });
      body.append(kb.el);
      body.classList.add("has-kbd");
    }
    keyHandler = (e) => {
      if (answered && e.key === "Enter" && !isControl(e)) { e.preventDefault(); next(); }
    };
    input.focus();
  }

  // ---- 単語カード（表は外国語か日本語のどちらか） ----
  function showCard(item) {
    const lang = store.langOf(item.set);
    const fw = Math.random() < 0.5;
    let flipped = false;
    const la = langAttr(lang);
    const back = h("div", { class: "face face-back" },
      h("p", { class: "face-big", lang: fw ? "ja" : la }, fw ? item.word.m : item.word.w),
      !fw && item.word.r ? h("p", { class: "face-reading" }, item.word.r) : null,
      fw ? h("p", { class: "face-sub", lang: la }, item.word.w, item.word.r ? `（${item.word.r}）` : "") : speakButton(item.word.w, lang.speech),
      item.word.ex ? h("p", { class: "face-ex" }, h("span", { lang: la }, item.word.ex), item.word.exm ? h("span", null, item.word.exm) : null) : null);
    const front = h("div", { class: "face face-front" },
      h("span", { class: `lang-badge ${fw ? `lang-${lang.key}` : "lang-ja"}` }, fw ? lang.name : "日本語"),
      h("p", { class: "face-big", lang: fw ? la : "ja" }, fw ? item.word.w : item.word.m),
      fw ? speakButton(item.word.w, lang.speech) : null,
      h("p", { class: "face-tap" }, icon("touch_app"), "タップでめくる"));
    const card = h("div", { class: "flashcard", role: "button", tabindex: "0", "aria-label": "カードをめくる", "aria-pressed": "false" },
      h("div", { class: "flashcard-inner" }, front, back));
    const flipBtn = button("filled", "めくる", "flip", flip, { class: "filled-btn next-btn" });
    const rate = h("div", { class: "rate", hidden: true },
      button("outlined", "まだ", "close", () => { pending = false; next(); }, { class: "outlined-btn rate-ng" }),
      button("filled", "覚えた", "check", () => { pending = true; next(); }, { class: "filled-btn rate-ok" }));
    function flip() {
      flipped = !flipped;
      card.classList.toggle("is-flipped", flipped);
      card.setAttribute("aria-pressed", String(flipped));
      if (flipped) {
        flipBtn.hidden = true;
        rate.hidden = false;
        if (!fw) autoSpeak(item.word.w, lang.speech, back);
      }
    }
    card.addEventListener("click", flip);
    card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
    body.append(h("div", { class: "card-area" }, card), h("div", { class: "a-area" }, flipBtn, rate,
      h("p", { class: "shortcuts" }, h("kbd", null, "Space"), "めくる ", h("kbd", null, "←"), "まだ ", h("kbd", null, "→"), "覚えた")));
    if (fw) autoSpeak(item.word.w, lang.speech, front);
    keyHandler = (e) => {
      if (isTyping(e)) return;
      if ((e.key === " " || e.key === "Enter") && !isControl(e)) { e.preventDefault(); flip(); }
      else if (flipped && (e.key === "ArrowLeft" || e.key === "1")) { pending = false; next(); }
      else if (flipped && (e.key === "ArrowRight" || e.key === "2")) { pending = true; next(); }
    };
  }

  // ---- 結果 ----
  function finish() {
    keyHandler = null;
    if (isTest) { if (classTest) showReview(); else finishTest(); return; }
    // クラスの単語帳の課題なら、進み具合を先生に送る
    const classSets = new Set(cfg.items.map((it) => it.set).filter((x) => x.source === "class"));
    classSets.forEach((x) => reportProgress(x));
    levelEl.replaceChildren();
    barFill.style.width = "100%";
    counter.textContent = "";
    const results = [...firstTry.values()];
    const total = results.length;
    const ok = results.filter((r) => r.ok).length;
    const pct = total ? Math.round((ok / total) * 100) : 0;
    const wrong = results.filter((r) => !r.ok).map((r) => r.item);
    const isCard = mode === "card";
    const message = pct === 100 ? "パーフェクト！" : pct >= 80 ? "よくできました！" : pct >= 50 ? "その調子！" : "くり返せば、きっと覚えられます";
    const again = (list, m = mode) => runSession({ ...cfg, mode: m, items: shuffle(list) });

    body.replaceChildren(h("div", { class: "result" },
      ring(pct / 100, { size: 150, stroke: 12, color: pct >= 80 ? "var(--st-mastered)" : "var(--primary)", label: `${pct}%` }),
      h("h2", null, message),
      h("p", { class: "result-score" }, isCard ? `覚えた ${ok} 語 ・ まだ ${total - ok} 語` : `${total} 語中 ${ok} 語を 1 回目で正解`),
      h("div", { class: "result-actions" },
        wrong.length ? button("filled", isCard ? "「まだ」の単語をもう一度" : "まちがえた単語をもう一度", "replay", () => again(wrong)) : null,
        button(wrong.length ? "tonal" : "filled", "もう一度", "restart_alt", () => again(cfg.items)),
        isCard ? button("outlined", "学習でたしかめる", "play_arrow", () => again(cfg.items, "learn")) : button("outlined", "単語カード", "style", () => again(cfg.items, "card")),
        linkButton("text", "もどる", "arrow_back", cfg.backHref)),
      h("ul", { class: "result-list" }, results.map(({ item, ok: right }) => {
        const lang = store.langOf(item.set);
        const rec = store.progressOf(item.set.id)[item.word.w];
        return h("li", { class: "result-row" },
          h("span", { class: `mark ${right ? "ok" : "ng"}`, "aria-label": right ? "正解" : "まちがい" }, right ? "○" : "×"),
          h("div", { class: "word-pair" },
            h("span", { class: "word-w", lang: langAttr(lang) }, item.word.w),
            h("span", { class: "word-m" }, item.word.m)),
          speakButton(item.word.w, lang.speech),
          wordRing(rec));
      }))));
  }

  // ---- クラスの小テスト: 提出前の確認（全部の答えを見て、直してから送る） ----
  function showReview() {
    keyHandler = null;
    tts.stop();
    levelEl.replaceChildren();
    counter.textContent = "";
    barFill.style.width = "100%";
    const list = h("ol", { class: "test-list review-list" }, queue.map(({ item }, i) => {
      const r = firstTry.get(keyOf(item));
      const lang = store.langOf(item.set);
      const fw = r.qn && r.qn.dir === "fw";
      return h("li", { class: "test-row review-row" },
        h("span", { class: "review-num" }, String(i + 1)),
        h("div", { class: "test-q" },
          h("span", { class: "test-prompt", lang: fw ? langAttr(lang) : "ja" }, fw ? item.word.w : item.word.m),
          h("span", { class: "test-type" }, r.qn && r.qn.type === "write" ? "書き取り" : "4 択"),
          h("span", { class: "review-given" }, "あなたの答え: ", h("strong", null, r.given || "（答えなし）"))),
        button("text", "直す", "edit", () => { editing = i; pos = i; show(); }));
    }));
    const sendBtn = button("filled", "この内容で提出する", "send", async () => {
      sendBtn.disabled = true;
      const results = queue.map(({ item }) => firstTry.get(keyOf(item)));
      endTestMode();
      let sent = false;
      try { sent = cfg.onTestDone ? await cfg.onTestDone(results) : true; } catch (e) { sent = false; }
      body.replaceChildren(h("div", { class: "result" },
        icon(sent ? "task_alt" : "schedule_send", "message-icon"),
        h("h2", null, sent ? "提出しました" : "あとで送ります"),
        h("p", { class: "result-score" }, sent ? "結果は、先生が返却すると見られます。" : "送れなかったので、この端末に残しました。次にこの課題を開いたときに送り直します。"),
        h("div", { class: "result-actions" }, linkButton("filled", "もどる", "arrow_back", cfg.backHref))));
    });
    body.replaceChildren(h("div", { class: "result review" },
      h("p", { class: "test-pill big" }, "提出前の確認"),
      h("h2", null, "答えを確かめましょう"),
      h("p", { class: "result-score" }, `${queue.length} 問。提出すると、あとから変えられません。`),
      list,
      h("div", { class: "result-actions" }, sendBtn)));
    window.scrollTo(0, 0);
  }

  // ---- 小テストの結果 ----
  function finishTest() {
    levelEl.replaceChildren();
    barFill.style.width = "100%";
    counter.textContent = "";
    const results = [...firstTry.values()];
    const total = results.length;
    const ok = results.filter((r) => r.ok).length;
    const pct = total ? Math.round((ok / total) * 100) : 0;
    const wrong = results.filter((r) => !r.ok).map((r) => r.item);
    const setIds = new Set(results.map((r) => r.item.set.id));
    if (setIds.size === 1) store.recordTest([...setIds][0], ok, total);
    if (cfg.onTestDone) cfg.onTestDone(results);
    const message = pct === 100 ? "満点！" : pct >= 80 ? "合格ライン！" : pct >= 50 ? "あと少し" : "学習してから、もう一度";
    body.replaceChildren(h("div", { class: "result" },
      h("p", { class: "test-pill big" }, "小テストの結果"),
      ring(pct / 100, { size: 150, stroke: 12, color: pct >= 80 ? "var(--st-mastered)" : "var(--primary)", label: `${ok}/${total}` }),
      h("h2", null, `${pct} 点`),
      h("p", { class: "result-score" }, message),
      h("div", { class: "result-actions" },
        wrong.length ? button("filled", "まちがえた単語を学習する", "school", () => runSession({ ...cfg, mode: "learn", items: shuffle(wrong) })) : null,
        button(wrong.length ? "tonal" : "filled", "もう一度テスト", "restart_alt", () => runSession({ ...cfg, items: shuffle(cfg.items) })),
        linkButton("text", "もどる", "arrow_back", cfg.backHref)),
      h("ol", { class: "test-list" }, results.map(({ item, ok: right, qn, given: g }) => {
        const lang = store.langOf(item.set);
        const fw = qn && qn.dir === "fw";
        const correct = qn && qn.answer === NONE ? "この中にはない" : qn ? qn.answer : item.word.w;
        return h("li", { class: `test-row ${right ? "ok" : "ng"}` },
          h("span", { class: `mark ${right ? "ok" : "ng"}`, "aria-label": right ? "正解" : "まちがい" }, right ? "○" : "×"),
          h("div", { class: "test-q" },
            h("span", { class: "test-prompt", lang: fw ? langAttr(lang) : "ja" }, fw ? item.word.w : item.word.m),
            h("span", { class: "test-type" }, qn && qn.type === "write" ? "書き取り" : "4 択"),
            right ? null : h("span", { class: "test-given" }, "あなた: ", h("s", null, g || "（答えなし）")),
            h("span", { class: "test-correct" }, "正解: ", h("strong", { lang: fw ? "ja" : langAttr(lang) }, correct))),
          speakButton(item.word.w, lang.speech));
      }))));
  }

  show();
}

// ---------- マイ単語帳を作る・直す ----------

function textField(label, input, note) {
  return h("label", { class: "field" }, h("span", { class: "field-label" }, label), input, note ? h("span", { class: "field-note" }, note) : null);
}

function renderEdit(id) {
  const editing = id && id !== "new" ? store.getMySets().find((s) => s.id === id) : null;
  if (id !== "new" && !editing) {
    renderMessage("単語帳が見つかりません", "編集できるのは、マイ単語帳だけです。");
    return;
  }
  document.title = `${editing ? "単語帳を編集" : "単語帳を作る"} - SK Study`;
  const L = store.LIMITS;
  let dirty = false;
  const rows = (editing ? editing.words : [{}, {}, {}]).map((w) => ({ w: w.w || "", m: w.m || "", r: w.r || "", ex: w.ex || "", exm: w.exm || "" }));

  const title = h("input", { type: "text", class: "field-input", maxlength: String(L.title), value: editing ? editing.title : "", placeholder: "例: 英語 期末テスト範囲" });
  const langSel = h("select", { class: "field-select" },
    Object.entries(store.LANGS).map(([key, l]) => h("option", { value: key, selected: (editing ? editing.lang : "en") === key }, l.name)));
  const langName = h("input", { type: "text", class: "field-input", maxlength: String(L.langName), value: editing && editing.langName || "", placeholder: "例: フランス語・漢字・理科" });
  const speechSel = h("select", { class: "field-select" },
    store.SPEECH_CHOICES.map(([v, label]) => h("option", { value: v, selected: (editing && editing.speech || "") === v }, label)));
  const customRow = h("div", { class: "field-row" }, textField("言語・教科の名前", langName), textField("読み上げ", speechSel));
  const desc = h("textarea", { class: "field-input", rows: "2", maxlength: String(L.description), placeholder: "どんな単語帳か（任意）" }, editing && editing.description || "");

  const rowsEl = h("ol", { class: "edit-rows" });
  const countEl = h("span", { class: "muted small" });

  function readingLabel() { return (store.LANGS[langSel.value] || store.LANGS.custom).reading; }
  function wordLabel() { return langSel.value === "custom" ? "問題（単語）" : `${store.LANGS[langSel.value].name}の単語`; }

  function drawRows() {
    rowsEl.replaceChildren(...rows.map((row, i) => {
      const inp = (k, ph, max, la) => {
        const el = h("input", { type: "text", class: "field-input", value: row[k], placeholder: ph, maxlength: String(max), "aria-label": `${i + 1} 行目の${ph}`, lang: la });
        el.addEventListener("input", () => { row[k] = el.value; dirty = true; updateCount(); });
        return el;
      };
      const la = langSel.value === "en" ? "en" : langSel.value === "ko" ? "ko" : langSel.value === "zh" ? "zh-CN" : null;
      const extra = h("div", { class: "edit-extra", hidden: !(row.ex || row.exm) },
        inp("ex", "例文（任意）", L.ex, la), inp("exm", "例文の訳（任意）", L.ex, "ja"));
      return h("li", { class: "edit-row" },
        h("span", { class: "edit-num" }, String(i + 1)),
        h("div", { class: "edit-fields" },
          inp("w", wordLabel(), L.w, la), inp("m", "意味（答え）", L.m, "ja"), inp("r", readingLabel(), L.r, null), extra),
        h("div", { class: "edit-tools" },
          h("button", { type: "button", class: "icon-btn", "aria-label": "例文", title: "例文", onclick: () => { extra.hidden = !extra.hidden; } }, icon("notes")),
          h("button", { type: "button", class: "icon-btn", "aria-label": `${i + 1} 行目を消す`, title: "この行を消す", onclick: () => { rows.splice(i, 1); dirty = true; drawRows(); } }, icon("delete"))));
    }));
    updateCount();
  }
  function updateCount() {
    const n = rows.filter((r) => r.w.trim() && r.m.trim()).length;
    countEl.textContent = `${n} 語`;
  }
  function addRows(list) {
    // 空の行しかないときは置きかえる
    if (rows.every((r) => !r.w.trim() && !r.m.trim())) rows.length = 0;
    rows.push(...list);
    dirty = true;
    drawRows();
  }

  langSel.addEventListener("change", () => { customRow.hidden = langSel.value !== "custom"; dirty = true; drawRows(); });
  customRow.hidden = langSel.value !== "custom";
  for (const el of [title, langName, speechSel, desc]) el.addEventListener("input", () => { dirty = true; });

  const paste = h("textarea", { class: "field-input", rows: "5", placeholder: "apple\tりんご\nbanana\tバナナ" });
  const pasteBox = h("details", { class: "paste" },
    h("summary", null, icon("content_paste"), "まとめて貼りつけ"),
    h("p", { class: "muted small" }, "1 行に 1 語。「単語」「意味」「読み」「例文」「例文の訳」の順に、タブかカンマで区切ります。Excel・Google スプレッドシートの列をそのままコピーして貼りつけられます。"),
    paste,
    button("tonal", "取りこむ", "download", () => {
      const list = paste.value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
        const cols = (l.includes("\t") ? l.split("\t") : l.split(/\s*[,，]\s*/)).map((c) => c.trim());
        return { w: cols[0] || "", m: cols[1] || "", r: cols[2] || "", ex: cols[3] || "", exm: cols[4] || "" };
      }).filter((r) => r.w || r.m);
      if (!list.length) { toast("取りこめる行がありません"); return; }
      addRows(list);
      paste.value = "";
      pasteBox.open = false;
      toast(`${list.length} 行を取りこみました`);
    }));

  const errorEl = h("p", { class: "form-error", role: "alert", hidden: true });

  function save() {
    const showError = (msg) => { errorEl.textContent = msg; errorEl.hidden = false; errorEl.scrollIntoView({ block: "center", behavior: "smooth" }); };
    errorEl.hidden = true;
    if (!title.value.trim()) { showError("タイトルを入れてください"); title.focus(); return; }
    if (langSel.value === "custom" && !langName.value.trim()) { showError("言語・教科の名前を入れてください"); langName.focus(); return; }
    const filled = rows.map((r, i) => ({ ...r, line: i + 1 })).filter((r) => r.w.trim() || r.m.trim());
    const half = filled.find((r) => !r.w.trim() || !r.m.trim());
    if (half) { showError(`${half.line} 行目: 単語と意味の両方を入れてください`); return; }
    if (!filled.length) { showError("単語を 1 つ以上入れてください"); return; }
    if (filled.length > L.words) { showError(`単語は ${L.words} 語までです`); return; }
    const seen = new Map();
    for (const r of filled) {
      const k = r.w.trim().replace(/\s+/g, " ");
      if (seen.has(k)) { showError(`「${k}」が 2 回あります（${seen.get(k)} 行目と ${r.line} 行目）`); return; }
      seen.set(k, r.line);
    }
    try {
      const saved = store.saveMySet({
        title: title.value, lang: langSel.value, langName: langName.value, speech: speechSel.value, description: desc.value,
        words: filled
      }, editing ? editing.id : null);
      dirty = false;
      toast("保存しました");
      go(`/set/${encodeURIComponent(saved.id)}`, true);
    } catch (e) {
      showError(e.message);
    }
  }

  const cancelHref = editing ? `#/set/${encodeURIComponent(editing.id)}` : "#/mine";
  const cancel = h("a", { class: "back-link", href: cancelHref, onclick: async (e) => {
    if (!dirty) return;
    e.preventDefault();
    if (await confirmDialog("編集をやめますか？", "保存していない変更は消えます。", "変更を捨てる", true)) { dirty = false; location.hash = cancelHref.slice(1); }
  } }, icon("close"), h("span", null, "やめる"));

  drawRows();
  app.append(
    h("div", { class: "edit-bar" }, cancel, button("filled", "保存", "save", save)),
    h("h1", { class: "edit-title" }, editing ? "単語帳を編集" : "単語帳を作る"),
    errorEl,
    h("section", { class: "edit-card" },
      textField("タイトル", title),
      h("div", { class: "field-row" }, textField("言語", langSel)),
      customRow,
      textField("説明", desc)),
    h("section", { class: "edit-card" },
      h("div", { class: "section-head" }, h("h2", null, "単語"), countEl),
      pasteBox,
      rowsEl,
      button("tonal", "行を足す", "add", () => {
        rows.push({ w: "", m: "", r: "", ex: "", exm: "" });
        drawRows();
        const inputs = rowsEl.lastElementChild.querySelectorAll("input");
        if (inputs[0]) inputs[0].focus();
      }, { class: "tonal-btn wide" })),
    h("div", { class: "edit-bottom" }, button("filled", "保存", "save", save)));
  if (!editing) title.focus();

  const onBeforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("hashchange", () => window.removeEventListener("beforeunload", onBeforeUnload), { once: true });
}

// ---------- 共有リンクで受け取る ----------

async function renderImport(code) {
  document.title = "共有された単語帳 - SK Study";
  app.append(h("p", { class: "loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), "読み込み中…"));
  let data;
  try {
    data = store.cleanSet(await decodeSet(code));
    if (!data.words.length) throw new Error("empty");
  } catch (e) {
    renderMessage("単語帳を開けませんでした", e && e.message === "unsupported"
      ? "このブラウザでは開けません。新しいブラウザで開いてください。"
      : "リンクがまちがっているか、途中で切れているかもしれません。もう一度コピーしてもらってください。");
    return;
  }
  const lang = store.langOf(data);
  const la = langAttr(lang);
  const shown = data.words.slice(0, 12);
  app.replaceChildren(
    h("section", { class: "import" },
      h("p", { class: "import-label" }, icon("move_to_inbox"), "共有された単語帳"),
      h("div", { class: "set-head" }, thumb(lang), h("div", null,
        h("p", { class: "set-row-sub" }, langBadge(lang), h("span", null, `${data.words.length} 語`)),
        h("h1", null, data.title),
        data.description ? h("p", { class: "set-desc" }, data.description) : null)),
      h("ol", { class: "word-list" }, shown.map((w) => h("li", { class: "word-row" },
        h("div", { class: "word-pair" },
          h("div", { class: "word-line" }, h("span", { class: `word-tag lang-${lang.key}` }, lang.name),
            h("span", { class: "word-text" }, h("span", { class: "word-w", lang: la }, w.w), w.r ? h("span", { class: "word-r" }, w.r) : null)),
          h("div", { class: "word-line" }, h("span", { class: "word-tag lang-ja" }, "日本語"), h("span", { class: "word-text" }, h("span", { class: "word-m" }, w.m))))))),
      data.words.length > shown.length ? h("p", { class: "muted small" }, `ほか ${data.words.length - shown.length} 語`) : null,
      h("p", { class: "muted small" }, "マイ単語帳にコピーして追加します。追加したあとは自由に編集できます（共有した人には伝わりません）。"),
      h("div", { class: "result-actions" },
        button("filled", "マイ単語帳に追加", "library_add", () => {
          try {
            const saved = store.saveMySet({ ...data, source: "shared", from: data.title });
            toast("マイ単語帳に追加しました");
            go(`/set/${encodeURIComponent(saved.id)}`, true);
          } catch (e) {
            toast(e.message);
          }
        }),
        button("text", "追加しない", null, () => go("/", true)))));
}

// ---------- プリント（print.js）に渡す部品 ----------

const printUi = {
  h, icon, button, linkButton, toast, openDialog, confirmDialog, go, ring, app,
  message: renderMessage,
  setKeys: (fn) => { keyHandler = fn; },
  backLink, shuffle, runSession: (cfg) => runSession(cfg)
};

// ---------- はじめ ----------

document.addEventListener("keydown", (e) => {
  if (!keyHandler || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
  if (document.querySelector("dialog[open]")) return;
  keyHandler(e);
});

const speechBtn = document.getElementById("speech-settings");
if (speechBtn) speechBtn.addEventListener("click", openSpeechSettings);

// 押したところから広がるインクの波紋（MD1）
const RIPPLE = ".drawer-item, .tile, .set-card-main, .fab, .filled-btn, .tonal-btn, .outlined-btn, .text-btn, .danger-btn, .pill-btn, .icon-btn, .chip, .choice, .set-row, .segmented button, .print-tabs button, .pa-opt, .map-cell, .tc-mark, .mk-roles button";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
document.addEventListener("pointerdown", (e) => {
  const target = e.target.closest && e.target.closest(RIPPLE);
  if (!target || target.disabled || reducedMotion.matches) return;
  const r = target.getBoundingClientRect();
  const size = Math.hypot(r.width, r.height) * 2;
  const dot = h("span", { class: "ripple" });
  Object.assign(dot.style, { width: `${size}px`, height: `${size}px`, left: `${e.clientX - r.left - size / 2}px`, top: `${e.clientY - r.top - size / 2}px` });
  target.append(dot);
  dot.addEventListener("animationend", () => dot.remove());
});


// ホーム画面に追加（PWA。オフラインでも開けるように sw.js を入れる）
const INSTALL_KEY = "sk_study_install_dismissed";
const installBanner = document.getElementById("install-banner");
let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  let dismissed = false;
  try { dismissed = localStorage.getItem(INSTALL_KEY) === "1"; } catch {}
  if (!dismissed) installBanner.hidden = false;
});
document.getElementById("install-button").addEventListener("click", () => {
  installBanner.hidden = true;
  if (installEvent) installEvent.prompt();
  installEvent = null;
});
document.getElementById("install-dismiss").addEventListener("click", () => {
  installBanner.hidden = true;
  try { localStorage.setItem(INSTALL_KEY, "1"); } catch {}
});
window.addEventListener("appinstalled", () => { installBanner.hidden = true; });
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

(async () => {
  renderGate(null); // ログインを確かめているあいだ
  const [, s] = await Promise.all([
    store.loadSkSets().catch((e) => { console.error(e); toast("SK認定コンテンツを読み込めませんでした"); }),
    cloud.session().catch((e) => { console.error(e); return { status: "offline" }; })
  ]);
  auth = s;
  await refreshCtx();
  records.switchTo(ctxInfo ? ctxInfo.cid : "");
  drawDrawer();
  window.addEventListener("hashchange", route);
  route();
  records.sync().then((changed) => { if (changed) route(); }); // オンラインの記録を合わせる
})();
