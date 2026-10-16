// Countdown（SK's Toolbox）— 大事な日まで、あと何日
//   ・日は localStorage の sk_countdown に保存する（オンライン同期をオンにしたときだけ、暗号化して SK Hub Systems アカウントにも保存する。/toolbox/shared/sync.js）。テーマなどは共通の設定（/toolbox/shared/settings.js）
//       { version: 1, showPast: true, events: [{ id, name, date: "YYYY-MM-DD", time: "HH:MM" | null, emoji, color, yearly, created, updated }] }
//   ・yearly（毎年）の日は、過ぎたら次の年に進めて数える（誕生日・記念日など）
//   ・いちばん近い日は上に大きく出す。その日のうちで時刻を決めてあれば、残りを秒まで数える
//   ・#new で開くと、すぐ追加のダイアログを出す（ホーム画面の「日を追加」）
//   ・?embed のときは見本の日を表示だけする
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
  function parseYmd(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  var COLORS = ["#7c3aed", "#db2777", "#2563eb", "#0891b2", "#16a34a", "#ea580c", "#dc2626", "#ca8a04", "#334155"];
  var EMOJIS = ["🎂", "🎉", "✈️", "📚", "🏖️", "🎄", "💍", "🎓", "🏃", "🎮", "🎵", "⭐", "❤️", "🍣"];

  // ================================================================
  // 保存
  // ================================================================
  var STORE = "sk_countdown";
  var data = { version: 1, showPast: true, events: [] };
  function valid(e) { return e && typeof e.id === "string" && typeof e.name === "string" && !!parseYmd(e.date); }
  function upgrade(e) {
    return {
      id: e.id, name: e.name, date: e.date,
      time: /^\d{2}:\d{2}$/.test(e.time || "") ? e.time : null,
      emoji: typeof e.emoji === "string" && e.emoji.length <= 8 ? e.emoji : "⭐",
      color: /^#[0-9a-f]{6}$/i.test(e.color || "") ? e.color : COLORS[0],
      yearly: !!e.yearly,
      created: Number(e.created) || Date.now(), updated: Number(e.updated) || Date.now()
    };
  }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(STORE) || "{}") || {};
      data.showPast = d.showPast !== false;
      data.events = Array.isArray(d.events) ? d.events.filter(valid).map(upgrade) : [];
    } catch (e) { /* 初期値 */ }
  }
  function save() {
    if (embed) return;
    try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) { say(t("保存できませんでした")); }
  }

  if (embed) {
    root.classList.add("is-embed");
    var d0 = new Date();
    function plus(n) { var d = new Date(d0); d.setDate(d.getDate() + n); return ymd(d); }
    data.events = [
      { id: "a", name: t("夏休み"), date: plus(12), emoji: "🏖️", color: "#0891b2" },
      { id: "b", name: t("誕生日"), date: plus(40), emoji: "🎂", color: "#db2777", yearly: true },
      { id: "c", name: t("テスト"), date: plus(5), emoji: "📚", color: "#7c3aed" }
    ].map(upgrade);
  } else load();

  // ================================================================
  // 計算
  // ================================================================
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  // 次に来る日（毎年のものは、過ぎていたら次の年）
  function occurrence(ev, now) {
    var d = parseYmd(ev.date);
    if (ev.yearly) {
      var y = now.getFullYear();
      d = new Date(y, d.getMonth(), d.getDate());
      if (startOfDay(d) < startOfDay(now)) d = new Date(y + 1, d.getMonth(), d.getDate());
    }
    if (ev.time) { var p = ev.time.split(":"); d.setHours(+p[0], +p[1], 0, 0); }
    return d;
  }
  function info(ev, now) {
    var at = occurrence(ev, now);
    var days = Math.round((startOfDay(at) - startOfDay(now)) / 864e5);
    var r = { at: at, days: days, past: days < 0 };
    if (ev.yearly) { var base = parseYmd(ev.date); r.years = at.getFullYear() - base.getFullYear(); }
    if (ev.time) r.left = at - now; // ミリ秒
    return r;
  }
  function hms(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return Math.floor(s / 3600) + ":" + pad(Math.floor(s % 3600 / 60)) + ":" + pad(s % 60);
  }
  var dateFmt = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", weekday: "short" });
  var timeFmt = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
  function dateText(ev, inf) { return dateFmt.format(inf.at) + (ev.time ? " " + timeFmt.format(inf.at) : ""); }
  // 大きい数字と単位
  function countParts(inf) {
    if (inf.days === 0) {
      if (inf.left !== undefined && inf.left > 0) return { num: t("今日"), unit: t("あと {t}", { t: hms(inf.left) }) };
      return { num: t("今日"), unit: "" };
    }
    if (inf.days > 0) return { num: inf.days.toLocaleString(locale), unit: t("日") };
    return { num: (-inf.days).toLocaleString(locale), unit: t("日前") };
  }

  // この日を LINE・KakaoTalk の友だち・グループにカードで送る（window.SKMsg。/toolbox/shared/line.js・kakao.js）
  function shareLine(ev) {
    var inf = info(ev, new Date());
    var big = inf.days === 0 ? t("今日です") : inf.days > 0 ? t("あと {n} 日", { n: inf.days.toLocaleString(locale) }) : t("{n} 日前", { n: (-inf.days).toLocaleString(locale) });
    var title = (ev.emoji ? ev.emoji + " " : "") + ev.name;
    var url = "https://sk-hub.jp/toolbox/countdown/";
    SKMsg.share(SKMsg.card({
      alt: title + " " + big, kicker: "Countdown", title: big, sub: title + "\n" + dateText(ev, inf), color: ev.color, url: url, button: t("SK's Toolbox で数える")
    }), title + " " + big + "（" + dateText(ev, inf) + "）\n" + url).then(function (r) { if (r === "sent") say(SKMsg.sentLabel()); });
  }

  // ================================================================
  // 表示
  // ================================================================
  function find(id) { for (var i = 0; i < data.events.length; i++) if (data.events[i].id === id) return data.events[i]; return null; }
  function sorted(now) {
    var list = data.events.map(function (ev) { return { ev: ev, inf: info(ev, now) }; });
    var up = list.filter(function (x) { return !x.inf.past; }).sort(function (a, b) { return a.inf.at - b.inf.at; });
    var past = list.filter(function (x) { return x.inf.past; }).sort(function (a, b) { return b.inf.at - a.inf.at; });
    return { up: up, past: past };
  }
  var firstRender = true;
  function render() {
    var now = new Date();
    var s = sorted(now);
    $("sub").textContent = data.events.length ? t("{n} 件の予定", { n: s.up.length }) + (s.past.length ? " · " + t("過ぎた日 {n} 件", { n: s.past.length }) : "") : "";
    // いちばん近い日
    var hero = $("hero");
    var first = s.up[0];
    hero.hidden = !first;
    hero.textContent = "";
    if (first) {
      var ev = first.ev, inf = first.inf, cp = countParts(inf);
      hero.style.setProperty("--ec", ev.color);
      hero.dataset.id = ev.id;
      hero.setAttribute("role", "button");
      hero.tabIndex = 0;
      hero.setAttribute("aria-label", ev.name + " " + cp.num + cp.unit);
      var left = el("div");
      left.append(el("div", "hero__emoji", ev.emoji), el("p", "hero__name", ev.name), el("p", "hero__date", dateText(ev, inf) + (ev.yearly && inf.years > 0 ? " · " + t("{n} 回目", { n: inf.years }) : "")));
      var right = el("div", "hero__count");
      if (inf.days > 0) right.appendChild(el("span", "hero__unit", t("あと")));
      right.appendChild(el("span", "hero__num", cp.num));
      if (inf.days > 0) right.appendChild(el("span", "hero__unit", t("日")));
      if (inf.days === 0 && cp.unit) right.appendChild(el("span", "hero__clock", cp.unit));
      else if (inf.days === 1 && inf.left !== undefined) right.appendChild(el("span", "hero__clock", t("あと {t}", { t: hms(inf.left) })));
      hero.append(left, right);
    }
    // カード
    var cards = $("cards");
    cards.textContent = "";
    function card(x, i) {
      var ev = x.ev, inf = x.inf, cp = countParts(inf);
      var b = el("button", "card m3-state" + (firstRender ? " card--in" : "") + (inf.past ? " is-past" : "") + (inf.days === 0 ? " is-today" : ""));
      b.type = "button";
      b.dataset.id = ev.id;
      b.style.setProperty("--ec", ev.color);
      b.style.animationDelay = Math.min(i, 10) * 40 + "ms";
      var top = el("div", "card__top");
      top.append(el("span", "card__emoji", ev.emoji), el("span", "card__name", ev.name));
      if (ev.yearly) top.appendChild(icon("cached"));
      var count = el("div", "card__count");
      if (inf.days > 0) count.appendChild(el("span", "card__unit", t("あと")));
      count.append(el("span", "card__num", cp.num), el("span", "card__unit", cp.unit));
      b.append(top, count, el("span", "card__date", dateText(ev, inf)));
      cards.appendChild(b);
    }
    s.up.slice(1).forEach(card);
    if (data.showPast && s.past.length) {
      cards.appendChild(el("h2", "section-title", t("過ぎた日")));
      s.past.forEach(card);
    }
    $("empty").hidden = data.events.length > 0;
    $("past-label").textContent = data.showPast ? t("過ぎた日を隠す") : t("過ぎた日を表示");
    $("past-icon").textContent = data.showPast ? "visibility_off" : "history";
    firstRender = false;
  }
  // 残り時間（秒）だけ書きかえる。日付が変わったら全体を描き直す
  var lastDay = new Date().toDateString();
  function tick() {
    if (document.visibilityState !== "visible" || document.querySelector(".tbs-dialog-scrim")) return;
    var now = new Date();
    if (now.toDateString() !== lastDay || now.getSeconds() === 0) { lastDay = now.toDateString(); render(); return; }
    var hero = $("hero");
    var ev = hero.dataset.id && find(hero.dataset.id);
    var clock = hero.querySelector(".hero__clock");
    if (!ev || !clock || !ev.time) return;
    var left = occurrence(ev, now) - now;
    if (left <= 0) { render(); return; }
    clock.textContent = t("あと {t}", { t: hms(left) });
  }

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
    toastTimer = setTimeout(function () { toast.classList.remove("is-on"); toastUndo = null; }, undo ? 6000 : 2400);
  }
  toastAction.addEventListener("click", function () { if (toastUndo) toastUndo(); toastUndo = null; toast.classList.remove("is-on"); });

  // テーマ（ブラウザの上の帯の色）
  var themeColor = $("theme-color");
  function applyTheme() { if (themeColor) themeColor.content = getComputedStyle(root).getPropertyValue("--md-surface").trim() || "#fef7ff"; }
  if (window.SKToolbox) SKToolbox.onChange(applyTheme); else applyTheme();

  render();
  // 動き: いちばん近い日が浮かび上がって、日数を数え上げる
  if (window.M3) {
    M3.enter($("hero"));
    var heroNum = $("hero").querySelector(".hero__num");
    var n0 = heroNum && parseInt(heroNum.textContent.replace(/[^0-9]/g, ""), 10);
    if (n0 > 1) M3.countUp(heroNum, n0, function (v) { return v.toLocaleString(locale); }, 900);
  }
  if (embed) return;
  setInterval(tick, 1000);

  // ================================================================
  // 追加・編集
  // ================================================================
  function field(label, control) { var w = el("label", "m3-field"); w.append(el("span", "m3-field__label", label), control); return w; }
  function edit(ev) {
    var tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 7);
    var draft = ev ? JSON.parse(JSON.stringify(ev)) : { id: newId(), name: "", date: ymd(tomorrow), time: null, emoji: "⭐", color: COLORS[0], yearly: false };
    var body = el("div", "ev-edit");
    var nameIn = el("input", "m3-field__input"); nameIn.maxLength = 60; nameIn.value = draft.name; nameIn.placeholder = t("例: 夏休み");
    var dateIn = el("input", "m3-field__input"); dateIn.type = "date"; dateIn.value = draft.date;
    var timeIn = el("input", "m3-field__input"); timeIn.type = "time"; timeIn.value = draft.time || "";
    var row = el("div", "ev-edit__row");
    row.append(field(t("日付"), dateIn), field(t("時刻（なくても OK）"), timeIn));
    var emojis = el("div", "ev-edit__emojis");
    emojis.setAttribute("role", "radiogroup");
    emojis.setAttribute("aria-label", t("絵文字"));
    EMOJIS.forEach(function (em) {
      var b = el("button", "ev-emoji m3-state", em);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(em === draft.emoji));
      b.addEventListener("click", function () { draft.emoji = em; Array.prototype.forEach.call(emojis.children, function (x) { x.setAttribute("aria-checked", String(x === b)); }); });
      emojis.appendChild(b);
    });
    var colors = el("div", "ev-edit__colors");
    colors.setAttribute("role", "radiogroup");
    colors.setAttribute("aria-label", t("色"));
    COLORS.forEach(function (c) {
      var b = el("button", "tbs-swatch m3-state");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-label", c);
      b.style.setProperty("--sw", c);
      b.setAttribute("aria-checked", String(c === draft.color));
      b.appendChild(icon("check"));
      b.addEventListener("click", function () { draft.color = c; Array.prototype.forEach.call(colors.children, function (x) { x.setAttribute("aria-checked", String(x === b)); }); });
      colors.appendChild(b);
    });
    var yearly = el("label", "ev-edit__switch");
    var ysw = el("input", "tbs-switch"); ysw.type = "checkbox"; ysw.setAttribute("role", "switch"); ysw.checked = draft.yearly;
    yearly.append(el("span", "", t("毎年くり返す（誕生日・記念日など）")), ysw);
    body.append(field(t("名前"), nameIn), row, emojis, colors, yearly);
    var actions = [{ label: t("キャンセル"), value: null }, { label: ev ? t("保存") : t("追加"), primary: true, value: "save" }];
    if (ev) actions.unshift({ label: t("削除"), danger: true, value: "delete" });
    if (ev && window.SKMsg) actions.unshift({ label: SKMsg.sendLabel(), value: "line" });
    window.M3.dialog({ title: ev ? t("日を編集") : t("日を追加"), body: body, actions: actions }).then(function (v) {
      if (v === "line") { shareLine(ev); return; }
      if (v === "delete") {
        var removed = JSON.parse(JSON.stringify(ev));
        data.events = data.events.filter(function (x) { return x.id !== ev.id; });
        save(); render();
        say(t("削除しました"), function () { data.events.push(removed); save(); render(); });
        return;
      }
      if (v !== "save") return;
      var name = nameIn.value.trim();
      if (!name || !parseYmd(dateIn.value)) { say(t("名前と日付を入れてください")); return; }
      draft.name = name;
      draft.date = dateIn.value;
      draft.time = /^\d{2}:\d{2}$/.test(timeIn.value) ? timeIn.value : null;
      draft.yearly = ysw.checked;
      draft.updated = Date.now();
      var clean = upgrade(draft);
      if (ev) Object.assign(ev, clean); else data.events.push(clean);
      save();
      render();
    });
  }
  $("btn-add").addEventListener("click", function () { edit(null); });
  document.addEventListener("click", function (e) {
    var c = e.target.closest(".card[data-id], .hero[data-id]");
    if (c) edit(find(c.dataset.id));
  });
  $("hero").addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); edit(find(this.dataset.id)); } });

  // ================================================================
  // メニュー
  // ================================================================
  var menu = $("menu"), menuBtn = $("btn-menu");
  function setMenu(open) { menu.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open)); if (open) menu.querySelector("button").focus(); }
  menuBtn.addEventListener("click", function () { setMenu(menu.hidden); });
  document.addEventListener("click", function (e) { if (!menu.hidden && !e.target.closest(".menu-wrap")) setMenu(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) { setMenu(false); menuBtn.focus(); } });
  menu.addEventListener("click", function (e) {
    var b = e.target.closest("[data-menu]");
    if (!b) return;
    setMenu(false);
    if (b.dataset.menu === "past") { data.showPast = !data.showPast; save(); render(); }
    else if (b.dataset.menu === "export") {
      var url = URL.createObjectURL(new Blob([JSON.stringify({ app: "sk-countdown", version: 1, exportedAt: new Date().toISOString(), events: data.events }, null, 2)], { type: "application/json" }));
      var a = el("a"); a.href = url; a.download = "countdown-backup-" + ymd(new Date()).replace(/-/g, "") + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } else if (b.dataset.menu === "import") $("import-file").click();
  });
  $("import-file").addEventListener("change", function () {
    var file = this.files && this.files[0];
    this.value = "";
    if (!file) return;
    file.text().then(function (text) {
      var d = JSON.parse(text);
      var list = ((Array.isArray(d) ? d : d && d.events) || []).filter(valid).map(upgrade);
      if (!list.length) throw new Error("empty");
      var added = 0;
      list.forEach(function (x) {
        var mine = find(x.id);
        if (!mine) { data.events.push(x); added++; }
        else if (x.updated > mine.updated) { Object.assign(mine, x); added++; }
      });
      save(); render();
      say(t("{n} 件読み込みました", { n: added }));
    }).catch(function () { say(t("読み込めませんでした。Countdown のバックアップのファイルを選んでください")); });
  });

  window.addEventListener("storage", function (e) { if (e.key === STORE) { load(); render(); } });

  // #new … ホーム画面の「日を追加」から来たとき、すぐ追加のダイアログを出す
  if (location.hash === "#new") {
    history.replaceState(null, "", location.pathname);
    // ダイアログ（/toolbox/shared/m3.js）が読み込まれてから
    window.addEventListener("load", function () { if (window.M3) edit(null); });
  }
})();
