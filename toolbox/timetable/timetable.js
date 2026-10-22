// Timetable（SK's Toolbox）— 時間割
//   ・自分の時間割は localStorage の sk_timetable に保存する（オンライン同期をオンにしたときだけ、暗号化して SK Hub Systems アカウントにも保存する。/toolbox/shared/sync.js）
//       { version: 1, view: "mine" | 配信された時間割の ID,
//         table: { name, days: 5|6, periods: 1〜10, times: [{ s: "HH:MM", e: "HH:MM" }], cells: { "曜日-時限": { subject, room, teacher, note, color } },
//                  special: [特別な日程], updated, share: { tid, title, publishedAt } },        … share は管理者が配信したとき
//         received: { ID: { title, table, updatedAt, fetchedAt } } }     … 配信された時間割（見るだけ。端末に置いておき、オフラインでも見られる）
//   ・曜日は 0 = 月曜。いまの授業・次の授業は、時限の時刻から出す
//   ・特別な日程（試験の週・行事・休みなど。12 個まで、1 つ 31 日まで）
//       { id, name, kind: "exam" | "event" | "off" | "other", from: "YYYY-MM-DD", to: "YYYY-MM-DD",
//         days: { "YYYY-MM-DD": { type: "normal" | "off" | "custom", note, slots: [{ s, e, subject, room, note, color }] } } }
//       その期間の日は、days に書いた日程になる（書いていない日は、休み（kind: "off"）ならお休み、ほかはいつもの時間割）。
//       時間割の JSON に入っているので、配信するとクラスの人にも届く。いまの授業・次の授業、タイトルバーの真ん中も、この日程で出す
//   ・クラスへの連絡（30 件まで）: table.notices = [{ id, kind: "info" | "bring" | "submit" | "change", important, title, body, date（対象の日）, until（いつまで出すか）, created }]
//       これも時間割の JSON に入るので、配信するとクラスの人に届く。新しい連絡は、受け取ったときに通知する（通知を許可しているとき）
//       読んだ連絡は data.seen、通知した連絡は data.notified（どちらも id の一覧。この端末だけ）
//       書く・直す・消すのは管理者だけ（配信と同じ。share.js の isAdmin）。ほかの人は、配信された連絡を読むだけ
//   ・クラスの時間割の配信（/toolbox/timetable/share.js）
//       管理者（SK Hub Systems の開発者）が、メールアドレスを入れて自分の時間割を配信する。受け取る人は、そのメールアドレスの
//       SK Hub Systems アカウントでログインすると、配信された時間割が出る（見るだけ。返事などはない）
//   ・コマの「Todo に追加」で、次にその授業がある日を期限にした宿題のタスクを作る（/toolbox/shared/remind.js）
//   ・?embed のときは見本の時間割を表示だけする
(function () {
  "use strict";

  var root = document.documentElement;
  var embed = /[?&]embed\b/.test(location.search);
  var I18N = window.SKI18N;
  var locale = (I18N && I18N.locale) || "ja-JP";
  function t(s, p) { return I18N ? I18N.t(s, p) : s.replace(/\{(\w+)\}/g, function (m, k) { return p && k in p ? p[k] : m; }); }
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function icon(name) { var s = el("span", "msr", name); s.setAttribute("aria-hidden", "true"); return s; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function minutes(hm) { var m = /^(\d{2}):(\d{2})$/.exec(hm || ""); return m ? +m[1] * 60 + +m[2] : null; }

  var COLORS = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed", "#0891b2", "#ca8a04", "#dc2626", "#0d9488", "#334155"];
  var DEFAULT_TIMES = [["08:50", "09:40"], ["09:50", "10:40"], ["10:50", "11:40"], ["11:50", "12:40"], ["13:30", "14:20"], ["14:30", "15:20"], ["15:30", "16:20"], ["16:30", "17:20"], ["17:30", "18:20"], ["18:30", "19:20"]];
  // 曜日の名前（月〜土。2026-01-05 は月曜日）
  var dayFmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
  var DAY_NAMES = [0, 1, 2, 3, 4, 5].map(function (i) { return dayFmt.format(new Date(2026, 0, 5 + i)); });

  // ================================================================
  // データ
  // ================================================================
  var STORE = "sk_timetable";
  function cleanTable(x) {
    x = x && typeof x === "object" ? x : {};
    var days = x.days === 6 ? 6 : 5;
    var periods = Math.max(1, Math.min(10, Math.round(Number(x.periods)) || 6));
    var times = [];
    for (var p = 0; p < 10; p++) {
      var tm = Array.isArray(x.times) && x.times[p] ? x.times[p] : null;
      var s = tm && minutes(tm.s) !== null ? tm.s : DEFAULT_TIMES[p][0];
      var e = tm && minutes(tm.e) !== null ? tm.e : DEFAULT_TIMES[p][1];
      times.push({ s: s, e: e });
    }
    var cells = {};
    if (x.cells && typeof x.cells === "object") {
      Object.keys(x.cells).forEach(function (k) {
        var m = /^([0-5])-(\d)$/.exec(k), c = x.cells[k];
        if (!m || !c || typeof c !== "object") return;
        var subject = str(c.subject, 40).trim();
        if (!subject) return;
        cells[k] = {
          subject: subject, room: str(c.room, 30), teacher: str(c.teacher, 30), note: str(c.note, 500),
          color: /^#[0-9a-f]{6}$/i.test(c.color || "") ? c.color : COLORS[0]
        };
      });
    }
    var out = { name: str(x.name, 40).trim() || t("時間割"), days: days, periods: periods, times: times, cells: cells, special: cleanSpecial(x.special), notices: cleanNotices(x.notices), updated: Number(x.updated) || 0 };
    if (x.share && typeof x.share.tid === "string") out.share = { tid: x.share.tid.slice(0, 40), title: str(x.share.title, 60), publishedAt: Number(x.share.publishedAt) || 0 };
    return out;
  }
  // ---- 特別な日程 ----
  var SP_KINDS = { exam: ["edit_note", t("試験")], event: ["celebration", t("行事")], off: ["beach_access", t("休み")], other: ["event_note", t("その他")] };
  var MAX_SPECIAL = 12, MAX_SPAN = 31, MAX_SLOTS = 10;
  function isYmd(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(parseYmd(v)); }
  function parseYmd(v) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(NaN); }
  function addDays(v, n) { var d = parseYmd(v); d.setDate(d.getDate() + n); return ymd(d); }
  function spanDays(from, to) { return Math.round((parseYmd(to) - parseYmd(from)) / 864e5) + 1; }
  function datesOf(sp) { var out = [], n = Math.min(MAX_SPAN, spanDays(sp.from, sp.to)); for (var i = 0; i < n; i++) out.push(addDays(sp.from, i)); return out; }
  function cleanSlot(x) {
    if (!x || typeof x !== "object") return null;
    var subject = str(x.subject, 40).trim(), sm = minutes(x.s), em = minutes(x.e);
    if (!subject || sm === null || em === null || em <= sm) return null;
    return { s: x.s, e: x.e, subject: subject, room: str(x.room, 30), note: str(x.note, 200), color: /^#[0-9a-f]{6}$/i.test(x.color || "") ? x.color : COLORS[0] };
  }
  function cleanSpecial(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (x) {
      if (out.length >= MAX_SPECIAL || !x || typeof x !== "object" || !isYmd(x.from) || !isYmd(x.to) || x.to < x.from || spanDays(x.from, x.to) > MAX_SPAN) return;
      var kind = SP_KINDS[x.kind] ? x.kind : "other", days = {};
      if (x.days && typeof x.days === "object") {
        Object.keys(x.days).forEach(function (k) {
          var d = x.days[k];
          if (!isYmd(k) || k < x.from || k > x.to || !d || typeof d !== "object") return;
          var type = d.type === "off" || d.type === "custom" ? d.type : "normal";
          var slots = type === "custom" && Array.isArray(d.slots) ? d.slots.map(cleanSlot).filter(Boolean).slice(0, MAX_SLOTS) : [];
          slots.sort(function (a, b) { return minutes(a.s) - minutes(b.s); });
          days[k] = { type: type, note: str(d.note, 200), slots: slots };
        });
      }
      out.push({ id: str(x.id, 20) || newId(), name: str(x.name, 40).trim() || SP_KINDS[kind][1], kind: kind, from: x.from, to: x.to, days: days });
    });
    out.sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
    return out;
  }
  // その日の特別な日程（なければ null）。日程がかさなっていたら、あとから始まるほう
  function specialFor(tb, ds) {
    var hit = null;
    (tb.special || []).forEach(function (sp) { if (ds >= sp.from && ds <= sp.to) hit = sp; });
    return hit;
  }
  function dayOf(sp, ds) { return sp.days[ds] || { type: sp.kind === "off" ? "off" : "normal", note: "", slots: [], auto: true }; }
  // その日の時間割: { special, day, off, slots: [{ label, p（いつもの時間割のとき）, s, e, cell }] }
  function dayPlan(tb, date) {
    var ds = ymd(date), sp = specialFor(tb, ds), day = sp ? dayOf(sp, ds) : null;
    var r = { special: sp, day: day, off: false, slots: [] };
    if (day && day.type === "off") { r.off = true; return r; }
    if (day && day.type === "custom") {
      r.slots = day.slots.map(function (x, i) { return { label: String(i + 1), s: x.s, e: x.e, cell: x }; });
      return r;
    }
    var di = todayIndex(date);
    if (di < 0 || di >= tb.days) { r.noSchool = true; return r; }
    for (var p = 0; p < tb.periods; p++) r.slots.push({ label: String(p + 1), p: p, s: tb.times[p].s, e: tb.times[p].e, cell: tb.cells[di + "-" + p] || null });
    return r;
  }

  // ---- クラスへの連絡 ----
  var NT_KINDS = { info: ["campaign", t("お知らせ")], bring: ["backpack", t("持ち物")], submit: ["assignment", t("提出物")], change: ["swap_horiz", t("変更")] };
  var MAX_NOTICES = 30;
  var admin = false; // 管理者か（ログインしているときに確かめる。はじめはいいえ）
  function cleanNotices(list) {
    var out = [];
    (Array.isArray(list) ? list : []).forEach(function (x) {
      if (out.length >= MAX_NOTICES || !x || typeof x !== "object") return;
      var title = str(x.title, 80).trim();
      if (!title) return;
      out.push({
        id: str(x.id, 20) || newId(), kind: NT_KINDS[x.kind] ? x.kind : "info", important: x.important === true,
        title: title, body: str(x.body, 1000), date: isYmd(x.date) ? x.date : "", until: isYmd(x.until) ? x.until : "", created: Number(x.created) || 0
      });
    });
    out.sort(function (a, b) { return b.created - a.created; });
    return out;
  }
  // まだ出す連絡か（いつまで出すかを過ぎたら出さない。決めていなければ、出してから 14 日）
  function noticeActive(n, today) {
    return (n.until || n.date || ymd(new Date((n.created || Date.now()) + 14 * 864e5))) >= today;
  }
  function idList(v) { return Array.isArray(v) ? v.filter(function (x) { return typeof x === "string"; }).slice(-300) : []; }

  var data = { version: 1, view: "mine", table: cleanTable(null), received: {}, seen: [], notified: [], registered: {} };
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(STORE) || "{}") || {};
      data.table = cleanTable(d.table);
      data.received = {};
      if (d.received && typeof d.received === "object") {
        Object.keys(d.received).forEach(function (id) {
          var r = d.received[id];
          if (r && typeof r === "object") data.received[id] = { title: str(r.title, 60), table: cleanTable(r.table), updatedAt: Number(r.updatedAt) || 0, fetchedAt: Number(r.fetchedAt) || 0 };
        });
      }
      data.view = typeof d.view === "string" && (d.view === "mine" || data.received[d.view]) ? d.view : "mine";
      data.seen = idList(d.seen);
      data.notified = idList(d.notified);
      // 管理者の「参加している人」に名前・アイコンを書いた時間割（{ ID: 書いた内容 }。同じなら書き直さない）
      data.registered = {};
      if (d.registered && typeof d.registered === "object") Object.keys(d.registered).forEach(function (k) { if (typeof d.registered[k] === "string") data.registered[k] = d.registered[k].slice(0, 800); });
    } catch (e) { /* 初期値 */ }
  }
  function save() {
    if (embed) return;
    try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) { say(t("保存できませんでした")); }
  }
  function changed() { data.table.updated = Date.now(); save(); render(); }

  if (embed) {
    root.classList.add("is-embed");
    var demo = [[t("数学"), "201"], [t("英語"), "LL"], [t("国語"), "201"], [t("理科"), t("理科室")], [t("体育"), t("体育館")], [t("社会"), "201"]];
    var cells = {};
    for (var d0 = 0; d0 < 5; d0++) for (var p0 = 0; p0 < 6; p0++) {
      var s0 = demo[(d0 * 2 + p0) % demo.length];
      cells[d0 + "-" + p0] = { subject: s0[0], room: s0[1], color: COLORS[(d0 * 2 + p0) % demo.length] };
    }
    data.table = cleanTable({ name: t("時間割"), cells: cells });
  } else load();

  function current() {
    if (data.view !== "mine" && data.received[data.view]) return { table: data.received[data.view].table, readonly: true, title: data.received[data.view].title };
    return { table: data.table, readonly: false, title: data.table.name };
  }

  // ================================================================
  // いま・次
  // ================================================================
  // 月曜 = 0 … 土曜 = 5、日曜は -1
  function todayIndex(now) { var w = now.getDay(); return w === 0 ? -1 : w - 1; }
  function status(tb, now) {
    var di = todayIndex(now), plan = dayPlan(tb, now);
    var nowMin = now.getHours() * 60 + now.getMinutes();
    var r = { day: di, plan: plan, now: null, next: null, hasToday: false };
    plan.slots.forEach(function (sl) {
      if (sl.cell) r.hasToday = true;
      var s = minutes(sl.s), e = minutes(sl.e);
      if (s === null || e === null) return;
      if (nowMin >= s && nowMin < e) r.now = { p: sl.p, label: sl.label, cell: sl.cell, left: e - nowMin, total: Math.max(1, e - s) };
      else if (nowMin < s && !r.next && sl.cell) r.next = { p: sl.p, label: sl.label, cell: sl.cell, start: sl.s, until: s - nowMin };
    });
    return r;
  }
  // その授業が次にある日（今日がその曜日で、まだ終わっていなければ今日）
  function nextDate(di, p, tb) {
    var now = new Date();
    for (var add = 0; add < 8; add++) {
      var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);
      if (todayIndex(d) !== di) continue;
      if (add === 0) { var e = minutes(tb.times[p].e); if (e !== null && now.getHours() * 60 + now.getMinutes() >= e) continue; }
      return d;
    }
    return null;
  }

  // ================================================================
  // 表示
  // ================================================================
  var grid = $("grid"), firstRender = true;
  function periodLabel(p) { return t("{n} 限", { n: p + 1 }); }
  function render() {
    if (adminView) renderAdmin();
    var cur = current(), tb = cur.table, now = new Date(), st = status(tb, now);
    $("title").textContent = cur.title;
    var count = Object.keys(tb.cells).length;
    var sub = cur.readonly ? t("配信された時間割（見るだけ）") : count ? t("{n} コマ", { n: count }) : t("コマを押して、科目を入れましょう");
    if (!cur.readonly && tb.share) sub += " · " + t("配信中");
    $("sub").textContent = sub;

    // 切りかえ
    var views = $("views"), ids = Object.keys(data.received);
    views.hidden = !ids.length;
    views.textContent = "";
    if (ids.length) {
      [["mine", t("自分の時間割"), "person"]].concat(ids.map(function (id) { return [id, data.received[id].title || t("配信された時間割"), "school"]; })).forEach(function (v) {
        var b = el("button", "view-chip m3-state");
        b.type = "button";
        b.setAttribute("role", "tab");
        b.setAttribute("aria-selected", String(data.view === v[0]));
        b.append(icon(v[2]), el("span", "", v[1]));
        b.addEventListener("click", function () { data.view = v[0]; save(); firstRender = true; render(); });
        views.appendChild(b);
      });
    }

    renderNotices(tb, cur.readonly);
    renderNow(tb, st);
    renderSpecials(tb, cur.readonly);
    // いつもの時間割を出しているときに今日が特別な日程なら、表の今日の列は薄く
    grid.classList.toggle("is-special-today", !!(st.plan.special && st.plan.day.type !== "normal") && gridMode === "usual");

    // 表。今週に特別な日程（試験など）があれば、今週の日程で出す（上の切りかえで、いつもの時間割にもできる）
    var week = weekOf(tb, now), weekMode = week.special && gridMode !== "usual";
    renderGridMode(week);
    grid.classList.toggle("is-week", !!weekMode);
    grid.style.setProperty("--days", String(tb.days));
    grid.textContent = "";
    grid.appendChild(el("span"));
    for (var d = 0; d < tb.days; d++) {
      var wp = weekMode ? week.plans[d] : null, isToday = weekMode ? week.dates[d] === ymd(now) : d === st.day;
      var h = el("div", "grid__day" + (isToday ? " is-today" : "") + (wp && wp.special && wp.day.type !== "normal" ? " is-special" + (wp.off ? " is-off" : "") : ""));
      h.appendChild(document.createTextNode(DAY_NAMES[d] + (weekMode ? " " + mdShort.format(parseYmd(week.dates[d])) : "")));
      if (wp && wp.special && wp.day.type !== "normal") h.appendChild(el("small", "", wp.off ? t("休み") : wp.special.name));
      else if (isToday) h.appendChild(el("small", "", !weekMode && st.plan.special ? st.plan.special.name : t("今日")));
      grid.appendChild(h);
    }
    var i = 0, rows = tb.periods;
    if (weekMode) week.plans.forEach(function (pl) { if (pl.day && pl.day.type === "custom") rows = Math.max(rows, pl.slots.length); });
    rows = Math.min(10, rows);
    for (var p = 0; p < rows; p++) {
      // 時限の番号（自分の時間割では、押すとその時限の時刻を変えられる）
      var hasTime = p < tb.periods;
      var ph = el(cur.readonly || !hasTime ? "div" : "button", "grid__period" + (st.now && st.now.p === p ? " is-now" : "") + (cur.readonly || !hasTime ? "" : " m3-state"));
      if (!cur.readonly && hasTime) { ph.type = "button"; ph.dataset.period = String(p); }
      ph.appendChild(document.createTextNode(String(p + 1)));
      if (hasTime) {
        ph.appendChild(el("small", "", tb.times[p].s + "\n" + tb.times[p].e));
        ph.title = periodLabel(p) + " " + tb.times[p].s + "〜" + tb.times[p].e + (cur.readonly ? "" : " · " + t("押すと時刻を変えられます"));
      }
      grid.appendChild(ph);
      for (var d2 = 0; d2 < tb.days; d2++) {
        var plan2 = weekMode ? week.plans[d2] : null, today2 = weekMode ? week.dates[d2] === ymd(now) : d2 === st.day;
        var b = el("button", "cell m3-state");
        b.type = "button";
        if (plan2 && plan2.special && plan2.day.type !== "normal") {
          // 特別な日程の日（試験の時間割・休み）。押すと、その日程を開く
          b.dataset.special = plan2.special.id;
          b.classList.add("cell--special");
          var sl = plan2.off ? null : plan2.slots[p];
          if (plan2.off) {
            b.classList.add("cell--off");
            if (p === 0) b.appendChild(el("span", "cell__subject", t("休み")));
            b.setAttribute("aria-label", DAY_NAMES[d2] + " " + t("休み"));
          } else if (sl) {
            b.style.setProperty("--cc", sl.cell.color);
            b.appendChild(el("span", "cell__subject", sl.cell.subject));
            b.appendChild(el("span", "cell__time", sl.s + "〜" + sl.e));
            if (sl.cell.room) b.appendChild(el("span", "cell__room", sl.cell.room));
            b.setAttribute("aria-label", DAY_NAMES[d2] + " " + sl.s + "〜" + sl.e + " " + sl.cell.subject + (sl.cell.room ? " " + sl.cell.room : ""));
            if (today2 && st.now && st.now.p === undefined && st.now.label === String(p + 1)) { b.classList.add("is-now"); b.dataset.now = t("いま"); }
          } else {
            b.classList.add("cell--empty", "is-readonly");
            b.tabIndex = -1;
            b.setAttribute("aria-label", DAY_NAMES[d2] + " " + t("なし"));
          }
        } else if (p >= tb.periods) {
          // いつもの日だが、試験の日の行のほうが多いとき
          b.classList.add("cell--empty", "is-readonly");
          b.tabIndex = -1;
          b.setAttribute("aria-hidden", "true");
        } else {
          var key = d2 + "-" + p, c = tb.cells[key];
          b.dataset.key = key;
          if (c) {
            b.style.setProperty("--cc", c.color);
            b.appendChild(el("span", "cell__subject", c.subject));
            if (c.room) b.appendChild(el("span", "cell__room", c.room));
            b.setAttribute("aria-label", DAY_NAMES[d2] + " " + periodLabel(p) + " " + c.subject + (c.room ? " " + c.room : ""));
          } else {
            b.classList.add("cell--empty");
            if (cur.readonly) { b.classList.add("is-readonly"); b.tabIndex = -1; }
            else b.appendChild(icon("add"));
            b.setAttribute("aria-label", DAY_NAMES[d2] + " " + periodLabel(p) + " " + t("空き"));
          }
          if (today2 && st.now && st.now.p === p && c) { b.classList.add("is-now"); b.dataset.now = t("いま"); }
        }
        if (today2) b.classList.add("is-today");
        if (firstRender) { b.classList.add("cell--in"); b.style.setProperty("--i", String(i++)); }
        grid.appendChild(b);
      }
    }
    // 時限を増やす（10 限まで）
    if (!cur.readonly && tb.periods < 10) {
      var more = el("button", "grid__more m3-state");
      more.type = "button";
      more.id = "add-period";
      more.append(icon("add"), el("span", "", t("{n} 限を追加", { n: tb.periods + 1 })));
      grid.appendChild(more);
    }
    firstRender = false;
    $("note").textContent = cur.readonly
      ? t("配信した人が時間割を変えると、次に開いたときに新しくなります。")
      : t("時間割はこの端末のブラウザに保存されます（オンライン同期は任意）。");
  }

  // ---- 表の切りかえ（今週の日程・いつもの時間割） ----
  //   今週（日曜は次の週）に特別な日程があれば、表はその週の日程（試験の時間割・休み）。切りかえはこの画面のあいだだけ覚える
  var gridMode = "week";
  var mdShort = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric" });
  function weekOf(tb, now) {
    var base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var w = base.getDay();
    base.setDate(base.getDate() + (w === 0 ? 1 : 1 - w)); // 月曜
    var r = { dates: [], plans: [], special: null };
    for (var d = 0; d < tb.days; d++) {
      var day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + d), pl = dayPlan(tb, day);
      r.dates.push(ymd(day));
      r.plans.push(pl);
      if (pl.special && pl.day.type !== "normal" && !r.special) r.special = pl.special;
    }
    return r;
  }
  function renderGridMode(week) {
    var box = $("grid-mode");
    box.hidden = !week.special;
    if (!week.special) return;
    box.textContent = "";
    [["week", icon(SP_KINDS[week.special.kind][0]), t("今週（{name}）", { name: week.special.name })], ["usual", icon("calendar_view_week"), t("いつもの時間割")]].forEach(function (o) {
      var b = el("button", "view-chip m3-state");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String((gridMode === "usual" ? "usual" : "week") === o[0]));
      b.append(o[1], el("span", "", o[2]));
      b.addEventListener("click", function () { gridMode = o[0]; firstRender = true; render(); });
      box.appendChild(b);
    });
  }

  function renderNow(tb, st) {
    var box = $("now");
    box.textContent = "";
    function card(kind, label, kicker, c, meta) {
      var a = el("div", "now-card now-card--" + kind);
      if (c) a.style.setProperty("--cc", c.color);
      var lb = el("span", "now-card__label");
      lb.appendChild(el("b", "", label));
      var tx = el("div", "now-card__text");
      tx.append(el("span", "now-card__kicker", kicker), el("span", "now-card__subject", c ? c.subject : t("空き時間")));
      if (meta) tx.appendChild(el("span", "now-card__meta", meta));
      a.append(lb, tx);
      box.appendChild(a);
      return a;
    }
    function plain(ic, text, sub) {
      var a = el("div", "now-card now-card--plain");
      var tx = el("div", "now-card__text");
      tx.appendChild(el("span", "now-card__plain", text));
      if (sub) tx.appendChild(el("span", "now-card__meta", sub));
      a.append(icon(ic), tx);
      box.appendChild(a);
      return a;
    }
    var plan = st.plan, sp = plan.special;
    // 今日が特別な日程の日
    if (sp) {
      var info = plain(SP_KINDS[sp.kind][0], sp.name + " · " + rangeText(sp), plan.day.type === "custom" ? t("今日は特別な時間割です") : plan.day.type === "off" ? t("今日はお休みです") : t("今日はいつもの時間割です"));
      info.classList.add("now-card--special");
      if (plan.day.note) info.querySelector(".now-card__text").appendChild(el("span", "now-card__meta", plan.day.note));
      info.tabIndex = 0;
      info.setAttribute("role", "button");
      info.addEventListener("click", function () { openSpecial(sp.id); });
      info.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSpecial(sp.id); } });
    }
    if (plan.off) return;
    if (plan.noSchool) { plain("weekend", t("今日は授業がありません")); return; }
    if (st.now) {
      var c = st.now.cell;
      var meta = [c && c.room, c && c.teacher].filter(Boolean).join(" · ");
      var nc = card("now", st.now.label, t("いま · あと {n} 分", { n: st.now.left }), c, meta);
      var bar = el("span", "now-card__bar");
      bar.style.width = Math.round((1 - st.now.left / st.now.total) * 100) + "%";
      nc.appendChild(bar);
    }
    if (st.next) {
      var c2 = st.next.cell;
      card("next", st.next.label, t("次 · {time} から（あと {n} 分）", { time: st.next.start, n: st.next.until }), c2, [c2.room, c2.teacher].filter(Boolean).join(" · "));
    }
    if (!st.now && !st.next) plain(st.hasToday ? "task_alt" : "event_available", st.hasToday ? t("今日の授業は終わりました") : t("今日の時間割はまだ入っていません"));
  }

  // ---- クラスへの連絡（新しい順。配信された時間割なら見るだけ） ----
  function renderNotices(tb, readonly, target) {
    var box = target || $("notices"), today = ymd(new Date());
    box.textContent = "";
    var list = (tb.notices || []).filter(function (n) { return !readonly || noticeActive(n, today); });
    // 自分の時間割の連絡は、管理者だけ（書いて配信する人）。配信された時間割では、まだ出す連絡があるときだけ。管理者の画面（target）ではいつも出す
    if (!readonly && !admin) { box.hidden = true; return; }
    if (!target && !list.length && (readonly || !tb.share)) { box.hidden = true; return; }
    box.hidden = false;
    var head = el("div", "specials__head");
    var unread = list.filter(function (n) { return readonly && data.seen.indexOf(n.id) < 0; }).length;
    var h = el("h2", "specials__title", t("連絡"));
    if (unread) h.appendChild(el("span", "nt-count", String(unread)));
    head.appendChild(h);
    // 受け取る人: 通知をまだ決めていなければ「通知をオン」
    if (readonly && window.Notification && Notification.permission === "default") {
      var on = el("button", "text-btn m3-state tt-notify-on");
      on.type = "button";
      on.append(icon("notifications"), el("span", "", t("新しい連絡を通知する")));
      on.addEventListener("click", function () { Notification.requestPermission().then(function () { render(); }); });
      head.appendChild(on);
    }
    if (!readonly) {
      var add = el("button", "text-btn m3-state");
      add.type = "button";
      add.dataset.action = "add-notice";
      add.append(icon("add"), el("span", "", t("連絡を書く")));
      head.appendChild(add);
    }
    box.appendChild(head);
    if (!list.length) { box.appendChild(el("p", "specials__empty", t("持ち物・提出物・時間の変更などを書いて配信すると、クラスの人に届きます。"))); return; }
    var wrap = el("div", "nt-list");
    list.forEach(function (n) {
      var b = el("button", "nt-card m3-state nt-card--" + n.kind + (n.important ? " is-important" : "") + (noticeActive(n, today) ? "" : " is-ended"));
      b.type = "button";
      b.dataset.notice = n.id;
      var tx = el("span", "nt-card__text");
      var top = el("span", "nt-card__top");
      top.appendChild(el("span", "nt-card__kind", NT_KINDS[n.kind][1]));
      if (n.date) top.appendChild(el("span", "nt-card__date", dateText(n.date)));
      if (readonly && data.seen.indexOf(n.id) < 0) top.appendChild(el("span", "nt-card__new", "NEW"));
      if (!readonly && !noticeActive(n, today)) top.appendChild(el("span", "nt-card__date", t("終わりました")));
      tx.append(top, el("span", "nt-card__title", n.title));
      if (n.body) tx.appendChild(el("span", "nt-card__body", n.body));
      b.append(icon(n.important ? "priority_high" : NT_KINDS[n.kind][0]), tx);
      wrap.appendChild(b);
    });
    box.appendChild(wrap);
  }
  // 連絡・特別な日程の一覧を押したとき（時間割の画面と管理者の画面で同じ）
  function listClick(e) {
    if (embed) return;
    var b = e.target.closest("[data-notice]");
    if (b) { openNotice(b.dataset.notice); return; }
    var sp = e.target.closest("[data-special]");
    if (sp) { openSpecial(sp.dataset.special); return; }
    var act = e.target.closest("[data-action]");
    if (!act) return;
    if (act.dataset.action === "add-notice") editNotice(null);
    else if (act.dataset.action === "add-special") editSpecialInfo(null);
  }
  $("notices").addEventListener("click", listClick);
  function openNotice(id) {
    var cur = current(), n = (cur.table.notices || []).filter(function (x) { return x.id === id; })[0];
    if (!n) return;
    if (data.seen.indexOf(n.id) < 0) { data.seen.push(n.id); data.seen = idList(data.seen); save(); }
    var body = el("div", "tt-detail");
    var meta = el("div", "tt-detail__row");
    meta.append(icon(NT_KINDS[n.kind][0]), el("span", "", [NT_KINDS[n.kind][1], n.important ? t("大事") : "", n.date ? t("{date} のこと", { date: dateText(n.date) }) : ""].filter(Boolean).join(" · ")));
    body.appendChild(meta);
    if (n.body) body.appendChild(el("p", "tt-detail__note nt-body", n.body));
    if (n.created) body.appendChild(el("p", "nt-when", t("{date} に書いた連絡", { date: new Date(n.created).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) })));
    var actions = cur.readonly || !admin ? [{ label: t("閉じる"), primary: true, value: null }] : [{ label: t("削除"), danger: true, value: "delete" }, { label: t("編集"), value: "edit" }, { label: t("閉じる"), primary: true, value: null }];
    if (n.kind === "submit" || n.kind === "bring") actions.unshift({ label: t("Todo に追加"), value: "todo" });
    if (window.SKLine) actions.unshift({ label: t("LINE で送る"), value: "line" });
    window.M3.dialog({ title: n.title, body: body, actions: actions }).then(function (v) {
      render();
      if (v === "edit") editNotice(n);
      else if (v === "todo") noticeToTodo(n);
      else if (v === "line") shareNotice(n, cur.readonly ? cur.title : (data.table.share && data.table.share.title) || data.table.name);
      else if (v === "delete") {
        var tb = data.table, i = tb.notices.indexOf(n);
        tb.notices.splice(i, 1);
        changed();
        say(t("連絡を消しました") + (tb.share ? " · " + t("「配信を更新」で、クラスの人の画面からも消えます") : ""), function () { tb.notices.splice(i, 0, n); changed(); });
      }
    });
  }
  // 持ち物・提出物を Todo に（対象の日があれば、その日が期限）
  function noticeToTodo(n) {
    var R = window.SKReminders;
    if (!R) return;
    var d2 = R.load(), now = Date.now();
    d2.tasks.push(R.upgradeTask({ id: newId(), list: d2.lists[0].id, text: n.title, notes: n.body, due: n.date || null, created: now, updated: now }, d2.lists));
    try { R.save(d2); } catch (e) { say(t("保存できませんでした")); return; }
    say(n.date ? t("Todo に追加しました（期限 {date}）", { date: dateText(n.date) }) : t("Todo に追加しました"));
  }
  // 連絡を書く・直す（自分の時間割）。配信しているなら「保存して配信」で、すぐクラスの人に届ける
  function editNotice(n) {
    if (!admin) return; // 管理者だけ
    if (data.view !== "mine") { data.view = "mine"; save(); render(); }
    var tb = data.table;
    if (!n && tb.notices.length >= MAX_NOTICES) { say(t("連絡は {n} 件までです。古いものを消してください", { n: MAX_NOTICES })); return; }
    var draft = { kind: n ? n.kind : "info", important: n ? n.important : false };
    var box = el("div", "tt-edit");
    var seg = el("div", "tt-seg");
    seg.setAttribute("role", "radiogroup");
    seg.setAttribute("aria-label", t("種類"));
    Object.keys(NT_KINDS).forEach(function (k) {
      var b = el("button", "m3-state", NT_KINDS[k][1]);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(draft.kind === k));
      b.addEventListener("click", function () { draft.kind = k; Array.prototype.forEach.call(seg.children, function (x) { x.setAttribute("aria-checked", String(x === b)); }); });
      seg.appendChild(b);
    });
    box.appendChild(seg);
    var title = input(n ? n.title : "", 80, t("例: 明日は体操服を持ってくること"));
    box.appendChild(field(t("タイトル"), title));
    var ta = el("textarea", "m3-field__input");
    ta.rows = 4;
    ta.maxLength = 1000;
    ta.value = n ? n.body : "";
    box.appendChild(field(t("くわしく（なくてもよい）"), ta));
    var row = el("div", "tt-time tt-time--one");
    var dateIn = el("input"); dateIn.type = "date"; dateIn.value = n ? n.date : "";
    var untilIn = el("input"); untilIn.type = "date"; untilIn.value = n ? n.until : "";
    var ld = el("label", "tt-time__field"); ld.append(el("span", "", t("何日のこと（なくてもよい）")), dateIn);
    var lu = el("label", "tt-time__field"); lu.append(el("span", "", t("いつまで出すか")), untilIn);
    row.append(ld, el("span", "", ""), lu);
    box.appendChild(row);
    box.appendChild(el("p", "tt-hint", t("「いつまで出すか」を空けると、何日のことの日まで（なければ 14 日間）出します。")));
    var imp = el("label", "nt-important m3-state");
    var impIn = el("input", "tbs-switch");
    impIn.type = "checkbox";
    impIn.setAttribute("role", "switch");
    impIn.checked = draft.important;
    imp.append(el("span", "", t("大事な連絡（目立たせる）")), impIn);
    box.appendChild(imp);
    var actions = [{ label: t("キャンセル"), value: null }, { label: t("保存"), primary: !tb.share, value: "save" }];
    if (tb.share) actions.push({ label: t("保存して配信"), primary: true, value: "publish" });
    window.M3.dialog({ title: n ? t("連絡を編集") : t("連絡を書く"), icon: "campaign", body: box, actions: actions }).then(function (v) {
      if (v !== "save" && v !== "publish") return;
      if (!title.value.trim()) { say(t("タイトルを入れてください")); return; }
      var target = n || { id: newId(), created: Date.now() };
      target.kind = draft.kind;
      target.important = impIn.checked;
      target.title = title.value.trim().slice(0, 80);
      target.body = ta.value.trim().slice(0, 1000);
      target.date = dateIn.value || "";
      target.until = untilIn.value || "";
      if (!n) tb.notices.unshift(target);
      tb.notices = cleanNotices(tb.notices);
      changed();
      if (v === "publish") republish(); else if (tb.share) say(t("保存しました。「配信を更新」で、クラスの人に届きます"));
    });
  }

  // ---- 特別な日程の一覧（これからのもの。自分の時間割では、終わったものも薄く出す） ----
  var mdFmt = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", weekday: "short" });
  function dateText(ds) { return mdFmt.format(parseYmd(ds)); }
  function rangeText(sp) { return sp.from === sp.to ? dateText(sp.from) : dateText(sp.from) + " 〜 " + dateText(sp.to); }
  function renderSpecials(tb, readonly, target) {
    var box = target || $("specials"), today = ymd(new Date());
    box.textContent = "";
    var list = (tb.special || []).filter(function (sp) { return !readonly || sp.to >= today; });
    if (!list.length && readonly) { box.hidden = true; return; }
    box.hidden = false;
    var head = el("div", "specials__head");
    head.appendChild(el("h2", "specials__title", t("特別な日程")));
    if (!readonly) {
      var add = el("button", "text-btn m3-state");
      add.type = "button";
      add.dataset.action = "add-special";
      add.append(icon("add"), el("span", "", t("追加")));
      head.appendChild(add);
    }
    box.appendChild(head);
    if (!list.length) {
      box.appendChild(el("p", "specials__empty", t("試験の週・行事・休みなど、いつもとちがう日程を入れておくと、その日は「いまの授業」がその日程になります。")));
      return;
    }
    var row = el("div", "specials__list");
    list.forEach(function (sp) {
      var b = el("button", "sp-card m3-state sp-card--" + sp.kind);
      b.type = "button";
      b.dataset.special = sp.id;
      var state, ended = sp.to < today;
      if (ended) { state = t("終わりました"); b.classList.add("is-ended"); }
      else if (sp.from <= today) { state = t("いま"); b.classList.add("is-now"); }
      else { var n = spanDays(today, sp.from) - 1; state = n === 1 ? t("明日から") : t("あと {n} 日", { n: n }); }
      var tx = el("span", "sp-card__text");
      tx.append(el("span", "sp-card__name", sp.name), el("span", "sp-card__range", rangeText(sp)));
      b.append(icon(SP_KINDS[sp.kind][0]), tx, el("span", "sp-card__state", state));
      row.appendChild(b);
    });
    box.appendChild(row);
  }
  $("specials").addEventListener("click", listClick);

  // 特別な日程を開く（日ごとの日程。自分の時間割なら、日を押すと変えられる）
  function findSpecial(id) {
    var tb = current().table;
    return (tb.special || []).filter(function (sp) { return sp.id === id; })[0] || null;
  }
  function slotLine(x, i) { return (i + 1) + ". " + x.s + "〜" + x.e + " " + x.subject + (x.room ? "（" + x.room + "）" : ""); }
  function openSpecial(id) {
    var cur = current(), tb = cur.table, sp = findSpecial(id);
    if (!sp) return;
    var today = ymd(new Date());
    var body = el("div", "sp-view");
    var top = el("p", "sp-view__range");
    top.append(icon(SP_KINDS[sp.kind][0]), el("span", "", SP_KINDS[sp.kind][1] + " · " + rangeText(sp)));
    body.appendChild(top);
    var list = el("div", "sp-days");
    datesOf(sp).forEach(function (ds) {
      var day = dayOf(sp, ds), di = todayIndex(parseYmd(ds));
      // 書いていない土日（授業のない曜日）は出さない
      if (day.auto && (di < 0 || di >= tb.days)) return;
      var r = el(cur.readonly ? "div" : "button", "sp-day" + (cur.readonly ? "" : " m3-state") + (ds === today ? " is-today" : ""));
      if (!cur.readonly) { r.type = "button"; r.dataset.date = ds; }
      var d = el("span", "sp-day__date", dateText(ds));
      var info = el("span", "sp-day__info");
      if (day.type === "off") info.appendChild(el("span", "sp-day__tag sp-day__tag--off", t("休み")));
      else if (day.type === "normal") info.appendChild(el("span", "sp-day__tag", t("いつもの時間割")));
      else if (!day.slots.length) info.appendChild(el("span", "sp-day__tag", t("まだ入っていません")));
      day.slots.forEach(function (x, i) {
        var line = el("span", "sp-day__slot", slotLine(x, i));
        line.style.setProperty("--cc", x.color);
        info.appendChild(line);
      });
      if (day.note) info.appendChild(el("span", "sp-day__note", day.note));
      r.append(d, info);
      if (!cur.readonly) r.appendChild(icon("edit"));
      list.appendChild(r);
    });
    body.appendChild(list);
    if (!cur.readonly) body.appendChild(el("p", "sp-view__hint", t("日を押すと、その日の日程（休み・特別な時間割）を変えられます。")));
    var actions = cur.readonly ? [{ label: t("閉じる"), primary: true, value: null }]
      : [{ label: t("削除"), danger: true, value: "delete" }, { label: t("名前・期間"), value: "info" }, { label: t("閉じる"), primary: true, value: null }];
    window.M3.dialog({
      title: sp.name, body: body, actions: actions,
      onReady: function (close) {
        list.addEventListener("click", function (e) { var b = e.target.closest("[data-date]"); if (b) close("day:" + b.dataset.date); });
      }
    }).then(function (v) {
      if (!v) return;
      if (v === "info") editSpecialInfo(sp);
      else if (v === "delete") {
        var i = tb.special.indexOf(sp);
        tb.special.splice(i, 1);
        changed();
        say(t("{name} を消しました", { name: sp.name }), function () { tb.special.splice(i, 0, sp); changed(); });
      } else if (v.indexOf("day:") === 0) editDay(sp, v.slice(4));
    });
  }

  // 名前・種類・期間（null なら新しく作る）
  function editSpecialInfo(sp) {
    if (data.view !== "mine") { data.view = "mine"; save(); render(); }
    var tb = data.table;
    if (!sp && tb.special.length >= MAX_SPECIAL) { say(t("特別な日程は {n} 個までです。終わったものを消してください", { n: MAX_SPECIAL })); return; }
    var draft = { kind: sp ? sp.kind : "exam" };
    var box = el("div", "tt-edit");
    box.appendChild(el("p", "tt-label", t("種類")));
    var seg = el("div", "tt-seg");
    seg.setAttribute("role", "radiogroup");
    var name = input(sp ? sp.name : "", 40, t("例: 期末試験"));
    Object.keys(SP_KINDS).forEach(function (k) {
      var b = el("button", "m3-state", SP_KINDS[k][1]);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(draft.kind === k));
      b.addEventListener("click", function () { draft.kind = k; Array.prototype.forEach.call(seg.children, function (x) { x.setAttribute("aria-checked", String(x === b)); }); });
      seg.appendChild(b);
    });
    box.appendChild(seg);
    box.appendChild(field(t("名前"), name));
    var row = el("div", "tt-time tt-time--one");
    var today = ymd(new Date());
    var f = el("input"); f.type = "date"; f.value = sp ? sp.from : today;
    var to = el("input"); to.type = "date"; to.value = sp ? sp.to : addDays(today, 4);
    var lf = el("label", "tt-time__field"); lf.append(el("span", "", t("はじめの日")), f);
    var lt = el("label", "tt-time__field"); lt.append(el("span", "", t("おわりの日")), to);
    row.append(lf, el("span", "", "〜"), lt);
    box.appendChild(row);
    box.appendChild(el("p", "tt-hint", t("1 日だけなら、同じ日にしてください。31 日まで。")));
    window.M3.dialog({ title: sp ? t("特別な日程を変更") : t("特別な日程を追加"), icon: "event_note", body: box, actions: [{ label: t("キャンセル"), value: null }, { label: sp ? t("保存") : t("追加"), primary: true, value: "save" }] }).then(function (v) {
      if (v !== "save") return;
      var from = f.value, end = to.value;
      if (!isYmd(from) || !isYmd(end) || end < from) { say(t("おわりの日は、はじめの日と同じか、それより後にしてください")); return; }
      if (spanDays(from, end) > MAX_SPAN) { say(t("期間は {n} 日までです", { n: MAX_SPAN })); return; }
      var target = sp || { id: newId(), days: {} };
      target.kind = draft.kind;
      target.name = name.value.trim().slice(0, 40) || SP_KINDS[draft.kind][1];
      target.from = from;
      target.to = end;
      Object.keys(target.days).forEach(function (k) { if (k < from || k > end) delete target.days[k]; });
      if (!sp) tb.special.push(target);
      tb.special = cleanSpecial(tb.special);
      changed();
      if (!sp) say(t("追加しました。日を押して、その日の日程を入れてください"));
      openSpecial(target.id);
    });
  }

  // 1 日の日程（いつもの時間割・休み・特別な時間割）
  function editDay(sp, ds) {
    var tb = data.table, day = dayOf(sp, ds), di = todayIndex(parseYmd(ds));
    var draft = { type: day.type, slots: day.slots.map(function (x) { return Object.assign({}, x); }) };
    var box = el("div", "tt-edit");
    var seg = el("div", "tt-seg");
    seg.setAttribute("role", "radiogroup");
    [["normal", t("いつもどおり")], ["custom", t("特別な時間割")], ["off", t("休み")]].forEach(function (o) {
      var b = el("button", "m3-state", o[1]);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(draft.type === o[0]));
      b.addEventListener("click", function () {
        draft.type = o[0];
        Array.prototype.forEach.call(seg.children, function (x) { x.setAttribute("aria-checked", String(x === b)); });
        // はじめて「特別な時間割」にしたときは、1 行だけ用意する
        if (o[0] === "custom" && !slotBox.children.length) addRow({});
        sync();
      });
      seg.appendChild(b);
    });
    box.appendChild(seg);
    var slotBox = el("div", "sp-slots");
    var tools = el("div", "sp-tools");
    var addBtn = el("button", "text-btn m3-state");
    addBtn.type = "button";
    addBtn.append(icon("add"), el("span", "", t("行を追加")));
    var copyBtn = el("button", "text-btn m3-state");
    copyBtn.type = "button";
    copyBtn.append(icon("content_copy"), el("span", "", t("いつもの授業を入れる")));
    copyBtn.hidden = di < 0 || di >= tb.days;
    tools.append(addBtn, copyBtn);
    box.append(slotBox, tools);
    var note = input(day.note, 200, t("例: 持ち物は筆記用具だけ"));
    box.appendChild(field(t("メモ（その日のお知らせ）"), note));
    var known = subjects(tb);
    function addRow(x) {
      if (slotBox.children.length >= MAX_SLOTS) { say(t("1 日 {n} 行までです", { n: MAX_SLOTS })); return; }
      var last = slotBox.lastElementChild, lastEnd = last ? minutes(last.querySelector(".sp-slot__e").value) : null;
      var r = el("div", "sp-slot");
      var sIn = el("input", "sp-slot__s"); sIn.type = "time";
      var eIn = el("input", "sp-slot__e"); eIn.type = "time";
      if (x.s) sIn.value = x.s; else if (lastEnd !== null && lastEnd + 60 < 1440) sIn.value = hhmm(lastEnd + 10); else sIn.value = "09:00";
      eIn.value = x.e || hhmm(minutes(sIn.value) + 50);
      var subj = input(x.subject || "", 40, t("科目"));
      subj.classList.add("sp-slot__subject");
      var room = input(x.room || "", 30, t("教室"));
      room.classList.add("sp-slot__room");
      var del = el("button", "icon-btn m3-state");
      del.type = "button";
      del.setAttribute("aria-label", t("この行を消す"));
      del.appendChild(icon("close"));
      del.addEventListener("click", function () { r.remove(); });
      sIn.setAttribute("aria-label", t("始まり"));
      eIn.setAttribute("aria-label", t("終わり"));
      r.dataset.color = x.color || "";
      r.append(sIn, el("span", "", "〜"), eIn, subj, room, del);
      slotBox.appendChild(r);
    }
    function hhmm(m) { m = Math.max(0, Math.min(1439, m)); return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
    draft.slots.forEach(addRow);
    addBtn.addEventListener("click", function () { addRow({}); });
    copyBtn.addEventListener("click", function () {
      slotBox.textContent = "";
      for (var p = 0; p < tb.periods; p++) {
        var c = tb.cells[di + "-" + p];
        if (c) addRow({ s: tb.times[p].s, e: tb.times[p].e, subject: c.subject, room: c.room, color: c.color });
      }
      if (!slotBox.children.length) addRow({});
    });
    function sync() { slotBox.hidden = tools.hidden = draft.type !== "custom"; }
    sync();
    window.M3.dialog({ title: dateText(ds) + " · " + sp.name, icon: "event", body: box, actions: [{ label: t("キャンセル"), value: null }, { label: t("保存"), primary: true, value: "save" }] }).then(function (v) {
      if (v !== "save") { openSpecial(sp.id); return; }
      var slots = [], bad = 0;
      Array.prototype.forEach.call(slotBox.children, function (r) {
        var subject = r.querySelector(".sp-slot__subject").value.trim();
        if (!subject) return;
        var k = known[subject];
        var x = cleanSlot({ s: r.querySelector(".sp-slot__s").value, e: r.querySelector(".sp-slot__e").value, subject: subject, room: r.querySelector(".sp-slot__room").value.trim() || (k ? k.room : ""), color: r.dataset.color || (k ? k.color : COLORS[slots.length % COLORS.length]) });
        if (x) slots.push(x); else bad++;
      });
      slots.sort(function (a, b) { return minutes(a.s) - minutes(b.s); });
      var defType = sp.kind === "off" ? "off" : "normal";
      if (draft.type === defType && !note.value.trim()) delete sp.days[ds];
      else sp.days[ds] = { type: draft.type, note: note.value.trim().slice(0, 200), slots: draft.type === "custom" ? slots : [] };
      changed();
      if (bad) say(t("時刻がおかしい行 {n} 件は入れませんでした（終わりは始まりより後に）", { n: bad }));
      openSpecial(sp.id);
    });
  }

  // ================================================================
  // スナックバー
  // ================================================================
  var toast = $("toast"), toastText = $("toast-text"), toastAction = $("toast-action"), toastTimer, undoFn = null;
  function say(text, undo) {
    toastText.textContent = text;
    undoFn = undo || null;
    toastAction.hidden = !undo;
    toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove("is-on"); undoFn = null; }, undo ? 6000 : 3000);
  }
  toastAction.addEventListener("click", function () { if (undoFn) undoFn(); toast.classList.remove("is-on"); undoFn = null; });

  // ================================================================
  // コマ
  // ================================================================
  function field(label, input) {
    var w = el("label", "m3-field");
    w.append(el("span", "m3-field__label", label), input);
    return w;
  }
  function input(value, max, placeholder) {
    var i = el("input", "m3-field__input");
    i.type = "text";
    i.value = value || "";
    i.maxLength = max;
    if (placeholder) i.placeholder = placeholder;
    return i;
  }
  // ほかのコマで使っている科目（同じ科目を入れたら、教室・先生・色をそろえる）
  function subjects(tb) {
    var map = {};
    Object.keys(tb.cells).forEach(function (k) { var c = tb.cells[k]; if (!map[c.subject]) map[c.subject] = c; });
    return map;
  }
  function addHomework(key, tb, c) {
    var R = window.SKReminders;
    if (!R) return;
    var m = /^(\d)-(\d)$/.exec(key), due = nextDate(+m[1], +m[2], tb);
    var data2 = R.load(), now = Date.now();
    data2.tasks.push(R.upgradeTask({ id: newId(), list: data2.lists[0].id, text: t("{subject} の宿題", { subject: c.subject }), due: due ? ymd(due) : null, created: now, updated: now }, data2.lists));
    try { R.save(data2); } catch (e) { say(t("保存できませんでした")); return; }
    say(due ? t("Todo に追加しました（期限 {date}）", { date: new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", weekday: "short" }).format(due) }) : t("Todo に追加しました"));
  }

  function openCell(key) {
    var cur = current(), tb = cur.table, c = tb.cells[key];
    var m = /^(\d)-(\d)$/.exec(key), di = +m[1], p = +m[2];
    var title = DAY_NAMES[di] + " " + periodLabel(p) + "（" + tb.times[p].s + "〜" + tb.times[p].e + "）";
    if (cur.readonly) {
      if (!c) return;
      var body = el("div", "tt-detail");
      function row(ic, text, cls) { if (!text) return; var r = el("div", "tt-detail__row"); r.append(icon(ic), el("span", cls || "", text)); body.appendChild(r); }
      row("menu_book", c.subject);
      row("meeting_room", c.room);
      row("person", c.teacher);
      row("notes", c.note, "tt-detail__note");
      window.M3.dialog({ title: title, body: body, actions: [{ label: t("Todo に宿題を追加"), value: "hw" }, { label: t("閉じる"), primary: true, value: null }] })
        .then(function (v) { if (v === "hw") addHomework(key, tb, c); });
      return;
    }
    var draft = c ? Object.assign({}, c) : { subject: "", room: "", teacher: "", note: "", color: COLORS[(di * 3 + p) % COLORS.length] };
    var box = el("div", "tt-edit");
    var subj = input(draft.subject, 40, t("例: 数学"));
    var room = input(draft.room, 30, t("例: 201 教室"));
    var teacher = input(draft.teacher, 30);
    var note = el("textarea", "m3-field__input");
    note.value = draft.note || "";
    note.maxLength = 500;
    note.rows = 2;
    box.appendChild(field(t("科目"), subj));
    // 使っている科目から選ぶ
    var known = subjects(tb), names = Object.keys(known);
    if (names.length) {
      var chips = el("div", "tt-chips");
      names.slice(0, 16).forEach(function (n) {
        var ch = el("button", "tt-chip m3-state", n);
        ch.type = "button";
        ch.style.setProperty("--cc", known[n].color);
        ch.addEventListener("click", function () {
          subj.value = n;
          room.value = known[n].room || "";
          teacher.value = known[n].teacher || "";
          pick(known[n].color);
        });
        chips.appendChild(ch);
      });
      box.appendChild(chips);
    }
    var r = el("div", "tt-edit__row");
    r.append(field(t("教室"), room), field(t("先生"), teacher));
    box.appendChild(r);
    box.appendChild(field(t("メモ"), note));
    var colors = el("div", "tt-colors");
    colors.setAttribute("role", "radiogroup");
    colors.setAttribute("aria-label", t("色"));
    function pick(col) {
      draft.color = col;
      Array.prototype.forEach.call(colors.children, function (x) { x.setAttribute("aria-checked", String(x.dataset.c === col)); });
    }
    COLORS.forEach(function (col) {
      var b = el("button", "tt-color m3-state");
      b.type = "button";
      b.dataset.c = col;
      b.style.setProperty("--sw", col);
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", col);
      b.appendChild(icon("check"));
      b.addEventListener("click", function () { pick(col); });
      colors.appendChild(b);
    });
    box.appendChild(colors);
    pick(draft.color);
    // 同じ科目を入れたら、教室・先生・色をそろえる（まだ入れていなければ）
    subj.addEventListener("change", function () {
      var k = known[subj.value.trim()];
      if (!k) return;
      if (!room.value) room.value = k.room || "";
      if (!teacher.value) teacher.value = k.teacher || "";
      pick(k.color);
    });
    var actions = [{ label: t("キャンセル"), value: null }, { label: t("保存"), primary: true, value: "save" }];
    if (c) { actions.unshift({ label: t("Todo に宿題"), value: "hw" }); actions.unshift({ label: t("空ける"), danger: true, value: "clear" }); }
    window.M3.dialog({ title: title, body: box, actions: actions }).then(function (v) {
      if (v === "hw") { addHomework(key, tb, c); return; }
      if (v === "clear") {
        var removed = tb.cells[key];
        delete tb.cells[key];
        changed();
        say(t("{subject} を消しました", { subject: removed.subject }), function () { tb.cells[key] = removed; changed(); });
        return;
      }
      if (v !== "save") return;
      var name = subj.value.trim();
      if (!name) { if (c) { delete tb.cells[key]; changed(); } return; }
      tb.cells[key] = { subject: name.slice(0, 40), room: room.value.trim().slice(0, 30), teacher: teacher.value.trim().slice(0, 30), note: note.value.slice(0, 500), color: draft.color };
      changed();
    });
  }
  grid.addEventListener("click", function (e) {
    if (embed) return;
    var b = e.target.closest(".cell");
    if (b && b.dataset.special) { openSpecial(b.dataset.special); return; }
    if (b && b.dataset.key) { openCell(b.dataset.key); return; }
    if (b) return;
    var ph = e.target.closest(".grid__period[data-period]");
    if (ph) { openPeriod(+ph.dataset.period); return; }
    if (e.target.closest("#add-period")) addPeriod();
  });

  // 時限を 1 つ増やす（時刻は、前の時限の 10 分あとから 50 分。前の時限がなければ初期値）
  function addPeriod() {
    var tb = data.table;
    if (tb.periods >= 10) return;
    var p = tb.periods, prev = tb.times[p - 1];
    var pe = prev ? minutes(prev.e) : null;
    if (pe !== null && pe + 60 < 24 * 60) {
      var s = pe + 10, e = s + 50;
      tb.times[p] = { s: pad(Math.floor(s / 60)) + ":" + pad(s % 60), e: pad(Math.floor(e / 60)) + ":" + pad(e % 60) };
    }
    tb.periods = p + 1;
    changed();
    say(t("{n} 限を追加しました。番号を押すと時刻を変えられます", { n: p + 1 }));
  }

  // 1 つの時限の時刻を変える
  function openPeriod(p) {
    var tb = data.table;
    var box = el("div", "tt-edit");
    var row = el("div", "tt-time tt-time--one");
    var s = el("input"); s.type = "time"; s.value = tb.times[p].s; s.setAttribute("aria-label", t("始まり"));
    var e = el("input"); e.type = "time"; e.value = tb.times[p].e; e.setAttribute("aria-label", t("終わり"));
    var ls = el("label", "tt-time__field"); ls.append(el("span", "", t("始まり")), s);
    var le = el("label", "tt-time__field"); le.append(el("span", "", t("終わり")), e);
    row.append(ls, el("span", "", "〜"), le);
    box.appendChild(row);
    var err = el("p", "tt-error");
    box.appendChild(err);
    var actions = [{ label: t("キャンセル"), value: null }, { label: t("保存"), primary: true, value: "save" }];
    if (p === tb.periods - 1 && tb.periods > 1) actions.unshift({ label: t("この時限を消す"), danger: true, value: "remove" });
    window.M3.dialog({ title: t("{n} 限の時刻", { n: p + 1 }), icon: "schedule", body: box, actions: actions }).then(function (v) {
      if (v === "remove") {
        var removed = {};
        Object.keys(tb.cells).forEach(function (k) { if (+k.split("-")[1] === p) { removed[k] = tb.cells[k]; delete tb.cells[k]; } });
        tb.periods -= 1;
        changed();
        say(t("{n} 限を消しました", { n: p + 1 }), function () { Object.assign(tb.cells, removed); tb.periods = p + 1; changed(); });
        return;
      }
      if (v !== "save") return;
      var sm = minutes(s.value), em = minutes(e.value);
      if (sm === null || em === null || em <= sm) { say(t("終わりの時刻は、始まりより後にしてください")); return; }
      tb.times[p] = { s: s.value, e: e.value };
      changed();
    });
  }

  // ================================================================
  // 時間割の設定（名前・曜日・時限・時刻）
  // ================================================================
  function openSetup() {
    if (data.view !== "mine") { data.view = "mine"; save(); render(); }
    var tb = data.table, draft = { days: tb.days, periods: tb.periods };
    var box = el("div", "tt-edit");
    var name = input(tb.name, 40);
    box.appendChild(field(t("名前"), name));
    box.appendChild(el("p", "tt-label", t("曜日")));
    var seg = el("div", "tt-seg");
    seg.setAttribute("role", "radiogroup");
    [[5, t("月〜金")], [6, t("月〜土")]].forEach(function (o) {
      var b = el("button", "m3-state", o[1]);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(draft.days === o[0]));
      b.addEventListener("click", function () { draft.days = o[0]; Array.prototype.forEach.call(seg.children, function (x) { x.setAttribute("aria-checked", String(x === b)); }); });
      seg.appendChild(b);
    });
    box.appendChild(seg);
    var per = el("input", "m3-field__input");
    per.type = "number";
    per.min = 1; per.max = 10;
    per.value = draft.periods;
    per.inputMode = "numeric";
    box.appendChild(field(t("1 日の時限の数（1〜10）"), per));
    box.appendChild(el("p", "tt-label", t("授業の始まりと終わりの時刻")));
    var times = el("div", "tt-times");
    var rows = [];
    function drawTimes() {
      var n = Math.max(1, Math.min(10, Math.round(Number(per.value)) || 1));
      times.textContent = "";
      for (var p = 0; p < 10; p++) {
        if (!rows[p]) {
          var s = el("input"); s.type = "time"; s.value = tb.times[p].s;
          var e = el("input"); e.type = "time"; e.value = tb.times[p].e;
          s.setAttribute("aria-label", t("{n} 限の始まり", { n: p + 1 }));
          e.setAttribute("aria-label", t("{n} 限の終わり", { n: p + 1 }));
          rows[p] = { s: s, e: e };
        }
        if (p >= n) continue;
        var r = el("div", "tt-time");
        r.append(el("span", "", periodLabel(p)), rows[p].s, el("span", "", "〜"), rows[p].e);
        times.appendChild(r);
      }
    }
    per.addEventListener("input", drawTimes);
    drawTimes();
    box.appendChild(times);
    window.M3.dialog({ title: t("時間割の設定"), icon: "tune", body: box, actions: [{ label: t("キャンセル"), value: null }, { label: t("保存"), primary: true, value: "save" }] }).then(function (v) {
      if (v !== "save") return;
      tb.name = name.value.trim().slice(0, 40) || t("時間割");
      tb.days = draft.days;
      tb.periods = Math.max(1, Math.min(10, Math.round(Number(per.value)) || tb.periods));
      var bad = 0;
      rows.forEach(function (r, p) {
        var sm = minutes(r.s.value), em = minutes(r.e.value);
        if (sm === null || em === null || em <= sm) { if (p < tb.periods) bad++; return; }
        tb.times[p] = { s: r.s.value, e: r.e.value };
      });
      if (bad) say(t("終わりが始まりより前の時限 {n} 件は、時刻を変えませんでした", { n: bad }));
      firstRender = true;
      changed();
      if (!bad) say(t("時間割の設定を保存しました"));
    });
  }

  // ================================================================
  // 配信された時間割の受け取り・管理者の配信（/toolbox/timetable/share.js。ログインしているときだけ読み込む）
  // ================================================================
  function hint() { try { return JSON.parse(localStorage.getItem("skhub_account") || "null"); } catch (e) { return null; } }
  var share = null;
  function loadShare() {
    if (!share) share = import("/toolbox/timetable/share.js").catch(function (e) { share = null; throw e; });
    return share;
  }
  // 配信された時間割を取りに行く（なくなったものは消す）
  function receive(manual) {
    if (embed || !hint()) return Promise.resolve();
    return loadShare().then(function (m) { return m.receive(); }).then(function (res) {
      if (res.status !== "ready") {
        if (manual) say(res.status === "unregistered" ? t("SK Hub Systems アカウントの作成（規約への同意）がまだです") : t("ログインし直してください"));
        return;
      }
      var next = {};
      res.items.forEach(function (it) {
        var tb = null;
        try { tb = cleanTable(JSON.parse(it.json)); } catch (e) { return; }
        next[it.tid] = { title: str(it.title, 60), table: tb, updatedAt: it.updatedAt, fetchedAt: Date.now() };
      });
      // 新しい連絡を知らせる（はじめて受け取ったときは、前からある連絡は知らせない）
      var today = ymd(new Date()), fresh = [];
      Object.keys(next).forEach(function (id) {
        (next[id].table.notices || []).forEach(function (n) {
          if (!noticeActive(n, today) || data.notified.indexOf(n.id) >= 0) return;
          data.notified.push(n.id);
          if (Object.keys(data.received).length) fresh.push({ n: n, title: next[id].title });
        });
      });
      data.notified = idList(data.notified);
      fresh.slice(0, 3).forEach(function (f) {
        if (window.SKReminders) SKReminders.notify((f.n.important ? "❗ " : "") + f.n.title, f.n.body ? f.n.body.slice(0, 120) : "", "sk-notice-" + f.n.id, "timetable", {
          context: t("{class} の連絡", { class: f.title || t("クラス") }) + (NT_KINDS[f.n.kind] && f.n.kind !== "info" ? "（" + NT_KINDS[f.n.kind][1] + "）" : ""),
          important: f.n.important
        });
      });
      if (fresh.length) document.dispatchEvent(new CustomEvent("sk-island-flash", { detail: { icon: "campaign", text: t("連絡: {title}", { title: fresh[0].n.title }), color: "#6cd3f7" } }));
      function stamp(r) { return JSON.stringify(Object.keys(r).map(function (k) { return [k, r[k].updatedAt]; })); }
      var hadBefore = Object.keys(data.received).length > 0, before = stamp(data.received);
      data.received = next;
      if (data.view !== "mine" && !next[data.view]) data.view = "mine";
      // はじめて配信を受け取り、自分の時間割がまだ空なら、配信されたほうを表示する
      if (!hadBefore && res.items.length && !Object.keys(data.table.cells).length) data.view = res.items[0].tid;
      save();
      if (stamp(next) !== before) firstRender = true;
      render();
      $("receive-hint").hidden = true;
      if (manual) say(res.items.length ? t("配信された時間割を更新しました") : t("配信された時間割はありません"));
      // 配信した人（管理者）の「参加している人」に、名前とアイコンを出す
      if (res.items.length) loadShare().then(function (m) { return m.registerSelf(Object.keys(next), data.registered); }).then(function (r) {
        if (JSON.stringify(r) !== JSON.stringify(data.registered)) { data.registered = r; save(); }
      }).catch(function () { /* 次に開いたときにまた試す */ });
    }).catch(function () { if (manual) say(t("確認できませんでした。インターネットの接続を確認してください。")); });
  }

  // 管理者: 自分の時間割を、メールアドレスを入れた人に配信する
  function parseEmails(text) {
    var ok = [], bad = [];
    text.split(/[\s,;、，；]+/).forEach(function (s) {
      s = s.trim().toLowerCase();
      if (!s) return;
      if (!/^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]+$/.test(s) || s.length > 254) { bad.push(s); return; }
      if (ok.indexOf(s) < 0) ok.push(s);
    });
    return { ok: ok, bad: bad };
  }
  var MAX_MEMBERS = 200;
  // 配信する中身（時間割・特別な日程・連絡）
  function payloadOf(tb, name) {
    return JSON.stringify({ name: name, days: tb.days, periods: tb.periods, times: tb.times.slice(0, tb.periods), cells: tb.cells, special: tb.special, notices: tb.notices });
  }
  // いまの配信先のまま、配信を更新する（連絡の「保存して配信」）
  function republish() {
    var tb = data.table;
    if (!tb.share) return;
    say(t("配信しています…"));
    loadShare().then(function (m) {
      return m.loadMembers(tb.share.tid).catch(function () { return []; }).then(function (emails) {
        return m.publish({ tid: tb.share.tid, title: tb.share.title || tb.name, json: payloadOf(tb, tb.share.title || tb.name), emails: emails }).then(function () { return emails.length; });
      });
    }).then(function (count) {
      tb.share.publishedAt = Date.now();
      save(); render();
      say(t("配信を更新しました"));
      if (adminView) renderAdmin();
    }, function (e) {
      console.warn("[Timetable share]", e);
      say(t("配信できませんでした。管理者の SK Hub Systems アカウントでログインしているか確認してください。"));
    });
  }
  function openShare() {
    if (data.view !== "mine") { data.view = "mine"; save(); render(); }
    var tb = data.table;
    var box = el("div", "tt-edit tt-share");
    var info = el("p", "tt-info");
    info.append(icon("info"), el("span", "", t("自分の時間割を、メールアドレスを入れた人に配信します。受け取る人は、そのメールアドレスの SK Hub Systems アカウントでログインすると、時間割が表示されます（見るだけ）。メールアドレスは配信する相手を決めるためだけに使い、受け取る人どうしには見えません。")));
    box.appendChild(info);
    var title = input((tb.share && tb.share.title) || tb.name, 60, t("例: 2 年 3 組"));
    box.appendChild(field(t("配信する名前（クラス名など）"), title));
    var ta = el("textarea", "m3-field__input");
    ta.rows = 6;
    ta.placeholder = "taro@example.com\nhanako@example.com";
    ta.spellcheck = false;
    ta.autocapitalize = "off";
    box.appendChild(field(t("配信先のメールアドレス（1 行に 1 つ。なくてもよい。招待コードでも参加できます）"), ta));
    var count = el("p", "tt-count");
    box.appendChild(count);
    var err = el("p", "tt-error");
    err.setAttribute("role", "alert");
    box.appendChild(err);
    function recount() {
      var r = parseEmails(ta.value);
      count.textContent = t("{n} 人", { n: r.ok.length }) + (r.bad.length ? " · " + t("形がちがうもの {n} 件", { n: r.bad.length }) : "");
    }
    ta.addEventListener("input", recount);
    if (tb.share) {
      var st = el("p", "tt-info");
      var stale = tb.updated > tb.share.publishedAt;
      st.append(icon(stale ? "sync_problem" : "campaign"), el("span", "", stale
        ? t("配信したあとに時間割を変えています。「配信を更新」を押すと、受け取る人の時間割も新しくなります。")
        : t("配信中です（{date} に配信）", { date: new Date(tb.share.publishedAt).toLocaleString(locale) })));
      box.insertBefore(st, box.children[1]);
      ta.disabled = true;
      ta.placeholder = t("読み込み中…");
      loadShare().then(function (m) { return m.loadMembers(tb.share.tid); }).then(function (emails) {
        ta.disabled = false;
        ta.placeholder = "taro@example.com\nhanako@example.com";
        ta.value = emails.join("\n");
        recount();
      }, function () { ta.disabled = false; err.textContent = t("配信先を読み込めませんでした"); });
    }
    recount();
    var actions = [{ label: t("キャンセル"), value: null }, { label: tb.share ? t("配信を更新") : t("配信する"), primary: true, value: "publish" }];
    if (tb.share) actions.unshift({ label: t("配信をやめる"), danger: true, value: "stop" });
    window.M3.dialog({ title: t("時間割を配信"), icon: "campaign", body: box, actions: actions }).then(function (v) {
      if (v === "stop") {
        return window.M3.confirm({ title: t("配信をやめますか？"), text: t("受け取っていた人の画面から、この時間割が消えます。あなたの時間割は消えません。"), ok: t("配信をやめる"), danger: true }).then(function (yes) {
          if (!yes) return;
          say(t("配信をやめています…"));
          return loadShare().then(function (m) { return m.unpublish(tb.share.tid); }).then(function () {
            delete tb.share;
            save(); render();
            say(t("配信をやめました"));
          }, function () { say(t("うまくいきませんでした。時間をおいてもう一度お試しください。")); });
        });
      }
      if (v !== "publish") return;
      var r = parseEmails(ta.value);
      // メールアドレスなしでも配信できる（招待コードで参加してもらう）
      if (r.ok.length > MAX_MEMBERS) { say(t("配信先は {n} 人までです", { n: MAX_MEMBERS })); return; }
      var name = title.value.trim().slice(0, 60) || tb.name;
      var payload = payloadOf(tb, name);
      say(t("配信しています…"));
      loadShare().then(function (m) { return m.publish({ tid: tb.share && tb.share.tid, title: name, json: payload, emails: r.ok }); }).then(function (tid) {
        tb.share = { tid: tid, title: name, publishedAt: Date.now() };
        save(); render();
        say((r.ok.length ? t("{n} 人に配信しました", { n: r.ok.length }) : t("配信しました。招待コードで参加してもらえます")) + (r.bad.length ? " · " + t("形がちがうメールアドレス {n} 件は入れませんでした", { n: r.bad.length }) : ""));
        if (adminView) renderAdmin();
      }, function (e) {
        console.warn("[Timetable share]", e);
        say(t("配信できませんでした。管理者の SK Hub Systems アカウントでログインしているか確認してください。"));
      });
    });
  }

  // ================================================================
  // LINE で送る（/toolbox/shared/line.js。LINE の中では友だち・グループを選んでカードで、外では LINE の共有のリンクで）
  // ================================================================
  var TT_URL = "https://sk-hub.jp/toolbox/timetable/";
  function lineDone(r) { if (r === "sent") say(t("LINE で送りました")); }
  // 今日（0）・明日（1）の時間割（特別な日程・休みも）
  function shareDay(offset) {
    if (!window.SKLine) return;
    var cur = current(), tb = cur.table, d = new Date();
    d.setDate(d.getDate() + offset);
    var plan = dayPlan(tb, d), when = (offset === 0 ? t("今日") : t("明日")) + " " + dateText(ymd(d));
    var rows = [], sub = "", lines = [];
    if (plan.off) sub = t("お休みです");
    else if (plan.noSchool || !plan.slots.some(function (s) { return s.cell; })) sub = t("授業はありません");
    plan.slots.forEach(function (s) {
      if (!s.cell) return;
      rows.push([t("{n} 限", { n: s.label }) + (s.s ? " " + s.s : ""), s.cell.subject + (s.cell.room ? "（" + s.cell.room + "）" : "")]);
      lines.push(t("{n} 限", { n: s.label }) + " " + s.cell.subject);
    });
    var kicker = cur.title + (plan.special ? " · " + plan.special.name : "");
    SKLine.share(SKLine.card({
      alt: t("{when} の時間割", { when: when }), kicker: kicker, title: t("{when} の時間割", { when: when }), sub: sub, rows: rows, color: "#0891b2", url: TT_URL, button: t("時間割を開く")
    }), t("{when} の時間割", { when: when }) + "（" + kicker + "）\n" + (sub || lines.join("\n")) + "\n" + TT_URL).then(lineDone);
  }
  // クラスへの連絡
  function shareNotice(n, classTitle) {
    if (!window.SKLine) return;
    var kind = NT_KINDS[n.kind][1];
    SKLine.share(SKLine.card({
      alt: n.title, kicker: (classTitle ? classTitle + " · " : "") + kind + (n.date ? " · " + dateText(n.date) : ""), title: n.title, sub: n.body || "", color: n.important ? "#dc2626" : "#0891b2", url: TT_URL, button: t("時間割を開く")
    }), "【" + kind + "】" + n.title + (n.body ? "\n" + n.body : "") + "\n" + TT_URL).then(lineDone);
  }
  // 招待コード（押すとそのまま参加の画面へ）
  function shareInvite(x) {
    if (!window.SKLine) return;
    var tb = data.table, title = (tb.share && tb.share.title) || tb.name, until = new Date(x.expiresAt).toLocaleDateString(locale);
    SKLine.share(SKLine.card({
      alt: t("「{title}」の時間割に参加", { title: title }), kicker: t("時間割の招待"), title: title,
      sub: t("押すと参加できます。招待コード {code}（{date} まで）", { code: formatCode(x.code), date: until }), color: "#0891b2", url: joinUrl(x.code), button: t("参加する")
    }), t("「{title}」の時間割に参加してください", { title: title }) + "\n" + joinUrl(x.code)).then(lineDone);
  }

  // ================================================================
  // 招待コードで参加（受け取る人）
  // ================================================================
  function loginUrl(next) { return (I18N && I18N.path ? I18N.path("/account/") : "/account/") + "?next=" + encodeURIComponent(next || location.pathname); }
  function askJoin() {
    window.M3.prompt({ title: t("招待コードで参加"), label: t("招待コード（例: K7QM-3XRA）"), placeholder: "XXXX-XXXX", ok: t("次へ"), maxLength: 20 }).then(function (v) { if (v) doJoin(v); });
  }
  function doJoin(code) {
    // LINE の中では、LINE でログインしてから参加する（/toolbox/shared/line.js）
    if (!hint() && window.SKLine && SKLine.inLine) {
      window.M3.dialog({ title: t("ログインしてください"), icon: "login", body: el("p", "tbs-dialog__text", t("招待コードで参加するには、SK Hub Systems アカウントにログインします。LINE でログインできます。")),
        actions: [{ label: t("キャンセル"), value: null }, { label: t("LINE でログイン"), primary: true, value: "login" }] })
        .then(function (v) {
          if (v !== "login") return;
          return SKLine.signIn().then(function (r) { if (r === "ready") doJoin(code); }, function () { say(t("ログインできませんでした。時間をおいてもう一度お試しください。")); });
        });
      return;
    }
    if (!hint()) {
      window.M3.dialog({ title: t("ログインしてください"), icon: "login", body: el("p", "tbs-dialog__text", t("招待コードで参加するには、SK Hub Systems アカウント（Google・GitHub）でログインします。ログインしたあと、もう一度招待のリンクを開いてください。")),
        actions: [{ label: t("キャンセル"), value: null }, { label: t("ログイン"), primary: true, value: "login" }] })
        .then(function (v) { if (v === "login") location.href = loginUrl(location.pathname + "?join=" + encodeURIComponent(code)); });
      return;
    }
    say(t("招待コードを確かめています…"));
    loadShare().then(function (m) {
      return m.checkInvite(code).then(function (info) {
        if (info.status === "signed-out") { say(t("ログインし直してください")); return; }
        if (info.status === "unregistered") { say(t("SK Hub Systems アカウントの作成（規約への同意）がまだです")); return; }
        if (info.status === "not-found") { say(t("招待コードが見つかりません。もう一度確かめてください")); return; }
        if (info.status === "expired") { say(t("この招待コードは期限が切れています。配信している人に新しいコードをもらってください")); return; }
        if (info.joined) { say(t("「{title}」にはもう参加しています", { title: info.title })); receive(true); return; }
        var body = el("div", "tt-edit");
        var p1 = el("p", "tt-info");
        p1.append(icon("school"), el("span", "", t("「{title}」の時間割と連絡が届くようになります（見るだけ）。", { title: info.title })));
        var p2 = el("p", "tt-info");
        p2.append(icon("visibility"), el("span", "", info.email
          ? t("配信している人（管理者）に、あなたの名前（{name}）とメールアドレス（{email}）が伝わります。ほかの参加者には見えません。", { name: info.name || t("名前なし"), email: info.email })
          : t("配信している人（管理者）に、あなたの名前（{name}）とアイコンが伝わります。ほかの参加者には見えません。", { name: info.name || t("名前なし") })));
        body.append(p1, p2);
        return window.M3.dialog({ title: t("「{title}」に参加しますか？", { title: info.title }), icon: "group_add", body: body, actions: [{ label: t("キャンセル"), value: null }, { label: t("参加する"), primary: true, value: "join" }] }).then(function (v) {
          if (v !== "join") return;
          return m.joinWithCode(info).then(function () {
            say(t("「{title}」に参加しました", { title: info.title }));
            receive(false);
          });
        });
      });
    }).catch(function (e) {
      console.warn("[Timetable join]", e);
      say(e && e.code === "too-many" ? t("受け取れる時間割は 20 個までです") : t("参加できませんでした。時間をおいてもう一度お試しください。"));
    });
  }

  // ================================================================
  // 管理者の画面（#admin。管理者だけ）: 配信・連絡・特別な日程・招待コード・参加している人をまとめて
  // ================================================================
  // again … 読み込み中に読み込み直しを頼まれた（終わったら、もう一度読み込む）
  var adminView = false, adminPushed = false, adminCache = { tid: null, invites: null, joins: null, members: null, loading: false, again: false };
  function openAdmin() {
    if (!admin) return;
    if (data.view !== "mine") { data.view = "mine"; save(); }
    adminView = true;
    root.classList.add("is-admin-view");
    if (location.hash !== "#admin") { history.pushState(null, "", location.pathname + "#admin"); adminPushed = true; }
    adminCache.tid = null;
    render();
    window.scrollTo(0, 0);
  }
  function closeAdmin() {
    adminView = false;
    adminPushed = false;
    root.classList.remove("is-admin-view");
    if (location.hash === "#admin") history.replaceState(null, "", location.pathname);
    firstRender = true;
    render();
  }
  // 画面の「戻る」: 開いたときに履歴を足したなら、ブラウザの戻ると同じに（履歴に #admin を残さない）
  function leaveAdmin() {
    if (adminPushed && location.hash === "#admin") history.back();
    else closeAdmin();
  }
  window.addEventListener("popstate", function () { if (adminView && location.hash !== "#admin") closeAdmin(); else if (!adminView && location.hash === "#admin" && admin) openAdmin(); });
  // 招待コード・参加している人・メールアドレスの配信先を読み込む（管理者の画面を開いたとき・変えたとき）
  function loadAdminData(force) {
    var tb = data.table;
    if (!tb.share) return;
    var tid = tb.share.tid;
    if (adminCache.loading) { if (force || adminCache.tid !== tid) adminCache.again = true; return; }
    if (!force && adminCache.tid === tid) return;
    // ちがう配信になったら、前の配信の招待コード・参加している人は出さない
    if (adminCache.tid !== tid) adminCache.invites = adminCache.joins = adminCache.members = null;
    adminCache.loading = true;
    adminCache.tid = tid;
    loadShare().then(function (m) {
      return Promise.all([
        m.listInvites(tid).catch(function () { return null; }),
        m.listJoins(tid).catch(function () { return null; }),
        m.loadMembers(tid).catch(function () { return null; })
      ]);
    }).then(function (r) {
      if (adminCache.tid === tid) { adminCache.invites = r[0]; adminCache.joins = r[1]; adminCache.members = r[2]; }
    }).catch(function () { /* 読めなかった */ }).then(function () {
      adminCache.loading = false;
      if (adminCache.again) { adminCache.again = false; loadAdminData(true); }
      if (adminView) renderAdmin();
    });
  }
  function adminSection(title, iconName, actions) {
    var sec = el("section", "ad-section");
    var head = el("div", "ad-section__head");
    var h = el("h2", "ad-section__title");
    h.append(icon(iconName), el("span", "", title));
    head.appendChild(h);
    (actions || []).forEach(function (a) {
      var b = el("button", (a.primary ? "m3-btn m3-btn--tonal" : "text-btn") + " m3-state");
      b.type = "button";
      b.append(icon(a.icon), el("span", "", a.label));
      b.addEventListener("click", a.run);
      head.appendChild(b);
    });
    sec.appendChild(head);
    return sec;
  }
  function renderAdmin() {
    var box = $("admin"), tb = data.table, today = ymd(new Date());
    box.textContent = "";
    var top = el("div", "ad-top");
    var back = el("button", "icon-btn m3-state");
    back.type = "button";
    back.setAttribute("aria-label", t("時間割に戻る"));
    back.appendChild(icon("arrow_back"));
    back.addEventListener("click", leaveAdmin);
    var tt = el("div", "ad-top__text");
    tt.append(el("h1", "head__title", t("管理者の画面")), el("p", "head__sub", t("配信・連絡・特別な日程・招待コード・参加している人")));
    top.append(back, tt);
    box.appendChild(top);

    // 配信
    var sec = adminSection(t("配信"), "campaign", tb.share ? [{ icon: "tune", label: t("配信の設定"), run: openShare }, { icon: "sync", label: t("配信を更新"), primary: true, run: republish }] : [{ icon: "campaign", label: t("配信する"), primary: true, run: openShare }]);
    var card = el("div", "ad-status");
    if (!tb.share) {
      card.append(icon("cloud_off"), el("span", "", t("まだ配信していません。配信すると、メールアドレスや招待コードでクラスの人に届けられます。")));
    } else {
      var stale = tb.updated > tb.share.publishedAt;
      card.classList.toggle("is-stale", stale);
      var tx = el("div", "ad-status__text");
      tx.append(el("b", "", tb.share.title || tb.name), el("span", "", stale ? t("配信したあとに変えたところがあります。「配信を更新」を押すと届きます") : t("配信中（{date} に更新）", { date: new Date(tb.share.publishedAt).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) })));
      var counts = el("div", "ad-counts");
      function count(n, label) { var c = el("div", "ad-count"); c.append(el("b", "", n === null ? (adminCache.loading ? "…" : "—") : String(n)), el("span", "", label)); counts.appendChild(c); }
      var ppl = peopleOf();
      count(ppl ? ppl.length : null, t("参加している人"));
      count(ppl && adminCache.joins ? ppl.filter(function (p) { return p.pending; }).length : null, t("まだ開いていない"));
      count((tb.notices || []).filter(function (n) { return noticeActive(n, today); }).length, t("出している連絡"));
      card.append(icon(stale ? "sync_problem" : "cloud_done"), tx, counts);
    }
    sec.appendChild(card);
    box.appendChild(sec);

    // 連絡・特別な日程（時間割の画面と同じ一覧）
    var nBox = el("section", "ad-section ad-list");
    renderNotices(tb, false, nBox);
    nBox.addEventListener("click", listClick);
    box.appendChild(nBox);
    var sBox = el("section", "ad-section ad-list");
    renderSpecials(tb, false, sBox);
    sBox.addEventListener("click", listClick);
    box.appendChild(sBox);

    // 招待コード
    var inv = adminSection(t("招待コード"), "key", tb.share ? [{ icon: "add", label: t("招待コードを作る"), primary: true, run: makeInvite }] : []);
    if (!tb.share) inv.appendChild(el("p", "specials__empty", t("招待コードは、配信してから作れます。")));
    else if (!adminCache.invites) inv.appendChild(el("p", "specials__empty", adminCache.loading ? t("読み込み中…") : t("読み込めませんでした。Firebase のルールが新しくなっているか確かめてください。")));
    else if (!adminCache.invites.length) inv.appendChild(el("p", "specials__empty", t("招待コードを作って配ると、メールアドレスを集めなくても、みんなが自分で参加できます。")));
    else {
      var list = el("div", "ad-rows");
      adminCache.invites.forEach(function (x) {
        var r = el("div", "ad-row" + (x.expiresAt <= Date.now() ? " is-ended" : ""));
        var left = Math.ceil((x.expiresAt - Date.now()) / 864e5);
        var tx2 = el("div", "ad-row__text");
        tx2.append(el("b", "ad-code", formatCode(x.code)), el("span", "", x.expiresAt <= Date.now() ? t("期限切れ") : t("あと {n} 日使えます", { n: left })));
        r.append(icon("key"), tx2);
        if (x.expiresAt > Date.now()) {
          r.appendChild(rowBtn("link", t("リンクをコピー"), function () { copyText(joinUrl(x.code), t("参加のリンクをコピーしました")); }));
          r.appendChild(rowBtn("qr_code_2", t("QR コード"), function () { showQr(x); }));
        }
        r.appendChild(rowBtn("delete", t("削除"), function () { removeInvite(x); }));
        list.appendChild(r);
      });
      inv.appendChild(list);
    }
    box.appendChild(inv);

    // 参加している人（招待コードで参加した人・メールアドレスの配信先の人。管理者だけが見られる）
    var mem = adminSection(t("参加している人"), "group", tb.share ? [{ icon: "refresh", label: t("読み込み直す"), run: function () { loadAdminData(true); renderAdmin(); } }] : []);
    if (tb.share) {
      var people = peopleOf();
      if (!people) mem.appendChild(el("p", "specials__empty", adminCache.loading ? t("読み込み中…") : t("読み込めませんでした。")));
      else if (!people.length) mem.appendChild(el("p", "specials__empty", t("まだだれもいません。メールアドレスか招待コードで届けると、ここに出ます。")));
      else {
        mem.appendChild(el("p", "ad-note ad-note--top", t("{n} 人 · 名前とアイコンは、その人が時間割を開くと出ます。ほかの参加者には見えません。", { n: people.length })));
        if (!adminCache.loading && (!adminCache.joins || !adminCache.members)) mem.appendChild(el("p", "ad-note ad-note--top", t("一部を読み込めませんでした。「読み込み直す」を押してください。")));
        var rows = el("div", "ad-rows");
        people.forEach(function (p) {
          var r = el("div", "ad-row" + (p.pending ? " is-pending" : ""));
          var tx3 = el("div", "ad-row__text");
          tx3.append(el("b", "", p.name || p.email), el("span", "", [p.name ? p.email : "", p.pending ? t("まだ開いていません") : "", p.via === "code" ? t("招待コード") : t("メールアドレス"), p.joinedAt ? t("{date} から", { date: new Date(p.joinedAt).toLocaleDateString(locale) }) : ""].filter(Boolean).join(" · ")));
          r.append(avatar(p), tx3, rowBtn("person_remove", t("外す"), function () { removePerson(p); }));
          rows.appendChild(r);
        });
        mem.appendChild(rows);
      }
    } else mem.appendChild(el("p", "specials__empty", t("配信すると、ここに参加している人が出ます。")));
    box.appendChild(mem);
    loadAdminData(false);
  }
  // 参加している人の一覧: 名前・アイコンのある人（joins）と、まだ開いていないメールアドレスの配信先
  //   片方だけ読めたときは、読めたほうだけで出す（どちらも読めなければ null）
  function peopleOf() {
    var joins = adminCache.joins, members = adminCache.members;
    if (!joins && !members) return null;
    var byEmail = {}, out = [];
    (joins || []).forEach(function (j) { if (j.email) byEmail[j.email] = true; out.push(personOf(j)); });
    (members || []).forEach(function (e) { if (!byEmail[e]) out.push({ email: e, name: "", photo: "", color: "", via: "email", pending: true, member: true }); });
    if (members) out.forEach(function (p) { if (p.email && members.indexOf(p.email) >= 0) p.member = true; });
    return out.sort(function (a, b) { return (a.pending - b.pending) || (a.name || a.email).localeCompare(b.name || b.email, locale); });
  }
  function personOf(j) { return { uid: j.uid, email: j.email, name: j.name, photo: j.photo, color: j.color, via: j.code ? "code" : "email", joinedAt: j.joinedAt, pending: false }; }
  function avatar(p) {
    var a = el("span", "ad-avatar");
    if (p.photo) {
      var img = el("img");
      img.src = p.photo;
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.addEventListener("error", function () { img.remove(); a.textContent = (p.name || p.email || "?").charAt(0).toUpperCase(); });
      a.appendChild(img);
    } else if (p.pending) a.appendChild(icon("mail"));
    else a.textContent = (p.name || p.email || "?").charAt(0).toUpperCase();
    if (p.color && /^#[0-9a-f]{3,8}$/i.test(p.color)) a.style.background = p.color;
    return a;
  }
  function rowBtn(iconName, label, fn) {
    var b = el("button", "icon-btn m3-state");
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    b.appendChild(icon(iconName));
    b.addEventListener("click", fn);
    return b;
  }
  function formatCode(code) { return code.length === 8 ? code.slice(0, 4) + "-" + code.slice(4) : code; }
  function joinUrl(code) { return location.origin + "/toolbox/timetable/?join=" + code; }
  function copyText(text, done) {
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { say(done); }, function () { say(text); });
    else say(text);
  }
  function makeInvite() {
    var tb = data.table;
    if (!tb.share) return;
    window.M3.choose({ title: t("招待コードを作る"), options: [{ value: 1, label: t("1 日だけ使える"), icon: "today" }, { value: 7, label: t("7 日間使える"), icon: "date_range" }, { value: 30, label: t("30 日間使える"), icon: "calendar_month" }], value: 7 }).then(function (days) {
      if (!days) return;
      loadShare().then(function (m) { return m.createInvite({ tid: tb.share.tid, title: tb.share.title || tb.name, days: days }); }).then(function (code) {
        loadAdminData(true);
        showQr({ code: code, expiresAt: Date.now() + days * 864e5 });
      }, function (e) { console.warn("[Timetable invite]", e); say(t("招待コードを作れませんでした。Firebase のルールが新しくなっているか確かめてください。")); });
    });
  }
  function removeInvite(x) {
    window.M3.confirm({ title: t("この招待コードを消しますか？"), text: t("このコードでは、もう参加できなくなります。参加済みの人はそのままです。"), ok: t("削除"), danger: true }).then(function (yes) {
      if (!yes) return;
      loadShare().then(function (m) { return m.deleteInvite(x.code); }).then(function () { say(t("招待コードを消しました")); loadAdminData(true); }, function () { say(t("消せませんでした")); });
    });
  }
  function removePerson(p) {
    var tb = data.table;
    window.M3.confirm({ title: t("{name} を外しますか？", { name: p.name || p.email }), text: p.member
      ? t("メールアドレスの配信先からも外し、この人の画面から配信した時間割と連絡が消えます。")
      : t("この人の画面から、配信した時間割と連絡が消えます。招待コードが有効なら、また参加できます。"), ok: t("外す"), danger: true }).then(function (yes) {
      if (!yes) return;
      say(t("外しています…"));
      loadShare().then(function (m) {
        var job = Promise.resolve();
        // メールアドレスの配信先なら、配信先から外して配信を更新する（受け取り箱からも消える）
        if (p.member) job = m.loadMembers(tb.share.tid).then(function (emails) {
          var next = emails.filter(function (e) { return e !== p.email; });
          return m.publish({ tid: tb.share.tid, title: tb.share.title || tb.name, json: payloadOf(tb, tb.share.title || tb.name), emails: next }).then(function () { tb.share.publishedAt = Date.now(); save(); });
        });
        return job.then(function () { return m.removeJoin(tb.share.tid, p); });
      }).then(function () { say(t("外しました")); loadAdminData(true); }, function () { say(t("外せませんでした")); });
    });
  }
  // QR コード（qrcode-generator を cdnjs から。読めなければ、コードとリンクだけ）
  var qrLib = null;
  function loadQr() {
    if (window.qrcode) return Promise.resolve(window.qrcode);
    if (!qrLib) qrLib = new Promise(function (resolve, reject) {
      var sc = document.createElement("script");
      sc.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js";
      sc.onload = function () { window.qrcode ? resolve(window.qrcode) : reject(new Error("no qrcode")); };
      sc.onerror = function () { qrLib = null; reject(new Error("load failed")); };
      document.head.appendChild(sc);
    });
    return qrLib;
  }
  function showQr(x) {
    var url = joinUrl(x.code);
    var body = el("div", "ad-qr");
    var pic = el("div", "ad-qr__pic");
    pic.appendChild(el("span", "ad-qr__loading", t("読み込み中…")));
    body.appendChild(pic);
    body.appendChild(el("p", "ad-qr__code", formatCode(x.code)));
    body.appendChild(el("p", "ad-qr__hint", t("カメラで読み取るか、Timetable の「︙」→「招待コードで参加」にコードを入れると参加できます。{date} まで使えます。", { date: new Date(x.expiresAt).toLocaleDateString(locale) })));
    var link = el("p", "ad-qr__url", url);
    body.appendChild(link);
    loadQr().then(function (qrcode) {
      var q = qrcode(0, "M");
      q.addData(url);
      q.make();
      pic.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    }).catch(function () { pic.textContent = ""; pic.hidden = true; });
    var qrActions = [{ label: t("リンクをコピー"), value: "copy" }, { label: t("閉じる"), primary: true, value: null }];
    if (window.SKLine) qrActions.unshift({ label: t("LINE で送る"), value: "line" });
    window.M3.dialog({ title: t("招待コード"), icon: "qr_code_2", body: body, actions: qrActions }).then(function (v) {
      if (v === "copy") copyText(url, t("参加のリンクをコピーしました"));
      if (v === "line") shareInvite(x);
    });
  }

  // ================================================================
  // メニュー
  // ================================================================
  var menu = $("menu"), menuBtn = $("btn-menu");
  function setMenu(open) {
    // 「LINE で送る」は /toolbox/shared/line.js があるとき
    if (open) Array.prototype.forEach.call(menu.querySelectorAll("[data-line-only]"), function (b) { b.hidden = !window.SKLine; });
    menu.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open)); if (open) menu.querySelector("button:not([hidden])").focus();
  }
  menuBtn.addEventListener("click", function () { setMenu(menu.hidden); });
  document.addEventListener("click", function (e) { if (!menu.hidden && !e.target.closest(".menu-wrap")) setMenu(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) { setMenu(false); menuBtn.focus(); } });
  menu.addEventListener("click", function (e) {
    var b = e.target.closest("[data-menu]");
    if (!b) return;
    setMenu(false);
    var cmd = b.dataset.menu;
    if (cmd === "setup") openSetup();
    else if (cmd === "special") editSpecialInfo(null);
    else if (cmd === "notice") editNotice(null);
    else if (cmd === "admin") openAdmin();
    else if (cmd === "line-today") shareDay(0);
    else if (cmd === "line-tomorrow") shareDay(1);
    else if (cmd === "join") askJoin();
    else if (cmd === "share") openShare();
    else if (cmd === "refresh") receive(true);
    else if (cmd === "export") {
      var url = URL.createObjectURL(new Blob([JSON.stringify({ app: "sk-timetable", version: 1, exportedAt: new Date().toISOString(), table: data.table }, null, 2)], { type: "application/json" }));
      var a = el("a"); a.href = url; a.download = "timetable-backup-" + ymd(new Date()).replace(/-/g, "") + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } else if (cmd === "import") $("import-file").click();
  });
  $("btn-setup").addEventListener("click", openSetup);
  $("btn-admin").addEventListener("click", openAdmin);
  $("import-file").addEventListener("change", function () {
    var file = this.files && this.files[0];
    this.value = "";
    if (!file) return;
    file.text().then(function (text) {
      var d = JSON.parse(text);
      if (!d || d.app !== "sk-timetable" || !d.table) throw new Error("not a backup");
      return window.M3.confirm({ title: t("バックアップを読み込みますか？"), text: t("いまの自分の時間割は、バックアップの内容に置きかわります。"), ok: t("読み込む") }).then(function (yes) {
        if (!yes) return;
        var keep = data.table.share;
        data.table = cleanTable(d.table);
        if (keep) data.table.share = keep;
        data.view = "mine";
        firstRender = true;
        changed();
        say(t("読み込みました"));
      });
    }).catch(function () { say(t("読み込めませんでした。Timetable のバックアップのファイルを選んでください")); });
  });

  // ================================================================
  // はじめ
  // ================================================================
  render();
  if (embed) return;
  // 1 分ごとに、いまの授業を新しく
  //   管理者の画面では作り直さない（押そうとしたボタンやフォーカスが入れかわるため。中身が変わったときは、そのたびに作り直す）
  setInterval(function () { if (document.visibilityState === "visible" && !adminView && !document.querySelector(".tbs-dialog-scrim")) render(); }, 30000);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible" && !adminView) render(); });
  window.addEventListener("storage", function (e) { if (e.key === STORE) { load(); render(); } });

  // 招待のリンク（?join=コード）で開いたとき
  var joinParam = /[?&]join=([A-Za-z0-9-]{8,20})/.exec(location.search);
  if (joinParam) {
    history.replaceState(null, "", location.pathname + location.hash);
    setTimeout(function () { doJoin(joinParam[1]); }, 300);
  }

  // ログインしているとき: 配信された時間割を受け取る。管理者なら「配信」を出す
  var signedIn = !!hint();
  $("menu-refresh").hidden = !signedIn;
  $("receive-hint").hidden = signedIn || Object.keys(data.received).length > 0;
  $("receive-login").href = (I18N && I18N.path ? I18N.path("/account/") : "/account/") + "?next=" + encodeURIComponent(location.pathname);
  // LINE の中では、LINE でログインする（/toolbox/shared/line.js）。ログインできたら受け取る
  $("receive-login").addEventListener("click", function (e) {
    if (!window.SKLine || !SKLine.inLine) return;
    e.preventDefault();
    SKLine.signIn().then(function (r) {
      if (r !== "ready") return;
      $("receive-hint").hidden = true;
      $("menu-refresh").hidden = false;
      receive(true);
    }, function () { say(t("ログインできませんでした。時間をおいてもう一度お試しください。")); });
  });
  if (signedIn) {
    receive(false);
    setInterval(function () { if (document.visibilityState === "visible") receive(false); }, 30 * 60 * 1000);
    loadShare().then(function (m) { return m.isAdmin(); }).then(function (yes) {
      admin = !!yes;
      $("menu-share").hidden = !admin;
      $("menu-notice").hidden = !admin;
      $("menu-admin").hidden = !admin;
      $("btn-admin").hidden = !admin;
      if (admin && location.hash === "#admin") openAdmin();
      else if (admin) render();
    }).catch(function () { /* 管理者でない */ });
  }
})();
