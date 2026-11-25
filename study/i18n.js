// 多言語（SK Study）。画面に出す日本語の文は tx("…") で包む（{n} のような穴は tx("{n} 問", { n })）。
//   ・辞書は /assets/i18n.js が読み込む（_build/i18n/<言語>.json から build が作る）。訳がない文は日本語のまま出る
//   ・名前は t でなく tx（このアプリは t を、ほかの意味の変数名にも使うため）。build は tx( も訳の対象として探す
const I18N = window.SKI18N || {
  lang: "ja",
  locale: "ja-JP",
  t: (s, p) => (p ? s.replace(/\{(\w+)\}/g, (m, k) => (p[k] != null ? p[k] : m)) : s)
};
export const tx = I18N.t;
export const lang = I18N.lang;
// 日付・時刻の表示の言語（toLocaleString などに渡す）
export const locale = I18N.locale || "ja-JP";

export const isJa = lang === "ja";
// 共有の辞書に、ほかの意味の同じ日本語がある文字は、日本語のときだけ元の文字にして、ほかの言語では別のキーで訳す
export const JA_NAME = isJa ? "日本語" : tx("日本語（言語名）");  // 言語の名前（辞書の「日本語」は言語の切りかえ用で、訳さない）
export const DAY_UNIT = isJa ? "日" : tx("日間");                  // 連続で学習した日数の単位（辞書の「日」は曜日）
