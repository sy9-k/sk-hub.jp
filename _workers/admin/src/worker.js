// SK の管理画面（https://admin.sk-hub.jp/）
// ページは置かず、sk-hub.jp（GitHub Pages）の /admin/ をそのつど取ってきて返す中継役（support.sk-hub.jp と同じしくみ）。
// なので、管理画面を直すときは sk-hub.jp のリポジトリにプッシュするだけでよい（この Worker の deploy はいらない）。
//
//   admin.sk-hub.jp/              → sk-hub.jp/admin/
//   admin.sk-hub.jp/inbox/        → sk-hub.jp/admin/inbox/
//   admin.sk-hub.jp/assets/…      → sk-hub.jp/assets/…（サイトと共通の部品は同じパスのまま。SHARED）
//   admin.sk-hub.jp/admin/…       → /… に移す（前の sy9-k.github.io/admin/… の形のリンク）
//
// sk-hub.jp とは別の場所なので、ログイン・このブラウザの設定（表示・並べかえ・返事の定型文）はサイトと分かれる。
const ORIGIN = "https://sk-hub.jp";
const SHARED = [
  /^\/assets\//, /^\/toolbox\/shared\//, /^\/y-filter\/firebase-config\.js$/,
  /^\/view\/view(\.css|-core\.js)$/, /^\/support\/articles\.js$/
];
const CACHE_SECONDS = 60; // GitHub Pages から取ったものを Cloudflare に置いておく時間（直してから出るまで最大これだけかかる）

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });

    const path = url.pathname;
    if (path === "/admin" || path.startsWith("/admin/")) {
      url.pathname = path.slice("/admin".length) || "/";
      return Response.redirect(url.toString(), 301);
    }
    // 検索に出さない
    if (path === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });

    const shared = SHARED.some((re) => re.test(path));
    const upstream = new URL((shared ? "" : "/admin") + path + url.search, ORIGIN);
    const res = await fetch(upstream.toString(), {
      method: request.method,
      redirect: "manual",
      headers: { "User-Agent": "sk-admin-worker", "Accept": request.headers.get("Accept") || "*/*" },
      cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
    });

    // GitHub Pages の移動（/admin/inbox → /admin/inbox/ など）を、このアドレスに合わせる
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("Location") || "";
      let target = loc;
      try {
        const u = new URL(loc, upstream);
        if (u.origin === ORIGIN && (u.pathname === "/admin" || u.pathname.startsWith("/admin/"))) {
          target = url.origin + (u.pathname.slice("/admin".length) || "/") + u.search + u.hash;
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
    out.headers.set("X-Robots-Tag", "noindex, nofollow");
    out.headers.set("X-Frame-Options", "DENY"); // ほかのサイトの中に管理画面を入れさせない
    out.headers.set("Referrer-Policy", "same-origin");
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
