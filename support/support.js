// SK Hub Support（support.sk-hub.jp）の共通部分: ヘッダーのメニュー・sk-hub.jp からの引き継ぎ・RedFlag Checker
// ページの元は sk-hub.jp の /support/（Cloudflare Worker が support.sk-hub.jp で返す。_workers/support/）。
// ヘッダー・言語の切り替え（/lang/）・表示・アカウントのメニュー・サポートID は sk-hub.jp と同じ /assets/site.js が動かす。
// このファイルは site.js より先に読み込む（window.SK_HEADER でヘッダーのメニューをサポート向けにするため）。
//
// support.sk-hub.jp は sk-hub.jp と別の場所なので、言語・表示・利用規約の同意・サポートID・ログインは
// sk-hub.jp の /assets/hub/bridge.html（見えない iframe）から受け取る（window.SKBridge）。
(function () {
  "use strict";

  const I18N = window.SKI18N;
  const t = I18N ? I18N.t : (s) => s;
  const ON_SUBDOMAIN = location.hostname === "support.sk-hub.jp";
  const BRIDGE_URL = "https://sk-hub.jp/assets/hub/bridge.html";
  const BRIDGE_ORIGIN = "https://sk-hub.jp";
  const MAIN = "https://sk-hub.jp";

  // ---------- ヘッダーのメニュー（site.js）。「SK」の中身を sk-hub.jp へのリンクにする ----------
  window.SK_HEADER = {
    menus: {
      sk: {
        title: t("SK のサイト"),
        groups: [
          {
            title: t("SK"),
            items: [
              [t("SK のホーム"), `${MAIN}/`],
              [t("すべてのプロダクト"), `${MAIN}/products/`],
              ["SK Hub Systems", `${MAIN}/sk-hub-systems/`],
              ["SK's Toolbox", `${MAIN}/toolbox/`]
            ]
          },
          {
            title: t("情報"),
            items: [
              [t("システム稼働状況"), "https://sk-hub.online/"],
              [t("アップデート"), `${MAIN}/updates/`],
              [t("利用規約とプライバシーポリシー"), `${MAIN}/policies/`],
              [t("私について"), `${MAIN}/about/`]
            ]
          }
        ]
      }
    }
  };

  // <html data-theme / data-accent> を保存した表示に合わせる（<head> の小さなスクリプトと同じ）
  function applyTheme() {
    const root = document.documentElement;
    let v = {};
    try { v = JSON.parse(read("sk_theme") || "{}"); } catch (e) { v = {}; }
    if (v.mode === "light" || v.mode === "dark") root.setAttribute("data-theme", v.mode); else root.removeAttribute("data-theme");
    if (/^[a-z]{2,12}$/.test(v.accent || "") && v.accent !== "blue") root.setAttribute("data-accent", v.accent); else root.removeAttribute("data-accent");
  }

  const read = (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } };
  const write = (key, value) => {
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch (e) { /* 保存できなくても動く */ }
  };

  // ---------- sk-hub.jp との橋渡し ----------
  // SKBridge.ready … sk-hub.jp の設定をこのページに写し終わったら解決する（届かなければ 4 秒であきらめる）
  // SKBridge.token() … ログイン中なら { uid, token }（お問い合わせ）
  // SKBridge.set(key, value) … このページで変えたものを sk-hub.jp にも保存する
  const SYNCED = ["sk_lang", "sk_theme", "sk_analytics", "skhub_terms_accepted", "skhub_terms_notice_shown"];
  const bridge = (function () {
    if (!ON_SUBDOMAIN) {
      // sk-hub.jp の /support/ をそのまま開いているとき（手元での確認など）は、同じ保存場所なので何もしない
      return { ready: Promise.resolve(false), token: () => Promise.resolve(null), set: () => {} };
    }
    const waiting = new Map();
    let seq = 0;
    let frameReady;
    const loaded = new Promise((resolve) => { frameReady = resolve; });
    const frame = document.createElement("iframe");
    frame.src = BRIDGE_URL;
    frame.title = "";
    frame.hidden = true;
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (event.origin !== BRIDGE_ORIGIN || !msg || msg.sk !== "bridge") return;
      if (msg.ready) { frameReady(true); return; }
      const done = waiting.get(msg.id);
      if (done) { waiting.delete(msg.id); done(msg.value); }
    });
    (document.body || document.documentElement).appendChild(frame);

    function ask(op, extra, timeout) {
      return Promise.race([
        loaded.then(() => new Promise((resolve) => {
          const id = ++seq;
          waiting.set(id, resolve);
          frame.contentWindow.postMessage({ sk: "bridge", id, op, ...extra }, BRIDGE_ORIGIN);
        })),
        new Promise((resolve) => setTimeout(() => resolve(null), timeout))
      ]);
    }

    const ready = ask("prefs", {}, 4000).then((prefs) => {
      if (!prefs) return false;
      const lang = read("sk_lang");
      const theme = read("sk_theme");
      // 言語・表示などは、sk-hub.jp に何もなければこのページの値を残す
      SYNCED.forEach((key) => { if (prefs[key] != null) write(key, prefs[key]); });
      // サポートID とログイン中かのヒントは sk-hub.jp と同じにする（ログアウトしていれば消す）。
      // sk-hub.jp にサポートID がなく、このページにだけあるとき（ここで同意した）は、sk-hub.jp に渡す
      if (prefs.skhub_uuid) write("skhub_uuid", prefs.skhub_uuid);
      else if (read("skhub_uuid")) ask("set", { key: "skhub_uuid", value: read("skhub_uuid") }, 4000);
      write("skhub_account", prefs.skhub_account);
      if (read("sk_lang") !== lang && (read("sk_lang") || "ja") !== (I18N ? I18N.lang : "ja")) {
        location.reload(); // 言語が変わったら、その言語で開き直す
        return true;
      }
      if (read("sk_theme") !== theme) applyTheme(); // 表示が変わったら、そのまま切り替える
      // サポートID やログインのヒントが変わったことを site.js に知らせる（サポートID の表示を出し直す）
      document.dispatchEvent(new Event("skhub:ready"));
      return true;
    });

    return {
      ready,
      token: () => ask("token", {}, 15000),
      set: (key, value) => { ask("set", { key, value }, 4000); }
    };
  })();
  window.SKBridge = bridge;

  // ---------- このページで変えたものを sk-hub.jp にも ----------
  bridge.ready.then((synced) => {
    if (!synced) return;
    // 表示（ヘッダーのアカウントのメニューの「表示」。site.js が sk:theme を出す）
    document.addEventListener("sk:theme", (e) => { if (e.detail) bridge.set("sk_theme", JSON.stringify(e.detail)); });
    // アクセス解析の設定
    document.addEventListener("sk:analytics", (e) => { if (typeof e.detail === "string") bridge.set("sk_analytics", e.detail); });
    // 利用規約の同意とサポートID（RedFlag Checker が保存する）。変わったら渡す
    const last = {};
    ["skhub_terms_accepted", "skhub_terms_notice_shown", "skhub_uuid"].forEach((k) => { last[k] = read(k); });
    const push = () => {
      Object.keys(last).forEach((k) => {
        const v = read(k);
        if (v !== last[k] && v != null) { last[k] = v; bridge.set(k, v); }
      });
    };
    setInterval(push, 2000);
    window.addEventListener("pagehide", push);
  });

  // ---------- 言語の切り替え: sk-hub.jp の言語の画面（/lang/）で選び、このページに戻ってくる ----------
  // 戻り先は sk-hub.jp の /support/…（そこから support.sk-hub.jp の同じページに移り、選んだ言語を受け取る）
  function langLinks() {
    if (!ON_SUBDOMAIN) return;
    const back = "/support" + location.pathname + location.search + location.hash;
    document.querySelectorAll("[data-lang-link]").forEach((a) => { a.href = `${MAIN}/lang/?next=${encodeURIComponent(back)}`; });
  }
  document.addEventListener("DOMContentLoaded", langLinks);
  window.addEventListener("popstate", langLinks);
  document.addEventListener("sp:route", langLinks);

  // ---------- RedFlag Checker（frameworks/check.js）とアクセス解析。sk-hub.jp の同意を受け取ってから読み込む ----------
  function loadScript(src, onload) {
    const s = document.createElement("script");
    s.src = src;
    if (onload) s.onload = onload;
    document.body.appendChild(s);
  }
  bridge.ready.then(() => {
    const start = () => {
      loadScript("/frameworks/check.js?check=none");
      loadScript("/assets/analytics.js", () => {
        document.querySelectorAll("[data-analytics-settings]").forEach((li) => {
          li.hidden = !(window.SKAnalytics && window.SKAnalytics.enabled());
          const link = li.querySelector("a");
          if (link && !link.dataset.bound) {
            link.dataset.bound = "1";
            link.addEventListener("click", (e) => { e.preventDefault(); window.SKAnalytics.open(); });
          }
        });
      });
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  });
})();
