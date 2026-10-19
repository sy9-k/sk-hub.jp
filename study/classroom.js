// SK Study の生徒の画面（クラスに参加する・課題に取り組む・提出する）。データは cloud.js
//   #/class/<cid>        クラス（配られた課題の一覧）
//   #/task/<cid>/<aid>   課題を開く
//     words … 単語帳をこの端末に入れて（store.cacheClassSet）、ふつうの単語セットの画面で学習する。学習のたびに進み具合を先生に送る
//     wordtest … 単語の小テスト（1 回だけ）。終わったら答えと点数を先生に送る
//     print … プリントをこの端末に入れて（print.js の saveClassPrint）、プリントの画面で解いて提出する
//   送れなかった提出は sk_study_pending に残し、次に課題を開いたときに送り直す
import * as cloud from "./cloud.js";
import * as store from "./store.js";
import { saveClassPrint } from "./print.js";

const PENDING_KEY = "sk_study_pending";
const KIND = {
  words: { name: "単語帳", icon: "menu_book" },
  wordtest: { name: "単語の小テスト", icon: "quiz" },
  print: { name: "プリント", icon: "assignment" }
};
export const kindInfo = (a) => (a.kind === "print" && a.print && a.print.exam ? { name: "試験", icon: "timer" } : KIND[a.kind] || KIND.words);

const fmtDue = (v) => {
  const t = cloud.toMillis(v);
  if (!t) return "";
  return new Date(t).toLocaleString("ja-JP", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
};
export { fmtDue };

function readPending() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "{}") || {}; } catch (e) { return {}; } }
function writePending(v) { try { localStorage.setItem(PENDING_KEY, JSON.stringify(v)); } catch (e) { /* 保存できなくても動く */ } }

// ---------- ホームの「クラス」 ----------

export function classSection(ui) {
  const { h, icon, button, linkButton } = ui;
  const body = h("div", { class: "class-home" }, h("p", { class: "muted small" }, "確認中…"));
  const section = h("section", { class: "section" },
    h("div", { class: "section-head" }, h("h2", null, "クラス"), h("div", { class: "section-actions" }, linkButton("text", "指導者メニュー", "school", "#/teach"))),
    body);
  (async () => {
    const s = await cloud.session();
    if (s.status === "signed-out" || s.status === "unregistered") {
      body.replaceChildren(h("div", { class: "empty-card" },
        icon("groups", "empty-icon"),
        h("p", null, "先生のクラスに参加すると、配られた単語帳・小テスト・プリントに取り組んで提出できます。"),
        linkButton("filled", "SK Hub Systems アカウントでログイン", "login", cloud.accountUrl(true))));
      return;
    }
    if (s.status === "not-connected") {
      body.replaceChildren(h("div", { class: "empty-card" },
        icon("link", "empty-icon"),
        h("p", null, "クラスに参加するには、SK Hub Systems アカウントを SK Study に接続します。"),
        linkButton("filled", "SK Study に接続する", "link", cloud.accountUrl(true))));
      return;
    }
    if (s.status !== "ready") {
      body.replaceChildren(h("p", { class: "muted small" }, icon("cloud_off"), "SK Hub Systems に接続できませんでした。"));
      return;
    }
    let classes = [];
    try { classes = await cloud.myClasses(); } catch (e) { body.replaceChildren(h("p", { class: "warn small" }, cloud.explain(e))); return; }
    body.replaceChildren(
      classes.length ? h("div", { class: "set-list" }, classes.map((c) => h("div", { class: "set-row" },
        h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon("groups")),
        h("div", { class: "set-row-body" },
          h("a", { class: "set-row-link", href: `#/class/${encodeURIComponent(c.id)}` },
            h("span", { class: "set-row-sub" }, h("span", null, c.teacherName ? `${c.teacherName} 先生` : "クラス")),
            h("span", { class: "set-row-title" }, c.name))),
        h("div", { class: "set-row-end" }, icon("chevron_right")))))
        : h("p", { class: "muted small" }, "まだクラスに参加していません。先生から参加コードを聞いて入れてください。"),
      h("div", { class: "class-join-row" }, button("tonal", "参加コードを入れる", "add", () => openJoinDialog(ui))));
  })();
  return section;
}

export function openJoinDialog(ui) {
  const { h, button, toast, openDialog, go } = ui;
  const input = h("input", { type: "text", class: "field-input code-input", maxlength: "7", placeholder: "ABC123", autocomplete: "off", autocapitalize: "characters", "aria-label": "参加コード" });
  const info = h("div", { class: "join-info" });
  let found = null;
  const look = async () => {
    const code = cloud.normCode(input.value);
    if (code.length !== 6) { toast("参加コードは 6 けたです"); input.focus(); return; }
    info.replaceChildren(h("p", { class: "muted small" }, "確認中…"));
    try {
      found = await cloud.lookupCode(code);
      info.replaceChildren(h("div", { class: "join-found" },
        h("strong", null, found.className),
        h("span", { class: "muted small" }, found.teacherName ? `${found.teacherName} 先生のクラス` : ""),
        h("p", { class: "muted small" }, "参加すると、あなたの表示名・提出した答え・点数がこのクラスの先生に見えます。")));
      okBtn.querySelector("span:last-child").textContent = "参加する";
    } catch (e) {
      found = null;
      info.replaceChildren(h("p", { class: "warn small" }, e.code === "bad-code" ? "参加コードが見つかりません。もう一度確かめてください。" : cloud.explain(e)));
    }
  };
  const okBtn = button("filled", "確かめる", null, async () => {
    if (!found || cloud.normCode(input.value) !== found.code) { await look(); return; }
    try {
      const s = await cloud.session();
      await cloud.joinClass(found, s.name);
      d.close();
      toast(`「${found.className}」に参加しました`);
      go(`/class/${encodeURIComponent(found.classId)}`);
    } catch (e) {
      toast(cloud.explain(e));
    }
  });
  const d = openDialog("クラスに参加", h("div", null, h("p", null, "先生から聞いた 6 けたの参加コードを入れてください。"), input, info), [button("text", "やめる", null, () => d.close()), okBtn]);
  input.addEventListener("input", () => { if (found && cloud.normCode(input.value) !== found.code) { found = null; info.replaceChildren(); okBtn.querySelector("span:last-child").textContent = "確かめる"; } });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) okBtn.click(); });
  input.focus();
}

// ---------- クラス ----------

async function needReady(ui) {
  const s = await cloud.session();
  if (s.status === "ready") return true;
  const { h, linkButton, app } = ui;
  app.replaceChildren(h("section", { class: "message" },
    ui.icon("lock", "message-icon"),
    h("h1", null, s.status === "offline" ? "接続できませんでした" : "ログインが必要です"),
    h("p", null, s.status === "offline" ? "ネットワークを確かめて、もう一度開いてください。" : s.status === "not-connected" ? "SK Hub Systems アカウントを SK Study に接続してください。" : "SK Hub Systems アカウントでログインしてください。"),
    s.status === "offline" ? linkButton("filled", "ホームへ", "home", "#/") : linkButton("filled", s.status === "not-connected" ? "SK Study に接続する" : "ログイン", "login", cloud.accountUrl(true))));
  return false;
}

function loading(ui) {
  ui.app.replaceChildren(ui.h("p", { class: "loading" }, ui.h("span", { class: "spinner", "aria-hidden": "true" }), "読み込み中…"));
}

export async function renderClass(cid, ui) {
  const { h, icon, button, toast, confirmDialog, go, app } = ui;
  const hash = location.hash;
  loading(ui);
  if (!(await needReady(ui))) return;
  let cls, assigns;
  try {
    cls = await cloud.getClass(cid);
    assigns = await cloud.publishedAssignments(cid);
  } catch (e) {
    if (location.hash !== hash) return;
    app.replaceChildren(h("section", { class: "message" },
      icon("group_off", "message-icon"),
      h("h1", null, "このクラスは開けません"),
      h("p", null, "クラスから外れたか、クラスが削除されたようです。"),
      h("div", { class: "result-actions" },
        button("filled", "一覧から消す", "delete", async () => { await cloud.leaveClass(cid).catch(() => {}); go("/", true); }),
        ui.linkButton("text", "ホームへ", "home", "#/"))));
    return;
  }
  const subs = await Promise.all(assigns.map((a) => cloud.mySubmission(cid, a.id).catch(() => null)));
  if (location.hash !== hash) return;
  document.title = `${cls.name} - SK Study`;
  const now = Date.now();
  app.replaceChildren(
    ui.backLink("ホーム", "#/"),
    h("section", { class: "set-head" },
      h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon("groups")),
      h("div", null,
        h("p", { class: "set-row-sub" }, h("span", null, cls.teacherName ? `${cls.teacherName} 先生` : "クラス")),
        h("h1", null, cls.name))),
    h("section", { class: "section" },
      h("h2", null, `課題（${assigns.length}）`),
      assigns.length ? h("div", { class: "set-list" }, assigns.map((a, i) => {
        const k = kindInfo(a);
        const sub = subs[i];
        const due = cloud.toMillis(a.due);
        const late = due && due < now && !sub;
        const status = a.kind === "words" ? (sub ? `覚えた ${sub.score.ok} / ${sub.score.total} 語` : "まだ学習していません") : sub ? "提出ずみ" : "未提出";
        return h("div", { class: "set-row" },
          h("span", { class: `thumb kind-${a.kind}${a.print && a.print.exam ? " is-exam" : ""}`, "aria-hidden": "true" }, icon(k.icon)),
          h("div", { class: "set-row-body" },
            h("a", { class: "set-row-link", href: `#/task/${encodeURIComponent(cid)}/${encodeURIComponent(a.id)}` },
              h("span", { class: "set-row-sub" }, h("span", { class: "kind-pill" }, k.name), due ? h("span", { class: late ? "warn" : "" }, `締め切り ${fmtDue(a.due)}`) : null),
              h("span", { class: "set-row-title" }, a.title)),
            h("span", { class: "set-row-meta" }, h("span", { class: sub ? "done" : late ? "warn" : "" }, icon(sub ? "task_alt" : "pending"), status))),
          h("div", { class: "set-row-end" }, icon("chevron_right")));
      })) : h("p", { class: "muted" }, "まだ配られた課題はありません。")),
    h("div", { class: "set-actions" },
      button("outlined", "クラスから抜ける", "logout", async () => {
        if (!(await confirmDialog("クラスから抜けますか？", `「${cls.name}」から抜けます。提出した答えは先生のところに残ります。もう一度参加するには参加コードが要ります。`, "抜ける", true))) return;
        try { await cloud.leaveClass(cid); toast("クラスから抜けました"); go("/", true); } catch (e) { toast(cloud.explain(e)); }
      }, { "data-danger": "" })));
}

// ---------- 課題 ----------

export async function renderTask(cid, aid, ui) {
  const { h, icon, button, toast, go, app } = ui;
  const hash = location.hash;
  loading(ui);
  if (!(await needReady(ui))) return;
  let a, sub, grade;
  try {
    [a, sub, grade] = await Promise.all([cloud.getAssignment(cid, aid), cloud.mySubmission(cid, aid), cloud.myGrade(cid, aid)]);
  } catch (e) {
    if (location.hash !== hash) return;
    ui.message("課題を開けませんでした", cloud.explain(e));
    return;
  }
  if (location.hash !== hash) return;
  const back = `#/class/${encodeURIComponent(cid)}`;

  // 送れていなかった提出を送り直す
  const pending = readPending();
  const pkey = `${cid}/${aid}`;
  if (pending[pkey] && !sub) {
    try {
      await cloud.submit(cid, aid, pending[pkey].score, pending[pkey].data);
      delete pending[pkey];
      writePending(pending);
      sub = await cloud.mySubmission(cid, aid);
      toast("先生に提出しました");
    } catch (e) { /* また次に */ }
  }

  if (a.kind === "words") {
    const set = store.cacheClassSet(cid, aid, "words", a.set || {}, a.title);
    go(`/set/${encodeURIComponent(set.id)}`, true);
    return;
  }
  if (a.kind === "print") {
    const id = `cls-${cid}-${aid}`;
    try {
      await saveClassPrint(id, a.print.html, a.title, { cid, aid });
    } catch (e) {
      ui.message("プリントを開けませんでした", "この端末に保存できませんでした（保存容量がいっぱいかもしれません）。");
      return;
    }
    go(`/print/${encodeURIComponent(id)}`, true);
    return;
  }

  // 単語の小テスト
  const set = store.cacheClassSet(cid, aid, "wordtest", a.set || {}, a.title);
  const count = Math.min((a.test && a.test.count) || 10, set.words.length);
  const format = (a.test && a.test.format) || "auto";
  document.title = `${a.title} - SK Study`;
  if (sub) {
    let data = {};
    try { data = JSON.parse(sub.data || "{}"); } catch (e) { /* 空 */ }
    const items = data.items || [];
    app.replaceChildren(
      ui.backLink("クラス", back),
      h("section", { class: "result task-result" },
        h("p", { class: "test-pill big" }, "提出ずみ"),
        h("h1", null, a.title),
        ui.ring(sub.score.pct / 100, { size: 130, stroke: 11, color: sub.score.pct >= 80 ? "var(--st-mastered)" : "var(--primary)", label: `${sub.score.ok}/${sub.score.total}` }),
        h("p", { class: "result-score" }, `${sub.score.pct} 点`),
        grade ? h("p", { class: "teacher-grade" }, icon("school"), `先生の採点: ${grade.ok} / ${grade.total}（${grade.pct}%）`) : null,
        grade && grade.note ? h("p", { class: "small" }, grade.note) : null,
        h("ol", { class: "test-list" }, items.map((it) => h("li", { class: `test-row ${it.ok ? "ok" : "ng"}` },
          h("span", { class: `mark ${it.ok ? "ok" : "ng"}` }, it.ok ? "○" : "×"),
          h("div", { class: "test-q" },
            h("span", { class: "test-prompt" }, it.prompt || it.w),
            it.ok ? null : h("span", { class: "test-given" }, "あなた: ", h("s", null, it.given || "（答えなし）")),
            h("span", { class: "test-correct" }, "正解: ", h("strong", null, it.correct || ""))))))));
    return;
  }
  const due = cloud.toMillis(a.due);
  app.replaceChildren(
    ui.backLink("クラス", back),
    h("section", { class: "lobby-card task-lobby" },
      h("p", { class: "test-pill big" }, "単語の小テスト"),
      h("h1", null, a.title),
      h("ul", { class: "lobby-facts" },
        h("li", null, icon("quiz"), `${count} 問（${{ auto: "4 択と書き取り", choice: "4 択", write: "書き取り" }[format]}）`),
        due ? h("li", { class: due < Date.now() ? "warn" : "" }, icon("event"), `締め切り ${fmtDue(a.due)}`) : null,
        h("li", null, icon("send"), "1 回だけ。終わると答えと点数が先生に届きます")),
      button("filled", "はじめる", "play_arrow", () => {
        if (!set.words.length) { toast("この小テストには単語が入っていません"); return; }
        const items = ui.shuffle(set.words).slice(0, count).map((word) => ({ set, word }));
        ui.runSession({
          items, mode: "test", format, title: a.title, backHref: back,
          onTestDone: async (results) => {
            const NONE = "\u0000none";
            const data = {
              kind: "wordtest",
              items: results.map((r) => ({
                w: r.item.word.w, m: r.item.word.m,
                prompt: r.qn && r.qn.dir === "fw" ? r.item.word.w : r.item.word.m,
                type: r.qn ? r.qn.type : "", dir: r.qn ? r.qn.dir : "",
                given: r.given || "", correct: r.qn ? (r.qn.answer === NONE ? "この中にはない" : r.qn.answer) : "", ok: !!r.ok
              }))
            };
            const score = { ok: results.filter((r) => r.ok).length, total: results.length };
            try {
              await cloud.submit(cid, aid, score, data);
              toast("先生に提出しました");
            } catch (e) {
              const p = readPending();
              p[pkey] = { score, data };
              writePending(p);
              toast(`先生に送れませんでした。次に開いたときに送り直します（${cloud.explain(e)}）`);
            }
          }
        });
      }, { class: "filled-btn start-btn" })));
}

// 単語帳の課題: 学習したあとに、進み具合（記憶度）を先生に送る
export async function reportProgress(set) {
  if (!set || set.source !== "class" || !set.classRef || set.classRef.kind !== "words") return;
  const { cid, aid } = set.classRef;
  const s = store.setStats(set);
  const data = { kind: "words", progress: { total: s.total, mastered: s.mastered, learning: s.learning, weak: s.weak, new: s.new, memory: s.memory } };
  try {
    const existing = await cloud.mySubmission(cid, aid);
    await cloud.submit(cid, aid, { ok: s.mastered, total: s.total }, data, { update: !!existing });
  } catch (e) { /* 次の学習のときにまた送る */ }
}
