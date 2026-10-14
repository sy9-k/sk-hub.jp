// SK's Toolbox のオンライン同期（任意。最初はオフ）。/toolbox/shared/settings.js が読み込む
//   ・SK Hub Systems アカウントでログインし、アカウントで Toolbox に接続し、Toolbox の設定で「同期を始める」を選んだ端末だけが同期する
//   ・同期するもの（アプリごとに選べる）: Toolbox の設定とホームの並び・Todo・Memo の文章（画像はしない）・Countdown・Calc の履歴・自分の時間割・ルーレット
//   ・中身は端末で暗号化してから送る（/toolbox/shared/sync-core.js）。同期用のパスフレーズは本人が決め、サーバーには送らない
//   ・この端末の同期の設定は localStorage の sk_toolbox_sync（鍵を含むので、バックアップには入れない。ログアウトすると消える）
//       { uid, key, keyId, apps: { settings: true, … }, base: { アプリ: 前回そろえたときの指紋 }, at: 最後に同期した時刻, results: { アプリ: 結果 } }
//   ・同期のタイミング: 開いたとき・データを変えて少ししたら・画面に戻ったとき・5 分ごと・画面を離れるとき。
//     ほかのタブが同期しているあいだは待つ（Web Locks）。同期で書きかえたら storage イベントで各アプリに知らせる（ほかのタブで書いたときと同じ）
//   ・Firebase は、同期を使っている端末でだけ読み込む
//   ・同期を使っている端末では、SK Hub Systems アカウントのお知らせ（お問い合わせへの返事など）も受け取る
//       10 分に 1 回まで、同期のあとに未読を確かめる。新しいものは端末の通知で知らせる（「お知らせを通知する」がオンで、通知を許可しているとき。
//       許可していなければ画面の下に出す）。未読があれば、設定のボタンに点を付ける。localStorage の sk_toolbox_notices
//       { unread, items: [{ id, title, … }], notified: [知らせた ID], at: 確かめた時刻 }
//   ・設定の画面の「オンライン同期」: SKToolboxSync.mount(要素)
(function () {
  "use strict";
  if (/[?&]embed\b/.test(location.search) || window.SKToolboxSync) return;

  var CFG_KEY = "sk_toolbox_sync", HINT_KEY = "skhub_account", NOTICE_KEY = "sk_toolbox_notices";
  var NOTICE_INTERVAL = 10 * 60 * 1000;
  var I18N = window.SKI18N;
  function t(s, p) { return I18N ? I18N.t(s, p) : s.replace(/\{(\w+)\}/g, function (m, k) { return p && k in p ? p[k] : m; }); }
  function lp(u) { return I18N && I18N.path ? I18N.path(u) : u; }

  var APPS = [
    { key: "settings", name: t("Toolbox の設定"), what: t("テーマ・テーマカラー・ホームの並び"), icon: "/toolbox/icon.svg" },
    { key: "todo", name: "Todo", what: t("リストとタスク"), icon: "/toolbox/todo/icon.svg" },
    { key: "memo", name: "Memo", what: t("メモの文章（画像は同期しません）"), icon: "/toolbox/memo/icon.svg" },
    { key: "countdown", name: "Countdown", what: t("日の一覧"), icon: "/toolbox/countdown/icon.svg" },
    { key: "calc", name: "Calc", what: t("計算の履歴"), icon: "/toolbox/calc/icon.svg" },
    { key: "timetable", name: "Timetable", what: t("自分の時間割"), icon: "/toolbox/timetable/icon.svg" },
    { key: "roulette", name: "Roulette", what: t("ルーレットと結果の履歴"), icon: "/toolbox/roulette/icon.svg" }
  ];
  var STORAGE = { settings: ["sk_toolbox", "sk_toolbox_home"], todo: ["sk_todo"], memo: ["sk_memo"], countdown: ["sk_countdown"], calc: ["sk_calc"], timetable: ["sk_timetable"], roulette: ["sk_roulette"] };

  // ---- この端末の同期の設定 ----
  function readJson(key) { try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { return null; } }
  function cfg() {
    var c = readJson(CFG_KEY);
    return c && typeof c.key === "string" && typeof c.uid === "string" ? c : null;
  }
  function saveCfg(c) {
    try {
      if (c) localStorage.setItem(CFG_KEY, JSON.stringify(c)); else { localStorage.removeItem(CFG_KEY); localStorage.removeItem(NOTICE_KEY); }
    } catch (e) { /* 保存できなければ、次に開いたときに同期しないだけ */ }
    emit();
  }
  function hint() { return readJson(HINT_KEY); }
  function connected(h) { return !!(h && Array.isArray(h.services) && h.services.indexOf("toolbox") >= 0); }
  function appsOn(c) { return APPS.filter(function (a) { return !c.apps || c.apps[a.key] !== false; }).map(function (a) { return a.key; }); }
  // ログアウトした（ヘッダーの表示用の情報が消えた）ら、この端末の同期の設定（鍵）も消す
  if (cfg() && !hint()) saveCfg(null);

  // ---- 状態（画面に出す）----
  // phase: idle / syncing / error / offline / key-changed
  var state = { phase: "idle" };
  var listeners = [];
  function emit() { listeners.forEach(function (fn) { try { fn(); } catch (e) { /* 消えた画面 */ } }); }
  function setPhase(p) { state.phase = p; emit(); }

  var core = null;
  function loadCore() {
    if (!core) core = import("/toolbox/shared/sync-core.js").catch(function (e) { core = null; throw e; });
    return core;
  }

  // ---- 同期 ----
  var lastRaw = {};
  function rawNow() {
    var r = {};
    Object.keys(STORAGE).forEach(function (app) {
      r[app] = STORAGE[app].map(function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }).join("\u0000");
    });
    return r;
  }
  function dirty(c) {
    var now = rawNow();
    return appsOn(c).some(function (app) { return now[app] !== lastRaw[app]; });
  }
  // 入力中・ダイアログを開いているあいだは、書きかえない（Memo の本文は Memo が守るので、画面を離れるときはよい）
  function busy(leaving) {
    if (document.querySelector(".tbs-dialog-scrim, .task__edit")) return true;
    var a = document.activeElement;
    if (!a || a.closest(".tbs-overlay")) return false;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return true;
    return !leaving && a.isContentEditable;
  }

  var running = false, again = false, retryTimer = null;
  function sync(opts) {
    opts = opts || {};
    var c = cfg();
    if (!c || !hint() || state.phase === "key-changed") return Promise.resolve(false);
    if (!navigator.onLine) { setPhase("offline"); return Promise.resolve(false); }
    if (!opts.manual && busy(opts.leaving)) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(function () { sync(); }, 8000);
      return Promise.resolve(false);
    }
    if (running) { again = true; return Promise.resolve(false); }
    running = true;
    setPhase("syncing");
    var job = function () {
      // ほかのタブで設定を変えていることがあるので、読み直す
      var c2 = cfg();
      if (!c2) return Promise.resolve(false);
      return loadCore().then(function (m) { return m.syncApps(c2, appsOn(c2)); }).then(function (r) {
        var c3 = cfg();
        if (!c3 || c3.keyId !== c2.keyId) return false; // 同期のあいだに、やめた・作り直した
        c3.base = c2.base;
        c3.at = Date.now();
        c3.results = r.results;
        saveCfg(c3);
        lastRaw = rawNow();
        // 各アプリに知らせる（ほかのタブで書いたときと同じ storage イベント）
        r.changed.forEach(function (key) {
          try { window.dispatchEvent(new StorageEvent("storage", { key: key, storageArea: localStorage })); } catch (e) { /* 古いブラウザ */ }
        });
        var failed = Object.keys(r.results).some(function (k) { return r.results[k] === "error"; });
        setPhase(failed ? "error" : "idle");
        checkNotices(opts.manual);
        return true;
      });
    };
    var p = navigator.locks && navigator.locks.request
      ? navigator.locks.request("sk-toolbox-sync", job)
      : job();
    return p.catch(function (e) {
      var code = e && e.code;
      if (code === "key-changed") { setPhase("key-changed"); return false; }
      if (code === "signed-out" || code === "other-user") { saveCfg(null); setPhase("idle"); return false; }
      console.warn("[Toolbox sync]", e);
      setPhase(navigator.onLine ? "error" : "offline");
      return false;
    }).then(function (ok) {
      running = false;
      if (again) { again = false; setTimeout(sync, 1000); }
      return ok;
    });
  }

  // 変えたら少し待って同期（4 秒ごとに確かめ、連続して変えているあいだは待つ）
  var changedAt = 0, lastSync = 0;
  setInterval(function () {
    var c = cfg();
    if (!c || document.visibilityState !== "visible") return;
    if (dirty(c)) {
      if (!changedAt) changedAt = Date.now();
      lastRaw = rawNow();
      return;
    }
    if (changedAt && Date.now() - changedAt > 3000) { changedAt = 0; lastSync = Date.now(); sync(); }
    else if (Date.now() - lastSync > 5 * 60 * 1000) { lastSync = Date.now(); sync(); }
  }, 4000);
  document.addEventListener("visibilitychange", function () {
    var c = cfg();
    if (!c) return;
    if (document.visibilityState === "hidden") {
      // アプリが画面を離れるときの保存（Memo など）をすませてから
      setTimeout(function () { if (dirty(c) || changedAt) { changedAt = 0; sync({ leaving: true }); } }, 0);
    } else if (Date.now() - lastSync > 60 * 1000) {
      lastSync = Date.now();
      sync();
    }
  });
  window.addEventListener("online", function () { if (cfg()) sync(); });
  // ほかのタブで同期の設定を変えた・ログアウトした
  window.addEventListener("storage", function (e) {
    if (e.key === CFG_KEY || e.key === HINT_KEY || e.key === null) {
      if (cfg() && !hint()) saveCfg(null);
      if (e.key === CFG_KEY && state.phase === "key-changed" && cfg()) state.phase = "idle";
      emit();
    }
  });
  function start() {
    if (!cfg()) return;
    lastRaw = rawNow();
    lastSync = Date.now();
    setTimeout(function () { sync(); }, 1200);
  }
  if (document.readyState === "complete") start(); else window.addEventListener("load", start);

  // ================================================================
  // SK Hub Systems アカウントのお知らせ
  // ================================================================
  function noticeState() {
    var n = readJson(NOTICE_KEY);
    n = n && typeof n === "object" ? n : { unread: 0, items: [], notified: [], at: 0 };
    // アカウントのページでお知らせを開いた（ヘッダーの表示用の未読の数が 0 になった）ら、こちらも既読に
    var h = hint();
    if (h && typeof h.unread === "number" && h.unread < (n.unread || 0)) {
      n.unread = h.unread;
      if (!h.unread) n.items = [];
    }
    return n;
  }
  function noticeUrl() { return lp("/account/") + "#notices"; }
  function wantsPush(c) { return !!(c && c.notify !== false && window.Notification && Notification.permission === "granted"); }
  function push(title, body, tag) {
    // 通知の形は Toolbox のアプリとそろえる（タイトル … いちばん大事なこと、本文の 1 行目 … 「SK Hub Systems · お知らせ」）
    var opts = { body: "SK Hub Systems · " + t("お知らせ") + (body ? "\n" + body : ""), tag: tag, renotify: true, timestamp: Date.now(), icon: "/assets/apple-touch-icon.png", badge: "/assets/badge-skhub.png", data: { url: noticeUrl() } };
    function fallback() { try { new Notification(title, opts); } catch (e) { /* 出せない */ } }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
      navigator.serviceWorker.getRegistration().then(function (reg) { if (reg && reg.showNotification) reg.showNotification(title, opts); else fallback(); }).catch(fallback);
    } else fallback();
  }
  var checkingNotices = false;
  function checkNotices(force) {
    var c = cfg(), n = noticeState();
    if (!c || checkingNotices || (!force && Date.now() - (n.at || 0) < NOTICE_INTERVAL)) return;
    checkingNotices = true;
    loadCore().then(function (m) { return m.notices(); }).then(function (res) {
      if (!res || !cfg()) return;
      var known = Array.isArray(n.notified) ? n.notified : [];
      var fresh = res.items.filter(function (x) { return known.indexOf(x.id) < 0; });
      if (fresh.length) {
        var title = fresh.length === 1 ? fresh[0].title : t("新しいお知らせが {n} 件あります", { n: fresh.length });
        var body = fresh.length === 1 ? "" : fresh[0].title;
        document.dispatchEvent(new CustomEvent("sk-island-flash", { detail: { icon: "mail", text: t("SK Hub Systems のお知らせ") + ": " + fresh[0].title, color: "#AFA9EC" } }));
        if (wantsPush(cfg())) push(title, body, "skhub-notice-" + fresh[0].id);
        else if (document.visibilityState === "visible") toast(t("新しいお知らせがあります: {title}", { title: fresh[0].title }), t("見る"), function () { location.href = noticeUrl(); });
      }
      var notified = known.concat(fresh.map(function (x) { return x.id; })).slice(-50);
      try { localStorage.setItem(NOTICE_KEY, JSON.stringify({ unread: res.unread, items: res.items, notified: notified, at: Date.now() })); } catch (e) { /* 次にまた確かめる */ }
      emit();
    }).catch(function () { /* オフラインなど。次の同期で */ }).then(function () { checkingNotices = false; });
  }
  // 未読があれば、設定のボタンに点を付ける
  function markButtons() {
    var unread = cfg() ? noticeState().unread || 0 : 0;
    Array.prototype.forEach.call(document.querySelectorAll("[data-open-settings]"), function (b) {
      b.classList.toggle("tsy-has-notice", unread > 0);
    });
  }
  listeners.push(markButtons);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", markButtons); else markButtons();
  window.addEventListener("storage", function (e) { if (e.key === NOTICE_KEY) emit(); });

  // ================================================================
  // 画面（Toolbox の設定の「オンライン同期」）
  // ================================================================
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function icon(name) { var s = el("span", "msr", name); s.setAttribute("aria-hidden", "true"); return s; }
  function here() { return location.pathname + location.search + location.hash; }
  function connectUrl() { return lp("/account/") + "?connect=toolbox&next=" + encodeURIComponent(here()); }

  var snack = null, snackTimer = null, snackAction = null;
  function toast(text, actionLabel, onAction) {
    if (!snack) {
      snack = el("div", "snackbar tsy-snackbar");
      snack.setAttribute("role", "status");
      snack.appendChild(el("span"));
      var b = el("button", "text-btn m3-state");
      b.type = "button";
      b.addEventListener("click", function () { snack.classList.remove("is-on"); if (snackAction) snackAction(); });
      snack.appendChild(b);
      document.body.appendChild(snack);
    }
    snack.firstChild.textContent = text;
    snack.lastChild.hidden = !actionLabel;
    snack.lastChild.textContent = actionLabel || "";
    snackAction = onAction || null;
    snack.classList.add("is-on");
    clearTimeout(snackTimer);
    snackTimer = setTimeout(function () { snack.classList.remove("is-on"); }, actionLabel ? 8000 : 4000);
  }

  var timeFmt = new Intl.DateTimeFormat((I18N && I18N.locale) || "ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  function resultText(r) {
    if (r === "too-big") return t("データが大きすぎるため、アカウントに保存できませんでした");
    if (r === "memo-lock") return t("ロックのパスワードが端末ごとに違うため、同期できません");
    if (r === "error") return t("同期できませんでした");
    return "";
  }

  // パスフレーズのダイアログ。mode: create（決める）/ unlock（入れる）
  function passDialog(mode) {
    if (!window.M3) return Promise.resolve(null);
    var body = el("div", "tsy-dialog");
    var lead = el("p", "tbs-dialog__text", mode === "create"
      ? t("Toolbox のデータは、このパスフレーズで暗号化してから SK Hub Systems アカウントに保存します。SK にも中身は読めません。ほかの端末で同期を始めるときにも使います。")
      : t("ほかの端末で同期を始めたときに決めた、同期用のパスフレーズを入れてください。"));
    body.appendChild(lead);
    function field(label) {
      var w = el("label", "m3-field");
      w.appendChild(el("span", "m3-field__label", label));
      var input = el("input", "m3-field__input");
      input.type = "password";
      input.autocomplete = mode === "create" ? "new-password" : "current-password";
      input.maxLength = 200;
      w.appendChild(input);
      body.appendChild(w);
      return input;
    }
    var p1 = field(mode === "create" ? t("パスフレーズ（8 文字以上）") : t("パスフレーズ"));
    var p2 = mode === "create" ? field(t("もう一度")) : null;
    var show = el("label", "tsy-show");
    var showBox = el("input");
    showBox.type = "checkbox";
    show.append(showBox, el("span", "", t("パスフレーズを表示")));
    showBox.addEventListener("change", function () { p1.type = p2 ? (p2.type = showBox.checked ? "text" : "password") : (showBox.checked ? "text" : "password"); });
    body.appendChild(show);
    if (mode === "create") {
      var warn = el("p", "tsy-warn");
      warn.append(icon("warning"), el("span", "", t("パスフレーズを忘れると、アカウントに保存したデータは読み出せなくなります。SK にも元に戻せません（この端末のデータは消えません）。")));
      body.appendChild(warn);
    }
    var err = el("p", "tsy-error");
    err.setAttribute("role", "alert");
    body.appendChild(err);
    var forgot = null;
    if (mode === "unlock") {
      forgot = el("button", "text-btn tsy-forgot m3-state", t("パスフレーズを忘れたとき"));
      forgot.type = "button";
      body.appendChild(forgot);
    }
    var actions = el("div", "tbs-dialog__actions");
    var cancel = el("button", "text-btn m3-state", t("キャンセル"));
    var ok = el("button", "m3-btn m3-state", mode === "create" ? t("決めて同期を始める") : t("同期を始める"));
    cancel.type = ok.type = "button";
    actions.append(cancel, ok);
    body.appendChild(actions);

    return M3.dialog({
      title: mode === "create" ? t("同期用のパスフレーズを決める") : t("同期用のパスフレーズを入力"),
      icon: "encrypted",
      body: body,
      onReady: function (close, box) {
        box.classList.add("tsy-box");
        // M3.dialog の下のボタンの並びは使わない（入力を確かめてから閉じる）
        var empty = box.querySelector(":scope > .tbs-dialog__actions:last-child");
        if (empty && !empty.children.length) empty.remove();
        p1.focus();
        cancel.addEventListener("click", function () { close(null); });
        if (forgot) forgot.addEventListener("click", function () { close({ forgot: true }); });
        function submit() {
          var v = p1.value;
          err.textContent = "";
          if (mode === "create") {
            if (v.length < 8) { err.textContent = t("8 文字以上にしてください"); p1.focus(); return; }
            if (v !== p2.value) { err.textContent = t("2 つのパスフレーズが違います"); p2.focus(); return; }
          } else if (!v) { p1.focus(); return; }
          ok.disabled = cancel.disabled = true;
          ok.textContent = t("確かめています…");
          loadCore().then(function (m) { return mode === "create" ? m.createKey(v) : m.unlock(v); }).then(function (res) {
            close(res);
          }, function (e) {
            ok.disabled = cancel.disabled = false;
            ok.textContent = mode === "create" ? t("決めて同期を始める") : t("同期を始める");
            var code = e && e.code;
            err.textContent = code === "wrong" ? t("パスフレーズが違います")
              : code === "exists" ? t("ほかの端末で、もうパスフレーズが決まっています。閉じて、もう一度「同期を始める」を選んでください。")
                : t("うまくいきませんでした。インターネットの接続を確認して、もう一度お試しください。");
            p1.focus();
          });
        }
        ok.addEventListener("click", submit);
        [p1, p2].forEach(function (input) {
          if (input) input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.isComposing) { e.preventDefault(); submit(); } });
        });
      }
    });
  }

  function begin(res) {
    var prev = cfg();
    saveCfg({ uid: res.uid, key: res.key, keyId: res.keyId, apps: (prev && prev.apps) || {}, base: {}, at: 0 });
    state.phase = "idle";
    lastRaw = rawNow();
    lastSync = Date.now();
    return sync({ manual: true }).then(function (ok) {
      toast(ok ? t("同期を始めました") : t("同期を始めましたが、まだ同期できていません"));
    });
  }

  // 「同期を始める」・パスフレーズを入れ直す
  var starting = false;
  function setup() {
    if (starting) return;
    starting = true;
    state.checking = true;
    emit();
    loadCore().then(function (m) { return m.accountState(); }).then(function (s) {
      state.checking = false;
      emit();
      if (s.status === "signed-out") { try { localStorage.removeItem(HINT_KEY); } catch (e) { /* そのまま */ } saveCfg(null); toast(t("ログインし直してください")); return; }
      if (s.status === "unregistered" || s.status === "not-connected") { location.href = connectUrl(); return; }
      return passDialog(s.hasKey ? "unlock" : "create").then(function (res) {
        if (!res) return;
        if (res.forgot) return resetFlow();
        return begin(res);
      });
    }).catch(function () {
      state.checking = false;
      emit();
      toast(t("アカウントを確認できませんでした。インターネットの接続を確認してください。"));
    }).then(function () { starting = false; });
  }

  // パスフレーズを忘れたとき: アカウントの同期のデータを消して、決め直す
  function resetFlow() {
    return M3.confirm({
      title: t("同期をやり直しますか？"),
      text: t("アカウントに保存した Toolbox の同期のデータを削除して、新しいパスフレーズを決めます。この端末のデータは消えず、そのままアカウントに保存し直します。ほかの端末では、新しいパスフレーズを入れ直す必要があります。"),
      ok: t("削除してやり直す"), danger: true
    }).then(function (yes) {
      if (!yes) return;
      return loadCore().then(function (m) { return m.wipe(); }).then(function () {
        saveCfg(null);
        return passDialog("create").then(function (res) { if (res && !res.forgot) return begin(res); });
      }, function () { toast(t("削除できませんでした。時間をおいてもう一度お試しください。")); });
    });
  }

  function stopHere() {
    M3.confirm({
      title: t("この端末で同期をやめますか？"),
      text: t("この端末のデータは、そのまま残ります。アカウントに保存したデータも残るので、ほかの端末ではそのまま同期できます。"),
      ok: t("やめる"), icon: "sync_disabled"
    }).then(function (yes) {
      if (!yes) return;
      saveCfg(null);
      state.phase = "idle";
      toast(t("この端末で同期をやめました"));
    });
  }

  function wipeAll() {
    M3.confirm({
      title: t("アカウントの同期のデータを削除しますか？"),
      text: t("SK Hub Systems アカウントに保存した Toolbox のデータと、同期用のパスフレーズを削除し、この端末の同期も止めます。どの端末のデータも消えません。ほかの端末の同期も止まります。元に戻せません。"),
      ok: t("削除"), danger: true
    }).then(function (yes) {
      if (!yes) return;
      loadCore().then(function (m) { return m.wipe(); }).then(function () {
        saveCfg(null);
        state.phase = "idle";
        toast(t("アカウントの同期のデータを削除しました"));
      }, function () { toast(t("削除できませんでした。時間をおいてもう一度お試しください。")); });
    });
  }

  function mount(container) {
    if (!container || container._tsy) return;
    container._tsy = true;
    container.classList.add("tsy");
    // 設定のダイアログは、画面に出す前に中身を作る。画面に出たあとで消えたら（ダイアログを閉じたら）描くのをやめる
    var attached = false;
    function draw() {
      if (container.isConnected) attached = true;
      else if (attached) { listeners = listeners.filter(function (fn) { return fn !== draw; }); return; }
      container.textContent = "";
      var h = hint(), c = cfg();
      var head = el("div", "tsy-head");
      var badge = el("span", "tsy-badge" + (c ? " is-on" : ""));
      badge.appendChild(icon(c ? "cloud_done" : "cloud_off"));
      var txt = el("div", "tsy-head__text");
      txt.appendChild(el("strong", "", c ? t("同期はオンです") : t("同期はオフです")));
      var sub = el("span", "tsy-head__sub");
      txt.appendChild(sub);
      head.append(badge, txt);
      container.appendChild(head);
      var actions = el("div", "tsy-actions");
      function link(cls, text, href) { var a = el("a", cls + " m3-state", text); a.href = href; actions.appendChild(a); return a; }
      function button(cls, text, fn, ic) {
        var b = el("button", cls + " m3-state");
        b.type = "button";
        if (ic) b.appendChild(icon(ic));
        b.appendChild(el("span", "", text));
        b.addEventListener("click", fn);
        actions.appendChild(b);
        return b;
      }

      if (!c) {
        sub.textContent = t("Toolbox のデータは、この端末にだけ保存されています。");
        container.appendChild(el("p", "tsy-lead", t("SK Hub Systems アカウントを使うと、Todo・Memo・Countdown などを、スマホやパソコンのあいだで同期できます（任意）。データは端末で暗号化してから保存するので、SK にも中身は読めません。")));
        if (!h && document.documentElement.classList.contains("in-line")) {
          // LINE の中: LINE でログイン（/toolbox/shared/line.js）。アカウントの作成・Toolbox への接続がまだなら /account/ に移動する
          var lineGo = button("m3-btn", t("LINE でログインして使う"), function () {
            if (!window.SKLine) return;
            lineGo.disabled = true;
            SKLine.signIn().then(function (r) { if (r === "ready") emit(); }, function () {
              toast(t("ログインできませんでした。時間をおいてもう一度お試しください。"));
            }).then(function () { lineGo.disabled = false; });
          });
        } else if (!h) {
          link("m3-btn", t("ログインして使う"), connectUrl());
        } else if (!connected(h)) {
          link("m3-btn", t("Toolbox に接続して使う"), connectUrl());
        } else {
          var go = button("m3-btn", state.checking ? t("確認しています…") : t("同期を始める"), setup, "sync");
          go.disabled = !!state.checking;
        }
        link("text-btn", t("詳しく"), lp("/sk-hub-systems/") + "#toolbox");
        container.appendChild(actions);
        return;
      }

      // 同期はオン
      var phase = state.phase;
      sub.textContent = phase === "syncing" ? t("同期しています…")
        : phase === "offline" ? t("オフラインです。つながったら同期します")
          : phase === "key-changed" ? t("ほかの端末で、同期用のパスフレーズが変わりました")
            : phase === "error" ? t("同期できませんでした。時間をおいてもう一度お試しください。")
              : c.at ? t("最後に同期: {time}", { time: timeFmt.format(new Date(c.at)) }) : t("まだ同期していません");
      badge.classList.toggle("is-busy", phase === "syncing");
      badge.classList.toggle("is-warn", phase === "error" || phase === "key-changed");
      if (phase === "key-changed") {
        container.appendChild(el("p", "tsy-lead", t("新しいパスフレーズを入れると、同期を続けられます。")));
        button("m3-btn", t("パスフレーズを入力"), setup, "key");
        button("text-btn", t("この端末で同期をやめる"), stopHere);
        container.appendChild(actions);
        return;
      }

      var list = el("div", "tsy-apps");
      APPS.forEach(function (a) {
        var row = el("label", "tbs-item tbs-item--switch tsy-app m3-state");
        var img = el("img", "tbs-app-icon");
        img.src = a.icon;
        img.alt = "";
        img.width = img.height = 40;
        var lab = el("span", "tbs-label");
        lab.appendChild(el("span", "tbs-label__title", a.name));
        var r = c.results && c.results[a.key];
        var problem = c.apps && c.apps[a.key] === false ? "" : resultText(r);
        var s = el("span", "tbs-label__sub" + (problem ? " tsy-problem" : ""), problem || a.what);
        lab.appendChild(s);
        var input = el("input", "tbs-switch");
        input.type = "checkbox";
        input.setAttribute("role", "switch");
        input.checked = !(c.apps && c.apps[a.key] === false);
        input.addEventListener("change", function () {
          var c2 = cfg();
          if (!c2) return;
          c2.apps = c2.apps || {};
          c2.apps[a.key] = input.checked;
          // 止めていたあいだの変更は、次に同期するときに、はじめて同期するときと同じようにまとめる
          if (!input.checked && c2.base) delete c2.base[a.key];
          saveCfg(c2);
          if (input.checked) sync({ manual: true });
        });
        row.append(img, lab, input);
        list.appendChild(row);
      });
      container.appendChild(list);
      var now = button("m3-btn m3-btn--tonal", t("今すぐ同期"), function () {
        sync({ manual: true }).then(function (ok) { toast(ok ? t("同期しました") : t("同期できませんでした。時間をおいてもう一度お試しください。")); });
      }, "sync");
      now.disabled = phase === "syncing";
      button("text-btn", t("この端末で同期をやめる"), stopHere);
      container.appendChild(actions);

      // SK Hub Systems アカウントのお知らせ
      var ns = noticeState();
      var nbox = el("div", "tsy-notices");
      var nhead = el("a", "tbs-item tbs-item--link tsy-notice-link m3-state");
      nhead.href = noticeUrl();
      var nic = icon(ns.unread ? "mark_email_unread" : "mail");
      nhead.appendChild(nic);
      var nlab = el("span", "tbs-label");
      nlab.appendChild(el("span", "tbs-label__title", t("SK Hub Systems のお知らせ")));
      nlab.appendChild(el("span", "tbs-label__sub", ns.at ? (ns.unread ? t("未読 {n} 件", { n: ns.unread }) : t("未読はありません")) : t("確認中…")));
      nhead.appendChild(nlab);
      if (ns.unread) nhead.appendChild(el("span", "tsy-count", String(Math.min(ns.unread, 99))));
      nhead.appendChild(icon("chevron_right"));
      nbox.appendChild(nhead);
      (ns.items || []).slice(0, 3).forEach(function (x) {
        var a = el("a", "tsy-notice m3-state");
        a.href = noticeUrl();
        a.appendChild(el("strong", "", x.title));
        if (x.at) a.appendChild(el("small", "", timeFmt.format(new Date(x.at))));
        nbox.appendChild(a);
      });
      var nrow = el("label", "tbs-item tbs-item--switch m3-state");
      var nl = el("span", "tbs-label");
      nl.appendChild(el("span", "tbs-label__title", t("お知らせを通知する")));
      nl.appendChild(el("span", "tbs-label__sub", window.Notification && Notification.permission === "denied"
        ? t("このブラウザで通知がブロックされています。ブラウザの設定で許可してください")
        : t("新しいお知らせ（お問い合わせへの返事など）が届いたら、この端末に通知します")));
      var nsw = el("input", "tbs-switch");
      nsw.type = "checkbox";
      nsw.setAttribute("role", "switch");
      nsw.checked = wantsPush(c);
      nsw.disabled = !window.Notification || Notification.permission === "denied";
      nsw.addEventListener("change", function () {
        var c2 = cfg();
        if (!c2) return;
        if (!nsw.checked) { c2.notify = false; saveCfg(c2); return; }
        Notification.requestPermission().then(function (p) {
          var c3 = cfg();
          if (!c3) return;
          c3.notify = p === "granted";
          saveCfg(c3);
          if (p !== "granted") toast(t("通知が許可されませんでした"));
        });
      });
      nrow.append(nl, nsw);
      nbox.appendChild(nrow);
      container.appendChild(nbox);

      var more = el("div", "tsy-more");
      var note = el("p", "tsy-note");
      note.append(icon("encrypted"), el("span", "", t("端末で暗号化してから、SK Hub Systems アカウントに保存しています。Memo の画像と Clock は同期しません。")));
      more.appendChild(note);
      var wipe = el("button", "text-btn tbs-danger m3-state", t("アカウントの同期のデータを削除"));
      wipe.type = "button";
      wipe.addEventListener("click", wipeAll);
      more.appendChild(wipe);
      container.appendChild(more);
    }
    listeners.push(draw);
    draw();
    if (cfg()) checkNotices(false);
  }

  window.SKToolboxSync = {
    isOn: function () { return !!cfg(); },
    sync: function () { return sync({ manual: true }); },
    mount: mount,
    // この端末のデータを消したとき: そのアプリは、次に同期するときにアカウントから読み込み直す
    forget: function (storageKeys) {
      var c = cfg();
      if (!c || !c.base) return;
      Object.keys(STORAGE).forEach(function (app) {
        if (STORAGE[app].some(function (k) { return storageKeys.indexOf(k) >= 0; })) delete c.base[app];
      });
      saveCfg(c);
    }
  };
  // 先に作られていた「オンライン同期」の場所
  Array.prototype.forEach.call(document.querySelectorAll("[data-tb-sync]"), mount);
})();
