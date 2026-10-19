// SK Study のプリント形式（変換ツールが書き出す HTML と、試験用の答えの暗号化）
//   ・プリントのデータ（変換ツールで作る・直す）
//       { title, articles: [{ title, sections: [{ name, questions: [{ n, text, choices: [{ k, t }], blanks: [{ kind, answer, alts }], explanation }] }] }] }
//       text の {{1}} {{2}} … が解答欄（blanks の順）。__語__ は傍線。改行はそのまま
//       kind: box（四角。自動で採点）/ choice（記号）/ lines（記述。自分で採点）
//   ・書き出す HTML は print.js の parsePrint() で読める形（.page・.title h1・.sec・.q・.qn・.box・.lines・.ans・.a・.ex）
//       解答欄には data-type（auto / choice / self）と、記号なら data-options（アイウエ）を付ける
//   ・用途
//       練習 … 最後に解答のページ（.ans）を付ける（印刷しても答えが読める）
//       試験 … 解答のページは付けず、答えを暗号化して <script type="application/json" id="sk-print-data"> に入れる
//              合言葉があれば、合言葉を入れるまで答えは出せない（PBKDF2 + AES-GCM）。なければ鍵もファイルに入れる（のぞき見よけ）
//              暗号の中にも「試験・制限時間」を入れておき、ファイルの書きかえ（試験の設定を消すなど）を見つける
export const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳㉑㉒㉓㉔㉕㉖㉗㉘㉙㉚㉛㉜㉝㉞㉟";
const CHOICES = "アイウエオカキクケコ";
const enc = new TextEncoder();
const dec = new TextDecoder();

export const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- 暗号 ----------

function b64(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const rand = (n) => crypto.getRandomValues(new Uint8Array(n));
export const normPass = (s) => String(s || "").normalize("NFKC").trim();

async function deriveKey(secret, salt) {
  const base = await crypto.subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function sealAnswers(payload, passphrase) {
  const pass = normPass(passphrase);
  const salt = rand(16), iv = rand(12);
  const secret = pass || b64(rand(24));
  const key = await deriveKey(secret, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(payload))));
  const sealed = { salt: b64(salt), iv: b64(iv), ct: b64(ct), pass: !!pass };
  if (!pass) sealed.k = secret;
  return sealed;
}

// 合言葉がちがうと失敗する（throw）
export async function openAnswers(sealed, passphrase) {
  const secret = sealed.pass ? normPass(passphrase) : sealed.k;
  if (!secret) throw new Error("no-pass");
  const key = await deriveKey(secret, unb64(sealed.salt));
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) }, key, unb64(sealed.ct));
  return JSON.parse(dec.decode(plain));
}

// ---------- HTML を作る ----------

function sizeOf(answer) {
  const n = [...String(answer || "")].length;
  return n <= 2 ? "s" : n <= 6 ? "m" : n <= 12 ? "l" : "xl";
}

function optionsOf(q) {
  const keys = (q.choices || []).map((c) => String(c.k || "").normalize("NFKC").trim()).filter((k) => k.length === 1);
  return keys.length >= 2 ? keys.join("") : CHOICES.slice(0, 4);
}

function blankHtml(b, i, multi, q) {
  const label = multi ? ` data-n="${CIRCLED[i] || i + 1}"` : "";
  if (b.kind === "lines") {
    const rows = Math.min(3, Math.max(1, Math.ceil([...String(b.answer || "")].length / 30)));
    return `<span class="lines r${rows}"${label} data-type="self"></span>`;
  }
  if (b.kind === "choice") return `<span class="box s"${label} data-type="choice" data-options="${esc(optionsOf(q))}"></span>`;
  return `<span class="box ${sizeOf(b.answer)}"${label} data-type="auto"></span>`;
}

function questionHtml(q) {
  const blanks = q.blanks || [];
  const multi = blanks.length > 1;
  const used = new Set();
  let body = esc(q.text || "")
    .replace(/__(.+?)__/g, '<span class="bs">$1</span>')
    .replace(/\{\{(\d+)\}\}/g, (m, n) => {
      const i = Number(n) - 1;
      if (!blanks[i] || used.has(i)) return "";
      used.add(i);
      return blankHtml(blanks[i], i, multi, q);
    })
    .replace(/\r?\n/g, "<br>");
  const rest = blanks.map((b, i) => (used.has(i) ? "" : blankHtml(b, i, multi, q))).join("");
  const choices = (q.choices || []).length
    ? `<span class="choice">${q.choices.map((c) => `<span>${esc(c.k)}　${esc(c.t)}</span>`).join("")}</span>`
    : "";
  return `<div class="q"><span class="body"><span class="qn">${esc(q.n)}</span>${body}${rest}</span>${choices}</div>`;
}

function answerText(q) {
  const blanks = q.blanks || [];
  const one = (b) => `${b.answer || ""}${(b.alts || []).filter(Boolean).map((a) => `（${a}）`).join("")}`;
  if (blanks.length === 1) return one(blanks[0]);
  return blanks.map((b, i) => `${CIRCLED[i] || i + 1}${one(b)}`).join("　");
}

// 番号が空・重なっているときは振り直す（解答と問題を番号で結ぶため）
export function tidy(data) {
  for (const a of data.articles || []) {
    for (const s of a.sections || []) {
      const seen = new Set();
      (s.questions || []).forEach((q, i) => {
        let n = String(q.n || "").trim() || String(i + 1);
        while (seen.has(n)) n += "'";
        seen.add(n);
        q.n = n;
        // 解答欄を、問題文に出てくる順に並べかえて {{n}} を振り直す（答えの順と、画面に出る順をそろえる）
        const blanks = (q.blanks || []).filter((b) => b && b.kind);
        const order = [];
        String(q.text || "").replace(/\{\{(\d+)\}\}/g, (m, k) => { const j = Number(k) - 1; if (blanks[j] && !order.includes(j)) order.push(j); return m; });
        blanks.forEach((b, j) => { if (!order.includes(j)) order.push(j); });
        q.text = String(q.text || "").replace(/\{\{(\d+)\}\}/g, (m, k) => { const j = order.indexOf(Number(k) - 1); return j >= 0 ? `{{${j + 1}}}` : ""; });
        q.blanks = order.map((j) => blanks[j]);
      });
    }
  }
  return data;
}

const TEMPLATE_CSS = `
@page { size: A4 landscape; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; color: #111; }
body { font-family: "UD Digi Kyokasho N-R", "UD デジタル 教科書体 N-R", "Hiragino Mincho ProN", "Yu Mincho", serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.page { width: 297mm; min-height: 210mm; padding: 12mm 14mm 14mm; position: relative; break-after: page; }
.page:last-child { break-after: auto; }
.page-image { padding: 0; min-height: 0; }
.page-image img { display: block; width: 100%; height: auto; }
.cols { column-count: 2; column-gap: 10mm; column-rule: 1px solid #ddd; }
.title { display: flex; align-items: baseline; gap: 4mm; border-bottom: 2px solid #111; padding-bottom: 2mm; margin-bottom: 5mm; }
.title h1 { font-size: 17pt; margin: 0; letter-spacing: .05em; }
.tag { border: 1px solid #111; padding: .5mm 2mm; font-size: 9pt; }
.sec { font-weight: 700; font-size: 11pt; margin: 3mm 0 2mm; break-after: avoid; }
.q { font-size: 11pt; line-height: 2.1; margin-bottom: 3mm; break-inside: avoid; }
.q .qn { font-weight: 700; margin-right: .6em; }
.box { display: inline-block; vertical-align: middle; height: 1.9em; border: 1px solid #222; margin: .2em .3em; position: relative; }
.box.s { width: 3em; } .box.m { width: 6.5em; } .box.l { width: 11em; } .box.xl { width: 18em; max-width: 100%; }
.box[data-n]::before, .lines[data-n]::before { content: attr(data-n); position: absolute; top: -1.15em; left: 0; font-size: 8pt; line-height: 1; }
.lines { display: block; position: relative; width: 100%; border: 1px solid #222; margin: 4mm 0 1.5mm;
  background: repeating-linear-gradient(to bottom, transparent 0, transparent calc(9mm - 1px), #bbb calc(9mm - 1px), #bbb 9mm); }
.lines.r1 { height: 9mm; } .lines.r2 { height: 18mm; } .lines.r3 { height: 27mm; }
.choice { display: block; padding-left: 1.6em; }
.choice span { display: block; padding-left: 1em; text-indent: -1em; line-height: 1.75; }
.bs { text-decoration: underline; text-underline-offset: 3px; }
.ans { font-size: 10.5pt; line-height: 1.85; margin-bottom: 2mm; break-inside: avoid; }
.ans .qn { font-weight: 700; margin-right: .5em; }
.ans .a { color: #b0262a; font-weight: 700; }
.ans .ex { display: block; font-size: 9.5pt; color: #333; padding-left: 1.6em; }
.exam-note { font-size: 9pt; border: 1px solid #111; padding: 2mm 3mm; margin-bottom: 4mm; }
`;

// data … プリントのデータ、opt … { mode: practice|exam, minutes, passphrase, images: [{ page, src }] }
export async function buildPrintHtml(data, opt = {}) {
  tidy(data);
  const exam = opt.mode === "exam";
  const minutes = exam ? Math.max(0, Math.round(Number(opt.minutes) || 0)) : 0;
  const parts = [];
  for (const img of opt.images || []) {
    parts.push(`<section class="page page-image"><img src="${esc(img.src)}" alt="${esc(img.page)} ページ"></section>`);
  }
  for (const a of data.articles || []) {
    const qs = (a.sections || []).map((s) => `${s.name ? `<div class="sec">◆${esc(s.name)}◆</div>` : ""}${(s.questions || []).map(questionHtml).join("")}`).join("");
    parts.push(`<section class="page qpage"><div class="title"><h1>${esc(a.title || data.title)}</h1><div class="tag">問　題</div></div>` +
      (exam ? `<div class="exam-note">試験用のプリントです。SK Study の全画面で解きます${minutes ? `（制限時間 ${minutes} 分）` : ""}。提出は 1 回だけです。</div>` : "") +
      `<div class="cols">${qs}</div></section>`);
  }
  let meta = { v: 1, mode: exam ? "exam" : "practice", generator: "SK Study" };
  if (exam) {
    // 答え: 解答欄の順（parsePrint() で見つかる順）に並べる。解説は、その問題の最初の解答欄の番号に付ける
    const answers = [];
    const ex = {};
    for (const a of data.articles || []) for (const s of a.sections || []) for (const q of s.questions || []) {
      if (!(q.blanks || []).length) continue;
      if (q.explanation) ex[answers.length] = [q.explanation];
      for (const b of q.blanks) answers.push({ a: b.answer || "", alts: (b.alts || []).filter(Boolean) });
    }
    meta = { ...meta, minutes, once: true, sealed: await sealAnswers({ mode: "exam", minutes, answers, ex }, opt.passphrase) };
  } else {
    for (const a of data.articles || []) {
      const body = (a.sections || []).map((s) => `${s.name ? `<div class="sec">◆${esc(s.name)}◆</div>` : ""}${(s.questions || []).filter((q) => (q.blanks || []).length).map((q) =>
        `<div class="ans"><span class="body"><span class="qn">${esc(q.n)}</span><span class="a">${esc(answerText(q))}</span></span>${q.explanation ? `<span class="ex">${esc(q.explanation)}</span>` : ""}</div>`).join("")}`).join("");
      parts.push(`<section class="page"><div class="title"><h1>${esc(a.title || data.title)}</h1><div class="tag">解答・解説</div></div><div class="cols">${body}</div></section>`);
    }
  }
  const json = JSON.stringify(meta).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${esc(data.title || "プリント")}</title>
<meta name="generator" content="SK Study プリント変換">
<style>${TEMPLATE_CSS}</style>
<script type="application/json" id="sk-print-data">${json}</script>
</head>
<body>
${parts.join("\n")}
</body>
</html>
`;
}

// HTML の中の SK Study のしるし（なければ null）
export function readPrintMeta(doc) {
  const el = doc.getElementById("sk-print-data");
  if (!el) return null;
  try { return JSON.parse(el.textContent || "null"); } catch (e) { return null; }
}
