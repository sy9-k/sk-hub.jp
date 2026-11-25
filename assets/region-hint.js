// 「この地域ではありませんか？」の案内。
// いま見ているサイトの地域と、端末のタイムゾーンから推し量った、いまいる地域がちがうとき、画面の上に出して、その地域の専用サイトへ案内する
// （Samsung などの国別サイトの「Are you in …?」と同じ。地域のサイトは _workers/kr/、選ぶ画面は /lang/）。
//   ・案内は、いまいる地域の言語で出す。「移動」で地域のサイトへ（言語は ?setlang= で引き継ぐ）、「このまま」で 30 日のあいだ出さない
//   ・/lang/ の画面から地域を選んで移ったときは、?nohint=1 を付けて開く（選んだばかりなので、30 日のあいだ案内しない）
//   ・sk-hub.jp?site=jp で日本を選んだ人（cookie sk_site=jp）にも、30 日のあいだ出さない
//   ・手元の確認（localhost など）と、/lang/ の画面、アプリの中では出さない
(function () {
  "use strict";

  var HOST = location.hostname;
  if (!/(^|\.)sk-hub\.jp$/.test(HOST) || window.top !== window || /^\/lang(\/|$)/.test(location.pathname)) return;
  if (document.documentElement.hasAttribute("data-lang-app")) return;

  var DAY = 24 * 60 * 60 * 1000;
  var KEY = "sk_region_hint";

  // ?nohint=1 … 地域を選んで移ってきたとき。案内をしばらく出さない（URL からは消す）
  try {
    var qs = new URLSearchParams(location.search);
    // ?site=jp … 日本を選んだ。30 日のあいだ、現地の地域サイトへ移さない印（cookie sk_site=jp）をつける。
    //   Cloudflare の route はクエリ付きのアドレスに当たらず、Worker で cookie を付けられないので、ここで付ける（Worker が読む）
    if (qs.get("site") === "jp") document.cookie = "sk_site=jp; Path=/; Max-Age=" + (30 * 24 * 60 * 60) + "; Secure; SameSite=Lax";
    if (qs.get("nohint")) {
      localStorage.setItem(KEY, JSON.stringify({ all: Date.now() + 30 * DAY }));
      qs.delete("nohint");
      history.replaceState(null, "", location.pathname + (qs.toString() ? "?" + qs.toString() : "") + location.hash);
    }
  } catch (e) { /* 保存できなくても続ける */ }

  var SITES = {
    jp: "https://sk-hub.jp", kr: "https://kr.sk-hub.jp", cn: "https://cn.sk-hub.jp",
    tw: "https://tw.sk-hub.jp", eu: "https://eu.sk-hub.jp", global: "https://global.sk-hub.jp"
  };
  // 地域ごとの、言語（先頭が標準）と、案内の文
  var REGIONS = {
    jp: { langs: ["ja", "en", "ko"], title: "日本にいますか？", body: "日本のサイトを見られます。", go: "日本のサイトへ移動", stay: "このまま見る" },
    kr: { langs: ["ko", "en", "ja"], title: "한국에 계신가요?", body: "대한민국 사이트를 이용하실 수 있습니다.", go: "대한민국 사이트로 이동", stay: "이 사이트에 머물기" },
    cn: { langs: ["zh-CN", "en"], title: "您在中国大陆吗？", body: "可以前往中国大陆站点。", go: "前往中国大陆站点", stay: "留在当前站点" },
    tw: { langs: ["zh-TW", "en"], title: "您在台灣或香港嗎？", body: "可以前往台灣・香港站點。", go: "前往台灣・香港站點", stay: "留在目前站點" },
    eu: { langs: ["en"], title: "Are you in Europe?", body: "You can visit the Europe site.", go: "Go to the Europe site", stay: "Stay here" },
    global: { langs: ["en", "ja"], title: "Not in this region?", body: "You can visit the global site.", go: "Go to the global site", stay: "Stay here" }
  };

  // いま見ているサイトの地域
  var here = window.SK_REGION && SITES[window.SK_REGION] ? window.SK_REGION : "jp";
  if (here === "jp") { var h = Object.keys(SITES).filter(function (k) { return SITES[k].indexOf("//" + HOST) >= 0; })[0]; if (h) here = h; }

  // いまいる地域: 端末のタイムゾーンから（国までは分からないので、おおまかに）
  var EU_CITIES = "Vienna Brussels Sofia Zagreb Nicosia Prague Copenhagen Tallinn Helsinki Paris Berlin Busingen Athens Budapest Dublin Rome Riga Vaduz Vilnius Luxembourg Malta Amsterdam Oslo Warsaw Lisbon Bucharest Bratislava Ljubljana Madrid Stockholm London Zurich Reykjavik Canary Madeira Azores".split(" ");
  function detect() {
    var tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (e) { return ""; }
    if (!tz) return "";
    if (tz === "Asia/Tokyo") return "jp";
    if (tz === "Asia/Seoul") return "kr";
    if (/^Asia\/(Shanghai|Chongqing|Harbin|Urumqi|Kashgar)$/.test(tz)) return "cn";
    if (/^Asia\/(Taipei|Hong_Kong|Macau|Macao)$/.test(tz)) return "tw";
    var city = tz.split("/")[1] || "";
    if (/^(Europe|Atlantic)\//.test(tz) && EU_CITIES.indexOf(city) >= 0) return "eu";
    return "global";
  }
  var there = detect();
  if (!there || there === here) return;

  // 出さない: 30 日のあいだ案内しない／その地域を断った／日本を選んだ人
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    if ((saved.all && saved.all > Date.now()) || (saved[there] && saved[there] > Date.now())) return;
  } catch (e) { /* 読めなければ出す */ }
  if (here === "jp" && /(?:^|;\s*)sk_site=jp(?:;|$)/.test(document.cookie)) return;
  // 地域のサイトを持たない国（その他）の人に、日本のサイトから毎回案内しない（日本語を選んでいる人は、日本のサイトのままでよい）
  if (there === "global" && here === "jp" && (window.SKI18N ? window.SKI18N.lang : "ja") === "ja") return;

  var info = REGIONS[there];
  var GENERIC = /^\/(policies|updates|brand|credits)(\/|$)/;

  function target() {
    var stored = "";
    try { stored = localStorage.getItem("sk_lang") || ""; } catch (e) { /* なし */ }
    var lang = info.langs.indexOf(stored) >= 0 ? stored : info.langs[0];
    var path = location.pathname === "/" || GENERIC.test(location.pathname) ? location.pathname : "/";
    var u = new URL(path, SITES[there]);
    u.searchParams.set("setlang", lang);
    u.searchParams.set("nohint", "1");
    if (there === "jp") u.searchParams.set("site", "jp");
    return u.toString();
  }
  function dismiss() {
    try {
      var saved = JSON.parse(localStorage.getItem(KEY) || "{}");
      saved[there] = Date.now() + 30 * DAY;
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch (e) { /* 保存できなくても閉じる */ }
    box.remove();
  }

  var box = document.createElement("div");
  box.className = "region-hint";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", info.title);
  box.lang = info.langs[0];
  var text = document.createElement("div");
  text.className = "region-hint-text";
  var t = document.createElement("strong");
  t.textContent = info.title;
  var b = document.createElement("span");
  b.textContent = info.body;
  text.append(t, b);
  var actions = document.createElement("div");
  actions.className = "region-hint-actions";
  var go = document.createElement("a");
  go.className = "region-hint-go";
  go.href = target();
  go.textContent = info.go;
  go.setAttribute("data-no-navigation", "true");
  var stay = document.createElement("button");
  stay.type = "button";
  stay.className = "region-hint-stay";
  stay.textContent = info.stay;
  stay.addEventListener("click", dismiss);
  actions.append(go, stay);
  box.append(text, actions);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && document.body.contains(box)) dismiss(); });

  function show() { document.body.appendChild(box); }
  if (document.body) show(); else document.addEventListener("DOMContentLoaded", show);
})();
