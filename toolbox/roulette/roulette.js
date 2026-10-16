// Roulette（SK's Toolbox）— 回して決めるルーレット
//   ・localStorage の sk_roulette に保存する（オンライン同期をオンにしたときだけ、暗号化して SK Hub Systems アカウントにも保存する。/toolbox/shared/sync.js）
//       { version: 1, current: いまのルーレットの ID, sound: true,
//         wheels: [{ id, name, items: [{ id, text, color, out }], removeWinner, updated }],
//         history: [{ id, text, color, wheel, at }] }   … 新しい順に 30 件まで
//   ・当たりは、外していない項目から同じ確率で選ぶ（crypto.getRandomValues）。回る向きと止まる位置は、当たりに合わせて計算する
//   ・「当たったものを次から外す」がオンなら、当たった項目に out を付けて、次から盤に出さない（「戻す」で全部戻る）
//   ・回っているあいだ、面が針を通るたびに「カチッ」と鳴らす（Web Audio。音のボタンで消せる）・端末が対応していれば振動
//   ・?embed のときは見本を表示だけする
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
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function str(v, max) { return typeof v === "string" ? v.slice(0, max) : ""; }
  function rand() { var a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] / 4294967296; }
  var reduced = function () { return root.getAttribute("data-motion") === "reduce" || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches); };

  var COLORS = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16", "#06b6d4", "#eab308"];
  var MAX_ITEMS = 60;

  // ================================================================
  // データ
  // ================================================================
  var STORE = "sk_roulette";
  function cleanWheel(w) {
    w = w && typeof w === "object" ? w : {};
    var items = (Array.isArray(w.items) ? w.items : []).filter(function (x) { return x && typeof x.text === "string" && x.text.trim(); }).slice(0, MAX_ITEMS).map(function (x, i) {
      return { id: typeof x.id === "string" ? x.id.slice(0, 30) : newId(), text: x.text.trim().slice(0, 60), color: /^#[0-9a-f]{6}$/i.test(x.color || "") ? x.color : COLORS[i % COLORS.length], out: !!x.out };
    });
    return { id: typeof w.id === "string" ? w.id.slice(0, 30) : newId(), name: str(w.name, 40).trim() || t("ルーレット"), items: items, removeWinner: !!w.removeWinner, updated: Number(w.updated) || 0 };
  }
  // 見本（今日のごはん）。訳を build で拾えるように、t() は 1 つずつ書く
  var LUNCH = [t("カレー"), t("ラーメン"), t("お寿司"), t("パスタ"), t("ハンバーグ"), t("うどん")];
  function sample() {
    return cleanWheel({ id: "lunch", name: t("今日のごはん"), items: LUNCH.map(function (s, i) { return { id: "s" + i, text: s }; }) });
  }
  var data = { version: 1, current: "", sound: true, wheels: [], history: [] };
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(STORE) || "null");
      if (!d) { data.wheels = [sample()]; data.current = data.wheels[0].id; return; }
      data.wheels = (Array.isArray(d.wheels) ? d.wheels : []).map(cleanWheel);
      if (!data.wheels.length) data.wheels = [sample()];
      data.current = data.wheels.some(function (w) { return w.id === d.current; }) ? d.current : data.wheels[0].id;
      data.sound = d.sound !== false;
      data.history = (Array.isArray(d.history) ? d.history : []).filter(function (h) { return h && typeof h.text === "string"; }).slice(0, 30).map(function (h) {
        return { id: typeof h.id === "string" ? h.id : newId(), text: h.text.slice(0, 60), color: /^#[0-9a-f]{6}$/i.test(h.color || "") ? h.color : COLORS[0], wheel: str(h.wheel, 40), at: Number(h.at) || 0 };
      });
    } catch (e) { data.wheels = [sample()]; data.current = data.wheels[0].id; }
  }
  function save() {
    if (embed) return;
    try { localStorage.setItem(STORE, JSON.stringify(data)); } catch (e) { say(t("保存できませんでした")); }
  }
  function wheel() { for (var i = 0; i < data.wheels.length; i++) if (data.wheels[i].id === data.current) return data.wheels[i]; return data.wheels[0]; }
  function touch() { wheel().updated = Date.now(); save(); }
  function active() { return wheel().items.filter(function (x) { return !x.out; }); }

  if (embed) { root.classList.add("is-embed"); data.wheels = [sample()]; data.current = data.wheels[0].id; } else load();

  // ================================================================
  // 盤（SVG）
  // ================================================================
  var wheelEl = $("wheel"), box = $("wheel-box"), spinBtn = $("spin");
  var rotation = 0, spinning = false, drawnIds = "";
  var SVGNS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs) { var e = document.createElementNS(SVGNS, tag); Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); return e; }
  function short(text, n) { var chars = Array.from(text); return chars.length > n ? chars.slice(0, n - 1).join("") + "…" : text; }
  function drawWheel() {
    var list = active();
    drawnIds = list.map(function (x) { return x.id + x.text + x.color; }).join("|");
    wheelEl.textContent = "";
    if (list.length < 2) {
      var em = el("div", "wheel-empty", list.length ? t("項目をもう 1 つ以上入れてください") : t("右の「項目」に、選ぶものを入れてください"));
      wheelEl.appendChild(em);
      spinBtn.disabled = true;
      return;
    }
    spinBtn.disabled = false;
    var n = list.length, R = 200, s = 360 / n;
    var g = svg("svg", { viewBox: "-200 -200 400 400", role: "img", "aria-label": list.map(function (x) { return x.text; }).join("、") });
    list.forEach(function (it, i) {
      var a0 = (i * s - 90) * Math.PI / 180, a1 = ((i + 1) * s - 90) * Math.PI / 180;
      var large = s > 180 ? 1 : 0;
      var d = "M0 0 L" + (R * Math.cos(a0)).toFixed(2) + " " + (R * Math.sin(a0)).toFixed(2) + " A" + R + " " + R + " 0 " + large + " 1 " + (R * Math.cos(a1)).toFixed(2) + " " + (R * Math.sin(a1)).toFixed(2) + " Z";
      g.appendChild(svg("path", { d: d, fill: it.color }));
      var mid = i * s + s / 2;
      var fs = n <= 6 ? 22 : n <= 10 ? 18 : n <= 16 ? 14 : n <= 24 ? 11 : 9;
      var max = n <= 6 ? 9 : n <= 12 ? 8 : 7;
      // 左半分の面は、文字が逆さまにならないよう、外側から内側へ読む向きにする
      var left = mid > 180;
      var text = svg("text", {
        "font-size": fs, "text-anchor": left ? "start" : "end", "dominant-baseline": "middle",
        transform: left ? "rotate(" + (mid + 90) + ") translate(" + -(R - 16) + " 0)" : "rotate(" + (mid - 90) + ") translate(" + (R - 16) + " 0)"
      });
      text.textContent = short(it.text, max);
      g.appendChild(text);
    });
    // 面の境目
    list.forEach(function (it, i) {
      var a = (i * s - 90) * Math.PI / 180;
      g.appendChild(svg("line", { x1: 0, y1: 0, x2: (R * Math.cos(a)).toFixed(2), y2: (R * Math.sin(a)).toFixed(2), stroke: "rgba(255,255,255,.55)", "stroke-width": n > 24 ? 1 : 2 }));
    });
    wheelEl.appendChild(g);
    wheelEl.style.transition = "none";
    wheelEl.style.transform = "rotate(" + rotation + "deg)";
  }

  // ================================================================
  // 音・振動
  // ================================================================
  var audio = null;
  function tickSound() {
    if (!data.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var o = audio.createOscillator(), gn = audio.createGain(), now = audio.currentTime;
      o.type = "triangle";
      o.frequency.setValueAtTime(1500, now);
      o.frequency.exponentialRampToValueAtTime(600, now + .03);
      gn.gain.setValueAtTime(.12, now);
      gn.gain.exponentialRampToValueAtTime(.001, now + .05);
      o.connect(gn); gn.connect(audio.destination);
      o.start(now); o.stop(now + .06);
    } catch (e) { /* 音が出せない */ }
  }
  function fanfare() {
    if (!data.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      [523.25, 659.25, 783.99, 1046.5].forEach(function (f, i) {
        var o = audio.createOscillator(), gn = audio.createGain(), at = audio.currentTime + i * .09;
        o.type = "sine";
        o.frequency.value = f;
        gn.gain.setValueAtTime(0, at);
        gn.gain.linearRampToValueAtTime(.14, at + .02);
        gn.gain.exponentialRampToValueAtTime(.001, at + .5);
        o.connect(gn); gn.connect(audio.destination);
        o.start(at); o.stop(at + .55);
      });
    } catch (e) { /* 音が出せない */ }
  }
  function vibrate(ms) { if (window.SKToolbox && SKToolbox.get().haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* 対応していない */ } } }

  // ================================================================
  // 回す
  // ================================================================
  function angleNow() {
    var m = getComputedStyle(wheelEl).transform;
    if (!m || m === "none") return rotation;
    var v = m.match(/matrix\(([^)]+)\)/);
    if (!v) return rotation;
    var p = v[1].split(",").map(Number);
    var a = Math.atan2(p[1], p[0]) * 180 / Math.PI;
    return (a + 360) % 360;
  }
  function spin() {
    if (spinning || embed) return;
    var list = active();
    if (list.length < 2) return;
    closeWin();
    spinning = true;
    spinBtn.disabled = true;
    var n = list.length, s = 360 / n;
    var win = Math.floor(rand() * n);
    // 針（上）の下に来る角度: 当たりの面の 15〜85% のどこか
    var pointer = win * s + s * (.15 + .7 * rand());
    var base = ((rotation % 360) + 360) % 360;
    var delta = ((360 - pointer) - base + 720) % 360;
    var turns = reduced() ? 1 : 5 + Math.floor(rand() * 3);
    var target = rotation + turns * 360 + delta;
    var dur = reduced() ? 600 : 4200 + rand() * 1200;
    wheelEl.style.transition = "transform " + dur + "ms cubic-bezier(.12, .62, .08, 1)";
    void wheelEl.offsetWidth;
    wheelEl.style.transform = "rotate(" + target + "deg)";
    rotation = target;
    // 針を通るたびにカチッ
    var lastSeg = -1, started = performance.now();
    (function watch() {
      if (!spinning) return;
      var a = angleNow();
      var seg = Math.floor((((360 - a) % 360) + 360) % 360 / s);
      if (seg !== lastSeg) {
        if (lastSeg !== -1) {
          tickSound();
          vibrate(4);
          box.classList.remove("is-tick"); void box.offsetWidth; box.classList.add("is-tick");
        }
        lastSeg = seg;
      }
      if (performance.now() - started < dur + 100) requestAnimationFrame(watch);
    })();
    setTimeout(function () { finish(list[win]); }, dur + 60);
  }
  spinBtn.addEventListener("click", spin);
  wheelEl.addEventListener("click", spin);

  function finish(it) {
    spinning = false;
    spinBtn.disabled = false;
    var w = wheel();
    data.history.unshift({ id: newId(), text: it.text, color: it.color, wheel: w.name, at: Date.now() });
    data.history = data.history.slice(0, 30);
    if (w.removeWinner) { var item = find(it.id); if (item) item.out = true; touch(); }
    else save();
    var res = $("result");
    res.textContent = "";
    res.append(document.createTextNode(t("結果") + ": "), el("b", "", it.text));
    fanfare();
    vibrate(30);
    showWin(it);
    renderItems(it.id);
    renderHistory();
    if (w.removeWinner) drawWheel();
    renderHead();
  }

  // ================================================================
  // 結果
  // ================================================================
  var winBox = $("win"), lastWin = null;
  function showWin(it) {
    lastWin = it;
    $("win-text").textContent = it.text;
    $("win-text").style.setProperty("--ic", it.color);
    $("win-remove").hidden = wheel().removeWinner || active().length < 3;
    winBox.hidden = false;
    lineButton();
    confetti(it.color);
    $("win-again").focus();
  }
  // 結果を LINE・KakaoTalk の友だち・グループにカードで送る（window.SKMsg。/toolbox/shared/line.js・kakao.js。どちらでもないときは LINE の共有のリンク）
  var lineBtn = null;
  function lineButton() {
    if (lineBtn || !window.SKMsg) return;
    lineBtn = SKMsg.button(SKMsg.sendLabel());
    lineBtn.classList.add("win__line");
    lineBtn.addEventListener("click", function () {
      if (!lastWin) return;
      var url = "https://sk-hub.jp/toolbox/roulette/";
      var name = wheel().name;
      SKMsg.share(SKMsg.card({
        alt: t("ルーレットの結果: {text}", { text: lastWin.text }), kicker: t("ルーレット · {name}", { name: name }), title: lastWin.text,
        sub: t("SK's Toolbox のルーレットで決まりました"), color: lastWin.color, url: url, button: t("自分も回す")
      }), t("ルーレットの結果: {text}", { text: lastWin.text }) + "（" + name + "）\n" + url).then(function (r) { if (r === "sent") say(SKMsg.sentLabel()); });
    });
    $("win").querySelector(".win__actions").appendChild(lineBtn);
  }
  function closeWin() { if (!winBox.hidden) { winBox.hidden = true; $("confetti").textContent = ""; } }
  function confetti(main) {
    var c = $("confetti");
    c.textContent = "";
    if (reduced()) return;
    for (var i = 0; i < 36; i++) {
      var p = el("i");
      p.style.left = (rand() * 100) + "%";
      p.style.setProperty("--c", i % 3 === 0 ? main : COLORS[Math.floor(rand() * COLORS.length)]);
      p.style.setProperty("--x", ((rand() - .5) * 240) + "px");
      p.style.setProperty("--r", (rand() * 900 - 450) + "deg");
      p.style.setProperty("--d", (1.6 + rand() * 1.4) + "s");
      p.style.setProperty("--delay", (rand() * .3) + "s");
      c.appendChild(p);
    }
  }
  $("win-close").addEventListener("click", function () { closeWin(); spinBtn.focus(); });
  $("win-again").addEventListener("click", function () { closeWin(); spin(); });
  $("win-remove").addEventListener("click", function () {
    if (lastWin) { var item = find(lastWin.id); if (item) { item.out = true; touch(); } }
    closeWin();
    render();
    spin();
  });
  winBox.addEventListener("click", function (e) { if (e.target === winBox) closeWin(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && !winBox.hidden) { closeWin(); spinBtn.focus(); return; }
    // スペースで回す（入力中・ダイアログ中は除く）
    if ((e.key === " " || e.code === "Space") && !e.target.closest("input, textarea, button, [contenteditable]") && !document.querySelector(".tbs-dialog-scrim, .tbs-overlay")) {
      e.preventDefault();
      spin();
    }
  });

  // ================================================================
  // 項目
  // ================================================================
  function find(id) { var list = wheel().items; for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function renderItems(hitId) {
    var w = wheel(), ul = $("items");
    ul.textContent = "";
    w.items.forEach(function (it) {
      var li = el("li", "item" + (it.out ? " is-out" : "") + (it.id === hitId ? " is-hit" : ""));
      li.style.setProperty("--ic", it.color);
      var dot = el("button", "item__dot m3-state");
      dot.type = "button";
      dot.title = t("色を変える");
      dot.setAttribute("aria-label", t("{text} の色を変える", { text: it.text }));
      dot.addEventListener("click", function () {
        if (spinning) return;
        it.color = COLORS[(COLORS.indexOf(it.color) + 1) % COLORS.length];
        touch(); renderItems(); drawWheel();
      });
      var input = el("input");
      input.type = "text";
      input.value = it.text;
      input.maxLength = 60;
      input.setAttribute("aria-label", t("項目"));
      input.addEventListener("change", function () {
        var v = input.value.trim();
        if (!v) { input.value = it.text; return; }
        it.text = v;
        touch(); drawWheel();
      });
      input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.isComposing) input.blur(); });
      var del = el("button", "icon-btn m3-state");
      del.type = "button";
      del.setAttribute("aria-label", t("{text} を消す", { text: it.text }));
      del.title = t("消す");
      del.appendChild(icon("close"));
      del.addEventListener("click", function () {
        if (spinning) return;
        var idx = w.items.indexOf(it);
        w.items.splice(idx, 1);
        touch(); render();
        say(t("{text} を消しました", { text: it.text }), function () { w.items.splice(idx, 0, it); touch(); render(); });
      });
      li.append(dot, input, del);
      ul.appendChild(li);
    });
    var outs = w.items.filter(function (x) { return x.out; }).length;
    $("btn-restore").hidden = !outs;
    $("restore-label").textContent = t("外した {n} 件を戻す", { n: outs });
    $("opt-remove").checked = w.removeWinner;
  }
  $("add").addEventListener("submit", function (e) {
    e.preventDefault();
    var input = $("add-text"), w = wheel();
    var lines = input.value.split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (!lines.length || spinning) return;
    if (w.items.length + lines.length > MAX_ITEMS) { say(t("項目は {n} 個までです", { n: MAX_ITEMS })); return; }
    lines.forEach(function (s) { w.items.push({ id: newId(), text: s.slice(0, 60), color: COLORS[w.items.length % COLORS.length], out: false }); });
    input.value = "";
    touch(); render();
  });
  // 改行の入った文字を貼り付けたら、1 行ずつ項目にする
  $("add-text").addEventListener("paste", function (e) {
    var text = (e.clipboardData || window.clipboardData).getData("text");
    if (!/\n/.test(text)) return;
    e.preventDefault();
    this.value = text;
    $("add").requestSubmit ? $("add").requestSubmit() : $("add").dispatchEvent(new Event("submit", { cancelable: true }));
  });
  $("opt-remove").addEventListener("change", function () { wheel().removeWinner = this.checked; touch(); renderItems(); });
  $("btn-restore").addEventListener("click", function () { wheel().items.forEach(function (x) { x.out = false; }); touch(); render(); });
  $("btn-shuffle").addEventListener("click", function () {
    if (spinning) return;
    var list = wheel().items;
    for (var i = list.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)); var tmp = list[i]; list[i] = list[j]; list[j] = tmp; }
    touch(); render();
  });

  // ================================================================
  // 履歴・見出し・ルーレットの切りかえ
  // ================================================================
  var timeFmt = new Intl.DateTimeFormat(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  function renderHistory() {
    var ol = $("history");
    ol.textContent = "";
    data.history.slice(0, 20).forEach(function (h) {
      var li = el("li");
      li.style.setProperty("--ic", h.color);
      var tm = el("time", "", timeFmt.format(new Date(h.at)));
      tm.dateTime = new Date(h.at).toISOString();
      li.append(el("span", "", h.text + (data.wheels.length > 1 ? "（" + h.wheel + "）" : "")), tm);
      ol.appendChild(li);
    });
    $("history-empty").hidden = data.history.length > 0;
  }
  function renderHead() {
    var w = wheel(), n = active().length;
    $("title").textContent = w.name;
    $("sub").textContent = t("{n} 個の項目", { n: w.items.length }) + (n !== w.items.length ? " · " + t("いま回すのは {n} 個", { n: n }) : "");
    var bar = $("wheels");
    bar.textContent = "";
    data.wheels.forEach(function (x) {
      var b = el("button", "wheel-chip m3-state", x.name);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(x.id === data.current));
      b.addEventListener("click", function () { if (spinning) return; data.current = x.id; save(); rotation = 0; render(); });
      bar.appendChild(b);
    });
    var add = el("button", "wheel-chip wheel-chip--add m3-state");
    add.type = "button";
    add.setAttribute("aria-label", t("新しいルーレット"));
    add.title = t("新しいルーレット");
    add.appendChild(icon("add"));
    add.addEventListener("click", newWheel);
    bar.appendChild(add);
  }
  function render() {
    renderHead();
    renderItems();
    renderHistory();
    var ids = active().map(function (x) { return x.id + x.text + x.color; }).join("|");
    if (ids !== drawnIds || !wheelEl.firstChild) drawWheel();
    var sb = $("btn-sound");
    sb.setAttribute("aria-pressed", String(data.sound));
    $("sound-icon").textContent = data.sound ? "volume_up" : "volume_off";
  }

  // 新しいルーレット（ひな形から）
  var PRESETS = [
    { name: t("空のルーレット"), icon: "add", items: [] },
    { name: t("はい・いいえ"), icon: "help", items: [t("はい"), t("いいえ")] },
    { name: t("サイコロ"), icon: "casino", items: ["1", "2", "3", "4", "5", "6"] },
    { name: t("じゃんけん"), icon: "back_hand", items: [t("グー"), t("チョキ"), t("パー")] },
    { name: t("今日のごはん"), icon: "restaurant", items: LUNCH }
  ];
  function newWheel() {
    if (spinning || !window.M3) return;
    M3.choose({ title: t("新しいルーレット"), icon: "add_circle", options: PRESETS.map(function (p, i) { return { value: i, label: p.name, icon: p.icon }; }) }).then(function (i) {
      if (i === null || i === undefined) return;
      var p = PRESETS[i];
      var w = cleanWheel({ id: newId(), name: i === 0 ? t("ルーレット") : p.name, items: p.items.map(function (s, k) { return { id: newId(), text: s, color: COLORS[k % COLORS.length] }; }) });
      w.updated = Date.now();
      data.wheels.push(w);
      data.current = w.id;
      rotation = 0;
      save(); render();
      if (i === 0) $("add-text").focus();
    });
  }
  $("btn-sound").addEventListener("click", function () { data.sound = !data.sound; save(); render(); say(data.sound ? t("音をオンにしました") : t("音をオフにしました")); });

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
  // メニュー
  // ================================================================
  var menu = $("menu"), menuBtn = $("btn-menu");
  function setMenu(open) { menu.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open)); if (open) menu.querySelector("button").focus(); }
  menuBtn.addEventListener("click", function () { setMenu(menu.hidden); });
  document.addEventListener("click", function (e) { if (!menu.hidden && !e.target.closest(".menu-wrap")) setMenu(false); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) { setMenu(false); menuBtn.focus(); } });
  menu.addEventListener("click", function (e) {
    var b = e.target.closest("[data-menu]");
    if (!b || spinning) return;
    setMenu(false);
    var cmd = b.dataset.menu, w = wheel();
    if (cmd === "new") newWheel();
    else if (cmd === "rename") {
      M3.prompt({ title: t("名前を変える"), label: t("ルーレットの名前"), value: w.name, maxLength: 40, ok: t("保存") }).then(function (v) { if (v) { w.name = v.slice(0, 40); touch(); render(); } });
    } else if (cmd === "delete") {
      M3.confirm({ title: t("「{name}」を削除しますか？", { name: w.name }), text: t("項目もいっしょに削除します。元に戻せません。"), ok: t("削除"), danger: true }).then(function (yes) {
        if (!yes) return;
        data.wheels = data.wheels.filter(function (x) { return x !== w; });
        if (!data.wheels.length) data.wheels = [sample()];
        data.current = data.wheels[0].id;
        rotation = 0;
        save(); render();
      });
    } else if (cmd === "clear-history") { data.history = []; save(); renderHistory(); say(t("結果の履歴を消しました")); }
    else if (cmd === "export") {
      var url = URL.createObjectURL(new Blob([JSON.stringify({ app: "sk-roulette", version: 1, exportedAt: new Date().toISOString(), wheels: data.wheels }, null, 2)], { type: "application/json" }));
      var a = el("a"); a.href = url; a.download = "roulette-backup-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    } else if (cmd === "import") $("import-file").click();
  });
  $("import-file").addEventListener("change", function () {
    var file = this.files && this.files[0];
    this.value = "";
    if (!file) return;
    file.text().then(function (text) {
      var d = JSON.parse(text);
      var list = (d && Array.isArray(d.wheels) ? d.wheels : []).map(cleanWheel).filter(function (w) { return w.items.length; });
      if (!list.length) throw new Error("empty");
      var added = 0;
      list.forEach(function (w) {
        var mine = data.wheels.filter(function (x) { return x.id === w.id; })[0];
        if (!mine) { data.wheels.push(w); added++; }
        else if (w.updated > mine.updated) { Object.assign(mine, w); added++; }
      });
      save(); render();
      say(t("{n} 件読み込みました", { n: added }));
    }).catch(function () { say(t("読み込めませんでした。Roulette のバックアップのファイルを選んでください")); });
  });

  render();
  if (embed) return;
  window.addEventListener("storage", function (e) { if (e.key === STORE && !spinning) { load(); render(); } });
})();
