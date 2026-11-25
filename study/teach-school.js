// 総合管理者の学校の画面（組織モデル）。3 つのタブ: ユーザー（名簿）/ クラス / 様子
//   ・ユーザー … 学校の名簿（生徒・先生）。名前をまとめて入れると、1 人ごとに専用コードができる。案内 PDF・名前・コードの作り直し・結びつけの解除・停止・削除
//   ・クラス   … クラスを作る・名前を変える・消す。担任と生徒を、名簿から選んで紐づける（1 人が複数のクラスに入れる）
//   ・様子     … クラスの提出の様子（teach-dash.js）と、学校の設定
//   従来の方式（先生名簿・クラスごとのコード）は、移行が終わるまで、それぞれのタブの下に残る（teach.js が作ったものをそのまま入れる）
//   読み書きは cloud.js（org.js）。権限は firestore.rules の「組織モデル」
import { tx } from "./i18n.js";
import * as cloud from "./cloud.js";
import { openInviteSheet } from "./invite-pdf.js";
import { dashboardSection } from "./teach-dash.js";

const ROLE_LABEL = { student: tx("生徒"), teacher: tx("先生") };

export function schoolTabs(ui, { school, classes, legacy, reload }) {
  const { h, icon, button, toast, confirmDialog, openDialog } = ui;
  const wrap = h("div", { class: "school-tabs" });
  const tabBar = h("div", { class: "chips school-tab-bar", role: "tablist", "aria-label": tx("学校の画面") });
  const panel = h("div", { class: "school-panel", role: "tabpanel" });
  wrap.append(tabBar, panel);
  let tab = "users";
  const TABS = [["users", tx("ユーザー"), "badge"], ["classes", tx("クラス"), "groups"], ["overview", tx("様子"), "monitoring"]];
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast(tx("コピーしました")); } catch (e) { toast(tx("コピーできませんでした")); } };
  const fail = (e) => { console.error(e); toast(cloud.explain(e)); };

  function drawBar() {
    tabBar.replaceChildren(...TABS.map(([k, label, ic]) => h("button", { type: "button", class: "chip", role: "tab", "aria-selected": String(tab === k), "aria-pressed": String(tab === k), onclick: () => { tab = k; drawBar(); drawPanel(); } }, icon(ic), label)));
  }
  function drawPanel() {
    panel.replaceChildren(h("p", { class: "loading" }, h("span", { class: "spinner", "aria-hidden": "true" }), tx("読み込み中…")));
    const make = tab === "users" ? usersPanel : tab === "classes" ? classesPanel : overviewPanel;
    make().then((nodes) => { panel.replaceChildren(...nodes.filter(Boolean)); }).catch((e) => { fail(e); panel.replaceChildren(h("p", { class: "warn small" }, cloud.explain(e))); });
  }
  const refresh = () => drawPanel();

  // ---------- ユーザー ----------
  let roleFilter = "all";
  let query = "";
  async function usersPanel() {
    const people = await cloud.schoolPeople(school.id);
    const codes = await cloud.peopleCodes(school.id, people);
    const pending = people.filter((p) => !p.claimedBy);
    const sheet = (list) => {
      const items = list.filter((p) => codes.get(p.id)).map((p) => ({ name: p.name, code: codes.get(p.id), role: p.role }));
      if (!items.length) { toast(tx("コード待ちの人がいません")); return; }
      // 生徒と先生は、案内の中身がちがうので、役割ごとに分けて開く
      const ok = ["student", "teacher"].map((r) => {
        const part = items.filter((i) => i.role === r);
        return part.length ? openInviteSheet({ kind: r === "student" ? "orgStudent" : "orgTeacher", orgName: school.name, items: part }) : true;
      });
      if (ok.includes(false)) toast(tx("案内を開けませんでした。ポップアップを許可してください"));
    };
    const add = () => {
      const role = h("select", { class: "field-select", "aria-label": tx("役割") }, h("option", { value: "student" }, tx("生徒")), h("option", { value: "teacher" }, tx("先生")));
      const ta = h("textarea", { class: "field-input", rows: "8", placeholder: tx("名前を 1 行に 1 人ずつ（例: 田中 太郎）") });
      const d = openDialog(tx("ユーザーを追加"), h("div", null,
        h("label", { class: "field" }, h("span", { class: "field-label" }, tx("役割")), role),
        h("label", { class: "field" }, h("span", { class: "field-label" }, tx("名前")), ta),
        h("p", { class: "muted small" }, tx("1 人ごとに、専用のコードができます。コードは 1 回だけ使えます。"))), [
        button("text", tx("やめる"), null, () => d.close()),
        button("filled", tx("追加する"), "person_add", async () => {
          const names = ta.value.split(/\r\n|\r|\n/).map((x) => x.trim()).filter(Boolean);
          if (!names.length) { ta.focus(); return; }
          try { const made = await cloud.createPeople(school, role.value, names); d.close(); toast(tx("{length} 人を追加しました", { length: made.length })); refresh(); } catch (e) { fail(e); }
        })]);
      ta.focus();
    };
    const actions = (p) => {
      const d = openDialog(p.name, h("div", { class: "action-list" },
        action("edit", tx("名前を変える"), async () => {
          const input = h("input", { type: "text", class: "field-input", maxlength: "40", value: p.name });
          const dd = openDialog(tx("名前を変える"), h("div", null, input, p.claimedBy ? null : h("p", { class: "muted small" }, tx("コードも新しくなります。"))), [
            button("text", tx("やめる"), null, () => dd.close()),
            button("filled", tx("保存"), null, async () => { if (!input.value.trim()) return; try { await cloud.renamePerson(school, p, input.value); dd.close(); refresh(); } catch (e) { fail(e); } })]);
          input.focus();
        }),
        p.claimedBy ? action("link_off", tx("結びつけを外す（新しいコードで入り直す）"), async () => {
          if (!(await confirmDialog(tx("{name} さんの結びつけを外しますか？", { name: p.name }), tx("そのアカウントは、このユーザーを使えなくなります。クラスの在籍・提出は残ります。新しいコードで、別のアカウントを結びつけられます。"), tx("外す"), true))) return;
          try { const code = await cloud.releasePerson(school, p); toast(tx("外しました。新しいコード: {code}", { code })); refresh(); } catch (e) { fail(e); }
        }) : action("refresh", tx("コードを作り直す"), async () => {
          try { await cloud.reissueCode(school, p); toast(tx("作り直しました")); refresh(); } catch (e) { fail(e); }
        }),
        (p.status || "active") === "active" ? action("block", tx("停止する（使えなくする）"), async () => {
          if (!(await confirmDialog(tx("{name} さんを停止しますか？", { name: p.name }), tx("停止すると、このユーザーは SK Study を使えなくなります。提出は残り、あとで戻せます。"), tx("停止する"), true))) return;
          try { await cloud.setPersonStatus(school.id, p, "suspended"); refresh(); } catch (e) { fail(e); }
        }) : action("play_circle", tx("停止を解く"), async () => { try { await cloud.setPersonStatus(school.id, p, "active"); refresh(); } catch (e) { fail(e); } }),
        action("delete", tx("名簿から消す"), async () => {
          if (!(await confirmDialog(tx("{name} さんを名簿から消しますか？", { name: p.name }), tx("入っているクラスの在籍・担任も外れます。提出した答えは残ります。元に戻せません。"), tx("消す"), true))) return;
          try { await cloud.deletePerson(school, p); toast(tx("消しました")); refresh(); } catch (e) { fail(e); }
        }, true)), [button("text", tx("閉じる"), null, () => d.close())]);
      function action(ic, label, fn, danger = false) {
        return h("button", { type: "button", class: `action-row${danger ? " danger" : ""}`, onclick: () => { d.close(); fn(); } }, icon(ic), h("span", null, label));
      }
    };

    const table = h("div", { class: "dh-table-wrap" });
    const search = h("input", { type: "search", class: "field-input people-search", placeholder: tx("名前でさがす"), "aria-label": tx("名前でさがす"), value: query,
      oninput: (e) => { query = e.target.value; drawTable(); } });
    const chips = h("div", { class: "chips", role: "group", "aria-label": tx("役割") });
    function drawChips() {
      const n = (r) => (r === "all" ? people.length : people.filter((p) => p.role === r).length);
      chips.replaceChildren(...[["all", tx("全員")], ["student", tx("生徒")], ["teacher", tx("先生")]].map(([k, l]) => h("button", { type: "button", class: "chip", "aria-pressed": String(roleFilter === k), onclick: () => { roleFilter = k; drawChips(); drawTable(); } }, `${l} ${n(k)}`)));
    }
    function drawTable() {
      const q = query.trim().toLowerCase();
      const rows = people.filter((p) => (roleFilter === "all" || p.role === roleFilter) && (!q || String(p.name).toLowerCase().includes(q)));
      const shown = rows.slice(0, 300);
      table.replaceChildren(rows.length ? h("table", { class: "tc-table people-table" },
        h("thead", null, h("tr", null, h("th", null, tx("名前")), h("th", null, tx("役割")), h("th", null, tx("状態")), h("th", null, tx("コード")), h("th", null, ""))),
        h("tbody", null, shown.map((p) => {
          const code = codes.get(p.id);
          const suspended = (p.status || "active") === "suspended";
          return h("tr", { class: p.claimedBy && !suspended ? "" : "is-missing" },
            h("td", null, p.name),
            h("td", null, ROLE_LABEL[p.role] || p.role),
            h("td", null, suspended ? h("span", { class: "dh-pill bad" }, tx("停止中")) : p.claimedBy ? h("span", { class: "dh-pill ok" }, icon("check"), tx("参加ずみ")) : h("span", { class: "dh-pill" }, tx("コード待ち"))),
            h("td", null, code ? h("span", { class: "code-pill" }, code) : h("span", { class: "muted" }, "-")),
            h("td", { class: "tc-actions" },
              code ? button("text", tx("コピー"), "content_copy", () => copy(code)) : null,
              code ? button("text", tx("案内 PDF"), "picture_as_pdf", () => sheet([p])) : null,
              button("text", tx("操作"), "more_horiz", () => actions(p))));
        }))) : h("p", { class: "muted" }, people.length ? tx("見つかりませんでした。") : tx("まだユーザーがいません。「ユーザーを追加」で、名前をまとめて入れましょう。")),
        rows.length > shown.length ? h("p", { class: "muted small" }, tx("最初の {length} 人を表示しています。名前でさがすと絞れます。", { length: shown.length })) : null);
    }
    drawChips();
    drawTable();
    return [
      legacy.migration,
      h("section", { class: "mk-card" },
        h("div", { class: "section-head" }, h("h2", null, icon("badge"), tx("ユーザー（{length}）", { length: people.length })), h("div", { class: "section-actions" },
          button("outlined", tx("案内 PDF（コード待ちの全員）"), "picture_as_pdf", () => sheet(pending)), button("filled", tx("ユーザーを追加"), "person_add", add))),
        h("p", { class: "muted small" }, tx("学校のユーザー（生徒・先生）の名簿です。名前ごとに専用のコードを渡すと、本人がアカウントで学校に入れます。クラスは、「クラス」タブで紐づけます。")),
        h("div", { class: "people-tools" }, chips, search),
        table),
      legacy.staff
    ];
  }

  // ---------- クラス ----------
  async function classesPanel() {
    const orgClasses = await cloud.orgClasses(school.id);
    const per = await Promise.all(orgClasses.map((k) => cloud.classPeople(k.id).catch(() => ({ teachers: [], students: [] }))));
    // 担任の名前が、クラスの表示（生徒の画面の「〇〇 先生」）とずれていたら、そろえる（担任を紐づけた時期によっては、空のままのため）
    await Promise.all(orgClasses.map(async (k, i) => { const n = await cloud.syncTeacherName(k.id, per[i].teachers).catch(() => null); if (n != null) k.teacherName = n; }));
    const create = () => {
      const input = h("input", { type: "text", class: "field-input", maxlength: "60", placeholder: tx("例: 1 年 A 組 英語") });
      const d = openDialog(tx("クラスを作る"), h("div", null, h("label", { class: "field" }, h("span", { class: "field-label" }, tx("クラスの名前")), input),
        h("p", { class: "muted small" }, tx("作ったあと、担任と生徒を名簿から選んで紐づけます。"))), [
        button("text", tx("やめる"), null, () => d.close()),
        button("filled", tx("作る"), "add", async () => {
          if (!input.value.trim()) { input.focus(); return; }
          try { const cid = await cloud.createOrgClass(school, input.value); d.close(); toast(tx("作りました")); refresh(); manage({ id: cid, name: input.value.trim(), schoolId: school.id }); } catch (e) { fail(e); }
        })]);
      input.focus();
    };
    return [
      h("section", { class: "mk-card" },
        h("div", { class: "section-head" }, h("h2", null, icon("groups"), tx("クラス（{length}）", { length: orgClasses.length })), button("filled", tx("クラスを作る"), "add", create)),
        orgClasses.length ? h("div", { class: "set-list flat" }, orgClasses.map((k, i) => h("div", { class: "set-row" },
          h("span", { class: "thumb class-thumb", "aria-hidden": "true" }, icon("groups")),
          h("div", { class: "set-row-body" },
            h("button", { type: "button", class: "set-row-link row-btn", onclick: () => manage(k) },
              h("span", { class: "set-row-sub" }, h("span", null, per[i].teachers.length ? per[i].teachers.map((t) => tx("{name} 先生", { name: t.name })).join("・") : tx("担任なし"))),
              h("span", { class: "set-row-title" }, k.name)),
            h("span", { class: "set-row-meta" }, h("span", null, icon("person"), tx("生徒 {length}", { length: per[i].students.length })))),
          h("div", { class: "set-row-end" }, button("text", tx("管理"), "tune", () => manage(k)))))) :
          h("div", { class: "empty-card" }, icon("groups", "empty-icon"), h("p", null, tx("まだ、新しい仕組みのクラスがありません。クラスを作って、名簿から担任と生徒を紐づけましょう。"))),
        h("p", { class: "muted small" }, tx("配信・結果は、担任の先生の画面で扱います。"))),
      legacy.classes
    ];
  }

  // クラスの担任・生徒を、名簿から選んで紐づける
  async function manage(k) {
    const [people, cp] = await Promise.all([cloud.schoolPeople(school.id), cloud.classPeople(k.id)]);
    const body = h("div", { class: "manage" });
    const d = openDialog(k.name, body, [button("text", tx("名前を変える"), "edit", () => {
      const input = h("input", { type: "text", class: "field-input", maxlength: "60", value: k.name });
      const dd = openDialog(tx("クラスの名前"), input, [button("text", tx("やめる"), null, () => dd.close()), button("filled", tx("保存"), null, async () => {
        if (!input.value.trim()) return;
        try { await cloud.renameOrgClass(k, input.value); dd.close(); d.close(); refresh(); } catch (e) { fail(e); }
      })]);
      input.focus();
    }), button("text", tx("クラスを消す"), "delete", async () => {
      if (!(await confirmDialog(tx("「{name}」を消しますか？", { name: k.name }), tx("配信・提出・採点もすべて消えます。名簿のユーザーは残ります。元に戻せません。"), tx("消す"), true))) return;
      try { await cloud.deleteOrgClass(k); d.close(); toast(tx("消しました")); refresh(); } catch (e) { fail(e); }
    }, { "data-danger": "" }), button("filled", tx("閉じる"), null, () => { d.close(); refresh(); })]);
    d.classList.add("dialog-wide");
    let state = cp;
    const reloadState = async () => { state = await cloud.classPeople(k.id); draw(); };
    function section(role, title, list) {
      return h("section", { class: "manage-sec" },
        h("div", { class: "section-head" }, h("h3", null, `${title}（${list.length}）`), button("tonal", tx("{title}を追加", { title }), "person_add", () => pick(role))),
        list.length ? h("ul", { class: "manage-list" }, list.map((e) => h("li", null, h("span", null, e.name),
          button("text", tx("外す"), "close", async () => { try { await cloud.unenroll(k.id, school.id, e.id, role); await reloadState(); } catch (err) { fail(err); } })))) : h("p", { class: "muted small" }, role === "teacher" ? tx("担任がいません。") : tx("生徒がいません。")));
    }
    function draw() {
      body.replaceChildren(section("teacher", tx("担任"), state.teachers), section("student", tx("生徒"), state.students));
    }
    function pick(role) {
      openPicker(ui, { school, cls: k, role, people, have: new Set((role === "teacher" ? state.teachers : state.students).map((e) => e.id)), onDone: reloadState });
    }
    draw();
  }

  // ---------- 様子 ----------
  async function overviewPanel() {
    return [
      dashboardSection(ui, { classes, title: tx("クラスの様子") }),
      legacy.settings
    ];
  }

  drawBar();
  drawPanel();
  return wrap;
}

// 名簿から選んで、クラスの担任・在籍に加える（総合管理者の「クラス」タブと、担任の先生のクラス画面で使う）
//   people を渡さなければ、学校の名簿を読む。have = すでに入っている人の ID（Set）。onDone = 加えたあとに呼ぶ
export async function openPicker(ui, { school, cls, role, people = null, have = null, onDone = () => {} }) {
  const { h, button, toast, openDialog } = ui;
  const list0 = people || await cloud.schoolPeople(school.id);
  const haveSet = have || new Set(((await cloud.classPeople(cls.id))[role === "teacher" ? "teachers" : "students"]).map((e) => e.id));
  const cand = list0.filter((p) => p.role === role && !haveSet.has(p.id) && (p.status || "active") === "active");
  const chosen = new Set();
  const list = h("div", { class: "pick-list" });
  const search = h("input", { type: "search", class: "field-input", placeholder: tx("名前でさがす"), "aria-label": tx("名前でさがす") });
  const count = h("span", { class: "muted small" });
  const drawList = () => {
    const q = search.value.trim().toLowerCase();
    const rows = cand.filter((p) => !q || String(p.name).toLowerCase().includes(q));
    list.replaceChildren(...(rows.length ? rows.map((p) => h("label", { class: "pick-row" },
      h("input", { type: "checkbox", checked: chosen.has(p.id), onchange: (e) => { if (e.target.checked) chosen.add(p.id); else chosen.delete(p.id); count.textContent = tx("{size} 人を選択", { size: chosen.size }); } }),
      h("span", null, p.name), p.claimedBy ? null : h("small", { class: "muted" }, tx("コード待ち")))) : [h("p", { class: "muted small" }, cand.length ? tx("見つかりませんでした。") : tx("追加できる人がいません。学校の総合管理者に、名簿への追加をお願いしてください。"))]));
  };
  search.addEventListener("input", drawList);
  drawList();
  const dd = openDialog(role === "teacher" ? tx("担任を追加") : tx("生徒を追加"), h("div", null, search, list, count), [
    button("text", tx("やめる"), null, () => dd.close()),
    button("outlined", tx("表示中を全員選ぶ"), "select_all", () => { const q = search.value.trim().toLowerCase(); cand.filter((p) => !q || String(p.name).toLowerCase().includes(q)).forEach((p) => chosen.add(p.id)); drawList(); count.textContent = tx("{size} 人を選択", { size: chosen.size }); }),
    button("filled", tx("追加する"), "person_add", async () => {
      const picked = cand.filter((p) => chosen.has(p.id));
      if (!picked.length) { toast(tx("人を選んでください")); return; }
      try { const n = await cloud.enrollPeople({ id: cls.id, name: cls.name, schoolId: school.id }, picked, role); dd.close(); toast(tx("{n} 人を追加しました", { n })); await onDone(); } catch (e) { console.error(e); toast(cloud.explain(e)); }
    })]);
  dd.classList.add("dialog-wide");
}
