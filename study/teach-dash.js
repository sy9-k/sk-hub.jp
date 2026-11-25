// 先生・総合管理者のホームの「ダッシュボード」（クラスの様子・要対応・生徒の進み具合）。teach.js の homeView から使う
//   クラスごとに、名簿・配信・提出を読んで集計する（読むだけ。書き換えない）
//   ・要対応 … 採点待ち（プリント）・返却待ち（小テスト）・締め切りが近い / 過ぎて出ていない人がいる配信・コード待ちの生徒
//   ・生徒の進み具合 … クラスを選ぶと、生徒ごとに 提出の数・平均点・最後に出した日・期限切れの数 が表で見られる
import { tx, locale } from "./i18n.js";
import * as cloud from "./cloud.js";
import * as store from "./store.js";
import { fmtDue, kindInfo } from "./classroom.js";

const DAY = 86400000;
const shortDate = (ms) => (ms ? new Date(ms).toLocaleDateString(locale, { month: "numeric", day: "numeric" }) : "-");

// 1 つのクラスの集計
async function loadRoster(c) {
  if (c.orgModel !== true) return cloud.roster(c.id);
  // 組織モデル: 在籍（提出の ID は slotId があればそれ）と、名簿の結びつきの有無
  const [cp, people] = await Promise.all([cloud.classPeople(c.id), cloud.schoolPeople(c.schoolId)]);
  const claimed = new Map(people.map((p) => [p.id, !!p.claimedBy]));
  return cp.students.map((e) => ({ id: e.slotId || e.id, name: e.name, claimed: !!claimed.get(e.id) }));
}
async function loadClass(c) {
  const [roster, assigns] = await Promise.all([loadRoster(c), cloud.allAssignments(c.id)]);
  const pub = assigns.filter((a) => a.published);
  const subs = await Promise.all(pub.map((a) => cloud.submissions(c.id, a.id).catch(() => [])));
  return { c, roster, pub, subs, all: assigns };
}

// 生徒 1 人ごとの進み具合
function studentRows(d, now) {
  return d.roster.map((m) => {
    const mine = d.pub.map((a, i) => ({ a, sub: d.subs[i].find((s) => s.id === m.id) || null }));
    const done = mine.filter((x) => x.sub);
    const scored = done.filter((x) => x.a.kind !== "words" && x.sub.score && x.sub.score.total > 0);
    const avg = scored.length ? Math.round(scored.reduce((n, x) => n + x.sub.score.pct, 0) / scored.length) : null;
    const last = done.reduce((t, x) => Math.max(t, cloud.toMillis(x.sub.updatedAt) || cloud.toMillis(x.sub.submittedAt) || 0), 0);
    const overdue = mine.filter((x) => !x.sub && cloud.toMillis(x.a.due) && cloud.toMillis(x.a.due) < now).length;
    return { m, total: mine.length, done: done.length, avg, last, overdue, missing: mine.filter((x) => !x.sub).map((x) => x.a.title) };
  });
}

export function dashboardSection(ui, { classes, schools = [], schoolName = new Map(), title = tx("ダッシュボード") }) {
  const { h, icon, ring } = ui;
  const body = h("div", { class: "dh-body" }, h("p", { class: "loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), tx("クラスの様子を集めています…")));
  const section = h("section", { class: "section dh" }, h("div", { class: "section-head" }, h("h2", null, title)), body);
  const hash = location.hash;

  (async () => {
    // 総合管理者は、自分の学校のクラスも合わせる
    const all = new Map(classes.map((c) => [c.id, c]));
    if (schools.length) {
      const lists = await Promise.all(schools.map((s) => cloud.schoolClasses(s.id).catch(() => [])));
      lists.flat().forEach((c) => { if (!all.has(c.id)) all.set(c.id, c); });
    }
    const list = [...all.values()];
    if (!list.length) { body.replaceChildren(h("p", { class: "muted" }, tx("クラスができると、ここに生徒の様子が出ます。"))); return; }
    const data = await Promise.all(list.map((c) => loadClass(c).catch(() => null)));
    if (location.hash !== hash) return;
    draw(data.filter(Boolean));
  })().catch((e) => { console.error(e); body.replaceChildren(h("p", { class: "warn small" }, cloud.explain(e))); });

  function draw(data) {
    const prefs = store.getPrefs();
    const now = Date.now();
    const soon = (prefs.soonDays || 3) * DAY;
    const students = data.reduce((n, d) => n + d.roster.length, 0);
    const joined = data.reduce((n, d) => n + d.roster.filter((m) => m.claimed).length, 0);
    const waiting = students - joined;
    const live = data.reduce((n, d) => n + d.pub.length, 0);
    let expected = 0, submitted = 0, ungraded = 0;
    const todo = [];
    for (const d of data) {
      const claimed = d.roster.filter((m) => m.claimed).length;
      d.pub.forEach((a, i) => {
        const subs = d.subs[i];
        const due = cloud.toMillis(a.due) || 0;
        expected += claimed;
        submitted += Math.min(subs.length, claimed || subs.length);
        const link = `#/teach/${encodeURIComponent(d.c.id)}/${encodeURIComponent(a.id)}`;
        if (a.kind === "print") {
          const n = subs.filter((s) => !s.grade).length;
          ungraded += n;
          if (n) todo.push({ w: 0, ic: "rate_review", text: tx("{title}: 採点待ち {n} 件", { title: a.title, n }), sub: d.c.name, link });
        } else if (a.kind === "wordtest" && subs.length && !a.resultsOpen) {
          todo.push({ w: 1, ic: "assignment_return", text: tx("{title}: 返却待ち（{length} 人が提出）", { title: a.title, length: subs.length }), sub: d.c.name, link });
        }
        const missing = Math.max(0, claimed - subs.length);
        if (missing && due && due < now && now - due < 14 * DAY) todo.push({ w: 2, ic: "warning", text: tx("{title}: 期限が過ぎて、未提出 {missing} 人", { title: a.title, missing }), sub: d.c.name, link });
        else if (missing && due && due >= now && due - now <= soon) todo.push({ w: 3, ic: "schedule", text: tx("{title}: {due} 締め切り、未提出 {missing} 人", { title: a.title, due: fmtDue(a.due), missing }), sub: d.c.name, link });
      });
      const w = d.roster.filter((m) => !m.claimed).length;
      if (w) todo.push({ w: 4, ic: "key", text: tx("{w} 人がまだ参加していません（コード待ち）", { w }), sub: d.c.name, link: `#/teach/${encodeURIComponent(d.c.id)}` });
    }
    todo.sort((x, y) => x.w - y.w);
    const rate = expected ? submitted / expected : 0;

    const stat = (ic, value, unit, label, tone) => h("div", { class: `stat-card tone-${tone}` },
      h("span", { class: "stat-icon" }, icon(ic)),
      h("span", { class: "stat-text" }, h("strong", null, String(value), h("small", null, unit)), h("span", null, label)));

    // 生徒の進み具合（クラスを選ぶ）
    let current = data[0].c.id;
    let order = "care";
    const table = h("div", { class: "dh-table-wrap" });
    const chips = h("div", { class: "chips", role: "group", "aria-label": tx("クラス") });
    const sorts = h("div", { class: "chips", role: "group", "aria-label": tx("並び順") });
    const drawTable = () => {
      const d = data.find((x) => x.c.id === current);
      const rows = studentRows(d, now);
      rows.sort(order === "name"
        ? (a, b) => String(a.m.name).localeCompare(String(b.m.name), "ja")
        : (a, b) => (!a.m.claimed) - (!b.m.claimed) || b.overdue - a.overdue || (a.total ? a.done / a.total : 1) - (b.total ? b.done / b.total : 1) || String(a.m.name).localeCompare(String(b.m.name), "ja"));
      const cRate = d.roster.length && d.pub.length ? rows.reduce((n, r) => n + r.done, 0) / (rows.filter((r) => r.m.claimed).length * d.pub.length || 1) : 0;
      chips.replaceChildren(...data.map((x) => h("button", { type: "button", class: "chip", "aria-pressed": String(x.c.id === current), onclick: () => { current = x.c.id; drawTable(); } }, x.c.name)));
      sorts.replaceChildren(...[["care", tx("気になる順")], ["name", tx("名前順")]].map(([k, l]) => h("button", { type: "button", class: "chip", "aria-pressed": String(order === k), onclick: () => { order = k; drawTable(); } }, l)));
      table.replaceChildren(
        h("div", { class: "dh-class-line" },
          h("span", null, icon("groups"), tx("{length} 人（参加 {n}）", { length: d.roster.length, n: d.roster.filter((m) => m.claimed).length })),
          h("span", null, icon("assignment"), tx("配信中 {length}", { length: d.pub.length })),
          h("span", null, icon("donut_large"), tx("提出率 {n}%", { n: Math.round(Math.min(1, cRate) * 100) })),
          d.c.orgModel === true ? null : h("a", { class: "text-btn", href: `#/teach/${encodeURIComponent(d.c.id)}` }, tx("クラスを開く"), icon("chevron_right"))),
        d.roster.length ? h("table", { class: "tc-table dh-table" },
          h("thead", null, h("tr", null, h("th", null, tx("生徒")), h("th", null, tx("提出")), h("th", null, tx("平均点")), h("th", null, tx("最後に出した日")), h("th", null, tx("状態")))),
          h("tbody", null, rows.map((r) => {
            const pct = r.total ? r.done / r.total : 0;
            const state = !r.m.claimed ? [tx("コード待ち"), ""] : r.overdue ? [tx("期限切れ {overdue}", { overdue: r.overdue }), "bad"] : r.total && r.done === r.total ? [tx("全部提出"), "ok"] : r.total ? [tx("進行中"), ""] : [tx("配信なし"), ""];
            return h("tr", { class: r.m.claimed ? "" : "is-missing", title: r.missing.length ? tx("未提出: {n}", { n: r.missing.join("、") }) : "" },
              h("td", null, r.m.name),
              h("td", null, r.total ? h("span", { class: "dh-cell-bar" }, h("span", { class: "dh-meter small" }, h("i", { style: `width:${pct * 100}%` })), h("small", null, `${r.done} / ${r.total}`)) : "-"),
              h("td", null, r.avg == null ? "-" : tx("{avg} 点", { avg: r.avg })),
              h("td", null, shortDate(r.last)),
              h("td", null, h("span", { class: `dh-pill ${state[1]}` }, state[0])));
          }))) : h("p", { class: "muted small" }, tx("このクラスには、まだ生徒がいません。")));
    };
    drawTable();

    body.replaceChildren(
      h("div", { class: "dh-stats" },
        stat("groups", data.length, (" " + tx("クラス")), tx("生徒 {students} 人（参加 {joined}{n}）", { students, joined, n: waiting ? tx("・コード待ち {waiting}", { waiting }) : "" }), "primary"),
        stat("assignment", live, (" " + tx("件")), tx("配信中"), "primary"),
        stat("donut_large", expected ? Math.round(rate * 100) : "-", expected ? "%" : "", tx("提出率（参加した生徒）"), "good"),
        stat("rate_review", ungraded, (" " + tx("件")), tx("採点待ち"), ungraded ? "fire" : "good")),
      h("div", { class: "dh-two" },
        h("div", { class: "mk-card dh-todo" },
          h("h2", null, icon("notification_important"), tx("要対応（{length}）", { length: todo.length })),
          todo.length ? h("ul", { class: "dh-todo-list" }, todo.slice(0, 8).map((t) => h("li", null,
            h("a", { href: t.link }, icon(t.ic), h("span", null, h("strong", null, t.text), h("small", null, t.sub)))))) : h("p", { class: "muted small" }, tx("いま対応が必要なことはありません。")),
          todo.length > 8 ? h("p", { class: "muted small" }, tx("ほか {n} 件", { n: todo.length - 8 })) : null),
        h("div", { class: "mk-card dh-classes" },
          h("h2", null, icon("groups"), tx("クラスごとの提出率")),
          h("div", { class: "dh-class-bars" }, data.map((d) => {
            const claimed = d.roster.filter((m) => m.claimed).length;
            const exp = claimed * d.pub.length;
            const got = d.subs.reduce((n, s) => n + Math.min(s.length, claimed || s.length), 0);
            const p = exp ? got / exp : 0;
            return h("button", { type: "button", class: "dh-bar", onclick: () => { current = d.c.id; drawTable(); table.scrollIntoView({ behavior: "smooth", block: "nearest" }); } },
              h("span", { class: "dh-bar-label" }, d.c.name, h("small", null, exp ? `${Math.round(p * 100)}%` : "-")),
              h("span", { class: "dh-meter" }, h("i", { style: `width:${p * 100}%` })));
          })))),
      h("div", { class: "mk-card" },
        h("h2", null, icon("monitoring"), tx("生徒の進み具合")),
        h("div", { class: "dh-filters" }, chips, sorts), table));
  }
  return section;
}

// ---------- 総合管理者のホーム ----------
//   学校ごと・先生ごと・クラスごとに、人数と提出の様子をまとめて見る。ここから、学校の画面（先生のコード・先生・クラス）に入る
export function adminSection(ui, { schools, onCreateSchool }) {
  const { h, icon, button } = ui;
  const body = h("div", { class: "dh-body" }, h("p", { class: "loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), tx("学校の様子を集めています…")));
  const section = h("section", { class: "section dh" },
    h("div", { class: "section-head" }, h("h2", null, tx("学校（{length}）", { length: schools.length })), button("filled", tx("学校を作る"), "add", onCreateSchool)), body);
  const hash = location.hash;

  (async () => {
    if (!schools.length) {
      body.replaceChildren(h("div", { class: "empty-card" }, icon("apartment", "empty-icon"), h("p", null, tx("まだ学校がありません。学校を作って、先生にコードを配りましょう。"))));
      return;
    }
    const codes = await cloud.myStaffCodes().catch(() => []);
    const per = await Promise.all(schools.map(async (sc) => {
      const [staff, classes] = await Promise.all([cloud.schoolStaff(sc.id).catch(() => []), cloud.schoolClasses(sc.id).catch(() => [])]);
      const data = (await Promise.all(classes.map((c) => loadClass(c).catch(() => null)))).filter(Boolean);
      return { sc, staff, data, waiting: codes.filter((c) => c.schoolId === sc.id && !c.claimedBy) };
    }));
    if (location.hash !== hash) return;
    draw(per);
  })().catch((e) => { console.error(e); body.replaceChildren(h("p", { class: "warn small" }, cloud.explain(e))); });

  // クラス 1 つの数字
  const meter = (d) => {
    const claimed = d.roster.filter((m) => m.claimed).length;
    const exp = claimed * d.pub.length;
    const got = d.subs.reduce((n, x) => n + Math.min(x.length, claimed || x.length), 0);
    const ungraded = d.pub.reduce((n, a, i) => n + (a.kind === "print" ? d.subs[i].filter((x) => !x.grade).length : 0), 0);
    const last = d.all.reduce((t, a) => Math.max(t, cloud.toMillis(a.createdAt) || 0), 0);
    return { claimed, exp, got, ungraded, last, rate: exp ? got / exp : null };
  };
  const pct = (r) => (r == null ? "-" : `${Math.round(r * 100)}%`);

  function draw(per) {
    const allData = per.flatMap((p) => p.data);
    const ms = new Map(allData.map((d) => [d.c.id, meter(d)]));
    const sum = (f) => allData.reduce((n, d) => n + f(d, ms.get(d.c.id)), 0);
    const students = sum((d) => d.roster.length);
    const joined = sum((d, m) => m.claimed);
    const exp = sum((d, m) => m.exp), got = sum((d, m) => m.got);
    const ungraded = sum((d, m) => m.ungraded);
    const staffN = per.reduce((n, p) => n + p.staff.length, 0);
    const waitN = per.reduce((n, p) => n + p.waiting.length, 0);
    const stat = (ic, value, unit, label, tone) => h("div", { class: `stat-card tone-${tone}` },
      h("span", { class: "stat-icon" }, icon(ic)),
      h("span", { class: "stat-text" }, h("strong", null, String(value), h("small", null, unit)), h("span", null, label)));

    // 要対応
    const todo = [];
    for (const p of per) {
      if (p.waiting.length) todo.push({ w: 3, ic: "key", text: tx("先生 {length} 人がまだ参加していません（コード待ち）", { length: p.waiting.length }), sub: p.sc.name, link: `#/teach/school/${encodeURIComponent(p.sc.id)}` });
      for (const d of p.data) {
        const m = ms.get(d.c.id);
        const who = tx("{name}・{n}", { name: p.sc.name, n: d.c.teacherName || tx("先生") });
        const link = `#/teach/${encodeURIComponent(d.c.id)}`;
        if (m.ungraded) todo.push({ w: 1, ic: "rate_review", text: tx("{name}: 採点待ち {ungraded} 件", { name: d.c.name, ungraded: m.ungraded }), sub: who, link });
        if (m.rate != null && m.rate < 0.5 && m.exp >= 4) todo.push({ w: 2, ic: "trending_down", text: tx("{name}: 提出率 {rate}", { name: d.c.name, rate: pct(m.rate) }), sub: who, link });
        if (!d.pub.length) todo.push({ w: 4, ic: "assignment_late", text: tx("{name}: まだ配信がありません", { name: d.c.name }), sub: who, link });
      }
    }
    todo.sort((a, b) => a.w - b.w);

    // 先生ごとの活動（クラスの持ち主ごと）
    const byTeacher = new Map();
    for (const p of per) for (const d of p.data) {
      const key = `${p.sc.id}/${d.c.ownerUid}`;
      const t = byTeacher.get(key) || { name: d.c.teacherName || tx("先生"), school: p.sc.name, classes: 0, students: 0, live: 0, last: 0, got: 0, exp: 0 };
      const m = ms.get(d.c.id);
      t.classes++; t.students += d.roster.length; t.live += d.pub.length; t.last = Math.max(t.last, m.last); t.got += m.got; t.exp += m.exp;
      byTeacher.set(key, t);
    }
    const teachers = [...byTeacher.values()].sort((a, b) => a.school.localeCompare(b.school, "ja") || a.name.localeCompare(b.name, "ja"));
    const classRows = per.flatMap((p) => p.data.map((d) => ({ d, m: ms.get(d.c.id), school: p.sc.name })))
      .filter((x) => x.m.rate != null).sort((a, b) => a.m.rate - b.m.rate).slice(0, 8);

    body.replaceChildren(
      h("div", { class: "dh-stats" },
        stat("apartment", per.length, (" " + tx("校")), tx("学校"), "primary"),
        stat("school", staffN, (" " + tx("人")), tx("先生{n}", { n: waitN ? tx("（コード待ち {waitN}）", { waitN }) : "" }), "primary"),
        stat("groups", allData.length, (" " + tx("クラス")), tx("生徒 {students} 人（参加 {joined}）", { students, joined }), "primary"),
        stat("donut_large", exp ? Math.round((got / exp) * 100) : "-", exp ? "%" : "", tx("提出率（全体）"), "good"),
        stat("rate_review", ungraded, (" " + tx("件")), tx("採点待ち"), ungraded ? "fire" : "good")),
      h("div", { class: "card-grid dh-schools" }, per.map((p) => {
        const mm = p.data.map((d) => ms.get(d.c.id));
        const e = mm.reduce((n, m) => n + m.exp, 0), g = mm.reduce((n, m) => n + m.got, 0);
        const r = e ? g / e : null;
        const stu = p.data.reduce((n, d) => n + d.roster.length, 0);
        const href = `#/teach/school/${encodeURIComponent(p.sc.id)}`;
        return h("article", { class: "set-card dh-school" },
          h("a", { class: "set-card-main", href },
            h("span", { class: "set-card-top" }, h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon("apartment")), h("span", { class: "dh-pill" }, tx("提出率 {r}", { r: pct(r) }))),
            h("span", { class: "set-card-title" }, p.sc.name),
            h("span", { class: "set-row-meta" },
              h("span", null, icon("school"), tx("先生 {length}{n}", { length: p.staff.length, n: p.waiting.length ? tx("（待ち {length}）", { length: p.waiting.length }) : "" })),
              h("span", null, icon("groups"), tx("クラス {length}", { length: p.data.length })),
              h("span", null, icon("person"), tx("生徒 {stu}", { stu }))),
            h("span", { class: "dh-meter" }, h("i", { style: `width:${(r || 0) * 100}%` }))),
          h("div", { class: "set-card-actions" }, ui.linkButton("text", tx("開く"), null, href)));
      })),
      h("div", { class: "dh-two" },
        h("div", { class: "mk-card dh-todo" },
          h("h2", null, icon("notification_important"), tx("要対応（{length}）", { length: todo.length })),
          todo.length ? h("ul", { class: "dh-todo-list" }, todo.slice(0, 8).map((t) => h("li", null, h("a", { href: t.link }, icon(t.ic), h("span", null, h("strong", null, t.text), h("small", null, t.sub)))))) : h("p", { class: "muted small" }, tx("いま対応が必要なことはありません。")),
          todo.length > 8 ? h("p", { class: "muted small" }, tx("ほか {n} 件", { n: todo.length - 8 })) : null),
        h("div", { class: "mk-card" },
          h("h2", null, icon("trending_down"), tx("提出が少ないクラス")),
          classRows.length ? h("div", { class: "dh-class-bars" }, classRows.map(({ d, m, school }) => h("a", { class: "dh-bar", href: `#/teach/${encodeURIComponent(d.c.id)}` },
            h("span", { class: "dh-bar-label" }, d.c.name, h("small", null, pct(m.rate))),
            h("span", { class: "dh-bar-sub" }, tx("{school}・{n}", { school, n: d.c.teacherName || tx("先生") })),
            h("span", { class: "dh-meter" }, h("i", { style: `width:${m.rate * 100}%` }))))) : h("p", { class: "muted small" }, tx("配信と提出がそろうと、ここに出ます。")))),
      h("div", { class: "mk-card" },
        h("h2", null, icon("school"), tx("先生の活動")),
        teachers.length ? h("div", { class: "dh-table-wrap" }, h("table", { class: "tc-table dh-table" },
          h("thead", null, h("tr", null, h("th", null, tx("先生")), h("th", null, tx("学校")), h("th", null, tx("クラス")), h("th", null, tx("生徒")), h("th", null, tx("配信中")), h("th", null, tx("提出率")), h("th", null, tx("最後に配信した日")))),
          h("tbody", null, teachers.map((t) => h("tr", null,
            h("td", null, t.name), h("td", null, t.school), h("td", null, String(t.classes)), h("td", null, String(t.students)), h("td", null, String(t.live)),
            h("td", null, t.exp ? `${Math.round((t.got / t.exp) * 100)}%` : "-"), h("td", null, shortDate(t.last))))))) : h("p", { class: "muted small" }, tx("先生がクラスを作ると、ここに出ます。"))));
  }
  return section;
}
