// SK Study の採点（書き取り）
//   ・答えに「/」「・」「、」があれば、どれか 1 つが合っていれば正解（例: 見る・見える）
//   ・かっこの中（説明）はなくてもよい（例: 遅い（速さが） → 遅い）
//   ・大文字と小文字、全角と半角、前後の空白、最後の「.」「?」などは区別しない
//   ・英語: 動詞の「to」、名詞の「a / an / the」はあってもなくてもよい
//   ・中国語: 漢字のほかにピンインでも答えられる（声調の記号・数字・空白はなくてもよい。ü は u / v でもよい）
//   ・1 文字だけちがうときは「おしい」（正解にはしない。本人が「正解にする」を押せる）

export function normalize(s) {
  return String(s == null ? "" : s)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?。！？、,，…~〜]+$/u, "")
    .trim();
}

// 比べるときは空白と「'」「-」をなくす
const squash = (s) => s.replace(/[\s'\-‐]/g, "");

function alternatives(answer) {
  const full = String(answer || "");
  const parts = full.split(/[\/／;；・、,，]/);
  const out = new Set();
  for (const s of [full, ...parts]) {
    const plain = s.replace(/[（(][^）)]*[）)]/g, "");
    if (normalize(s)) out.add(s);
    if (normalize(plain)) out.add(plain);
  }
  return [...out];
}

function key(s, lang) {
  let v = normalize(s);
  if (lang === "en") v = v.replace(/^(to|a|an|the) /, "");
  return squash(v);
}

function pinyinKey(s) {
  return squash(normalize(s).normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[1-5]/g, "").replace(/v/g, "u"));
}

function distance(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

// 書き取りの採点。target = 正解の文、reading = ピンイン（中国語で、外国語を答えるときだけ）
//   戻り値: { ok: 正解か, close: おしいか }
export function grade(input, target, { lang = "", reading = "" } = {}) {
  const typed = key(input, lang);
  if (!typed) return { ok: false, close: false };
  const keys = alternatives(target).map((a) => key(a, lang)).filter(Boolean);
  if (keys.includes(typed)) return { ok: true, close: false };
  if (reading) {
    const py = pinyinKey(input);
    if (py && alternatives(reading).some((a) => pinyinKey(a) === py)) return { ok: true, close: false };
  }
  const close = keys.some((k) => k.length >= 4 && distance(typed, k) === 1);
  return { ok: false, close };
}

// ヒント（最初の 1 文字と、残りの文字数）
export function hint(target) {
  const first = alternatives(target)[0] || "";
  const plain = first.replace(/[（(][^）)]*[）)]/g, "").trim();
  const chars = [...plain];
  if (chars.length <= 1) return "＿";
  return chars[0] + chars.slice(1).map((c) => (c === " " ? " " : "＿")).join("");
}
