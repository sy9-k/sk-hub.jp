// SK Study の指導者メニュー（パソコン向け）。データは cloud.js、権限は y-filter の systems/firestore.rules の「SK Study」
//   階層: 総合管理者 → 学校 → 先生 → クラス。総合管理者・先生は、コード（総合管理者のコードは SK が、先生のコードは学校の総合管理者が配る）で入る
//   #/teach              コードを入れる（まだ指導者でないとき）・総合管理者は学校の一覧、先生はクラスの一覧
//   #/teach/school/<sid> 学校（総合管理者。先生のコード・先生・クラス）
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
import { openInviteSheet } from "./invite-pdf.js";
import { dashboardSection, adminSection } from "./teach-dash.js";
import { schoolTabs, openPicker } from "./teach-school.js";

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

// ---------- コードを入れる（総合管理者・先生になる） ----------

function roleText(info) {
  return info.role === "admin" ? "総合管理者" : `${info.schoolName} の先生`;
}

export function openStaffCodeDialog(ui, onDone) {
  const { h, button, toast, openDialog } = ui;
  const input = h("input", { type: "text", class: "field-input code-input", maxlength: "7", placeholder: "ABC123", autocomplete: "off", autocapitalize: "characters", "aria-label": "コード" });
  const info = h("div", { class: "join-info" });
  let found = null;
  const look = async () => {
    const code = cloud.normCode(input.value);
    if (code.length !== 6) { toast("コードは 6 けたです"); input.focus(); return; }
    info.replaceChildren(h("p", { class: "muted small" }, "確認中…"));
    try {
      found = await cloud.lookupStaffCode(code);
      if (found.claimedBy) { info.replaceChildren(h("p", { class: "warn small" }, "このコードはもう使われています。")); found = null; return; }
      info.replaceChildren(h("div", { class: "join-found" },
        h("strong", null, `${found.name} さん`),
        h("p", null, `${roleText(found)}として入ります。`),
        found.role === "admin" ? h("p", { class: "muted small" }, "総合管理者は、学校を作り、先生にコードを配れます。自分の学校のクラスの様子も見られます。")
          : h("p", { class: "muted small" }, "学校の中でクラスを作り、生徒に配信できます。学校の総合管理者は、あなたのクラスの生徒・提出を見られます。")));
      okBtn.querySelector("span:last-child").textContent = "このコードを使う";
    } catch (e) {
      found = null;
      info.replaceChildren(h("p", { class: "warn small" }, e.code === "bad-code" ? "コードが見つかりません。もう一度確かめてください。" : cloud.explain(e)));
    }
  };
  const okBtn = button("filled", "確かめる", null, async () => {
    if (!found || cloud.normCode(input.value) !== found.code) { await look(); return; }
    try { await cloud.redeemStaffCode(found); d.close(); toast("入りました。左上のアカウントの欄から、先生のプロファイルに切り替えられます"); onDone(); } catch (e) { toast(cloud.explain(e)); }
  });
  const d = openDialog("コードを入れる", h("div", null, h("p", null, "総合管理者または学校の先生から渡された、あなた専用の 6 けたのコードを入れてください。"), input, info), [button("text", "やめる", null, () => d.close()), okBtn]);
  input.addEventListener("input", () => { if (found && cloud.normCode(input.value) !== found.code) { found = null; info.replaceChildren(); okBtn.querySelector("span:last-child").textContent = "確かめる"; } });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) okBtn.click(); });
  input.focus();
}

async function codeView(ui) {
  const { h, icon, button, app } = ui;
  app.replaceChildren(...head(ui, "指導者になる", "指導者は、総合管理者 → 学校 → クラス の階層で管理します。総合管理者・先生には、それぞれ専用のコードが渡されます。", ["ホーム", "#/"]),
    h("section", { class: "mk-card" },
      h("h2", null, icon("key"), "コードを入れる"),
      h("p", null, "渡されたコードを入れると、総合管理者・先生として使えるようになります。"),
      h("ul", { class: "mk-summary" },
        h("li", null, icon("admin_panel_settings"), "総合管理者のコード … SK（開発者）から渡されます。学校を作り、先生にコードを配れます"),
        h("li", null, icon("school"), "先生のコード … 学校の総合管理者から渡されます。学校の中でクラスを作れます")),
      h("div", { class: "mk-row" }, button("filled", "コードを入れる", "key", () => openStaffCodeDialog(ui, () => renderTeach([], ui))))));
}

// ---------- 指導者メニューのホーム（総合管理者: 学校 / 先生: クラス） ----------

// 個人のプロファイルで開いたとき: 先生・総合管理者のプロファイルへの切りかえと、コードを入れる入り口
async function personalView(ts, ui) {
  const { h, icon, button, app } = ui;
  const profiles = await cloud.staffProfiles().catch(() => []);
  app.replaceChildren(...head(ui, "先生・総合管理者", "先生・総合管理者は、生徒のクラスのプロファイルと同じように、専用のプロファイルで入ります。プロファイルごとに、教材（マイ単語帳・プリント）と学習の記録が別になります。", ["ホーム", "#/"]),
    profiles.length ? h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, `プロファイル（${profiles.length}）`)),
      h("div", { class: "set-list" }, profiles.map((p) => h("div", { class: "set-row" },
        h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon(p.id === "admin" ? "admin_panel_settings" : "school")),
        h("div", { class: "set-row-body" },
          h("span", { class: "set-row-link" },
            h("span", { class: "set-row-sub" }, h("span", null, p.orgName)),
            h("span", { class: "set-row-title" }, p.name))),
        h("div", { class: "set-row-end" }, button("filled", "このプロファイルで入る", "login", () => cloud.setActiveClass(p.id))))))) : null,
    h("section", { class: "mk-card" },
      h("h2", null, icon("key"), "コードを入れる"),
      h("p", null, profiles.length ? "別の学校の先生にもなるときは、その学校の先生のコードを入れます。" : "渡されたコードを入れると、先生・総合管理者のプロファイルができます。"),
      h("ul", { class: "mk-summary" },
        h("li", null, icon("admin_panel_settings"), "総合管理者のコード … SK（開発者）から渡されます。学校を作り、先生にコードを配れます"),
        h("li", null, icon("school"), "先生のコード … 学校の総合管理者から渡されます。学校の中でクラスを作れます")),
      h("div", { class: "mk-row" }, button("filled", "コードを入れる", "key", () => openStaffCodeDialog(ui, () => renderTeach([], ui))))));
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
    const input = h("input", { type: "text", class: "field-input", maxlength: "60", placeholder: "例: SK 中学校" });
    const d = openDialog("学校を作る", h("div", null, h("p", null, "学校の名前を入れてください。作ったあと、先生のコードを配れます。"), input), [
      button("text", "やめる", null, () => d.close()),
      button("filled", "作る", "add", async () => {
        if (!input.value.trim()) { input.focus(); return; }
        try { const sid = await cloud.createSchool(input.value); d.close(); go(`/teach/school/${sid}`); } catch (e) { toast(cloud.explain(e)); }
      })]);
    input.focus();
  };
  const createClass = () => {
    if (!ts.schools.length) { toast("先生として入っている学校がありません。学校の総合管理者から先生のコードをもらってください"); return; }
    const sel = h("select", { class: "field-select", "aria-label": "学校" }, (sid ? ts.schools.filter((x) => x.id === sid) : ts.schools).map((x) => h("option", { value: x.id }, x.name)));
    const input = h("input", { type: "text", class: "field-input", maxlength: "60", placeholder: "例: 1 年 A 組 英語" });
    const d = openDialog("クラスを作る", h("div", null,
      h("label", { class: "field" }, h("span", { class: "field-label" }, "学校"), sel),
      h("label", { class: "field" }, h("span", { class: "field-label" }, "クラスの名前"), input),
      h("p", { class: "muted small" }, "作ると、生徒に配る参加コードができます。")), [
      button("text", "やめる", null, () => d.close()),
      button("filled", "作る", "add", async () => {
        if (!input.value.trim()) { input.focus(); return; }
        try { const cid = await cloud.createClass(input.value, ts.teacher.name, sel.value); d.close(); go(`/teach/${cid}`); } catch (e) { toast(cloud.explain(e)); }
      })]);
    input.focus();
  };
  const adminOnly = ctx === "admin" && showAdmin;
  const who = showAdmin ? `${ts.admin.name}（総合管理者）` : `${ts.teacher.name} 先生`;
  app.replaceChildren(...head(ui, who, sid ? schoolName.get(sid) || "" : showTeacher && ts.teacher.org ? ts.teacher.org : "", ["ホーム", "#/"]),
    // 総合管理者のプロファイル: 学校・先生・クラスの全体（専用の画面）
    adminOnly ? adminSection(ui, { schools, onCreateSchool: createSchool }) : dashboardSection(ui, { classes, schools: showAdmin ? schools : [], schoolName, title: "クラスの様子" }),
    showAdmin && !adminOnly ? h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, `学校（${schools.length}）`), button("filled", "学校を作る", "add", createSchool)),
      schools.length ? h("div", { class: "set-list" }, schools.map((x) => h("div", { class: "set-row" },
        h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon("apartment")),
        h("div", { class: "set-row-body" },
          h("a", { class: "set-row-link", href: `#/teach/school/${encodeURIComponent(x.id)}` },
            h("span", { class: "set-row-sub" }, h("span", null, "先生・クラスを見る")),
            h("span", { class: "set-row-title" }, x.name))),
        h("div", { class: "set-row-end" }, icon("chevron_right")))))
        : h("div", { class: "empty-card" }, icon("apartment", "empty-icon"), h("p", null, "まだ学校がありません。学校を作って、先生にコードを配りましょう。"))) : null,
    showTeacher ? h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, `${showAdmin ? "自分の " : ""}クラス（${classes.length}）`), button("filled", "クラスを作る", "add", createClass)),
      classes.length ? h("div", { class: "set-list" }, classes.map((c) => h("div", { class: "set-row" },
        h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon("groups")),
        h("div", { class: "set-row-body" },
          h("a", { class: "set-row-link", href: `#/teach/${encodeURIComponent(c.id)}` },
            h("span", { class: "set-row-sub" }, h("span", { class: "code-pill" }, c.joinCode), h("span", null, schoolName.get(c.schoolId) || (c.schoolId ? "学校" : "学校なし")), h("span", null, c.open ? "参加を受け付け中" : "参加の受け付けは終了")),
            h("span", { class: "set-row-title" }, c.name))),
        h("div", { class: "set-row-end" }, icon("chevron_right")))))
        : h("div", { class: "empty-card" }, icon("groups", "empty-icon"), h("p", null, "まだクラスがありません。クラスを作って、参加コードを生徒に配りましょう。"))) : null,
    ctx ? null : h("section", { class: "mk-card" },
      h("h2", null, icon("key"), "コードを入れる"),
      h("p", { class: "muted small" }, ts.admin ? "先生としても入るときは、学校の総合管理者から渡された先生のコードを入れます。" : "ほかの学校の先生にもなるときは、その学校の先生のコードを入れます。"),
      h("div", { class: "mk-row" }, button("outlined", "コードを入れる", "key", () => openStaffCodeDialog(ui, reload)))),
    h("p", { class: "footnote" }, "指導者メニューはパソコンでの利用を前提にしています。"));
}

// ---------- 学校のプロファイルの先生（組織モデル）のホーム ----------
//   自分が担任のクラスの様子と、クラスの一覧。クラスは、自分で作ることもできる（自分が担任になる）。生徒は、学校の名簿から入れる
async function orgTeacherHome(s, ui, o) {
  const { h, icon, button, toast, go, app, openDialog } = ui;
  const classes = await cloud.teacherClassesOf(o.sid, o.personId);
  const school = { id: o.sid, name: o.className };
  const create = () => {
    const input = h("input", { type: "text", class: "field-input", maxlength: "60", placeholder: "例: 1 年 A 組 英語" });
    const d = openDialog("クラスを作る", h("div", null, h("label", { class: "field" }, h("span", { class: "field-label" }, "クラスの名前"), input),
      h("p", { class: "muted small" }, "作ると、あなたが担任になります。生徒は、学校の名簿から入れます。")), [
      button("text", "やめる", null, () => d.close()),
      button("filled", "作る", "add", async () => {
        if (!input.value.trim()) { input.focus(); return; }
        try { const cid = await cloud.createOrgClass(school, input.value, { me: { id: o.personId, name: o.profileName } }); d.close(); go(`/teach/${cid}`); } catch (e) { toast(cloud.explain(e)); }
      })]);
    input.focus();
  };
  app.replaceChildren(...head(ui, `${o.profileName} 先生`, o.className, null),
    ...(classes.length ? [dashboardSection(ui, { classes, title: "クラスの様子" })] : []),
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", null, `担任のクラス（${classes.length}）`), button("filled", "クラスを作る", "add", create)),
      classes.length ? h("div", { class: "set-list" }, classes.map((c) => h("div", { class: "set-row" },
        h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon("groups")),
        h("div", { class: "set-row-body" },
          h("a", { class: "set-row-link", href: `#/teach/${encodeURIComponent(c.id)}` },
            h("span", { class: "set-row-sub" }, h("span", null, o.className)),
            h("span", { class: "set-row-title" }, c.name))),
        h("div", { class: "set-row-end" }, icon("chevron_right")))))
        : h("div", { class: "empty-card" }, icon("groups", "empty-icon"), h("p", null, "まだ、担任のクラスがありません。学校の総合管理者があなたをクラスの担任にするか、「クラスを作る」で作りましょう。"))),
    h("p", { class: "footnote" }, "指導者メニューはパソコンでの利用を前提にしています。"));
}

// ---------- 学校（総合管理者） ----------

async function schoolView(sid, s, ui) {
  const { h, icon, button, toast, confirmDialog, go, app, openDialog } = ui;
  const school = await cloud.getSchool(sid);
  if (school.ownerUid !== s.user.uid) { go("/teach", true); return; }
  const [staff, classes, allCodes] = await Promise.all([cloud.schoolStaff(sid), cloud.schoolClasses(sid), cloud.myStaffCodes()]);
  const codes = allCodes.filter((c) => c.schoolId === sid && !c.claimedBy);
  document.title = `${school.name} - 指導者メニュー`;
  const reload = () => renderTeach(["school", sid], ui);
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast("コピーしました"); } catch (e) { toast("コピーできませんでした"); } };
  const ref = { id: sid, name: school.name };
  // 参加の案内 PDF（コードの入れ方つき。1 人 1 枚）
  const sheet = (list) => {
    if (!list.length) { toast("コード待ちの先生がいません"); return; }
    if (!openInviteSheet({ kind: "teacher", items: list.map((c) => ({ name: c.name, code: c.id })) })) toast("案内を開けませんでした。ポップアップを許可してください");
  };
  const issue = () => {
    const ta = h("textarea", { class: "field-input", rows: "6", placeholder: "先生の名前を 1 行に 1 人ずつ（例: 山田 花子）" });
    const d = openDialog("先生のコードを作る", h("div", null, h("p", null, "名前を 1 行に 1 人ずつ入れてください。1 人ごとに専用のコードができます。コードは 1 回だけ使えます。"), ta), [
      button("text", "やめる", null, () => d.close()),
      button("filled", "作る", "add", async () => {
        const names = ta.value.split(/\r\n|\r|\n/).map((x) => x.trim()).filter(Boolean);
        if (!names.length) { ta.focus(); return; }
        try { const n = await cloud.issueStaffCodes("teacher", names, ref); d.close(); toast(`${n} 人分のコードを作りました`); reload(); } catch (e) { toast(cloud.explain(e)); }
      })]);
    ta.focus();
  };
  const staffCard =
    h("section", { class: "mk-card" },
      h("div", { class: "section-head" }, h("h2", null, icon("school"), `先生（${staff.length}）`), h("div", { class: "section-actions" }, button("outlined", "案内 PDF（コード待ちの全員）", "picture_as_pdf", () => sheet(codes)), button("filled", "先生のコードを作る", "person_add", issue))),
      h("p", { class: "muted small" }, "先生は SK Study の「指導者メニュー」→「コードを入れる」で、専用のコードを入れて学校に入ります。コードは 1 人 1 回だけ使えます。"),
      staff.length || codes.length ? h("table", { class: "tc-table" },
        h("thead", null, h("tr", null, h("th", null, "名前"), h("th", null, "コード"), h("th", null, "状態"), h("th", null, ""))),
        h("tbody", null,
          staff.map((m) => h("tr", null,
            h("td", null, m.name), h("td", null, h("span", { class: "muted" }, "-")), h("td", null, "参加ずみ"),
            h("td", { class: "tc-actions" }, button("text", "外す", "person_remove", async () => {
              if (!(await confirmDialog(`${m.name} さんを学校から外しますか？`, "この先生は、この学校のクラスを触れなくなります。クラスと生徒の提出は残ります。", "外す", true))) return;
              try { await cloud.removeStaff(sid, m.id); toast("外しました"); reload(); } catch (e) { toast(cloud.explain(e)); }
            })))),
          codes.map((c) => h("tr", null,
            h("td", null, c.name), h("td", null, h("span", { class: "code-pill" }, c.id)), h("td", null, "コード待ち"),
            h("td", { class: "tc-actions" },
              button("text", "コピー", "content_copy", () => copy(c.id)),
              button("text", "案内 PDF", "picture_as_pdf", () => sheet([c])),
              button("text", "再発行", "refresh", async () => {
                try { await cloud.deleteStaffCode(c.id); await cloud.issueStaffCodes("teacher", [c.name], ref); toast("作り直しました"); reload(); } catch (e) { toast(cloud.explain(e)); }
              }),
              button("text", "取り消す", "delete", async () => {
                try { await cloud.deleteStaffCode(c.id); toast("取り消しました"); reload(); } catch (e) { toast(cloud.explain(e)); }
              })))))) : h("p", { class: "muted" }, "まだ先生がいません。「先生のコードを作る」で、名前ごとのコードを作って配りましょう.".replace("配りましょう.", "配りましょう。")));
  const legacyClasses = classes.filter((c) => c.orgModel !== true);
  const classesCard =
    h("section", { class: "mk-card" },
      h("h2", null, icon("groups"), `従来のクラス（${legacyClasses.length}）`),
      legacyClasses.length ? h("div", { class: "set-list flat" }, legacyClasses.map((c) => h("div", { class: "set-row" },
        h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon("groups")),
        h("div", { class: "set-row-body" },
          h("a", { class: "set-row-link", href: `#/teach/${encodeURIComponent(c.id)}` },
            h("span", { class: "set-row-sub" }, h("span", null, c.teacherName ? `${c.teacherName} 先生` : "先生")),
            h("span", { class: "set-row-title" }, c.name))),
        h("div", { class: "set-row-end" }, icon("chevron_right")))))
        : h("p", { class: "muted" }, "まだクラスがありません。先生がクラスを作ると、ここに出ます。"));
  const settingsCard =
    h("section", { class: "mk-card" },
      h("h2", null, icon("settings"), "学校の設定"),
      h("div", { class: "mk-row" },
        button("outlined", "名前を変える", "edit", () => {
          const input = h("input", { type: "text", class: "field-input", maxlength: "60", value: school.name });
          const d = openDialog("学校の名前", input, [button("text", "やめる", null, () => d.close()), button("filled", "保存", null, async () => {
            if (!input.value.trim()) return;
            try { await cloud.renameSchool(school, input.value); d.close(); reload(); } catch (e) { toast(cloud.explain(e)); }
          })]);
        }),
        button("outlined", "学校を削除", "delete", async () => {
          if (!(await confirmDialog("学校を削除しますか？", `「${school.name}」と、先生の名簿・配ったコードを消します。クラスが残っているときは削除できません。`, "削除する", true))) return;
          try { await cloud.deleteSchool(school); toast("削除しました"); go("/teach", true); } catch (e) { toast(cloud.explain(e)); }
        }, { "data-danger": "" })));
  app.replaceChildren(...head(ui, school.name, "総合管理者の画面です。先生のコードを配り、学校のクラスの様子を見られます。", ["指導者メニュー", "#/teach"]),
    schoolTabs(ui, { school, classes, reload, legacy: { staff: staffCard, classes: classesCard, settings: settingsCard, migration: migrationCard(ui, school, reload) } }));
}

// ---------- クラス ----------

async function classView(cid, ui) {
  const { h, icon, button, linkButton, toast, confirmDialog, go, app, openDialog } = ui;
  const [cls, members, assigns, sess] = await Promise.all([cloud.getClass(cid), cloud.roster(cid), cloud.allAssignments(cid), cloud.session()]);
  const org = cls.orgModel === true; // 組織モデル: 担任は teachers、生徒は学校の名簿からの在籍
  const ro = org ? !(await cloud.isTeacherOf(cls)) : cls.ownerUid !== sess.user.uid; // 学校の総合管理者は読むだけ（書き換えられるのはクラスの持ち主・担任の先生）
  const counts = await Promise.all(assigns.map((a) => cloud.submissions(cid, a.id).then((x) => x.length).catch(() => null)));
  document.title = `${cls.name} - 指導者メニュー`;
  const reload = () => classView(cid, ui);
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast("コピーしました"); } catch (e) { toast("コピーできませんでした"); } };
  const joinUrl = `${location.origin}/study/#/`;
  // 参加の案内 PDF（コードの入れ方つき。1 人 1 枚）
  const sheet = (list) => {
    if (!list.length) { toast("コード待ちの生徒がいません"); return; }
    if (!openInviteSheet({ kind: "student", orgName: cls.name, subName: cls.teacherName || "", items: list })) toast("案内を開けませんでした。ポップアップを許可してください");
  };
  const pendingProfiles = members.filter((m) => m.profile && !m.profile.claimedBy).map((m) => ({ name: m.profile.name, code: m.profile.code }));

  app.replaceChildren(...head(ui, cls.name, ro ? `${cls.teacherName ? `${cls.teacherName} 先生` : "先生"}のクラス（見るだけ）` : null, ro && cls.schoolId ? ["学校", `#/teach/school/${encodeURIComponent(cls.schoolId)}`] : ["指導者メニュー", "#/teach"]),
    h("div", { class: "tc-grid" },
      org ? h("section", { class: "mk-card tc-code" },
        h("h2", null, icon("apartment"), "このクラスについて"),
        h("p", { class: "muted small" }, "生徒は、学校の名簿から入れます（下の「生徒」）。生徒は、学校のコードで学校に入ると、このクラスの課題が自動で出ます。クラスごとの参加コードは、要りません。")) : h("section", { class: "mk-card tc-code" },
        h("h2", null, icon("key"), "参加のしかた"),
        h("p", { class: "muted small" }, `下の「生徒プロファイル」ごとに、専用の参加コードがあります。生徒は自分の SK Hub Systems アカウントで SK Study（${joinUrl}）を開き、「クラス」→「参加コードを入れる」で専用コードを入れます。コードは 1 人 1 回だけ使えます。`),
        h("label", { class: "switch-row" },
          h("input", { type: "checkbox", checked: cls.open, onchange: async (e) => {
            try { await cloud.updateClass(cls, { open: e.target.checked }); toast(e.target.checked ? "参加を受け付けます" : "参加の受け付けを終えました"); reload(); } catch (err) { toast(cloud.explain(err)); }
          } }),
          h("span", null, h("strong", null, "参加を受け付ける"), h("small", null, "生徒がそろったら止めておくと安心です")))),
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
                  a.resultsOpen ? h("span", { class: "pub-pill on" }, a.kind === "wordtest" ? "返却ずみ" : "結果を公開") : null,
                  a.due ? h("span", null, `締め切り ${fmtDue(a.due)}`) : null),
                h("span", { class: "set-row-title" }, a.title)),
              h("span", { class: "set-row-meta" }, h("span", null, icon("inbox"), counts[i] == null ? "-" : `提出 ${counts[i]} / ${members.length}`))),
            h("div", { class: "set-row-end" }, icon("chevron_right")));
        })) : h("p", { class: "muted" }, "まだ配信していません。"))),
    org ? h("section", { class: "mk-card" },
      h("div", { class: "section-head" }, h("h2", null, icon("group"), `生徒（${members.length}）`),
        ro ? null : button("filled", "名簿から生徒を入れる", "person_add", () => openPicker(ui, { school: { id: cls.schoolId, name: "" }, cls, role: "student", onDone: reload }))),
      members.length ? h("table", { class: "tc-table" },
        h("thead", null, h("tr", null, h("th", null, "名前"), h("th", null, "状態"), h("th", null, ""))),
        h("tbody", null, members.map((m) => h("tr", null,
          h("td", null, m.name),
          h("td", null, m.claimed ? "参加ずみ" : "コード待ち"),
          h("td", { class: "tc-actions" }, ro ? null : button("text", "外す", "close", async () => {
            if (!(await confirmDialog(`${m.name} さんをクラスから外しますか？`, "提出した答えは残ります。あとで、また入れられます。", "外す", true))) return;
            try { await cloud.unenroll(cid, cls.schoolId, m.personId, "student"); toast("外しました"); reload(); } catch (e) { toast(cloud.explain(e)); }
          })))))) : h("p", { class: "muted" }, "まだ生徒がいません。「名簿から生徒を入れる」で、学校の名簿から選びます。")) :
h("section", { class: "mk-card" },
  h("div", { class: "section-head" }, h("h2", null, icon("group"), `生徒プロファイル（${members.length}）`), h("div", { class: "section-actions" }, button("outlined", "案内 PDF（コード待ちの全員）", "picture_as_pdf", () => sheet(pendingProfiles)), button("filled", "プロファイルを作る", "person_add", () => {
        const ta = h("textarea", { class: "field-input", rows: "8", placeholder: "名前を 1 行に 1 人ずつ（例: 田中 太郎）" });
        const d = openDialog("生徒プロファイルを作る", h("div", null, h("p", null, "名前を 1 行に 1 人ずつ入れてください。1 人ごとに専用の参加コードができます。"), ta), [
          button("text", "やめる", null, () => d.close()),
          button("filled", "作る", "add", async () => {
            const names = ta.value.split(/\r\n|\r|\n/).map((x) => x.trim()).filter(Boolean);
            if (!names.length) { ta.focus(); return; }
            try { const n = await cloud.createProfiles(cls, names); d.close(); toast(`${n} 人分のプロファイルを作りました`); reload(); } catch (e) { toast(cloud.explain(e)); }
          })]);
        ta.focus();
      }))),
      members.length ? h("table", { class: "tc-table" },
        h("thead", null, h("tr", null, h("th", null, "名前"), h("th", null, "参加コード"), h("th", null, "状態"), h("th", null, ""))),
        h("tbody", null, members.map((m) => {
          const p = m.profile;
          return h("tr", null,
            h("td", null, m.name),
            h("td", null, p ? (p.claimedBy ? h("span", { class: "muted" }, "-") : h("span", { class: "code-pill" }, p.code)) : h("span", { class: "muted" }, "-")),
            h("td", null, m.claimed ? "参加ずみ" : "コード待ち"),
            h("td", { class: "tc-actions" },
              p && !p.claimedBy ? button("text", "コピー", "content_copy", () => copy(p.code)) : null,
              p && !p.claimedBy ? button("text", "案内 PDF", "picture_as_pdf", () => sheet([{ name: p.name, code: p.code }])) : null,
              p ? button("text", "名前", "edit", () => {
                const input = h("input", { type: "text", class: "field-input", maxlength: "40", value: p.name });
                const d = openDialog("名前を変える", h("div", null, input, p.claimedBy ? null : h("p", { class: "muted small" }, "参加コードも新しくなります。")), [button("text", "やめる", null, () => d.close()), button("filled", "保存", null, async () => {
                  if (!input.value.trim()) return;
                  try { await cloud.renameProfile(cls, p, input.value); d.close(); reload(); } catch (e) { toast(cloud.explain(e)); }
                })]);
                input.focus();
              }) : null,
              p ? button("text", p.claimedBy ? "結びつけを外す" : "コード再発行", p.claimedBy ? "link_off" : "refresh", async () => {
                const msg = p.claimedBy ? [`${p.name} さんの結びつけを外しますか？`, "そのアカウントはこのクラスから外れます。提出した答えは残り、新しいコードで別のアカウントを結びつけられます。", "外す"] : ["コードを作り直しますか？", "今のコードは使えなくなります。", "作り直す"];
                if (!(await confirmDialog(msg[0], msg[1], msg[2], !!p.claimedBy))) return;
                try { await cloud.resetProfile(cls, p, { release: !!p.claimedBy }); toast(p.claimedBy ? "外しました" : "作り直しました"); reload(); } catch (e) { toast(cloud.explain(e)); }
              }) : button("text", "外す", "person_remove", async () => {
                if (!(await confirmDialog(`${m.name} さんをクラスから外しますか？`, "提出した答えは残ります。", "外す", true))) return;
                try { await cloud.removeMember(cid, m.id); toast("外しました"); reload(); } catch (e) { toast(cloud.explain(e)); }
              }),
              p ? button("text", "削除", "delete", async () => {
                if (!(await confirmDialog(`${p.name} さんのプロファイルを削除しますか？`, "結びつけているアカウントはクラスから外れます。提出済みの答えは残りますが、名簿から消えます。", "削除する", true))) return;
                try { await cloud.deleteProfile(cls, p); toast("削除しました"); reload(); } catch (e) { toast(cloud.explain(e)); }
              }) : null));
        }))) : h("p", { class: "muted" }, "まだ生徒プロファイルがありません。「プロファイルを作る」で名前を入れると、1 人ずつの参加コードができます。")),
    h("section", { class: "mk-card" },
      h("h2", null, icon("settings"), "クラスの設定"),
      h("div", { class: "mk-row" },
        button("outlined", "名前を変える", "edit", () => {
          const input = h("input", { type: "text", class: "field-input", maxlength: "60", value: cls.name });
          const d = openDialog("クラスの名前", input, [button("text", "やめる", null, () => d.close()), button("filled", "保存", null, async () => {
            if (!input.value.trim()) return;
            try { if (org) await cloud.renameOrgClass(cls, input.value); else await cloud.updateClass(cls, { name: input.value.trim() }); d.close(); reload(); } catch (e) { toast(cloud.explain(e)); }
          })]);
        }),
        button("outlined", "クラスを削除", "delete", async () => {
          if (!(await confirmDialog("クラスを削除しますか？", `「${cls.name}」と、配信した課題・生徒の提出・採点をすべて消します。もとに戻せません。`, "削除する", true))) return;
          try { if (org) await cloud.deleteOrgClass(cls); else await cloud.deleteClass(cls); toast("削除しました"); go("/teach", true); } catch (e) { toast(cloud.explain(e)); }
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
      h("optgroup", { label: "SK認定コンテンツ" }, store.getSkSets().map((s) => h("option", { value: s.id, selected: s.id === S.setId }, `${s.title}（${s.words.length} 語）`))),
      store.getMySets().length ? h("optgroup", { label: "マイ単語帳" }, store.getMySets().map((s) => h("option", { value: s.id, selected: s.id === S.setId }, `${s.title}（${s.words.length} 語）`))) : null);
    const count = h("input", { type: "number", class: "field-input", min: "1", max: "100", value: String(S.count), oninput: (e) => { S.count = Math.max(1, Math.min(100, Number(e.target.value) || 10)); } });
    const format = h("select", { class: "field-select", onchange: (e) => { S.format = e.target.value; } }, Object.entries(FORMAT_LABEL).map(([v, l]) => h("option", { value: v, selected: S.format === v }, l)));
    const printSel = h("select", { class: "field-select", onchange: (e) => { S.printId = e.target.value; loadPrint(); } },
      prints.map((p) => h("option", { value: p.id, selected: p.id === S.printId }, `${p.exam ? "【試験】" : ""}${p.title}（解答欄 ${p.blanks}）`)));
    const title = h("input", { type: "text", class: "field-input", maxlength: "80", value: S.title, placeholder: "空なら、単語帳・プリントの名前", oninput: (e) => { S.title = e.target.value; } });
    const due = h("input", { type: "datetime-local", class: "field-input", value: S.due, oninput: (e) => { S.due = e.target.value; } });
    const noCopy = h("input", { type: "checkbox", checked: S.noCopy, onchange: (e) => { S.noCopy = e.target.checked; } });
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
      S.kind === "print" ? null : h("label", { class: "switch-row" }, noCopy, h("span", null, h("strong", null, "生徒がコピーできないようにする"), h("small", null, "「自分用にコピー」と、単語のコピー・選択をできなくします。生徒には「先生が配信」と表示されます"))),
      h("label", { class: "switch-row" }, pub, h("span", null, h("strong", null, "すぐ生徒に公開する"), h("small", null, "あとで結果の画面から公開・非公開を切りかえられます"))),
      h("div", { class: "mk-row" }, button("filled", "配信する", "send", saveIt)),
      status);
  }

  async function saveIt() {
    const data = { kind: S.kind, published: S.published, noCopy: S.kind !== "print" && S.noCopy, resultsOpen: false, due: S.due ? new Date(S.due).getTime() : null };
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
  const [cls, a, members, subs] = await Promise.all([cloud.getClass(cid), cloud.getAssignment(cid, aid), cloud.roster(cid), cloud.submissions(cid, aid)]);
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
        a.kind === "wordtest" ? h("div", { class: "switch-row return-row" },
          h("span", null, h("strong", null, a.resultsOpen ? "返却ずみ" : "未返却"), h("small", null, a.resultsOpen ? "生徒は、自分の点数と答えを見られます" : "返却するまで、生徒は点数も答えも見られません（提出したことだけ分かります）")),
          button(a.resultsOpen ? "outlined" : "filled", a.resultsOpen ? "返却を取り消す" : "返却する", "assignment_return", async () => {
            if (!a.resultsOpen && !(await confirmDialog("返却しますか？", `提出した生徒に、点数と答えが見えるようになります。まだ提出していない生徒がいても、返却できます。`, "返却する"))) return;
            openResults(!a.resultsOpen);
          })) : null,
        a.kind === "print" ? h("label", { class: "switch-row" }, h("input", { type: "checkbox", checked: a.resultsOpen, onchange: (e) => openResults(e.target.checked) }),
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

// ---------- 新しい仕組み（学校の名簿 → クラス）への移行（総合管理者。org-migrate.js） ----------
//   「確認する」は読むだけ。「移行する」は足すだけで、消さない。何度押しても、足りないものだけ足す
function migrationCard(ui, school, reload) {
  const { h, icon, button, toast, confirmDialog } = ui;
  const body = h("div", { class: "mig-body" });
  const card = h("section", { class: "mk-card" }, h("h2", null, icon("sync_alt"), "新しい仕組みへの移行"), body);
  const intro = () => body.replaceChildren(
    h("p", { class: "muted small" }, "いまは、クラスごとに生徒の名簿と専用コードがあります。新しい仕組みでは、学校が生徒・先生の名簿を持ち、名簿のユーザーをクラスに紐づけます（1 人が複数のクラスに入れます）。"),
    h("p", { class: "muted small" }, "移行は、いまのデータを消さず、書き換えず、足すだけです。まず「確認する」で、何を足すかを見られます（この時点では、何も書きこみません）。"),
    h("div", { class: "mk-row" }, button("outlined", "確認する", "fact_check", check)));

  async function check() {
    body.replaceChildren(h("p", { class: "loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), "確認しています…"));
    let plan;
    try { plan = await cloud.planMigration(school); } catch (e) { toast(cloud.explain(e)); intro(); return; }
    const t = plan.totals;
    const li = (ic, text) => h("li", null, icon(ic), text);
    body.replaceChildren(...[
      t.done ? h("p", { class: "done" }, icon("task_alt"), "移行ずみです。足すものはありません。")
        : h("p", { class: "muted small" }, "次のものを足します（いまのデータは、そのまま残ります）。"),
      h("ul", { class: "mk-summary" },
        li("groups", `クラス ${t.classes} 件のうち、新しい仕組みに切りかえるもの ${t.classesToConvert} 件`),
        li("person_add", `名簿に加える生徒 ${t.newStudents} 人（結びつきずみ ${t.newStudentsClaimed}・コード待ち ${t.newStudentsPending}。コード待ちには新しいコードを付けます）`),
        li("school", `名簿に加える先生 ${t.newTeachers} 人${t.pendingTeachers ? `・コード待ちの先生 ${t.pendingTeachers} 人（新しいコードにして、前のコードは消します）` : ""}`),
        li("how_to_reg", `クラスに紐づける生徒 ${t.enrollments} 件・担任 ${t.teacherLinks} 件`),
        t.merged && !t.done ? li("merge", `同じアカウントが複数のクラスに別のプロファイルで入っていたので、${t.merged} 件を 1 人にまとめます（前の提出は、そのまま残ります）`) : null,
        t.done ? null : li("lock", "移したクラスは、従来の参加コードでは入れなくなります（名簿のユーザーのコードで入ります）")),
      plan.conflicts.length ? h("div", { class: "empty-card" }, icon("warning", "empty-icon"),
        h("p", null, `確かめが必要な生徒が ${plan.conflicts.length} 人います（この人たちは、今回は移しません）。`),
        h("ul", { class: "mk-summary" }, plan.conflicts.map((x) => h("li", null, `${x.cls.name} / ${x.profile.name}: ${x.reason}`)))) : null,
      plan.warnings.length ? h("ul", { class: "mk-summary warn" }, plan.warnings.map((w) => h("li", null, icon("info"), w))) : null,
      plan.classes.length ? h("div", { class: "dh-table-wrap" }, h("table", { class: "tc-table dh-table" },
        h("thead", null, h("tr", null, h("th", null, "クラス"), h("th", null, "担任"), h("th", null, "生徒"), h("th", null, "足すもの"))),
        h("tbody", null, plan.classes.map((x) => h("tr", null,
          h("td", null, x.cls.name), h("td", null, x.teacher ? x.teacher.name : h("span", { class: "muted" }, "なし")),
          h("td", null, String(x.rows.length)),
          h("td", null, [x.convert ? "切りかえ" : null, x.addTeacher ? "担任" : null, x.addStudents ? `生徒 ${x.addStudents}` : null].filter(Boolean).join("・") || "-")))))) : null,
      h("div", { class: "mk-row" },
        button("outlined", "もう一度確認する", "refresh", check),
        t.done ? null : button("filled", "この内容で移行する", "sync_alt", async () => {
          if (!(await confirmDialog("移行しますか？", `名簿とクラスの紐づけを ${t.writes} 件ほど足します。いまのデータは消えません。移したクラスは、従来の参加コードでは入れなくなります。`, "移行する"))) return;
          const note = h("p", { class: "muted small" }, "移行しています…");
          body.replaceChildren(h("p", { class: "loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), "移行しています。このまま、閉じないでください。"), note);
          try {
            await cloud.runMigration(school, plan, { onProgress: (p) => { note.textContent = `${p.what}（${p.step} / ${p.total}）`; } });
            toast("移行しました");
            check();
          } catch (e) { console.error(e); toast(cloud.explain(e)); check(); }
        }))].filter(Boolean));
  }
  intro();
  return card;
}
