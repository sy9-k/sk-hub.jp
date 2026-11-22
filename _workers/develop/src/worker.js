// SK Hub Develop（https://develop.sk-hub.jp/）
// ページは置かず、sk-hub.jp（GitHub Pages）の /develop/ をそのつど取ってきて返す中継役（admin.sk-hub.jp と同じしくみ）。
// なので、サイトを直すときは sk-hub.jp のリポジトリにプッシュするだけでよい（この Worker の deploy はいらない）。
//
//   develop.sk-hub.jp/            → sk-hub.jp/develop/
//   develop.sk-hub.jp/docs/       → sk-hub.jp/develop/docs/
//   develop.sk-hub.jp/assets/…    → sk-hub.jp/assets/…（サイトと共通の部品は同じパスのまま。SHARED）
//   develop.sk-hub.jp/develop/…   → /… に移す（sk-hub.jp/develop/… の形のリンク）
const ORIGIN = "https://sk-hub.jp";
// サイトと共通のヘッダー・フッター（build で入る）が読む部品は、同じパスのまま sk-hub.jp から取る
const SHARED = [/^\/assets\//, /^\/frameworks\//, /^\/policies\/docs\//, /^\/support\/articles\.js$/, /^\/y-filter\/(firebase-config\.js|shared\/)/, /^\/updates\/updates\.json$/];
const CACHE_SECONDS = 60; // 直してから出るまで最大これだけかかる

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
    }
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/develop" || path.startsWith("/develop/")) {
      url.pathname = path.slice("/develop".length) || "/";
      return Response.redirect(url.toString(), 301);
    }

    const shared = SHARED.some((re) => re.test(path));
    const upstream = new URL((shared ? "" : "/develop") + path + url.search, ORIGIN);
    const res = await fetch(upstream.toString(), {
      method: request.method,
      redirect: "manual",
      headers: { "User-Agent": "sk-develop-worker", "Accept": request.headers.get("Accept") || "*/*" },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
    });

    // sk-hub.jp/develop/ にないページ（フッターの /products/ など）は、sk-hub.jp の同じページへ
    if (res.status === 404 && !shared) return Response.redirect(ORIGIN + path + url.search, 302);

    // GitHub Pages の移動（/develop/docs → /develop/docs/ など）を、このアドレスに合わせる
    if (res.status >= 300 && res.status < 400) {
      let target = res.headers.get("Location") || "";
      try {
        const u = new URL(target, upstream);
        if (u.origin === ORIGIN && (u.pathname === "/develop" || u.pathname.startsWith("/develop/"))) {
          target = url.origin + (u.pathname.slice("/develop".length) || "/") + u.search + u.hash;
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
    for (const h of ["x-github-request-id", "x-served-by", "x-cache", "x-cache-hits", "x-timer", "x-fastly-request-id", "via"]) out.headers.delete(h);
    return out;
  }
};
