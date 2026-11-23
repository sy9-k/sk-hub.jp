// SK Hub Korea（https://kr.sk-hub.jp/ と、韓国から開いた https://sk-hub.jp/）
// 韓国向けの SK のサイト（地域版）。ページは置かず、sk-hub.jp（GitHub Pages）のページをそのつど取ってきて、
// 韓国で出さないものを隠し、言語を韓国語にして返す中継役。
// なので、ページを直すときは sk-hub.jp のリポジトリにプッシュするだけでよい（この Worker の deploy はいらない）。
//
//   kr.sk-hub.jp/                → sk-hub.jp/ を、韓国向けに整えて出す（どの国から開いても）
//   kr.sk-hub.jp/products/ など  → sk-hub.jp の同じページを、同じように整えて出す（MIRROR）
//   kr.sk-hub.jp/assets/ など    → sk-hub.jp の同じパス（共通の部品。SHARED）
//   kr.sk-hub.jp/それ以外         → sk-hub.jp の同じページへ移す（アプリ・ログインが要るもの）
//   sk-hub.jp/（韓国から）        → 同じ整え方で出す（アドレスは sk-hub.jp のまま。トップだけ）
//   sk-hub.jp/（韓国以外から）     → いつもの日本語のトップ（Worker は何もしない）
//
// 「韓国向けに整える」の中身（HTMLRewriter）
//   ・data-region="jp" の付いた要素を消す（日本だけで出すもの。例: Sentaro さんとの提携、SaeTab）
//   ・data-region="kr" の付いた hidden の要素を出す（韓国だけで出すもの）
//   ・言語を選んでいなければ韓国語で出す
//   ・kr.sk-hub.jp では、canonical・og:url を kr.sk-hub.jp にそろえる
// 隠したいものがあるときは、sk-hub.jp の HTML にその要素へ data-region="jp" を付けるだけでよい（Worker は直さない）。
//
// 韓国から開いても日本語のトップを見たいとき: sk-hub.jp/?site=jp を開く（30 日のあいだ、出し分けをやめる）。
// 検索エンジンのクローラー（UA に bot・crawler・spider を含むもの）には、sk-hub.jp では出し分けをしない。
const ORIGIN = "https://sk-hub.jp";
const KR_HOST = "kr.sk-hub.jp";
const SHARED = [
  /^\/assets\//, /^\/frameworks\//, /^\/icons\//, /^\/lang\//, /^\/about\/(about\.css|about\.js)$/, /^\/korea\/[^/]+\.[a-z0-9]+$/,
  /^\/policies\/docs\//, /^\/y-filter\/(firebase-config\.js|shared\/)/, /^\/updates\/updates\.json$/,
  /^\/(dictionary\/ico|nagi\/ico|toolbox\/icon|study\/ico|products\/[a-z]+\/[^/]+\.(css|js|png|webp|svg))/
];
// kr.sk-hub.jp で、そのまま出すページ（読むだけのページ。アプリやログインが要るものは sk-hub.jp へ移す）
const MIRROR = [/^\/(products|policies|updates|brand|credits|sk-hub-systems)\/?$/, /^\/(products|policies|brand)\/.+\/$/];
// 韓国で出さないプロダクトのページ（公開してよいのは SK Study・SK Hub Office・SK's Toolbox・Nagi）。開かれたら kr.sk-hub.jp のトップへ
const BLOCKED = /^\/(products\/(y-filter|malu)|lab|y-filter|dictionary|qr-prj|smart-dash)(\/|$)/;
const CACHE_SECONDS = 60; // GitHub Pages から取ったものを Cloudflare に置いておく時間（直してから出るまで最大これだけかかる）
const SKIP_COOKIE = "sk_site";
const SKIP_DAYS = 30;

// 韓国版の印（window.SK_REGION。assets/site.js のメニューが見る）と、言語を選んでいなければ韓国語（i18n.js より前に入れる）
const KO_DEFAULT = '<script>window.SK_REGION="kr";(function(){try{if(!localStorage.getItem("sk_lang"))localStorage.setItem("sk_lang","ko");}catch(e){}})();</script>';

function isBot(request) {
  return /bot|crawler|spider|slurp|facebookexternalhit|preview/i.test(request.headers.get("User-Agent") || "");
}
function wantsJapanese(request) {
  return new RegExp("(?:^|;\\s*)" + SKIP_COOKIE + "=jp(?:;|$)").test(request.headers.get("Cookie") || "");
}
function isHtml(res) {
  return (res.headers.get("Content-Type") || "").includes("text/html");
}

// 上流（GitHub Pages）の応答から、サーバー情報のヘッダーを取り除く
function clean(res) {
  const out = new Response(res.body, res);
  for (const h of ["x-github-request-id", "x-served-by", "x-cache", "x-cache-hits", "x-timer", "x-fastly-request-id", "via"]) out.headers.delete(h);
  return out;
}

// HTML を韓国向けに整える（krUrl は kr.sk-hub.jp のとき、そのページのアドレス）
function localize(res, krUrl) {
  if (!isHtml(res)) return res;
  const rw = new HTMLRewriter()
    .on("head", { element(el) { el.prepend(KO_DEFAULT, { html: true }); } })
    .on('[data-region="jp"]', { element(el) { el.remove(); } })
    .on('[data-region="kr"]', { element(el) { el.removeAttribute("hidden"); } });
  if (krUrl) {
    rw.on('link[rel="canonical"]', { element(el) { el.setAttribute("href", krUrl); } })
      .on('meta[property="og:url"]', { element(el) { el.setAttribute("content", krUrl); } })
      .on('meta[property="og:locale"]', { element(el) { el.setAttribute("content", "ko_KR"); } });
  }
  return rw.transform(res);
}

async function upstream(path, search, request) {
  return fetch(new URL(path + search, ORIGIN).toString(), {
    method: request.method,
    redirect: "manual",
    headers: { "User-Agent": "sk-kr-worker", "Accept": request.headers.get("Accept") || "*/*" },
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
  });
}

async function krHost(request, url) {
  const path = url.pathname;
  if (path === "/robots.txt") {
    return new Response(`User-agent: *\nAllow: /\nSitemap: https://${KR_HOST}/sitemap.xml\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (path === "/sitemap.xml") {
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://${KR_HOST}/</loc></url>\n</urlset>\n`;
    return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
  }

  const shared = SHARED.some((re) => re.test(path));
  if (!shared && BLOCKED.test(path)) return Response.redirect(url.origin + "/", 302);
  if (!shared && !MIRROR.some((re) => re.test(path)) && path !== "/") {
    // 読むだけのページでないもの（アプリ・ログイン・日本向けのページなど）は、sk-hub.jp の同じページへ。
    // 言語は別の場所に保存されるので、まだ選んでいない人が韓国語のまま開けるよう ?hl=ko を付ける（assets/i18n.js）
    const to = new URL(path + url.search, ORIGIN);
    if (!to.searchParams.has("hl")) to.searchParams.set("hl", "ko");
    return Response.redirect(to.toString(), 302);
  }

  const res = await upstream(path, url.search, request);

  // GitHub Pages の移動（/products → /products/ など）を、このアドレスに合わせる
  if (res.status >= 300 && res.status < 400) {
    let target = res.headers.get("Location") || "";
    try {
      const u = new URL(target, ORIGIN);
      target = u.origin === ORIGIN ? url.origin + u.pathname + u.search + u.hash : u.toString();
    } catch (e) { /* そのまま返す */ }
    return new Response(null, { status: res.status, headers: { Location: target } });
  }
  if (res.status === 404 && !shared) return Response.redirect(ORIGIN + path + url.search, 302);

  const out = clean(localize(res, `https://${KR_HOST}${path}`));
  // 中身が整えてある HTML は、ブラウザに長く置かせない（隠すものを直したらすぐ出るように）。ほかはそのまま置く
  out.headers.set("Cache-Control", isHtml(res) ? "private, no-cache" : `public, max-age=${CACHE_SECONDS}`);
  return out;
}

async function apexHost(request, url, country) {
  // sk-hub.jp/ だけを扱う（route もそうしてある）。ほかは何もしない
  if (url.pathname !== "/" || (request.method !== "GET" && request.method !== "HEAD")) return fetch(request);

  // ?site=jp … 日本語のトップを見る。30 日のあいだ出し分けをやめる印をつける
  if (url.searchParams.get("site") === "jp") {
    const res = await fetch(request);
    const out = new Response(res.body, res);
    out.headers.append("Set-Cookie", `${SKIP_COOKIE}=jp; Path=/; Max-Age=${SKIP_DAYS * 86400}; Secure; SameSite=Lax`);
    out.headers.set("Cache-Control", "private, no-cache");
    return out;
  }
  if (country !== "KR" || wantsJapanese(request) || isBot(request)) return fetch(request);

  const res = await fetch(request);
  if (res.status !== 200 || !isHtml(res)) return res;
  const out = clean(localize(res, null));
  out.headers.set("Cache-Control", "private, no-cache");
  out.headers.set("Vary", "Cookie");
  return out;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const country = (request.cf && request.cf.country) || "";
    if (url.hostname === KR_HOST) {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      return krHost(request, url);
    }
    return apexHost(request, url, country);
  }
};
