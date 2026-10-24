// 多言語（window.SKI18N）。<head> で読み込む（ほかのスクリプトより先）
// URL は変えずに、/lang/ で選んだ言語（localStorage の sk_lang）でページを表示する（Search3958 と同じ方式）。
//   ・日本語以外なら、辞書（assets/i18n/<言語>.js。build が _build/i18n/<言語>.json から作る）をここで読み込み、
//     ページの最後（テンプレートの </footer> のあと）で translatePage() がページ全体を訳す
//   ・t("日本語の文") … いまの言語の訳を返す（スクリプトが作る文字用）。t("{n} 件", { n: 3 }) で {名前} を入れ替える
//   ・訳の単位と見つけ方は _build/i18n.py と同じ（リンクなどを含む文はタグごと 1 つの文。辞書のキーは key() の形）
(function () {
  "use strict";
  // 別のアドレス（office.sk-hub.jp など）から絶対 URL で読まれても、辞書はこのファイルと同じ場所から取る
  var ORIGIN = (function () { try { return new URL(document.currentScript.src).origin; } catch (e) { return ""; } })();

  var LANGS = [
    { code: "ja", name: "日本語", locale: "ja-JP" },
    { code: "en", name: "English", locale: "en-US" },
    { code: "zh-CN", name: "简体中文", locale: "zh-CN" },
    { code: "zh-TW", name: "繁體中文", locale: "zh-TW" },
    { code: "ko", name: "한국어", locale: "ko-KR" }
  ];
  var STORAGE_KEY = "sk_lang";

  function byCode(code) { for (var i = 0; i < LANGS.length; i++) if (LANGS[i].code === code) return LANGS[i]; return null; }
  function stored() { try { return localStorage.getItem(STORAGE_KEY) || ""; } catch (e) { return ""; } }

  var root = document.documentElement;
  var lang = byCode(stored()) ? stored() : "ja";
  // ページが対応する言語を絞っているとき（例: <html data-i18n-langs="ja en">。SK's Lab のツール）、それ以外の言語は英語で出す
  var allowed = (root.getAttribute("data-i18n-langs") || "").split(/\s+/).filter(Boolean);
  if (allowed.length && allowed.indexOf(lang) < 0) lang = allowed.indexOf("en") >= 0 ? "en" : allowed[0];

  // 日本語以外: 辞書を読み込み（<head> の中なので同期で入る）、訳し終わるまでページを隠す（日本語が一瞬見えないように）
  if (lang !== "ja") {
    root.lang = lang;
    if (!window.SK_I18N_DICT && document.readyState === "loading") {
      document.write('<script src="' + ORIGIN + '/assets/i18n/' + lang + '.js"><\/script>');
      document.write('<style id="sk-i18n-hide">html.sk-i18n-pending body{opacity:0!important}</style>');
      root.classList.add("sk-i18n-pending");
      // 万一訳せなくても、日本語のまま見せる
      setTimeout(reveal, 2500);
    }
  }

  function reveal() {
    root.classList.remove("sk-i18n-pending");
  }

  // ---------- 辞書のキー ----------
  // 空白をまとめた文。タグを含む文は、属性を名前順にそろえた形（build の _build/i18n.py と同じ）
  var VOID = { AREA: 1, BASE: 1, BR: 1, COL: 1, EMBED: 1, HR: 1, IMG: 1, INPUT: 1, LINK: 1, META: 1, SOURCE: 1, TRACK: 1, WBR: 1 };
  var SKIP = { SCRIPT: 1, STYLE: 1, SVG: 1, CODE: 1, PRE: 1, TEXTAREA: 1, TEMPLATE: 1, NOSCRIPT: 1 };
  var INLINE = { A: 1, STRONG: 1, B: 1, EM: 1, I: 1, SMALL: 1, SPAN: 1, BR: 1, TIME: 1, MARK: 1, SUB: 1, SUP: 1, KBD: 1, U: 1, S: 1, ABBR: 1 };
  var ATTRS = ["placeholder", "aria-label", "title", "alt", "label"];
  var JAPANESE = /[぀-ヿ㐀-鿿！-｠　-〿]/;
  var DATE = /^(\d{4})年(\d{1,2})月(\d{1,2})日$/;

  function collapse(s) { return String(s).replace(/\s+/g, " ").trim(); }
  function raw(node) {
    if (node.nodeType === 3) return node.nodeValue;
    if (node.nodeType !== 1) return "";
    var tag = node.tagName.toLowerCase();
    var attrs = Array.prototype.map.call(node.attributes, function (a) { return a.name + '="' + a.value + '"'; }).sort();
    var out = "<" + tag + (attrs.length ? " " + attrs.join(" ") : "") + ">";
    if (VOID[node.tagName]) return out;
    return out + Array.prototype.map.call(node.childNodes, raw).join("") + "</" + tag + ">";
  }
  function keyOf(el) { return collapse(Array.prototype.map.call(el.childNodes, raw).join("")); }

  function dict() { return window.SK_I18N_DICT || {}; }
  function formatDate(y, m, d) {
    if (lang === "en") return new Date(+y, +m - 1, +d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    if (lang === "ko") return y + "년 " + (+m) + "월 " + (+d) + "일";
    return y + "年" + (+m) + "月" + (+d) + "日";
  }
  function lookup(key) {
    var m = key.match(DATE);
    if (m) return formatDate(m[1], m[2], m[3]);
    return dict()[key] || null;
  }

  function t(text, vars) {
    var out = lang === "ja" ? text : (lookup(collapse(text)) || text);
    if (vars) out = out.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; });
    return out;
  }

  // ---------- ページを訳す ----------
  function decode(html) {
    var ta = document.createElement("textarea");
    ta.innerHTML = html;
    return ta.value;
  }
  function translateAttrs(el) {
    ATTRS.forEach(function (name) {
      var v = el.getAttribute(name);
      if (v && JAPANESE.test(v)) {
        var tr = lookup(collapse(v));
        if (tr) el.setAttribute(name, decode(tr));
      }
    });
  }
  function inlineOnly(el) {
    for (var i = 0; i < el.childNodes.length; i++) {
      var c = el.childNodes[i];
      if (c.nodeType !== 1) continue;
      if (!INLINE[c.tagName] || !inlineOnly(c)) return false;
    }
    return true;
  }
  function translateText(node) {
    var v = node.nodeValue;
    var key = collapse(v);
    if (!key || !JAPANESE.test(key)) return;
    var tr = lookup(key);
    if (!tr) return;
    var lead = v.match(/^\s*/)[0];
    var trail = v.match(/\s*$/)[0];
    node.nodeValue = lead + decode(tr) + trail;
  }
  function walk(el) {
    if (SKIP[el.tagName]) {
      if (el.tagName === "TEXTAREA") translateAttrs(el);
      return;
    }
    if (el.hasAttribute && el.hasAttribute("data-i18n-skip")) return;
    translateAttrs(el);
    var hasText = false, hasElement = false;
    for (var i = 0; i < el.childNodes.length; i++) {
      var c = el.childNodes[i];
      if (c.nodeType === 3 && JAPANESE.test(c.nodeValue)) hasText = true;
      if (c.nodeType === 1) hasElement = true;
    }
    if (hasText && hasElement && inlineOnly(el)) {
      // 文の中にリンクなどがある: タグごと 1 つの文として訳す
      var tr = lookup(keyOf(el));
      if (tr) el.innerHTML = tr;
      return;
    }
    Array.prototype.slice.call(el.childNodes).forEach(function (c) {
      if (c.nodeType === 3) translateText(c);
      else if (c.nodeType === 1) walk(c);
    });
  }

  function translatePage(scope) {
    if (lang === "ja") return;
    try {
      walk(scope || document.body);
      var title = lookup(collapse(document.title));
      if (title) document.title = decode(title);
    } finally {
      if (!scope) reveal();
    }
  }

  // 言語を選んで、同じページを開き直す
  function setLang(code, next) {
    if (!byCode(code)) return;
    try { localStorage.setItem(STORAGE_KEY, code); } catch (e) { /* 保存できなくても移る */ }
    location.href = next || (location.pathname + location.search + location.hash);
  }

  // 日付（2026-09-26 や Date）をいまの言語で
  function date(value, opts) {
    var d = value instanceof Date ? value : new Date(String(value).length === 10 ? value + "T00:00:00" : value);
    if (isNaN(d)) return String(value);
    return d.toLocaleDateString(byCode(lang).locale, opts || { year: "numeric", month: "long", day: "numeric" });
  }

  // URL は言語で変わらない（以前の /en/ 方式の名残の呼び出しのため、そのまま返す）
  function path(url) { return url; }

  window.SKI18N = { LANGS: LANGS, lang: lang, locale: byCode(lang).locale, t: t, date: date, path: path, setLang: setLang, stored: stored, translatePage: translatePage, apply: translatePage };
})();
