// SK Study のプリント（HTML のプリントに答えて、自動で採点する）
//   ・プリントは HTML ファイルを読みこむ（このブラウザの中だけに保存。サーバーには送らない）
//       一覧 sk_study_prints = [{ id, title, addedAt, blanks, exam, minutes }]（localStorage）
//       中身 IndexedDB の sk-study / prints（ページの画像が入ると大きいので）。答えと採点 sk_study_print_state_<ID>（localStorage）
//   ・見つけ方（試験対策プリントの形。parsePrint()）
//       ページ … .page。.ans か .ka があるページは解答のページ（隠して、採点に使う）
//       作品 … .title h1、節 … .sec（◆漢字と語句の確認◆ など）。問題の番号（.qn）は作品・節ごとに振り直し
//       解答欄 … .box（四角）・.lines（記述の罫線）・.ksp（漢字の（　））。.title の中（年・組・番・氏名）は除く
//       解答 … 同じ作品・節・番号の .ans の .a。「①存在　②発見」は丸数字で分け、解答欄の data-n（①…）か順番に合わせる。
//              丸数字がなければ改行で分ける。漢字は .ka を順番に。「（⑪⑫順不同）」「（12字）」も読む。解説は .ex
//   ・採点
//       記号（答えがア〜コの 1 文字）… ボタンで選ぶ。自動で採点
//       四角・漢字 … 自動で採点（全角半角・空白・かぎかっこ・句読点・カタカナとひらがなの違いは見ない。かっこの中は別解）
//       記述（.lines）… 模範解答と同じなら正解、ちがえば模範解答を見て本人が ○・△・× をつける
//   ・変換ツール（maker.js・printfmt.js）で作ったプリントは、解答欄に data-type（auto/choice/self）と data-options がある
//     試験用（<script id="sk-print-data"> の mode: "exam"）は、解答のページがなく、答えは暗号化されている
//       全画面でないと問題が見えない。全画面をやめた・ほかのタブやアプリに移った・読み込み直したことを記録する
//       制限時間（時間が来たら自動で提出）。提出は 1 回だけ。提出したあと、答えを開いて採点（合言葉があれば合言葉を入れてから）
//       ブラウザの中だけで動くので、完全には防げない（ファイルを書きかえる・ほかの端末を見るなど）。書きかえは暗号の中身と比べて見つける
//   ・クラスの課題（cloud.js）として配られたプリントは、一覧の classRef にクラスと課題の ID が入る。
//     「提出する」で答え（と試験の記録）を先生に送る。提出は 1 回だけ。先生が結果を公開したら、先生の採点と答え（合言葉）が届く
//   ・プリントの HTML は人が作ったものなので、そのままこのページに入れない
//       右の問題文 … 決まったタグ・クラスだけを作り直す（safe()）
//       左のプリント … スクリプトを動かさない iframe（sandbox）。外のファイルは CSP で止める
import { openAnswers, readPrintMeta } from "./printfmt.js";
import * as cloud from "./cloud.js";

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟";
const CIRCLED_RE = "[①-⑳㉑-㉟]";
const CHOICES = "アイウエオカキクケコ";
const LIST_KEY = "sk_study_prints";
const htmlKey = (id) => `sk_study_print_${id}`;
const stateKey = (id) => `sk_study_print_state_${id}`;
const MAX_FILE = 2 * 1024 * 1024;

// replaceChildren・append は null を「null」という文字にしてしまうので、null を除いて入れる
const present = (kids) => kids.flat(Infinity).filter((k) => k != null && k !== false);
const put = (el, ...kids) => el.replaceChildren(...present(kids));
const add = (el, ...kids) => el.append(...present(kids));

const txt = (el) => (el ? el.textContent.replace(/\s+/g, " ").trim() : "");

function readJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key) || "null"); return v == null ? fallback : v; } catch (e) { return fallback; }
}
function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
}

// ---------- 保存 ----------

export const listPrints = () => readJSON(LIST_KEY, []);

let dbPromise = null;
function idb(mode, fn) {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open("sk-study", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("prints");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise.then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction("prints", mode);
    const req = fn(tx.objectStore("prints"));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}
export async function getHtml(id) {
  const v = await idb("readonly", (s) => s.get(id)).catch(() => null);
  if (v) return v;
  try { return localStorage.getItem(htmlKey(id)); } catch (e) { return null; } // 前の版（localStorage に入れていた）
}

// プリントを保存する（変換ツールからも使う）。戻り値は ID
export async function addPrint(html, title) {
  const parsed = parsePrint(html);
  const s = stats(parsed);
  if (!s.total) throw new Error("解答欄が見つかりませんでした");
  const id = "pr-" + [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, "0")).join("");
  try { await idb("readwrite", (st) => st.put(html, id)); } catch (e) { throw new Error("保存できませんでした（ブラウザの保存容量がいっぱいかもしれません）"); }
  const list = listPrints();
  list.unshift({ id, title: String(title || parsed.title).slice(0, 80), addedAt: Date.now(), blanks: s.total, exam: parsed.exam, minutes: parsed.exam ? parsed.meta.minutes || 0 : 0 });
  writeJSON(LIST_KEY, list);
  return id;
}

// クラスで配られたプリントを、この端末に入れる（同じ課題なら入れ直す）
export async function saveClassPrint(id, html, title, classRef) {
  const parsed = parsePrint(html);
  await idb("readwrite", (st) => st.put(html, id));
  const list = listPrints().filter((p) => p.id !== id);
  list.unshift({ id, title: String(title).slice(0, 80), addedAt: Date.now(), blanks: parsed.blanks.length, exam: parsed.exam, minutes: parsed.exam ? parsed.meta.minutes || 0 : 0, classRef });
  writeJSON(LIST_KEY, list);
}

async function deletePrint(id) {
  writeJSON(LIST_KEY, listPrints().filter((p) => p.id !== id));
  await idb("readwrite", (s) => s.delete(id)).catch(() => {});
  try { localStorage.removeItem(htmlKey(id)); localStorage.removeItem(stateKey(id)); } catch (e) { /* 消せなくても一覧からは消える */ }
}

function loadState(id) {
  return { answers: {}, marks: {}, manual: {}, graded: false, instant: false, history: [], cur: 0, ...readJSON(stateKey(id), {}) };
}

// ---------- 読み取り ----------

export function parsePrint(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const meta = readPrintMeta(doc);
  const exam = !!(meta && meta.mode === "exam" && meta.sealed);
  doc.querySelectorAll("script, iframe, object, embed, base, meta[http-equiv]").forEach((e) => e.remove());
  const title = txt(doc.querySelector("title")) || txt(doc.querySelector("h1")) || "プリント";
  let pages = [...doc.querySelectorAll(".page")];
  if (!pages.length) pages = [doc.body];

  const groups = [];
  const answers = new Map();
  const keyOf = (a, s, q) => `${a}\n${s}\n${q}`;
  let article = "", section = "", lastQ = null, lastA = null;

  pages.forEach((page) => {
    const answerPage = !!page.querySelector(".ans, .ka");
    page.setAttribute("data-sk-answer", answerPage ? "1" : "0");
    for (const el of page.querySelectorAll(".title h1, .sec, .q, .kj, .ans")) {
      if (el.matches("h1")) { article = txt(el); section = ""; continue; }
      if (el.matches(".sec")) { section = txt(el).replace(/^◆|◆$/g, ""); continue; }
      if (answerPage) {
        if (el.matches(".ans")) {
          const qn = txt(el.querySelector(".qn"));
          const ex = [...el.querySelectorAll(".ex")].map(txt).filter(Boolean);
          if (qn || el.querySelector(".a")) {
            lastA = { a: el.querySelector(".a"), ex, ka: null };
            answers.set(keyOf(article, section, qn), lastA);
          } else if (lastA) {
            lastA.ex.push(...ex);
          }
        } else if (el.matches(".kj") && lastA) {
          lastA.ka = [...el.querySelectorAll(".ka")].map(txt);
        }
        continue;
      }
      if (el.matches(".q")) {
        const qn = txt(el.querySelector(".qn"));
        if (!qn && lastQ && lastQ.article === article && lastQ.section === section) lastQ.els.push(el);
        else { lastQ = { article, section, qn, key: keyOf(article, section, qn), els: [el] }; groups.push(lastQ); }
      } else if (el.matches(".kj") && lastQ) {
        lastQ.els.push(el); // 漢字の一覧は、すぐ前の問題（「漢字　傍線部の…」）のもの
      }
    }
  });

  const blanks = [];
  for (const g of groups) {
    g.blanks = [];
    for (const el of g.els) {
      const nodes = el.matches(".kj") ? el.querySelectorAll(".ksp") : el.querySelectorAll(".box, .lines");
      for (const n of nodes) {
        if (n.closest(".title")) continue;
        const b = {
          id: blanks.length, group: g, el: n,
          kind: n.matches(".ksp") ? "kanji" : n.matches(".lines") ? "lines" : "box",
          label: n.getAttribute("data-n") || "",
          item: n.closest(".ki"),
          answer: "", anyOf: null
        };
        n.setAttribute("data-sk-blank", String(b.id));
        g.blanks.push(b);
        blanks.push(b);
      }
    }
    assignAnswers(g, answers.get(g.key));
    // 問題の中の番号（問題に解答欄がいくつもあるときの ①②…）
    g.blanks.forEach((b, i) => {
      if (!b.label && b.kind !== "kanji" && g.blanks.filter((x) => x.kind !== "kanji").length > 1) b.label = CIRCLED[i] || String(i + 1);
      if (b.kind === "kanji" && b.item) b.label = txt(b.item.querySelector(".kn"));
      // 変換ツールで作ったプリントは data-type で決まっている。試験用は答えがあとから（暗号を開いてから）入る
      const dt = b.el.getAttribute("data-type");
      const declared = ["auto", "choice", "self"].includes(dt) ? dt : null;
      if (exam) b.type = declared || (b.kind === "lines" ? "self" : "auto");
      else b.type = !b.answer ? "none" : declared || (isChoice(b.answer) ? "choice" : b.kind === "lines" ? "self" : "auto");
      if (b.type === "choice") {
        const o = b.el.getAttribute("data-options");
        b.options = o && [...o].length >= 2 ? [...o] : choiceOptions(g);
      }
    });
  }
  // 答える順番: 問題の順。漢字の一覧は 2 列に並んでいる（①⑯②⑰…）ので、番号の順（①②③…）にする
  const order = [];
  for (const g of groups) {
    const kanji = g.blanks.filter((b) => b.kind === "kanji").sort((a, b) => CIRCLED.indexOf(a.label) - CIRCLED.indexOf(b.label));
    let k = 0;
    for (const b of g.blanks) order.push(b.kind === "kanji" ? kanji[k++] : b);
  }
  return { title, doc, groups, blanks: order, meta, exam, tampered: !!(meta && meta.sealed && !exam) };
}

function clean(s) {
  return String(s || "").replace(/[（(]\d+字(以内)?[）)]/g, "").replace(/\s+/g, " ").trim();
}

function linesOf(el) {
  const parts = [];
  let cur = "";
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) cur += c.nodeValue;
      else if (c.nodeName === "BR") { parts.push(cur); cur = ""; }
      else if (c.nodeType === 1) walk(c);
    }
  };
  walk(el);
  parts.push(cur);
  return parts.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function assignAnswers(g, entry) {
  g.explanation = entry ? entry.ex : [];
  if (!entry) return;
  const kanji = g.blanks.filter((b) => b.kind === "kanji");
  kanji.forEach((b, i) => { if (entry.ka && entry.ka[i]) b.answer = entry.ka[i]; });
  const rest = g.blanks.filter((b) => b.kind !== "kanji");
  if (!rest.length || !entry.a) return;
  const lines = linesOf(entry.a);
  let full = lines.join("\n");
  // 「（⑪⑫順不同）」… その解答欄どうしは、どちらの答えでもよい
  const unordered = [];
  full = full.replace(new RegExp(`[（(]((?:${CIRCLED_RE}){2,})順不同[）)]`, "g"), (m, s) => { unordered.push([...s]); return ""; });
  const byNum = new Map();
  const re = new RegExp(`(${CIRCLED_RE})([^①-⑳㉑-㉟]*)`, "g");
  let m;
  while ((m = re.exec(full))) byNum.set(m[1], clean(m[2]));
  if (rest.length === 1 && byNum.size <= 1) {
    rest[0].answer = clean(full.replace(new RegExp(`^${CIRCLED_RE}`), "").replace(/\n/g, " "));
  } else if (byNum.size) {
    rest.forEach((b, i) => { const k = b.label || CIRCLED[i]; if (byNum.has(k)) b.answer = byNum.get(k); });
  } else {
    rest.forEach((b, i) => { if (lines[i]) b.answer = clean(lines[i]); });
  }
  for (const set of unordered) {
    const same = rest.filter((b) => set.includes(b.label));
    const list = same.map((b) => b.answer).filter(Boolean);
    same.forEach((b) => { b.anyOf = list; });
  }
}

function isChoice(answer) {
  const a = String(answer).normalize("NFKC").trim();
  return a.length === 1 && CHOICES.includes(a);
}

// 問題文にある記号（ア　イ　ウ…）
function choiceOptions(g) {
  const text = g.els.map((el) => el.textContent).join(" ");
  const found = new Set();
  const re = new RegExp(`(^|[\\s　、。）)」])([${CHOICES}])[\\s　]`, "g");
  let m;
  while ((m = re.exec(text))) found.add(m[2]);
  const list = [...CHOICES].filter((c) => found.has(c));
  return list.length >= 2 ? list : [...CHOICES.slice(0, 4)];
}

// ---------- 採点 ----------

function norm(s) {
  return String(s == null ? "" : s)
    .normalize("NFKC")
    .replace(/[\s　]/g, "")
    .replace(/[「」『』〈〉《》【】“”"'、。,.・…]/g, "")
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}
function variants(answer) {
  const a = String(answer || "");
  const out = new Set([norm(a), norm(a.replace(/[（(][^）)]*[）)]/g, ""))]);
  const re = /[（(]([^）)]*)[）)]/g;
  let m;
  while ((m = re.exec(a))) out.add(norm(m[1]));
  for (const part of a.split(/[／/]|または/)) out.add(norm(part));
  out.delete("");
  return out;
}
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = t;
    }
  }
  return prev[b.length];
}
// { ok, close }
function check(b, input) {
  const v = norm(input);
  if (!v) return { ok: false, close: false };
  const targets = new Set();
  for (const a of b.anyOf || [b.answer, ...(b.alts || [])]) for (const x of variants(a)) targets.add(x);
  if (targets.has(v)) return { ok: true, close: false };
  return { ok: false, close: [...targets].some((t) => t.length >= 4 && distance(v, t) === 1) };
}

// 試験用の暗号を開いた中身（payload）を、解答欄に入れる。書きかえられていそうなら true を返す
function applyPayloadTo(P, payload) {
  const minutes = Number(P.meta && P.meta.minutes) || 0;
  const tampered = !payload || payload.mode !== "exam" || Number(payload.minutes || 0) !== minutes || !Array.isArray(payload.answers) || payload.answers.length !== P.blanks.length;
  for (const b of P.blanks) {
    const a = ((payload && payload.answers) || [])[b.id];
    if (!a) continue;
    b.answer = a.a || "";
    b.alts = a.alts || [];
    if (!b.answer && b.type !== "self") b.type = "none";
  }
  for (const g of P.groups) {
    if (!g.blanks.length) continue;
    const first = Math.min(...g.blanks.map((b) => b.id));
    g.explanation = (payload && payload.ex && payload.ex[first]) || [];
  }
  return tampered;
}

// 指導者の画面で、提出された答え（解答欄の ID の順）を採点する。試験用は payload（暗号を開いたもの）が要る
//   marks: { 解答欄の ID: ok / ng / pending（記述で、模範解答と同じでないもの。先生が決める）}
export function gradeAnswers(html, answers, { payload = null } = {}) {
  const P = parsePrint(html);
  if (payload) applyPayloadTo(P, payload);
  const marks = {};
  for (const b of P.blanks) {
    if (b.type === "none") continue;
    const v = String((answers || [])[b.id] || "");
    if (!v.trim()) { marks[b.id] = "ng"; continue; }
    const ok = check(b, v).ok;
    marks[b.id] = ok ? "ok" : b.type === "self" ? "pending" : "ng";
  }
  return { P, marks };
}

// 採点の点（部分正解は 0.5）。pending は数えない
export function tally(P, marks) {
  let ok = 0, total = 0, pending = 0;
  for (const b of P.blanks) {
    if (b.type === "none") continue;
    total++;
    const m = marks[b.id];
    if (m === "ok") ok++;
    else if (m === "partial") ok += 0.5;
    else if (m === "pending" || !m) pending++;
  }
  return { ok, total, pending };
}

// ---------- 部品 ----------

// 問題文を、決まったタグ・クラスだけで作り直す（プリントの属性やスクリプトは持ちこまない）
const ALLOWED = new Set(["SPAN", "B", "STRONG", "BR", "RUBY", "RT", "RP", "EM", "I", "U", "SUB", "SUP", "DIV", "P"]);
const KEEP = new Set(["qn", "body", "choice", "fill", "bs", "ws", "ref", "cap", "g", "up", "kn", "kw", "kb", "ki", "lb", "src"]);
function safe(node, chip) {
  if (node.nodeType === 3) return document.createTextNode(node.nodeValue);
  if (node.nodeType !== 1) return null;
  const id = node.getAttribute("data-sk-blank");
  if (id != null) return chip(Number(id));
  const kids = () => {
    const frag = document.createDocumentFragment();
    node.childNodes.forEach((c) => { const x = safe(c, chip); if (x) frag.append(x); });
    return frag;
  };
  if (!ALLOWED.has(node.tagName)) return kids();
  const el = document.createElement(node.tagName.toLowerCase());
  const cls = [...node.classList].filter((c) => KEEP.has(c)).map((c) => `p-${c}`);
  if (cls.length) el.className = cls.join(" ");
  el.append(kids());
  return el;
}

const SHEET_CSS = `
html { background: #e8ebf0; }
body { margin: 0 !important; padding: 12px 0 !important; background: transparent !important; }
.page { background: #fff; margin: 0 auto 14px !important; box-shadow: 0 2px 10px rgba(0,0,0,.15); }
[data-sk-answer="1"] { display: none !important; }
[data-sk-blank] { cursor: pointer; position: relative; transition: background-color .15s; }
[data-sk-blank]:hover { background: rgba(10,100,224,.07); }
.sk-cur { outline: 3px solid #0a64e0 !important; outline-offset: 1px; background: rgba(10,100,224,.1) !important; }
.sk-fill { display: block; font-size: .82em; line-height: 1.35; padding: .15em; color: #0b3d91; overflow: hidden; max-block-size: 100%; text-indent: 0; }
.ksp .sk-fill { display: inline; padding: 0; }
.sk-ok::after, .sk-ng::after, .sk-partial::after {
  content: ""; position: absolute; inset: -.3em; display: grid; place-items: center; writing-mode: horizontal-tb;
  font: 700 1.9em/1 sans-serif; color: #d32f2f; opacity: .85; pointer-events: none;
}
.sk-ok::after { content: "○"; }
.sk-ng::after { content: "×"; }
.sk-partial::after { content: "△"; }
`;
const SHEET_CSP = "default-src 'none'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob: https:";

function buildSheet(doc) {
  const d = doc.cloneNode(true);
  d.querySelectorAll('[data-sk-answer="1"]').forEach((p) => p.remove());
  const csp = d.createElement("meta");
  csp.setAttribute("http-equiv", "Content-Security-Policy");
  csp.setAttribute("content", SHEET_CSP);
  d.head.prepend(csp);
  const style = d.createElement("style");
  style.textContent = SHEET_CSS;
  d.head.append(style);
  return "<!doctype html>" + d.documentElement.outerHTML;
}

function stats(parsed) {
  const s = { total: parsed.blanks.length, auto: 0, choice: 0, self: 0, none: 0, groups: parsed.groups.filter((g) => g.blanks.length).length };
  for (const b of parsed.blanks) s[b.type]++;
  return s;
}


// ---------- ホームの「プリント」 ----------

function examStatus(p) {
  const st = loadState(p.id);
  const ex = st.exam || {};
  if (ex.submittedAt) return st.graded ? "採点ずみ" : "提出ずみ";
  if (ex.startedAt) return "受験中";
  return "未受験";
}

export function printSection(ui) {
  const { h, icon, button, linkButton } = ui;
  const prints = listPrints();
  const input = h("input", { type: "file", accept: ".html,.htm,text/html", hidden: true });
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (file) importFile(file, ui);
  });
  const rows = prints.filter((p) => !p.classRef).map((p) => {
    const st = loadState(p.id);
    const answered = Object.values(st.answers).filter((v) => String(v).trim()).length;
    const last = st.history[st.history.length - 1];
    const pct = last ? last.pct : 0;
    return h("div", { class: "set-row" },
      h("span", { class: `thumb print-thumb${p.exam ? " is-exam" : ""}`, "aria-hidden": "true" }, icon(p.exam ? "timer" : "assignment")),
      h("div", { class: "set-row-body" },
        h("a", { class: "set-row-link", href: `#/print/${encodeURIComponent(p.id)}` },
          h("span", { class: "set-row-sub" },
            p.exam ? h("span", { class: "exam-pill" }, "試験") : h("span", null, "プリント"),
            p.exam ? h("span", null, examStatus(p)) : null),
          h("span", { class: "set-row-title" }, p.title)),
        h("span", { class: "set-row-meta" },
          h("span", null, icon("edit_square"), `${answered} / ${p.blanks} 問 回答`),
          p.exam && p.minutes ? h("span", null, icon("timer"), `${p.minutes} 分`) : null,
          last ? h("span", null, icon("grading"), `${p.exam ? "得点" : "前回"} ${last.pct}%`) : null)),
      h("div", { class: "set-row-end" },
        last ? ui.ring(pct / 100, { size: 52, stroke: 5, color: pct >= 80 ? "var(--st-mastered)" : "var(--primary)", label: `${pct}%` })
          : ui.ring(p.blanks ? answered / p.blanks : 0, { size: 52, stroke: 5, color: "var(--outline)", label: "未採点" })));
  });
  return h("section", { class: "section" },
    h("div", { class: "section-head" },
      h("h2", null, "プリント", h("span", { class: "soon-pill" }, "テスト中")),
      h("div", { class: "section-actions" },
        linkButton("text", "PDF から作る", "picture_as_pdf", "#/maker"),
        button("tonal", "プリントを追加", "upload_file", () => input.click()), input)),
    rows.length ? h("div", { class: "set-list" }, rows)
      : h("div", { class: "empty-card" },
        icon("assignment", "empty-icon"),
        h("p", null, "試験対策などの HTML のプリントを追加すると、四角の解答欄を見つけて、どんどん答えられます。最後のほうにある解答は隠して、自動で採点します。"),
        h("p", { class: "muted" }, "PDF のプリントは「PDF から作る」で変換できます。プリントはこのブラウザの中だけに保存されます（サーバーには送りません）。")));
}

async function importFile(file, ui) {
  const { h, icon, button, toast, openDialog, go } = ui;
  if (file.size > MAX_FILE * 8) { toast("ファイルが大きすぎます（16MB まで）"); return; }
  let html, parsed;
  try {
    html = await file.text();
    parsed = parsePrint(html);
  } catch (e) {
    toast("ファイルを読めませんでした");
    return;
  }
  const s = stats(parsed);
  if (!s.total) {
    const d = openDialog("解答欄が見つかりませんでした",
      h("div", null,
        h("p", null, "このプリントの形では、解答欄（四角・罫線・漢字のかっこ）を見つけられませんでした。"),
        h("p", { class: "muted small" }, "PDF のプリントは「PDF から作る」で変換できます。HTML は、解答欄に box・lines・ksp、問題に q・qn、解答に ans・a・ka のクラスを使ったものに対応しています。")),
      [button("filled", "閉じる", null, () => d.close())]);
    return;
  }
  const titleInput = h("input", { type: "text", class: "field-input", value: parsed.title, maxlength: "80", "aria-label": "プリントの名前" });
  const line = (ic, label, n, cls = "") => h("li", { class: cls }, icon(ic), h("span", null, label), h("strong", null, `${n}`));
  const d = openDialog(parsed.exam ? "試験用のプリントを追加" : "プリントを追加",
    h("div", { class: "import-print" },
      h("label", { class: "field" }, h("span", { class: "field-label" }, "名前"), titleInput),
      parsed.exam ? h("p", { class: "exam-box" }, icon("timer"),
        `試験用のプリントです（${parsed.meta.minutes ? `制限時間 ${parsed.meta.minutes} 分・` : ""}全画面で解く・提出は 1 回だけ）。答えは提出するまで見られません。`) : null,
      parsed.tampered ? h("p", { class: "warn small" }, icon("warning"), "このファイルは書きかえられているようです（試験の設定が消されています）。") : null,
      h("p", null, `${s.groups} 問・解答欄 ${s.total} 個を見つけました。`),
      h("ul", { class: "found-list" },
        line("spellcheck", "自動で採点（漢字・抜き出しなど）", s.auto),
        line("radio_button_checked", "記号を選ぶ", s.choice),
        line("edit_note", "記述（模範解答を見て自分で採点）", s.self),
        s.none ? line("help", "答えが見つからない（採点しない）", s.none, "warn") : null),
      h("p", { class: "muted small" }, parsed.exam ? "プリントはこのブラウザの中だけに保存されます。" : "解答のページは隠して、採点にだけ使います。プリントはこのブラウザの中だけに保存されます。")),
    [button("text", "やめる", null, () => d.close()),
      button("filled", "追加する", "add", async () => {
        try {
          const id = await addPrint(html, titleInput.value.trim() || parsed.title);
          d.close();
          toast("プリントを追加しました");
          go(`/print/${encodeURIComponent(id)}`);
        } catch (e) {
          toast(e.message);
        }
      })]);
}

// ---------- プリントに答える ----------

const fmtTime = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(sec).padStart(2, "0")}`;
};
const clock = (t) => new Date(t).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const AWAY_LABEL = { fullscreen: "全画面をやめた", hidden: "ほかのタブ・アプリに移った", blur: "ほかのウィンドウを使った", reload: "読み込み直した" };

export async function renderPrint(id, ui) {
  const { h, icon, button, toast, confirmDialog, go, app } = ui;
  const hash = location.hash;
  const meta = listPrints().find((p) => p.id === id);
  app.replaceChildren(h("p", { class: "loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), "読み込み中…"));
  const html = meta ? await getHtml(id) : null;
  if (location.hash !== hash) return; // 読みこんでいるあいだに、ほかの画面へ移った
  if (!meta || !html) { ui.message("プリントが見つかりません", "消されたか、ほかのブラウザで追加したプリントかもしれません。"); return; }
  const P = parsePrint(html);
  const B = P.blanks;
  if (!B.length) { ui.message("解答欄が見つかりません", "このプリントでは解答欄を見つけられませんでした。"); return; }
  document.title = `${meta.title} - SK Study`;
  const exam = P.exam;

  const st = loadState(id);
  st.cur = Math.max(0, Math.min(st.cur || 0, B.length - 1));
  if (exam) { st.exam = { events: [], ...(st.exam || {}) }; st.instant = false; }
  const save = () => writeJSON(stateKey(id), st);
  // クラスの課題: 提出ずみか・先生の採点・結果の公開（答えの合言葉）を読む
  const classRef = meta.classRef || null;
  const cls = { sub: null, assign: null, grade: null, error: null };
  if (classRef) {
    st.instant = false;
    try {
      [cls.sub, cls.assign, cls.grade] = await Promise.all([
        cloud.mySubmission(classRef.cid, classRef.aid), cloud.getAssignment(classRef.cid, classRef.aid), cloud.myGrade(classRef.cid, classRef.aid)
      ]);
    } catch (e) {
      cls.error = e;
    }
    if (location.hash !== hash) return;
    if (cls.sub) {
      st.classSubmitted = true;
      st.classPending = false;
      // ほかの端末で提出したときは、提出した答えを入れる
      let data = {};
      try { data = JSON.parse(cls.sub.data || "{}"); } catch (e) { /* 読めなければ空 */ }
      if (!Object.values(st.answers).some((v) => String(v).trim()) && Array.isArray(data.answers)) data.answers.forEach((v, i) => { if (v) st.answers[i] = v; });
      if (exam) {
        if (!st.exam.startedAt) st.exam.startedAt = (data.exam && data.exam.startedAt) || cloud.toMillis(cls.sub.submittedAt) || Date.now();
        if (!st.exam.submittedAt) st.exam.submittedAt = cloud.toMillis(cls.sub.submittedAt) || Date.now();
        if (!st.exam.events.length && data.exam && Array.isArray(data.exam.events)) st.exam.events = data.exam.events;
      }
      save();
    }
  }
  const submittedClass = () => !!(classRef && st.classSubmitted);
  const answerOf = (b) => String(st.answers[b.id] || "");
  const answeredCount = () => B.filter((b) => answerOf(b).trim()).length;
  const submitted = () => !!(exam && st.exam.submittedAt);
  const examActive = () => !!(exam && st.exam.startedAt && !st.exam.submittedAt);
  const locked = () => st.graded || submitted() || submittedClass();
  const minutes = exam ? Number(P.meta.minutes) || 0 : 0;

  // ---- 試験: はじめる前の画面 ----
  if (exam && !st.exam.startedAt) {
    const small = window.innerWidth < 900;
    const fsOk = !!document.documentElement.requestFullscreen;
    const agree = h("input", { type: "checkbox" });
    app.replaceChildren(h("section", { class: "exam-lobby" },
      h("a", { class: "back-link", href: "#/" }, icon("arrow_back"), h("span", null, "ホーム")),
      h("div", { class: "lobby-card" },
        h("p", { class: "exam-pill big" }, "試験"),
        h("h1", null, meta.title),
        h("ul", { class: "lobby-facts" },
          h("li", null, icon("timer"), minutes ? `制限時間 ${minutes} 分（時間になると自動で提出）` : "制限時間なし"),
          h("li", null, icon("edit_square"), `解答欄 ${B.length} 個`),
          h("li", null, icon("fullscreen"), "全画面で解きます"),
          h("li", null, icon("send"), "提出は 1 回だけ。提出したら答えは直せません")),
        h("div", { class: "lobby-rules" },
          h("strong", null, "試験の決まり"),
          h("p", null, "全画面をやめる・ほかのタブやアプリに移る・ページを読み込み直すと、そのあいだ問題が隠れ、回数と時間が記録されます。記録は結果といっしょに表示されます。"),
          h("p", null, "はじめると時間が進みます。とちゅうで閉じても時間は止まりません。")),
        P.tampered ? h("p", { class: "warn" }, icon("warning"), "このファイルは書きかえられているようです。") : null,
        small ? h("p", { class: "warn" }, icon("computer"), "試験はパソコンで受けてください（画面が小さすぎます）。") : null,
        !fsOk ? h("p", { class: "warn" }, icon("warning"), "このブラウザは全画面に対応していません。") : null,
        h("label", { class: "switch-row" }, agree, h("span", null, "決まりを読みました")),
        button("filled", "全画面ではじめる", "fullscreen", async () => {
          if (!agree.checked) { toast("決まりを読んで、チェックを入れてください"); return; }
          try { await document.documentElement.requestFullscreen(); } catch (e) { toast("全画面にできませんでした"); return; }
          st.exam.startedAt = Date.now();
          save();
          renderPrint(id, ui);
        }, { class: "filled-btn start-btn", disabled: small || !fsOk }))));
    return;
  }

  // ---- 枠 ----
  const progressEl = h("span", { class: "print-progress" });
  const timerEl = h("span", { class: "exam-timer", hidden: !(examActive() && minutes) });
  const gradeBtn = exam ? button("filled", "提出する", "send", () => submit(false))
    : classRef ? button("filled", "提出する", "send", () => submitPractice())
      : button("filled", "採点する", "grading", () => gradeAll());
  const modeSel = h("select", { class: "field-select mode-select", "aria-label": "答え合わせのしかた", onchange: (e) => { st.instant = e.target.value === "instant"; save(); draw(); } },
    h("option", { value: "end", selected: !st.instant }, "最後にまとめて採点"),
    h("option", { value: "instant", selected: st.instant }, "1 問ずつ答え合わせ"));
  const tabs = h("div", { class: "print-tabs", role: "tablist" });
  const view = h("section", { class: `print-view${exam ? " is-exam" : ""}`, "data-tab": "answer" });
  const frame = h("iframe", { class: "sheet-frame", sandbox: "allow-same-origin", title: "プリント" });
  const sheet = h("div", { class: "print-sheet" }, frame);
  const summaryEl = h("div", { class: "pp-summary" });
  const contextEl = h("p", { class: "pp-context" });
  const promptEl = h("div", { class: "pp-prompt" });
  const answerEl = h("div", { class: "pp-answer" });
  const prevBtn = button("outlined", "前へ", "arrow_back", () => select(st.cur - 1));
  const nextBtn = button("filled", "次へ", "arrow_forward", () => next());
  const mapEl = h("div", { class: "pp-map" });
  const panel = h("div", { class: "print-panel" },
    window.innerWidth < 900 && !exam ? h("p", { class: "pc-note" }, icon("computer"), "プリントはパソコン向けの画面です。") : null,
    summaryEl, contextEl, promptEl, answerEl,
    h("div", { class: "pp-nav" }, prevBtn, nextBtn),
    h("details", { class: "pp-map-wrap", open: exam }, h("summary", null, icon("grid_view"), "解答欄の一覧"), mapEl),
    h("div", { class: "pp-tools" },
      classRef ? h("span", { class: "muted small tools-note" }, icon("groups"), exam ? "クラスの試験" : "クラスの課題（提出は 1 回）")
        : exam ? h("span", { class: "muted small tools-note" }, icon("lock"), "試験用のプリント") : modeSel,
      exam || classRef ? null : button("text", "全部消す", "restart_alt", async () => {
        if (await confirmDialog("答えを全部消しますか？", "このプリントの答えと採点を消して、最初からやり直します。", "全部消す", true)) reset(false);
      }),
      examActive() || classRef ? null : button("text", "プリントを削除", "delete", async () => {
        if (await confirmDialog("このプリントを削除しますか？", `「${meta.title}」と、その答えを消します。もとに戻せません。`, "削除する", true)) {
          await deletePrint(id);
          toast("削除しました");
          go("/", true);
        }
      }, { "data-danger": "" })));
  const guardEl = h("div", { class: "exam-guard", hidden: true },
    icon("fullscreen_exit", "guard-icon"),
    h("h2", null, "全画面に戻ってください"),
    h("p", null, "試験中は、全画面でしか問題を見られません。全画面をやめたこと・ほかの画面に移ったことは記録されます。"),
    button("filled", "全画面に戻る", "fullscreen", () => document.documentElement.requestFullscreen().catch(() => toast("全画面にできませんでした"))));

  function showTab(tab) {
    view.dataset.tab = tab;
    tabs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
    if (tab === "sheet") { fitSheet(); scrollSheet(); }
  }
  tabs.append(
    h("button", { type: "button", role: "tab", "data-tab": "answer", "aria-selected": "true", onclick: () => showTab("answer") }, icon("edit"), "答える"),
    h("button", { type: "button", role: "tab", "data-tab": "sheet", "aria-selected": "false", onclick: () => showTab("sheet") }, icon("description"), "プリント"));

  add(view,
    h("header", { class: "print-head" },
      examActive() ? h("span", { class: "icon-btn", "aria-hidden": "true" }, icon("lock")) : h("a", { class: "icon-btn", href: "#/", "aria-label": "ホームへ", title: "ホームへ" }, icon("close")),
      h("span", { class: "print-title" }, exam ? h("span", { class: "exam-pill" }, "試験") : null, meta.title),
      timerEl, progressEl, gradeBtn),
    tabs,
    h("div", { class: "print-body" }, sheet, panel),
    guardEl);
  app.replaceChildren(view);

  const cleanups = [];
  const listen = (target, type, fn, opt) => { target.addEventListener(type, fn, opt); cleanups.push(() => target.removeEventListener(type, fn, opt)); };
  window.addEventListener("hashchange", () => { cleanups.forEach((f) => f()); if (document.fullscreenElement && exam) document.exitFullscreen().catch(() => {}); }, { once: true });

  // ---- 左のプリント ----
  let sheetDoc = null;
  let pageW = 0;
  const narrow = () => window.matchMedia("(max-width: 900px)").matches;
  function fitSheet() {
    if (!sheetDoc || !pageW) return;
    const w = frame.clientWidth;
    if (!w) return;
    sheetDoc.documentElement.style.zoom = String(Math.min(1, (w - 24) / pageW));
  }
  function scrollSheet() {
    if (!sheetDoc) return;
    const el = sheetDoc.querySelector(`[data-sk-blank="${B[st.cur].id}"]`);
    if (!el) return;
    const win = frame.contentWindow;
    const r = el.getBoundingClientRect();
    if (r.top < 40 || r.bottom > win.innerHeight - 40) win.scrollTo({ top: win.scrollY + r.top - win.innerHeight / 2, behavior: "smooth" });
  }
  function syncSheet() {
    if (!sheetDoc) return;
    for (const b of B) {
      const el = sheetDoc.querySelector(`[data-sk-blank="${b.id}"]`);
      if (!el) continue;
      el.classList.toggle("sk-cur", b === B[st.cur]);
      let f = el.querySelector(":scope > .sk-fill");
      if (!f) { f = sheetDoc.createElement("span"); f.className = "sk-fill"; el.append(f); }
      f.textContent = answerOf(b);
      const m = st.marks[b.id];
      el.classList.toggle("sk-ok", m === "ok");
      el.classList.toggle("sk-ng", m === "ng");
      el.classList.toggle("sk-partial", m === "partial");
    }
  }
  frame.addEventListener("load", () => {
    try { sheetDoc = frame.contentDocument; } catch (e) { sheetDoc = null; }
    if (!sheetDoc) return;
    const page = sheetDoc.querySelector(".page");
    pageW = page ? page.getBoundingClientRect().width : 0;
    fitSheet();
    syncSheet();
    scrollSheet();
    sheetDoc.addEventListener("click", (e) => {
      const t = e.target.closest && e.target.closest("[data-sk-blank]");
      if (!t) return;
      select(B.findIndex((b) => b.id === Number(t.getAttribute("data-sk-blank"))));
      if (narrow()) showTab("answer");
    });
    if (exam) sheetDoc.addEventListener("contextmenu", (e) => { if (examActive()) e.preventDefault(); });
  });
  frame.srcdoc = buildSheet(P.doc);
  const ro = new ResizeObserver(() => fitSheet());
  ro.observe(frame);
  cleanups.push(() => ro.disconnect());

  // ---- 試験: 全画面の見張り・時間 ----
  let away = null;
  let blurred = false;
  function leave(type) {
    if (!examActive() || away) return;
    away = { type, at: Date.now() };
  }
  function back() {
    if (!away) return;
    st.exam.events.push({ ...away, ms: Date.now() - away.at });
    if (st.exam.events.length > 200) st.exam.events.shift();
    away = null;
    save();
  }
  function guard() {
    if (!examActive()) { guardEl.hidden = true; back(); return; }
    const fs = !!document.fullscreenElement;
    const visible = !document.hidden;
    if (!fs) leave("fullscreen");
    else if (!visible) leave("hidden");
    else if (blurred) leave("blur");
    const ok = fs && visible && !blurred;
    if (ok) back();
    guardEl.hidden = ok;
    view.classList.toggle("is-guarded", !ok);
  }
  let timer = 0;
  function tick() {
    if (!examActive() || !minutes) { timerEl.hidden = true; return; }
    const remain = st.exam.startedAt + minutes * 60000 - Date.now();
    timerEl.hidden = false;
    timerEl.textContent = `残り ${fmtTime(remain)}`;
    timerEl.classList.toggle("is-low", remain < 60000);
    if (remain <= 0) submit(true);
  }
  if (exam) {
    if (examActive() && !document.fullscreenElement) leave("reload");
    listen(document, "fullscreenchange", guard);
    listen(document, "visibilitychange", guard);
    listen(window, "blur", () => setTimeout(() => {
      // プリント（iframe）を押したときは、ほかの画面に移ったのではない
      if (document.activeElement === frame) return;
      blurred = true;
      guard();
    }, 0));
    listen(window, "focus", () => { blurred = false; guard(); });
    listen(view, "contextmenu", (e) => { if (examActive()) e.preventDefault(); });
    listen(view, "copy", (e) => { if (examActive() && !(e.target.closest && e.target.closest("input, textarea"))) e.preventDefault(); });
    timer = setInterval(tick, 1000);
    cleanups.push(() => clearInterval(timer));
    guard();
    tick();
  }

  async function submit(auto) {
    if (!examActive()) return;
    if (!auto) {
      const empty = B.length - answeredCount();
      if (!(await confirmDialog("提出しますか？", `提出は 1 回だけです。提出したあとは答えを直せません。${empty ? `まだ答えていない解答欄が ${empty} 個あります。` : ""}`, "提出する"))) return;
      if (!examActive()) return;
    }
    back();
    st.exam.submittedAt = Date.now();
    st.exam.auto = !!auto;
    save();
    clearInterval(timer);
    guard();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    if (auto) toast("時間になったので、提出しました");
    await openAndGrade(classRef && cls.assign && cls.assign.answerKey ? cls.assign.answerKey : "");
    if (classRef) await sendToClass();
    draw();
  }

  // クラスの課題（練習用のプリント）: 採点してから、先生に送る
  async function submitPractice() {
    if (submittedClass()) return;
    const empty = B.length - answeredCount();
    if (!(await confirmDialog("提出しますか？", `提出は 1 回だけです。提出すると採点して、答えと点数が先生に届きます。${empty ? `まだ答えていない解答欄が ${empty} 個あります。` : ""}`, "提出する"))) return;
    await gradeAll(true);
    await sendToClass();
    draw();
  }

  // 答え（解答欄の ID の順）・採点・試験の記録を、先生に送る
  async function sendToClass() {
    const s = score();
    const data = {
      kind: "print",
      answers: Array.from({ length: B.length }, (_, i) => String(st.answers[i] || "")),
      marks: st.graded ? Object.fromEntries(B.map((b) => [b.id, st.marks[b.id] || ""])) : null,
      exam: exam ? { startedAt: st.exam.startedAt, submittedAt: st.exam.submittedAt, auto: !!st.exam.auto, events: st.exam.events || [], tampered: !!(st.exam.tampered || P.tampered) } : null
    };
    try {
      await cloud.submit(classRef.cid, classRef.aid, st.graded ? s : { ok: 0, total: s.total }, data);
      st.classSubmitted = true;
      st.classPending = false;
      toast("先生に提出しました");
    } catch (e) {
      // すでに提出していた（ほかの端末など）ときは、提出ずみとして扱う
      const sub = await cloud.mySubmission(classRef.cid, classRef.aid).catch(() => null);
      if (sub) { st.classSubmitted = true; st.classPending = false; }
      else { st.classPending = true; toast(`先生に送れませんでした。${cloud.explain(e)}`); }
    }
    save();
  }

  // 暗号を開いて、答えを解答欄に入れる。開けたら true
  function applyPayload(payload) {
    if (applyPayloadTo(P, payload)) st.exam.tampered = true;
  }
  async function openAndGrade(pass) {
    if (!exam || !submitted()) return false;
    try {
      const payload = st.exam.payload || await openAnswers(P.meta.sealed, pass);
      applyPayload(payload);
      if (!st.exam.payload) { st.exam.payload = payload; save(); }
      if (!st.graded) gradeAll(true);
      return true;
    } catch (e) {
      return false;
    }
  }
  if (exam && submitted() && st.exam.payload) applyPayload(st.exam.payload);

  // ---- 右の答える欄 ----
  function chip(idx) {
    const x = B.find((b) => b.id === idx);
    if (!x) return h("span", { class: "pchip" }, "　");
    const v = answerOf(x).trim();
    const m = st.marks[x.id];
    return h("button", {
      type: "button",
      class: `pchip${x === B[st.cur] ? " is-cur" : ""}${v ? " is-filled" : ""}${m ? ` is-${m}` : ""}${x.kind === "lines" ? " is-lines" : ""}`,
      onclick: () => select(B.indexOf(x)),
      "aria-label": `解答欄 ${x.label || ""}`
    }, x.label && x.kind !== "kanji" ? h("small", null, x.label) : null, h("span", null, v ? (v.length > 24 ? v.slice(0, 24) + "…" : v) : "　"));
  }

  function renderPrompt(b) {
    const g = b.group;
    const wrap = h("div", { class: "pq" });
    for (const el of g.els) {
      if (el.matches(".kj")) {
        if (b.kind === "kanji" && b.item && el.contains(b.item)) wrap.append(h("div", { class: "pq-kanji" }, safe(b.item, (i) => chip(i))));
        continue;
      }
      wrap.append(safe(el, (i) => chip(i)));
    }
    return wrap;
  }

  function verdictBlock(b) {
    const m = st.marks[b.id];
    const g = b.group;
    const ex = g.explanation && g.explanation.length ? h("div", { class: "pp-ex" }, h("span", { class: "pp-ex-tag" }, "解説"), g.explanation.map((t) => h("p", null, t))) : null;
    if (b.type === "none") return [h("p", { class: "muted small" }, icon("help"), "このプリントには、この解答欄の答えがありません（採点しません）。")];
    if (b.type === "self" && !m) {
      const pick = (mark) => { st.marks[b.id] = mark; save(); draw(); };
      return [
        h("div", { class: "model" }, h("span", { class: "model-tag" }, "模範解答"), h("p", null, b.answer)),
        h("p", { class: "muted small" }, "自分の答えと見くらべて、採点してください。"),
        h("div", { class: "self-grade" },
          button("outlined", "○ 正解", null, () => pick("ok"), { class: "outlined-btn sg-ok" }),
          button("outlined", "△ 部分正解", null, () => pick("partial"), { class: "outlined-btn sg-partial" }),
          button("outlined", "× まちがい", null, () => pick("ng"), { class: "outlined-btn sg-ng" })),
        ex];
    }
    const label = { ok: "正解！", partial: "部分正解", ng: answerOf(b).trim() ? "ざんねん…" : "答えていません" }[m];
    // 試験では「正解にする」は使えない（自分で点を変えられないように）
    const fix = !exam && m === "ng" && answerOf(b).trim() && b.type !== "self" ? button("text", "正解にする", "done", () => { st.marks[b.id] = "ok"; st.manual[b.id] = true; save(); draw(); }) : null;
    const r = m === "ng" && b.type !== "self" ? check(b, answerOf(b)) : null;
    const correct = [...(b.anyOf || [b.answer]), ...(b.alts || [])].filter(Boolean);
    return [
      h("p", { class: `verdict ${m === "ok" ? "ok" : m === "partial" ? "partial" : "ng"}` }, r && r.close ? "おしい！" : label),
      m !== "ok" || b.type === "self" ? h("div", { class: "model" }, h("span", { class: "model-tag" }, b.type === "self" ? "模範解答" : "正解"), h("p", null, correct.join(" / "))) : null,
      fix ? h("p", { class: "fix-row" }, fix, h("span", { class: "muted small" }, "書き方がちがうだけのとき")) : null,
      ex];
  }

  function answerArea(b) {
    const m = st.marks[b.id];
    const isLocked = locked() || (st.instant && (m !== undefined || (b.type === "self" && st.checked && st.checked[b.id])));
    const showVerdict = st.graded || (st.instant && isLocked);
    const out = [];
    const where = b.label ? `${b.label} の答え` : "答え";
    const typeLabel = { choice: "記号を選ぶ", auto: exam && !st.graded ? "答えを書く" : "自動で採点", self: "記述", none: "採点なし" }[b.type];
    out.push(h("p", { class: "pa-label" }, h("strong", null, where), h("span", { class: `type-pill type-${b.type}` }, typeLabel)));
    if (b.type === "choice") {
      out.push(h("div", { class: "pa-options" }, b.options.map((k) => h("button", {
        type: "button", class: `pa-opt${answerOf(b) === k ? " is-picked" : ""}`, disabled: isLocked,
        onclick: () => { setAnswer(b, k); if (st.instant) checkOne(b); else next(); }
      }, k))));
    } else {
      const multi = b.kind === "lines";
      const field = h(multi ? "textarea" : "input", {
        class: "field-input pa-input", rows: multi ? "4" : null, type: multi ? null : "text",
        autocomplete: "off", spellcheck: "false", disabled: isLocked, "aria-label": where,
        placeholder: b.kind === "kanji" ? "読み・漢字を書く" : multi ? "記述で答える（Ctrl + Enter で次へ）" : "答えを書く（Enter で次へ）"
      });
      field.value = answerOf(b);
      field.addEventListener("input", () => setAnswer(b, field.value, false));
      field.addEventListener("keydown", (e) => {
        if (e.isComposing || e.key !== "Enter") return;
        if (multi && !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        if (st.instant && !isLocked) checkOne(b);
        else next();
      });
      out.push(field);
      if (st.instant && !isLocked) out.push(button("tonal", "答え合わせ", "check", () => checkOne(b), { class: "tonal-btn" }));
      setTimeout(() => { if (!isLocked && !narrow()) field.focus({ preventScroll: true }); }, 0);
    }
    if (showVerdict) out.push(h("div", { class: "feedback" }, verdictBlock(b)));
    return out;
  }

  function setAnswer(b, value, redraw = true) {
    if (locked()) return;
    st.answers[b.id] = value;
    save();
    progressEl.textContent = `${answeredCount()} / ${B.length}`;
    syncSheet();
    if (!redraw) {
      const old = promptEl.querySelector(".pchip.is-cur");
      if (old) old.replaceWith(chip(b.id));
      drawMap();
    } else {
      draw();
    }
  }

  function checkOne(b) {
    if (b.type === "none") return next();
    if (b.type === "self") {
      if (check(b, answerOf(b)).ok) st.marks[b.id] = "ok";
      st.checked = { ...(st.checked || {}), [b.id]: true };
    } else {
      st.marks[b.id] = check(b, answerOf(b)).ok ? "ok" : "ng";
    }
    save();
    draw();
  }

  function score() {
    const gradable = B.filter((b) => b.type !== "none");
    let ok = 0, pending = 0, wrong = 0;
    for (const b of gradable) {
      const m = st.marks[b.id];
      if (m === "ok") ok++;
      else if (m === "partial") ok += 0.5;
      else if (b.type === "self" && !m) pending++;
      if (m === "ng" || m === "partial") wrong++;
    }
    return { ok, total: gradable.length, pending, wrong, pct: gradable.length ? Math.round((ok / gradable.length) * 100) : 0 };
  }

  async function gradeAll(skipConfirm = false) {
    const empty = B.length - answeredCount();
    if (!skipConfirm && !st.graded && empty > 0 && !(await confirmDialog("採点しますか？", `まだ答えていない解答欄が ${empty} 個あります。答えていないところはまちがいになります。`, "採点する"))) return;
    for (const b of B) {
      if (b.type === "none") continue;
      if (b.type === "self") {
        if (!st.marks[b.id] && check(b, answerOf(b)).ok) st.marks[b.id] = "ok";
        if (!answerOf(b).trim()) st.marks[b.id] = "ng";
        continue;
      }
      if (st.manual[b.id] && st.marks[b.id] === "ok") continue;
      st.marks[b.id] = check(b, answerOf(b)).ok ? "ok" : "ng";
    }
    st.graded = true;
    const s = score();
    st.history.push({ at: Date.now(), pct: s.pct });
    if (st.history.length > 30) st.history.shift();
    const firstTodo = B.findIndex((b) => st.marks[b.id] === "ng" || (b.type === "self" && !st.marks[b.id]));
    if (firstTodo >= 0) st.cur = firstTodo;
    save();
    draw();
    toast(`採点しました: ${s.pct}%`);
  }

  function reset(onlyWrong) {
    if (exam) return;
    if (onlyWrong) {
      for (const b of B) {
        const m = st.marks[b.id];
        if (m === "ng" || m === "partial") { delete st.answers[b.id]; delete st.marks[b.id]; delete st.manual[b.id]; }
      }
      for (const b of B) if (b.type === "self" && st.marks[b.id] !== "ok") delete st.marks[b.id];
      const first = B.findIndex((b) => !answerOf(b).trim());
      st.cur = first >= 0 ? first : 0;
    } else {
      st.answers = {};
      st.marks = {};
      st.manual = {};
      st.cur = 0;
    }
    st.checked = {};
    st.graded = false;
    save();
    draw();
  }

  function examLog() {
    const ev = st.exam.events || [];
    const total = ev.reduce((a, e) => a + (e.ms || 0), 0);
    return h("div", { class: "exam-log" },
      h("p", null, icon("schedule"), `かかった時間 ${fmtTime(st.exam.submittedAt - st.exam.startedAt)}${st.exam.auto ? "（時間切れで自動提出）" : ""}`),
      h("p", { class: ev.length ? "warn" : "" }, icon(ev.length ? "visibility_off" : "verified_user"),
        ev.length ? `画面を離れた記録 ${ev.length} 回（合計 ${fmtTime(total)}）` : "画面を離れた記録はありません"),
      ev.length ? h("ul", null, ev.slice(0, 30).map((e) => h("li", null, `${clock(e.at)}　${AWAY_LABEL[e.type] || e.type}（${fmtTime(e.ms)}）`))) : null,
      st.exam.tampered || P.tampered ? h("p", { class: "warn" }, icon("warning"), "このプリントは書きかえられているようです。") : null);
  }

  // クラスの課題: 先生に届いたか・先生の採点
  function classBox() {
    if (!classRef) return null;
    const g = cls.grade;
    return h("div", { class: "class-box" },
      st.classPending ? h("p", { class: "warn small" }, icon("cloud_off"), "まだ先生に届いていません。",
        button("text", "もう一度送る", "send", async () => { await sendToClass(); draw(); }))
        : submittedClass() ? h("p", { class: "small" }, icon("task_alt"), "先生に提出しました") : null,
      g ? h("p", { class: "teacher-grade" }, icon("school"), `先生の採点: ${g.ok} / ${g.total}（${g.pct}%）`) : null,
      g && g.note ? h("p", { class: "small" }, g.note) : null,
      cls.error ? h("p", { class: "warn small" }, icon("cloud_off"), cloud.explain(cls.error)) : null);
  }

  function summary() {
    if (exam && submitted() && !st.graded) {
      const pass = h("input", { type: "password", class: "field-input", placeholder: "答え合わせの合言葉", autocomplete: "off", "aria-label": "答え合わせの合言葉" });
      const go2 = async () => {
        if (!pass.value.trim()) { pass.focus(); return; }
        if (await openAndGrade(pass.value)) { toast("答え合わせをしました"); draw(); }
        else toast("合言葉がちがいます");
      };
      pass.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) go2(); });
      return h("div", { class: "pp-score exam-done" },
        h("div", { class: "pp-score-text" },
          h("strong", null, icon("task_alt"), "提出しました"),
          h("span", { class: "small" }, "先生から合言葉を聞いたら、入れると答え合わせができます。"),
          h("div", { class: "pass-row" }, pass, button("filled", "答え合わせ", "lock_open", go2)),
          examLog(),
          classBox()));
    }
    const s = score();
    return h("div", { class: "pp-score" },
      ui.ring(s.pct / 100, { size: 64, stroke: 6, color: s.pct >= 80 ? "var(--st-mastered)" : "var(--primary)", label: `${s.pct}%` }),
      h("div", { class: "pp-score-text" },
        h("strong", null, `${s.total} 問中 ${s.ok} 問 正解`),
        s.pending ? h("span", { class: "warn small" }, `記述の自己採点があと ${s.pending} 問`) : h("span", { class: "muted small" }, s.wrong ? `まちがい ${s.wrong} 問` : "全問正解！"),
        exam ? examLog() : classRef ? null : h("div", { class: "pp-score-actions" },
          s.wrong ? button("filled", "まちがいを解き直す", "replay", () => reset(true)) : null,
          button("text", "全部やり直す", "restart_alt", () => reset(false))),
        classBox()));
  }

  function drawMap() {
    mapEl.replaceChildren(...B.map((b, i) => {
      const m = st.marks[b.id];
      const v = answerOf(b).trim();
      return h("button", {
        type: "button", class: `map-cell${i === st.cur ? " is-cur" : ""}${v ? " is-filled" : ""}${m ? ` is-${m}` : ""}`,
        onclick: () => select(i), title: `${b.group.article} ${b.group.section} ${b.group.qn} ${b.label}`.trim()
      }, String(i + 1));
    }));
  }

  function draw() {
    const b = B[st.cur];
    const g = b.group;
    progressEl.textContent = `${answeredCount()} / ${B.length}`;
    gradeBtn.hidden = exam ? !examActive() : classRef ? submittedClass() : st.graded;
    summaryEl.replaceChildren(...(st.graded || submitted() || submittedClass() ? [summary()] : []));
    put(contextEl, 
      g.article ? h("span", null, g.article) : null,
      g.section ? h("span", null, g.section) : null,
      g.qn && g.qn !== "・" ? h("span", null, `問 ${g.qn}`) : null,
      h("span", { class: "pp-index" }, `${st.cur + 1} / ${B.length}`));
    promptEl.replaceChildren(renderPrompt(b));
    answerEl.replaceChildren(...answerArea(b).filter(Boolean));
    prevBtn.disabled = st.cur === 0;
    const last = st.cur === B.length - 1;
    nextBtn.querySelector("span:last-child").textContent = last ? (locked() ? "最初へ" : exam ? "提出へ" : "採点へ") : "次へ";
    drawMap();
    syncSheet();
    const cur = promptEl.querySelector(".pchip.is-cur");
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  function select(i) {
    if (i < 0 || i >= B.length) return;
    st.cur = i;
    save();
    draw();
    scrollSheet();
  }
  function next() {
    if (st.cur < B.length - 1) select(st.cur + 1);
    else if (locked()) select(0);
    else if (exam) submit(false);
    else gradeAll();
  }

  ui.setKeys((e) => {
    if (e.target.closest && e.target.closest("input, textarea, select")) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); select(st.cur + 1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); select(st.cur - 1); }
    else {
      const b = B[st.cur];
      if (b.type === "choice" && !locked()) {
        const k = e.key.normalize("NFKC");
        const n = Number(k);
        const opt = n >= 1 && n <= b.options.length ? b.options[n - 1] : b.options.find((o) => o === k);
        if (opt) { e.preventDefault(); setAnswer(b, opt); if (st.instant) checkOne(b); else next(); }
      }
    }
  });

  // 提出したあと（合言葉のいらない試験）で、まだ採点していなければ採点する
  if (exam && submitted() && !st.graded && !P.meta.sealed.pass) await openAndGrade("");
  // 先生が結果を公開して、合言葉を入れていれば答え合わせする
  if (exam && submitted() && !st.graded && classRef && cls.assign && cls.assign.resultsOpen && cls.assign.answerKey) await openAndGrade(cls.assign.answerKey);
  // 提出したのに先生に届いていなければ、もう一度送る
  if (classRef && st.classPending && (submitted() || st.graded)) await sendToClass();
  draw();
}
