// SK Study の指導者メニュー（パソコン向け）。データは cloud.js、権限は y-filter の systems/firestore.rules の「SK Study」
//   #/teach              申し込み（まだ指導者でないとき）・クラスの一覧
//   #/teach/<cid>        クラス（参加コード・配信・生徒）
//   #/teach/<cid>/new    配信する（単語帳・単語の小テスト・プリント）
//   #/teach/<cid>/<aid>  結果（提出の一覧・採点・結果の公開）
//   プリントの採点は print.js の gradeAnswers()。試験用は、合言葉で暗号を開いてから採点する（合言葉はこの画面の中だけで使う）
//   結果を生徒に見せるとき、試験用のプリントは合言葉を課題に入れる（生徒の画面で答え合わせができるように）
import * as cloud from "./cloud.js";
import * as store from "./store.js";
import { getHtml, gradeAnswers, listPrints, parsePrint, tally } from "./print.js";
import { normPass, openAnswers } from "./printfmt.js";
import { fmtDue, kindInfo } from "./classroom.js";

const FORMAT_LABEL = { auto: "おまかせ（4 択と書き取り）", choice: "4 択だけ", write: "書き取りだけ" };
const MARK_LABEL = { ok: "○", partial: "△", ng: "×", pending: "未採点" };

function loading(ui) {
  ui.app.replaceChildren(ui.h("p", { class: "loading" }, ui.h("span", { class: "spinner", "aria-hidden": "true" }), "読み込み中…"));
}
const fmtDate = (v) => {
  const t = cloud.toMillis(v);
  return t ? new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
};
const enc = new TextEncoder();
const bytes = (s) => enc.encode(s).length;

export async function renderTeach(parts, ui) {
  const { h, icon, linkButton, app } = ui;
  const hash = location.hash;
  document.title = "指導者メニュー - SK Study";
  loading(ui);
  const s = await cloud.session();
  if (location.hash !== hash) return;
  if (s.status !== "ready") {
    app.replaceChildren(h("section", { class: "message" },
      icon("school", "message-icon"),
      h("h1", null, "指導者メニュー"),
      h("p", null, s.status === "offline" ? "SK Hub Systems に接続できませんでした。" : s.status === "not-connected" ? "SK Hub Systems アカウントを SK Study に接続してください。" : "SK Hub Systems アカウントでログインしてください。"),
      s.status === "offline" ? linkButton("filled", "ホームへ", "home", "#/") : linkButton("filled", s.status === "not-connected" ? "SK Study に接続する" : "ログイン", "login", cloud.accountUrl(true))));
    return;
  }
  let ts;
  try { ts = await cloud.teacherState(); } catch (e) { ui.message("指導者メニューを開けませんでした", cloud.explain(e)); return; }
  if (location.hash !== hash) return;
  const [cid, sub] = parts;
  try {
    if (!ts.teacher) await applyView(ts, s, ui);
    else if (!cid) await classesView(ts, ui);
    else if (sub === "new") await newAssignView(cid, ui);
    else if (sub) await resultsView(cid, sub, ui);
    else await classView(cid, ui);
  } catch (e) {
    console.error(e);
    if (location.hash === hash) ui.message("うまく表示できませんでした", cloud.explain(e));
  }
}

function head(ui, title, lead, back) {
  const { h } = ui;
  return [
    back ? ui.backLink(back[0], back[1]) : null,
    h("div", { class: "tc-head" }, h("p", { class: "tc-eyebrow" }, ui.icon("school"), "指導者メニュー"), h("h1", null, title), lead ? h("p", { class: "muted" }, lead) : null)
  ].filter(Boolean);
}

// ---------- 申し込み ----------

async function applyView(ts, s, ui) {
  const { h, icon, button, toast, confirmDialog, app } = ui;
  const appDoc = ts.app;
  const parts = head(ui, "指導者になる", "指導者は、クラスを作って生徒を招き、単語帳・単語の小テスト・プリント（試験も）を配って、提出された答えを見たり採点したりできます。", ["ホーム", "#/"]);
  if (appDoc && appDoc.status === "pending") {
    app.replaceChildren(...parts, h("section", { class: "mk-card" },
      h("h2", null, icon("hourglass_top"), "申し込みを受け付けました"),
      h("p", null, "SK が確認して承認すると、ここからクラスを作れるようになります。しばらくお待ちください。"),
      h("dl", { class: "tc-dl" }, h("dt", null, "名前"), h("dd", null, appDoc.name), h("dt", null, "学校・塾など"), h("dd", null, appDoc.org || "-"), h("dt", null, "使い方"), h("dd", null, appDoc.purpose || "-")),
      h("div", { class: "mk-row" }, button("text", "申し込みを取り消す", "close", async () => {
        if (!(await confirmDialog("申し込みを取り消しますか？", "もう一度申し込むこともできます。", "取り消す", true))) return;
        try { await cloud.cancelTeacherApp(); toast("取り消しました"); renderTeach([], ui); } catch (e) { toast(cloud.explain(e)); }
      }))));
    return;
  }
  const name = h("input", { type: "text", class: "field-input", maxlength: "40", value: (appDoc && appDoc.name) || s.name || "" });
  const org = h("input", { type: "text", class: "field-input", maxlength: "80", value: (appDoc && appDoc.org) || "", placeholder: "例: SK 中学校・SK 学習塾（個人なら空でもよい）" });
  const purpose = h("textarea", { class: "field-input", rows: "3", maxlength: "500", placeholder: "例: 英語の授業で、毎週の単語テストを配りたい" }, (appDoc && appDoc.purpose) || "");
  const agree = h("input", { type: "checkbox" });
  app.replaceChildren(...parts,
    appDoc && appDoc.status === "rejected" ? h("p", { class: "warn" }, icon("info"), `前回の申し込みは承認されませんでした。${appDoc.note ? `（${appDoc.note}）` : ""}内容を見直して、もう一度申し込めます。`) : "",
    h("section", { class: "mk-card" },
      h("h2", null, icon("how_to_reg"), "申し込み"),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "名前（生徒に「〇〇 先生」と表示されます）"), name),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "学校・塾など（任意）"), org),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "どのように使いますか（任意）"), purpose),
      h("label", { class: "switch-row" }, agree, h("span", null, h("strong", null, "生徒の答え・点数・試験の記録を、授業のためだけに使います"), h("small", null, "生徒の個人の情報を、ほかの目的に使ったり、ほかの人に渡したりしません。"))),
      h("div", { class: "mk-row" }, button("filled", "申し込む", "send", async () => {
        if (!name.value.trim()) { toast("名前を入れてください"); name.focus(); return; }
        if (!agree.checked) { toast("チェックを入れてください"); return; }
        try { await cloud.applyTeacher({ name: name.value, org: org.value, purpose: purpose.value }); toast("申し込みました"); renderTeach([], ui); } catch (e) { toast(cloud.explain(e)); }
      }))));
}

// ---------- クラスの一覧 ----------

async function classesView(ts, ui) {
  const { h, icon, button, toast, go, app, openDialog } = ui;
  const classes = await cloud.teacherClasses();
  const create = () => {
    const input = h("input", { type: "text", class: "field-input", maxlength: "60", placeholder: "例: 1 年 A 組 英語" });
    const d = openDialog("クラスを作る", h("div", null, h("p", null, "クラスの名前を入れてください。作ると、生徒に配る参加コードができます。"), input), [
      button("text", "やめる", null, () => d.close()),
      button("filled", "作る", "add", async () => {
        if (!input.value.trim()) { input.focus(); return; }
        try { const cid = await cloud.createClass(input.value, ts.teacher.name); d.close(); go(`/teach/${cid}`); } catch (e) { toast(cloud.explain(e)); }
      })]);
    input.focus();
  };
  app.replaceChildren(...head(ui, `${ts.teacher.name} 先生`, ts.teacher.org || "", ["ホーム", "#/"]),
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, `クラス（${classes.length}）`), button("filled", "クラスを作る", "add", create)),
      classes.length ? h("div", { class: "set-list" }, classes.map((c) => h("div", { class: "set-row" },
        h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon("groups")),
        h("div", { class: "set-row-body" },
          h("a", { class: "set-row-link", href: `#/teach/${encodeURIComponent(c.id)}` },
            h("span", { class: "set-row-sub" }, h("span", { class: "code-pill" }, c.joinCode), h("span", null, c.open ? "参加を受け付け中" : "参加の受け付けは終了")),
            h("span", { class: "set-row-title" }, c.name))),
        h("div", { class: "set-row-end" }, icon("chevron_right")))))
        : h("div", { class: "empty-card" }, icon("groups", "empty-icon"), h("p", null, "まだクラスがありません。クラスを作って、参加コードを生徒に配りましょう。"))),
    h("p", { class: "footnote" }, "指導者メニューはパソコンでの利用を前提にしています。"));
}

// ---------- クラス ----------

async function classView(cid, ui) {
  const { h, icon, button, linkButton, toast, confirmDialog, go, app, openDialog } = ui;
  const [cls, members, assigns] = await Promise.all([cloud.getClass(cid), cloud.members(cid), cloud.allAssignments(cid)]);
  const counts = await Promise.all(assigns.map((a) => cloud.submissions(cid, a.id).then((x) => x.length).catch(() => null)));
  document.title = `${cls.name} - 指導者メニュー`;
  const reload = () => classView(cid, ui);
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast("コピーしました"); } catch (e) { toast("コピーできませんでした"); } };
  const joinUrl = `${location.origin}/study/#/`;

  app.replaceChildren(...head(ui, cls.name, null, ["クラスの一覧", "#/teach"]),
    h("div", { class: "tc-grid" },
      h("section", { class: "mk-card tc-code" },
        h("h2", null, icon("key"), "参加コード"),
        h("p", { class: "code-big", "aria-label": `参加コード ${cls.joinCode.split("").join(" ")}` }, cls.joinCode),
        h("p", { class: "muted small" }, `生徒は SK Study（${joinUrl}）の「クラス」→「参加コードを入れる」で参加します。SK Hub Systems アカウントが要ります。`),
        h("label", { class: "switch-row" },
          h("input", { type: "checkbox", checked: cls.open, onchange: async (e) => {
            try { await cloud.updateClass(cls, { open: e.target.checked }); toast(e.target.checked ? "参加を受け付けます" : "参加の受け付けを終えました"); reload(); } catch (err) { toast(cloud.explain(err)); }
          } }),
          h("span", null, h("strong", null, "参加を受け付ける"), h("small", null, "生徒がそろったら止めておくと安心です"))),
        h("div", { class: "mk-row" },
          button("tonal", "コピー", "content_copy", () => copy(cls.joinCode)),
          button("text", "コードを作り直す", "refresh", async () => {
            if (!(await confirmDialog("参加コードを作り直しますか？", "今のコードは使えなくなります（参加している生徒はそのままです）。", "作り直す"))) return;
            try { await cloud.renewCode(cls); toast("作り直しました"); reload(); } catch (e) { toast(cloud.explain(e)); }
          }))),
      h("section", { class: "mk-card" },
        h("div", { class: "section-head" }, h("h2", null, icon("assignment"), `配信（${assigns.length}）`), linkButton("filled", "配信する", "add", `#/teach/${encodeURIComponent(cid)}/new`)),
        assigns.length ? h("div", { class: "set-list flat" }, assigns.map((a, i) => {
          const k = kindInfo(a);
          return h("div", { class: "set-row" },
            h("span", { class: `thumb kind-${a.kind}${a.print && a.print.exam ? " is-exam" : ""}`, "aria-hidden": "true" }, icon(k.icon)),
            h("div", { class: "set-row-body" },
              h("a", { class: "set-row-link", href: `#/teach/${encodeURIComponent(cid)}/${encodeURIComponent(a.id)}` },
                h("span", { class: "set-row-sub" },
                  h("span", { class: "kind-pill" }, k.name),
                  h("span", { class: a.published ? "pub-pill on" : "pub-pill" }, a.published ? "公開中" : "非公開"),
                  a.resultsOpen ? h("span", { class: "pub-pill on" }, "結果を公開") : null,
                  a.due ? h("span", null, `締め切り ${fmtDue(a.due)}`) : null),
                h("span", { class: "set-row-title" }, a.title)),
              h("span", { class: "set-row-meta" }, h("span", null, icon("inbox"), counts[i] == null ? "-" : `提出 ${counts[i]} / ${members.length}`))),
            h("div", { class: "set-row-end" }, icon("chevron_right")));
        })) : h("p", { class: "muted" }, "まだ配信していません。"))),
    h("section", { class: "mk-card" },
      h("h2", null, icon("group"), `生徒（${members.length}）`),
      members.length ? h("table", { class: "tc-table" },
        h("thead", null, h("tr", null, h("th", null, "名前"), h("th", null, "参加した日"), h("th", null, ""))),
        h("tbody", null, members.map((m) => h("tr", null,
          h("td", null, m.name), h("td", null, fmtDate(m.joinedAt)),
          h("td", { class: "tc-actions" }, button("text", "外す", "person_remove", async () => {
            if (!(await confirmDialog(`${m.name} さんをクラスから外しますか？`, "提出した答えは残ります。もう一度参加するには参加コードが要ります。", "外す", true))) return;
            try { await cloud.removeMember(cid, m.id); toast("外しました"); reload(); } catch (e) { toast(cloud.explain(e)); }
          })))))) : h("p", { class: "muted" }, "まだ生徒がいません。参加コードを配ってください。")),
    h("section", { class: "mk-card" },
      h("h2", null, icon("settings"), "クラスの設定"),
      h("div", { class: "mk-row" },
        button("outlined", "名前を変える", "edit", () => {
          const input = h("input", { type: "text", class: "field-input", maxlength: "60", value: cls.name });
          const d = openDialog("クラスの名前", input, [button("text", "やめる", null, () => d.close()), button("filled", "保存", null, async () => {
            if (!input.value.trim()) return;
            try { await cloud.updateClass(cls, { name: input.value.trim() }); d.close(); reload(); } catch (e) { toast(cloud.explain(e)); }
          })]);
        }),
        button("outlined", "クラスを削除", "delete", async () => {
          if (!(await confirmDialog("クラスを削除しますか？", `「${cls.name}」と、配信した課題・生徒の提出・採点をすべて消します。もとに戻せません。`, "削除する", true))) return;
          try { await cloud.deleteClass(cls); toast("削除しました"); go("/teach", true); } catch (e) { toast(cloud.explain(e)); }
        }, { "data-danger": "" }))));
}

// ---------- 配信する ----------

function setForCloud(set) {
  const clean = store.cleanSet(set);
  const out = { title: clean.title, lang: clean.lang, description: clean.description || "", words: clean.words };
  if (clean.lang === "custom") { out.langName = clean.langName || ""; out.speech = clean.speech || ""; }
  return out;
}

// 元のページの画像を外す（1MB に入れるため）
function stripImages(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll(".page-image").forEach((e) => e.remove());
  return "<!doctype html>" + doc.documentElement.outerHTML;
}

async function newAssignView(cid, ui) {
  const { h, icon, button, toast, go, app } = ui;
  const cls = await cloud.getClass(cid);
  const sets = [...store.getSkSets(), ...store.getMySets()];
  const prints = listPrints().filter((p) => !p.classRef);
  const S = { kind: "wordtest", title: "", setId: sets[0] ? sets[0].id : "", count: 10, format: "auto", printId: prints[0] ? prints[0].id : "", strip: false, due: "", published: true };
  const form = h("div", { class: "tc-form" });
  const status = h("p", { class: "mk-status", "aria-live": "polite" });
  let printInfo = null; // { html, bytes, exam, minutes, blanks, images }

  async function loadPrint() {
    printInfo = null;
    if (!S.printId) { draw(); return; }
    const html = await getHtml(S.printId);
    if (!html) { draw(); return; }
    const P = parsePrint(html);
    printInfo = { html, bytes: bytes(html), exam: P.exam, minutes: P.exam ? Number(P.meta.minutes) || 0 : 0, blanks: P.blanks.length, images: (html.match(/class="page page-image"/g) || []).length, title: P.title };
    if (printInfo.bytes > cloud.PRINT_MAX_BYTES && printInfo.images) S.strip = true;
    draw();
  }

  function draw() {
    const radio = (value, title, desc, ic) => h("label", { class: `mk-mode${S.kind === value ? " is-on" : ""}` },
      h("input", { type: "radio", name: "tc-kind", value, checked: S.kind === value, onchange: () => { S.kind = value; draw(); } }),
      h("span", null, h("strong", null, icon(ic), " ", title), h("small", null, desc)));
    const setSel = h("select", { class: "field-select", onchange: (e) => { S.setId = e.target.value; } },
      h("optgroup", { label: "SK の単語セット" }, store.getSkSets().map((s) => h("option", { value: s.id, selected: s.id === S.setId }, `${s.title}（${s.words.length} 語）`))),
      store.getMySets().length ? h("optgroup", { label: "マイ単語帳" }, store.getMySets().map((s) => h("option", { value: s.id, selected: s.id === S.setId }, `${s.title}（${s.words.length} 語）`))) : null);
    const count = h("input", { type: "number", class: "field-input", min: "1", max: "100", value: String(S.count), oninput: (e) => { S.count = Math.max(1, Math.min(100, Number(e.target.value) || 10)); } });
    const format = h("select", { class: "field-select", onchange: (e) => { S.format = e.target.value; } }, Object.entries(FORMAT_LABEL).map(([v, l]) => h("option", { value: v, selected: S.format === v }, l)));
    const printSel = h("select", { class: "field-select", onchange: (e) => { S.printId = e.target.value; loadPrint(); } },
      prints.map((p) => h("option", { value: p.id, selected: p.id === S.printId }, `${p.exam ? "【試験】" : ""}${p.title}（解答欄 ${p.blanks}）`)));
    const title = h("input", { type: "text", class: "field-input", maxlength: "80", value: S.title, placeholder: "空なら、単語帳・プリントの名前", oninput: (e) => { S.title = e.target.value; } });
    const due = h("input", { type: "datetime-local", class: "field-input", value: S.due, oninput: (e) => { S.due = e.target.value; } });
    const pub = h("input", { type: "checkbox", checked: S.published, onchange: (e) => { S.published = e.target.checked; } });
    const tooBig = printInfo && (S.strip ? bytes(stripImages(printInfo.html)) : printInfo.bytes) > cloud.PRINT_MAX_BYTES;
    form.replaceChildren(
      h("div", { class: "mk-modes tc-kinds" },
        radio("words", "単語帳", "生徒が自分のペースで学習。覚えた語の数が届く", "menu_book"),
        radio("wordtest", "単語の小テスト", "決まった数を 1 回だけ。答えと点数が届く", "quiz"),
        radio("print", "プリント", "SK Study のプリント（練習・試験）。答えと記録が届く", "assignment")),
      S.kind === "print"
        ? h("div", { class: "tc-source" },
          prints.length ? h("label", { class: "field" }, h("span", { class: "field-label" }, "プリント（この端末の「プリント」から）"), printSel)
            : h("p", { class: "warn" }, icon("info"), "まだプリントがありません。ホームの「プリント」で追加するか、「PDF から作る」で作ってください。"),
          printInfo ? h("ul", { class: "mk-summary" },
            h("li", null, icon(printInfo.exam ? "timer" : "school"), printInfo.exam ? `試験用（${printInfo.minutes ? `${printInfo.minutes} 分` : "時間制限なし"}）` : "練習用"),
            h("li", null, icon("edit_square"), `解答欄 ${printInfo.blanks} 個`),
            h("li", null, icon("data_usage"), `大きさ ${(printInfo.bytes / 1024).toFixed(0)} KB（配れるのは ${(cloud.PRINT_MAX_BYTES / 1024).toFixed(0)} KB まで）`),
            printInfo.images ? h("li", null, h("label", { class: "switch-row" }, h("input", { type: "checkbox", checked: S.strip, onchange: (e) => { S.strip = e.target.checked; draw(); } }), h("span", null, `元のページの画像（${printInfo.images} 枚）を外して配る`))) : null,
            tooBig ? h("li", { class: "warn" }, icon("warning"), "大きすぎて配れません。画像を外すか、プリントを分けてください。") : null) : null)
        : h("div", { class: "tc-source" },
          h("label", { class: "field" }, h("span", { class: "field-label" }, "単語帳"), setSel),
          S.kind === "wordtest" ? h("div", { class: "field-row" },
            h("label", { class: "field mk-minutes" }, h("span", { class: "field-label" }, "問題の数"), count),
            h("label", { class: "field" }, h("span", { class: "field-label" }, "形式"), format)) : null),
      h("div", { class: "field-row" },
        h("label", { class: "field" }, h("span", { class: "field-label" }, "課題の名前"), title),
        h("label", { class: "field" }, h("span", { class: "field-label" }, "締め切り（任意）"), due)),
      h("label", { class: "switch-row" }, pub, h("span", null, h("strong", null, "すぐ生徒に公開する"), h("small", null, "あとで結果の画面から公開・非公開を切りかえられます"))),
      h("div", { class: "mk-row" }, button("filled", "配信する", "send", saveIt)),
      status);
  }

  async function saveIt() {
    const data = { kind: S.kind, published: S.published, resultsOpen: false, due: S.due ? new Date(S.due).getTime() : null };
    if (S.kind === "print") {
      if (!printInfo) { toast("プリントを選んでください"); return; }
      const html = S.strip ? stripImages(printInfo.html) : printInfo.html;
      if (bytes(html) > cloud.PRINT_MAX_BYTES) { toast("プリントが大きすぎて配れません"); return; }
      data.print = { html, exam: printInfo.exam, minutes: printInfo.minutes, blanks: printInfo.blanks };
      data.title = S.title.trim() || (prints.find((p) => p.id === S.printId) || {}).title || printInfo.title || "プリント";
    } else {
      const set = store.getSet(S.setId);
      if (!set) { toast("単語帳を選んでください"); return; }
      data.set = setForCloud(set);
      if (!data.set.words.length) { toast("単語が入っていない単語帳です"); return; }
      if (S.kind === "wordtest") data.test = { count: Math.min(S.count, data.set.words.length), format: S.format };
      data.title = S.title.trim() || set.title;
    }
    status.textContent = "配信しています…";
    try {
      const aid = await cloud.saveAssignment(cid, null, data);
      toast("配信しました");
      go(`/teach/${encodeURIComponent(cid)}/${encodeURIComponent(aid)}`, true);
    } catch (e) {
      status.textContent = cloud.explain(e);
    }
  }

  app.replaceChildren(...head(ui, "配信する", `「${cls.name}」の生徒に課題を配ります。`, ["クラス", `#/teach/${encodeURIComponent(cid)}`]),
    h("section", { class: "mk-card" }, form));
  draw();
  if (S.printId) loadPrint();
}

// ---------- 結果 ----------

async function resultsView(cid, aid, ui) {
  const { h, icon, button, toast, confirmDialog, go, app, openDialog } = ui;
  const hash = location.hash;
  const [cls, a, members, subs] = await Promise.all([cloud.getClass(cid), cloud.getAssignment(cid, aid), cloud.members(cid), cloud.submissions(cid, aid)]);
  if (location.hash !== hash) return;
  document.title = `${a.title} - 指導者メニュー`;
  const k = kindInfo(a);
  const reload = () => resultsView(cid, aid, ui);
  const isPrint = a.kind === "print";
  const P = isPrint ? parsePrint(a.print.html) : null;
  const sealed = P && P.exam ? P.meta.sealed : null;
  // 試験用の答え（合言葉で開いたもの）。このタブの中だけ覚えておく
  const passKey = `sk_study_teach_pass_${cid}_${aid}`;
  let payload = null;
  let pass = "";
  try { pass = sessionStorage.getItem(passKey) || ""; } catch (e) { /* 覚えない */ }
  if (sealed) {
    try { payload = await openAnswers(sealed, sealed.pass ? pass : ""); } catch (e) { payload = null; }
  }
  const canGrade = !isPrint || !sealed || !!payload;
  const parse = (sub) => { try { return JSON.parse(sub.data || "{}"); } catch (e) { return {}; } };
  const byUid = new Map(subs.map((s) => [s.id, s]));
  const rows = [...members.map((m) => ({ uid: m.id, name: m.name, member: true })), ...subs.filter((s) => !members.some((m) => m.id === s.id)).map((s) => ({ uid: s.id, name: s.name, member: false }))];

  async function setFlags(patch) {
    try { await cloud.saveAssignment(cid, aid, { ...a, due: cloud.toMillis(a.due), ...patch }, a); toast("変えました"); reload(); } catch (e) { toast(cloud.explain(e)); }
  }
  async function openResults(on) {
    if (!on) return setFlags({ resultsOpen: false, answerKey: "" });
    // 試験用（合言葉あり）は、生徒が答え合わせできるように合言葉を課題に入れる
    if (sealed && sealed.pass) {
      if (!payload) { toast("先に合言葉で答えを開いてください"); return; }
      return setFlags({ resultsOpen: true, answerKey: pass });
    }
    return setFlags({ resultsOpen: true });
  }

  // プリント: 1 人分を自動で採点する（先生が決めた ○△× は残す）
  function autoMarks(sub) {
    const data = parse(sub);
    const { marks } = gradeAnswers(a.print.html, data.answers || [], { payload });
    let prev = {};
    try { prev = sub.grade ? JSON.parse(sub.grade.marks || "{}") : {}; } catch (e) { prev = {}; }
    for (const [key, v] of Object.entries(prev)) if (v && v !== "pending") marks[key] = v;
    return marks;
  }
  async function gradeAll() {
    if (!canGrade) { toast("先に合言葉で答えを開いてください"); return; }
    let n = 0;
    for (const sub of subs) {
      if (isPrint) {
        const marks = autoMarks(sub);
        const t = tally(P, marks);
        await cloud.saveGrade(cid, aid, sub.id, { ok: t.ok, total: t.total, marks, note: sub.grade ? sub.grade.note : "" });
      } else if (a.kind === "wordtest") {
        await cloud.saveGrade(cid, aid, sub.id, { ok: sub.score.ok, total: sub.score.total, marks: {}, note: sub.grade ? sub.grade.note : "" });
      }
      n++;
    }
    toast(`${n} 人分を採点しました`);
    reload();
  }

  function detail(row) {
    const sub = byUid.get(row.uid);
    if (!sub) return;
    const data = parse(sub);
    const body = h("div", { class: "tc-detail" });
    const note = h("textarea", { class: "field-input", rows: "2", maxlength: "1000", placeholder: "生徒へのひとこと（結果を公開すると見えます）" }, sub.grade ? sub.grade.note : "");
    let marks = null;
    if (isPrint) {
      if (!canGrade) body.append(h("p", { class: "warn" }, icon("lock"), "合言葉で答えを開くと、採点できます。"));
      marks = canGrade ? autoMarks(sub) : {};
      const list = h("ol", { class: "tc-blanks" });
      const drawList = () => list.replaceChildren(...P.blanks.map((b) => {
        const m = marks[b.id];
        const answer = (data.answers || [])[b.id] || "";
        const correct = [...(b.anyOf || [b.answer]), ...(b.alts || [])].filter(Boolean).join(" / ");
        return h("li", { class: `tc-blank mark-${m || "none"}` },
          h("div", { class: "tc-blank-head" },
            h("span", { class: "muted small" }, [b.group.article, b.group.section, b.group.qn && b.group.qn !== "・" ? `問 ${b.group.qn}` : "", b.label].filter(Boolean).join(" ・ ")),
            b.type === "self" ? h("span", { class: "type-pill type-self" }, "記述") : null),
          h("div", { class: "tc-blank-body" },
            h("div", null, h("span", { class: "muted small" }, "生徒の答え"), h("p", { class: "tc-answer" }, answer || "（答えなし）")),
            canGrade ? h("div", null, h("span", { class: "muted small" }, "正解"), h("p", null, correct || "（答えなし）")) : null),
          canGrade && b.type !== "none" ? h("div", { class: "tc-marks", role: "radiogroup", "aria-label": "採点" }, ["ok", "partial", "ng"].map((v) => h("button", {
            type: "button", role: "radio", "aria-checked": String(m === v), class: `tc-mark ${v}`,
            onclick: () => { marks[b.id] = v; drawList(); }
          }, MARK_LABEL[v]))) : null);
      }));
      drawList();
      body.append(list);
    } else if (a.kind === "wordtest") {
      body.append(h("ol", { class: "test-list" }, (data.items || []).map((it) => h("li", { class: `test-row ${it.ok ? "ok" : "ng"}` },
        h("span", { class: `mark ${it.ok ? "ok" : "ng"}` }, it.ok ? "○" : "×"),
        h("div", { class: "test-q" },
          h("span", { class: "test-prompt" }, it.prompt || it.w),
          h("span", { class: "test-type" }, it.type === "write" ? "書き取り" : "4 択"),
          it.ok ? null : h("span", { class: "test-given" }, "答え: ", h("s", null, it.given || "（答えなし）")),
          h("span", { class: "test-correct" }, "正解: ", h("strong", null, it.correct || "")))))));
    } else {
      const p = data.progress || {};
      body.append(h("dl", { class: "tc-dl" },
        h("dt", null, "記憶度"), h("dd", null, `${p.memory ?? "-"}%`),
        h("dt", null, "記憶済み"), h("dd", null, `${p.mastered ?? "-"} / ${p.total ?? "-"}`),
        h("dt", null, "記憶中・弱点・未学習"), h("dd", null, `${p.learning ?? "-"}・${p.weak ?? "-"}・${p.new ?? "-"}`),
        h("dt", null, "最後に送られた日時"), h("dd", null, fmtDate(sub.updatedAt))));
    }
    if (data.exam) body.append(examLog(data.exam));
    if (a.kind !== "words") body.append(h("label", { class: "field" }, h("span", { class: "field-label" }, "ひとこと"), note));
    const d = openDialog(`${row.name} さんの提出`, body, [
      button("text", "提出をやり直させる", "restart_alt", async () => {
        if (!(await confirmDialog("提出をやり直させますか？", `${row.name} さんの提出と採点を消します。もう一度解けるようになります。`, "やり直させる", true))) return;
        try { await cloud.resetSubmission(cid, aid, row.uid); d.close(); toast("やり直せるようにしました"); reload(); } catch (e) { toast(cloud.explain(e)); }
      }),
      button("text", "閉じる", null, () => d.close()),
      a.kind !== "words" ? button("filled", "採点を保存", "save", async () => {
        try {
          if (isPrint) {
            if (!canGrade) { toast("先に合言葉で答えを開いてください"); return; }
            const t = tally(P, marks);
            await cloud.saveGrade(cid, aid, row.uid, { ok: t.ok, total: t.total, marks, note: note.value });
          } else {
            await cloud.saveGrade(cid, aid, row.uid, { ok: sub.score.ok, total: sub.score.total, marks: {}, note: note.value });
          }
          d.close();
          toast("保存しました");
          reload();
        } catch (e) { toast(cloud.explain(e)); }
      }) : null
    ].filter(Boolean));
    d.classList.add("dialog-wide");
  }

  function examLog(ex) {
    const ev = ex.events || [];
    const total = ev.reduce((s, e) => s + (e.ms || 0), 0);
    const sec = (ms) => `${Math.round(ms / 1000)} 秒`;
    return h("div", { class: "exam-log" },
      h("p", null, icon("schedule"), `かかった時間 ${ex.submittedAt && ex.startedAt ? `${Math.round((ex.submittedAt - ex.startedAt) / 60000)} 分` : "-"}${ex.auto ? "（時間切れで自動提出）" : ""}`),
      h("p", { class: ev.length ? "warn" : "" }, icon(ev.length ? "visibility_off" : "verified_user"), ev.length ? `画面を離れた記録 ${ev.length} 回（合計 ${sec(total)}）` : "画面を離れた記録はありません"),
      ex.tampered ? h("p", { class: "warn" }, icon("warning"), "プリントが書きかえられていた可能性があります") : null);
  }

  function csv() {
    const lines = [["名前", "状態", "提出", "生徒の点", "先生の採点", "画面を離れた回数"]];
    for (const r of rows) {
      const s = byUid.get(r.uid);
      const ex = s ? parse(s).exam : null;
      lines.push([r.name, s ? "提出" : "未提出", s ? fmtDate(s.submittedAt) : "", s ? `${s.score.ok}/${s.score.total}` : "", s && s.grade ? `${s.grade.ok}/${s.grade.total}` : "", ex ? (ex.events || []).length : ""]);
    }
    const text = "﻿" + lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    link.download = `${a.title.replace(/[\\/:*?"<>|]/g, "_")}_結果.csv`;
    document.body.append(link);
    link.click();
    link.remove();
  }

  const passInput = h("input", { type: "password", class: "field-input", placeholder: "答え合わせの合言葉", autocomplete: "off", "aria-label": "答え合わせの合言葉" });
  const openPass = async () => {
    try {
      payload = await openAnswers(sealed, passInput.value);
      try { sessionStorage.setItem(passKey, normPass(passInput.value)); } catch (e) { /* 覚えない */ }
      toast("答えを開きました");
      reload();
    } catch (e) { toast("合言葉がちがいます"); }
  };
  passInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) openPass(); });

  const submittedN = rows.filter((r) => byUid.has(r.uid)).length;
  app.replaceChildren(...head(ui, a.title, `${cls.name} ・ ${k.name}${a.due ? ` ・ 締め切り ${fmtDue(a.due)}` : ""}`, ["クラス", `#/teach/${encodeURIComponent(cid)}`]),
    h("div", { class: "tc-grid" },
      h("section", { class: "mk-card" },
        h("h2", null, icon("tune"), "公開"),
        h("label", { class: "switch-row" }, h("input", { type: "checkbox", checked: a.published, onchange: (e) => setFlags({ published: e.target.checked }) }),
          h("span", null, h("strong", null, "生徒に公開する"), h("small", null, "非公開にすると、生徒の一覧から消えます（提出は残ります）"))),
        a.kind !== "words" ? h("label", { class: "switch-row" }, h("input", { type: "checkbox", checked: a.resultsOpen, onchange: (e) => openResults(e.target.checked) }),
          h("span", null, h("strong", null, "結果を生徒に見せる"), h("small", null, sealed && sealed.pass ? "先生の採点と、試験の答え（合言葉）が生徒に届きます" : "先生の採点が生徒に届きます"))) : null,
        h("div", { class: "mk-row" },
          button("outlined", "CSV で保存", "download", csv),
          button("text", "この配信を削除", "delete", async () => {
            if (!(await confirmDialog("この配信を削除しますか？", "生徒の提出と採点もすべて消します。もとに戻せません。", "削除する", true))) return;
            try { await cloud.deleteAssignment(cid, aid); toast("削除しました"); go(`/teach/${encodeURIComponent(cid)}`, true); } catch (e) { toast(cloud.explain(e)); }
          }, { "data-danger": "" }))),
      a.kind !== "words" ? h("section", { class: "mk-card" },
        h("h2", null, icon("grading"), "採点"),
        sealed && sealed.pass && !payload ? h("div", null,
          h("p", { class: "muted small" }, "試験用のプリントです。答えは暗号化されているので、合言葉で開いてから採点します（合言葉はこのタブの中だけで覚えます）。"),
          h("div", { class: "pass-row" }, passInput, button("filled", "答えを開く", "lock_open", openPass))) : null,
        h("p", { class: "muted small" }, isPrint ? "記号・語句は自動で採点します。記述は「見る」で ○・△・× を付けてください。先生が付けた ○△× は、自動の採点で上書きしません。" : "小テストは生徒の端末で採点しています。保存すると、結果を公開したときに生徒に届きます。"),
        button("filled", "まとめて採点して保存", "done_all", gradeAll, { disabled: !canGrade || !subs.length })) : null),
    h("section", { class: "mk-card" },
      h("h2", null, icon("inbox"), `提出（${submittedN} / ${rows.length}）`),
      rows.length ? h("table", { class: "tc-table" },
        h("thead", null, h("tr", null, h("th", null, "名前"), h("th", null, "状態"), h("th", null, "提出"), h("th", null, a.kind === "words" ? "覚えた語" : "生徒の点"), a.kind !== "words" ? h("th", null, "先生の採点") : null, P && P.exam ? h("th", null, "画面を離れた") : null, h("th", null, ""))),
        h("tbody", null, rows.map((r) => {
          const s = byUid.get(r.uid);
          const ex = s ? parse(s).exam : null;
          let pending = 0;
          if (s && s.grade && P) { try { pending = tally(P, JSON.parse(s.grade.marks || "{}")).pending; } catch (e) { pending = 0; } }
          return h("tr", { class: s ? "" : "is-missing" },
            h("td", null, r.name, r.member ? null : h("span", { class: "muted small" }, "（クラスにいません）")),
            h("td", null, s ? h("span", { class: "done" }, icon("task_alt"), "提出") : h("span", { class: "muted" }, "未提出")),
            h("td", null, s ? fmtDate(s.submittedAt) : "-"),
            h("td", null, s ? `${s.score.ok} / ${s.score.total}` : "-"),
            a.kind !== "words" ? h("td", null, s && s.grade ? `${s.grade.ok} / ${s.grade.total}（${s.grade.pct}%）${pending ? `・記述 ${pending} 問未採点` : ""}` : "-") : null,
            P && P.exam ? h("td", { class: ex && (ex.events || []).length ? "warn" : "" }, ex ? `${(ex.events || []).length} 回` : "-") : null,
            h("td", { class: "tc-actions" }, s ? button("text", "見る", "visibility", () => detail(r)) : null));
        }))) : h("p", { class: "muted" }, "まだ生徒がいません。")));
}
