// SK Study のプリント変換ツール（#/maker。パソコン向け）
//   PDF を選ぶ → 用途（練習・試験）を決める → Gemini で読み取る（または自分で入力）→ 確かめて直す → SK Study に追加・HTML を保存
//   ・PDF の表示とページの画像は PDF.js（cdn.jsdelivr.net）。PDF はブラウザの中で読み、AI を使うときだけ Google に送る
//   ・できあがりの HTML は printfmt.js の buildPrintHtml()（試験用は答えを暗号化）
//   ・元のページを画像で入れるのは「問題」のページだけ（解答のページは入れない）
import { buildPrintHtml, tidy } from "./printfmt.js";
import * as gemini from "./gemini.js";
import { addPrint } from "./print.js";

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
const IMAGE_WIDTH = 1400;
const ROLES = [["q", "問題"], ["a", "解答"], ["skip", "使わない"]];
const KINDS = [["box", "語句・漢字など（自動採点）"], ["choice", "記号"], ["lines", "記述（自己採点）"]];

// replaceChildren・append は null を「null」という文字にしてしまうので、null を除いて入れる
const present = (kids) => kids.flat(Infinity).filter((k) => k != null && k !== false);
const put = (el, ...kids) => el.replaceChildren(...present(kids));
const add = (el, ...kids) => el.append(...present(kids));

let pdfjs = null;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import(PDFJS);
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  }
  return pdfjs;
}

const newQuestion = (n = "1") => ({ n, text: "", choices: [], blanks: [{ kind: "box", answer: "", alts: [] }], explanation: "" });

export function renderMaker(ui) {
  const { h, icon, button, toast, go, app, confirmDialog } = ui;
  document.title = "PDF からプリントを作る - SK Study";
  const S = { name: "", bytes: null, pdf: null, pages: [], data: null, mode: "practice", minutes: 30, pass: "", images: true, busy: false };

  const pagesEl = h("div", { class: "mk-pages" });
  const fileInfo = h("p", { class: "muted small" }, "PDF を選ぶか、ここにドラッグしてください。");
  const fileInput = h("input", { type: "file", accept: "application/pdf,.pdf", hidden: true });
  const drop = h("div", { class: "mk-drop", tabindex: "0", role: "button", "aria-label": "PDF を選ぶ" },
    icon("picture_as_pdf", "mk-drop-icon"), h("strong", null, "PDF を選ぶ"), fileInfo, fileInput);
  const editorCard = h("section", { class: "mk-card mk-editor", hidden: true });
  const exportCard = h("section", { class: "mk-card", hidden: true });

  // ---- 1. PDF ----
  async function openPdf(file) {
    if (!file) return;
    if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) { toast("PDF のファイルを選んでください"); return; }
    if (S.data && !(await confirmDialog("PDF を選び直しますか？", "読み取った内容は消えます。", "選び直す", true))) return;
    S.name = file.name.replace(/\.pdf$/i, "");
    S.bytes = await file.arrayBuffer();
    S.data = null;
    editorCard.hidden = true;
    exportCard.hidden = true;
    fileInfo.textContent = "読み込み中…";
    try {
      const lib = await loadPdfjs();
      S.pdf = await lib.getDocument({ data: S.bytes.slice(0) }).promise;
    } catch (e) {
      console.error(e);
      fileInfo.textContent = "PDF を読めませんでした。";
      return;
    }
    fileInfo.textContent = `${file.name}（${S.pdf.numPages} ページ・${(file.size / 1024 / 1024).toFixed(1)} MB）`;
    S.pages = Array.from({ length: S.pdf.numPages }, (_, i) => ({ n: i + 1, role: "q", thumb: "" }));
    drawPages();
    for (const p of S.pages) {
      p.thumb = await renderPage(p.n, 180, "image/png");
      drawPages();
    }
    drawAi();
  }
  async function renderPage(n, width, type = "image/jpeg") {
    const page = await S.pdf.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / vp1.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return canvas.toDataURL(type, 0.78);
  }
  function drawPages() {
    pagesEl.replaceChildren(...S.pages.map((p) => h("figure", { class: `mk-page role-${p.role}` },
      p.thumb ? h("img", { src: p.thumb, alt: `${p.n} ページ` }) : h("div", { class: "mk-page-loading" }, h("span", { class: "spinner" })),
      h("figcaption", null,
        h("span", null, `${p.n}`),
        h("div", { class: "mk-roles", role: "radiogroup", "aria-label": `${p.n} ページの種類` }, ROLES.map(([k, label]) => h("button", {
          type: "button", role: "radio", "aria-checked": String(p.role === k), onclick: () => { p.role = k; drawPages(); }
        }, label)))))));
  }
  drop.addEventListener("click", () => fileInput.click());
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener("change", () => { const f = fileInput.files && fileInput.files[0]; fileInput.value = ""; openPdf(f); });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("is-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("is-over"));
  drop.addEventListener("drop", (e) => { e.preventDefault(); drop.classList.remove("is-over"); openPdf(e.dataTransfer.files[0]); });

  // ---- 2. 用途 ----
  const modeCard = h("section", { class: "mk-card" });
  function drawMode() {
    const radio = (value, title, desc) => h("label", { class: `mk-mode${S.mode === value ? " is-on" : ""}` },
      h("input", { type: "radio", name: "mk-mode", value, checked: S.mode === value, onchange: () => { S.mode = value; drawMode(); drawExport(); } }),
      h("span", null, h("strong", null, title), h("small", null, desc)));
    const minutes = h("input", { type: "number", class: "field-input", min: "0", max: "600", value: String(S.minutes), "aria-label": "制限時間（分）" });
    minutes.addEventListener("input", () => { S.minutes = Math.max(0, Math.min(600, Number(minutes.value) || 0)); drawExport(); });
    const pass = h("input", { type: "text", class: "field-input", value: S.pass, maxlength: "64", autocomplete: "off", placeholder: "例: さくら2026（空なら提出後すぐ採点）" });
    pass.addEventListener("input", () => { S.pass = pass.value; drawExport(); });
    const images = h("input", { type: "checkbox", checked: S.images, onchange: (e) => { S.images = e.target.checked; } });
    put(modeCard, 
      h("h2", null, h("span", { class: "mk-step" }, "2"), "用途"),
      h("div", { class: "mk-modes" },
        radio("practice", "練習用", "いつでも解き直せる。答え合わせは最後か 1 問ずつ。解答のページも付く"),
        radio("exam", "試験用", "全画面でないと解けない・提出は 1 回・答えは暗号化して隠す")),
      S.mode === "exam" ? h("div", { class: "mk-exam" },
        h("div", { class: "field-row" },
          h("label", { class: "field mk-minutes" }, h("span", { class: "field-label" }, "制限時間（分。0 でなし）"), minutes),
          h("label", { class: "field" }, h("span", { class: "field-label" }, "答え合わせの合言葉（任意）"), pass)),
        h("ul", { class: "mk-rules" },
          h("li", null, "全画面でないと問題が見えません。全画面をやめる・ほかのタブやアプリに移ると、回数と時間が記録されます。"),
          h("li", null, "時間になると自動で提出します。提出は 1 回だけです。"),
          h("li", null, "答えは暗号化して入れます。合言葉を決めると、合言葉を入れるまで答え合わせができません（試験のあとに伝えてください）。"),
          h("li", null, "ブラウザの中だけで動くので、ほかの端末を見るなどは防げません。"))) : null,
      h("label", { class: "switch-row" }, images, h("span", null, h("strong", null, "元のプリントのページを画像で入れる"), h("small", null, "問題のページだけ。図や本文も元のまま見られます（ファイルが大きくなります）"))));
  }

  // ---- 3. 読み取り ----
  const aiCard = h("section", { class: "mk-card" });
  let models = [];
  function drawAi() {
    const key = h("input", { type: "password", class: "field-input", value: gemini.savedKey(), autocomplete: "off", placeholder: "AIza…", "aria-label": "Gemini API キー" });
    const remember = h("input", { type: "checkbox", checked: !!gemini.savedKey() });
    const modelSel = h("select", { class: "field-select", "aria-label": "モデル" },
      models.length ? models.map((m) => h("option", { value: m.id, selected: m.id === (gemini.savedModel() || models[0].id) }, m.id))
        : h("option", { value: "" }, "（キーを入れて「モデルを読みこむ」）"));
    const hint = h("input", { type: "text", class: "field-input", placeholder: "補足（任意）例: 国語。縦書き。解答は最後の 2 ページ", "aria-label": "AI への補足" });
    const status = h("p", { class: "mk-status", "aria-live": "polite" });
    const loadModels = async () => {
      if (!key.value.trim()) { toast("API キーを入れてください"); key.focus(); return; }
      status.textContent = "モデルを読みこみ中…";
      try {
        models = await gemini.listModels(key.value.trim());
        if (remember.checked) gemini.rememberKey(key.value.trim());
        status.textContent = models.length ? "" : "使えるモデルが見つかりませんでした。";
        drawAi();
      } catch (e) {
        status.textContent = e.message;
      }
    };
    const run = async () => {
      if (!S.bytes) { toast("先に PDF を選んでください"); return; }
      if (S.bytes.byteLength > gemini.MAX_PDF) { toast("PDF が大きすぎます（18MB まで）。ページを分けてください"); return; }
      if (!key.value.trim()) { toast("API キーを入れてください"); key.focus(); return; }
      if (!modelSel.value) { await loadModels(); return; }
      if (S.data && !(await confirmDialog("読み取り直しますか？", "直した内容は消えます。", "読み取り直す", true))) return;
      gemini.rememberKey(remember.checked ? key.value.trim() : "");
      gemini.rememberModel(modelSel.value);
      S.busy = true;
      runBtn.disabled = true;
      const t0 = Date.now();
      const timer = setInterval(() => { status.textContent = `読み取り中…（${Math.round((Date.now() - t0) / 1000)} 秒。長いプリントは 1〜2 分かかります）`; }, 500);
      try {
        const data = await gemini.convertPdf({ key: key.value.trim(), model: modelSel.value, pdf: S.bytes, hint: hint.value.trim() });
        S.data = tidy({ title: data.title || S.name, articles: data.articles || [] });
        const ans = new Set((data.answerPages || []).map(Number));
        if (ans.size) S.pages.forEach((p) => { p.role = ans.has(p.n) ? "a" : p.role === "skip" ? "skip" : "q"; });
        drawPages();
        status.textContent = "読み取りました。下で確かめて、まちがいを直してください。";
        drawEditor();
        editorCard.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (e) {
        status.textContent = e.message || "読み取れませんでした。";
      } finally {
        clearInterval(timer);
        S.busy = false;
        runBtn.disabled = false;
      }
    };
    const runBtn = button("filled", "AI で読み取る", "auto_awesome", run);
    put(aiCard, 
      h("h2", null, h("span", { class: "mk-step" }, "3"), "読み取る"),
      h("p", { class: "muted small" }, "Google の Gemini（無料枠あり）で、問題・解答欄・答えを読み取ります。API キーは自分のものを使います（SK のサーバーは通りません）。"),
      h("div", { class: "field-row" },
        h("label", { class: "field" }, h("span", { class: "field-label" }, "Gemini API キー"), key),
        h("label", { class: "field mk-model" }, h("span", { class: "field-label" }, "モデル"), modelSel)),
      h("div", { class: "mk-row" },
        h("label", { class: "switch-row" }, remember, h("span", null, "この端末にキーを保存する")),
        h("a", { href: "https://aistudio.google.com/apikey", target: "_blank", rel: "noopener" }, "API キーを作る（Google AI Studio）"),
        button("text", "モデルを読みこむ", "refresh", loadModels)),
      hint,
      h("p", { class: "warn small" }, icon("shield"), "無料枠では、送った内容が Google のサービス改善に使われることがあります。氏名など個人の情報が入った PDF は送らないでください。"),
      h("div", { class: "mk-row" }, runBtn,
        button("text", "AI を使わずに自分で入力する", "edit", async () => {
          if (S.data && !(await confirmDialog("最初から入力しますか？", "読み取った内容は消えます。", "最初から", true))) return;
          S.data = { title: S.name || "プリント", articles: [{ title: S.name || "プリント", sections: [{ name: "", questions: [newQuestion()] }] }] };
          drawEditor();
          editorCard.scrollIntoView({ behavior: "smooth", block: "start" });
        })),
      status);
    if (!models.length && key.value.trim()) loadModels();
  }

  // ---- 4. 確かめて直す ----
  function field(label, el, cls = "") { return h("label", { class: `field ${cls}` }, h("span", { class: "field-label" }, label), el); }
  function text(obj, k, attrs = {}) {
    const el = h(attrs.rows ? "textarea" : "input", { class: "field-input", type: attrs.rows ? null : "text", ...attrs });
    el.value = obj[k] || "";
    el.addEventListener("input", () => { obj[k] = el.value; drawCounts(); });
    return el;
  }
  const countsEl = h("p", { class: "mk-counts" });
  function drawCounts() {
    if (!S.data) return;
    let q = 0, b = 0, empty = 0;
    for (const a of S.data.articles) for (const s of a.sections) for (const x of s.questions) { q++; for (const y of x.blanks) { b++; if (!String(y.answer || "").trim()) empty++; } }
    put(countsEl, `問題 ${q}・解答欄 ${b}`, empty ? h("span", { class: "warn" }, ` ・ 答えが空 ${empty}`) : null);
    drawExport();
  }
  function choicesText(q) { return (q.choices || []).map((c) => `${c.k}　${c.t}`).join("\n"); }
  function parseChoices(v) {
    return v.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const m = /^(\S)[\s　.．、:：]*(.*)$/.exec(l);
      return m ? { k: m[1], t: m[2] } : null;
    }).filter(Boolean);
  }
  function questionCard(sec, q, qi) {
    const markers = (String(q.text || "").match(/\{\{\d+\}\}/g) || []).length;
    const choices = h("textarea", { class: "field-input", rows: "3", placeholder: "ア　選択肢の文\nイ　…" });
    choices.value = choicesText(q);
    choices.addEventListener("input", () => { q.choices = parseChoices(choices.value); });
    const blanks = h("table", { class: "mk-blanks" },
      h("thead", null, h("tr", null, h("th", null, "#"), h("th", null, "種類"), h("th", null, "答え"), h("th", null, "別解（/ で区切る）"), h("th", null, ""))),
      h("tbody", null, q.blanks.map((b, bi) => {
        const kind = h("select", { class: "field-select", "aria-label": "種類" }, KINDS.map(([k, label]) => h("option", { value: k, selected: b.kind === k }, label)));
        kind.addEventListener("change", () => { b.kind = kind.value; });
        const alts = h("input", { type: "text", class: "field-input", value: (b.alts || []).join(" / ") });
        alts.addEventListener("input", () => { b.alts = alts.value.split(/[/／]/).map((s) => s.trim()).filter(Boolean); });
        const ans = text(b, "answer", { "aria-label": `解答欄 ${bi + 1} の答え` });
        if (!String(b.answer || "").trim()) ans.classList.add("is-empty");
        ans.addEventListener("input", () => ans.classList.toggle("is-empty", !ans.value.trim()));
        return h("tr", null,
          h("td", { class: "mk-bn" }, `{{${bi + 1}}}`), h("td", null, kind), h("td", null, ans), h("td", null, alts),
          h("td", null, h("button", { type: "button", class: "icon-btn", title: "この解答欄を消す", "aria-label": "この解答欄を消す", onclick: () => { q.blanks.splice(bi, 1); drawEditor(); } }, icon("close"))));
      })));
    return h("div", { class: "mk-q" },
      h("div", { class: "mk-q-head" },
        field("番号", text(q, "n"), "mk-n"),
        h("span", { class: "muted small" }, markers === q.blanks.length ? "" : `問題文の {{n}} が ${markers} 個、解答欄が ${q.blanks.length} 個（足りない解答欄は文の最後に付きます）`),
        h("button", { type: "button", class: "icon-btn", title: "この問題を消す", "aria-label": "この問題を消す", onclick: () => { sec.questions.splice(qi, 1); drawEditor(); } }, icon("delete"))),
      field("問題文（{{1}} が解答欄、__語__ が傍線）", text(q, "text", { rows: "3" })),
      field("選択肢（1 行に 1 つ）", choices),
      blanks,
      h("div", { class: "mk-row" },
        button("text", "解答欄を足す", "add", () => {
          q.blanks.push({ kind: "box", answer: "", alts: [] });
          q.text = `${q.text || ""}{{${q.blanks.length}}}`;
          drawEditor();
        })),
      field("解説（任意）", text(q, "explanation", { rows: "2" })));
  }
  function drawEditor() {
    if (!S.data) { editorCard.hidden = true; return; }
    tidy(S.data);
    editorCard.hidden = false;
    exportCard.hidden = false;
    put(editorCard, 
      h("div", { class: "mk-editor-head" }, h("h2", null, h("span", { class: "mk-step" }, "4"), "確かめて直す"), countsEl),
      h("p", { class: "muted small" }, "AI はまちがえることがあります。とくに答え（試験用はあとから見られません）を、もとの PDF と見くらべて確かめてください。答えが空の解答欄は採点されません。"),
      field("プリントの名前", text(S.data, "title")),
      ...S.data.articles.map((a, ai) => h("div", { class: "mk-article" },
        h("div", { class: "mk-q-head" },
          field("作品・単元", text(a, "title"), "grow"),
          h("button", { type: "button", class: "icon-btn", title: "この作品・単元を消す", "aria-label": "この作品・単元を消す", onclick: async () => {
            if (await confirmDialog("消しますか？", `「${a.title || "（名前なし）"}」の問題をすべて消します。`, "消す", true)) { S.data.articles.splice(ai, 1); drawEditor(); }
          } }, icon("delete"))),
        ...a.sections.map((s, si) => h("div", { class: "mk-section" },
          h("div", { class: "mk-q-head" },
            field("節（◆…◆。なくてもよい）", text(s, "name"), "grow"),
            h("button", { type: "button", class: "icon-btn", title: "この節を消す", "aria-label": "この節を消す", onclick: () => { a.sections.splice(si, 1); drawEditor(); } }, icon("delete"))),
          ...s.questions.map((q, qi) => questionCard(s, q, qi)),
          button("text", "問題を足す", "add", () => { s.questions.push(newQuestion(String(s.questions.length + 1))); drawEditor(); }))),
        button("text", "節を足す", "add", () => { a.sections.push({ name: "", questions: [newQuestion()] }); drawEditor(); }))),
      button("tonal", "作品・単元を足す", "add", () => { S.data.articles.push({ title: "", sections: [{ name: "", questions: [newQuestion()] }] }); drawEditor(); }));
    drawCounts();
  }

  // ---- 5. できあがり ----
  async function build() {
    const images = [];
    if (S.images && S.pdf) {
      for (const p of S.pages) if (p.role === "q") images.push({ page: p.n, src: await renderPage(p.n, IMAGE_WIDTH) });
    }
    return buildPrintHtml(JSON.parse(JSON.stringify(S.data)), { mode: S.mode, minutes: S.minutes, passphrase: S.pass, images });
  }
  function drawExport() {
    if (!S.data) return;
    let empty = 0;
    for (const a of S.data.articles) for (const s of a.sections) for (const x of s.questions) for (const y of x.blanks) if (!String(y.answer || "").trim()) empty++;
    const status = h("p", { class: "mk-status", "aria-live": "polite" });
    const busy = async (label, fn) => {
      status.textContent = label;
      try { await fn(); status.textContent = ""; } catch (e) { console.error(e); status.textContent = e.message || "うまくいきませんでした"; }
    };
    put(exportCard, 
      h("h2", null, h("span", { class: "mk-step" }, "5"), "できあがり"),
      h("ul", { class: "mk-summary" },
        h("li", null, icon(S.mode === "exam" ? "timer" : "school"), S.mode === "exam" ? `試験用（${S.minutes ? `制限時間 ${S.minutes} 分` : "制限時間なし"}・${S.pass.trim() ? "合言葉あり" : "合言葉なし"}）` : "練習用"),
        empty ? h("li", { class: "warn" }, icon("warning"), `答えが空の解答欄が ${empty} 個あります（採点されません）`) : null),
      h("div", { class: "mk-row" },
        button("filled", "SK Study に追加して開く", "library_add", () => busy("作っています…", async () => {
          const html = await build();
          const id = await addPrint(html, S.data.title);
          S.data = null; // 保存したので、離れても注意しない
          toast("プリントを追加しました");
          go(`/print/${encodeURIComponent(id)}`);
        })),
        button("outlined", "HTML ファイルを保存", "download", () => busy("作っています…", async () => {
          const html = await build();
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([html], { type: "text/html" }));
          a.download = `${(S.data.title || "プリント").replace(/[\\/:*?"<>|]/g, "_")}${S.mode === "exam" ? "_試験" : ""}.html`;
          document.body.append(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        }))),
      S.mode === "exam" ? h("p", { class: "muted small" }, "保存した HTML を配ると、受け取った人は SK Study の「プリントを追加」で試験を受けられます。") : null,
      status);
  }

  // ---- 画面 ----
  drawMode();
  drawAi();
  add(app,
    h("a", { class: "back-link", href: "#/" }, icon("arrow_back"), h("span", null, "ホーム")),
    h("div", { class: "mk-head" },
      h("h1", null, "PDF からプリントを作る"),
      h("p", { class: "muted" }, "PDF のプリントを、SK Study で解けるプリント（HTML）に変換します。解答欄を見つけて、答えは隠して自動で採点します。")),
    window.innerWidth < 900 ? h("p", { class: "pc-note" }, icon("computer"), "この画面はパソコン向けです。") : null,
    h("div", { class: "mk-grid" },
      h("section", { class: "mk-card" }, h("h2", null, h("span", { class: "mk-step" }, "1"), "PDF を選ぶ"), drop, pagesEl),
      h("div", { class: "mk-side" }, modeCard, aiCard)),
    editorCard,
    exportCard);

  const onBeforeUnload = (e) => { if (S.data) { e.preventDefault(); e.returnValue = ""; } };
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("hashchange", () => window.removeEventListener("beforeunload", onBeforeUnload), { once: true });
}
