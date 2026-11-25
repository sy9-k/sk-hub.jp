// SK Hub の地域版（kr / cn / tw / eu / global.sk-hub.jp と、その国から開いた https://sk-hub.jp/）
// 地域ごとの専用サイト。ページは置かず、sk-hub.jp（GitHub Pages）のページをそのつど取ってきて、
// その地域で出さないプロダクトを隠し、地域の言語で出して返す中継役（Samsung などの国別サイトと同じ考え方）。
// なので、ページを直すときは sk-hub.jp のリポジトリにプッシュするだけでよい（この Worker の deploy は、地域や出すものを変えるときだけ）。
//
//   <地域>.sk-hub.jp/                 → sk-hub.jp/ を、その地域向けに整えて出す（どの国から開いても）
//   <地域>.sk-hub.jp/products/ など   → sk-hub.jp の同じページを、同じように整えて出す（MIRROR）
//   <地域>.sk-hub.jp/assets/ など     → sk-hub.jp の同じパス（共通の部品。SHARED）
//   <地域>.sk-hub.jp/出さないもの      → <地域>.sk-hub.jp のトップへ移す
//   <地域>.sk-hub.jp/それ以外          → sk-hub.jp の同じページへ移す（アプリ・ログインが要るもの。?hl=言語 を付ける）
//   sk-hub.jp/（その国から）           → その地域のサイトへ移す（トップ・読むページは同じページへ、出さないプロダクトはトップへ）
//   sk-hub.jp/（ほかの国から）          → いつもの日本語のトップ（Worker は何もしない）。日本を選んだ人（?site=jp）にも何もしない
//
// 地域ごとに出すプロダクトは、下の REGIONS の products で決める（ここだけ直せばよい）。
// 「地域向けに整える」の中身（HTMLRewriter）
//   ・data-region="jp" の付いた要素を消す（日本だけで出すもの。例: Sentaro さんとの提携、SaeTab、お知らせ）
//   ・data-region="kr" の付いた hidden の要素を出す（地域版だけで出す、言い換えの文）
//   ・data-product="<プロダクト>" の付いた要素のうち、その地域で出さないプロダクトのものを消す
//   ・言語を選んでいなければ、その地域の言語で出す
//   ・タイトル・説明文をその地域の言語にし、canonical・og:url を地域のアドレスにそろえ、hreflang を付ける
//   ・中国（cn）は、Google Fonts と Google アナリティクスを読み込む部品を外す（中国から届かないため）
// 隠したいものがあるときは、sk-hub.jp の HTML にその要素へ data-region / data-product を付けるだけでよい（Worker は直さない）。
//
// その国から開いても日本のサイトを見たいとき: sk-hub.jp/?site=jp を開く（30 日のあいだ、地域サイトへ移すのをやめる）。
// 検索エンジンのクローラー（UA に bot・crawler・spider を含むもの）には、sk-hub.jp では出し分けをしない。
const ORIGIN = "https://sk-hub.jp";
const MAIN = ["nagi", "toolbox", "study", "office", "systems"];

// ---- 地域の設定 ----
// products: その地域で出すプロダクト（nagi・toolbox・study・office・systems・malu・y-filter・lab）
//   systems … SK Hub Systems（アカウントとログイン。study・office は、これがないと使えない）
// countries: その国から sk-hub.jp/ を開いたとき、この地域のトップを出す（ISO の国コード）
const EEA = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IS", "IE", "IT", "LV", "LI", "LT", "LU", "MT", "NL", "NO", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "GB", "CH"];
const REGIONS = {
  kr: { host: "kr.sk-hub.jp", lang: "ko", locale: "ko_KR", hreflang: "ko", countries: ["KR"], products: [...MAIN, "invites"] },
  // 中国: Google・Firebase に届かないので、アカウントのいらない Nagi と SK's Toolbox だけ
  cn: { host: "cn.sk-hub.jp", lang: "zh-CN", locale: "zh_CN", hreflang: "zh-CN", countries: ["CN"], products: ["nagi", "toolbox"], dropGoogle: true },
  tw: { host: "tw.sk-hub.jp", lang: "zh-TW", locale: "zh_TW", hreflang: "zh-TW", countries: ["TW", "HK", "MO"], products: ["nagi", "toolbox", "systems"] },
  eu: { host: "eu.sk-hub.jp", lang: "en", locale: "en_GB", hreflang: "", countries: EEA, products: ["nagi", "toolbox", "systems"] },
  global: { host: "global.sk-hub.jp", lang: "en", locale: "en_US", hreflang: "", countries: [], products: ["nagi", "toolbox", "systems"] }
};
const HOSTS = Object.fromEntries(Object.entries(REGIONS).map(([code, r]) => [r.host, code]));

// プロダクトごとの、ページ・アプリのパス
const PRODUCT_PATHS = {
  "y-filter": /^\/(products\/y-filter|y-filter)(\/|$)/,
  malu: /^\/(products\/malu|dictionary)(\/|$)/,
  lab: /^\/(lab|qr-prj|smart-dash)(\/|$)/,
  study: /^\/(products\/study|study)(\/|$)/,
  office: /^\/(products\/office|office)(\/|$)/,
  nagi: /^\/(products\/nagi|nagi)(\/|$)/,
  toolbox: /^\/(products\/toolbox|toolbox)(\/|$)/,
  systems: /^\/(sk-hub-systems|account|waiting)(\/|$)/,
  // 招待制（早期アクセスの登録と招待の状況）は、日本と大韓民国だけ
  invites: /^\/(waiting|account\/invites)(\/|$)/
};
// アップデート情報の category
const PRODUCT_CATEGORY = { "y-filter": "Y-FILTER.", malu: "MALU", lab: "Lab", nagi: "Nagi", systems: "SK Hub Systems" };

function hiddenProducts(r) { return Object.keys(PRODUCT_PATHS).filter((p) => !r.products.includes(p)); }
function blockedRegex(r) {
  const list = hiddenProducts(r).map((p) => PRODUCT_PATHS[p].source);
  return list.length ? new RegExp(list.join("|")) : /(?!)/;
}

const SHARED = [
  /^\/assets\//, /^\/frameworks\//, /^\/icons\//, /^\/lang\//, /^\/about\/(about\.css|about\.js)$/, /^\/korea\/[^/]+\.[a-z0-9]+$/,
  /^\/policies\/docs\//, /^\/y-filter\/(firebase-config\.js|shared\/)/, /^\/updates\/updates\.json$/,
  /^\/(waiting|account|account\/invites)\/[^/]+\.(css|js|png)$/,
  /^\/(dictionary\/ico|nagi\/ico|toolbox\/icon|study\/ico|products\/[a-z]+\/[^/]+\.(css|js|png|webp|svg))/
];
// 地域版で、そのまま出すページ（読むだけのページ。アプリやログインが要るものは sk-hub.jp へ移す）
// アカウントのページ（/account/・/account/invites/・/sk-hub-systems/account/）も出す。アカウントを出さない地域（cn）では、systems が隠されているので出ない。
//   ログインは地域のサイトでもできる（Google・GitHub。ログインの状態はアドレスごとなので、sk-hub.jp のアプリでは、もう一度ログインする）
const MIRROR = [/^\/(products|policies|updates|brand|credits|sk-hub-systems|waiting|account)\/?$/, /^\/(products|policies|brand|sk-hub-systems)\/.+\/$/, /^\/account\/invites\/?$/];
const CACHE_SECONDS = 60; // GitHub Pages から取ったものを Cloudflare に置いておく時間（直してから出るまで最大これだけかかる）
const SKIP_COOKIE = "sk_site";
const SKIP_DAYS = 30;

// 検索結果・共有カードに出す、地域の説明文（日本語の説明文に、その地域で出さないプロダクトの名前が入っているページ用）。
// ここにないページは、sk-hub.jp の辞書（assets/i18n/<言語>.js）に訳があればそれを使う
const DESC = {
  kr: {
    "/": "고등학생 SK가 만드는 집중 타이머 Nagi, 작은 앱 도구 상자 SK's Toolbox, 학습 앱 SK Study의 소개와 지원 정보.",
    "/products/": "SK가 만드는 앱 목록. 집중 타이머 Nagi, 작은 앱 도구 상자 SK's Toolbox, 학습 앱 SK Study, SK Hub Office, SK Hub Systems."
  },
  cn: {
    "/": "高中生 SK 开发的专注计时器 Nagi 和小应用工具箱 SK's Toolbox 的介绍与支持信息。",
    "/products/": "SK 开发的应用列表。专注计时器 Nagi、小应用工具箱 SK's Toolbox。"
  },
  tw: {
    "/": "高中生 SK 開發的專注計時器 Nagi 和小應用工具箱 SK's Toolbox 的介紹與支援資訊。",
    "/products/": "SK 開發的應用列表。專注計時器 Nagi、小應用工具箱 SK's Toolbox。"
  },
  eu: {
    "/": "Apps by SK, a high school student: the Nagi focus timer and SK's Toolbox.",
    "/products/": "The apps SK builds: Nagi and SK's Toolbox."
  },
  global: {
    "/": "Apps by SK, a high school student: the Nagi focus timer and SK's Toolbox.",
    "/products/": "The apps SK builds: Nagi and SK's Toolbox."
  }
};

// sk-hub.jp の訳の辞書（assets/i18n/<言語>.js の window.SK_I18N_DICT）。言語ごとに、しばらく覚えておく
const dictCache = {};
async function dictFor(lang) {
  const hit = dictCache[lang];
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.dict;
  let dict = hit ? hit.dict : {};
  try {
    const r = await fetch(`${ORIGIN}/assets/i18n/${lang}.js`, { cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true } });
    const t = await r.text();
    dict = JSON.parse(t.slice(t.indexOf("{")).replace(/;\s*$/, ""));
    dictCache[lang] = { dict, at: Date.now() };
  } catch (e) { /* 取れなければ前のまま（なければ訳なし） */ }
  return dict;
}

// 地域の印と、出さないもの（window.SK_REGION・SK_BLOCKED・SK_HIDDEN_CATEGORIES。assets/site.js のメニューとアップデート情報が見る）と、
// 言語を選んでいなければ地域の言語（i18n.js より前に入れる）
function bootScript(code, r) {
  const hidden = hiddenProducts(r);
  const blocked = hidden.map((p) => PRODUCT_PATHS[p].source);
  const cats = hidden.map((p) => PRODUCT_CATEGORY[p]).filter(Boolean);
  return "<script>" +
    `window.SK_REGION=${JSON.stringify(code)};window.SK_BLOCKED=${JSON.stringify(blocked)};window.SK_HIDDEN_CATEGORIES=${JSON.stringify(cats)};` +
    `(function(){try{if(!localStorage.getItem("sk_lang"))localStorage.setItem("sk_lang",${JSON.stringify(r.lang)});}catch(e){}})();` +
    "</script>";
}

function isBot(request) {
  return /bot|crawler|spider|slurp|facebookexternalhit|preview/i.test(request.headers.get("User-Agent") || "");
}
function wantsJapanese(request) {
  return new RegExp("(?:^|;\\s*)" + SKIP_COOKIE + "=jp(?:;|$)").test(request.headers.get("Cookie") || "");
}
function isHtml(res) {
  return (res.headers.get("Content-Type") || "").includes("text/html");
}
function regionForCountry(country) {
  for (const [code, r] of Object.entries(REGIONS)) if (r.countries.includes(country)) return code;
  return "";
}

// 上流（GitHub Pages）の応答から、サーバー情報のヘッダーを取り除く
function clean(res) {
  const out = new Response(res.body, res);
  for (const h of ["x-github-request-id", "x-served-by", "x-cache", "x-cache-hits", "x-timer", "x-fastly-request-id", "via"]) out.headers.delete(h);
  return out;
}

// HTML を地域向けに整える（regionUrl は地域のサイトのとき、そのページのアドレス。sk-hub.jp/ のときは null）
async function localize(res, code, regionUrl) {
  if (!isHtml(res)) return res;
  const r = REGIONS[code];
  const rw = new HTMLRewriter()
    .on("head", { element(el) { el.prepend(bootScript(code, r), { html: true }); } })
    .on('[data-region="jp"]', { element(el) { el.remove(); } })
    .on('[data-region="kr"]', { element(el) { el.removeAttribute("hidden"); } });
  for (const p of hiddenProducts(r)) {
    rw.on(`[data-product="${p}"]`, { element(el) { el.remove(); } });
    if (PRODUCT_CATEGORY[p]) rw.on(`[data-updates-filter="${PRODUCT_CATEGORY[p]}"]`, { element(el) { el.remove(); } });
  }
  if (r.dropGoogle) {
    // 中国から届かない Google Fonts と Google アナリティクスを読み込まない（文字は端末の文字になる）
    rw.on('script[src$="/fonts.js"]', { element(el) { el.remove(); } })
      .on('script[src$="/analytics.js"]', { element(el) { el.remove(); } });
  }
  if (regionUrl) {
    const path = new URL(regionUrl).pathname;
    const dict = await dictFor(r.lang);
    const tr = (text) => dict[text] || text;
    const desc = (text) => (DESC[code] && DESC[code][path]) || tr(text);
    let title = "";
    rw.on('link[rel="canonical"]', { element(el) { el.setAttribute("href", regionUrl); } })
      .on('meta[property="og:url"]', { element(el) { el.setAttribute("content", regionUrl); } })
      .on('meta[property="og:locale"]', { element(el) { el.setAttribute("content", r.locale); } })
      // 検索エンジンは JavaScript の訳を読まないことがあるので、タイトルと説明文は Worker で地域の言語にしておく
      .on("title", { text(t) {
        title += t.text; t.remove();
        if (t.lastInTextNode) { t.replace(tr(title.trim()), { html: false }); title = ""; }
      } })
      .on('meta[name="description"]', { element(el) { el.setAttribute("content", desc(el.getAttribute("content") || "")); } })
      .on('meta[property="og:description"]', { element(el) { el.setAttribute("content", desc(el.getAttribute("content") || "")); } })
      .on('meta[property="og:title"]', { element(el) { el.setAttribute("content", tr(el.getAttribute("content") || "")); } })
      // 日本版と地域版を検索エンジンに伝える
      .on("head", { element(el) {
        el.append(
          (r.hreflang ? `<link rel="alternate" hreflang="${r.hreflang}" href="${regionUrl}">` : "") +
          `<link rel="alternate" hreflang="ja" href="${ORIGIN + path}">` +
          `<link rel="alternate" hreflang="x-default" href="${ORIGIN + path}">`, { html: true });
      } });
  }
  return rw.transform(res);
}

async function upstream(path, search, request) {
  return fetch(new URL(path + search, ORIGIN).toString(), {
    method: request.method,
    redirect: "manual",
    headers: { "User-Agent": "sk-region-worker", "Accept": request.headers.get("Accept") || "*/*" },
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true }
  });
}

async function regionHost(request, url, code) {
  const r = REGIONS[code];
  const path = url.pathname;
  const blocked = blockedRegex(r);
  if (path === "/robots.txt") {
    return new Response(`User-agent: *\nAllow: /\nSitemap: https://${r.host}/sitemap.xml\n`, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  if (path === "/sitemap.xml") {
    // sk-hub.jp の sitemap から、この地域で出すページだけを選んで、日本版を alternate に付ける
    let paths = ["/"];
    try {
      const xml = await (await fetch(ORIGIN + "/sitemap.xml", { cf: { cacheTtl: 3600, cacheEverything: true } })).text();
      for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
        const p = new URL(m[1]).pathname;
        if (p !== "/" && !blocked.test(p) && MIRROR.some((re) => re.test(p))) paths.push(p);
      }
    } catch (e) { /* 取れなければトップだけ */ }
    const self = r.hreflang ? (p) => `<xhtml:link rel="alternate" hreflang="${r.hreflang}" href="https://${r.host}${p}"/>` : () => "";
    const items = paths.map((p) => `  <url><loc>https://${r.host}${p}</loc>` + self(p) +
      `<xhtml:link rel="alternate" hreflang="ja" href="${ORIGIN}${p}"/></url>`).join("\n");
    const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${items}\n</urlset>\n`;
    return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
  }

  const shared = SHARED.some((re) => re.test(path));
  if (!shared && blocked.test(path)) return Response.redirect(url.origin + "/", 302);
  if (!shared && !MIRROR.some((re) => re.test(path)) && path !== "/") {
    // 読むだけのページでないもの（アプリ・ログイン・日本向けのページなど）は、sk-hub.jp の同じページへ。
    // 言語は別の場所に保存されるので、まだ選んでいない人がその地域の言語のまま開けるよう ?hl= を付ける（assets/i18n.js）
    const to = new URL(path + url.search, ORIGIN);
    if (!to.searchParams.has("hl")) to.searchParams.set("hl", r.lang);
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

  const out = clean(await localize(res, code, `https://${r.host}${path}`));
  // 中身が整えてある HTML は、ブラウザに長く置かせない（隠すものを直したらすぐ出るように）。ほかはそのまま置く
  out.headers.set("Cache-Control", isHtml(res) ? "private, no-cache" : `public, max-age=${CACHE_SECONDS}`);
  return out;
}

async function apexHost(request, url, country) {
  if (request.method !== "GET" && request.method !== "HEAD") return fetch(request);

  // ?site=jp … 日本のサイトを見る。30 日のあいだ、現地の地域サイトへ移すのをやめる印をつける
  if (url.searchParams.get("site") === "jp") {
    const res = await fetch(request);
    const out = new Response(res.body, res);
    out.headers.append("Set-Cookie", `${SKIP_COOKIE}=jp; Path=/; Max-Age=${SKIP_DAYS * 86400}; Secure; SameSite=Lax`);
    out.headers.set("Cache-Control", "private, no-cache");
    return out;
  }
  // 現地（その地域の国）から開いたら、その地域の専用サイトを出す。
  //   トップ・読むだけのページ → 地域サイトの同じページ、その地域で出さないプロダクト → 地域サイトのトップ。
  //   アプリ（出すもの）・共通の部品は、そのまま。検索エンジンのクローラーと、日本を選んだ人（?site=jp）には何もしない
  const code = regionForCountry(country);
  if (!code || wantsJapanese(request) || isBot(request)) return fetch(request);
  const r = REGIONS[code];
  const path = url.pathname;
  if (SHARED.some((re) => re.test(path))) return fetch(request);
  let to = "";
  if (path === "/") to = "/";
  else if (blockedRegex(r).test(path)) to = "/";
  else if (MIRROR.some((re) => re.test(path))) to = path + url.search;
  if (!to) return fetch(request);
  return new Response(null, {
    status: 302,
    headers: { Location: `https://${r.host}${to}`, "Cache-Control": "private, no-cache", "Vary": "Cookie" }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const country = (request.cf && request.cf.country) || "";
    const code = HOSTS[url.hostname];
    if (code) {
      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      return regionHost(request, url, code);
    }
    return apexHost(request, url, country);
  }
};
