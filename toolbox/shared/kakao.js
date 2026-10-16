// KakaoTalk in SK's Toolbox（KakaoTalk のトークで開いた SK's Toolbox。Kakao には LINE の LIFF のようなミニアプリの仕組みがないので、KakaoTalk の中のブラウザで動かす）
//   ・KakaoTalk の中か: ブラウザの名前（User-Agent）に KAKAOTALK があるとき。?kakao=1 で開いても（試すとき）、このタブのあいだ覚える（sessionStorage の sk_kakao）
//       LINE のミニアプリの中（/toolbox/shared/line.js の inLine）のときは、KakaoTalk の中とみなさない
//   ・<html class="in-kakao"> … KakaoTalk の中。アプリとして入れるボタン・通知・ホームのサイトのヘッダーを隠す（/toolbox/shared/m3.css。付けるのは settings.js）
//   ・Kakao の SDK（Kakao.Share・Kakao.Channel）は、KakaoTalk の中で、JavaScript キーがあるときだけ読み込む
//       Kakao Developers のアプリ「SK Hub Systems」→ 앱 키 → JavaScript 키 を JS_KEY に、플랫폼 → Web → 사이트 도메인 に https://sk-hub.jp を登録する
//       キーがない・読み込めないときは、送る文をコピーして、トークに貼り付けてもらう
//   ・window.SKKakao（形は SKLine と同じ。ページは window.SKMsg を使う）
//       inKakao           … KakaoTalk の中か
//       ready             … Promise（SDK を初期化できたら SKKakao、できなければ null）
//       card(o)           … カード（Kakao のフィードのメッセージ）を作る { alt, kicker, title, sub, rows: [[左, 右]], color, url, button }。color は使わない
//       share(card, text) … KakaoTalk の友だち・チャットに送る。Promise<"open"（送る画面を開いた。送ったかはわからない）| "copy" | "cancel">
//       button(label)     … 「KakaoTalk で送る」のボタン（.kakao-btn）
//       sendLabel() / sentLabel() … 「KakaoTalk で送る」「KakaoTalk で送りました」
//       openExternal(url) … ふつうのブラウザで開く
//       recommend()       … SK's Toolbox を友だちにすすめるカード
//       signIn()          … SK Hub Systems アカウントにログイン（/account/ に移動する。KakaoTalk の中では Kakao だけ。assets/hub/account.js）
//       channel           … カカオトークチャンネル「SK Hub」{ id, url, chat }。CHANNEL_ID が空なら null
//       addChannel() / chat() … チャンネルを追加する・チャンネルのチャットを開く
//   ・window.SKMsg … KakaoTalk の中なら SKKakao、それ以外は SKLine（「LINE で送る」「KakaoTalk で送る」をページが分けずに使う）
//   ・Kakao の名前・アイコンは読まない。カードは、利用者が選んだ相手に、利用者の操作で送る
(function () {
  "use strict";
  if (window.SKKakao || /[?&]embed\b/.test(location.search)) return;
  var I18N = window.SKI18N;
  function t(s, p) { return I18N ? I18N.t(s, p) : s.replace(/\{(\w+)\}/g, function (m, k) { return p && k in p ? p[k] : m; }); }
  function lp(u) { return I18N && I18N.path ? I18N.path(u) : u; }

  // Kakao Developers のアプリ「SK Hub Systems」の JavaScript キー（公開してよいキー。サイトのドメインで使える範囲がしぼられる）
  var JS_KEY = "";
  // カカオトークチャンネル「SK Hub」の ID（pf.kakao.com/_xxxx の _xxxx）。作ったら入れる
  var CHANNEL_ID = "";
  var SDK = "https://t1.kakaocdn.net/kakao_js_sdk/2.8.3/kakao.min.js";
  var SDK_SRI = "sha384-oroumrnFVE0xtgqyDZJARgERibXg2C28380uaUZz2kHDS5CR7tu20eGiOU6GkTpy";
  var ICON = "https://sk-hub.jp/toolbox/icon-192.png";

  var inKakao = false;
  try {
    if (/[?&]kakao=1\b/.test(location.search)) sessionStorage.setItem("sk_kakao", "1");
    inKakao = /KAKAOTALK/i.test(navigator.userAgent) || sessionStorage.getItem("sk_kakao") === "1";
  } catch (e) { inKakao = /KAKAOTALK/i.test(navigator.userAgent); }
  if (window.SKLine && window.SKLine.inLine) inKakao = false;

  var api = {
    inKakao: inKakao,
    ready: Promise.resolve(null),
    channel: CHANNEL_ID ? { id: CHANNEL_ID, url: "https://pf.kakao.com/" + CHANNEL_ID, chat: "https://pf.kakao.com/" + CHANNEL_ID + "/chat" } : null
  };
  window.SKKakao = api;
  // ページが使う「送る」: KakaoTalk の中なら Kakao、それ以外は LINE（line.js がないページでは undefined）
  try {
    Object.defineProperty(window, "SKMsg", { configurable: true, get: function () { return api.inKakao ? api : window.SKLine; } });
  } catch (e) { window.SKMsg = api.inKakao ? api : window.SKLine; }
  if (api.inKakao) document.documentElement.classList.add("in-kakao");

  api.sendLabel = function () { return t("KakaoTalk で送る"); };
  api.sentLabel = function () { return t("KakaoTalk で送りました"); };

  // ---- カード（中身は送るときに Kakao の形にする）----
  api.card = function (o) { return { kakao: true, o: o || {} }; };
  function cut(s, n) { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function template(o) {
    var url = /^https:\/\/sk-hub\.jp\//.test(o.url || "") ? o.url : "https://sk-hub.jp/toolbox/";
    var link = { webUrl: url, mobileWebUrl: url };
    var tpl = {
      objectType: "feed",
      content: { title: cut(o.title || "SK's Toolbox", 80), description: cut(o.sub || "", 200), link: link },
      buttons: [{ title: cut(o.button || t("SK's Toolbox で開く"), 14), link: link }]
    };
    // 表の行は Kakao の itemContent に 5 行まで（左は 6 文字まで。「1 限 8:40」のように長いときは空白の前で切る）。6 行目からは説明の文に足す
    var rows = (o.rows || []).filter(function (r) { return r && (r[0] || r[1]); });
    function head(s) {
      s = String(s || " ");
      if (s.length <= 6) return s;
      var i = s.slice(0, 7).lastIndexOf(" ");
      return i > 0 ? s.slice(0, i) : cut(s, 6);
    }
    tpl.itemContent = { profileText: cut(o.kicker || "SK's Toolbox", 16), profileImageUrl: ICON };
    if (rows.length) tpl.itemContent.items = rows.slice(0, 5).map(function (r) { return { item: head(r[0]), itemOp: cut(r[1] || " ", 25) }; });
    if (rows.length > 5) {
      var rest = rows.slice(5).map(function (r) { return [r[0], r[1]].filter(Boolean).join(" "); }).join("\n");
      tpl.content.description = cut([o.sub || "", rest].filter(Boolean).join("\n"), 200);
    }
    if (!tpl.content.description) delete tpl.content.description;
    return tpl;
  }

  // ---- 「KakaoTalk で送る」のボタン（.kakao-btn。見た目は /toolbox/shared/m3.css）----
  var GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 4C6.9 4 3 7.1 3 11c0 2.5 1.7 4.7 4.2 6l-.9 3.3c-.1.4.3.7.6.5l3.9-2.6c.4 0 .9.1 1.2.1 5.1 0 9-3.1 9-7.3S17.1 4 12 4z"/></svg>';
  api.button = function (label) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "kakao-btn";
    b.innerHTML = GLYPH;
    var s = document.createElement("span");
    s.textContent = label || api.sendLabel();
    b.appendChild(s);
    return b;
  };

  // ---- 送る ----
  // SDK がないとき: 送る文をコピーして、トークに貼り付けてもらう
  function copyFallback(text) {
    function done(ok) {
      if (window.M3) {
        var p = document.createElement("p");
        p.className = "tbs-dialog__text";
        p.textContent = ok ? t("送る内容をコピーしました。KakaoTalk のトークに貼り付けて送ってください。") : text;
        return window.M3.dialog({ title: ok ? t("コピーしました") : t("この内容を送ってください"), icon: "content_copy", body: p, actions: [{ label: t("OK"), primary: true, value: null }] }).then(function () { return ok ? "copy" : "cancel"; });
      }
      return ok ? "copy" : "cancel";
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return done(true); }, function () { return done(false); });
    return Promise.resolve(done(false));
  }
  function sdk() { return window.Kakao && window.Kakao.isInitialized && window.Kakao.isInitialized() ? window.Kakao : null; }
  api.share = function (card, text) {
    var o = card && card.kakao ? card.o : {};
    var K = sdk();
    if (K && K.Share) {
      try { K.Share.sendDefault(template(o)); return Promise.resolve("open"); } catch (e) { console.warn("[Kakao]", e); }
    }
    return copyFallback(text || [o.title, o.sub, o.url].filter(Boolean).join("\n"));
  };

  // ---- ブラウザ・チャンネル ----
  api.openExternal = function (url) {
    var full = new URL(url, location.href).href;
    if (api.inKakao) { location.href = "kakaotalk://web/openExternal?url=" + encodeURIComponent(full); return; }
    location.href = full;
  };
  function open(url) {
    if (api.inKakao) { location.href = url; return; }
    var w = window.open(url, "_blank", "noopener");
    if (!w) location.href = url;
  }
  api.addChannel = function () {
    if (!api.channel) return;
    var K = sdk();
    if (K && K.Channel) { try { K.Channel.addChannel({ channelPublicId: api.channel.id }); return; } catch (e) { /* 下へ */ } }
    open(api.channel.url + "/friend");
  };
  api.chat = function () {
    if (!api.channel) return;
    var K = sdk();
    if (K && K.Channel) { try { K.Channel.chat({ channelPublicId: api.channel.id }); return; } catch (e) { /* 下へ */ } }
    open(api.channel.chat);
  };

  // ---- SK Hub Systems アカウント ----
  // KakaoTalk の中のブラウザでは Google のログインの画面が開けないので、/account/ は Kakao だけを出す（assets/hub/account.js の availableLogins）
  api.signIn = function () {
    location.href = lp("/account/") + "?next=" + encodeURIComponent(location.pathname + location.search + location.hash);
    return Promise.resolve("redirect");
  };

  api.recommend = function () {
    var url = "https://sk-hub.jp/toolbox/";
    return api.share(api.card({
      kicker: t("おすすめ"), title: "SK's Toolbox",
      sub: t("時計・Todo・時間割・Countdown・ルーレットが、KakaoTalk の中ですぐ使えます。結果や時間割を友だちにカードで送れます。"), url: url, button: t("開いてみる")
    }), t("SK's Toolbox（時計・Todo・時間割・ルーレットなど）") + "\n" + url);
  };

  if (!api.inKakao || !JS_KEY) return;

  // ---- KakaoTalk の中: SDK を読み込んで初期化（送るボタンを押してから読むと、アプリへの切りかえが止められることがあるので先に）----
  api.ready = new Promise(function (resolve) {
    var s = document.createElement("script");
    s.src = SDK;
    s.integrity = SDK_SRI;
    s.crossOrigin = "anonymous";
    s.onload = function () {
      try {
        if (!window.Kakao.isInitialized()) window.Kakao.init(JS_KEY);
        resolve(api);
      } catch (e) { console.warn("[Kakao]", e); resolve(null); }
    };
    s.onerror = function () { resolve(null); };
    document.head.appendChild(s);
  });
})();
