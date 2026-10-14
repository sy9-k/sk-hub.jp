// SK Hub Support（https://support.sk-hub.jp/）
// ページは置かず、sk-hub.jp（GitHub Pages）の /support/ をそのつど取ってきて返す中継役。
// なので、記事・見た目・お問い合わせを直すときは sk-hub.jp のリポジトリにプッシュするだけでよい（この Worker の deploy はいらない）。
//
//   support.sk-hub.jp/            → sk-hub.jp/support/
//   support.sk-hub.jp/contact/    → sk-hub.jp/support/contact/
//   support.sk-hub.jp/assets/…    → sk-hub.jp/assets/…（共通の部品は同じパスのまま。SHARED）
//   support.sk-hub.jp/support/…   → /… に移す（記事の中の古いリンク /support/?a=… など）
//   sk-hub.jp/support/ にないもの → sk-hub.jp の同じページへ移す（記事の中の /account/ や /products/ へのリンク）
const ORIGIN = "https://sk-hub.jp";
const SHARED = [/^\/assets\//, /^\/frameworks\//, /^\/policies\/docs\//, /^\/y-filter\/(firebase-config\.js|shared\/)/, /^\/updates\/updates\.json$/, /^\/google[0-9a-f]+\.html$/];
const CACHE_SECONDS = 60; // GitHub Pages から取ったものを Cloudflare に置いておく時間（直してから出るまで最大これだけかかる）

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });

    const path = url.pathname;
    if (path === "/support" || path.startsWith("/support/")) {
      url.pathname = path.slice("/support".length) || "/";
      return Response.redirect(url.toString(), 301);
    }
    if (path === "/robots.txt") return new Response("User-agent: *\nAllow: /\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });

    const shared = SHARED.some((re) => re.test(path));
    const upstream = new URL((shared ? "" : "/support") + path + url.search, ORIGIN);
    const res = await fetch(upstream.toString(), {
      method: request.method,
      redirect: "manual",
      headers: { "User-Agent": "sk-support-worker", "Accept": request.headers.get("Accept") || "*/*" },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
    });

    // sk-hub.jp/support/ にないページは、sk-hub.jp の同じページへ
    if (res.status === 404 && !shared) return Response.redirect(ORIGIN + path + url.search, 302);

    // GitHub Pages の移動（/support/contact → /support/contact/ など）を、このアドレスに合わせる
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("Location") || "";
      let target = loc;
      try {
        const u = new URL(loc, upstream);
        if (u.origin === ORIGIN && (u.pathname === "/support" || u.pathname.startsWith("/support/"))) {
          target = url.origin + (u.pathname.slice("/support".length) || "/") + u.search + u.hash;
        } else if (u.origin === ORIGIN && shared) {
          target = url.origin + u.pathname + u.search + u.hash;
        } else {
          target = u.toString();
        }
      } catch (e) { /* そのまま返す */ }
      return new Response(null, { status: res.status, headers: { Location: target } });
    }

    const out = new Response(res.body, res);
    out.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
    out.headers.delete("x-github-request-id");
    out.headers.delete("x-served-by");
    out.headers.delete("x-cache");
    out.headers.delete("x-cache-hits");
    out.headers.delete("x-timer");
    out.headers.delete("x-fastly-request-id");
    out.headers.delete("via");
    return out;
  }
};
