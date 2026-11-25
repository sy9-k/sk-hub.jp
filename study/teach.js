// SK Study の指導者メニュー（パソコン向け）。データは cloud.js、権限は y-filter の systems/firestore.rules の「SK Study」
//   階層: 総合管理者 → 学校 → 先生 → クラス。総合管理者・先生は、コード（総合管理者のコードは SK が、先生のコードは学校の総合管理者が配る）で入る
//   #/teach              コードを入れる（まだ指導者でないとき）・総合管理者は学校の一覧、先生はクラスの一覧
//   #/teach/school/<sid> 学校（総合管理者。先生のコード・先生・クラス）
//   #/teach/<cid>        クラス（参加コード・配信・生徒）
//   #/teach/<cid>/new    配信する（単語帳・単語の小テスト・プリント）
//   #/teach/<cid>/<aid>  結果（提出の一覧・採点・結果の公開）
//   プリントの採点は print.js の gradeAnswers()。試験用は、合言葉で暗号を開いてから採点する（合言葉はこの画面の中だけで使う）
//   結果を生徒に見せるとき、試験用のプリントは合言葉を課題に入れる（生徒の画面で答え合わせができるように）
import { tx, locale, isJa } from "./i18n.js";
import * as cloud from "./cloud.js";
import * as store from "./store.js";
import { getHtml, gradeAnswers, listPrints, parsePrint, tally } from "./print.js";
import { normPass, openAnswers } from "./printfmt.js";
import { fmtDue, kindInfo } from "./classroom.js";
import { openInviteSheet } from "./invite-pdf.js";
import { dashboardSection, adminSection } from "./teach-dash.js";
import { schoolTabs, openPicker } from "./teach-school.js";

const FORMAT_LABEL = { auto: tx("おまかせ（4 択と書き取り）"), choice: tx("4 択だけ"), write: tx("書き取りだけ") };
const MARK_LABEL = { ok: "○", partial: "△", ng: "×", pending: tx("未採点") };

function loading(ui) {
  ui.app.replaceChildren(ui.h("p", { class: "loading" }, ui.h("span", { class: "spinner", "aria-hidden": "true" }), tx("読み込み中…")));
}
const fmtDate = (v) => {
  const t = cloud.toMillis(v);
  return t ? new Date(t).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-";
};
const enc = new TextEncoder();
const bytes = (s) => enc.encode(s).length;

export async function renderTeach(parts, ui) {
  const { h, icon, linkButton, app } = ui;
  const hash = location.hash;
  document.title = tx("指導者メニュー - SK Study");
  loading(ui);
  const s = await cloud.session();
  if (location.hash !== hash) return;
  if (s.status !== "ready") {
    app.replaceChildren(h("section", { class: "message" },
      icon("school", "message-icon"),
      h("h1", null, tx("指導者メニュー")),
      h("p", null, s.status === "offline" ? tx("SK Hub Systems に接続できませんでした。") : s.status === "not-connected" ? tx("SK Hub Systems アカウントを SK Study に接続してください。") : tx("SK Hub Systems アカウントでログインしてください。")),
      s.status === "offline" ? linkButton("filled", tx("ホームへ"), "home", "#/") : linkButton("filled", s.status === "not-connected" ? tx("SK Study に接続する") : tx("ログイン"), "login", cloud.accountUrl(true))));
    return;
  }
  let ts;
  try { ts = await cloud.teacherState(); } catch (e) { ui.message(tx("指導者メニューを開けませんでした"), cloud.explain(e)); return; }
  if (location.hash !== hash) return;
  const [cid, sub] = parts;
  // 先生・総合管理者は、専用のプロファイルで入る（個人のプロファイルでは、プロファイルの選択とコード入力だけ）
  //   学校のない従来の先生（申し込みで承認された人）だけは、個人のままでも使える
  const staff = !!(ui.staffCtx && ui.staffCtx());
  const legacy = !!ts.teacher && !ts.schools.length && !ts.admin;
  const orgc = ui.orgCtx ? ui.orgCtx() : null;
  try {
    if (orgc) {
      if (!cid) await orgTeacherHome(s, ui, orgc);
      else if (sub === "new") await newAssignView(cid, ui);
      else if (sub) await resultsView(cid, sub, ui);
      else await classView(cid, ui);
    } else if (!staff && !legacy) await personalView(ts, ui);
    else if (!ts.teacher && !ts.admin) await codeView(ui);
    else if (!cid) await homeView(ts, s, ui, staff ? cloud.activeClass() : "");
    else if (cid === "school" && sub) await schoolView(sub, s, ui);
    else if (sub === "new") await newAssignView(cid, ui);
    else if (sub) await resultsView(cid, sub, ui);
    else await classView(cid, ui);
  } catch (e) {
    console.error(e);
    if (location.hash === hash) ui.message(tx("うまく表示できませんでした"), cloud.explain(e));
  }
}

function head(ui, title, lead, back) {
  const { h } = ui;
  return [
    back ? ui.backLink(back[0], back[1]) : null,
    h("div", { class: "tc-head" }, h("p", { class: "tc-eyebrow" }, ui.icon("school"), tx("指導者メニュー")), h("h1", null, title), lead ? h("p", { class: "muted" }, lead) : null)
  ].filter(Boolean);
}

// ---------- コードを入れる（総合管理者・先生になる） ----------

function roleText(info) {
  return info.role === "admin" ? tx("総合管理者") : tx("{schoolName} の先生", { schoolName: info.schoolName });
}

export function openStaffCodeDialog(ui, onDone) {
  const { h, button, toast, openDialog } = ui;
  const input = h("input", { type: "text", class: "field-input code-input", maxlength: "7", placeholder: "ABC123", autocomplete: "off", autocapitalize: "characters", "aria-label": tx("コード") });
  const info = h("div", { class: "join-info" });
  let found = null;
  const look = async () => {
    const code = cloud.normCode(input.value);
    if (code.length !== 6) { toast(tx("コードは 6 けたです")); input.focus(); return; }
    info.replaceChildren(h("p", { class: "muted small" }, tx("確認中…")));
    try {
      found = await cloud.lookupStaffCode(code);
      if (found.claimedBy) { info.replaceChildren(h("p", { class: "warn small" }, tx("このコードはもう使われています。"))); found = null; return; }
      info.replaceChildren(h("div", { class: "join-found" },
        h("strong", null, tx("{name} さん", { name: found.name })),
        h("p", null, tx("{found}として入ります。", { found: roleText(found) })),
        found.role === "admin" ? h("p", { class: "muted small" }, tx("総合管理者は、学校を作り、先生にコードを配れます。自分の学校のクラスの様子も見られます。"))
          : h("p", { class: "muted small" }, tx("学校の中でクラスを作り、生徒に配信できます。学校の総合管理者は、あなたのクラスの生徒・提出を見られます。"))));
      okBtn.querySelector("span:last-child").textContent = tx("このコードを使う");
    } catch (e) {
      found = null;
      info.replaceChildren(h("p", { class: "warn small" }, e.code === "bad-code" ? tx("コードが見つかりません。もう一度確かめてください。") : cloud.explain(e)));
    }
  };
  const okBtn = button("filled", tx("確かめる"), null, async () => {
    if (!found || cloud.normCode(input.value) !== found.code) { await look(); return; }
    try { await cloud.redeemStaffCode(found); d.close(); toast(tx("入りました。左上のアカウントの欄から、先生のプロファイルに切り替えられます")); onDone(); } catch (e) { toast(cloud.explain(e)); }
  });
  const d = openDialog(tx("コードを入れる"), h("div", null, h("p", null, tx("総合管理者または学校の先生から渡された、あなた専用の 6 けたのコードを入れてください。")), input, info), [button("text", tx("やめる"), null, () => d.close()), okBtn]);
  input.addEventListener("input", () => { if (found && cloud.normCode(input.value) !== found.code) { found = null; info.replaceChildren(); okBtn.querySelector("span:last-child").textContent = tx("確かめる"); } });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) okBtn.click(); });
  input.focus();
}

async function codeView(ui) {
  const { h, icon, button, app } = ui;
  app.replaceChildren(...head(ui, tx("指導者になる"), tx("指導者は、総合管理者 → 学校 → クラス の階層で管理します。総合管理者・先生には、それぞれ専用のコードが渡されます。"), [tx("ホーム"), "#/"]),
    h("section", { class: "mk-card" },
      h("h2", null, icon("key"), tx("コードを入れる")),
      h("p", null, tx("渡されたコードを入れると、総合管理者・先生として使えるようになります。")),
      h("ul", { class: "mk-summary" },
        h("li", null, icon("admin_panel_settings"), tx("総合管理者のコード … SK（開発者）から渡されます。学校を作り、先生にコードを配れます")),
        h("li", null, icon("school"), tx("先生のコード … 学校の総合管理者から渡されます。学校の中でクラスを作れます"))),
      h("div", { class: "mk-row" }, button("filled", tx("コードを入れる"), "key", () => openStaffCodeDialog(ui, () => renderTeach([], ui))))));
}

// ---------- 指導者メニューのホーム（総合管理者: 学校 / 先生: クラス） ----------

// 個人のプロファイルで開いたとき: 先生・総合管理者のプロファイルへの切りかえと、コードを入れる入り口
async function personalView(ts, ui) {
  const { h, icon, button, app } = ui;
  const profiles = await cloud.staffProfiles().catch(() => []);
  app.replaceChildren(...head(ui, tx("先生・総合管理者"), tx("先生・総合管理者は、生徒のクラスのプロファイルと同じように、専用のプロファイルで入ります。プロファイルごとに、教材（マイ単語帳・プリント）と学習の記録が別になります。"), [tx("ホーム"), "#/"]),
    profiles.length ? h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, tx("プロファイル（{length}）", { length: profiles.length }))),
      h("div", { class: "set-list" }, profiles.map((p) => h("div", { class: "set-row" },
        h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon(p.id === "admin" ? "admin_panel_settings" : "school")),
        h("div", { class: "set-row-body" },
          h("span", { class: "set-row-link" },
            h("span", { class: "set-row-sub" }, h("span", null, p.orgName)),
            h("span", { class: "set-row-title" }, p.name))),
        h("div", { class: "set-row-end" }, button("filled", tx("このプロファイルで入る"), "login", () => cloud.setActiveClass(p.id))))))) : null,
    h("section", { class: "mk-card" },
      h("h2", null, icon("key"), tx("コードを入れる")),
      h("p", null, profiles.length ? tx("別の学校の先生にもなるときは、その学校の先生のコードを入れます。") : tx("渡されたコードを入れると、先生・総合管理者のプロファイルができます。")),
      h("ul", { class: "mk-summary" },
        h("li", null, icon("admin_panel_settings"), tx("総合管理者のコード … SK（開発者）から渡されます。学校を作り、先生にコードを配れます")),
        h("li", null, icon("school"), tx("先生のコード … 学校の総合管理者から渡されます。学校の中でクラスを作れます"))),
      h("div", { class: "mk-row" }, button("filled", tx("コードを入れる"), "key", () => openStaffCodeDialog(ui, () => renderTeach([], ui))))));
}

async function homeView(ts, s, ui, ctx = "") {
  const { h, icon, button, toast, go, app, openDialog } = ui;
  // ctx: 先生のプロファイルなら staff-<学校の ID>、総合管理者なら admin、従来の先生（個人のまま）は ""
  const sid = ctx.startsWith("staff-") ? ctx.slice(6) : "";
  const showAdmin = !!ts.admin && (!ctx || ctx === "admin");
  const showTeacher = !!ts.teacher && (!ctx || !!sid);
  const [allClasses, schools] = await Promise.all([showTeacher ? cloud.teacherClasses() : [], showAdmin ? cloud.mySchools() : []]);
  const classes = sid ? allClasses.filter((c) => c.schoolId === sid) : allClasses;
  const schoolName = new Map([...ts.schools, ...schools].map((x) => [x.id, x.name]));
  const reload = () => renderTeach([], ui);
  const createSchool = () => {
    const input = h("input", { type: "text", class: "field-input", maxlength: "60", placeholder: tx("例: SK 中学校") });
    const d = openDialog(tx("学校を作る"), h("div", null, h("p", null, tx("学校の名前を入れてください。作ったあと、先生のコードを配れます。")), input), [
      button("text", tx("やめる"), null, () => d.close()),
      button("filled", tx("作る"), "add", async () => {
        if (!input.value.trim()) { input.focus(); return; }
        try { const sid = await cloud.createSchool(input.value); d.close(); go(`/teach/school/${sid}`); } catch (e) { toast(cloud.explain(e)); }
      })]);
    input.focus();
  };
  const createClass = () => {
    if (!ts.schools.length) { toast(tx("先生として入っている学校がありません。学校の総合管理者から先生のコードをもらってください")); return; }
    const sel = h("select", { class: "field-select", "aria-label": tx("学校") }, (sid ? ts.schools.filter((x) => x.id === sid) : ts.schools).map((x) => h("option", { value: x.id }, x.name)));
    const input = h("input", { type: "text", class: "field-input", maxlength: "60", placeholder: tx("例: 1 年 A 組 英語") });
    const d = openDialog(tx("クラスを作る"), h("div", null,
      h("label", { class: "field" }, h("span", { class: "field-label" }, tx("学校")), sel),
      h("label", { class: "field" }, h("span", { class: "field-label" }, tx("クラスの名前")), input),
      h("p", { class: "muted small" }, tx("作ると、生徒に配る参加コードができます。"))), [
      button("text", tx("やめる"), null, () => d.close()),
      button("filled", tx("作る"), "add", async () => {
        if (!input.value.trim()) { input.focus(); return; }
        try { const cid = await cloud.createClass(input.value, ts.teacher.name, sel.value); d.close(); go(`/teach/${cid}`); } catch (e) { toast(cloud.explain(e)); }
      })]);
    input.focus();
  };
  const adminOnly = ctx === "admin" && showAdmin;
  const who = showAdmin ? tx("{name}（総合管理者）", { name: ts.admin.name }) : tx("{name} 先生", { name: ts.teacher.name });
  app.replaceChildren(...head(ui, who, sid ? schoolName.get(sid) || "" : showTeacher && ts.teacher.org ? ts.teacher.org : "", [tx("ホーム"), "#/"]),
    // 総合管理者のプロファイル: 学校・先生・クラスの全体（専用の画面）
    adminOnly ? adminSection(ui, { schools, onCreateSchool: createSchool }) : dashboardSection(ui, { classes, schools: showAdmin ? schools : [], schoolName, title: tx("クラスの様子") }),
    showAdmin && !adminOnly ? h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, tx("学校（{length}）", { length: schools.length })), button("filled", tx("学校を作る"), "add", createSchool)),
      schools.length ? h("div", { class: "set-list" }, schools.map((x) => h("div", { class: "set-row" },
        h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon("apartment")),
        h("div", { class: "set-row-body" },
          h("a", { class: "set-row-link", href: `#/teach/school/${encodeURIComponent(x.id)}` },
            h("span", { class: "set-row-sub" }, h("span", null, tx("先生・クラスを見る"))),
            h("span", { class: "set-row-title" }, x.name))),
        h("div", { class: "set-row-end" }, icon("chevron_right")))))
        : h("div", { class: "empty-card" }, icon("apartment", "empty-icon"), h("p", null, tx("まだ学校がありません。学校を作って、先生にコードを配りましょう。")))) : null,
    showTeacher ? h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, tx("{n}クラス（{length}）", { n: showAdmin ? (tx("自分の") + " ") : "", length: classes.length })), button("filled", tx("クラスを作る"), "add", createClass)),
      classes.length ? h("div", { class: "set-list" }, classes.map((c) => h("div", { class: "set-row" },
        h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon("groups")),
        h("div", { class: "set-row-body" },
          h("a", { class: "set-row-link", href: `#/teach/${encodeURIComponent(c.id)}` },
            h("span", { class: "set-row-sub" }, h("span", { class: "code-pill" }, c.joinCode), h("span", null, schoolName.get(c.schoolId) || (c.schoolId ? tx("学校") : tx("学校なし"))), h("span", null, c.open ? tx("参加を受け付け中") : tx("参加の受け付けは終了"))),
            h("span", { class: "set-row-title" }, c.name))),
        h("div", { class: "set-row-end" }, icon("chevron_right")))))
        : h("div", { class: "empty-card" }, icon("groups", "empty-icon"), h("p", null, tx("まだクラスがありません。クラスを作って、参加コードを生徒に配りましょう。")))) : null,
    ctx ? null : h("section", { class: "mk-card" },
      h("h2", null, icon("key"), tx("コードを入れる")),
      h("p", { class: "muted small" }, ts.admin ? tx("先生としても入るときは、学校の総合管理者から渡された先生のコードを入れます。") : tx("ほかの学校の先生にもなるときは、その学校の先生のコードを入れます。")),
      h("div", { class: "mk-row" }, button("outlined", tx("コードを入れる"), "key", () => openStaffCodeDialog(ui, reload)))),
    h("p", { class: "footnote" }, tx("指導者メニューはパソコンでの利用を前提にしています。")));
}

// ---------- 学校のプロファイルの先生（組織モデル）のホーム ----------
//   自分が担任のクラスの様子と、クラスの一覧。クラスは、自分で作ることもできる（自分が担任になる）。生徒は、学校の名簿から入れる
async function orgTeacherHome(s, ui, o) {
  const { h, icon, button, toast, go, app, openDialog } = ui;
  const classes = await cloud.teacherClassesOf(o.sid, o.personId);
  const school = { id: o.sid, name: o.className };
  const create = () => {
    const input = h("input", { type: "text", class: "field-input", maxlength: "60", placeholder: tx("例: 1 年 A 組 英語") });
    const d = openDialog(tx("クラスを作る"), h("div", null, h("label", { class: "field" }, h("span", { class: "field-label" }, tx("クラスの名前")), input),
      h("p", { class: "muted small" }, tx("作ると、あなたが担任になります。生徒は、学校の名簿から入れます。"))), [
      button("text", tx("やめる"), null, () => d.close()),
      button("filled", tx("作る"), "add", async () => {
        if (!input.value.trim()) { input.focus(); return; }
        try { const cid = await cloud.createOrgClass(school, input.value, { me: { id: o.personId, name: o.profileName } }); d.close(); go(`/teach/${cid}`); } catch (e) { toast(cloud.explain(e)); }
      })]);
    input.focus();
  };
  app.replaceChildren(...head(ui, tx("{profileName} 先生", { profileName: o.profileName }), o.className, null),
    ...(classes.length ? [dashboardSection(ui, { classes, title: tx("クラスの様子") })] : []),
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, tx("担任のクラス（{length}）", { length: classes.length })), button("filled", tx("クラスを作る"), "add", create)),
      classes.length ? h("div", { class: "set-list" }, classes.map((c) => h("div", { class: "set-row" },
        h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon("groups")),
        h("div", { class: "set-row-body" },
          h("a", { class: "set-row-link", href: `#/teach/${encodeURIComponent(c.id)}` },
            h("span", { class: "set-row-sub" }, h("span", null, o.className)),
            h("span", { class: "set-row-title" }, c.name))),
        h("div", { class: "set-row-end" }, icon("chevron_right")))))
        : h("div", { class: "empty-card" }, icon("groups", "empty-icon"), h("p", null, tx("まだ、担任のクラスがありません。学校の総合管理者があなたをクラスの担任にするか、「クラスを作る」で作りましょう。")))),
    h("p", { class: "footnote" }, tx("指導者メニューはパソコンでの利用を前提にしています。")));
}

// ---------- 学校（総合管理者） ----------

async function schoolView(sid, s, ui) {
  const { h, icon, button, toast, confirmDialog, go, app, openDialog } = ui;
  const school = await cloud.getSchool(sid);
  if (school.ownerUid !== s.user.uid) { go("/teach", true); return; }
  const [staff, classes, allCodes] = await Promise.all([cloud.schoolStaff(sid), cloud.schoolClasses(sid), cloud.myStaffCodes()]);
  const codes = allCodes.filter((c) => c.schoolId === sid && !c.claimedBy);
  document.title = tx("{name} - 指導者メニュー", { name: school.name });
  const reload = () => renderTeach(["school", sid], ui);
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast(tx("コピーしました")); } catch (e) { toast(tx("コピーできませんでした")); } };
  const ref = { id: sid, name: school.name };
  // 参加の案内 PDF（コードの入れ方つき。1 人 1 枚）
  const sheet = (list) => {
    if (!list.length) { toast(tx("コード待ちの先生がいません")); return; }
    if (!openInviteSheet({ kind: "teacher", items: list.map((c) => ({ name: c.name, code: c.id })) })) toast(tx("案内を開けませんでした。ポップアップを許可してください"));
  };
  const issue = () => {
    const ta = h("textarea", { class: "field-input", rows: "6", placeholder: tx("先生の名前を 1 行に 1 人ずつ（例: 山田 花子）") });
    const d = openDialog(tx("先生のコードを作る"), h("div", null, h("p", null, tx("名前を 1 行に 1 人ずつ入れてください。1 人ごとに専用のコードができます。コードは 1 回だけ使えます。")), ta), [
      button("text", tx("やめる"), null, () => d.close()),
      button("filled", tx("作る"), "add", async () => {
        const names = ta.value.split(/\r\n|\r|\n/).map((x) => x.trim()).filter(Boolean);
        if (!names.length) { ta.focus(); return; }
        try { const n = await cloud.issueStaffCodes("teacher", names, ref); d.close(); toast(tx("{n} 人分のコードを作りました", { n })); reload(); } catch (e) { toast(cloud.explain(e)); }
      })]);
    ta.focus();
  };
  const staffCard =
    h("section", { class: "mk-card" },
      h("div", { class: "section-head" }, h("h2", null, icon("school"), tx("先生（{length}）", { length: staff.length })), h("div", { class: "section-actions" }, button("outlined", tx("案内 PDF（コード待ちの全員）"), "picture_as_pdf", () => sheet(codes)), button("filled", tx("先生のコードを作る"), "person_add", issue))),
      h("p", { class: "muted small" }, tx("先生は SK Study の「指導者メニュー」→「コードを入れる」で、専用のコードを入れて学校に入ります。コードは 1 人 1 回だけ使えます。")),
      staff.length || codes.length ? h("table", { class: "tc-table" },
        h("thead", null, h("tr", null, h("th", null, tx("名前")), h("th", null, tx("コード")), h("th", null, tx("状態")), h("th", null, ""))),
        h("tbody", null,
          staff.map((m) => h("tr", null,
            h("td", null, m.name), h("td", null, h("span", { class: "muted" }, "-")), h("td", null, tx("参加ずみ")),
            h("td", { class: "tc-actions" }, button("text", tx("名前"), "edit", () => {
              const input = h("input", { type: "text", class: "field-input", maxlength: "40", value: m.name });
              const d = openDialog(tx("先生の名前"), h("div", null, input, h("p", { class: "muted small" }, tx("学校の先生名簿の名前です。本人の画面（先生のプロファイル・クラスの表示）に出ます。"))), [button("text", tx("やめる"), null, () => d.close()), button("filled", tx("保存"), null, async () => {
                if (!input.value.trim()) return;
                try { await cloud.renameStaff(sid, m.id, input.value); d.close(); toast(tx("名前を変えました")); reload(); } catch (e) { toast(cloud.explain(e)); }
              })]);
              input.focus();
            }), button("text", tx("外す"), "person_remove", async () => {
              if (!(await confirmDialog(tx("{name} さんを学校から外しますか？", { name: m.name }), tx("この先生は、この学校のクラスを触れなくなります。クラスと生徒の提出は残ります。"), tx("外す"), true))) return;
              try { await cloud.removeStaff(sid, m.id); toast(tx("外しました")); reload(); } catch (e) { toast(cloud.explain(e)); }
            })))),
          codes.map((c) => h("tr", null,
            h("td", null, c.name), h("td", null, h("span", { class: "code-pill" }, c.id)), h("td", null, tx("コード待ち")),
            h("td", { class: "tc-actions" },
              button("text", tx("コピー"), "content_copy", () => copy(c.id)),
              button("text", tx("案内 PDF"), "picture_as_pdf", () => sheet([c])),
              button("text", tx("再発行"), "refresh", async () => {
                try { await cloud.deleteStaffCode(c.id); await cloud.issueStaffCodes("teacher", [c.name], ref); toast(tx("作り直しました")); reload(); } catch (e) { toast(cloud.explain(e)); }
              }),
              button("text", (isJa ? "取り消す" : tx("コードを取り消す")), "delete", async () => {
                try { await cloud.deleteStaffCode(c.id); toast(tx("取り消しました")); reload(); } catch (e) { toast(cloud.explain(e)); }
              })))))) : h("p", { class: "muted" }, tx("まだ先生がいません。「先生のコードを作る」で、名前ごとのコードを作って配りましょう。")));
  const legacyClasses = classes.filter((c) => c.orgModel !== true);
  const classesCard =
    h("section", { class: "mk-card" },
      h("h2", null, icon("groups"), tx("従来のクラス（{length}）", { length: legacyClasses.length })),
      legacyClasses.length ? h("div", { class: "set-list flat" }, legacyClasses.map((c) => h("div", { class: "set-row" },
        h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon("groups")),
        h("div", { class: "set-row-body" },
          h("a", { class: "set-row-link", href: `#/teach/${encodeURIComponent(c.id)}` },
            h("span", { class: "set-row-sub" }, h("span", null, c.teacherName ? tx("{teacherName} 先生", { teacherName: c.teacherName }) : tx("先生"))),
            h("span", { class: "set-row-title" }, c.name))),
        h("div", { class: "set-row-end" }, icon("chevron_right")))))
        : h("p", { class: "muted" }, tx("まだクラスがありません。先生がクラスを作ると、ここに出ます。")));
  const settingsCard =
    h("section", { class: "mk-card" },
      h("h2", null, icon("settings"), tx("学校の設定")),
      h("div", { class: "mk-row" },
        button("outlined", tx("名前を変える"), "edit", () => {
          const input = h("input", { type: "text", class: "field-input", maxlength: "60", value: school.name });
          const d = openDialog(tx("学校の名前"), input, [button("text", tx("やめる"), null, () => d.close()), button("filled", tx("保存"), null, async () => {
            if (!input.value.trim()) return;
            try { await cloud.renameSchool(school, input.value); d.close(); reload(); } catch (e) { toast(cloud.explain(e)); }
          })]);
        }),
        button("outlined", tx("学校を削除"), "delete", async () => {
          if (!(await confirmDialog(tx("学校を削除しますか？"), tx("「{name}」と、先生の名簿・配ったコードを消します。クラスが残っているときは削除できません。", { name: school.name }), tx("削除する"), true))) return;
          try { await cloud.deleteSchool(school); toast(tx("削除しました")); go("/teach", true); } catch (e) { toast(cloud.explain(e)); }
        }, { "data-danger": "" })));
  app.replaceChildren(...head(ui, school.name, tx("総合管理者の画面です。先生のコードを配り、学校のクラスの様子を見られます。"), [tx("指導者メニュー"), "#/teach"]),
    schoolTabs(ui, { school, classes, reload, legacy: { staff: staffCard, classes: classesCard, settings: settingsCard, migration: migrationCard(ui, school, reload) } }));
}

// ---------- クラス ----------

async function classView(cid, ui) {
  const { h, icon, button, linkButton, toast, confirmDialog, go, app, openDialog } = ui;
  const [cls, members, assigns, sess] = await Promise.all([cloud.getClass(cid), cloud.roster(cid), cloud.allAssignments(cid), cloud.session()]);
  const org = cls.orgModel === true; // 組織モデル: 担任は teachers、生徒は学校の名簿からの在籍
  const ro = org ? !(await cloud.isTeacherOf(cls)) : cls.ownerUid !== sess.user.uid; // 学校の総合管理者は読むだけ（書き換えられるのはクラスの持ち主・担任の先生）
  const counts = await Promise.all(assigns.map((a) => cloud.submissions(cid, a.id).then((x) => x.length).catch(() => null)));
  document.title = tx("{name} - 指導者メニュー", { name: cls.name });
  const reload = () => classView(cid, ui);
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast(tx("コピーしました")); } catch (e) { toast(tx("コピーできませんでした")); } };
  const joinUrl = `${location.origin}/study/#/`;
  // 参加の案内 PDF（コードの入れ方つき。1 人 1 枚）
  const sheet = (list) => {
    if (!list.length) { toast(tx("コード待ちの生徒がいません")); return; }
    if (!openInviteSheet({ kind: "student", orgName: cls.name, subName: cls.teacherName || "", items: list })) toast(tx("案内を開けませんでした。ポップアップを許可してください"));
  };
  const pendingProfiles = members.filter((m) => m.profile && !m.profile.claimedBy).map((m) => ({ name: m.profile.name, code: m.profile.code }));

  app.replaceChildren(...head(ui, cls.name, ro ? tx("{n}のクラス（見るだけ）", { n: cls.teacherName ? tx("{teacherName} 先生", { teacherName: cls.teacherName }) : tx("先生") }) : null, ro && cls.schoolId ? [tx("学校"), `#/teach/school/${encodeURIComponent(cls.schoolId)}`] : [tx("指導者メニュー"), "#/teach"]),
    h("div", { class: "tc-grid" },
      org ? h("section", { class: "mk-card tc-code" },
        h("h2", null, icon("apartment"), tx("このクラスについて")),
        h("p", { class: "muted small" }, tx("生徒は、学校の名簿から入れます（下の「生徒」）。生徒は、学校のコードで学校に入ると、このクラスの課題が自動で出ます。クラスごとの参加コードは、要りません。"))) : h("section", { class: "mk-card tc-code" },
        h("h2", null, icon("key"), tx("参加のしかた")),
        h("p", { class: "muted small" }, tx("下の「生徒プロファイル」ごとに、専用の参加コードがあります。生徒は自分の SK Hub Systems アカウントで SK Study（{joinUrl}）を開き、「クラス」→「参加コードを入れる」で専用コードを入れます。コードは 1 人 1 回だけ使えます。", { joinUrl })),
        h("label", { class: "switch-row" },
          h("input", { type: "checkbox", checked: cls.open, onchange: async (e) => {
            try { await cloud.updateClass(cls, { open: e.target.checked }); toast(e.target.checked ? tx("参加を受け付けます") : tx("参加の受け付けを終えました")); reload(); } catch (err) { toast(cloud.explain(err)); }
          } }),
          h("span", null, h("strong", null, tx("参加を受け付ける")), h("small", null, tx("生徒がそろったら止めておくと安心です"))))),
      h("section", { class: "mk-card" },
        h("div", { class: "section-head" }, h("h2", null, icon("assignment"), tx("配信（{length}）", { length: assigns.length })), linkButton("filled", tx("配信する"), "add", `#/teach/${encodeURIComponent(cid)}/new`)),
        assigns.length ? h("div", { class: "set-list flat" }, assigns.map((a, i) => {
          const k = kindInfo(a);
          return h("div", { class: "set-row" },
            h("span", { class: `thumb kind-${a.kind}${a.print && a.print.exam ? " is-exam" : ""}`, "aria-hidden": "true" }, icon(k.icon)),
            h("div", { class: "set-row-body" },
              h("a", { class: "set-row-link", href: `#/teach/${encodeURIComponent(cid)}/${encodeURIComponent(a.id)}` },
                h("span", { class: "set-row-sub" },
                  h("span", { class: "kind-pill" }, k.name),
                  h("span", { class: a.published ? "pub-pill on" : "pub-pill" }, a.published ? (isJa ? "公開中" : tx("結果を公開中")) : tx("非公開")),
                  a.resultsOpen ? h("span", { class: "pub-pill on" }, a.kind === "wordtest" ? tx("返却ずみ") : tx("結果を公開")) : null,
                  a.due ? h("span", null, tx("締め切り {due}", { due: fmtDue(a.due) })) : null),
                h("span", { class: "set-row-title" }, a.title)),
              h("span", { class: "set-row-meta" }, h("span", null, icon("inbox"), counts[i] == null ? "-" : tx("提出 {i} / {length}", { i: counts[i], length: members.length })))),
            h("div", { class: "set-row-end" }, icon("chevron_right")));
        })) : h("p", { class: "muted" }, tx("まだ配信していません。")))),
    org ? h("section", { class: "mk-card" },
      h("div", { class: "section-head" }, h("h2", null, icon("group"), tx("生徒（{length}）", { length: members.length })),
        ro ? null : button("filled", tx("名簿から生徒を入れる"), "person_add", () => openPicker(ui, { school: { id: cls.schoolId, name: "" }, cls, role: "student", onDone: reload }))),
      members.length ? h("table", { class: "tc-table" },
        h("thead", null, h("tr", null, h("th", null, tx("名前")), h("th", null, tx("状態")), h("th", null, ""))),
        h("tbody", null, members.map((m) => h("tr", null,
          h("td", null, m.name),
          h("td", null, m.claimed ? tx("参加ずみ") : tx("コード待ち")),
          h("td", { class: "tc-actions" }, ro ? null : button("text", tx("外す"), "close", async () => {
            if (!(await confirmDialog(tx("{name} さんをクラスから外しますか？", { name: m.name }), tx("提出した答えは残ります。あとで、また入れられます。"), tx("外す"), true))) return;
            try { await cloud.unenroll(cid, cls.schoolId, m.personId, "student"); toast(tx("外しました")); reload(); } catch (e) { toast(cloud.explain(e)); }
          })))))) : h("p", { class: "muted" }, tx("まだ生徒がいません。「名簿から生徒を入れる」で、学校の名簿から選びます。"))) :
h("section", { class: "mk-card" },
  h("div", { class: "section-head" }, h("h2", null, icon("group"), tx("生徒プロファイル（{length}）", { length: members.length })), h("div", { class: "section-actions" }, button("outlined", tx("案内 PDF（コード待ちの全員）"), "picture_as_pdf", () => sheet(pendingProfiles)), button("filled", tx("プロファイルを作る"), "person_add", () => {
        const ta = h("textarea", { class: "field-input", rows: "8", placeholder: tx("名前を 1 行に 1 人ずつ（例: 田中 太郎）") });
        const d = openDialog(tx("生徒プロファイルを作る"), h("div", null, h("p", null, tx("名前を 1 行に 1 人ずつ入れてください。1 人ごとに専用の参加コードができます。")), ta), [
          button("text", tx("やめる"), null, () => d.close()),
          button("filled", tx("作る"), "add", async () => {
            const names = ta.value.split(/\r\n|\r|\n/).map((x) => x.trim()).filter(Boolean);
            if (!names.length) { ta.focus(); return; }
            try { const n = await cloud.createProfiles(cls, names); d.close(); toast(tx("{n} 人分のプロファイルを作りました", { n })); reload(); } catch (e) { toast(cloud.explain(e)); }
          })]);
        ta.focus();
      }))),
      members.length ? h("table", { class: "tc-table" },
        h("thead", null, h("tr", null, h("th", null, tx("名前")), h("th", null, tx("参加コード")), h("th", null, tx("状態")), h("th", null, ""))),
        h("tbody", null, members.map((m) => {
          const p = m.profile;
          return h("tr", null,
            h("td", null, m.name),
            h("td", null, p ? (p.claimedBy ? h("span", { class: "muted" }, "-") : h("span", { class: "code-pill" }, p.code)) : h("span", { class: "muted" }, "-")),
            h("td", null, m.claimed ? tx("参加ずみ") : tx("コード待ち")),
            h("td", { class: "tc-actions" },
              p && !p.claimedBy ? button("text", tx("コピー"), "content_copy", () => copy(p.code)) : null,
              p && !p.claimedBy ? button("text", tx("案内 PDF"), "picture_as_pdf", () => sheet([{ name: p.name, code: p.code }])) : null,
              p ? button("text", tx("名前"), "edit", () => {
                const input = h("input", { type: "text", class: "field-input", maxlength: "40", value: p.name });
                const d = openDialog(tx("名前を変える"), h("div", null, input, p.claimedBy ? null : h("p", { class: "muted small" }, tx("参加コードも新しくなります。"))), [button("text", tx("やめる"), null, () => d.close()), button("filled", tx("保存"), null, async () => {
                  if (!input.value.trim()) return;
                  try { await cloud.renameProfile(cls, p, input.value); d.close(); reload(); } catch (e) { toast(cloud.explain(e)); }
                })]);
                input.focus();
              }) : null,
              p ? button("text", p.claimedBy ? tx("結びつけを外す") : tx("コード再発行"), p.claimedBy ? "link_off" : "refresh", async () => {
                const msg = p.claimedBy ? [tx("{name} さんの結びつけを外しますか？", { name: p.name }), tx("そのアカウントはこのクラスから外れます。提出した答えは残り、新しいコードで別のアカウントを結びつけられます。"), tx("外す")] : [tx("コードを作り直しますか？"), tx("今のコードは使えなくなります。"), tx("作り直す")];
                if (!(await confirmDialog(msg[0], msg[1], msg[2], !!p.claimedBy))) return;
                try { await cloud.resetProfile(cls, p, { release: !!p.claimedBy }); toast(p.claimedBy ? tx("外しました") : tx("作り直しました")); reload(); } catch (e) { toast(cloud.explain(e)); }
              }) : button("text", tx("外す"), "person_remove", async () => {
                if (!(await confirmDialog(tx("{name} さんをクラスから外しますか？", { name: m.name }), tx("提出した答えは残ります。"), tx("外す"), true))) return;
                try { await cloud.removeMember(cid, m.id); toast(tx("外しました")); reload(); } catch (e) { toast(cloud.explain(e)); }
              }),
              p ? button("text", tx("削除"), "delete", async () => {
                if (!(await confirmDialog(tx("{name} さんのプロファイルを削除しますか？", { name: p.name }), tx("結びつけているアカウントはクラスから外れます。提出済みの答えは残りますが、名簿から消えます。"), tx("削除する"), true))) return;
                try { await cloud.deleteProfile(cls, p); toast(tx("削除しました")); reload(); } catch (e) { toast(cloud.explain(e)); }
              }) : null));
        }))) : h("p", { class: "muted" }, tx("まだ生徒プロファイルがありません。「プロファイルを作る」で名前を入れると、1 人ずつの参加コードができます。"))),
    h("section", { class: "mk-card" },
      h("h2", null, icon("settings"), tx("クラスの設定")),
      h("div", { class: "mk-row" },
        button("outlined", tx("名前を変える"), "edit", () => {
          const input = h("input", { type: "text", class: "field-input", maxlength: "60", value: cls.name });
          const d = openDialog(tx("クラスの名前"), input, [button("text", tx("やめる"), null, () => d.close()), button("filled", tx("保存"), null, async () => {
            if (!input.value.trim()) return;
            try { if (org) await cloud.renameOrgClass(cls, input.value); else await cloud.updateClass(cls, { name: input.value.trim() }); d.close(); reload(); } catch (e) { toast(cloud.explain(e)); }
          })]);
        }),
        button("outlined", tx("クラスを削除"), "delete", async () => {
          if (!(await confirmDialog(tx("クラスを削除しますか？"), tx("「{name}」と、配信した課題・生徒の提出・採点をすべて消します。もとに戻せません。", { name: cls.name }), tx("削除する"), true))) return;
          try { if (org) await cloud.deleteOrgClass(cls); else await cloud.deleteClass(cls); toast(tx("削除しました")); go("/teach", true); } catch (e) { toast(cloud.explain(e)); }
        }, { "data-danger": "" }))));
  if (ro) {
    // 学校の総合管理者には、見るだけの画面にする
    app.querySelectorAll(".mk-card").forEach((c) => { const t = c.querySelector("h2"); if (t && /クラスの設定|参加のしかた/.test(t.textContent)) c.remove(); });
    app.querySelectorAll("button, .tc-actions, a.filled-btn").forEach((e) => e.remove());
    app.querySelectorAll("a.set-row-link").forEach((a) => a.removeAttribute("href"));
  }
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
  const S = { kind: "wordtest", title: "", setId: sets[0] ? sets[0].id : "", count: 10, format: "auto", printId: prints[0] ? prints[0].id : "", strip: false, due: "", published: true, noCopy: false };
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
      h("optgroup", { label: tx("SK認定コンテンツ") }, store.getSkSets().map((s) => h("option", { value: s.id, selected: s.id === S.setId }, tx("{title}（{length} 語）", { title: s.title, length: s.words.length })))),
      store.getMySets().length ? h("optgroup", { label: tx("マイ単語帳") }, store.getMySets().map((s) => h("option", { value: s.id, selected: s.id === S.setId }, tx("{title}（{length} 語）", { title: s.title, length: s.words.length })))) : null);
    const count = h("input", { type: "number", class: "field-input", min: "1", max: "100", value: String(S.count), oninput: (e) => { S.count = Math.max(1, Math.min(100, Number(e.target.value) || 10)); } });
    const format = h("select", { class: "field-select", onchange: (e) => { S.format = e.target.value; } }, Object.entries(FORMAT_LABEL).map(([v, l]) => h("option", { value: v, selected: S.format === v }, l)));
    const printSel = h("select", { class: "field-select", onchange: (e) => { S.printId = e.target.value; loadPrint(); } },
      prints.map((p) => h("option", { value: p.id, selected: p.id === S.printId }, tx("{n}{title}（解答欄 {blanks}）", { n: p.exam ? tx("【試験】") : "", title: p.title, blanks: p.blanks }))));
    const title = h("input", { type: "text", class: "field-input", maxlength: "80", value: S.title, placeholder: tx("空なら、単語帳・プリントの名前"), oninput: (e) => { S.title = e.target.value; } });
    const due = h("input", { type: "datetime-local", class: "field-input", value: S.due, oninput: (e) => { S.due = e.target.value; } });
    const noCopy = h("input", { type: "checkbox", checked: S.noCopy, onchange: (e) => { S.noCopy = e.target.checked; } });
    const pub = h("input", { type: "checkbox", checked: S.published, onchange: (e) => { S.published = e.target.checked; } });
    const tooBig = printInfo && (S.strip ? bytes(stripImages(printInfo.html)) : printInfo.bytes) > cloud.PRINT_MAX_BYTES;
    form.replaceChildren(
      h("div", { class: "mk-modes tc-kinds" },
        radio("words", tx("単語帳"), tx("生徒が自分のペースで学習。覚えた語の数が届く"), "menu_book"),
        radio("wordtest", tx("単語の小テスト"), tx("決まった数を 1 回だけ。答えと点数が届く"), "quiz"),
        radio("print", tx("プリント"), tx("SK Study のプリント（練習・試験）。答えと記録が届く"), "assignment")),
      S.kind === "print"
        ? h("div", { class: "tc-source" },
          prints.length ? h("label", { class: "field" }, h("span", { class: "field-label" }, tx("プリント（この端末の「プリント」から）")), printSel)
            : h("p", { class: "warn" }, icon("info"), tx("まだプリントがありません。ホームの「プリント」で追加するか、「PDF から作る」で作ってください。")),
          printInfo ? h("ul", { class: "mk-summary" },
            h("li", null, icon(printInfo.exam ? "timer" : "school"), printInfo.exam ? tx("試験用（{n}）", { n: printInfo.minutes ? tx("{minutes} 分", { minutes: printInfo.minutes }) : tx("時間制限なし") }) : tx("練習用")),
            h("li", null, icon("edit_square"), tx("解答欄 {blanks} 個", { blanks: printInfo.blanks })),
            h("li", null, icon("data_usage"), tx("大きさ {n} KB（配れるのは {n2} KB まで）", { n: (printInfo.bytes / 1024).toFixed(0), n2: (cloud.PRINT_MAX_BYTES / 1024).toFixed(0) })),
            printInfo.images ? h("li", null, h("label", { class: "switch-row" }, h("input", { type: "checkbox", checked: S.strip, onchange: (e) => { S.strip = e.target.checked; draw(); } }), h("span", null, tx("元のページの画像（{images} 枚）を外して配る", { images: printInfo.images })))) : null,
            tooBig ? h("li", { class: "warn" }, icon("warning"), tx("大きすぎて配れません。画像を外すか、プリントを分けてください。")) : null) : null)
        : h("div", { class: "tc-source" },
          h("label", { class: "field" }, h("span", { class: "field-label" }, tx("単語帳")), setSel),
          S.kind === "wordtest" ? h("div", { class: "field-row" },
            h("label", { class: "field mk-minutes" }, h("span", { class: "field-label" }, tx("問題の数")), count),
            h("label", { class: "field" }, h("span", { class: "field-label" }, tx("形式")), format)) : null),
      h("div", { class: "field-row" },
        h("label", { class: "field" }, h("span", { class: "field-label" }, tx("課題の名前")), title),
        h("label", { class: "field" }, h("span", { class: "field-label" }, tx("締め切り（任意）")), due)),
      S.kind === "print" ? null : h("label", { class: "switch-row" }, noCopy, h("span", null, h("strong", null, tx("生徒がコピーできないようにする")), h("small", null, tx("「自分用にコピー」と、単語のコピー・選択をできなくします。生徒には「先生が配信」と表示されます")))),
      h("label", { class: "switch-row" }, pub, h("span", null, h("strong", null, tx("すぐ生徒に公開する")), h("small", null, tx("あとで結果の画面から公開・非公開を切りかえられます")))),
      h("div", { class: "mk-row" }, button("filled", tx("配信する"), "send", saveIt)),
      status);
  }

  async function saveIt() {
    const data = { kind: S.kind, published: S.published, noCopy: S.kind !== "print" && S.noCopy, resultsOpen: false, due: S.due ? new Date(S.due).getTime() : null };
    if (S.kind === "print") {
      if (!printInfo) { toast(tx("プリントを選んでください")); return; }
      const html = S.strip ? stripImages(printInfo.html) : printInfo.html;
      if (bytes(html) > cloud.PRINT_MAX_BYTES) { toast(tx("プリントが大きすぎて配れません")); return; }
      data.print = { html, exam: printInfo.exam, minutes: printInfo.minutes, blanks: printInfo.blanks };
      data.title = S.title.trim() || (prints.find((p) => p.id === S.printId) || {}).title || printInfo.title || tx("プリント");
    } else {
      const set = store.getSet(S.setId);
      if (!set) { toast(tx("単語帳を選んでください")); return; }
      data.set = setForCloud(set);
      if (!data.set.words.length) { toast(tx("単語が入っていない単語帳です")); return; }
      if (S.kind === "wordtest") data.test = { count: Math.min(S.count, data.set.words.length), format: S.format };
      data.title = S.title.trim() || set.title;
    }
    status.textContent = tx("配信しています…");
    try {
      const aid = await cloud.saveAssignment(cid, null, data);
      toast(tx("配信しました"));
      go(`/teach/${encodeURIComponent(cid)}/${encodeURIComponent(aid)}`, true);
    } catch (e) {
      status.textContent = cloud.explain(e);
    }
  }

  app.replaceChildren(...head(ui, tx("配信する"), tx("「{name}」の生徒に課題を配ります。", { name: cls.name }), [tx("クラス"), `#/teach/${encodeURIComponent(cid)}`]),
    h("section", { class: "mk-card" }, form));
  draw();
  if (S.printId) loadPrint();
}

// ---------- 結果 ----------

async function resultsView(cid, aid, ui) {
  const { h, icon, button, toast, confirmDialog, go, app, openDialog } = ui;
  const hash = location.hash;
  const [cls, a, members, subs] = await Promise.all([cloud.getClass(cid), cloud.getAssignment(cid, aid), cloud.roster(cid), cloud.submissions(cid, aid)]);
  if (location.hash !== hash) return;
  document.title = tx("{title} - 指導者メニュー", { title: a.title });
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
    try { await cloud.saveAssignment(cid, aid, { ...a, due: cloud.toMillis(a.due), ...patch }, a); toast(tx("変えました")); reload(); } catch (e) { toast(cloud.explain(e)); }
  }
  async function openResults(on) {
    if (!on) return setFlags({ resultsOpen: false, answerKey: "" });
    // 試験用（合言葉あり）は、生徒が答え合わせできるように合言葉を課題に入れる
    if (sealed && sealed.pass) {
      if (!payload) { toast(tx("先に合言葉で答えを開いてください")); return; }
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
    if (!canGrade) { toast(tx("先に合言葉で答えを開いてください")); return; }
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
    toast(tx("{n} 人分を採点しました", { n }));
    reload();
  }

  function detail(row) {
    const sub = byUid.get(row.uid);
    if (!sub) return;
    const data = parse(sub);
    const body = h("div", { class: "tc-detail" });
    const note = h("textarea", { class: "field-input", rows: "2", maxlength: "1000", placeholder: tx("生徒へのひとこと（結果を公開すると見えます）") }, sub.grade ? sub.grade.note : "");
    let marks = null;
    if (isPrint) {
      if (!canGrade) body.append(h("p", { class: "warn" }, icon("lock"), tx("合言葉で答えを開くと、採点できます。")));
      marks = canGrade ? autoMarks(sub) : {};
      const list = h("ol", { class: "tc-blanks" });
      const drawList = () => list.replaceChildren(...P.blanks.map((b) => {
        const m = marks[b.id];
        const answer = (data.answers || [])[b.id] || "";
        const correct = [...(b.anyOf || [b.answer]), ...(b.alts || [])].filter(Boolean).join(" / ");
        return h("li", { class: `tc-blank mark-${m || "none"}` },
          h("div", { class: "tc-blank-head" },
            h("span", { class: "muted small" }, [b.group.article, b.group.section, b.group.qn && b.group.qn !== "・" ? tx("問 {qn}", { qn: b.group.qn }) : "", b.label].filter(Boolean).join(" ・ ")),
            b.type === "self" ? h("span", { class: "type-pill type-self" }, tx("記述")) : null),
          h("div", { class: "tc-blank-body" },
            h("div", null, h("span", { class: "muted small" }, tx("生徒の答え")), h("p", { class: "tc-answer" }, answer || tx("（答えなし）"))),
            canGrade ? h("div", null, h("span", { class: "muted small" }, tx("正解")), h("p", null, correct || tx("（答えなし）"))) : null),
          canGrade && b.type !== "none" ? h("div", { class: "tc-marks", role: "radiogroup", "aria-label": tx("採点") }, ["ok", "partial", "ng"].map((v) => h("button", {
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
          h("span", { class: "test-type" }, it.type === "write" ? tx("書き取り") : tx("4 択")),
          it.ok ? null : h("span", { class: "test-given" }, (tx("答え:") + " "), h("s", null, it.given || tx("（答えなし）"))),
          h("span", { class: "test-correct" }, (tx("正解:") + " "), h("strong", null, it.correct || "")))))));
    } else {
      const p = data.progress || {};
      body.append(h("dl", { class: "tc-dl" },
        h("dt", null, tx("記憶度")), h("dd", null, `${p.memory ?? "-"}%`),
        h("dt", null, tx("記憶済み")), h("dd", null, `${p.mastered ?? "-"} / ${p.total ?? "-"}`),
        h("dt", null, tx("記憶中・弱点・未学習")), h("dd", null, tx("{n}・{n2}・{n3}", { n: p.learning ?? "-", n2: p.weak ?? "-", n3: p.new ?? "-" })),
        h("dt", null, tx("最後に送られた日時")), h("dd", null, fmtDate(sub.updatedAt))));
    }
    if (data.exam) body.append(examLog(data.exam));
    if (a.kind !== "words") body.append(h("label", { class: "field" }, h("span", { class: "field-label" }, tx("ひとこと")), note));
    const d = openDialog(tx("{name} さんの提出", { name: row.name }), body, [
      button("text", tx("提出をやり直させる"), "restart_alt", async () => {
        if (!(await confirmDialog(tx("提出をやり直させますか？"), tx("{name} さんの提出と採点を消します。もう一度解けるようになります。", { name: row.name }), tx("やり直させる"), true))) return;
        try { await cloud.resetSubmission(cid, aid, row.uid); d.close(); toast(tx("やり直せるようにしました")); reload(); } catch (e) { toast(cloud.explain(e)); }
      }),
      button("text", tx("閉じる"), null, () => d.close()),
      a.kind !== "words" ? button("filled", tx("採点を保存"), "save", async () => {
        try {
          if (isPrint) {
            if (!canGrade) { toast(tx("先に合言葉で答えを開いてください")); return; }
            const t = tally(P, marks);
            await cloud.saveGrade(cid, aid, row.uid, { ok: t.ok, total: t.total, marks, note: note.value });
          } else {
            await cloud.saveGrade(cid, aid, row.uid, { ok: sub.score.ok, total: sub.score.total, marks: {}, note: note.value });
          }
          d.close();
          toast(tx("保存しました"));
          reload();
        } catch (e) { toast(cloud.explain(e)); }
      }) : null
    ].filter(Boolean));
    d.classList.add("dialog-wide");
  }

  function examLog(ex) {
    const ev = ex.events || [];
    const total = ev.reduce((s, e) => s + (e.ms || 0), 0);
    const sec = (ms) => tx("{n} 秒", { n: Math.round(ms / 1000) });
    return h("div", { class: "exam-log" },
      h("p", null, icon("schedule"), tx("かかった時間 {n}{n2}", { n: ex.submittedAt && ex.startedAt ? tx("{n} 分", { n: Math.round((ex.submittedAt - ex.startedAt) / 60000) }) : "-", n2: ex.auto ? tx("（時間切れで自動提出）") : "" })),
      h("p", { class: ev.length ? "warn" : "" }, icon(ev.length ? "visibility_off" : "verified_user"), ev.length ? tx("画面を離れた記録 {length} 回（合計 {total}）", { length: ev.length, total: sec(total) }) : tx("画面を離れた記録はありません")),
      ex.tampered ? h("p", { class: "warn" }, icon("warning"), tx("プリントが書きかえられていた可能性があります")) : null);
  }

  function csv() {
    const lines = [[tx("名前"), tx("状態"), tx("提出"), tx("生徒の点"), tx("先生の採点"), tx("画面を離れた回数")]];
    for (const r of rows) {
      const s = byUid.get(r.uid);
      const ex = s ? parse(s).exam : null;
      lines.push([r.name, s ? tx("提出") : tx("未提出"), s ? fmtDate(s.submittedAt) : "", s ? `${s.score.ok}/${s.score.total}` : "", s && s.grade ? `${s.grade.ok}/${s.grade.total}` : "", ex ? (ex.events || []).length : ""]);
    }
    const text = "﻿" + lines.map((l) => l.map((v) => `"${String(v).replace(/\u0022/g, '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    link.download = tx("{n}_結果.csv", { n: a.title.replace(/[\\/:*?\u0022<>|]/g, "_") });
    document.body.append(link);
    link.click();
    link.remove();
  }

  const passInput = h("input", { type: "password", class: "field-input", placeholder: tx("答え合わせの合言葉"), autocomplete: "off", "aria-label": tx("答え合わせの合言葉") });
  const openPass = async () => {
    try {
      payload = await openAnswers(sealed, passInput.value);
      try { sessionStorage.setItem(passKey, normPass(passInput.value)); } catch (e) { /* 覚えない */ }
      toast(tx("答えを開きました"));
      reload();
    } catch (e) { toast(tx("合言葉がちがいます")); }
  };
  passInput.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) openPass(); });

  const submittedN = rows.filter((r) => byUid.has(r.uid)).length;
  app.replaceChildren(...head(ui, a.title, tx("{name} ・ {name2}{n}", { name: cls.name, name2: k.name, n: a.due ? (" " + tx("・ 締め切り {due}", { due: fmtDue(a.due) })) : "" }), [tx("クラス"), `#/teach/${encodeURIComponent(cid)}`]),
    h("div", { class: "tc-grid" },
      h("section", { class: "mk-card" },
        h("h2", null, icon("tune"), tx("公開")),
        h("label", { class: "switch-row" }, h("input", { type: "checkbox", checked: a.published, onchange: (e) => setFlags({ published: e.target.checked }) }),
          h("span", null, h("strong", null, tx("生徒に公開する")), h("small", null, tx("非公開にすると、生徒の一覧から消えます（提出は残ります）")))),
        a.kind === "wordtest" ? h("div", { class: "switch-row return-row" },
          h("span", null, h("strong", null, a.resultsOpen ? tx("返却ずみ") : tx("未返却")), h("small", null, a.resultsOpen ? tx("生徒は、自分の点数と答えを見られます") : tx("返却するまで、生徒は点数も答えも見られません（提出したことだけ分かります）"))),
          button(a.resultsOpen ? "outlined" : "filled", a.resultsOpen ? tx("返却を取り消す") : tx("返却する"), "assignment_return", async () => {
            if (!a.resultsOpen && !(await confirmDialog(tx("返却しますか？"), tx("提出した生徒に、点数と答えが見えるようになります。まだ提出していない生徒がいても、返却できます。"), tx("返却する")))) return;
            openResults(!a.resultsOpen);
          })) : null,
        a.kind === "print" ? h("label", { class: "switch-row" }, h("input", { type: "checkbox", checked: a.resultsOpen, onchange: (e) => openResults(e.target.checked) }),
          h("span", null, h("strong", null, tx("結果を生徒に見せる")), h("small", null, sealed && sealed.pass ? tx("先生の採点と、試験の答え（合言葉）が生徒に届きます") : tx("先生の採点が生徒に届きます")))) : null,
        h("div", { class: "mk-row" },
          button("outlined", tx("CSV で保存"), "download", csv),
          button("text", tx("この配信を削除"), "delete", async () => {
            if (!(await confirmDialog(tx("この配信を削除しますか？"), tx("生徒の提出と採点もすべて消します。もとに戻せません。"), tx("削除する"), true))) return;
            try { await cloud.deleteAssignment(cid, aid); toast(tx("削除しました")); go(`/teach/${encodeURIComponent(cid)}`, true); } catch (e) { toast(cloud.explain(e)); }
          }, { "data-danger": "" }))),
      a.kind !== "words" ? h("section", { class: "mk-card" },
        h("h2", null, icon("grading"), tx("採点")),
        sealed && sealed.pass && !payload ? h("div", null,
          h("p", { class: "muted small" }, tx("試験用のプリントです。答えは暗号化されているので、合言葉で開いてから採点します（合言葉はこのタブの中だけで覚えます）。")),
          h("div", { class: "pass-row" }, passInput, button("filled", tx("答えを開く"), "lock_open", openPass))) : null,
        h("p", { class: "muted small" }, isPrint ? tx("記号・語句は自動で採点します。記述は「見る」で ○・△・× を付けてください。先生が付けた ○△× は、自動の採点で上書きしません。") : tx("小テストは生徒の端末で採点しています。保存すると、結果を公開したときに生徒に届きます。")),
        button("filled", tx("まとめて採点して保存"), "done_all", gradeAll, { disabled: !canGrade || !subs.length })) : null),
    h("section", { class: "mk-card" },
      h("h2", null, icon("inbox"), tx("提出（{submittedN} / {length}）", { submittedN, length: rows.length })),
      rows.length ? h("table", { class: "tc-table" },
        h("thead", null, h("tr", null, h("th", null, tx("名前")), h("th", null, tx("状態")), h("th", null, tx("提出")), h("th", null, a.kind === "words" ? tx("覚えた語") : tx("生徒の点")), a.kind !== "words" ? h("th", null, tx("先生の採点")) : null, P && P.exam ? h("th", null, tx("画面を離れた")) : null, h("th", null, ""))),
        h("tbody", null, rows.map((r) => {
          const s = byUid.get(r.uid);
          const ex = s ? parse(s).exam : null;
          let pending = 0;
          if (s && s.grade && P) { try { pending = tally(P, JSON.parse(s.grade.marks || "{}")).pending; } catch (e) { pending = 0; } }
          return h("tr", { class: s ? "" : "is-missing" },
            h("td", null, r.name, r.member ? null : h("span", { class: "muted small" }, tx("（クラスにいません）"))),
            h("td", null, s ? h("span", { class: "done" }, icon("task_alt"), tx("提出")) : h("span", { class: "muted" }, tx("未提出"))),
            h("td", null, s ? fmtDate(s.submittedAt) : "-"),
            h("td", null, s ? `${s.score.ok} / ${s.score.total}` : "-"),
            a.kind !== "words" ? h("td", null, s && s.grade ? `${s.grade.ok} / ${s.grade.total}（${s.grade.pct}%）${pending ? tx("・記述 {pending} 問未採点", { pending }) : ""}` : "-") : null,
            P && P.exam ? h("td", { class: ex && (ex.events || []).length ? "warn" : "" }, ex ? tx("{n} 回", { n: (ex.events || []).length }) : "-") : null,
            h("td", { class: "tc-actions" }, s ? button("text", tx("見る"), "visibility", () => detail(r)) : null));
        }))) : h("p", { class: "muted" }, tx("まだ生徒がいません。"))));
}

// ---------- 新しい仕組み（学校の名簿 → クラス）への移行（総合管理者。org-migrate.js） ----------
//   「確認する」は読むだけ。「移行する」は足すだけで、消さない。何度押しても、足りないものだけ足す
function migrationCard(ui, school, reload) {
  const { h, icon, button, toast, confirmDialog } = ui;
  const body = h("div", { class: "mig-body" });
  const card = h("section", { class: "mk-card" }, h("h2", null, icon("sync_alt"), tx("新しい仕組みへの移行")), body);
  const intro = () => body.replaceChildren(
    h("p", { class: "muted small" }, tx("いまは、クラスごとに生徒の名簿と専用コードがあります。新しい仕組みでは、学校が生徒・先生の名簿を持ち、名簿のユーザーをクラスに紐づけます（1 人が複数のクラスに入れます）。")),
    h("p", { class: "muted small" }, tx("移行は、いまのデータを消さず、書き換えず、足すだけです。まず「確認する」で、何を足すかを見られます（この時点では、何も書きこみません）。")),
    h("div", { class: "mk-row" }, button("outlined", tx("確認する"), "fact_check", check)));

  async function check() {
    body.replaceChildren(h("p", { class: "loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), tx("確認しています…")));
    let plan;
    try { plan = await cloud.planMigration(school); } catch (e) { toast(cloud.explain(e)); intro(); return; }
    const t = plan.totals;
    const li = (ic, text) => h("li", null, icon(ic), text);
    body.replaceChildren(...[
      t.done ? h("p", { class: "done" }, icon("task_alt"), tx("移行ずみです。足すものはありません。"))
        : h("p", { class: "muted small" }, tx("次のものを足します（いまのデータは、そのまま残ります）。")),
      h("ul", { class: "mk-summary" },
        li("groups", tx("クラス {classes} 件のうち、新しい仕組みに切りかえるもの {classesToConvert} 件", { classes: t.classes, classesToConvert: t.classesToConvert })),
        li("person_add", tx("名簿に加える生徒 {newStudents} 人（結びつきずみ {newStudentsClaimed}・コード待ち {newStudentsPending}。コード待ちには新しいコードを付けます）", { newStudents: t.newStudents, newStudentsClaimed: t.newStudentsClaimed, newStudentsPending: t.newStudentsPending })),
        li("school", tx("名簿に加える先生 {newTeachers} 人{n}", { newTeachers: t.newTeachers, n: t.pendingTeachers ? tx("・コード待ちの先生 {pendingTeachers} 人（新しいコードにして、前のコードは消します）", { pendingTeachers: t.pendingTeachers }) : "" })),
        li("how_to_reg", tx("クラスに紐づける生徒 {enrollments} 件・担任 {teacherLinks} 件", { enrollments: t.enrollments, teacherLinks: t.teacherLinks })),
        t.merged && !t.done ? li("merge", tx("同じアカウントが複数のクラスに別のプロファイルで入っていたので、{merged} 件を 1 人にまとめます（前の提出は、そのまま残ります）", { merged: t.merged })) : null,
        t.done ? null : li("lock", tx("移したクラスは、従来の参加コードでは入れなくなります（名簿のユーザーのコードで入ります）"))),
      plan.conflicts.length ? h("div", { class: "empty-card" }, icon("warning", "empty-icon"),
        h("p", null, tx("確かめが必要な生徒が {length} 人います（この人たちは、今回は移しません）。", { length: plan.conflicts.length })),
        h("ul", { class: "mk-summary" }, plan.conflicts.map((x) => h("li", null, `${x.cls.name} / ${x.profile.name}: ${x.reason}`)))) : null,
      plan.warnings.length ? h("ul", { class: "mk-summary warn" }, plan.warnings.map((w) => h("li", null, icon("info"), w))) : null,
      plan.classes.length ? h("div", { class: "dh-table-wrap" }, h("table", { class: "tc-table dh-table" },
        h("thead", null, h("tr", null, h("th", null, tx("クラス")), h("th", null, tx("担任")), h("th", null, tx("生徒")), h("th", null, tx("足すもの")))),
        h("tbody", null, plan.classes.map((x) => h("tr", null,
          h("td", null, x.cls.name), h("td", null, x.teacher ? x.teacher.name : h("span", { class: "muted" }, tx("なし"))),
          h("td", null, String(x.rows.length)),
          h("td", null, [x.convert ? tx("切りかえ") : null, x.addTeacher ? tx("担任") : null, x.addStudents ? tx("生徒 {addStudents}", { addStudents: x.addStudents }) : null].filter(Boolean).join("・") || "-")))))) : null,
      h("div", { class: "mk-row" },
        button("outlined", tx("もう一度確認する"), "refresh", check),
        t.done ? null : button("filled", tx("この内容で移行する"), "sync_alt", async () => {
          if (!(await confirmDialog(tx("移行しますか？"), tx("名簿とクラスの紐づけを {writes} 件ほど足します。いまのデータは消えません。移したクラスは、従来の参加コードでは入れなくなります。", { writes: t.writes }), tx("移行する")))) return;
          const note = h("p", { class: "muted small" }, tx("移行しています…"));
          body.replaceChildren(h("p", { class: "loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), tx("移行しています。このまま、閉じないでください。")), note);
          try {
            await cloud.runMigration(school, plan, { onProgress: (p) => { note.textContent = `${p.what}（${p.step} / ${p.total}）`; } });
            toast(tx("移行しました"));
            check();
          } catch (e) { console.error(e); toast(cloud.explain(e)); check(); }
        }))].filter(Boolean));
  }
  intro();
  return card;
}
