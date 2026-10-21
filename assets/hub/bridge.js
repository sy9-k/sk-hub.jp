// sk-hub.jp とサブドメインの橋渡し（/assets/hub/bridge.html の中身）
// support.sk-hub.jp などは別の場所なので、sk-hub.jp の localStorage やログインが見えない。
// そのページが見えない iframe でこのページを開き、postMessage で次のものを受け取る・渡す。
//   { sk: "bridge", id, op: "prefs" }             → 言語・表示・アクセス解析の設定・利用規約の同意・サポートID・ログイン中かのヒント
//   { sk: "bridge", id, op: "set", key, value }   → 言語・表示・アクセス解析・利用規約の同意を sk-hub.jp にも保存する（サブドメインで変えたとき）。
//                                                  サポートID は、sk-hub.jp にまだないときだけ（RedFlag Checker がサブドメインで発行したもの）
//   { sk: "bridge", id, op: "token" }             → ログイン中なら { uid, token }（お問い合わせで、返事をアカウントで受け取るため）
// sk-hub.jp とサブドメインは同じサイト（sk-hub.jp）なので、iframe の中でも sk-hub.jp の保存場所がそのまま読める。
// 答えるのは ORIGINS のページだけ。ほかのサイトに埋め込まれても何も渡さない。
//   office.sk-hub.jp（SK Hub Office）は、ログイン中かのヒント（skhub_account）だけを使う（office/shared/office.js）

const ORIGINS = ["https://support.sk-hub.jp", "https://office.sk-hub.jp"];
const PREFS = ["sk_lang", "sk_theme", "sk_analytics", "skhub_terms_accepted", "skhub_terms_notice_shown", "skhub_uuid", "skhub_account"];
const WRITABLE = ["sk_lang", "sk_theme", "sk_analytics", "skhub_terms_accepted", "skhub_terms_notice_shown"];
const WRITE_IF_EMPTY = ["skhub_uuid"];

const read = (key) => { try { return localStorage.getItem(key); } catch (e) { return null; } };

async function answer(msg) {
  if (msg.op === "prefs") {
    const prefs = {};
    PREFS.forEach((key) => { prefs[key] = read(key); });
    return prefs;
  }
  if (msg.op === "set") {
    if (typeof msg.value !== "string" || msg.value.length > 200) return false;
    if (WRITE_IF_EMPTY.includes(msg.key) && read(msg.key)) return false;
    if (!WRITABLE.includes(msg.key) && !WRITE_IF_EMPTY.includes(msg.key)) return false;
    try { localStorage.setItem(msg.key, msg.value); return true; } catch (e) { return false; }
  }
  if (msg.op === "token") {
    if (!read("skhub_account")) return null; // ログインしていなければ Firebase を読み込まない
    const { currentUser } = await import("/assets/hub/account.js");
    const user = await currentUser();
    return user ? { uid: user.uid, token: await user.getIdToken() } : null;
  }
  return null;
}

window.addEventListener("message", async (event) => {
  const msg = event.data;
  if (!ORIGINS.includes(event.origin) || !msg || msg.sk !== "bridge") return;
  let value = null;
  try { value = await answer(msg); } catch (e) { value = null; }
  event.source.postMessage({ sk: "bridge", id: msg.id, value }, event.origin);
});

// 読み込めたことを知らせる（親のページは、これを待ってから聞く）
if (window.parent !== window) ORIGINS.forEach((origin) => window.parent.postMessage({ sk: "bridge", ready: true }, origin));
