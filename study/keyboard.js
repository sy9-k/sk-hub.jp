// SK Study の画面のキーボード（書き取りの問題で、端末のキーボードのかわりに画面に出す）
//   ・英語: アルファベット + ' - 空白
//   ・韓国語: ハングル（2 ベolsik。キーを押した順に、音節へ組み立てる。Shift で ㄲ ㅃ ㅆ ㅉ ㄸ ㅒ ㅖ）
//   ・中国語: ピンイン（ü のキーつき。採点はピンインでも正解にする）
//   日本語を答える問題は、かな漢字変換が要るので、このキーボードでは答えられない（出題のほうで外国語を答える形にする）
export const KEYBOARD_LANGS = ["en", "ko", "zh"];

// ---------- ハングルの組み立て ----------
const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const JUNG = ["ㅏ", "ㅐ", "ㅑ", "ㅒ", "ㅓ", "ㅔ", "ㅕ", "ㅖ", "ㅗ", "ㅘ", "ㅙ", "ㅚ", "ㅛ", "ㅜ", "ㅝ", "ㅞ", "ㅟ", "ㅠ", "ㅡ", "ㅢ", "ㅣ"];
const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const COMP_V = { "ㅗㅏ": "ㅘ", "ㅗㅐ": "ㅙ", "ㅗㅣ": "ㅚ", "ㅜㅓ": "ㅝ", "ㅜㅔ": "ㅞ", "ㅜㅣ": "ㅟ", "ㅡㅣ": "ㅢ" };
const COMP_F = { "ㄱㅅ": "ㄳ", "ㄴㅈ": "ㄵ", "ㄴㅎ": "ㄶ", "ㄹㄱ": "ㄺ", "ㄹㅁ": "ㄻ", "ㄹㅂ": "ㄼ", "ㄹㅅ": "ㄽ", "ㄹㅌ": "ㄾ", "ㄹㅍ": "ㄿ", "ㄹㅎ": "ㅀ", "ㅂㅅ": "ㅄ" };
const SPLIT_F = Object.fromEntries(Object.entries(COMP_F).map(([k, v]) => [v, [k[0], k[1]]]));
const isVowel = (j) => JUNG.includes(j);
const isJamo = (j) => CHO.includes(j) || JUNG.includes(j) || JONG.includes(j);

// jamo の並び（押した順）→ 文字列。ハングルでない文字（空白や、物理キーボードで打った完成形の文字）はそのまま
export function assemble(list) {
  let out = "";
  let c = null, v = null, f = null;
  const flush = () => {
    if (c !== null && v !== null) {
      out += String.fromCharCode(0xac00 + (CHO.indexOf(c) * 21 + JUNG.indexOf(v)) * 28 + JONG.indexOf(f || ""));
    } else out += (c || "") + (v || "") + (f || "");
    c = v = f = null;
  };
  for (const j of list) {
    if (!isJamo(j)) { flush(); out += j; continue; }
    if (isVowel(j)) {
      if (v === null) v = j;
      else if (f === null) {
        const comb = COMP_V[v + j];
        if (comb) v = comb; else { flush(); v = j; }
      } else {
        // 終声は、あとの母音のはじめの子音になる
        let move;
        if (SPLIT_F[f]) { move = SPLIT_F[f][1]; f = SPLIT_F[f][0]; } else { move = f; f = null; }
        flush();
        c = move; v = j;
      }
    } else if (c === null && v === null) {
      c = j;
    } else if (v === null) {
      flush(); c = j;
    } else if (f === null) {
      if (JONG.includes(j) && j !== "") f = j; else { flush(); c = j; }
    } else {
      const comb = COMP_F[f + j];
      if (comb) f = comb; else { flush(); c = j; }
    }
  }
  flush();
  return out;
}

// ---------- 配列 ----------
const QWERTY = [["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"], ["a", "s", "d", "f", "g", "h", "j", "k", "l"], ["z", "x", "c", "v", "b", "n", "m"]];
const HANGUL = [["ㅂ", "ㅈ", "ㄷ", "ㄱ", "ㅅ", "ㅛ", "ㅕ", "ㅑ", "ㅐ", "ㅔ"], ["ㅁ", "ㄴ", "ㅇ", "ㄹ", "ㅎ", "ㅗ", "ㅓ", "ㅏ", "ㅣ"], ["ㅋ", "ㅌ", "ㅊ", "ㅍ", "ㅠ", "ㅜ", "ㅡ"]];
const HANGUL_SHIFT = { ㅂ: "ㅃ", ㅈ: "ㅉ", ㄷ: "ㄸ", ㄱ: "ㄲ", ㅅ: "ㅆ", ㅐ: "ㅒ", ㅔ: "ㅖ" };

// 画面のキーボードを作る。input に打ち込む（touch のとき、端末のキーボードは出さない）
//   戻り値: { el, destroy }  el は画面の下に置く要素
export function createKeyboard({ h, lang, input, onEnter, touch }) {
  const ko = lang === "ko";
  let list = [...input.value];
  let shift = false;
  const root = h("div", { class: `kbd kbd-${lang}`, role: "group", "aria-label": "画面のキーボード", lang: ko ? "ko" : "en" });
  if (touch) { input.readOnly = true; input.setAttribute("inputmode", "none"); }

  const sync = () => { input.value = ko ? assemble(list) : list.join(""); };
  const push = (ch) => { list.push(ch); if (shift) { shift = false; draw(); } sync(); };
  const back = () => { list.pop(); sync(); };
  // 物理キーボードで打ったときは、いまの文字をそのまま土台にする
  input.addEventListener("input", () => { list = [...input.value]; });

  const key = (label, onpress, cls = "", aria = "") => h("button", {
    type: "button", class: `kbd-key ${cls}`.trim(), "aria-label": aria || label,
    // 押したときに入力欄からフォーカスが外れないように
    onpointerdown: (e) => e.preventDefault(),
    onclick: onpress
  }, label);

  function draw() {
    const rows = (ko ? HANGUL : QWERTY).map((row, i) => h("div", { class: "kbd-row" },
      i === 2 && ko ? key("⇧", () => { shift = !shift; draw(); }, `kbd-wide${shift ? " is-on" : ""}`, "シフト") : null,
      row.map((k) => { const shown = ko && shift && HANGUL_SHIFT[k] ? HANGUL_SHIFT[k] : k; return key(shown, () => push(shown)); }),
      i === 2 ? key("⌫", back, "kbd-wide", "ひとつ消す") : null));
    const bottom = h("div", { class: "kbd-row" },
      ko ? null : key("'", () => push("'")),
      ko ? null : key("-", () => push("-")),
      lang === "zh" ? key("ü", () => push("ü")) : null,
      key("空白", () => push(" "), "kbd-space", "空白"),
      key("確定", () => onEnter(), "kbd-enter", "答えを確定"));
    root.replaceChildren(...rows, bottom);
  }
  draw();
  return { el: root, destroy() { root.remove(); } };
}
