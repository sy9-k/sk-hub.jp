// SK Study の読み上げ（ブラウザの音声合成 = Web Speech API）
//   ・言語（lang）だけを指定すると、ブラウザが名前順で最初の声を使うことがある
//     （Mac の Chrome では en-US が「Albert」「Bad News」などのおもしろ音声になる）。なので声を自分で選ぶ
//   ・選び方: 本人が設定で選んだ声 → なければ「いちばんきれいな声」（rank()）
//   ・声の一覧はあとから届くことがある（voiceschanged）。届いたら選び直す
//   ・端末の声のほかに「SK の声」（tts.sk-hub.jp の Worker が Cloudflare AI の MeloTTS で作る mp3）も選べる。
//     設定の声の名前が "sk" のとき。ネットにつながらない・Worker が使えないときは端末の声で読む
//   ・設定は localStorage の sk_study_speech = { auto, rate, voices: { "en-US": 声の名前 or "sk", … } }
//     auto（既定 true）… 外国語の単語が出たとき（問題・答え合わせ・カード）に自動で読み上げる。日本語は読まない
import { tx } from "./i18n.js";
const KEY = "sk_study_speech";

export const supported = "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function";
export const RATES = [[0.7, tx("ゆっくり")], [0.9, tx("ふつう")], [1.1, tx("はやい")]];

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

// SK の声（tts.sk-hub.jp）。対応している言語だけ
const SK_URL = "https://tts.sk-hub.jp/";
const SK_LANGS = ["en-US", "ko-KR", "zh-CN"];
export const SK_VOICES = [["sk", tx("SK の声")]];
export const hasSkVoice = (lang) => SK_LANGS.includes(lang);
export const isSkVoice = (id) => id === "sk";
const skFailed = new Set(); // 使えなかった言語（今回の起動のあいだは端末の声にする）
const skAudio = new Map();  // 取ってきた音声を覚えておく（同じ言葉をすぐ読める）

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
  if (!lang) return false;
  if (hasSkVoice(lang) && isSkVoice(getSettings().voices[lang]) && !skFailed.has(lang)) return true;
  if (!supported) return false;
  // 声の一覧がまだ届いていないブラウザでは、とりあえず話せることにする
  return !voices.length || voicesFor(lang).length > 0;
}

let current = null; // Chrome は話している途中の発話を片づけて止めてしまうことがあるので、参照を持っておく
let skPlayer = null;
function mark(button, on) {
  if (!button) return;
  button.classList.toggle("is-speaking", on);
}
function clearMarks() {
  document.querySelectorAll(".speak.is-speaking").forEach((b) => b.classList.remove("is-speaking"));
}

async function speakSk(text, lang, id, button) {
  const key = `${lang}|${id}|${text}`;
  let blobUrl = skAudio.get(key);
  if (!blobUrl) {
    const q = new URLSearchParams({ l: lang, t: text });
    const res = await fetch(`${SK_URL}?${q}`);
    if (!res.ok) throw new Error(String(res.status));
    blobUrl = URL.createObjectURL(await res.blob());
    skAudio.set(key, blobUrl);
  }
  const a = new Audio(blobUrl);
  a.playbackRate = getSettings().rate;
  const done = () => { if (skPlayer === a) skPlayer = null; mark(button, false); };
  a.addEventListener("ended", done);
  a.addEventListener("error", done);
  skPlayer = a;
  await a.play();
}

function speakDevice(text, lang, button) {
  if (!supported) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text));
  u.lang = lang;
  const voice = pickVoice(lang);
  if (voice) u.voice = voice;
  u.rate = getSettings().rate;
  if (button) {
    mark(button, true);
    const done = () => mark(button, false);
    u.addEventListener("end", done);
    u.addEventListener("error", done);
  }
  current = u;
  // Chrome は cancel() の直後の speak() を落とすことがあるので、少し待つ
  setTimeout(() => { if (current === u) speechSynthesis.speak(u); }, 30);
}

export function speak(text, lang, { button = null } = {}) {
  if (!lang || !text) return;
  stop();
  if (button) { clearMarks(); mark(button, true); }
  const id = getSettings().voices[lang];
  if (hasSkVoice(lang) && isSkVoice(id) && !skFailed.has(lang)) {
    speakSk(String(text), lang, id, button).catch((e) => {
      // ネットや Worker が使えない・ブラウザが再生を止めた → 端末の声で読む
      if (e && e.name === "NotAllowedError") { mark(button, false); return; }
      skFailed.add(lang);
      speakDevice(text, lang, button);
    });
    return;
  }
  speakDevice(text, lang, button);
}

export function stop() {
  current = null;
  if (skPlayer) { skPlayer.pause(); skPlayer = null; }
  if (supported) speechSynthesis.cancel();
  clearMarks();
}
