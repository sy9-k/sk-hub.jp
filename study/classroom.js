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
// 生徒の左メニューの分け方。小テスト = 単語の小テスト・試験、課題 = プリント、資料 = 単語帳
export const GROUPS = {
  quiz: { name: "小テスト", icon: "quiz", has: (a) => a.kind === "wordtest" || (a.kind === "print" && !!(a.print && a.print.exam)), empty: "配られた小テストはありません。" },
  task: { name: "課題", icon: "assignment", has: (a) => a.kind === "print" && !(a.print && a.print.exam), empty: "配られた課題はありません。" },
  material: { name: "資料", icon: "menu_book", has: (a) => a.kind === "words", empty: "配られた資料はありません。" }
};
export const kindInfo = (a) => (a.kind === "print" && a.print && a.print.exam ? { name: "試験", icon: "timer" } : KIND[a.kind] || KIND.words);

const isPcLike = () => window.matchMedia("(hover: hover) and (pointer: fine)").matches;
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
    h("div", { class: "section-head" }, h("h2", null, "クラス"), h("div", { class: "section-actions" }, linkButton("text", "先生・管理者の方はこちら", "school", "#/teach"))),
    body);
  (async () => {
    const s = await cloud.session();
    if (s.status === "signed-out" || s.status === "unregistered") {
      body.replaceChildren(h("div", { class: "empty-card" },
        icon("groups", "empty-icon"),
        h("p", null, "先生から渡された専用コードで参加すると、配られた単語帳・小テスト・プリントに取り組んで提出できます。"),
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
        : h("p", { class: "muted small" }, "まだクラスに参加していません。先生から専用の参加コードを聞いて入れてください。"),
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
        h("p", null, `「${found.profileName || "?"}」のプロファイルとして参加します。`),
        h("p", { class: "muted small" }, "参加すると、このアカウントにクラスのプロファイルが加わります。左上のアカウントの欄から、個人とクラスを切り替えられます。提出した答え・点数はプロファイルの名前で先生に見えます。")));
      okBtn.querySelector("span:last-child").textContent = "参加する";
    } catch (e) {
      found = null;
      info.replaceChildren(h("p", { class: "warn small" }, e.code === "bad-code" ? "参加コードが見つかりません。もう一度確かめてください。" : cloud.explain(e)));
    }
  };
  const okBtn = button("filled", "確かめる", null, async () => {
    if (!found || cloud.normCode(input.value) !== found.code) { await look(); return; }
    try {
      await cloud.joinClass(found);
      d.close();
      cloud.setActiveClass(found.classId);
      toast(`「${found.className}」に参加しました`);
      go(`/class/${encodeURIComponent(found.classId)}`);
    } catch (e) {
      toast(cloud.explain(e));
    }
  });
  const d = openDialog("クラスに参加", h("div", null, h("p", null, "先生から渡された、あなた専用の 6 けたの参加コードを入れてください。"), input, info), [button("text", "やめる", null, () => d.close()), okBtn]);
  input.addEventListener("input", () => { if (found && cloud.normCode(input.value) !== found.code) { found = null; info.replaceChildren(); okBtn.querySelector("span:last-child").textContent = "確かめる"; } });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) okBtn.click(); });
  input.focus();
}

// 学校のコード（学校の名簿のユーザーの専用コード）で、学校に入る。入ると、学校のプロファイルに切りかわる
export function openOrgJoinDialog(ui) {
  const { h, button, toast, openDialog } = ui;
  const input = h("input", { type: "text", class: "field-input code-input", maxlength: "7", placeholder: "ABC123", autocomplete: "off", autocapitalize: "characters", "aria-label": "学校のコード" });
  const info = h("div", { class: "join-info" });
  let found = null;
  const look = async () => {
    const code = cloud.normCode(input.value);
    if (code.length !== 6) { toast("コードは 6 けたです"); input.focus(); return; }
    info.replaceChildren(h("p", { class: "muted small" }, "確認中…"));
    try {
      found = await cloud.lookupOrgCode(code);
      info.replaceChildren(h("div", { class: "join-found" },
        h("strong", null, found.schoolName),
        h("p", null, `「${found.personName}」さん（${found.role === "teacher" ? "先生" : "生徒"}）として入ります。`),
        h("p", { class: "muted small" }, "入ると、このアカウントに学校のプロファイルが加わります。クラスは、学校の先生が決めて、自動で入ります。左上のアカウントの欄から、個人と学校を切り替えられます。")));
      okBtn.querySelector("span:last-child").textContent = "入る";
    } catch (e) {
      found = null;
      info.replaceChildren(h("p", { class: "warn small" }, e.code === "bad-code" ? "コードが見つかりません。もう一度確かめてください。" : e.code === "not-org-code" ? "これは、クラスの参加コード（従来）です。「クラスの参加コード（従来）」から入れてください。" : cloud.explain(e)));
    }
  };
  const okBtn = button("filled", "確かめる", null, async () => {
    if (!found || cloud.normCode(input.value) !== found.code) { await look(); return; }
    try {
      await cloud.joinOrg(found);
      d.close();
      toast(`「${found.schoolName}」に入りました`);
      cloud.setActiveClass(`org-${found.schoolId}`);
    } catch (e) { toast(cloud.explain(e)); }
  });
  const d = openDialog("学校に入る", h("div", null, h("p", null, "学校から渡された、あなた専用の 6 けたのコードを入れてください。"), input, info), [button("text", "やめる", null, () => d.close()), okBtn]);
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

export async function renderClass(cid, ui, group = "") {
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
        button("filled", "一覧から消す", "delete", async () => { await cloud.leaveClass(cid).catch(() => {}); if (cloud.activeClass() === cid) cloud.setActiveClass(""); go("/classes", true); }),
        ui.linkButton("text", "ホームへ", "home", "#/"))));
    return;
  }
  const g = GROUPS[group] || null;
  const allAssigns = assigns;
  if (g) assigns = assigns.filter(g.has);
  const subs = await Promise.all(assigns.map((a) => cloud.mySubmission(cid, a.id).catch(() => null)));
  if (location.hash !== hash) return;
  document.title = `${cls.name} - SK Study`;
  const now = Date.now();
  const leave = button("outlined", "クラスから抜ける", "logout", async () => {
    if (!(await confirmDialog("クラスから抜けますか？", `「${cls.name}」から抜けます。提出した答えは先生のところに残ります。もう一度参加するには参加コードが要ります。`, "抜ける", true))) return;
    try { await cloud.leaveClass(cid); if (cloud.activeClass() === cid) cloud.setActiveClass(""); toast("クラスから抜けました"); go("/classes", true); } catch (e) { toast(cloud.explain(e)); }
  }, { "data-danger": "" });
  // 生徒プロファイルのホーム（グループを選んでいないとき）: 次にやること・進み具合・最近の結果
  if (!g && cloud.activeClass() === cid) {
    const name = await cloud.myProfileName(cid).catch(() => "");
    if (location.hash !== hash) return;
    app.replaceChildren(...studentHome({ cid, cls, assigns: allAssigns, subs, name }, ui).filter(Boolean), h("div", { class: "set-actions" }, leave));
    return;
  }
  app.replaceChildren(
    ...(cloud.activeClass() === cid ? [] : [ui.orgCtx && ui.orgCtx() ? ui.backLink("ホーム", "#/") : ui.backLink("クラス", "#/classes")]),
    h("section", { class: "set-head" },
      h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon("groups")),
      h("div", null,
        h("p", { class: "set-row-sub" }, h("span", null, cls.teacherName ? `${cls.teacherName} 先生` : "クラス")),
        h("h1", null, cls.name))),
    h("section", { class: "section" },
      h("h2", null, `${g ? g.name : "配られたもの"}（${assigns.length}）`),
      assigns.length ? h("div", { class: "set-list" }, assigns.map((a, i) => assignRow(cid, a, subs[i], now, ui))) : h("p", { class: "muted" }, g ? g.empty : "まだ配られたものはありません。")),
    cls.orgModel === true ? null : h("div", { class: "set-actions" }, leave));
}

// 配られたものの 1 行
function assignRow(cid, a, sub, now, ui, className = "") {
  const { h, icon } = ui;
  const k = kindInfo(a);
  const due = cloud.toMillis(a.due);
  const late = due && due < now && !sub;
  const status = a.kind === "words" ? (sub ? `覚えた ${sub.score.ok} / ${sub.score.total} 語` : "まだ学習していません") : sub ? "提出ずみ" : "未提出";
  return h("div", { class: "set-row" },
    h("span", { class: `thumb kind-${a.kind}${a.print && a.print.exam ? " is-exam" : ""}`, "aria-hidden": "true" }, icon(k.icon)),
    h("div", { class: "set-row-body" },
      h("a", { class: "set-row-link", href: `#/task/${encodeURIComponent(cid)}/${encodeURIComponent(a.id)}` },
        h("span", { class: "set-row-sub" }, h("span", { class: "kind-pill" }, k.name), className ? h("span", null, className) : null, due ? h("span", { class: late ? "warn" : "" }, `締め切り ${fmtDue(a.due)}`) : null),
        h("span", { class: "set-row-title" }, a.title)),
      h("span", { class: "set-row-meta" }, h("span", { class: sub ? "done" : late ? "warn" : "" }, icon(sub ? "task_alt" : "pending"), status))),
    h("div", { class: "set-row-end" }, icon("chevron_right")));
}

// 締め切りまでの時間を、短い言葉で（例: あと 2 日 / 3 時間 / 2 日おくれ）
function dueText(due, now) {
  const d = due - now;
  const abs = Math.abs(d);
  const day = Math.floor(abs / 86400000);
  const hour = Math.floor(abs / 3600000);
  const t = day >= 1 ? `${day} 日` : hour >= 1 ? `${hour} 時間` : "1 時間未満";
  return d < 0 ? `${t}おくれ` : `あと ${t}`;
}

// ---------- 生徒プロファイルのホーム ----------
//   次にやること（未提出を、期限切れ → 締め切りの近い順に）・自分の学習（連続日数・今日の目標）・クラスでの進み具合・最近の結果
function studentHome({ cid, cls, assigns, subs, name }, ui) {
  return studentHomeFrom({ items: assigns.map((a, i) => ({ cid, a, sub: subs[i] })), head: `${cls.name}${cls.teacherName ? `・${cls.teacherName} 先生` : ""}`, name }, ui);
}

// items: [{ cid, a: 配られたもの, sub: 自分の提出, className? }]（クラスが 1 つでも、学校のプロファイルで複数でも使える）
//   classRows: 学校のプロファイルのとき、所属クラスの一覧 [{ cls, total, done }]
function studentHomeFrom({ items, head, name, classRows = null }, ui) {
  const { h, icon, ring } = ui;
  const prefs = store.getPrefs();
  const now = Date.now();
  const soonMs = (prefs.soonDays || 3) * 86400000;
  const rows = items.map((it) => ({ cid: it.cid, a: it.a, sub: it.sub, className: it.className || "", due: cloud.toMillis(it.a.due) || 0, k: kindInfo(it.a) }));
  const done = rows.filter((r) => r.sub);
  const todo = rows.filter((r) => !r.sub).sort((x, y) => (x.due ? x.due : Infinity) - (y.due ? y.due : Infinity));
  const overdue = todo.filter((r) => r.due && r.due < now);
  const soon = todo.filter((r) => r.due && r.due >= now && r.due - now <= soonMs);
  const rate = rows.length ? done.length / rows.length : 0;
  const scored = done.filter((r) => r.a.kind !== "words" && r.sub.score && r.sub.score.total > 0);
  const avg = scored.length ? Math.round(scored.reduce((n, r) => n + r.sub.score.pct, 0) / scored.length) : null;
  const o = store.overall();
  const goal = prefs.dailyGoal || 20;
  const hour = new Date().getHours();
  const hello = hour >= 5 && hour < 11 ? "おはようございます" : hour >= 11 && hour < 18 ? "こんにちは" : "こんばんは";
  const dateText = new Date().toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "long" });
  const href = (r) => `#/task/${encodeURIComponent(r.cid)}/${encodeURIComponent(r.a.id)}`;

  const next = todo[0];
  const hero = h("section", { class: "today" },
    h("div", { class: "today-main" },
      h("p", { class: "today-label" }, icon(next ? (overdue.length ? "warning" : "flag") : "emoji_events"), next ? "次にやること" : "おつかれさまです"),
      next ? [
        h("p", { class: "dh-next-title" }, next.a.title),
        h("p", { class: "today-sub" }, `${next.k.name}${next.due ? `・締め切り ${fmtDue(next.a.due)}（${dueText(next.due, now)}）` : "・締め切りなし"}`)
      ] : [
        h("p", { class: "dh-next-title" }, rows.length ? "出すものは、すべて出しました" : "まだ何も配られていません"),
        h("p", { class: "today-sub" }, rows.length ? "新しい課題が配られると、ここに出ます。" : "先生が課題を配ると、ここに出ます。")
      ]),
    next ? h("a", { class: "filled-btn today-start", href: href(next) }, icon("play_arrow"), h("span", null, "取り組む")) : null);

  const stat = (ic, value, unit, label, tone) => h("div", { class: `stat-card tone-${tone}` },
    h("span", { class: "stat-icon" }, icon(ic)),
    h("span", { class: "stat-text" }, h("strong", null, String(value), h("small", null, unit)), h("span", null, label)));

  const groups = Object.entries(GROUPS).map(([key, gr]) => {
    const list = rows.filter((r) => gr.has(r.a));
    return { key, gr, total: list.length, done: list.filter((r) => r.sub).length };
  }).filter((x) => x.total > 0);

  const attention = [
    overdue.length ? h("span", { class: "dh-pill bad" }, icon("warning"), `期限切れ ${overdue.length}`) : null,
    soon.length ? h("span", { class: "dh-pill warn" }, icon("schedule"), `もうすぐ締め切り ${soon.length}`) : null
  ].filter(Boolean);

  const stamp = (r) => cloud.toMillis(r.sub.submittedAt) || cloud.toMillis(r.sub.updatedAt) || 0;
  const recent = done.slice().sort((x, y) => stamp(y) - stamp(x)).slice(0, 5);

  return [
    h("header", { class: "home-head" },
      h("p", { class: "home-date" }, dateText),
      h("h1", null, name ? `${hello}、${name} さん` : hello),
      h("p", { class: "muted dh-sub" }, head)),
    h("div", { class: "home-top" },
      hero,
      h("div", { class: "stat-grid" },
        stat("local_fire_department", o.streak, "日", "連続で学習", "fire"),
        stat("task_alt", o.today, ` / ${goal} 問`, "今日の学習（目標）", "primary"),
        stat("grade", avg == null ? "-" : avg, avg == null ? "" : "点", "平均点", "good"))),
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, "クラスでの進み具合"), h("div", { class: "dh-pills" }, attention)),
      h("div", { class: "dh-progress" },
        h("div", { class: "dh-progress-ring" },
          ring(rate, { size: 96, stroke: 9, color: rate >= 1 ? "var(--st-mastered)" : "var(--primary)", label: `${Math.round(rate * 100)}%` }),
          h("span", null, `${done.length} / ${rows.length} 提出`)),
        h("div", { class: "dh-bars" },
          groups.length ? groups.map(({ key, gr, total, done: d }) => h("a", { class: "dh-bar", href: `#/?k=${key}` },
            h("span", { class: "dh-bar-label" }, icon(gr.icon), gr.name, h("small", null, `${d} / ${total}`)),
            h("span", { class: "dh-meter", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(total), "aria-valuenow": String(d) }, h("i", { style: `width:${total ? (d / total) * 100 : 0}%` }))))
            : h("p", { class: "muted small" }, "配られたものがまだありません。")))),
    classRows && classRows.length ? h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, `クラス（${classRows.length}）`)),
      h("div", { class: "set-list" }, classRows.map(({ cls, total, done: d }) => h("div", { class: "set-row" },
        h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon("groups")),
        h("div", { class: "set-row-body" },
          h("a", { class: "set-row-link", href: `#/class/${encodeURIComponent(cls.id)}` },
            h("span", { class: "set-row-sub" }, h("span", null, cls.teacherName ? `${cls.teacherName} 先生` : "クラス")),
            h("span", { class: "set-row-title" }, cls.name)),
          h("span", { class: "set-row-meta" }, h("span", { class: total && d === total ? "done" : "" }, icon(total && d === total ? "task_alt" : "pending"), `提出 ${d} / ${total}`))),
        h("div", { class: "set-row-end" }, icon("chevron_right")))))) : null,
    todo.length ? h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, `やること（${todo.length}）`)),
      h("div", { class: "set-list" }, todo.slice(0, 8).map((r) => assignRow(r.cid, r.a, r.sub, now, ui, r.className))),
      todo.length > 8 ? h("p", { class: "muted small" }, `ほか ${todo.length - 8} 件は、左のメニューの「小テスト」「課題」「資料」から開けます。`) : null) : null,
    recent.length ? h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, "最近の提出")),
      h("div", { class: "set-list" }, recent.map((r) => h("div", { class: "set-row" },
        h("span", { class: `thumb kind-${r.a.kind}${r.a.print && r.a.print.exam ? " is-exam" : ""}`, "aria-hidden": "true" }, icon(r.k.icon)),
        h("div", { class: "set-row-body" },
          h("a", { class: "set-row-link", href: href(r) },
            h("span", { class: "set-row-sub" }, h("span", { class: "kind-pill" }, r.k.name)),
            h("span", { class: "set-row-title" }, r.a.title)),
          h("span", { class: "set-row-meta" }, h("span", { class: "done" }, icon("task_alt"), r.a.kind === "words" ? `覚えた ${r.sub.score.ok} / ${r.sub.score.total} 語` : r.a.resultsOpen || r.a.kind === "print" ? `${r.sub.score.pct} 点` : "提出ずみ（結果は返却のあと）"))),
        h("div", { class: "set-row-end" }, icon("chevron_right")))))) : null
  ];
}

// ---------- 学校のプロファイルの生徒（組織モデル） ----------
//   info = { sid, personId, className: 学校の名前, profileName }。学校の名簿のユーザーに紐づいた全クラスの課題を、1 つにまとめて出す
export async function renderOrgStudent(info, ui, group = "") {
  const { h, icon, app } = ui;
  const hash = location.hash;
  loading(ui);
  if (!(await needReady(ui))) return;
  let list;
  try { list = (await cloud.personClasses(info.sid, info.personId)).filter((k) => k.role === "student"); } catch (e) {
    if (location.hash !== hash) return;
    ui.message("クラスを読めませんでした", cloud.explain(e));
    return;
  }
  const loaded = (await Promise.all(list.map(async (k) => {
    try {
      const [cls, assigns] = await Promise.all([cloud.getClass(k.id), cloud.publishedAssignments(k.id)]);
      const subs = await Promise.all(assigns.map((a) => cloud.mySubmission(k.id, a.id).catch(() => null)));
      return { cls, assigns, subs };
    } catch (e) { return null; } // 消されたクラスなどは飛ばす
  }))).filter(Boolean);
  if (location.hash !== hash) return;
  document.title = `${info.className} - SK Study`;
  const now = Date.now();
  const items = loaded.flatMap(({ cls, assigns, subs }) => assigns.map((a, i) => ({ cid: cls.id, a, sub: subs[i], className: cls.name })));
  const g = GROUPS[group] || null;
  if (g) {
    const part = items.filter((it) => g.has(it.a));
    app.replaceChildren(h("section", { class: "section" },
      h("h2", null, `${g.name}（${part.length}）`),
      part.length ? h("div", { class: "set-list" }, part.map((it) => assignRow(it.cid, it.a, it.sub, now, ui, it.className))) : h("p", { class: "muted" }, g.empty)));
    return;
  }
  app.replaceChildren(...studentHomeFrom({
    items, head: `${info.className}${loaded.length ? `・${loaded.length} クラス` : ""}`, name: info.profileName,
    classRows: loaded.map(({ cls, assigns, subs }) => ({ cls, total: assigns.length, done: subs.filter(Boolean).length }))
  }, ui).filter(Boolean));
  if (!loaded.length) app.append(h("div", { class: "empty-card" }, icon("groups", "empty-icon"), h("p", null, "まだ、クラスに入っていません。学校の先生が、あなたをクラスに入れると、ここに課題が出ます。")));
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

  const tname = await cloud.getClass(cid).then((c) => c.teacherName || "").catch(() => "");
  const extra = { noCopy: !!a.noCopy, teacherName: tname };
  if (a.kind === "words") {
    const set = store.cacheClassSet(cid, aid, "words", a.set || {}, a.title, extra);
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
  const set = store.cacheClassSet(cid, aid, "wordtest", a.set || {}, a.title, extra);
  const count = Math.min((a.test && a.test.count) || 10, set.words.length);
  const format = (a.test && a.test.format) || "auto";
  document.title = `${a.title} - SK Study`;
  if (sub && !a.resultsOpen) {
    // 先生が返却するまで、点数も答えも見せない
    app.replaceChildren(
      ui.backLink("クラス", back),
      h("section", { class: "result task-result" },
        h("p", { class: "test-pill big" }, "提出ずみ"),
        h("h1", null, a.title),
        icon("hourglass_top", "message-icon"),
        h("p", { class: "result-score" }, "結果は、先生が返却すると見られます。")));
    return;
  }
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
        h("li", null, icon("send"), "1 回だけ。提出する前に、全部の答えを確かめられます"),
        h("li", null, icon("assignment_return"), "結果は、先生が返却すると見られます"),
        isPcLike() ? h("li", null, icon("fullscreen"), "全画面にして始めます。途中で全画面をやめると、戻すまで進めません") : null),
      button("filled", "はじめる", "play_arrow", () => {
        if (!set.words.length) { toast("この小テストには単語が入っていません"); return; }
        const items = ui.shuffle(set.words).slice(0, count).map((word) => ({ set, word }));
        ui.runSession({
          items, mode: "test", format, title: a.title, backHref: back, classTest: true,
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
              return true;
            } catch (e) {
              const p = readPending();
              p[pkey] = { score, data };
              writePending(p);
              toast(`先生に送れませんでした。次に開いたときに送り直します（${cloud.explain(e)}）`);
              return false;
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
