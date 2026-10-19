// SK Study の読み上げ（ブラウザの音声合成 = Web Speech API）
//   ・言語（lang）だけを指定すると、ブラウザが名前順で最初の声を使うことがある
//     （Mac の Chrome では en-US が「Albert」「Bad News」などのおもしろ音声になる）。なので声を自分で選ぶ
//   ・選び方: 本人が設定で選んだ声 → なければ「いちばんきれいな声」（rank()）
//   ・声の一覧はあとから届くことがある（voiceschanged）。届いたら選び直す
//   ・設定は localStorage の sk_study_speech = { auto, rate, voices: { "en-US": 声の名前, … } }
//     auto（既定 true）… 外国語の単語が出たとき（問題・答え合わせ・カード）に自動で読み上げる。日本語は読まない
const KEY = "sk_study_speech";

export const supported = "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
export const RATES = [[0.7, "ゆっくり"], [0.9, "ふつう"], [1.1, "はやい"]];

// 使わない声（効果音のような声・古い声）。名前の一部でも当てはまれば外す
const NOVELTY = /albert|bad news|bahh|bells?|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior|organ|ralph|superstar|trinoids|whisper|wobble|zarvox|fred|grandma|grandpa|rocko|ささやき|オルガン|スーパースター|トリノイド|ベル|道化|震え|おばあさん|おじいさん/i;
// よい声のしるし（大きいほど優先）
const GOOD = [
  [/natural|neural|online/i, 60],          // Edge の「Microsoft … Online (Natural)」
  [/premium|enhanced|拡張|プレミアム/i, 50], // Mac・iPhone で追加でダウンロードした声
  [/siri/i, 45],
  [/^google/i, 40],                         // Chrome の Google の声（ネットにつながっているとき）
  [/samantha|alex|ava|allison|susan|zoe|yuna|sora|ting-?ting|tian-?tian|li-?mu|kyoko|otoya|daniel|karen/i, 30]
];

let voices = [];
const listeners = new Set();

function loadVoices() {
  if (!supported) return;
  voices = speechSynthesis.getVoices();
  listeners.forEach((fn) => fn());
}
if (supported) {
  loadVoices();
  speechSynthesis.addEventListener("voiceschanged", loadVoices);
}
export function onVoicesChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { /* 既定のまま */ }
  return { auto: true, rate: 0.9, voices: {}, ...s };
}
export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { /* 保存できなくても動く */ }
  return next;
}

const base = (lang) => String(lang || "").toLowerCase().split(/[-_]/)[0];
function sameLang(voice, lang) {
  const v = voice.lang.toLowerCase().replace("_", "-");
  const l = lang.toLowerCase();
  if (base(v) !== base(l)) return false;
  // 中国語は 普通話（zh-CN）と台湾・香港を分ける
  if (base(l) === "zh") return /cn|hans/.test(l) ? !/tw|hk|hant/.test(v) : true;
  return true;
}
function rank(voice, lang) {
  let score = 0;
  if (voice.lang.replace("_", "-").toLowerCase() === lang.toLowerCase()) score += 20;
  for (const [re, pts] of GOOD) if (re.test(voice.name)) { score += pts; break; }
  if (voice.localService) score += 5; // ネットがなくても話せる
  if (voice.default) score += 2;
  return score;
}

// その言語で使える声（よい順）。おもしろ音声は外す
export function voicesFor(lang) {
  return voices
    .filter((v) => sameLang(v, lang) && !NOVELTY.test(v.name))
    .sort((a, b) => rank(b, lang) - rank(a, lang));
}

export function pickVoice(lang) {
  const chosen = getSettings().voices[lang];
  const list = voicesFor(lang);
  return (chosen && list.find((v) => v.name === chosen)) || list[0] || null;
}

export function canSpeak(lang) {
  if (!supported || !lang) return false;
  // 声の一覧がまだ届いていないブラウザでは、とりあえず話せることにする
  return !voices.length || voicesFor(lang).length > 0;
}

let current = null; // Chrome は話している途中の発話を片づけて止めてしまうことがあるので、参照を持っておく
export function speak(text, lang, { button = null } = {}) {
  if (!supported || !lang || !text) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text));
  u.lang = lang;
  const voice = pickVoice(lang);
  if (voice) u.voice = voice;
  u.rate = getSettings().rate;
  if (button) {
    document.querySelectorAll(".speak.is-speaking").forEach((b) => b.classList.remove("is-speaking"));
    button.classList.add("is-speaking");
    const done = () => button.classList.remove("is-speaking");
    u.addEventListener("end", done);
    u.addEventListener("error", done);
  }
  current = u;
  // Chrome は cancel() の直後の speak() を落とすことがあるので、少し待つ
  setTimeout(() => { if (current === u) speechSynthesis.speak(u); }, 30);
}

export function stop() {
  if (!supported) return;
  current = null;
  speechSynthesis.cancel();
  document.querySelectorAll(".speak.is-speaking").forEach((b) => b.classList.remove("is-speaking"));
}
