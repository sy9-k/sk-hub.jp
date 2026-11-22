// Nagi（凪）— 集中タイマー
//   集中（初期 25 分）→ 休憩（5 分）をくり返し、4 回ごとに長い休憩（15 分）。集中した時間を記録して、1 日の目標と連続日数を出す
//   ・記録と設定はこのブラウザの localStorage（nagi_sessions / nagi_settings / nagi_timer）
//   ・SK Hub Systems アカウントとの同期は account.js（window.NAGI でやり取りする）
//   ・残り時間は「終わる時刻」から計算する（タブが裏にあっても、閉じて開き直しても、ずれない）
(function () {
  "use strict";

  var I18N = window.SKI18N || { lang: "ja", t: function (s, p) { return p ? s.replace(/\{(\w+)\}/g, function (m, k) { return p[k] != null ? p[k] : m; }) : s; } };
  var t = I18N.t;

  var SETTINGS_KEY = "nagi_settings";
  var SESSIONS_KEY = "nagi_sessions";
  var TIMER_KEY = "nagi_timer";
  var INSTALL_KEY = "nagi_install_dismissed";
  var SESSIONS_MAX = 3000;       // 記録は新しいものから 3000 件まで（1 日 8 回で約 1 年）
  var MIN_RECORD_MS = 60 * 1000; // 1 分未満でやめたものは記録しない
  var RING = 2 * Math.PI * 108;

  var DEFAULTS = { focus: 25, short: 5, long: 15, every: 4, goal: 120, autoBreak: true, autoFocus: false, sound: true, notify: false, goalUpdatedAt: 0 };

  var $ = function (id) { return document.getElementById(id); };

  // ---------- 保存 ----------
  function load(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key) || "null"); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存できなくても、このページでは動く */ }
  }

  function clampInt(v, min, max, fallback) {
    var n = Math.round(Number(v));
    return isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }
  function normalizeSettings(s) {
    s = s || {};
    return {
      focus: clampInt(s.focus, 1, 180, DEFAULTS.focus),
      short: clampInt(s.short, 1, 60, DEFAULTS.short),
      long: clampInt(s.long, 1, 90, DEFAULTS.long),
      every: clampInt(s.every, 2, 10, DEFAULTS.every),
      goal: clampInt(s.goal, 10, 1440, DEFAULTS.goal),
      autoBreak: s.autoBreak !== undefined ? !!s.autoBreak : DEFAULTS.autoBreak,
      autoFocus: !!s.autoFocus,
      sound: s.sound !== undefined ? !!s.sound : DEFAULTS.sound,
      notify: !!s.notify,
      goalUpdatedAt: Number(s.goalUpdatedAt) || 0
    };
  }

  var settings = normalizeSettings(load(SETTINGS_KEY, {}));
  // 記録: [{ i: ID, s: 始めた時刻（ミリ秒）, m: 集中した分（小数） }]
  var sessions = (load(SESSIONS_KEY, []) || []).filter(function (x) { return x && x.i && isFinite(x.s) && isFinite(x.m); });

  // タイマーの状態
  //   mode: focus / short / long, running, endAt（動いているとき）, remaining（止まっているとき、ミリ秒）
  //   round: 今のサイクルで何回目の集中か, focusStart: 集中を始めた時刻, focusedMs: 一時停止までに集中した時間, resumedAt
  var timer = load(TIMER_KEY, null) || {};
  if (!/^(focus|short|long)$/.test(timer.mode)) timer = { mode: "focus", running: false, remaining: settings.focus * 60000, round: 1, focusStart: 0, focusedMs: 0, resumedAt: 0 };

  var listeners = [];
  function changed(kind) {
    listeners.forEach(function (fn) { try { fn(kind); } catch (e) { /* 同期の失敗でタイマーは止めない */ } });
  }

  function durationOf(mode) {
    return (mode === "focus" ? settings.focus : mode === "short" ? settings.short : settings.long) * 60000;
  }

  // ---------- 日付と集計 ----------
  function dayKey(ms) {
    var d = new Date(ms);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function dayTotals() {
    var map = {};
    sessions.forEach(function (x) { var k = dayKey(x.s); map[k] = (map[k] || 0) + x.m; });
    return map;
  }
  function addDays(ms, n) {
    var d = new Date(ms);
    d.setDate(d.getDate() + n);
    return d.getTime();
  }
  // 連続日数: 今日達成していれば今日から、まだなら昨日から、目標を達成した日をさかのぼって数える
  function streakOf(totals) {
    var now = Date.now();
    var day = (totals[dayKey(now)] || 0) >= settings.goal ? now : addDays(now, -1);
    var n = 0;
    while ((totals[dayKey(day)] || 0) >= settings.goal) { n++; day = addDays(day, -1); }
    return n;
  }

  function formatMinutes(min) {
    var m = Math.floor(min + 1e-6);
    var h = Math.floor(m / 60);
    var r = m % 60;
    if (h === 0) return t("{m}分", { m: r });
    return r === 0 ? t("{h}時間", { h: h }) : t("{h}時間{m}分", { h: h, m: r });
  }
  function formatClock(ms) {
    var total = Math.max(0, Math.ceil(ms / 1000));
    var m = Math.floor(total / 60);
    var s = total % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  // ---------- 記録 ----------
  function record(startMs, focusedMs) {
    if (focusedMs < MIN_RECORD_MS) return false;
    var before = (dayTotals()[dayKey(Date.now())] || 0) >= settings.goal;
    sessions.push({ i: startMs.toString(36) + "-" + Math.random().toString(36).slice(2, 6), s: startMs, m: Math.round(focusedMs / 600) / 100 });
    sessions.sort(function (a, b) { return a.s - b.s; });
    if (sessions.length > SESSIONS_MAX) sessions = sessions.slice(-SESSIONS_MAX);
    save(SESSIONS_KEY, sessions);
    var after = (dayTotals()[dayKey(Date.now())] || 0) >= settings.goal;
    renderStats();
    if (!before && after) {
      toast(t("今日の目標を達成しました！"));
      celebrate();
    }
    changed("sessions");
    return true;
  }

  // ---------- 音と通知 ----------
  var audio = null;
  function ensureAudio() {
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
    } catch (e) { audio = null; }
  }
  // 切り替わりの音（集中→休憩、休憩→集中のどちらも）。機内の二音チャイム「ポーン、ポーン」（高い音→低い音）
  // 機内チャイムは電子音で、倍音をほとんど含まない正弦波（サイン波）に近い。
  // 立ち上がりは短く、音は少し保ってから、やわらかく消える。高いレ(D)→低いド(C)
  function chime() {
    if (!settings.sound || !audio) return;
    var now = audio.currentTime;
    function tone(freq, start, hold, tail) {
      var osc = audio.createOscillator();
      var gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(0.28, start + 0.008);   // 短い立ち上がり
      gain.gain.setValueAtTime(0.28, start + hold);              // 少し保つ
      gain.gain.setTargetAtTime(0.0001, start + hold, tail / 4); // なめらかに消える
      osc.connect(gain).connect(audio.destination);
      osc.start(start);
      osc.stop(start + hold + tail * 1.5);
    }
    tone(587.33, now, 0.50, 0.40);          // 高い音: レ（D5）。長めに保って、次の音の前でほぼ消える
    tone(523.25, now + 0.52, 0.30, 2.0);    // 低い音: ド（C5）。あとのほうを長く
  }
  // context … 本文の 1 行目「Nagi · ○○」の ○○（終わった集中・休憩と、その長さ）
  function notify(title, body, context) {
    if (!settings.notify || !("Notification" in window) || Notification.permission !== "granted") return;
    // 通知の形は SK's Toolbox とそろえる（本文の 1 行目 … 「Nagi · 何の通知か」。小さなアイコンは白と透明だけの三日月）
    var options = { body: "Nagi · " + (context || t("タイマー")) + (body ? "\n" + body : ""), icon: "ico/icon-192.png", badge: "ico/badge-96.png", tag: "nagi", renotify: true, timestamp: Date.now(), vibrate: [200, 100, 200] };
    function show() {
      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then(function (reg) { reg.showNotification(title, options); }).catch(function () {});
      } else {
        try { new Notification(title, options); } catch (e) { /* 通知が使えない環境 */ }
      }
    }
    // アイコン: Nagi のアイコンの右下に、小さな SK のマークを重ねる（SK's Toolbox と同じ。作れなければ Nagi のアイコンだけ）
    var done = false;
    var wait = setTimeout(function () { if (!done) { done = true; show(); } }, 1500);
    nagiIcon().then(function (url) { if (done) return; done = true; clearTimeout(wait); options.icon = url; show(); });
  }
  var nagiIconP = null;
  function nagiIcon() {
    if (nagiIconP) return nagiIconP;
    function img(src) { return new Promise(function (ok, ng) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = ng; i.src = src; }); }
    nagiIconP = Promise.all([img("ico/icon-192.png"), img("/assets/logo.svg")]).then(function (im) {
      var S = 192, c = document.createElement("canvas");
      c.width = c.height = S;
      var g = c.getContext("2d"), r = 37, cx = S - r - 1, cy = S - r - 1;
      g.drawImage(im[0], 0, 0, 168, 168);
      g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fillStyle = "#ffffff"; g.fill();
      g.save(); g.beginPath(); g.arc(cx, cy, r - 5, 0, Math.PI * 2); g.clip();
      g.drawImage(im[1], cx - (r - 5), cy - (r - 5), (r - 5) * 2, (r - 5) * 2);
      g.restore();
      return c.toDataURL("image/png");
    }).catch(function () { nagiIconP = null; return "ico/icon-192.png"; });
    return nagiIconP;
  }

  // ---------- タイマー ----------
  var doneTimer = null;
  var tickTimer = null;

  function persist() { save(TIMER_KEY, timer); }

  function remainingMs() {
    return timer.running ? Math.max(0, timer.endAt - Date.now()) : timer.remaining;
  }

  function start() {
    if (timer.running) return;
    ensureAudio();
    var now = Date.now();
    timer.running = true;
    timer.endAt = now + timer.remaining;
    timer.resumedAt = now;
    if (timer.mode === "focus" && !timer.focusStart) timer.focusStart = now;
    persist();
    schedule();
    render();
  }

  function pause() {
    if (!timer.running) return;
    var now = Date.now();
    timer.remaining = Math.max(0, timer.endAt - now);
    if (timer.mode === "focus") timer.focusedMs += now - timer.resumedAt;
    timer.running = false;
    persist();
    unschedule();
    render();
  }

  // 集中した時間（一時停止中の時間は数えない）
  function focusedSoFar() {
    if (timer.mode !== "focus") return 0;
    return timer.focusedMs + (timer.running ? Math.min(Date.now(), timer.endAt) - timer.resumedAt : 0);
  }

  function setMode(mode, keepRound) {
    unschedule();
    timer.mode = mode;
    timer.running = false;
    timer.remaining = durationOf(mode);
    timer.focusStart = 0;
    timer.focusedMs = 0;
    if (!keepRound && mode === "focus") timer.round = timer.round || 1;
    persist();
    render();
  }

  // 次の種類へ（集中のあとは休憩、休憩のあとは集中。every 回ごとに長い休憩）
  function nextMode() {
    if (timer.mode === "focus") {
      return timer.round % settings.every === 0 ? "long" : "short";
    }
    return "focus";
  }

  function finish(natural) {
    var wasFocus = timer.mode === "focus";
    // 通知の 1 行目: 終わったもの（「集中 25 分」「休憩 5 分」「長い休憩 15 分」）
    var doneMin = timer.mode === "focus" ? settings.focus : timer.mode === "short" ? settings.short : settings.long;
    var doneText = t(timer.mode === "focus" ? "集中 {n} 分" : timer.mode === "short" ? "休憩 {n} 分" : "長い休憩 {n} 分", { n: doneMin });
    if (wasFocus) {
      record(timer.focusStart || Date.now() - focusedSoFar(), focusedSoFar());
    }
    var next = nextMode();
    if (!wasFocus) timer.round = timer.mode === "long" ? 1 : timer.round + 1;
    setMode(next, true);
    if (natural) {
      chime(wasFocus ? "break" : "focus");
      if (wasFocus) notify(t("集中おつかれさまでした"), next === "long" ? t("長い休憩にしましょう。") : t("少し休憩しましょう。"), doneText);
      else notify(t("休憩おわり"), t("次の集中をはじめましょう。"), doneText);
      var auto = wasFocus ? settings.autoBreak : settings.autoFocus;
      if (auto) start();
      else toast(wasFocus ? t("集中おつかれさまでした。休憩しましょう。") : t("休憩おわり。次の集中をはじめましょう。"));
    }
  }

  function reset() {
    // 途中でやめた集中も、1 分以上なら記録する
    if (timer.mode === "focus") record(timer.focusStart || Date.now(), focusedSoFar());
    setMode(timer.mode, true);
  }

  function skip() {
    finish(false);
  }

  function schedule() {
    unschedule();
    // 終わる時刻に 1 回だけ（くり返しのタイマーより、裏のタブでも遅れにくい）
    doneTimer = setTimeout(function () { finish(true); }, Math.max(0, timer.endAt - Date.now()) + 30);
    tickTimer = setInterval(renderTime, 250);
  }
  function unschedule() {
    clearTimeout(doneTimer);
    clearInterval(tickTimer);
    doneTimer = null;
    tickTimer = null;
  }

  // ---------- 表示 ----------
  var MODE_LABEL = { focus: t("集中"), short: t("休憩"), long: t("長い休憩") };

  function renderTime() {
    var rem = remainingMs();
    var clock = formatClock(rem);
    $("time").textContent = clock;
    var total = durationOf(timer.mode);
    var ratio = total ? rem / total : 0;
    $("ring-progress").style.strokeDashoffset = String(RING * (1 - ratio));
    document.title = timer.running ? clock + " · " + MODE_LABEL[timer.mode] + " | Nagi" : "Nagi";
    if (timer.running && rem <= 0 && !doneTimer) finish(true);
  }

  function render() {
    document.body.classList.toggle("is-break", timer.mode !== "focus");
    document.body.classList.toggle("is-running", !!timer.running);
    if (typeof updateWakeLock === "function") { updateWakeLock(); poke(); }
    document.querySelectorAll("[data-mode]").forEach(function (btn) {
      var on = btn.dataset.mode === timer.mode;
      // 選んだものが変わったら、小さく弾ませる（MALU の辞書の選択と同じ）
      if (on && btn.getAttribute("aria-selected") === "false" && typeof animateEl === "function") animateEl(btn, "is-pop", 300);
      btn.setAttribute("aria-selected", String(on));
    });
    var fresh = !timer.running && timer.remaining === durationOf(timer.mode);
    $("start-label").textContent = timer.running ? t("一時停止") : fresh ? t("はじめる") : t("つづける");
    $("start-icon").textContent = timer.running ? "pause" : "play_arrow";
    $("mode-name").textContent = MODE_LABEL[timer.mode];
    $("mode-icon").textContent = timer.mode === "focus" ? "self_improvement" : "coffee";
    $("status").textContent = timer.running
      ? (timer.mode === "focus" ? t("集中しています") : t("休憩しています"))
      : fresh ? (timer.mode === "focus" ? t("準備ができたら「はじめる」") : t("ひと休みしましょう")) : t("一時停止中");
    $("round").textContent = t("集中 {n} / {every} 回目", { n: ((timer.round - 1) % settings.every) + 1, every: settings.every });
    // スマホのブラウザの上の帯は、背景（M3 の surface）に合わせる
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", getComputedStyle(document.documentElement).getPropertyValue("--surface").trim() || "#f4fbf8");
    renderTime();
  }

  var WEEKDAYS = [t("日"), t("月"), t("火"), t("水"), t("木"), t("金"), t("土")];
  function renderStats() {
    var totals = dayTotals();
    var today = totals[dayKey(Date.now())] || 0;
    var goal = settings.goal;
    $("today-minutes").textContent = formatMinutes(today);
    $("today-goal").textContent = " / " + formatMinutes(goal);
    var pct = Math.min(100, Math.round(today / goal * 100));
    // M3 の線の進み具合: 進んだ部分とすき間（4px）と残り。0% のときは進んだ部分を出さない
    $("goal-fill").style.width = pct > 0 ? "calc(" + pct + "% - 2px)" : "0";
    $("goal-fill").style.display = pct > 0 ? "" : "none";
    $("goal-bar").setAttribute("aria-valuenow", String(pct));
    var done = today >= goal;
    document.querySelector(".today").classList.toggle("is-done", done);
    $("goal-note").textContent = done ? t("今日の目標を達成しました") : t("目標まで あと {rest}", { rest: formatMinutes(goal - today) });
    var streak = streakOf(totals);
    $("streak-value").textContent = t("{n}日連続", { n: streak });
    $("streak").classList.toggle("is-zero", streak === 0);

    // この 7 日
    var chart = $("week-chart");
    var days = [];
    for (var i = 6; i >= 0; i--) days.push(addDays(Date.now(), -i));
    var values = days.map(function (d) { return totals[dayKey(d)] || 0; });
    var max = Math.max(goal, Math.max.apply(null, values)) || 1;
    chart.replaceChildren();
    var line = document.createElement("div");
    line.className = "week-goal";
    line.style.bottom = "calc(" + (goal / max) + " * (100% - 22px) + 22px)";
    chart.appendChild(line);
    days.forEach(function (d, idx) {
      var col = document.createElement("div");
      col.className = "week-day" + (values[idx] >= goal ? " is-met" : "") + (idx === 6 ? " is-today" : "");
      col.title = formatMinutes(values[idx]);
      var bar = document.createElement("div");
      bar.className = "week-bar";
      bar.style.height = "calc(" + (values[idx] / max) + " * (100% - 22px))";
      var label = document.createElement("small");
      label.textContent = idx === 6 ? t("今日") : WEEKDAYS[new Date(d).getDay()];
      col.append(bar, label);
      chart.appendChild(col);
    });
    var week = values.reduce(function (a, b) { return a + b; }, 0);
    $("week-total").textContent = t("合計 {time}", { time: formatMinutes(week) });
  }

  var toastTimer = null;
  function toast(text) {
    var el = $("toast");
    el.textContent = text;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 3200);
  }

  // 目標を達成したとき: 輪がゆっくり光る
  function celebrate() {
    var ring = $("ring-progress");
    if (!ring.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    ring.animate([{ filter: "drop-shadow(0 0 0 transparent)" }, { filter: "drop-shadow(0 0 22px var(--accent-2))" }, { filter: "drop-shadow(0 0 0 transparent)" }], { duration: 1800, easing: "ease-in-out" });
  }

  // ---------- 設定 ----------
  var fields = {
    focus: $("set-focus"), short: $("set-short"), long: $("set-long"), every: $("set-every"), goal: $("set-goal"),
    autoBreak: $("set-auto-break"), autoFocus: $("set-auto-focus"), sound: $("set-sound"), notify: $("set-notify")
  };
  function fillSettings() {
    ["focus", "short", "long", "every", "goal"].forEach(function (k) { fields[k].value = settings[k]; });
    ["autoBreak", "autoFocus", "sound", "notify"].forEach(function (k) { fields[k].checked = settings[k]; });
    renderNotifyHint();
  }
  function renderNotifyHint() {
    var hint = $("notify-hint");
    if (!("Notification" in window)) hint.textContent = t("このブラウザは通知に対応していません。");
    else if (Notification.permission === "denied") hint.textContent = t("通知がブロックされています。ブラウザのサイトの設定で許可してください。");
    else hint.textContent = "";
  }
  function saveSettings(patch) {
    var goalChanged = patch.goal !== undefined && patch.goal !== settings.goal;
    settings = normalizeSettings(Object.assign({}, settings, patch));
    if (goalChanged) settings.goalUpdatedAt = Date.now();
    save(SETTINGS_KEY, settings);
    // 止まっていて、まだ始めていないタイマーは、新しい時間にそろえる
    if (!timer.running && !timer.focusStart) { timer.remaining = durationOf(timer.mode); persist(); }
    render();
    renderStats();
    if (goalChanged) changed("goal");
  }
  ["focus", "short", "long", "every", "goal"].forEach(function (k) {
    fields[k].addEventListener("change", function () { var p = {}; p[k] = fields[k].value; saveSettings(p); fields[k].value = settings[k]; });
  });
  ["autoBreak", "autoFocus", "sound"].forEach(function (k) {
    fields[k].addEventListener("change", function () {
      var p = {}; p[k] = fields[k].checked; saveSettings(p);
      if (k === "sound" && settings.sound) { ensureAudio(); chime(); }
    });
  });
  fields.notify.addEventListener("change", function () {
    if (!fields.notify.checked) { saveSettings({ notify: false }); return; }
    if (!("Notification" in window)) { fields.notify.checked = false; renderNotifyHint(); return; }
    Notification.requestPermission().then(function (p) {
      var ok = p === "granted";
      fields.notify.checked = ok;
      saveSettings({ notify: ok });
      renderNotifyHint();
      if (ok) toast(t("終わったときに通知します"));
    });
  });

  // 設定（MALU の設定と同じ形。左のカテゴリで中身を切りかえる。開くたびに「基本設定」から）
  var settingsNav = [].slice.call(document.querySelectorAll("#settings [data-settings-target]"));
  function showSettingsSection(id) {
    [].forEach.call(document.querySelectorAll("#settings .settings-section"), function (sec) { sec.classList.toggle("settings-section--active", sec.id === id); });
    settingsNav.forEach(function (b) {
      var on = b.getAttribute("data-settings-target") === id;
      b.classList.toggle("active", on);
      if (on) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });
    var body = document.querySelector("#settings .settings-panel__body");
    if (body) body.scrollTop = 0;
  }
  // スマホ（せまい画面）: 最初はカテゴリの一覧だけ。押すとその中身に切りかわり（is-detail）、戻るボタンで一覧に戻る
  var settingsLayout = document.querySelector("#settings .settings-layout");
  function narrow() { return window.matchMedia && matchMedia("(max-width: 820px)").matches; }
  settingsNav.forEach(function (b) {
    b.addEventListener("click", function () {
      showSettingsSection(b.getAttribute("data-settings-target"));
      settingsLayout.classList.add("is-detail");
    });
  });
  // 設定を検索: カテゴリの名前・要約と、そのページの中の文字で、一覧をしぼる
  var settingsSearch = $("settings-search");
  function filterSettings() {
    var v = settingsSearch.value.trim().toLowerCase(), any = false;
    settingsNav.forEach(function (b) {
      var sec = document.getElementById(b.getAttribute("data-settings-target"));
      var hit = !v || (b.textContent + " " + (sec ? sec.textContent : "")).toLowerCase().indexOf(v) >= 0;
      b.hidden = !hit;
      if (hit) any = true;
    });
    $("settings-search-none").hidden = any;
  }
  settingsSearch.addEventListener("input", filterSettings);
  // 開く・閉じるときの動きは MALU と同じ（元の画面が少し沈んで消えてから、設定が右から入る。閉じるときは逆）
  var settingsDialog = $("settings");
  var mainParts = [document.querySelector(".top-bar"), document.querySelector(".page")];
  function reduced() { return window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches; }
  function animateEl(el, cls, ms) {
    if (!el || reduced()) return;
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, ms);
  }
  var settingsBusy = false;
  function openSettings() {
    if (settingsDialog.open || settingsBusy) return;
    fillSettings();
    showSettingsSection("settings-general");
    settingsLayout.classList.remove("is-detail");
    settingsSearch.value = "";
    filterSettings();
    showVersion();
    if (reduced()) { settingsDialog.showModal(); return; }
    settingsBusy = true;
    mainParts.forEach(function (el) { el.classList.add("view-exit"); });
    setTimeout(function () {
      mainParts.forEach(function (el) { el.classList.remove("view-exit"); });
      settingsDialog.showModal();
      animateEl(settingsDialog, "settings-view--enter", 400);
      settingsBusy = false;
    }, 180);
  }
  function closeSettings() {
    if (!settingsDialog.open || settingsBusy) return;
    if (reduced()) { settingsDialog.close(); return; }
    settingsBusy = true;
    settingsDialog.classList.add("settings-view--leave");
    setTimeout(function () {
      settingsDialog.classList.remove("settings-view--leave");
      settingsDialog.close();
      mainParts.forEach(function (el) { animateEl(el, "view-enter", 400); });
      settingsBusy = false;
    }, 200);
  }
  $("settings-button").addEventListener("click", openSettings);
  // 戻るボタン（form method="dialog"）と Esc キーも、動きをつけて閉じる
  settingsDialog.querySelector("form").addEventListener("submit", function (e) {
    e.preventDefault();
    // スマホで中身を見ているときは、まずカテゴリの一覧に戻る
    if (narrow() && settingsLayout.classList.contains("is-detail")) { settingsLayout.classList.remove("is-detail"); return; }
    closeSettings();
  });
  settingsDialog.addEventListener("cancel", function (e) { e.preventDefault(); closeSettings(); });

  // 押したところから広がる波紋（MALU と同じ）
  var RIPPLE = ".icon-btn, .filled-btn, .text-btn, .outlined-btn, .tonal-icon-btn, .fab, .segmented button, .settings-nav__item, .settings-action, .chip";
  document.addEventListener("pointerdown", function (e) {
    var target = e.target.closest && e.target.closest(RIPPLE);
    if (!target || target.disabled || reduced()) return;
    var r = target.getBoundingClientRect();
    var size = Math.hypot(r.width, r.height) * 2;
    var dot = document.createElement("span");
    dot.className = "ripple";
    dot.style.width = dot.style.height = size + "px";
    dot.style.left = (e.clientX - r.left - size / 2) + "px";
    dot.style.top = (e.clientY - r.top - size / 2) + "px";
    target.appendChild(dot);
    dot.addEventListener("animationend", function () { dot.remove(); });
  });

  // 更新の確認（MALU と同じ。Service Worker に新しい版がないか確かめる。見つけたら、ボタンが「再読み込み」に変わる）
  var updateBox = document.querySelector("#settings .about-status");
  var updateStatus = $("about-update-status");
  var updateButton = $("check-update");
  var updateFound = false;
  function setUpdateState(state, text) {
    updateBox.classList.toggle("is-checking", state === "checking");
    updateBox.classList.toggle("is-new", state === "new");
    updateBox.classList.toggle("is-error", state === "error");
    updateBox.querySelector(".about-status__mark .ms").textContent = state === "checking" ? "progress_activity" : state === "new" ? "upgrade" : state === "error" ? "error" : "check";
    updateStatus.textContent = text;
  }
  function checkUpdate() {
    if (updateFound) { location.reload(); return; }
    if (!("serviceWorker" in navigator)) { setUpdateState("error", t("この端末では更新を確認できません")); return; }
    updateButton.disabled = true;
    setUpdateState("checking", t("更新を確認しています…"));
    navigator.serviceWorker.getRegistration().then(function (reg) {
      if (!reg) throw new Error("no registration");
      return reg.update().then(function () { return reg; });
    }).then(function (reg) {
      updateFound = !!(reg.installing || reg.waiting);
      if (updateFound) {
        setUpdateState("new", t("新しい版が見つかりました"));
        updateButton.textContent = t("再読み込み");
      } else {
        setUpdateState("ok", t("Nagi は最新です"));
      }
    }).catch(function () {
      setUpdateState("error", t("更新を確認できませんでした。インターネットの接続を確かめてください"));
    }).then(function () { updateButton.disabled = false; });
  }
  updateButton.addEventListener("click", checkUpdate);

  // キャッシュを消して読み込み直す（Nagi が保存したファイルだけ。localStorage の記録と設定には触らない）
  $("reset-cache").addEventListener("click", function () {
    var btn = this;
    btn.disabled = true;
    var jobs = [];
    if (window.caches && caches.keys) jobs.push(caches.keys().then(function (names) { return Promise.all(names.filter(function (n) { return /^nagi-/.test(n); }).map(function (n) { return caches.delete(n); })); }));
    if (navigator.serviceWorker) jobs.push(navigator.serviceWorker.getRegistration().then(function (reg) { return reg && reg.unregister(); }));
    Promise.all(jobs).catch(function () {}).then(function () { location.reload(); });
  });

  // バージョン（このアプリについて）。「1.0（ビルド 6）」… ビルドは、この端末に入っている Service Worker のキャッシュの番号（nagi/sw.js の CACHE_NAME）
  var APP_VERSION = "1.0";
  function showVersion() {
    var out = $("app-version");
    out.textContent = APP_VERSION;
    if (!window.caches || !caches.keys) return;
    caches.keys().then(function (names) {
      var build = 0;
      names.forEach(function (n) { var m = /^nagi-v(\d+)$/.exec(n); if (m) build = Math.max(build, +m[1]); });
      if (build) out.textContent = t("{version}（ビルド {build}）", { version: APP_VERSION, build: build });
    }).catch(function () {});
  }
  $("clear-button").addEventListener("click", function () {
    if (!confirm(t("このブラウザに保存した集中の記録を消します。SK Hub Systems アカウントで同期している記録は消えません。よろしいですか？"))) return;
    sessions = [];
    save(SESSIONS_KEY, sessions);
    renderStats();
    toast(t("このブラウザの記録を消しました"));
    changed("cleared");
  });

  // ---------- 操作 ----------
  $("start-button").addEventListener("click", function () { if (timer.running) pause(); else start(); });
  $("reset-button").addEventListener("click", reset);
  $("skip-button").addEventListener("click", skip);
  document.querySelectorAll("[data-mode]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.dataset.mode === timer.mode) return;
      if (timer.mode === "focus") record(timer.focusStart || Date.now(), focusedSoFar());
      setMode(btn.dataset.mode, true);
    });
  });
  // キーボード: Space はじめる・一時停止 / R リセット / N 次へ / F 拡大表示 / Esc 拡大表示をやめる（入力中・設定を開いているときは除く）
  document.addEventListener("keydown", function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest("input, textarea, select, dialog[open]")) return;
    if (e.code === "Space") {
      if (e.target.closest("button")) return; // ボタンにいるときは、ボタンを押したことにする
      e.preventDefault();
      if (timer.running) pause(); else start();
    } else if (e.code === "KeyR") { e.preventDefault(); reset(); }
    else if (e.code === "KeyN") { e.preventDefault(); skip(); }
    else if (e.code === "KeyF") { e.preventDefault(); setZen(!isZen()); }
    else if (e.code === "Escape" && isZen() && !document.fullscreenElement) { setZen(false); }
  });

  // ---------- 拡大表示（タイマーだけを画面いっぱいに） ----------
  // 全画面にできるブラウザでは全画面にする。動いているあいだは画面が暗くならないようにする（Screen Wake Lock）
  var wakeLock = null;
  function isZen() { return document.body.classList.contains("is-zen"); }
  function setZen(on) {
    document.body.classList.toggle("is-zen", on);
    $("zen-icon").textContent = on ? "fullscreen_exit" : "fullscreen";
    $("zen-button").setAttribute("aria-label", on ? t("拡大表示をやめる") : t("拡大表示"));
    $("zen-button").title = on ? t("拡大表示をやめる") + "（F）" : t("拡大表示") + "（F）";
    var root = document.documentElement;
    if (on && root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(function () {});
    if (!on && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    updateWakeLock();
    poke();
  }
  $("zen-button").addEventListener("click", function () { setZen(!isZen()); });
  // Esc などで全画面をやめたら、拡大表示もやめる
  document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement && isZen()) setZen(false); });
  function updateWakeLock() {
    var want = isZen() && timer.running && "wakeLock" in navigator && document.visibilityState === "visible";
    if (want && !wakeLock) {
      navigator.wakeLock.request("screen").then(function (lock) {
        wakeLock = lock;
        lock.addEventListener("release", function () { wakeLock = null; });
      }).catch(function () {});
    } else if (!want && wakeLock) {
      wakeLock.release().catch(function () {});
      wakeLock = null;
    }
  }
  // 拡大表示で動いているあいだ、3 秒さわらなければボタンを隠す（動かすと戻る）
  var idleTimer = null;
  function poke() {
    document.body.classList.remove("is-idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { if (isZen() && timer.running) document.body.classList.add("is-idle"); }, 3000);
  }
  ["mousemove", "pointerdown", "keydown", "touchstart"].forEach(function (name) { document.addEventListener(name, poke, { passive: true }); });
  // 別のタブから戻ったとき・スリープから戻ったときに表示を合わせる
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") { renderTime(); renderStats(); }
    updateWakeLock(); // 画面が暗くならないようにする設定は、タブを離れると外れるので付け直す
  });

  // ---------- ホーム画面に追加 ----------
  var installEvent = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    installEvent = e;
    if (!load(INSTALL_KEY, false)) $("install-banner").hidden = false;
  });
  $("install-button").addEventListener("click", function () {
    $("install-banner").hidden = true;
    if (installEvent) installEvent.prompt();
    installEvent = null;
  });
  $("install-dismiss").addEventListener("click", function () {
    $("install-banner").hidden = true;
    save(INSTALL_KEY, true);
  });
  window.addEventListener("appinstalled", function () { $("install-banner").hidden = true; });
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }

  // ---------- account.js（同期）とのやり取り ----------
  window.NAGI = {
    t: t,
    toast: toast,
    getSessions: function () { return sessions.slice(); },
    // 同期でまとめた記録を入れる（ID でまとめる。新しいものから SESSIONS_MAX 件）
    mergeSessions: function (list) {
      var byId = {};
      sessions.concat(list || []).forEach(function (x) { if (x && x.i && isFinite(x.s) && isFinite(x.m)) byId[x.i] = { i: String(x.i), s: Number(x.s), m: Number(x.m) }; });
      var merged = Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (a, b) { return a.s - b.s; }).slice(-SESSIONS_MAX);
      var changedAny = merged.length !== sessions.length;
      sessions = merged;
      save(SESSIONS_KEY, sessions);
      renderStats();
      return changedAny;
    },
    getGoal: function () { return { goal: settings.goal, updatedAt: settings.goalUpdatedAt }; },
    // アカウントの目標のほうが新しければ、そちらにする
    setGoal: function (goal, updatedAt) {
      if (!(updatedAt > settings.goalUpdatedAt)) return;
      settings = normalizeSettings(Object.assign({}, settings, { goal: goal, goalUpdatedAt: updatedAt }));
      save(SETTINGS_KEY, settings);
      renderStats();
    },
    onChange: function (fn) { listeners.push(fn); }
  };

  // ---------- 起動 ----------
  // 閉じているあいだに終わっていたら、そこで区切る（自動では次を始めない）
  if (timer.running && timer.endAt <= Date.now()) {
    if (timer.mode === "focus") record(timer.focusStart || timer.endAt - durationOf("focus"), timer.focusedMs + (timer.endAt - timer.resumedAt));
    var nm = nextMode();
    if (timer.mode !== "focus") timer.round = timer.mode === "long" ? 1 : timer.round + 1;
    setMode(nm, true);
  } else if (timer.running) {
    schedule();
  }
  render();
  renderStats();
  // 日付が変わったら、今日の集計を切り替える
  setInterval(renderStats, 60 * 1000);
})();
