// sk-hub.jp の公開前の画面（Coming Soon）
//   ・公開の時刻（LAUNCH・日本時間 2026-10-14 12:00）までは、どのページを開いてもこの画面だけを出す。時刻を過ぎたら何もしない
//   ・ページの中身は読み込まれるが、body の中のほかの要素は見えなくする。開いたまま公開の時刻になったら読み込み直す
//   ・開発者の確認用: URL に ?preview を付けて開くと、そのタブを閉じるまでふつうに見られる（sessionStorage の sk_preview）
//   ・SK Hub Systems の紹介（/sk-hub-systems/）と規約（/policies/）は、公開の前でもふつうに見せる
//     （Google ログインの OAuth 同意画面のホーム・プライバシーポリシー・規約の URL。審査で開かれる）
//   ・すべてのページの <head> の一番上で読み込む（build で作るページは index.html の <head>、ほかは各ページに直接）
//   ・公開のあと落ち着いたら、このファイルと各ページの <script src="/assets/coming-soon.js"> を消す
(function () {
  "use strict";
  var ORIGIN = (function () { try { return new URL(document.currentScript.src).origin; } catch (e) { return ""; } })();
  var LAUNCH = Date.UTC(2026, 9, 14, 3, 0, 0); // 2026-10-14 12:00（日本時間）
  if (Date.now() >= LAUNCH) return;
  if (/^\/(sk-hub-systems|policies)\//.test(location.pathname)) return;
  try {
    if (/[?&]preview\b/.test(location.search)) sessionStorage.setItem("sk_preview", "1");
    if (sessionStorage.getItem("sk_preview")) return;
  } catch (e) {}

  var root = document.documentElement;
  root.classList.add("sk-soon");
  var css =
    "html.sk-soon,html.sk-soon body{overflow:hidden!important}" +
    "html.sk-soon body>:not(#sk-soon){display:none!important}" +
    "#sk-soon{--s-bg:#f5f6f8;--s-ink:#0d1014;--s-muted:#5a6371;--s-a:#2563eb;--s-a-ink:#fff;--s-line:#e1e4e9;--s-card:#fff;" +
    "position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px 16px;overflow:auto;box-sizing:border-box;" +
    "background:radial-gradient(640px 360px at 85% 0%,color-mix(in srgb,var(--s-a) 20%,transparent),transparent 70%)," +
    "radial-gradient(520px 300px at 0% 100%,rgba(90,95,224,.14),transparent 70%),var(--s-bg);color:var(--s-ink);" +
    "font:16px/1.6 Inter,\"Noto Sans JP\",\"Hiragino Sans\",\"Yu Gothic UI\",Meiryo,system-ui,sans-serif;text-align:center}" +
    "#sk-soon *{box-sizing:border-box}" +
    "#sk-soon .ss-in{max-width:520px;width:100%}" +
    "#sk-soon .ss-logo{width:72px;height:72px;border-radius:20px;display:block;margin:0 auto 22px;box-shadow:0 12px 30px color-mix(in srgb,var(--s-a) 30%,transparent)}" +
    "#sk-soon .ss-domain{display:inline-block;margin:0 0 10px;padding:4px 12px;border-radius:999px;border:1px solid var(--s-line);background:var(--s-card);color:var(--s-muted);font-size:13px;font-weight:600;letter-spacing:.02em}" +
    "#sk-soon h1{margin:0;font-size:clamp(40px,10vw,64px);line-height:1.1;font-weight:800;letter-spacing:-.03em}" +
    "#sk-soon .ss-dots{color:var(--s-a)}" +
    "#sk-soon .ss-lead{margin:16px 0 0;color:var(--s-muted)}" +
    "#sk-soon .ss-when{margin:22px auto 0;padding:16px 18px;max-width:360px;border-radius:18px;background:var(--s-card);border:1px solid var(--s-line)}" +
    "#sk-soon .ss-date{font-weight:700}" +
    "#sk-soon .ss-count{margin-top:2px;font-size:28px;font-weight:800;font-variant-numeric:tabular-nums;letter-spacing:.02em;color:var(--s-a)}" +
    "#sk-soon .ss-old{margin:24px 0 0;font-size:14px;color:var(--s-muted)}" +
    "#sk-soon .ss-btn{display:inline-flex;align-items:center;justify-content:center;margin-top:10px;min-height:44px;padding:0 22px;border-radius:999px;background:var(--s-a);color:var(--s-a-ink);font-weight:700;text-decoration:none}" +
    "#sk-soon .ss-btn:hover{filter:brightness(1.08)}" +
    "#sk-soon .ss-btn:focus-visible{outline:2px solid var(--s-a);outline-offset:3px}" +
    "#sk-soon .ss-en{margin:28px 0 0;font-size:12.5px;color:var(--s-muted)}" +
    "@media (prefers-color-scheme:dark){:root:not([data-theme=\"light\"]) #sk-soon{--s-bg:#0b0d11;--s-ink:#eef1f5;--s-muted:#9aa3b2;--s-a:#3b82f6;--s-line:#262b34;--s-card:#14171d}}" +
    ":root[data-theme=\"dark\"] #sk-soon{--s-bg:#0b0d11;--s-ink:#eef1f5;--s-muted:#9aa3b2;--s-a:#3b82f6;--s-line:#262b34;--s-card:#14171d}";
  var style = document.createElement("style");
  style.textContent = css;
  (document.head || root).appendChild(style);

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function left() {
    var s = Math.max(0, Math.floor((LAUNCH - Date.now()) / 1000));
    var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
    return (d ? d + "日 " : "") + pad(h) + ":" + pad(m) + ":" + pad(s % 60);
  }

  function show() {
    if (document.getElementById("sk-soon")) return;
    var old = "https://sy9-k.github.io" + location.pathname + location.search + location.hash;
    var box = document.createElement("div");
    box.id = "sk-soon";
    box.setAttribute("role", "main");
    box.innerHTML =
      '<div class="ss-in">' +
      '<img class="ss-logo" src="' + ORIGIN + '/assets/apple-touch-icon.png" alt="SK">' +
      '<p class="ss-domain">sk-hub.jp</p>' +
      '<h1>Coming Soon<span class="ss-dots">...</span></h1>' +
      '<p class="ss-lead">SK の新しいアドレスです。もうすぐ公開します。</p>' +
      '<div class="ss-when"><div class="ss-date">2026年10月14日（水）12:00 公開</div><div class="ss-count" aria-live="off"></div></div>' +
      '<p class="ss-old">それまでは、いまのアドレスでご利用ください。<br><a class="ss-btn" href="">sy9-k.github.io で開く</a></p>' +
      '<p class="ss-en">SK is moving to sk-hub.jp — opening Oct 14, 2026, 12:00 JST.</p>' +
      "</div>";
    box.querySelector(".ss-btn").href = old;
    var count = box.querySelector(".ss-count");
    function tick() { count.textContent = "あと " + left(); }
    tick();
    setInterval(tick, 1000);
    document.body.appendChild(box);
  }
  if (document.body) show();
  else document.addEventListener("DOMContentLoaded", show);

  // 開いたまま公開の時刻になったら、ふつうのページに読み込み直す
  var wait = LAUNCH - Date.now() + 1000;
  if (wait < 2147483647) setTimeout(function () { location.reload(); }, wait);
})();
