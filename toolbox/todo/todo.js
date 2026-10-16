// Todo（SK's Toolbox）— Apple のリマインダーのような ToDo
//   ・データの形・完了（繰り返し）・通知は /toolbox/shared/remind.js（window.SKReminders）。localStorage の sk_todo に保存する
//     （オンライン同期をオンにしたときだけ、暗号化して SK Hub Systems アカウントにも保存する。/toolbox/shared/sync.js）。テーマなどは共通の設定（/toolbox/shared/settings.js）
//   ・スマートリスト: 今日（期限切れもふくむ）・日時設定あり・すべて・フラグ付き・完了済み。マイリストは色とアイコンを選べる
//   ・タスク: タイトル・メモ・URL・日付・時刻・繰り返し・フラグ・優先度・リスト・サブタスク。ⓘ でくわしい情報を開く
//   ・「新規リマインダー」で、リストの最後に行を足してその場で書く（Enter で次の行）。「明日 9時 歯医者」のように書くと日時も入る
//   ・マイリストはドラッグ（または ↑↓ キー）で並べ替え。「日時設定あり」はカレンダーでも見られる。タスクから Memo のメモを作れる
//   ・せまい画面では、リストを開くと履歴（history.pushState）に積む。端末の「戻る」で一覧に戻れる
//   ・?embed のときは見本のタスクを表示だけする（保存したタスクは読まない）
(function () {
  "use strict";

  var R = window.SKReminders;
  var root = document.documentElement;
  var embed = /[?&]embed\b/.test(location.search);
  var I18N = window.SKI18N;
  var locale = (I18N && I18N.locale) || "ja-JP";
  function t(s, p) { return I18N ? I18N.t(s, p) : s.replace(/\{(\w+)\}/g, function (m, k) { return p && k in p ? p[k] : m; }); }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function icon(name, cls) { var s = el("span", "msr" + (cls ? " " + cls : ""), name); s.setAttribute("aria-hidden", "true"); return s; }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function vibrate() { if (window.SKToolbox) SKToolbox.vibrate(); }

  // ================================================================
  // データ
  // ================================================================
  var data;
  function save() {
    if (embed) return;
    try { R.save(data); }
    catch (e) { say(t("保存できませんでした。端末の空き容量を確認してください")); }
  }
  function today() { return R.ymd(new Date()); }
  function dayOffset(n) { var d = new Date(); d.setDate(d.getDate() + n); return R.ymd(d); }

  if (embed) {
    root.classList.add("is-embed");
    var now = Date.now();
    data = R.upgrade({
      lists: [{ id: "inbox", name: t("リマインダー"), color: "#2563eb", icon: "list" }, { id: "shop", name: t("買い物"), color: "#ea580c", icon: "shopping_cart" }],
      tasks: [
        { id: "a", list: "inbox", text: t("レポートを提出する"), flagged: true, priority: 3, due: today(), time: "17:00", created: now },
        { id: "b", list: "shop", text: t("牛乳を買う"), due: today(), created: now + 1 },
        { id: "c", list: "inbox", text: t("部屋の掃除"), due: today(), repeat: "weekly", created: now + 2 },
        { id: "d", list: "inbox", text: t("本を返す"), due: dayOffset(-1), created: now + 3 }
      ],
      view: "today"
    });
  } else {
    data = R.load();
  }
  function listById(id) { for (var i = 0; i < data.lists.length; i++) if (data.lists[i].id === id) return data.lists[i]; return null; }
  function taskById(id) { for (var i = 0; i < data.tasks.length; i++) if (data.tasks[i].id === id) return data.tasks[i]; return null; }
  function childrenOf(id) { return data.tasks.filter(function (x) { return x.parent === id; }); }

  var SMART = [
    { id: "today", name: t("今日"), icon: "today", color: "#2563eb" },
    { id: "scheduled", name: t("日時設定あり"), icon: "calendar_month", color: "#dc2626" },
    { id: "all", name: t("すべて"), icon: "inbox", color: "#334155" },
    { id: "flagged", name: t("フラグ付き"), icon: "flag", color: "#ea580c" },
    { id: "done", name: t("完了済み"), icon: "check", color: "#6b7280" }
  ];
  function smartById(id) { for (var i = 0; i < SMART.length; i++) if (SMART[i].id === id) return SMART[i]; return null; }
  if (!smartById(data.view) && !listById(data.view)) data.view = "today";

  // ================================================================
  // 日付の文字
  // ================================================================
  var dayFmt = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", weekday: "short" });
  var yearFmt = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric", weekday: "short" });
  var headFmt = new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "long" });
  var timeFmt = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
  function nowHm() { var d = new Date(); return (d.getHours() < 10 ? "0" : "") + d.getHours() + ":" + (d.getMinutes() < 10 ? "0" : "") + d.getMinutes(); }
  function timeText(hm) { var p = hm.split(":"); var d = new Date(); d.setHours(+p[0], +p[1], 0, 0); return timeFmt.format(d); }
  function isOver(x) { return !x.done && x.due && (x.due < today() || (x.due === today() && x.time && x.time < nowHm())); }
  function dueText(x) {
    if (!x.due) return "";
    var d = R.parseYmd(x.due), td = today();
    var day = x.due === td ? t("今日") : x.due === dayOffset(1) ? t("明日") : x.due === dayOffset(-1) ? t("昨日")
      : (d.getFullYear() === new Date().getFullYear() ? dayFmt : yearFmt).format(d);
    return x.time ? day + " " + timeText(x.time) : day;
  }
  var REPEAT_NAMES = { daily: t("毎日"), weekdays: t("平日"), weekly: t("毎週"), biweekly: t("2 週間ごと"), monthly: t("毎月"), yearly: t("毎年") };
  var PRIORITY_NAMES = [t("なし"), t("低"), t("中"), t("高")];

  // ================================================================
  // どのタスクを出すか・並べ方
  // ================================================================
  var query = "";
  function inView(view, x) {
    if (view === "search") return (x.text + "\n" + x.notes).toLowerCase().indexOf(query.toLowerCase()) >= 0;
    if (view === "today") return !x.done && !!x.due && x.due <= today();
    if (view === "scheduled") return !x.done && !!x.due;
    if (view === "all") return !x.done;
    if (view === "flagged") return !x.done && x.flagged;
    if (view === "done") return x.done;
    return x.list === view && (!x.done || !!data.showDone[view]);
  }
  function byDue(a, b) {
    if ((a.due || "") !== (b.due || "")) { if (!a.due) return 1; if (!b.due) return -1; return a.due < b.due ? -1 : 1; }
    if ((a.time || "") !== (b.time || "")) { if (!a.time) return -1; if (!b.time) return 1; return a.time < b.time ? -1 : 1; }
    return a.created - b.created;
  }
  function sorter(view) {
    if (view === "done") return function (a, b) { return (b.doneAt || 0) - (a.doneAt || 0); };
    if (view === "today" || view === "scheduled") return byDue;
    var how = listById(view) ? data.sort[view] || "manual" : "manual";
    return function (a, b) {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (how === "due") return byDue(a, b);
      if (how === "priority") return (b.priority - a.priority) || byDue(a, b);
      if (how === "title") return a.text.localeCompare(b.text, locale);
      return manualKey(a) - manualKey(b);
    };
  }
  // ドラッグで並べた順（なければ追加した順）
  function manualKey(x) { return x.order !== null && x.order !== undefined ? x.order : x.created; }
  // 親のすぐ下にサブタスクを並べる
  function arrange(tasks) {
    var inSet = {};
    tasks.forEach(function (x) { inSet[x.id] = 1; });
    var out = [];
    tasks.forEach(function (x) {
      if (x.parent && inSet[x.parent]) return;
      out.push(x);
      tasks.filter(function (c) { return c.parent === x.id; }).sort(function (a, b) { return a.created - b.created; }).forEach(function (c) { out.push(c); });
    });
    return out;
  }
  // 見出しごとに分ける: [{ label, cls, color, tasks }]
  function groups(view, tasks) {
    var td = today(), tm = dayOffset(1);
    if (view === "today") {
      var over = tasks.filter(function (x) { return x.due < td; }), now = tasks.filter(function (x) { return x.due === td; });
      return over.length ? [{ label: t("期限切れ"), cls: "is-over", tasks: over }, { label: t("今日"), tasks: now }] : [{ tasks: now }];
    }
    if (view === "scheduled") {
      var g = {}, order = [];
      tasks.forEach(function (x) {
        var key = x.due < td ? "over" : x.due;
        if (!g[key]) { g[key] = []; order.push(key); }
        g[key].push(x);
      });
      order.sort(function (a, b) { return a === "over" ? -1 : b === "over" ? 1 : a < b ? -1 : 1; });
      return order.map(function (k) {
        var label = k === "over" ? t("期限切れ") : k === td ? t("今日") : k === tm ? t("明日") : headFmt.format(R.parseYmd(k));
        return { label: label, cls: k === "over" ? "is-over" : "", tasks: g[k] };
      });
    }
    if (view === "all" || view === "search") {
      return data.lists.map(function (l) {
        return { label: l.name, color: l.color, tasks: tasks.filter(function (x) { return x.list === l.id; }) };
      }).filter(function (gr) { return gr.tasks.length; });
    }
    if (listById(view)) {
      var open = tasks.filter(function (x) { return !x.done; }), done = tasks.filter(function (x) { return x.done; });
      return done.length ? [{ tasks: open }, { label: t("完了済み"), tasks: done }] : [{ tasks: open }];
    }
    return [{ tasks: tasks }];
  }
  function viewColor(view) {
    if (view === "search") return "var(--md-primary)";
    var s = smartById(view);
    if (s) return s.color;
    var l = listById(view);
    return l ? l.color : "var(--md-primary)";
  }
  function viewName(view) {
    if (view === "search") return t("「{q}」の検索結果", { q: query });
    var s = smartById(view);
    if (s) return s.name;
    var l = listById(view);
    return l ? l.name : "";
  }

  // ================================================================
  // 表示: リストの一覧
  // ================================================================
  var app = $("app");
  var narrow = window.matchMedia("(max-width: 760px)");
  function countOf(view) { return data.tasks.filter(function (x) { return view === "done" ? x.done : inView(view, x); }).length; }

  function renderSide() {
    var smart = $("smart");
    smart.textContent = "";
    SMART.forEach(function (s) {
      var b = el("button", "smart-card m3-state");
      b.type = "button";
      b.dataset.view = s.id;
      b.style.setProperty("--c", s.color);
      if (data.view === s.id && !query) b.setAttribute("aria-current", "true");
      var ic = el("span", "smart-card__icon");
      ic.appendChild(icon(s.icon));
      b.append(ic, el("span", "smart-card__count", String(countOf(s.id))), el("span", "smart-card__name", s.name));
      smart.appendChild(b);
    });
    var lists = $("lists");
    lists.textContent = "";
    data.lists.forEach(function (l) {
      var b = el("button", "list-item m3-state");
      b.type = "button";
      b.dataset.view = l.id;
      b.style.setProperty("--c", l.color);
      if (data.view === l.id && !query) b.setAttribute("aria-current", "true");
      var ic = el("span", "list-item__icon");
      ic.appendChild(icon(l.icon));
      b.append(ic, el("span", "list-item__name", l.name), el("span", "list-item__count", String(data.tasks.filter(function (x) { return x.list === l.id && !x.done; }).length)));
      lists.appendChild(b);
    });
  }

  // ================================================================
  // 表示: 選んだリスト
  // ================================================================
  var tasksEl = $("tasks"), mainEl = $("main");
  var lastAdded = null;
  function currentView() { return query ? "search" : data.view; }

  function taskEl(x, view) {
    var list = listById(x.list) || data.lists[0];
    var row = el("div", "task" + (x.done ? " is-done" : "") + (x.parent ? " is-sub" : "") + (x.id === lastAdded ? " is-new" : ""));
    row.dataset.id = x.id;
    row.style.setProperty("--tc", list.color);
    var circle = el("button", "circle m3-state");
    circle.type = "button";
    circle.dataset.act = "done";
    circle.setAttribute("role", "checkbox");
    circle.setAttribute("aria-checked", String(x.done));
    circle.setAttribute("aria-label", x.done ? t("未完了に戻す") : t("完了にする"));
    var body = el("div", "task__body");
    var title = el("div", "task__title");
    if (x.priority) title.appendChild(el("span", "task__prio", new Array(x.priority + 1).join("!")));
    var text = el("span", "task__text", x.text);
    text.dataset.act = "edit";
    text.dataset.empty = t("新規リマインダー");
    title.appendChild(text);
    body.appendChild(title);
    if (x.notes) body.appendChild(el("div", "task__notes", x.notes));
    var meta = el("div", "task__meta");
    if (x.due) {
      var d = el("span", isOver(x) ? "is-over" : "");
      d.appendChild(icon(x.time ? "schedule" : "event"));
      d.appendChild(document.createTextNode(" " + dueText(x)));
      meta.appendChild(d);
    }
    if (x.repeat) { var r = el("span"); r.appendChild(icon("repeat")); r.appendChild(document.createTextNode(" " + REPEAT_NAMES[x.repeat])); meta.appendChild(r); }
    var kids = childrenOf(x.id);
    if (kids.length) {
      var k = el("span");
      k.appendChild(icon("subdirectory_arrow_right"));
      k.appendChild(document.createTextNode(" " + t("サブタスク {done}/{all}", { done: kids.filter(function (c) { return c.done; }).length, all: kids.length })));
      meta.appendChild(k);
    }
    if (x.memo) {
      var ml = el("a", "task__memo");
      ml.href = "/toolbox/memo/#" + encodeURIComponent(x.memo);
      ml.appendChild(icon("sticky_note_2"));
      ml.appendChild(document.createTextNode(" " + t("メモ")));
      meta.appendChild(ml);
    }
    if (x.url) {
      var a = el("a", "", x.url.replace(/^https?:\/\//, ""));
      a.href = x.url;
      a.target = "_blank";
      a.rel = "noopener";
      meta.appendChild(a);
    }
    if (!listById(view)) {
      var ln = el("span", "task__listname");
      ln.appendChild(el("i"));
      ln.appendChild(document.createTextNode(list.name));
      meta.appendChild(ln);
    }
    if (meta.childNodes.length) body.appendChild(meta);
    // ドラッグで並べ替え（マイリストで「追加した順」のとき）
    if (listById(view) && (data.sort[view] || "manual") === "manual" && !x.done && !x.parent) {
      var drag = el("button", "icon-btn drag");
      drag.type = "button";
      drag.setAttribute("aria-label", t("並べ替え（ドラッグ、または ↑↓ キー）") + ": " + x.text);
      drag.title = t("ドラッグで並べ替え");
      drag.appendChild(icon("drag_indicator"));
      row.appendChild(drag);
    }
    row.insertBefore(body, row.firstChild);
    row.insertBefore(circle, body);
    if (x.flagged) row.appendChild(icon("flag", "task__flag"));
    var info = el("button", "icon-btn info m3-state");
    info.type = "button";
    info.dataset.act = "info";
    info.setAttribute("aria-label", t("くわしい情報"));
    info.title = t("くわしい情報");
    info.appendChild(icon("info"));
    row.appendChild(info);
    return row;
  }

  function renderMain() {
    var view = currentView();
    mainEl.style.setProperty("--c", viewColor(view));
    $("title").textContent = viewName(view);
    var tasks = data.tasks.filter(function (x) { return inView(view, x); }).sort(sorter(view));
    var openCount = tasks.filter(function (x) { return view === "done" ? x.done : !x.done; }).length;
    $("count").textContent = openCount ? String(openCount) : "";
    tasksEl.textContent = "";
    var calOn = view === "scheduled" && data.calView;
    $("btn-cal").hidden = view !== "scheduled";
    $("btn-cal").setAttribute("aria-pressed", String(!!calOn));
    $("btn-cal").querySelector(".msr").textContent = calOn ? "view_list" : "calendar_month";
    if (calOn) renderCalendar(tasks);
    else groups(view, arrange(tasks)).forEach(function (g) {
      if (g.label) {
        var h = el("h3", "group" + (g.cls ? " " + g.cls : ""), g.label);
        if (g.color) h.style.setProperty("--gc", g.color);
        tasksEl.appendChild(h);
      }
      arrange(g.tasks).forEach(function (x) { tasksEl.appendChild(taskEl(x, view)); });
    });
    lastAdded = null;

    // 完了済みの数と「表示・非表示」（マイリストだけ）
    var bar = $("done-bar");
    var list = listById(view);
    if (list) {
      var doneN = data.tasks.filter(function (x) { return x.list === view && x.done; }).length;
      bar.hidden = !doneN;
      bar.textContent = "";
      if (doneN) {
        bar.appendChild(el("span", "", t("完了済み {n} 件", { n: doneN })));
        var toggle = el("button", "text-btn m3-state", data.showDone[view] ? t("非表示") : t("表示"));
        toggle.type = "button";
        toggle.dataset.lmenu = "toggle-done";
        var clear = el("button", "text-btn m3-state", t("消去"));
        clear.type = "button";
        clear.dataset.lmenu = "clear-done";
        bar.append(toggle, clear);
      }
    } else bar.hidden = true;

    var empty = $("empty");
    empty.hidden = tasks.length > 0;
    $("empty-icon").textContent = view === "search" ? "search_off" : "task_alt";
    $("empty-text").textContent = view === "search" ? t("見つかりませんでした。")
      : view === "done" ? t("完了したリマインダーはありません。")
      : view === "flagged" ? t("フラグ付きのリマインダーはありません。")
      : view === "today" || view === "scheduled" ? t("予定のあるリマインダーはありません。")
      : t("リマインダーはありません。");
    $("btn-new").hidden = view === "done" || view === "search";
    Array.prototype.forEach.call(document.querySelectorAll("[data-user-list]"), function (b) { b.hidden = !list || view === "search"; });
    $("toggle-done-label").textContent = list && data.showDone[view] ? t("完了済みを非表示") : t("完了済みを表示");
    $("toggle-done-icon").textContent = list && data.showDone[view] ? "visibility_off" : "visibility";
  }

  function render() {
    if (!smartById(data.view) && !listById(data.view)) data.view = "today";
    renderSide();
    renderMain();
  }

  // ================================================================
  // カレンダー（「日時設定あり」で、リストとカレンダーを切りかえ）
  // ================================================================
  var calMonth = null, calDay = null;
  var wdFmt = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  var monthFmt = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" });
  function renderCalendar(tasks) {
    var now = new Date();
    if (!calMonth) { calMonth = new Date(now.getFullYear(), now.getMonth(), 1); calDay = today(); }
    var byDate = {};
    tasks.forEach(function (x) { if (x.due) (byDate[x.due] = byDate[x.due] || []).push(x); });
    var box = el("div", "cal");
    var head = el("div", "cal__head");
    function navBtn(dir, ic, label) { var b = el("button", "icon-btn m3-state"); b.type = "button"; b.dataset.cal = dir; b.setAttribute("aria-label", label); b.appendChild(icon(ic)); return b; }
    var todayBtn = el("button", "text-btn m3-state", t("今日"));
    todayBtn.type = "button";
    todayBtn.dataset.cal = "today";
    head.append(navBtn("prev", "chevron_left", t("前の月")), el("h3", "cal__title", monthFmt.format(calMonth)), navBtn("next", "chevron_right", t("次の月")), todayBtn);
    var grid = el("div", "cal__grid");
    grid.setAttribute("role", "grid");
    for (var w = 0; w < 7; w++) grid.appendChild(el("span", "cal__wd" + (w === 0 ? " is-sun" : w === 6 ? " is-sat" : ""), wdFmt.format(new Date(2024, 0, 7 + w))));
    var start = new Date(calMonth.getFullYear(), calMonth.getMonth(), 1 - calMonth.getDay());
    var td = today();
    for (var i = 0; i < 42; i++) {
      var d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i), key = R.ymd(d), list = byDate[key] || [];
      var b = el("button", "cal__day m3-state" + (d.getMonth() !== calMonth.getMonth() ? " is-other" : "") + (key === td ? " is-today" : "") + (key < td ? " is-past" : ""));
      b.type = "button";
      b.dataset.cal = "day:" + key;
      b.setAttribute("aria-pressed", String(key === calDay));
      b.setAttribute("aria-label", new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "short" }).format(d) + (list.length ? " " + t("{n} 件", { n: list.length }) : ""));
      b.appendChild(el("span", "cal__num", String(d.getDate())));
      var dots = el("span", "cal__dots");
      list.slice(0, 3).forEach(function (x) { var dot = el("i"); dot.style.background = (listById(x.list) || data.lists[0]).color; dots.appendChild(dot); });
      if (list.length > 3) dots.appendChild(el("small", "", "+" + (list.length - 3)));
      b.appendChild(dots);
      grid.appendChild(b);
    }
    box.append(head, grid);
    tasksEl.appendChild(box);
    var dayTasks = arrange(byDate[calDay] || []);
    tasksEl.appendChild(el("h3", "group" + (calDay < td ? " is-over" : ""), new Intl.DateTimeFormat(locale, { month: "long", day: "numeric", weekday: "long" }).format(R.parseYmd(calDay))));
    if (!dayTasks.length) tasksEl.appendChild(el("p", "cal__empty", t("この日のリマインダーはありません。")));
    dayTasks.forEach(function (x) { tasksEl.appendChild(taskEl(x, "scheduled")); });
  }
  tasksEl.addEventListener("click", function (e) {
    var b = e.target.closest("[data-cal]");
    if (!b) return;
    var v = b.dataset.cal;
    if (v === "prev") calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1);
    else if (v === "next") calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1);
    else if (v === "today") { var n = new Date(); calMonth = new Date(n.getFullYear(), n.getMonth(), 1); calDay = today(); }
    else if (/^day:/.test(v)) {
      calDay = v.slice(4);
      var d = R.parseYmd(calDay);
      if (d.getMonth() !== calMonth.getMonth()) calMonth = new Date(d.getFullYear(), d.getMonth(), 1);
    }
    renderMain();
    var again = tasksEl.querySelector('[data-cal="' + v + '"]') || tasksEl.querySelector('[data-cal="day:' + calDay + '"]');
    if (again) again.focus();
  });

  // ================================================================
  // ドラッグで並べ替え（マイリストの「追加した順」。キーボードは ↑↓）
  // ================================================================
  function reorder(ids) {
    ids.forEach(function (id, i) { var x = taskById(id); if (x) { x.order = i; x.updated = Date.now(); } });
    save();
    render();
  }
  function topRows() { return Array.prototype.slice.call(tasksEl.querySelectorAll(".task:not(.is-sub):not(.is-done)")); }
  tasksEl.addEventListener("pointerdown", function (e) {
    var h = e.target.closest(".drag");
    if (!h || e.button > 0) return;
    e.preventDefault();
    var row = h.closest(".task"), id = row.dataset.id;
    var rows = topRows().filter(function (r) { return r !== row; });
    var startY = e.clientY, target = null;
    var line = el("div", "drop-line");
    tasksEl.appendChild(line);
    row.classList.add("is-dragging");
    try { h.setPointerCapture(e.pointerId); } catch (err) { /* 古いブラウザ */ }
    if (window.SKToolbox) SKToolbox.vibrate();
    function move(ev) {
      row.style.transform = "translateY(" + (ev.clientY - startY) + "px)";
      var idx = rows.length;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) { idx = i; break; }
      }
      target = idx;
      var ref = rows[idx], lastRow = rows[rows.length - 1];
      line.style.top = (ref ? ref.offsetTop : lastRow ? lastRow.offsetTop + lastRow.offsetHeight : 0) - 1 + "px";
      line.classList.add("is-on");
    }
    function up() {
      h.removeEventListener("pointermove", move);
      h.removeEventListener("pointerup", up);
      h.removeEventListener("pointercancel", up);
      row.classList.remove("is-dragging");
      row.style.transform = "";
      line.remove();
      if (target === null) return;
      var ids = rows.map(function (r) { return r.dataset.id; });
      ids.splice(target, 0, id);
      reorder(ids);
    }
    h.addEventListener("pointermove", move);
    h.addEventListener("pointerup", up);
    h.addEventListener("pointercancel", up);
  });
  tasksEl.addEventListener("keydown", function (e) {
    var h = e.target.closest(".drag");
    if (!h || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    var ids = topRows().map(function (r) { return r.dataset.id; });
    var id = h.closest(".task").dataset.id, i = ids.indexOf(id), j = i + (e.key === "ArrowUp" ? -1 : 1);
    if (j < 0 || j >= ids.length) return;
    ids.splice(i, 1);
    ids.splice(j, 0, id);
    reorder(ids);
    var again = tasksEl.querySelector('.task[data-id="' + id + '"] .drag');
    if (again) again.focus();
  });

  // ================================================================
  // 開く・戻る（せまい画面）
  // ================================================================
  function openView(view, push) {
    data.view = view;
    query = "";
    $("search").value = "";
    save();
    render();
    if (narrow.matches && !embed) {
      app.classList.add("is-list");
      if (push) history.pushState({ todo: view }, "");
    }
    $("scroll").scrollTop = 0;
    // 動き: リストを切りかえたら、見出しとタスクが浮かび上がる
    if (window.M3) { M3.enter(document.querySelector(".main__head")); M3.stagger(tasksEl); }
  }
  function back() {
    if (history.state && history.state.todo) history.back();
    else app.classList.remove("is-list");
  }
  window.addEventListener("popstate", function (e) {
    if (document.querySelector(".tbs-overlay")) return;
    if (e.state && e.state.todo) { app.classList.add("is-list"); return; }
    app.classList.remove("is-list");
    if (query) { query = ""; $("search").value = ""; render(); }
  });

  // ================================================================
  // スナックバー（「元に戻す」つき）
  // ================================================================
  var toast = $("toast"), toastText = $("toast-text"), toastAction = $("toast-action"), toastTimer, toastUndo = null;
  function say(text, undo) {
    toastText.textContent = text;
    toastUndo = undo || null;
    toastAction.hidden = !undo;
    toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove("is-on"); toastUndo = null; }, undo ? 6000 : 2600);
  }
  toastAction.addEventListener("click", function () {
    if (toastUndo) toastUndo();
    toastUndo = null;
    toast.classList.remove("is-on");
  });

  // ================================================================
  // テーマ（ブラウザの上の帯の色）
  // ================================================================
  var themeColor = $("theme-color");
  function applyTheme() {
    if (themeColor) themeColor.content = getComputedStyle(root).getPropertyValue(narrow.matches ? "--md-surface-container-low" : "--md-surface-container").trim() || "#eeefe3";
  }
  if (window.SKToolbox) SKToolbox.onChange(applyTheme); else applyTheme();

  render();
  // 動き: 開いたときにスマートリストとリストが浮かび上がる
  if (window.M3) { M3.stagger($("smart")); M3.stagger($("lists")); M3.stagger(tasksEl); M3.enter(document.querySelector(".main__head")); }
  if (embed) return;
  if (narrow.matches && history.state && history.state.todo) app.classList.add("is-list");

  // ================================================================
  // タスクの操作
  // ================================================================
  function snapshot(list) { return list.map(function (x) { return JSON.parse(JSON.stringify(x)); }); }
  function restoreSnapshot(snap) {
    snap.forEach(function (s) {
      var x = taskById(s.id);
      if (x) Object.assign(x, s); else data.tasks.push(s);
    });
    save();
    render();
  }

  function toggleDone(x, row) {
    vibrate();
    if (x.done) {
      x.done = false;
      x.doneAt = null;
      x.updated = Date.now();
      save();
      render();
      return;
    }
    var before = snapshot([x].concat(childrenOf(x.id)));
    var res = R.complete(x, data);
    save();
    if (res.next) {
      render();
      say(t("繰り返し: 次は {date}", { date: dueText(x) }), function () { restoreSnapshot(before); });
      return;
    }
    var circle = row && row.querySelector(".circle");
    if (circle) circle.setAttribute("aria-checked", "true");
    if (row) row.classList.add("is-done", "is-checking");
    var view = currentView();
    if (row && !inView(view, x)) row.classList.add("is-leaving");
    setTimeout(render, 380);
    say(t("完了しました"), function () { restoreSnapshot(before); });
  }

  function removeTask(x) {
    var removed = snapshot([x].concat(childrenOf(x.id)));
    var ids = removed.map(function (s) { return s.id; });
    data.tasks = data.tasks.filter(function (y) { return ids.indexOf(y.id) < 0; });
    save();
    render();
    say(t("リマインダーを削除しました"), function () { restoreSnapshot(removed); });
  }

  tasksEl.addEventListener("click", function (e) {
    if (e.target.closest("a")) return;
    var actEl = e.target.closest("[data-act]");
    var row = e.target.closest(".task");
    if (!actEl || !row || !row.dataset.id) return;
    var x = taskById(row.dataset.id);
    if (!x) return;
    var act = actEl.dataset.act;
    if (act === "done") toggleDone(x, row);
    else if (act === "info") openDetail(x);
    else if (act === "edit") startEdit(row, x);
  });

  // その場で直す
  function startEdit(row, x) {
    var text = row.querySelector(".task__text");
    if (!text || row.querySelector(".task__edit")) return;
    var input = el("input", "task__edit");
    input.type = "text";
    input.value = x.text;
    input.maxLength = 300;
    input.setAttribute("aria-label", t("タイトル"));
    text.replaceWith(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    var finished = false;
    function finish(commit) {
      if (finished) return;
      finished = true;
      var v = input.value.trim();
      if (commit && !v) { removeTask(x); return; }
      if (commit && v !== x.text) { x.text = v; x.updated = Date.now(); save(); }
      render();
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); finish(true); }
      else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    });
    input.addEventListener("blur", function () { finish(true); });
  }

  // 新規リマインダー: リストの最後に行を足して、その場で書く
  function defaultsFor(view) {
    var list = listById(view) ? view : data.lists[0].id;
    var due = view === "scheduled" && data.calView && calDay ? calDay : view === "today" || view === "scheduled" ? today() : null;
    return { list: list, due: due, flagged: view === "flagged" };
  }
  function addNewRow() {
    var view = currentView();
    if (view === "done" || view === "search") return;
    if (tasksEl.querySelector(".task--new")) { tasksEl.querySelector(".task--new input").focus(); return; }
    var def = defaultsFor(view);
    var list = listById(def.list);
    var row = el("div", "task task--new");
    row.style.setProperty("--tc", list.color);
    var circle = el("span", "circle");
    var body = el("div", "task__body");
    var input = el("input", "task__edit");
    input.type = "text";
    input.maxLength = 300;
    input.placeholder = t("新規リマインダー");
    input.setAttribute("aria-label", t("新規リマインダー"));
    var hint = el("div", "task__hint");
    hint.hidden = true;
    body.append(input, hint);
    // 入れている途中で、見つけた日付などを見せる
    input.addEventListener("input", function () {
      var q = R.parseQuick(input.value);
      hint.hidden = !q.found.length;
      hint.textContent = "";
      if (!q.found.length) return;
      var probe = { due: q.due, time: q.time, done: false };
      var parts = [];
      if (q.due) parts.push(dueText(probe));
      if (q.repeat) parts.push(REPEAT_NAMES[q.repeat]);
      if (q.priority) parts.push(t("優先度") + " " + PRIORITY_NAMES[q.priority]);
      hint.append(icon("auto_awesome"), document.createTextNode(" " + parts.join(" · ")));
    });
    row.append(circle, body);
    $("empty").hidden = true;
    tasksEl.appendChild(row);
    input.focus();
    row.scrollIntoView({ block: "nearest" });
    var done = false;
    function commit(next) {
      var v = input.value.trim();
      if (!v) { if (!next) { done = true; row.remove(); render(); } return; }
      var now = Date.now();
      // 「明日 9時 歯医者」などから、日付・時刻・繰り返し・優先度を取り出す
      var q = R.parseQuick(v);
      var x = R.upgradeTask({ id: newId(), list: def.list, text: q.text, due: q.due || def.due, time: q.time, repeat: q.repeat, priority: q.priority, flagged: def.flagged, created: now, updated: now }, data.lists);
      data.tasks.push(x);
      lastAdded = x.id;
      save();
      done = true;
      render();
      if (next) addNewRow();
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); commit(true); }
      else if (e.key === "Escape") { e.preventDefault(); input.value = ""; done = true; row.remove(); render(); }
    });
    input.addEventListener("blur", function () { if (!done) commit(false); });
  }
  $("btn-new").addEventListener("click", addNewRow);

  // ================================================================
  // くわしい情報（ダイアログ）
  // ================================================================
  function field(labelText, control) {
    var w = el("label", "m3-field");
    w.appendChild(el("span", "m3-field__label", labelText));
    w.appendChild(control);
    return w;
  }
  function row(iconName, color, labelText, control, sub) {
    var r = el("label", "detail__row");
    var ic = icon(iconName);
    r.style.setProperty("--rc", color);
    r.appendChild(ic);
    var lab = el("span", "detail__label", labelText);
    if (sub) lab.appendChild(el("small", "", sub));
    r.appendChild(lab);
    if (control) r.appendChild(control);
    return r;
  }
  function switchEl(on) { var s = el("input", "tbs-switch"); s.type = "checkbox"; s.setAttribute("role", "switch"); s.checked = !!on; return s; }
  function selectEl(options, value) {
    var s = el("select");
    options.forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; if (o[0] === value) op.selected = true; s.appendChild(op); });
    return s;
  }

  // タスクの名前で Memo にメモを作る（sk_memo に足す。Memo を開くと、いまの形に直る）
  function createMemo(x) {
    var d = {};
    try { d = JSON.parse(localStorage.getItem("sk_memo") || "{}") || {}; } catch (e) { /* 新しく作る */ }
    if (!Array.isArray(d.notes)) d.notes = [];
    var id = newId(), now = Date.now();
    var safe = String(x.text).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
    d.notes.push({ id: id, html: "<div>" + safe + "</div><div><br></div>", text: x.text, folder: "notes", pinned: false, created: now, updated: now });
    d.version = 2;
    try { localStorage.setItem("sk_memo", JSON.stringify(d)); } catch (e) { say(t("保存できませんでした")); return null; }
    return id;
  }

  // タスクを LINE・KakaoTalk の友だち・グループにカードで送る（window.SKMsg。/toolbox/shared/line.js・kakao.js。宿題や持ち物の共有に）
  function shareTask(x) {
    var list = listById(x.list), when = x.due ? dueText(x) : "";
    var url = "https://sk-hub.jp/toolbox/todo/";
    SKMsg.share(SKMsg.card({
      alt: x.text, kicker: "Todo" + (list ? " · " + list.name : ""), title: x.text,
      sub: [when ? t("期限 {due}", { due: when }) : "", x.notes || ""].filter(Boolean).join("\n"), color: list ? list.color : "#16a34a", url: url, button: t("Todo を開く")
    }), x.text + (when ? "（" + t("期限 {due}", { due: when }) + "）" : "") + (x.notes ? "\n" + x.notes : "")).then(function (r) { if (r === "sent") say(SKMsg.sentLabel()); });
  }
  function openDetail(x) {
    var body = el("div", "detail__body");
    function changed() { x.updated = Date.now(); save(); render(); }

    var titleIn = el("input", "m3-field__input");
    titleIn.value = x.text;
    titleIn.maxLength = 300;
    var notesIn = el("textarea");
    notesIn.value = x.notes;
    notesIn.rows = 3;
    notesIn.maxLength = 4000;
    var urlIn = el("input", "m3-field__input");
    urlIn.type = "url";
    urlIn.placeholder = "https://";
    urlIn.value = x.url;
    titleIn.addEventListener("input", function () { if (titleIn.value.trim()) { x.text = titleIn.value.trim(); changed(); } });
    notesIn.addEventListener("input", function () { x.notes = notesIn.value; changed(); });
    urlIn.addEventListener("change", function () {
      var v = urlIn.value.trim();
      if (v && !/^https?:\/\//i.test(v)) v = "https://" + v;
      x.url = /^https?:\/\/\S+$/i.test(v) ? v : "";
      urlIn.value = x.url;
      changed();
    });
    body.appendChild(field(t("タイトル"), titleIn));
    body.appendChild(field(t("メモ"), notesIn));
    body.appendChild(field(t("URL"), urlIn));
    // Memo のメモ（開く・作る）
    var memoRow = el("div", "detail__memo");
    if (x.memo) {
      var mo = el("a", "m3-btn m3-btn--tonal m3-state");
      mo.href = "/toolbox/memo/#" + encodeURIComponent(x.memo);
      mo.append(icon("sticky_note_2"), el("span", "", t("メモを開く")));
      memoRow.appendChild(mo);
    } else {
      var mc = el("button", "m3-btn m3-btn--tonal m3-state");
      mc.type = "button";
      mc.append(icon("note_add"), el("span", "", t("このタスクのメモを作る")));
      mc.addEventListener("click", function () {
        var id = createMemo(x);
        if (!id) return;
        x.memo = id;
        changed();
        location.href = "/toolbox/memo/#" + id;
      });
      memoRow.appendChild(mc);
    }
    body.appendChild(memoRow);

    // 日時
    var when = el("div", "detail__group");
    var dateSw = switchEl(!!x.due), timeSw = switchEl(!!x.time);
    var dateIn = el("input"); dateIn.type = "date"; dateIn.value = x.due || today();
    var timeIn = el("input"); timeIn.type = "time"; timeIn.value = x.time || "09:00";
    var repeatSel = selectEl([["", t("しない")], ["daily", REPEAT_NAMES.daily], ["weekdays", REPEAT_NAMES.weekdays], ["weekly", REPEAT_NAMES.weekly], ["biweekly", REPEAT_NAMES.biweekly], ["monthly", REPEAT_NAMES.monthly], ["yearly", REPEAT_NAMES.yearly]], x.repeat || "");
    var dateRow = row("calendar_month", "#dc2626", t("日付"), dateSw);
    var dateValRow = row("event", "#dc2626", t("日付を選ぶ"), dateIn);
    var timeRow = row("schedule", "#2563eb", t("時刻"), timeSw);
    var timeValRow = row("alarm", "#2563eb", t("時刻を選ぶ"), timeIn);
    var repeatRow = row("repeat", "#6b7280", t("繰り返し"), repeatSel);
    var hint = el("p", "detail__hint");
    when.append(dateRow, dateValRow, timeRow, timeValRow, repeatRow, hint);
    function syncWhen() {
      dateValRow.hidden = !x.due;
      timeValRow.hidden = !x.time;
      repeatRow.hidden = !x.due;
      hint.hidden = !x.time;
      hint.textContent = "";
      if (x.time) {
        var perm = window.Notification ? Notification.permission : "unsupported";
        hint.appendChild(document.createTextNode(perm === "granted" ? t("この時刻に通知します（Toolbox のページを開いているあいだ）。")
          : perm === "denied" ? t("通知はブラウザの設定で止められています。")
          : perm === "unsupported" ? t("このブラウザは通知に対応していません。")
          : t("通知をオンにすると、この時刻にお知らせします（Toolbox のページを開いているあいだ）。")));
        if (perm === "default") {
          var b = el("button", "text-btn m3-state", t("通知をオンにする"));
          b.type = "button";
          b.addEventListener("click", function () { askNotify().then(syncWhen); });
          hint.appendChild(el("br"));
          hint.appendChild(b);
        }
      }
    }
    dateSw.addEventListener("change", function () {
      if (dateSw.checked) x.due = dateIn.value || today();
      else { x.due = null; x.time = null; x.repeat = null; timeSw.checked = false; repeatSel.value = ""; }
      syncWhen(); changed();
    });
    timeSw.addEventListener("change", function () {
      if (timeSw.checked) { if (!x.due) { x.due = dateIn.value || today(); dateSw.checked = true; } x.time = timeIn.value || "09:00"; }
      else x.time = null;
      syncWhen(); changed();
    });
    dateIn.addEventListener("change", function () { if (dateIn.value) { x.due = dateIn.value; changed(); } });
    timeIn.addEventListener("change", function () { if (timeIn.value) { x.time = timeIn.value; changed(); } });
    repeatSel.addEventListener("change", function () { x.repeat = repeatSel.value || null; changed(); });
    syncWhen();
    body.appendChild(when);

    // フラグ・優先度・リスト
    var more = el("div", "detail__group");
    var flagSw = switchEl(x.flagged);
    flagSw.addEventListener("change", function () { x.flagged = flagSw.checked; changed(); });
    more.appendChild(row("flag", "#ea580c", t("フラグ"), flagSw));
    var prio = el("div", "tbs-seg");
    prio.setAttribute("role", "radiogroup");
    prio.setAttribute("aria-label", t("優先度"));
    PRIORITY_NAMES.forEach(function (name, i) {
      var b = el("button", "tbs-seg__btn m3-state", name);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(x.priority === i));
      b.addEventListener("click", function () {
        x.priority = i;
        Array.prototype.forEach.call(prio.children, function (c, j) { c.setAttribute("aria-checked", String(j === i)); });
        changed();
      });
      prio.appendChild(b);
    });
    var prioRow = el("div", "detail__row");
    prioRow.style.setProperty("--rc", "#7c3aed");
    prioRow.append(icon("priority_high"), el("span", "detail__label", t("優先度")));
    var prioWrap = el("div", "detail__row");
    prioWrap.appendChild(prio);
    more.append(prioRow, prioWrap);
    if (!x.parent) {
      var listSel = selectEl(data.lists.map(function (l) { return [l.id, l.name]; }), x.list);
      listSel.addEventListener("change", function () {
        x.list = listSel.value;
        childrenOf(x.id).forEach(function (c) { c.list = x.list; c.updated = Date.now(); });
        changed();
      });
      more.appendChild(row("list", (listById(x.list) || data.lists[0]).color, t("リスト"), listSel));
    }
    body.appendChild(more);

    // サブタスク
    if (!x.parent) {
      var subs = el("div", "detail__group");
      var drawSubs = function () {
        subs.textContent = "";
        var head = el("div", "detail__row");
        head.style.setProperty("--rc", "#0891b2");
        head.append(icon("subdirectory_arrow_right"), el("span", "detail__label", t("サブタスク")));
        subs.appendChild(head);
        childrenOf(x.id).sort(function (a, b) { return a.created - b.created; }).forEach(function (c) {
          var r = el("div", "detail__row detail__row--sub");
          r.style.setProperty("--tc", (listById(x.list) || data.lists[0]).color);
          var cb = el("button", "circle m3-state");
          cb.type = "button";
          cb.setAttribute("role", "checkbox");
          cb.setAttribute("aria-checked", String(c.done));
          cb.setAttribute("aria-label", t("完了にする"));
          cb.addEventListener("click", function () {
            vibrate();
            if (c.done) { c.done = false; c.doneAt = null; c.updated = Date.now(); } else R.complete(c, data);
            changed(); drawSubs();
          });
          var input = el("input");
          input.type = "text";
          input.value = c.text;
          input.maxLength = 300;
          input.setAttribute("aria-label", t("サブタスク"));
          input.addEventListener("change", function () {
            if (!input.value.trim()) { data.tasks = data.tasks.filter(function (y) { return y.id !== c.id; }); save(); render(); drawSubs(); return; }
            c.text = input.value.trim(); changed();
          });
          var del = el("button", "icon-btn m3-state");
          del.type = "button";
          del.setAttribute("aria-label", t("サブタスクを削除"));
          del.appendChild(icon("close"));
          del.addEventListener("click", function () { data.tasks = data.tasks.filter(function (y) { return y.id !== c.id; }); save(); render(); drawSubs(); });
          r.append(cb, input, del);
          subs.appendChild(r);
        });
        var addRow = el("div", "detail__row detail__row--sub");
        var plus = icon("add");
        plus.style.background = "none";
        plus.style.color = "var(--md-primary)";
        addRow.appendChild(plus);
        var addIn = el("input");
        addIn.type = "text";
        addIn.maxLength = 300;
        addIn.placeholder = t("サブタスクを追加");
        addIn.setAttribute("aria-label", t("サブタスクを追加"));
        addIn.addEventListener("keydown", function (e) {
          if (e.key !== "Enter" || e.isComposing) return;
          e.preventDefault();
          var v = addIn.value.trim();
          if (!v) return;
          var now = Date.now();
          data.tasks.push(R.upgradeTask({ id: newId(), list: x.list, text: v, parent: x.id, created: now, updated: now }, data.lists));
          save(); render(); drawSubs();
          subs.querySelector("input[placeholder]").focus();
        });
        addRow.appendChild(addIn);
        subs.appendChild(addRow);
      };
      drawSubs();
      body.appendChild(subs);
    }

    body.appendChild(el("p", "detail__hint", t("作成 {date}", { date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(x.created)) })));

    window.M3.dialog({
      title: t("詳細"), body: body, cancelValue: "close",
      // スマホ（指で操作）では、開いたときにキーボードを出さない（タイトルを押すと出る）
      autofocus: !(window.matchMedia && matchMedia("(pointer: coarse)").matches),
      actions: (window.SKMsg ? [{ label: SKMsg.sendLabel(), value: "line" }] : []).concat([{ label: t("削除"), danger: true, value: "delete" }, { label: t("完了"), primary: true, value: "close" }]),
      onReady: function (close, box) {
        box.classList.add("detail");
        box.parentElement.classList.add("detail-scrim");
      }
    }).then(function (v) {
      if (v === "delete") removeTask(x);
      else if (v === "line") { render(); shareTask(x); }
      else render();
    });
  }

  // ================================================================
  // リスト
  // ================================================================
  function listEditor(list) {
    var draft = { name: list ? list.name : "", color: list ? list.color : R.LIST_COLORS[0], icon: list ? list.icon : "list" };
    var box = el("div", "list-edit");
    box.style.setProperty("--c", draft.color);
    var preview = el("div", "list-edit__preview");
    var pIcon = icon(draft.icon);
    preview.appendChild(pIcon);
    var nameIn = el("input", "m3-field__input");
    nameIn.value = draft.name;
    nameIn.maxLength = 40;
    nameIn.placeholder = t("リストの名前");
    var colors = el("div", "list-edit__colors");
    colors.setAttribute("role", "radiogroup");
    colors.setAttribute("aria-label", t("色"));
    R.LIST_COLORS.forEach(function (c) {
      var b = el("button", "tbs-swatch m3-state");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", c);
      b.style.setProperty("--sw", c);
      b.setAttribute("aria-checked", String(c === draft.color));
      b.appendChild(icon("check"));
      b.addEventListener("click", function () {
        draft.color = c;
        box.style.setProperty("--c", c);
        Array.prototype.forEach.call(colors.children, function (y) { y.setAttribute("aria-checked", String(y === b)); });
      });
      colors.appendChild(b);
    });
    var icons = el("div", "list-edit__icons");
    icons.setAttribute("role", "radiogroup");
    icons.setAttribute("aria-label", t("アイコン"));
    R.LIST_ICONS.forEach(function (name) {
      var b = el("button", "list-edit__icon m3-state");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", name);
      b.setAttribute("aria-checked", String(name === draft.icon));
      b.appendChild(icon(name));
      b.addEventListener("click", function () {
        draft.icon = name;
        pIcon.textContent = name;
        Array.prototype.forEach.call(icons.children, function (y) { y.setAttribute("aria-checked", String(y === b)); });
      });
      icons.appendChild(b);
    });
    box.append(preview, field(t("リストの名前"), nameIn), colors, icons);
    return window.M3.dialog({
      title: list ? t("リストを編集") : t("新規リスト"), body: box,
      actions: [{ label: t("キャンセル"), value: null }, { label: list ? t("完了") : t("作成"), primary: true, value: function () { draft.name = nameIn.value.trim(); return draft.name ? draft : null; } }],
      onReady: function (close) {
        nameIn.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); draft.name = nameIn.value.trim(); if (draft.name) close(draft); } });
      }
    });
  }
  $("btn-add-list").addEventListener("click", function () {
    listEditor(null).then(function (d) {
      if (!d) return;
      var l = { id: newId(), name: d.name, color: d.color, icon: d.icon };
      data.lists.push(l);
      openView(l.id, true);
    });
  });

  // ================================================================
  // 一覧の操作・検索
  // ================================================================
  document.querySelector(".side").addEventListener("click", function (e) {
    var b = e.target.closest("[data-view]");
    if (b) openView(b.dataset.view, true);
  });
  $("btn-back").addEventListener("click", back);
  $("btn-cal").addEventListener("click", function () { data.calView = !data.calView; save(); renderMain(); });
  $("search").addEventListener("input", function () {
    var was = !!query;
    query = this.value.trim();
    render();
    if (query && !was && narrow.matches) { app.classList.add("is-list"); history.pushState({ todo: "search" }, ""); }
  });
  $("search").addEventListener("keydown", function (e) { if (e.key === "Enter") this.blur(); });

  // ================================================================
  // メニュー
  // ================================================================
  function setupMenu(btnId, menuId) {
    var btn = $(btnId), menu = $(menuId);
    function set(openIt) {
      menu.hidden = !openIt;
      btn.setAttribute("aria-expanded", String(openIt));
      if (openIt) { var f = menu.querySelector("button:not([hidden])"); if (f) f.focus(); }
    }
    btn.addEventListener("click", function () { set(menu.hidden); });
    document.addEventListener("click", function (e) { if (!menu.hidden && !btn.parentElement.contains(e.target)) set(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) { set(false); btn.focus(); } });
    menu.addEventListener("click", function () { set(false); });
  }
  setupMenu("btn-menu", "menu");
  setupMenu("btn-list-menu", "list-menu");

  function notifyLabel() {
    var p = window.Notification ? Notification.permission : "unsupported";
    $("notify-label").textContent = p === "granted" ? t("通知はオンです") : p === "denied" ? t("通知はブラウザで止められています") : p === "unsupported" ? t("このブラウザは通知に対応していません") : t("通知をオンにする");
  }
  function askNotify() {
    if (!window.Notification) { say(t("このブラウザは通知に対応していません")); return Promise.resolve(); }
    return Promise.resolve(Notification.requestPermission()).then(function (p) {
      notifyLabel();
      say(p === "granted" ? t("通知をオンにしました。Toolbox のページを開いているあいだ、時刻にお知らせします") : t("通知はオンになりませんでした"));
    });
  }
  notifyLabel();

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-menu], [data-lmenu]");
    if (!b) return;
    var what = b.dataset.menu || b.dataset.lmenu;
    var view = currentView(), list = listById(view);
    if (what === "notify") askNotify();
    else if (what === "export") {
      var backup = { app: "sk-todo", version: 2, exportedAt: new Date().toISOString(), lists: data.lists, tasks: data.tasks };
      var url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      var a = el("a");
      a.href = url;
      a.download = "todo-backup-" + today().replace(/-/g, "") + ".json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } else if (what === "import") $("import-file").click();
    else if (what === "sort") {
      if (!list) { say(t("並べ替えは、マイリストで選べます")); return; }
      window.M3.choose({ title: t("並べ替え"), value: data.sort[view] || "manual", options: [
        { value: "manual", label: t("追加した順"), icon: "drag_handle" },
        { value: "due", label: t("期限"), icon: "event" },
        { value: "priority", label: t("優先度"), icon: "priority_high" },
        { value: "title", label: t("タイトル"), icon: "sort_by_alpha" }
      ] }).then(function (v) { if (!v) return; data.sort[view] = v; save(); render(); });
    } else if (what === "toggle-done") {
      if (!list) { openView("done", true); return; }
      data.showDone[view] = !data.showDone[view];
      save();
      render();
    } else if (what === "clear-done") {
      var done = data.tasks.filter(function (x) { return x.done && (!list || x.list === view); });
      if (!done.length) { say(t("完了したリマインダーはありません。")); return; }
      window.M3.confirm({ title: t("完了済みを削除しますか？"), text: t("{n} 件の完了したリマインダーを削除します。", { n: done.length }), ok: t("削除"), danger: true }).then(function (ok) {
        if (!ok) return;
        var ids = done.map(function (x) { return x.id; });
        var removed = snapshot(done);
        data.tasks = data.tasks.filter(function (x) { return ids.indexOf(x.id) < 0; });
        save();
        render();
        say(t("{n} 件削除しました", { n: done.length }), function () { restoreSnapshot(removed); });
      });
    } else if (what === "edit-list" && list) {
      listEditor(list).then(function (d) {
        if (!d) return;
        list.name = d.name; list.color = d.color; list.icon = d.icon;
        save();
        render();
      });
    } else if (what === "delete-list" && list) {
      if (data.lists.length <= 1) { say(t("最後のリストは削除できません")); return; }
      var n = data.tasks.filter(function (x) { return x.list === list.id; }).length;
      window.M3.confirm({ title: t("「{name}」を削除しますか？", { name: list.name }), text: n ? t("このリストのリマインダー（{n} 件）も削除されます。元に戻せません。", { n: n }) : t("このリストは空です。"), ok: t("削除"), danger: true }).then(function (ok) {
        if (!ok) return;
        data.tasks = data.tasks.filter(function (x) { return x.list !== list.id; });
        data.lists = data.lists.filter(function (l) { return l.id !== list.id; });
        delete data.showDone[list.id];
        delete data.sort[list.id];
        data.view = "today";
        save();
        render();
        if (narrow.matches) back();
      });
    }
  });

  $("import-file").addEventListener("change", function () {
    var file = this.files && this.files[0];
    this.value = "";
    if (!file) return;
    file.text().then(function (text) {
      var d = JSON.parse(text);
      if (!(d && (Array.isArray(d) || Array.isArray(d.tasks)))) throw new Error("empty");
      var incoming = R.upgrade({ lists: d.lists || [], tasks: Array.isArray(d) ? d : d.tasks });
      // 1 つ前の形（リストなし）のときは、いまの最初のリストに入れる
      if (!(d.lists && d.lists.length)) incoming.tasks.forEach(function (x) { x.list = data.lists[0].id; });
      else incoming.lists.forEach(function (l) { if (!listById(l.id)) data.lists.push(l); });
      var added = 0;
      incoming.tasks.forEach(function (x) {
        if (!listById(x.list)) x.list = data.lists[0].id;
        var mine = taskById(x.id);
        if (!mine) { data.tasks.push(x); added++; }
        else if (x.updated > (mine.updated || 0)) { Object.assign(mine, x); added++; }
      });
      save();
      render();
      say(t("{n} 件のタスクを読み込みました", { n: added }));
    }).catch(function () { say(t("読み込めませんでした。Todo のバックアップのファイルを選んでください")); });
  });

  // 横断検索の「Todo に追加」（/toolbox/shared/search.js が sessionStorage の sk_quick_todo に入れて、ここを開く）
  var quick = null;
  try { quick = sessionStorage.getItem("sk_quick_todo"); sessionStorage.removeItem("sk_quick_todo"); } catch (e) { /* 使えない */ }
  if (quick && quick.trim()) {
    var qq = R.parseQuick(quick.trim().slice(0, 500)), qnow = Date.now();
    var qx = R.upgradeTask({ id: newId(), list: data.lists[0].id, text: qq.text || quick.trim(), due: qq.due, time: qq.time, repeat: qq.repeat, priority: qq.priority, created: qnow, updated: qnow }, data.lists);
    data.tasks.push(qx);
    lastAdded = qx.id;
    save();
    openView(qx.list, false);
    say(t("Todo に追加しました: {text}", { text: qx.text }));
  }

  // #task-ID で開いたとき（横断検索など）: そのタスクのリストを開いて、くわしい情報を出す
  var deep = /^#task-(.+)$/.exec(location.hash);
  if (deep) {
    var target = taskById(decodeURIComponent(deep[1]));
    history.replaceState(null, "", location.pathname);
    if (target) {
      openView(target.done ? "done" : target.list, false);
      window.addEventListener("load", function () { if (window.M3) openDetail(target); });
    }
  }

  // ================================================================
  // 通知・ほかのタブ・日付の変わり目
  // ================================================================
  document.addEventListener("skreminder", function (e) { say(t("リマインダー: {title}", { title: e.detail.text })); });
  function editing() { return !!document.querySelector(".task__edit, .tbs-dialog-scrim"); }
  window.addEventListener("storage", function (e) {
    if (e.key !== R.STORE) return;
    data = R.load();
    if (!editing()) render();
  });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && !editing()) render(); });
  setInterval(function () { if (document.visibilityState === "visible" && !editing()) render(); }, 60000);
  narrow.addEventListener("change", function () { applyTheme(); if (!narrow.matches) app.classList.remove("is-list"); });
})();
