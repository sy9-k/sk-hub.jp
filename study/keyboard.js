// SK Study の書き取りの入力（パソコンの日本語入力の「変換」が出ないように、アプリの中で文字を作る）
//   latin  … アルファベットの画面内キーボード（英語・中国語のピンイン・アルファベットのその他の言語）
//   hangul … ハングルの画面内キーボード（2 ボル式）。字母を組み立てて 1 文字にする（compose()）
//   tiles  … 答えの文字と、まぎらわしい文字を並べて、順に押す（日本語で答えるときなど）
//   入力欄（<input>）を使わないので、パソコンのキーで打っても日本語入力は動かない。
//   latin は e.key の文字、hangul は e.code（キーの場所）を 2 ボル式の字母に読みかえる
//   createInput() の戻り値: { el, value(), focus(), disable(), destroy() }。destroy() でキーの見張りをやめる

// ---------- ハングルの組み立て ----------
const CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
const JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
const JONG = ["", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
const VOWEL_PAIRS = { "ㅗㅏ": "ㅘ", "ㅗㅐ": "ㅙ", "ㅗㅣ": "ㅚ", "ㅜㅓ": "ㅝ", "ㅜㅔ": "ㅞ", "ㅜㅣ": "ㅟ", "ㅡㅣ": "ㅢ" };
const FINAL_PAIRS = { "ㄱㅅ": "ㄳ", "ㄴㅈ": "ㄵ", "ㄴㅎ": "ㄶ", "ㄹㄱ": "ㄺ", "ㄹㅁ": "ㄻ", "ㄹㅂ": "ㄼ", "ㄹㅅ": "ㄽ", "ㄹㅌ": "ㄾ", "ㄹㅍ": "ㄿ", "ㄹㅎ": "ㅀ", "ㅂㅅ": "ㅄ" };
const SPLIT_FINAL = Object.fromEntries(Object.entries(FINAL_PAIRS).map(([k, v]) => [v, [...k]]));
const SPLIT_VOWEL = Object.fromEntries(Object.entries(VOWEL_PAIRS).map(([k, v]) => [v, [...k]]));
const isVowel = (j) => JUNG.includes(j);

// 2 ボル式（キーの場所 → 字母）。Shift で濃音など
const HANGUL_KEYS = {
  KeyQ: "ㅂ", KeyW: "ㅈ", KeyE: "ㄷ", KeyR: "ㄱ", KeyT: "ㅅ", KeyY: "ㅛ", KeyU: "ㅕ", KeyI: "ㅑ", KeyO: "ㅐ", KeyP: "ㅔ",
  KeyA: "ㅁ", KeyS: "ㄴ", KeyD: "ㅇ", KeyF: "ㄹ", KeyG: "ㅎ", KeyH: "ㅗ", KeyJ: "ㅓ", KeyK: "ㅏ", KeyL: "ㅣ",
  KeyZ: "ㅋ", KeyX: "ㅌ", KeyC: "ㅊ", KeyV: "ㅍ", KeyB: "ㅠ", KeyN: "ㅜ", KeyM: "ㅡ"
};
const HANGUL_SHIFT = { KeyQ: "ㅃ", KeyW: "ㅉ", KeyE: "ㄸ", KeyR: "ㄲ", KeyT: "ㅆ", KeyO: "ㅒ", KeyP: "ㅖ" };
const HANGUL_ROWS = [["KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP"], ["KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL"], ["KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM"]];
const LATIN_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

// 組み立て中の 1 文字 { cho, jung, jong } と、できあがった文字 text
export function createHangul() {
  let text = "";
  let s = { cho: "", jung: "", jong: "" };
  const syllable = () => {
    if (s.cho && s.jung) return String.fromCharCode(0xac00 + (CHO.indexOf(s.cho) * 21 + JUNG.indexOf(s.jung)) * 28 + JONG.indexOf(s.jong));
    return s.cho || s.jung || "";
  };
  const commit = () => { text += syllable(); s = { cho: "", jung: "", jong: "" }; };
  return {
    value: () => text + syllable(),
    input(j) {
      if (isVowel(j)) {
        if (s.jong) {
          // 終わりの子音を、次の文字の始めに移す（합 + ㅏ → 하바）
          const split = SPLIT_FINAL[s.jong];
          const move = split ? split[1] : s.jong;
          s.jong = split ? split[0] : "";
          commit();
          s = { cho: CHO.includes(move) ? move : "", jung: j, jong: "" };
          if (!s.cho) { text += move; }
        } else if (s.jung) {
          const pair = VOWEL_PAIRS[s.jung + j];
          if (pair && s.cho) s.jung = pair;
          else { commit(); s.jung = j; }
        } else {
          s.jung = j;
        }
      } else {
        if (!s.cho && !s.jung) s.cho = j;
        else if (s.cho && !s.jung) { commit(); s.cho = j; }
        else if (!s.cho && s.jung) { commit(); s.cho = j; }
        else if (!s.jong) {
          if (JONG.includes(j) && !"ㄸㅃㅉ".includes(j)) s.jong = j;
          else { commit(); s.cho = j; }
        } else {
          const pair = FINAL_PAIRS[s.jong + j];
          if (pair) s.jong = pair;
          else { commit(); s.cho = j; }
        }
      }
    },
    space() { commit(); text += " "; },
    back() {
      if (s.jong) { const sp = SPLIT_FINAL[s.jong]; s.jong = sp ? sp[0] : ""; }
      else if (s.jung) { const sp = SPLIT_VOWEL[s.jung]; s.jung = sp ? sp[0] : ""; }
      else if (s.cho) s.cho = "";
      else text = text.slice(0, -1);
    },
    clear() { text = ""; s = { cho: "", jung: "", jong: "" }; }
  };
}

// ---------- 文字を選ぶ ----------
function graphemes(str) {
  if (typeof Intl !== "undefined" && Intl.Segmenter) return [...new Intl.Segmenter("ja", { granularity: "grapheme" }).segment(str)].map((x) => x.segment);
  return [...str];
}
// 答え（「・」「/」で区切った最初のもの。かっこの中は除く）
export function tileTarget(answer) {
  const first = String(answer || "").split(/[\/／;；・、,，]/)[0] || "";
  return first.replace(/[（(][^）)]*[）)]/g, "").trim();
}
function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- 入力の部品 ----------
// opts: { h, icon, mode: latin|hangul|tiles, answer（tiles の答え）, pool（まぎらわしい文字を取る言葉の一覧）, placeholder, lang, onSubmit(value) }
export function createInput(opts) {
  const { h, icon, mode, onSubmit } = opts;
  let disabled = false;
  const display = h("div", { class: "vk-display", role: "textbox", "aria-readonly": "true", "aria-label": "答え", tabindex: "0", lang: opts.lang || null });
  const wrap = h("div", { class: `vk vk-${mode}` }, display);
  const submitBtn = h("button", { type: "button", class: "filled-btn vk-ok" }, icon("check"), h("span", null, "確定"));
  submitBtn.addEventListener("click", () => submit());

  let get, back, clear, render;
  if (mode === "tiles") {
    const target = graphemes(tileTarget(opts.answer));
    const decoys = shuffle([...new Set((opts.pool || []).flatMap((w) => graphemes(tileTarget(w))).filter((c) => c.trim() && !target.includes(c)))])
      .slice(0, Math.min(6, Math.max(3, Math.ceil(target.length / 2))));
    const tiles = shuffle([...target.map((c, i) => ({ c, id: `a${i}` })), ...decoys.map((c, i) => ({ c, id: `d${i}` }))]);
    let picked = [];
    const tileEls = tiles.map((t) => {
      const b = h("button", { type: "button", class: "vk-tile", lang: opts.lang || null }, t.c === " " ? "␣" : t.c);
      b.addEventListener("click", () => { if (disabled || picked.includes(t)) return; picked.push(t); render(); });
      return { t, b };
    });
    get = () => picked.map((t) => t.c).join("");
    back = () => { picked.pop(); };
    clear = () => { picked = []; };
    render = () => {
      display.replaceChildren(...(picked.length ? picked.map((t) => h("span", { class: "vk-chip" }, t.c)) : [h("span", { class: "vk-placeholder" }, opts.placeholder || "下の文字を順に押してください")]));
      tileEls.forEach(({ t, b }) => { b.disabled = disabled || picked.includes(t); });
    };
    wrap.append(h("div", { class: "vk-tiles" }, tileEls.map((x) => x.b)));
  } else {
    const hangul = mode === "hangul" ? createHangul() : null;
    let text = "";
    get = () => (hangul ? hangul.value() : text);
    const type = (ch) => { if (hangul) hangul.input(ch); else text += ch; };
    const space = () => { if (hangul) hangul.space(); else text += " "; };
    back = () => { if (hangul) hangul.back(); else text = text.slice(0, -1); };
    clear = () => { if (hangul) hangul.clear(); else text = ""; };
    render = () => {
      const v = get();
      // 最後の 1 文字だけ別にして、打ったときにポンと出す
      const chars = [...v];
      const last = chars.pop();
      display.replaceChildren(
        v ? h("span", { class: "vk-text" }, chars.join(""), h("span", { class: "vk-last" }, last)) : h("span", { class: "vk-placeholder" }, opts.placeholder || ""),
        h("span", { class: "vk-caret", "aria-hidden": "true" }));
    };
    let shift = false;
    const keyBtn = (label, onPress, cls = "") => {
      const b = h("button", { type: "button", class: `vk-key ${cls}`.trim() }, label);
      b.addEventListener("mousedown", (e) => e.preventDefault()); // 押してもフォーカスを動かさない
      b.addEventListener("click", () => { if (disabled) return; onPress(); render(); });
      return b;
    };
    const rows = h("div", { class: "vk-rows" });
    const drawKeys = () => {
      const keyRows = hangul
        ? HANGUL_ROWS.map((row) => row.map((code) => { const j = (shift && HANGUL_SHIFT[code]) || HANGUL_KEYS[code]; return keyBtn(j, () => { type(j); if (shift) { shift = false; drawKeys(); } }); }))
        : LATIN_ROWS.map((row) => [...row].map((c) => keyBtn(c, () => type(c))));
      if (hangul) keyRows[2].unshift(keyBtn("⇧", () => { shift = !shift; drawKeys(); }, `vk-wide${shift ? " is-on" : ""}`));
      else keyRows[2].push(keyBtn("'", () => type("'")), keyBtn("-", () => type("-")));
      keyRows[2].push(keyBtn(icon("backspace"), () => back(), "vk-wide"));
      rows.replaceChildren(
        ...keyRows.map((r) => h("div", { class: "vk-row" }, r)),
        h("div", { class: "vk-row" }, keyBtn("スペース", () => space(), "vk-space")));
    };
    drawKeys();
    wrap.append(rows);
    // パソコンのキー（入力欄ではないので、日本語入力の変換は出ない）
    opts._type = type;
    opts._space = space;
    opts._hangul = !!hangul;
  }
  wrap.append(h("div", { class: "vk-actions" },
    h("button", { type: "button", class: "text-btn", onclick: () => { if (!disabled) { clear(); render(); } } }, icon("backspace"), h("span", null, "消す")),
    submitBtn));

  function submit() {
    if (disabled) return;
    const v = get().trim();
    if (!v) { display.classList.add("is-shake"); setTimeout(() => display.classList.remove("is-shake"), 400); return; }
    onSubmit(v);
  }

  const onKey = (e) => {
    if (disabled || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const t = e.target;
    if (t && t.closest && t.closest("input, textarea, select, dialog")) return;
    if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); submit(); return; }
    if (e.key === "Backspace") { e.preventDefault(); back(); render(); return; }
    if (mode === "tiles") return;
    if (e.key === " " || e.code === "Space") { e.preventDefault(); opts._space(); render(); return; }
    if (opts._hangul) {
      const j = (e.shiftKey && HANGUL_SHIFT[e.code]) || HANGUL_KEYS[e.code];
      if (j) { e.preventDefault(); opts._type(j); render(); }
    } else if (/^[a-zA-Z'\-]$/.test(e.key) || (/^Key[A-Z]$/.test(e.code) && e.key === "Process")) {
      // 日本語入力がオンでも e.code から文字を取る
      const ch = e.key === "Process" ? e.code.slice(3).toLowerCase() : e.key;
      e.preventDefault();
      opts._type(ch);
      render();
    }
  };
  document.addEventListener("keydown", onKey, true);
  render();

  return {
    el: wrap,
    value: get,
    focus: () => display.focus({ preventScroll: true }),
    disable() { disabled = true; wrap.classList.add("is-disabled"); render(); submitBtn.hidden = true; },
    destroy() { document.removeEventListener("keydown", onKey, true); }
  };
}

// どの入力にするか。pref: auto（画面内キーボード。できないときは文字を選ぶ）/ tiles / keyboard
//   answerLang: ja（日本語で答える）/ en / ko / zh / custom
export function chooseMode(pref, answerLang, answer) {
  if (pref === "keyboard") return "keyboard";
  if (pref === "tiles") return "tiles";
  if (answerLang === "en" || answerLang === "zh") return "latin";
  if (answerLang === "ko") return "hangul";
  if (answerLang === "custom" && /^[\x20-\x7e]+$/.test(tileTarget(answer))) return "latin";
  return "tiles";
}
