// SK Study — 単語学習
//   画面は # のあとの場所で切りかえる（ページを読み込み直さない）
//     #/                 ホーム（今日の復習・続きから・SK の単語セット・マイ単語帳）
//     #/set/<ID>         単語セット（記憶度・学習の始め方・単語の一覧）
//     #/learn/<ID>?mode= 学習（learn = おまかせ学習 / card = 単語カード / test = 小テスト）。ID が review なら今日の復習
//       小テスト … 決まった数を、答え合わせなしで続けて解き、最後にまとめて採点する（まちがえても出し直さない）。点数は store.js に残す
//     #/edit/<ID|new>    マイ単語帳を作る・直す
//     #/import/<コード>   共有リンクで受け取った単語帳（share.js）
//     #/print/<ID>       プリントに答える（print.js）
//     #/maker            PDF からプリントを作る（maker.js）
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
import { grade, hint } from "./grade.js";
import { decodeSet, encodeSet, extractCode, shareUrl } from "./share.js";
import * as tts from "./speech.js";
import { printSection, renderPrint } from "./print.js";
import { renderMaker } from "./maker.js";

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
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800);
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

function openSpeechSettings() {
  if (!tts.supported) {
    const d0 = openDialog("読み上げ", h("p", null, "このブラウザは読み上げに対応していません。"), [button("filled", "閉じる", null, () => d0.close())]);
    return;
  }
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
      const best = list[0];
      if (!list.length) {
        return h("div", { class: "voice-row" }, h("span", { class: "voice-name" }, name),
          h("p", { class: "muted small" }, icon("info"), `この端末には${name}の声がありません。端末の設定で追加できます。`));
      }
      const sel = h("select", { class: "field-select", "aria-label": `${name}の声`, onchange: (e) => {
        const voicesSaved = { ...tts.getSettings().voices };
        if (e.target.value) voicesSaved[lang] = e.target.value; else delete voicesSaved[lang];
        tts.saveSettings({ voices: voicesSaved });
        tts.speak(sample, lang);
      } },
      h("option", { value: "" }, `おまかせ（${best.name}）`),
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
  const d = openDialog("読み上げの設定", body, [button("filled", "閉じる", null, () => d.close())]);
  d.addEventListener("close", () => { stopWatch(); tts.stop(); });
}

// ---------- ダイアログ ----------

function openDialog(title, body, actions) {
  const d = h("dialog", { class: "dialog" }, h("h2", null, title), body, h("div", { class: "dialog-actions" }, actions));
  document.body.append(d);
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

function route() {
  keyHandler = null;
  tts.stop();
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean).map((p) => { try { return decodeURIComponent(p); } catch (e) { return p; } });
  const q = new URLSearchParams(qs);
  const [view, id] = parts;
  document.body.dataset.view = view || "home";
  app.replaceChildren();
  window.scrollTo(0, 0);
  try {
    if (!view) renderHome();
    else if (view === "set") renderSet(id);
    else if (view === "learn") renderLearn(id, q);
    else if (view === "edit") renderEdit(id);
    else if (view === "import") renderImport(parts.slice(1).join("/"));
    else if (view === "print") renderPrint(id, printUi).catch((e) => { console.error(e); renderMessage("うまく表示できませんでした", String(e && e.message || e)); });
    else if (view === "maker") renderMaker(printUi);
    else renderMessage("ページが見つかりません", "リンクがまちがっているかもしれません。");
  } catch (e) {
    console.error(e);
    renderMessage("うまく表示できませんでした", String(e && e.message || e));
  }
  app.focus({ preventScroll: true });
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

function renderHome() {
  document.title = "SK Study";
  const prefs = store.getPrefs();
  const due = store.dueItems();
  const o = store.overall();

  const today = h("section", { class: "today" },
    h("div", { class: "today-main" },
      h("p", { class: "today-label" }, "今日の復習"),
      h("p", { class: "today-count" }, String(due.length), h("small", null, "語")),
      h("p", { class: "today-sub" },
        due.length ? "忘れかけたころに復習すると、記憶に残ります。"
          : o.learned ? "今日の復習はおわりました。新しい単語に進みましょう。"
            : "単語セットを選んで、学習をはじめましょう。")),
    due.length ? button("filled", "復習する", "play_arrow", () => go("/learn/review?mode=learn"), { class: "filled-btn today-start" }) : null,
    h("div", { class: "today-stats" },
      h("div", null, h("strong", null, String(o.streak)), h("span", null, "日 連続")),
      h("div", null, h("strong", null, String(o.mastered)), h("span", null, "語 記憶済み")),
      h("div", null, h("strong", null, String(o.today)), h("span", null, "問 今日答えた"))));

  // 続きから（答えたことのあるセット。復習の多い順）
  const started = store.allSets()
    .map((set) => ({ set, s: store.setStats(set) }))
    .filter(({ s }) => s.started > 0)
    .sort((a, b) => b.s.due - a.s.due || a.s.memory - b.s.memory);

  // SK の単語セット
  const filters = [["all", "すべて"], ["en", "英語"], ["ko", "韓国語"], ["zh", "中国語"]];
  const list = h("div", { class: "set-list" });
  const chips = h("div", { class: "chips", role: "group", "aria-label": "言語でしぼりこむ" });
  function drawSk(filter) {
    chips.replaceChildren(...filters.map(([key, label]) => h("button", {
      type: "button", class: "chip", "aria-pressed": String(filter === key),
      onclick: () => { store.setPrefs({ filter: key }); drawSk(key); }
    }, filter === key ? icon("check") : null, label)));
    const sets = store.getSkSets().filter((s) => filter === "all" || s.lang === filter);
    list.replaceChildren(...(sets.length ? sets.map((s) => setRow(s)) : [h("p", { class: "empty" }, "この言語のセットはまだありません。")]));
  }
  drawSk(prefs.filter);

  const mine = store.getMySets().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  app.append(
    today,
    started.length ? h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, "続きから")),
      h("div", { class: "set-list" }, started.slice(0, 4).map(({ set }) => setRow(set, { start: true })))) : null,
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, "SK の単語セット")),
      chips, list),
    h("section", { class: "section" },
      h("div", { class: "section-head" },
        h("h2", null, "マイ単語帳"),
        h("div", { class: "section-actions" },
          button("text", "リンクから追加", "link", openImportDialog),
          linkButton("tonal", "新しく作る", "add", "#/edit/new"))),
      mine.length ? h("div", { class: "set-list" }, mine.map((s) => setRow(s)))
        : h("div", { class: "empty-card" },
          icon("library_add", "empty-icon"),
          h("p", null, "自分の単語帳を作れます。テストに出る言葉、好きな言語、漢字や理科の用語など、なんでも。"),
          h("p", { class: "muted" }, "作った単語帳は、リンクで友だちに共有できます。"))),
    printSection(printUi),
    h("p", { class: "footnote" }, "学習の記録・マイ単語帳・プリントは、いまはこのブラウザの中だけに保存されます。"));
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
  if (set.source === "sk") return "SK の単語セット";
  if (set.source === "shared") return `共有リンクから追加${set.from && set.from !== set.title ? `（もとの名前: ${set.from}）` : ""}`;
  if (set.source === "copy") return `SK の「${set.from || ""}」をコピー`;
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

  const mine = set.source !== "sk";
  const actions = h("div", { class: "set-actions" },
    mine ? linkButton("outlined", "編集", "edit", `#/edit/${encodeURIComponent(set.id)}`) : null,
    button("outlined", "共有", "share", () => openShare(set)),
    !mine ? button("outlined", "自分用にコピー", "content_copy", () => {
      const copy = store.copySet(set);
      toast("マイ単語帳にコピーしました。自由に編集できます");
      go(`/set/${encodeURIComponent(copy.id)}`);
    }) : null,
    mine ? button("outlined", "削除", "delete", async () => {
      if (await confirmDialog("この単語帳を削除しますか？", `「${set.title}」と、その学習の記録を消します。もとに戻せません。`, "削除する", true)) {
        store.deleteMySet(set.id);
        toast("削除しました");
        go("/", true);
      }
    }, { "data-danger": "" }) : null);

  // 単語の一覧（上が外国語、下が日本語。右は記憶度の輪）
  const p = store.progressOf(set.id);
  const list = h("ol", { class: "word-list" }, set.words.map((w) => {
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

  app.append(
    backLink("ホーム", "#/"),
    h("section", { class: "set-head" },
      thumb(lang),
      h("div", null,
        h("p", { class: "set-row-sub" }, langBadge(lang), set.level ? h("span", null, set.level) : null),
        h("h1", null, set.title),
        set.description ? h("p", { class: "set-desc" }, set.description) : null,
        h("p", { class: "muted small" }, icon(set.source === "sk" ? "verified" : "person"), sourceText(set)))),
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
    ? [h("p", null, "SK の単語セットのページへのリンクです。")]
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
function makeQuestion(item, format, retry) {
  const tier = retry ? 1 : tierOf(item);
  let dir = Math.random() < 0.5 ? "fw" : "bw";
  let type;
  if (format === "choice") type = "choice";
  else if (format === "write") type = "write";
  else type = tier === 3 && Math.random() < 0.7 ? "write" : "choice";
  if (format === "auto" && type === "write" && Math.random() < 0.75) dir = "bw"; // 書き取りは外国語を答えるほうを多めに
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

function runSession(cfg) {
  const { mode } = cfg;
  const isTest = mode === "test";
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
    judge.className = "judge";
    if (pending !== null) {
      const { item, retry } = queue[pos];
      store.recordAnswer(item.set.id, item.word.w, pending);
      if (!firstTry.has(keyOf(item))) firstTry.set(keyOf(item), { item, ok: pending, qn: curQn, given });
      // まちがえたら、少しあとにもう一度（学習のときだけ）
      if (!pending && mode === "learn" && retry < RETRY_MAX) {
        queue.splice(Math.min(pos + 1 + RETRY_GAP, queue.length), 0, { item, retry: retry + 1 });
      }
      pending = null;
    }
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
    const qn = makeQuestion(item, cfg.format, retry > 0);
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
    const feedback = h("div", { class: "feedback", "aria-live": "polite" });
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
      feedback.replaceChildren(
        h("p", { class: ok ? "verdict ok" : "verdict ng" }, ok ? "正解！" : qn.answer === NONE ? "正解は「この中にはない」でした" : "ざんねん…"),
        detail(item));
      if (qn.dir === "bw") autoSpeak(item.word.w, lang.speech, feedback);
      nextBtn.hidden = false;
      nextBtn.focus({ preventScroll: true });
      if (ok) autoNext = setTimeout(next, 1100);
    }
    body.append(questionArea(item, qn.dir),
      h("div", { class: "a-area" }, h("div", { class: "choices" }, optionEls), feedback, nextBtn));
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
      lang: fw ? "ja" : langAttr(lang), "aria-label": "答え",
      placeholder: fw ? "日本語で答える" : reading ? `${lang.name}で（ピンインでも OK）` : `${lang.name}で答える`
    });
    const hintEl = h("p", { class: "hint", hidden: true });
    const feedback = h("div", { class: "feedback", "aria-live": "polite" });
    const submitBtn = h("button", { type: "submit", class: "filled-btn" }, h("span", null, "確定"));
    const helpers = h("div", { class: "write-helpers" },
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
      const fix = !ok && typed ? button("text", "正解にする", "done", () => {
        pending = true;
        verdict.textContent = "正解にしました";
        verdict.className = "verdict ok";
        fix.remove();
        nextBtn.focus({ preventScroll: true });
      }) : null;
      const verdict = h("p", { class: ok ? "verdict ok" : "verdict ng" },
        ok ? "正解！" : close ? "おしい！" : typed ? "ざんねん…" : "答え");
      feedback.replaceChildren(...[
        verdict,
        !ok && typed ? h("p", { class: "your-answer" }, "あなたの答え: ", h("span", { lang: input.lang }, typed)) : null,
        detail(item),
        fix ? h("p", { class: "fix-row" }, fix, h("span", { class: "muted small" }, "打ちまちがい・同じ意味の言葉のとき")) : null
      ].filter(Boolean));
      if (!fw) autoSpeak(item.word.w, lang.speech, feedback);
      nextBtn.hidden = false;
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
    body.append(q, h("div", { class: "a-area" }, feedback, nextBtn));
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
    if (isTest) { finishTest(); return; }
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

  const cancelHref = editing ? `#/set/${encodeURIComponent(editing.id)}` : "#/";
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
  setKeys: (fn) => { keyHandler = fn; }
};

// ---------- はじめ ----------

document.addEventListener("keydown", (e) => {
  if (!keyHandler || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
  if (document.querySelector("dialog[open]")) return;
  keyHandler(e);
});

const speechBtn = document.getElementById("speech-settings");
if (speechBtn) speechBtn.addEventListener("click", openSpeechSettings);

(async () => {
  try {
    await store.loadSkSets();
  } catch (e) {
    console.error(e);
    toast("SK の単語セットを読み込めませんでした");
  }
  window.addEventListener("hashchange", route);
  route();
})();
