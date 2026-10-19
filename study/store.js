// SK Study のデータ（いまはこのブラウザの中だけに保存する）
//   ・SK の単語セット … sets.json（だれにでも同じものを配る。あとで管理画面から配信できるようにする）
//   ・マイ単語帳 … localStorage の sk_study_sets
//       [{ id: "my-…", title, lang, langName, speech, description, words: [{ w, m, r, ex, exm }], source, from, createdAt, updatedAt }]
//       lang: en / ko / zh / custom（custom のときは langName が言語の名前、speech が読み上げの言語）
//       source: mine（自分で作った）/ copy（SK のセットをコピー）/ shared（共有リンクから追加）
//   ・覚えぐあい … sk_study_progress = { <セットの ID>: { <単語>: { b, due, ok, ng, at } } }
//       b = 箱（0〜6）。正解で 1 つ上がり、間違えると 0 に戻る。箱ごとに次に出すまでの日数（INTERVALS）が長くなる
//       due = 次に出す日（dayNumber() の日数）。due が今日以前のものが「今日の復習」
//   ・クラスで配られた単語帳 … sk_study_class_sets = { "cls-<クラス>-<課題>": { id, source: "class", classRef: { cid, aid, kind }, title, lang, words, … } }
//       課題を開いたときに入れる（マイ単語帳には出さない。覚えぐあいはふつうのセットと同じく記録する）
//   ・学習した日 … sk_study_days = { "2026-10-19": 答えた数 }（続けた日数に使う）
//   SK Hub Systems アカウントへの保存はあとで決める。そのときはこのファイルの読み書きを差しかえる
const SETS_KEY = "sk_study_sets";
const PROGRESS_KEY = "sk_study_progress";
const DAYS_KEY = "sk_study_days";
const PREFS_KEY = "sk_study_prefs";
const CLASS_SETS_KEY = "sk_study_class_sets";

// 箱ごとの、次に出すまでの日数
const INTERVALS = [0, 1, 2, 4, 7, 15, 30];
export const MASTERED_BOX = 4; // この箱まで来たら「覚えた」

export const LANGS = {
  en: { name: "英語", speech: "en-US", reading: "発音（任意）" },
  ko: { name: "韓国語", speech: "ko-KR", reading: "読み（カタカナ・任意）" },
  zh: { name: "中国語", speech: "zh-CN", reading: "ピンイン（任意）" },
  custom: { name: "その他", speech: "", reading: "読み（任意）" }
};
// 「その他」の言語で選べる読み上げ
export const SPEECH_CHOICES = [
  ["", "読み上げない"], ["ja-JP", "日本語"], ["en-US", "英語"], ["ko-KR", "韓国語"], ["zh-CN", "中国語"],
  ["fr-FR", "フランス語"], ["de-DE", "ドイツ語"], ["es-ES", "スペイン語"], ["it-IT", "イタリア語"], ["ru-RU", "ロシア語"]
];

export const LIMITS = { title: 60, description: 200, langName: 20, w: 100, m: 200, r: 100, ex: 300, words: 1000 };

function read(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    return v == null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false; // 容量がいっぱい・保存できないブラウザ
  }
}

// ---------- 日付 ----------

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
// 端末の日付で数えた日数（1970-01-01 = 0）
export function dayNumber(d = new Date()) {
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000);
}

// ---------- 単語セット ----------

let skSets = [];

export async function loadSkSets() {
  const res = await fetch("sets.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`sets.json: ${res.status}`);
  const data = await res.json();
  skSets = (data.sets || []).map((s) => ({ ...s, source: "sk" }));
  return skSets;
}
export const getSkSets = () => skSets;
export const getMySets = () => read(SETS_KEY, []);
export const getClassSets = () => Object.values(read(CLASS_SETS_KEY, {}));
export const allSets = () => [...skSets, ...getMySets(), ...getClassSets()];

// クラスの課題の単語帳を入れる（同じ課題なら入れ直す）
export function cacheClassSet(cid, aid, kind, data, title) {
  const id = `cls-${cid}-${aid}`;
  const set = { ...cleanSet({ ...data, title: data.title || title }), id, source: "class", classRef: { cid, aid, kind }, assignTitle: String(title || "").slice(0, 80) };
  const all = read(CLASS_SETS_KEY, {});
  all[id] = set;
  write(CLASS_SETS_KEY, all);
  return set;
}
export const getSet = (id) => allSets().find((s) => s.id === id) || null;

export function langOf(set) {
  const base = LANGS[set.lang] || LANGS.custom;
  if (set.lang !== "custom") return { key: set.lang, ...base };
  return { key: "custom", name: set.langName || base.name, speech: set.speech || "", reading: base.reading };
}

function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return "my-" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 保存する前に、形と長さをそろえる（共有リンクから来たものもここを通す）
export function cleanSet(input) {
  const str = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
  const lang = LANGS[input.lang] ? input.lang : "custom";
  const words = (Array.isArray(input.words) ? input.words : [])
    .map((x) => ({ w: str(x.w, LIMITS.w), m: str(x.m, LIMITS.m), r: str(x.r, LIMITS.r), ex: str(x.ex, LIMITS.ex), exm: str(x.exm, LIMITS.ex) }))
    .filter((x) => x.w && x.m)
    .slice(0, LIMITS.words)
    .map((x) => Object.fromEntries(Object.entries(x).filter(([, v]) => v)));
  const set = {
    title: str(input.title, LIMITS.title) || "名前のない単語帳",
    lang,
    description: str(input.description, LIMITS.description),
    words
  };
  if (lang === "custom") {
    set.langName = str(input.langName, LIMITS.langName);
    const speech = String(input.speech || "");
    set.speech = SPEECH_CHOICES.some(([v]) => v === speech) ? speech : "";
  }
  return set;
}

export function saveMySet(input, id = null) {
  const sets = getMySets();
  const now = Date.now();
  const i = id ? sets.findIndex((s) => s.id === id) : -1;
  const clean = cleanSet(input);
  let set;
  if (i >= 0) {
    set = { ...sets[i], ...clean, updatedAt: now };
    if (clean.lang !== "custom") { delete set.langName; delete set.speech; }
    sets[i] = set;
  } else {
    set = { id: newId(), ...clean, source: input.source || "mine", createdAt: now, updatedAt: now };
    if (input.from) set.from = String(input.from).slice(0, LIMITS.title);
    sets.push(set);
  }
  if (!write(SETS_KEY, sets)) throw new Error("保存できませんでした（ブラウザの保存容量がいっぱいかもしれません）");
  return set;
}

export function deleteMySet(id) {
  write(SETS_KEY, getMySets().filter((s) => s.id !== id));
  const progress = read(PROGRESS_KEY, {});
  delete progress[id];
  write(PROGRESS_KEY, progress);
}

// SK のセットを自分用にコピーする（覚えぐあいも引きつぐ）
export function copySet(set) {
  const copy = saveMySet({ ...set, source: "copy", from: set.title, title: set.title });
  const progress = read(PROGRESS_KEY, {});
  if (progress[set.id]) {
    progress[copy.id] = JSON.parse(JSON.stringify(progress[set.id]));
    write(PROGRESS_KEY, progress);
  }
  return copy;
}

// ---------- 覚えぐあい ----------

export function progressOf(setId) {
  return read(PROGRESS_KEY, {})[setId] || {};
}

// new（未学習）/ weak（弱点 = 最後にまちがえた）/ learning（記憶中）/ mastered（記憶済み）
export function statusOf(rec) {
  if (!rec) return "new";
  if (rec.b >= MASTERED_BOX) return "mastered";
  return rec.b === 0 && rec.ng > 0 ? "weak" : "learning";
}

// 単語の記憶度（0〜1）。箱の位置で決める
export function levelOf(rec) {
  return rec ? Math.min(rec.b, MASTERED_BOX) / MASTERED_BOX : 0;
}

export function setStats(set) {
  const p = progressOf(set.id);
  const today = dayNumber();
  const stats = { total: set.words.length, new: 0, weak: 0, learning: 0, mastered: 0, due: 0, memory: 0 };
  let level = 0;
  for (const word of set.words) {
    const rec = p[word.w];
    stats[statusOf(rec)]++;
    level += levelOf(rec);
    if (rec && rec.due <= today) stats.due++;
  }
  // 記憶度（%）= 単語ごとの記憶度の平均
  stats.memory = stats.total ? Math.round((level / stats.total) * 100) : 0;
  stats.started = stats.total - stats.new;
  return stats;
}

// 答えを記録する。ok = 正解か
//   その日にもう出し終えた単語（due が明日以降）は、正解しても箱を上げない（同じ日に何度も答えて「覚えた」にならないように）
export function recordAnswer(setId, word, ok) {
  const progress = read(PROGRESS_KEY, {});
  const p = progress[setId] || (progress[setId] = {});
  const today = dayNumber();
  const rec = p[word] || { b: 0, due: today, ok: 0, ng: 0 };
  if (ok) {
    rec.ok++;
    if (!p[word] || rec.due <= today) {
      rec.b = Math.min(rec.b + 1, INTERVALS.length - 1);
      rec.due = today + INTERVALS[rec.b];
    }
  } else {
    rec.ng++;
    rec.b = 0;
    rec.due = today;
  }
  rec.at = Date.now();
  p[word] = rec;
  write(PROGRESS_KEY, progress);

  const days = read(DAYS_KEY, {});
  const key = localDate();
  days[key] = (days[key] || 0) + 1;
  // 古い記録は 400 日で消す
  const keys = Object.keys(days).sort();
  while (keys.length > 400) delete days[keys.shift()];
  write(DAYS_KEY, days);
  return rec;
}

// 今日の復習（due が今日以前の単語）。[{ set, word }]
export function dueItems() {
  const progress = read(PROGRESS_KEY, {});
  const today = dayNumber();
  const items = [];
  for (const set of allSets()) {
    const p = progress[set.id];
    if (!p) continue;
    for (const word of set.words) {
      const rec = p[word.w];
      if (rec && rec.due <= today) items.push({ set, word, rec });
    }
  }
  // 苦手なもの（箱が小さい・間違いが多い）から
  items.sort((a, b) => a.rec.b - b.rec.b || b.rec.ng - a.rec.ng);
  return items;
}

export function overall() {
  const progress = read(PROGRESS_KEY, {});
  let mastered = 0, learned = 0;
  for (const set of allSets()) {
    const p = progress[set.id];
    if (!p) continue;
    for (const word of set.words) {
      const rec = p[word.w];
      if (!rec) continue;
      learned++;
      if (rec.b >= MASTERED_BOX) mastered++;
    }
  }
  // 続けた日数（今日まだなら昨日まで）
  const days = read(DAYS_KEY, {});
  let streak = 0;
  const d = new Date();
  if (!days[localDate(d)]) d.setDate(d.getDate() - 1);
  while (days[localDate(d)]) { streak++; d.setDate(d.getDate() - 1); }
  return { mastered, learned, streak, today: days[localDate()] || 0 };
}

// ---------- 小テストの記録 ----------
//   sk_study_tests = [{ setId, at, ok, total }]（新しいものが後ろ。200 件まで）

const TESTS_KEY = "sk_study_tests";
export function recordTest(setId, ok, total) {
  const list = read(TESTS_KEY, []);
  list.push({ setId, at: Date.now(), ok, total });
  while (list.length > 200) list.shift();
  write(TESTS_KEY, list);
}
export function testsOf(setId) {
  return read(TESTS_KEY, []).filter((t) => t.setId === setId);
}

// ---------- 設定（問題の数・形式など） ----------
//   format: auto（難易度に合わせて 4 択と書き取りをまぜる）/ choice（4 択だけ）/ write（書き取りだけ）

export const getPrefs = () => ({ count: 10, format: "auto", filter: "all", ...read(PREFS_KEY, {}) });
export function setPrefs(patch) {
  write(PREFS_KEY, { ...getPrefs(), ...patch });
}
