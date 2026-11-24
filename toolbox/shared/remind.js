// SK's Toolbox のリマインダー（Todo）の共通（Todo・ホーム画面・Clock で読み込む）
//   window.SKReminders
//     load()            … localStorage の sk_todo を読む（1 つ前の形も、いまの形に直す）
//     save(data)        … 書く
//     complete(task, data) … 完了にする。繰り返しのものは、次の日付に進めて未完了のまま（{ next: "YYYY-MM-DD" } を返す）
//     nextDue(due, repeat) … 繰り返しの次の日付
//     LIST_COLORS・LIST_ICONS … リストの色（SK's Brand の色など）とアイコン
//   ・データ: { version: 2, lists: [{ id, name, color, icon }], tasks: [...], view, showDone: { リスト: true }, sort: { リスト: "manual|due|priority|title" } }
//       task: { id, list, text, notes, url, done, doneAt, flagged, priority (0 なし・1 低・2 中・3 高),
//               due: "YYYY-MM-DD" | null, time: "HH:MM" | null, repeat: null | "daily|weekdays|weekly|biweekly|monthly|yearly",
//               parent: 親のタスクの id | null（サブタスク）, created, updated }
//   ・通知: 時刻を決めたものは、その時刻に通知する（通知を許可したときだけ）。
//       サーバーを使わないので、Toolbox のページ（Todo・ホーム画面・Clock など）を開いているあいだだけ届く。
//       通知したものは sk_todo_notified に { タスクの id: "日付 時刻" } で覚えて、同じものを 2 回出さない
(function () {
  "use strict";
  var STORE = "sk_todo", NOTIFIED = "sk_todo_notified", DEFAULT_LIST = "inbox";
  var I18N = window.SKI18N;
  function t(s, p) { return I18N ? I18N.t(s, p) : s.replace(/\{(\w+)\}/g, function (m, k) { return p && k in p ? p[k] : m; }); }

  var LIST_COLORS = ["#2563eb", "#db2777", "#16a34a", "#ea580c", "#7c3aed", "#0891b2", "#334155", "#dc2626", "#ca8a04", "#8d6e63"];
  var LIST_ICONS = ["list", "bookmark", "home", "work", "school", "shopping_cart", "favorite", "star", "flight", "fitness_center", "restaurant", "pets", "menu_book", "music_note", "celebration", "savings"];
  var REPEATS = ["daily", "weekdays", "weekly", "biweekly", "monthly", "yearly"];

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parseYmd(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }

  function upgradeTask(x, lists) {
    var task = {
      id: String(x.id),
      list: x.list && lists.some(function (l) { return l.id === x.list; }) ? x.list : lists[0].id,
      text: String(x.text || ""),
      notes: typeof x.notes === "string" ? x.notes : "",
      url: typeof x.url === "string" && /^https?:\/\//i.test(x.url) ? x.url : "",
      done: !!x.done,
      doneAt: Number(x.doneAt) || null,
      flagged: !!(x.flagged || x.star), // 1 つ前の形の ★
      priority: Math.max(0, Math.min(3, Number(x.priority) || 0)),
      due: parseYmd(x.due) ? x.due : null,
      time: /^\d{2}:\d{2}$/.test(x.time || "") ? x.time : null,
      repeat: REPEATS.indexOf(x.repeat) >= 0 ? x.repeat : null,
      parent: typeof x.parent === "string" ? x.parent : null,
      memo: typeof x.memo === "string" ? x.memo : null, // Memo のメモ（/toolbox/memo/#id）
      order: isFinite(Number(x.order)) && x.order !== null && x.order !== undefined ? Number(x.order) : null, // ドラッグで並べた順
      created: Number(x.created) || Date.now(),
      updated: Number(x.updated) || Number(x.created) || Date.now()
    };
    if (!task.due) { task.time = null; task.repeat = null; }
    return task;
  }
  function upgrade(d) {
    d = d && typeof d === "object" ? d : {};
    var lists = Array.isArray(d.lists) ? d.lists.filter(function (l) { return l && typeof l.id === "string" && typeof l.name === "string"; }).map(function (l) {
      return { id: l.id, name: l.name, color: /^#[0-9a-f]{6}$/i.test(l.color || "") ? l.color : LIST_COLORS[0], icon: LIST_ICONS.indexOf(l.icon) >= 0 ? l.icon : "list" };
    }) : [];
    if (!lists.length) lists = [{ id: DEFAULT_LIST, name: t("リマインダー"), color: LIST_COLORS[0], icon: "list" }];
    var tasks = (Array.isArray(d.tasks) ? d.tasks : []).filter(function (x) { return x && typeof x.id === "string" && typeof x.text === "string"; }).map(function (x) { return upgradeTask(x, lists); });
    // 親がいないサブタスクは、ふつうのタスクに
    var ids = {};
    tasks.forEach(function (x) { ids[x.id] = 1; });
    tasks.forEach(function (x) { if (x.parent && (!ids[x.parent] || x.parent === x.id)) x.parent = null; });
    return {
      version: 2,
      lists: lists,
      tasks: tasks,
      view: typeof d.view === "string" ? d.view : "today",
      showDone: d.showDone && typeof d.showDone === "object" ? d.showDone : {},
      calView: !!d.calView,
      sort: d.sort && typeof d.sort === "object" ? d.sort : {}
    };
  }
  function load() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { /* 初期値 */ }
    return upgrade(d);
  }
  function save(data) {
    localStorage.setItem(STORE, JSON.stringify(data));
  }

  function nextDue(due, repeat) {
    var d = parseYmd(due);
    if (!d) return null;
    if (repeat === "daily") d.setDate(d.getDate() + 1);
    else if (repeat === "weekdays") { do { d.setDate(d.getDate() + 1); } while (d.getDay() === 0 || d.getDay() === 6); }
    else if (repeat === "weekly") d.setDate(d.getDate() + 7);
    else if (repeat === "biweekly") d.setDate(d.getDate() + 14);
    else if (repeat === "monthly") {
      var day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
    } else if (repeat === "yearly") d.setFullYear(d.getFullYear() + 1);
    else return null;
    return ymd(d);
  }

  // 完了にする（繰り返しは次の日付へ）。サブタスクのある親を完了にしたら、サブタスクも完了に
  function complete(task, data) {
    var now = Date.now();
    task.updated = now;
    if (task.repeat && task.due) {
      var next = nextDue(task.due, task.repeat);
      // 今日より前に戻らないように
      var today = ymd(new Date());
      while (next && next < today) next = nextDue(next, task.repeat);
      task.due = next;
      return { next: next };
    }
    task.done = true;
    task.doneAt = now;
    if (data) data.tasks.forEach(function (c) { if (c.parent === task.id && !c.done) { c.done = true; c.doneAt = now; c.updated = now; } });
    return {};
  }

  // ---- 自動入力: 「明日 9時 歯医者」「毎週火曜 ゴミ出し !!」から、日付・時刻・繰り返し・優先度を取り出す ----
  //   返すもの: { text（残りのタイトル）, due, time, repeat, priority, found: [見つけた言葉] }
  //   タイトルから取り除くのは、空白（または入力の端）で区切った、ひとつの言葉として書いたときだけ。
  //   「[英コミ] IELTS Writing Task 1（追加分・水曜）」のように、文の途中や括弧の中に書いた日付は、
  //   締切日・時刻は決めるがタイトルはそのまま残す（前は「（追加分・ ）」「今日の宿題 → の宿題」のように、
  //   言葉だけが抜けて崩れていた）
  var WD = { "日": 0, "月": 1, "火": 2, "水": 3, "木": 4, "金": 5, "土": 6 };
  var WD_EN = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  function parseQuick(input) {
    var text = " " + String(input || "") + " ", now = new Date(), r = { due: null, time: null, repeat: null, priority: 0, found: [] }, removed = false;
    // 見つけた言葉が、空白で区切られたひとつの言葉か（入力の端も空白と同じあつかい）
    function alone(m) {
      var start = m.index + (m[0].length - m[0].replace(/^\s+/, "").length);
      var end = m.index + m[0].replace(/\s+$/, "").length;
      return /\s/.test(start > 0 ? text.charAt(start - 1) : " ") && /\s/.test(end < text.length ? text.charAt(end) : " ");
    }
    function take(re, fn) {
      var m = re.exec(text);
      if (!m) return false;
      if (fn(m) === false) return false;
      r.found.push(m[0].trim());
      if (!alone(m)) return true; // タイトルの一部として書かれている → 日付などは決めるが、文字は消さない
      text = text.slice(0, m.index) + " " + text.slice(m.index + m[0].length);
      removed = true;
      return true;
    }
    function day(n) { var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n); return ymd(d); }
    function nextWeekday(w, minDays) { var d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); var add = (w - d.getDay() + 7) % 7; if (add < minDays) add += 7; d.setDate(d.getDate() + add); return ymd(d); }
    // 繰り返し
    take(/毎週\s*([日月火水木金土])曜?日?/, function (m) { r.repeat = "weekly"; r.due = nextWeekday(WD[m[1]], 0); });
    if (!r.repeat) take(/毎日|every ?day|daily/i, function () { r.repeat = "daily"; });
    if (!r.repeat) take(/平日|weekdays/i, function () { r.repeat = "weekdays"; });
    if (!r.repeat) take(/毎週|every ?week|weekly/i, function () { r.repeat = "weekly"; });
    if (!r.repeat) take(/毎月|every ?month|monthly/i, function () { r.repeat = "monthly"; });
    if (!r.repeat) take(/毎年|every ?year|yearly/i, function () { r.repeat = "yearly"; });
    // 日付
    if (!r.due) take(/明後日|あさって/, function () { r.due = day(2); });
    if (!r.due) take(/明日|tomorrow/i, function () { r.due = day(1); });
    if (!r.due) take(/今日|today|tonight/i, function () { r.due = day(0); });
    if (!r.due) take(/(\d{1,3})\s*日後/, function (m) { r.due = day(+m[1]); });
    if (!r.due) take(/来週の?\s*([日月火水木金土])曜日?/, function (m) { var d = new Date(now.getFullYear(), now.getMonth(), now.getDate()); d.setDate(d.getDate() + (7 - d.getDay()) + WD[m[1]]); r.due = ymd(d); });
    if (!r.due) take(/(?:今週の?)?\s*([日月火水木金土])曜日?/, function (m) { r.due = nextWeekday(WD[m[1]], 0); });
    if (!r.due) take(/\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i, function (m) { r.due = nextWeekday(WD_EN[m[1].toLowerCase()], 0); });
    if (!r.due) take(/来週/, function () { r.due = day(7); });
    if (!r.due) take(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/, function (m) { return setMonthDay(+m[1], +m[2]); });
    if (!r.due) take(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?=\s)/, function (m) { return setMonthDay(+m[1], +m[2]); });
    function setMonthDay(mo, d) {
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
      var dt = new Date(now.getFullYear(), mo - 1, d);
      if (dt < new Date(now.getFullYear(), now.getMonth(), now.getDate())) dt.setFullYear(dt.getFullYear() + 1);
      r.due = ymd(dt);
    }
    // 時刻
    take(/(午前|午後)?\s*(\d{1,2})\s*時(?!間)\s*(半|(\d{1,2})\s*分)?/, function (m) {
      var h = +m[2], mi = m[3] === "半" ? 30 : m[4] ? +m[4] : 0;
      if (m[1] === "午後" && h < 12) h += 12;
      if (m[1] === "午前" && h === 12) h = 0;
      if (h > 23 || mi > 59) return false;
      r.time = pad(h) + ":" + pad(mi);
    }) || take(/(?:^|\s)(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s)/i, function (m) {
      var h = +m[1] % 12 + (m[3].toLowerCase() === "pm" ? 12 : 0), mi = m[2] ? +m[2] : 0;
      r.time = pad(h) + ":" + pad(mi);
    }) || take(/(?:^|\s)(\d{1,2}):(\d{2})(?=\s)/, function (m) {
      if (+m[1] > 23 || +m[2] > 59) return false;
      r.time = pad(+m[1]) + ":" + m[2];
    });
    // 時刻だけのときは、今日（過ぎていたら明日）
    if (r.time && !r.due) r.due = (pad(now.getHours()) + ":" + pad(now.getMinutes())) < r.time ? day(0) : day(1);
    if (r.repeat && !r.due) r.due = day(0);
    // 優先度（! を 1〜3 個、単独で）
    take(/(?:^|\s)(!{1,3}|！{1,3})(?=\s)/, function (m) { r.priority = m[1].length; });
    // 取り除いた跡に、空の括弧だけが残らないように（「英検（水曜 ）」など）
    if (removed) text = text.replace(/[（(]\s*[）)]/g, " ");
    r.text = text.replace(/\s+/g, " ").trim();
    if (!r.text) { r.text = String(input || "").trim(); r.due = r.time = r.repeat = null; r.priority = 0; r.found = []; }
    return r;
  }

  // ---- 通知 ----
  function readNotified() { try { return JSON.parse(localStorage.getItem(NOTIFIED) || "{}") || {}; } catch (e) { return {}; } }
  // extra … { context, actions: [{ action, title }], data: { kind, id, url }, important }。ボタン（actions）は Service Worker から出す通知だけ（Chrome・Edge・Android）
  //   ボタンが押されたら、Service Worker が開いているページに知らせる（下の handleAction）
  // 通知の形はどのアプリもそろえる（Nagi・SK Hub Systems のお知らせも同じ形）:
  //   タイトル … いちばん大事なこと（タスクの名前・アラームの名前・連絡のタイトル）
  //   本文の 1 行目 … 「アプリの名前 · 何の通知か」（extra.context）。2 行目から、くわしいこと（body）
  //   アイコン … アプリのアイコン。小さなアイコン（badge。Android の上のバーなど）… 白と透明だけの形（/toolbox/shared/badges/）
  // 通知のアイコン: アプリのアイコンの右下に、小さな SK のマークを重ねる（LINE の「相手のアイコン＋右下に LINE」のように）
  //   画面の中（canvas）で 1 回だけ作って、data: の URL で使う。作れなかったら、アプリのアイコンだけ
  var iconCache = {};
  function loadImg(src) {
    return new Promise(function (resolve, reject) { var i = new Image(); i.onload = function () { resolve(i); }; i.onerror = reject; i.src = src; });
  }
  function composeIcon(appIcon) {
    if (iconCache[appIcon]) return iconCache[appIcon];
    iconCache[appIcon] = Promise.all([loadImg(appIcon), loadImg("/assets/logo.svg")]).then(function (imgs) {
      var S = 192, c = document.createElement("canvas");
      c.width = c.height = S;
      var g = c.getContext("2d");
      g.drawImage(imgs[0], 0, 0, 168, 168); // アプリのアイコン（右下をあけるため、少し小さく）
      var r = 37, cx = S - r - 1, cy = S - r - 1;
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = "#ffffff"; g.fill(); // 白いふち
      g.save(); g.beginPath(); g.arc(cx, cy, r - 5, 0, Math.PI * 2); g.clip();
      g.drawImage(imgs[1], cx - (r - 5), cy - (r - 5), (r - 5) * 2, (r - 5) * 2);
      g.restore();
      return c.toDataURL("image/png");
    }).catch(function () { delete iconCache[appIcon]; return appIcon; });
    return iconCache[appIcon];
  }
  var APP_NAMES = { todo: "Todo", clock: "Clock", timetable: "Timetable", memo: "Memo", countdown: "Countdown", calc: "Calc", roulette: "Roulette" };
  var BADGES = { todo: "todo", clock: "clock", timetable: "timetable" };
  function notify(title, body, tag, app, extra) {
    if (!(window.Notification && Notification.permission === "granted")) return;
    // Toolbox の設定の「通知」でオフにしたアプリ（todo.notify・clock.notify）は、通知を出さない（Clock を開いているときの音と画面はそのまま）
    if (window.SKToolbox && SKToolbox.app && SKToolbox.app(app).notify === false) return;
    extra = extra || {};
    var data = Object.assign({ url: "/toolbox/" + app + "/" }, extra.data || {});
    var head = (APP_NAMES[app] || "SK's Toolbox") + (extra.context ? " · " + extra.context : "");
    var urgent = app === "clock" || !!extra.important;
    var opts = {
      body: head + (body ? "\n" + body : ""), tag: tag, renotify: true, timestamp: Date.now(),
      icon: "/toolbox/" + app + "/icon-192.png", badge: "/toolbox/shared/badges/" + (BADGES[app] || "toolbox") + ".png",
      requireInteraction: urgent, vibrate: urgent ? [300, 120, 300, 120, 600] : [200], data: data
    };
    function fallback() { try { new Notification(title, opts); } catch (e) { /* 出せない */ } }
    function show() {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration().then(function (reg) {
          if (!reg || !reg.showNotification) { fallback(); return; }
          var withActions = Object.assign({}, opts, { actions: extra.actions || [] });
          reg.showNotification(title, withActions).catch(function () { reg.showNotification(title, opts).catch(fallback); });
        }).catch(fallback);
      } else fallback();
    }
    // SK のマークを重ねたアイコンができたら出す（1.5 秒待ってもできなければ、アプリのアイコンのまま）
    var done = false;
    var wait = setTimeout(function () { if (!done) { done = true; show(); } }, 1500);
    composeIcon(opts.icon).then(function (url) { if (done) return; done = true; clearTimeout(wait); opts.icon = url; show(); });
  }
  // 「5 分のタイマー」（長さが分からなければ「タイマー」）
  function timerText(tm) {
    var s = tm && tm.duration ? Math.round(tm.duration / 1000) : 0;
    if (!s) return t("タイマー");
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return t("{time}のタイマー", { time: [h ? t("{n} 時間", { n: h }) : "", m ? t("{n} 分", { n: m }) : "", sec ? t("{n} 秒", { n: sec }) : ""].filter(Boolean).join(" ") });
  }
  function show(task) {
    notify(task.text || t("リマインダー"), task.notes || "", "sk-todo-" + task.id, "todo", {
      context: task.time ? t("{time} のリマインダー", { time: task.time }) : t("リマインダー"),
      important: task.priority >= 3 || !!task.flagged,
      actions: [{ action: "done", title: t("完了にする") }, { action: "snooze", title: t("10 分後") }],
      data: { kind: "todo", id: task.id, url: "/toolbox/todo/#task-" + encodeURIComponent(task.id) }
    });
  }

  // ---- 「10 分後」にもう一度（localStorage の sk_todo_snooze = { タスクの id: もう一度知らせる時刻 }）----
  var SNOOZE = "sk_todo_snooze";
  function readSnooze() { try { return JSON.parse(localStorage.getItem(SNOOZE) || "{}") || {}; } catch (e) { return {}; } }
  function check() {
    var data = load();
    updateBadge(data);
    var notified = readNotified();
    var now = Date.now(), changed = false, fired = [];
    // 「10 分後」にした通知
    var snooze = readSnooze(), snoozed = false;
    Object.keys(snooze).forEach(function (id) {
      if (now < snooze[id]) return;
      var task = data.tasks.filter(function (x) { return x.id === id; })[0];
      delete snooze[id];
      snoozed = true;
      if (task && !task.done) fired.push(task);
    });
    if (snoozed) { try { localStorage.setItem(SNOOZE, JSON.stringify(snooze)); } catch (e) { /* 次に */ } }
    data.tasks.forEach(function (x) {
      if (x.done || !x.due || !x.time) return;
      var at = new Date(x.due + "T" + x.time + ":00").getTime();
      var key = x.due + " " + x.time;
      // 時刻を過ぎて 12 時間以内のものだけ（ずっと前のものを、まとめて出さない）
      if (at <= now && now - at < 12 * 36e5 && notified[x.id] !== key) {
        notified[x.id] = key;
        changed = true;
        fired.push(x);
      }
    });
    if (!changed) {
      fired.forEach(function (x) { show(x); document.dispatchEvent(new CustomEvent("skreminder", { detail: x })); });
      return;
    }
    // 消えたタスクの記録はかたづける
    var ids = {};
    data.tasks.forEach(function (x) { ids[x.id] = 1; });
    Object.keys(notified).forEach(function (k) { if (!ids[k]) delete notified[k]; });
    try { localStorage.setItem(NOTIFIED, JSON.stringify(notified)); } catch (e) { return; }
    fired.forEach(function (x) {
      show(x);
      document.dispatchEvent(new CustomEvent("skreminder", { detail: x }));
    });
  }

  // ---- Clock のアラーム・タイマー ----
  //   設定は localStorage の sk_clock_tools（Clock の clock-tools.js が書く）
  //     { alarms: [{ id, time: "HH:MM", label, days: [0〜6]（空ならいちど）, on, snoozeAt }], timer: { endAt, running, ... }, ... }
  //   鳴らした記録は sk_clock_fired（{ アラームの id: "日付 時刻", timer: 終わる時刻 }）。Clock とほかのページで 2 回鳴らさない
  //   Clock を開いているときは Clock が音を鳴らす（window.SKClockRing を置く）。ほかのページでは通知だけ
  var TOOLS = "sk_clock_tools", FIRED = "sk_clock_fired";
  function readJson(key) { try { return JSON.parse(localStorage.getItem(key) || "{}") || {}; } catch (e) { return {}; } }
  function checkClock() {
    var tools = readJson(TOOLS), fired = readJson(FIRED);
    var now = new Date(), nowMs = now.getTime(), events = [], toolsChanged = false;
    (Array.isArray(tools.alarms) ? tools.alarms : []).forEach(function (a) {
      if (!a || !a.on || !/^\d{2}:\d{2}$/.test(a.time || "")) return;
      // スヌーズ
      if (a.snoozeAt && nowMs >= a.snoozeAt) {
        a.snoozeAt = null;
        toolsChanged = true;
        events.push({ kind: "alarm", alarm: a, snooze: true });
        return;
      }
      var p = a.time.split(":"), at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), +p[0], +p[1]).getTime();
      var days = Array.isArray(a.days) ? a.days : [];
      if (days.length && days.indexOf(now.getDay()) < 0) return;
      var key = ymd(now) + " " + a.time;
      // 時刻ちょうどから 10 分以内（ページを開いたときに、少し前のものも鳴らす）
      if (nowMs >= at && nowMs - at < 10 * 6e4 && fired[a.id] !== key) {
        fired[a.id] = key;
        if (!days.length) { a.on = false; toolsChanged = true; }
        events.push({ kind: "alarm", alarm: a });
      }
    });
    var tm = tools.timer;
    if (tm && tm.running && tm.endAt && nowMs >= tm.endAt && fired.timer !== tm.endAt) {
      fired.timer = tm.endAt;
      events.push({ kind: "timer", timer: JSON.parse(JSON.stringify(tm)) });
      tm.running = false;
      tm.endAt = null;
      tm.remaining = 0;
      toolsChanged = true;
    }
    if (!events.length) return;
    try {
      localStorage.setItem(FIRED, JSON.stringify(fired));
      if (toolsChanged) localStorage.setItem(TOOLS, JSON.stringify(tools));
    } catch (e) { return; }
    events.forEach(function (ev) {
      if (typeof window.SKClockRing === "function") { window.SKClockRing(ev); return; }
      if (ev.kind === "alarm") notify(ev.alarm.label || t("アラーム"), "", "sk-alarm-" + ev.alarm.id, "clock", {
        context: t("{time} のアラーム", { time: ev.alarm.time }),
        actions: [{ action: "snooze", title: t("スヌーズ（5 分）") }, { action: "stop", title: t("止める") }],
        data: { kind: "alarm", id: ev.alarm.id }
      });
      else notify(t("タイマーが終わりました"), "", "sk-timer", "clock", { context: timerText(ev.timer) });
      document.dispatchEvent(new CustomEvent("skreminder", { detail: { text: ev.kind === "alarm" ? (ev.alarm.label || t("アラーム")) + " " + ev.alarm.time : t("タイマーが終わりました") } }));
    });
  }

  // ---- アプリのアイコンの数字（期限切れと今日のまだのタスク。Toolbox の設定でオフにできる）----
  function updateBadge(data) {
    if (!navigator.setAppBadge) return;
    var on = !window.SKToolbox || SKToolbox.get().badge !== false;
    var today = ymd(new Date());
    var n = on ? data.tasks.filter(function (x) { return !x.done && !x.parent && x.due && x.due <= today; }).length : 0;
    (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(function () { /* 対応していない */ });
  }

  // ---- 通知のボタン（Service Worker から届く。開いているページがなかったときは ?skact= で来る）----
  function storageEvent(key) { try { window.dispatchEvent(new StorageEvent("storage", { key: key, storageArea: localStorage })); } catch (e) { /* 古いブラウザ */ } }
  function handleAction(msg) {
    if (!msg || !msg.action || !msg.id) return;
    if (msg.kind === "todo") {
      var data = load(), task = data.tasks.filter(function (x) { return x.id === msg.id; })[0];
      if (!task) return;
      if (msg.action === "done" && !task.done) {
        complete(task, data);
        try { save(data); } catch (e) { return; }
        storageEvent(STORE);
        updateBadge(data);
        document.dispatchEvent(new CustomEvent("skreminder", { detail: { text: t("完了にしました: {text}", { text: task.text }) } }));
      } else if (msg.action === "snooze") {
        var sn = readSnooze();
        sn[task.id] = Date.now() + 10 * 6e4;
        try { localStorage.setItem(SNOOZE, JSON.stringify(sn)); } catch (e) { /* 保存できない */ }
      }
    } else if (msg.kind === "alarm" && (msg.action === "snooze" || msg.action === "stop") && document.dispatchEvent(new CustomEvent("sk-alarm-action", { cancelable: true, detail: msg })) === false) {
      // Clock の画面で鳴っているとき: Clock が止める・スヌーズする（音も止まる。下の処理はしない）
    } else if (msg.kind === "alarm" && msg.action === "snooze") {
      var tools = readJson(TOOLS);
      var a = (Array.isArray(tools.alarms) ? tools.alarms : []).filter(function (x) { return x && x.id === msg.id; })[0];
      if (!a) return;
      a.on = true;
      a.snoozeAt = Date.now() + 5 * 6e4;
      try { localStorage.setItem(TOOLS, JSON.stringify(tools)); } catch (e) { return; }
      storageEvent(TOOLS);
    }
  }

  if (!/[?&]embed\b/.test(location.search)) {
    if (navigator.serviceWorker) navigator.serviceWorker.addEventListener("message", function (e) { if (e.data && e.data.type === "sk-notification-action") handleAction(e.data); });
    var q = new URLSearchParams(location.search);
    if (q.get("skact")) {
      handleAction({ action: q.get("skact"), kind: q.get("skkind"), id: q.get("skid") });
      ["skact", "skkind", "skid"].forEach(function (k) { q.delete(k); });
      history.replaceState(history.state, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash);
    }
    setTimeout(check, 1500);
    setInterval(check, 20000);
    setInterval(function () { if (typeof window.SKClockRing !== "function") checkClock(); }, 5000);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") { check(); checkClock(); } });
  }

  window.SKReminders = {
    STORE: STORE, DEFAULT_LIST: DEFAULT_LIST, LIST_COLORS: LIST_COLORS, LIST_ICONS: LIST_ICONS, REPEATS: REPEATS,
    load: load, save: save, upgrade: upgrade, upgradeTask: upgradeTask, complete: complete, nextDue: nextDue,
    ymd: ymd, parseYmd: parseYmd, check: check, checkClock: checkClock, notify: notify, parseQuick: parseQuick, timerText: timerText
  };
})();
