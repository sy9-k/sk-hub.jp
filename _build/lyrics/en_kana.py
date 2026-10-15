#!/usr/bin/env python3
"""英語の歌詞に付けるカタカナの読み（lyrics/en-kana.txt）を作る。

CMU Pronouncing Dictionary（https://github.com/cmusphinx/cmudict の cmudict.dict と LICENSE）の
発音記号を、日本語のカタカナの読み方に置き換える。Lyrics Flow のカラオケで、英語の歌詞の上に付ける。

    python _build/lyrics/en_kana.py path/to/cmudict.dict path/to/LICENSE

出力は「単語<TAB>カタカナ」の行。先頭の # の行は CMU の著作権表示とライセンス（再配布の条件）。
"""
import re
import sys
from pathlib import Path

VOWELS = {"AA", "AE", "AH", "AO", "AW", "AY", "EH", "ER", "EY", "IH", "IY", "OW", "OY", "UH", "UW"}

# 子音の行ごとに、母音 a i u e o のカナ
ROW = {
    "":   ["ア", "イ", "ウ", "エ", "オ"],
    "K":  ["カ", "キ", "ク", "ケ", "コ"],
    "G":  ["ガ", "ギ", "グ", "ゲ", "ゴ"],
    "S":  ["サ", "シ", "ス", "セ", "ソ"],
    "Z":  ["ザ", "ジ", "ズ", "ゼ", "ゾ"],
    "TH": ["サ", "シ", "ス", "セ", "ソ"],
    "DH": ["ザ", "ディ", "ズ", "ゼ", "ゾ"],
    "SH": ["シャ", "シ", "シュ", "シェ", "ショ"],
    "ZH": ["ジャ", "ジ", "ジュ", "ジェ", "ジョ"],
    "JH": ["ジャ", "ジ", "ジュ", "ジェ", "ジョ"],
    "CH": ["チャ", "チ", "チュ", "チェ", "チョ"],
    "T":  ["タ", "ティ", "トゥ", "テ", "ト"],
    "D":  ["ダ", "ディ", "ドゥ", "デ", "ド"],
    "N":  ["ナ", "ニ", "ヌ", "ネ", "ノ"],
    "HH": ["ハ", "ヒ", "フ", "ヘ", "ホ"],
    "F":  ["ファ", "フィ", "フ", "フェ", "フォ"],
    "V":  ["ヴァ", "ヴィ", "ヴ", "ヴェ", "ヴォ"],
    "M":  ["マ", "ミ", "ム", "メ", "モ"],
    "Y":  ["ヤ", "イ", "ユ", "イェ", "ヨ"],
    "R":  ["ラ", "リ", "ル", "レ", "ロ"],
    "L":  ["ラ", "リ", "ル", "レ", "ロ"],
    "W":  ["ワ", "ウィ", "ウ", "ウェ", "ウォ"],
    "P":  ["パ", "ピ", "プ", "ペ", "ポ"],
    "B":  ["バ", "ビ", "ブ", "ベ", "ボ"],
    "NG": ["ンガ", "ンギ", "ング", "ンゲ", "ンゴ"],
}
# 「キ」「シ」などのあとに付けて、ャュョにする（子音 + Y + 母音。music → ミュージック）
SMALL_Y = {0: "ャ", 2: "ュ", 3: "ェ", 4: "ョ"}
# 母音のあとに子音だけが来たとき
CODA = {
    "K": "ク", "G": "グ", "P": "プ", "B": "ブ", "F": "フ", "V": "ヴ", "S": "ス", "Z": "ズ", "TH": "ス", "DH": "ズ",
    "SH": "シュ", "ZH": "ジュ", "CH": "チ", "JH": "ジ", "T": "ト", "D": "ド", "M": "ム", "N": "ン", "NG": "ング",
    "L": "ル", "HH": "", "W": "ウ", "Y": "イ",
}
# 母音 → (列, 後ろに付けるもの)。"long" は強く読むか語末のときだけ「ー」
VOWEL = {
    "AA": (0, ""), "AE": (0, ""), "AH": (0, ""), "AO": (4, "long"), "AW": (0, "ウ"), "AY": (0, "イ"),
    "EH": (3, ""), "ER": (0, "ー"), "EY": (3, "イ"), "IH": (1, ""), "IY": (1, "long"), "OW": (4, "long"),
    "OY": (4, "イ"), "UH": (2, ""), "UW": (2, "long"),
}
SHORT = {"AE", "AH", "EH", "IH", "AA", "UH"}       # 後ろの子音で「ッ」が入る短い母音
GEM = {"K", "P", "T", "CH", "SH", "D", "G", "JH"}  # 「ッ」が入る子音

# よく出る言葉は、日本でふつうに書く読みに
OVERRIDE = {
    "a": "ア", "the": "ザ", "i": "アイ", "you": "ユー", "and": "アンド", "to": "トゥ", "my": "マイ", "your": "ユア",
    "oh": "オー", "ooh": "ウー", "yeah": "イェー", "hey": "ヘイ", "baby": "ベイビー", "love": "ラヴ", "don't": "ドント",
    "won't": "ウォント", "want": "ウォント", "can't": "キャント", "it's": "イッツ", "i'm": "アイム", "you're": "ユア",
    "we're": "ウィア", "they're": "ゼア", "i'll": "アイル", "i've": "アイヴ", "every": "エヴリ", "everything": "エヴリシング",
    "everybody": "エヴリバディ", "together": "トゥゲザー", "tonight": "トゥナイト", "today": "トゥデイ", "tomorrow": "トゥモロー",
    "forever": "フォーエヴァー", "never": "ネヴァー", "only": "オンリー", "really": "リアリー", "one": "ワン", "go": "ゴー",
    "know": "ノウ", "so": "ソー", "no": "ノー", "more": "モア", "world": "ワールド", "girl": "ガール", "boy": "ボーイ",
    "heart": "ハート", "night": "ナイト", "dream": "ドリーム", "is": "イズ", "in": "イン", "on": "オン", "of": "オヴ",
    "for": "フォー", "with": "ウィズ", "be": "ビー", "me": "ミー", "we": "ウィー", "he": "ヒー", "she": "シー",
    "it": "イット", "that": "ザット", "this": "ディス", "what": "ワット", "all": "オール", "now": "ナウ", "like": "ライク",
    "just": "ジャスト", "get": "ゲット", "got": "ガット", "let": "レット", "come": "カム", "time": "タイム", "do": "ドゥ",
    "are": "アー", "was": "ワズ", "were": "ワー", "here": "ヒア", "there": "ゼア", "where": "ウェア", "when": "ウェン",
    "why": "ワイ", "how": "ハウ", "who": "フー", "can": "キャン", "will": "ウィル", "say": "セイ", "see": "シー",
    "feel": "フィール", "take": "テイク", "make": "メイク", "give": "ギヴ", "down": "ダウン", "up": "アップ", "out": "アウト",
    "beautiful": "ビューティフル", "wonderful": "ワンダフル", "little": "リトル", "family": "ファミリー", "memory": "メモリー",
    "wanna": "ワナ", "gonna": "ガナ", "gotta": "ガタ", "okay": "オーケー", "ok": "オーケー", "kiss": "キス",
}

CUR = {"word": ""}

def word_kana(word, phones):
    CUR["word"] = word
    if word in OVERRIDE:
        return OVERRIDE[word]
    ph = [re.sub(r"\d", "", p) for p in phones]
    stress = [(p[-1] if p[-1].isdigit() else "") for p in phones]
    out = []
    i = 0
    n = len(ph)
    is_vowel = lambda k: 0 <= k < n and ph[k] in VOWELS
    # to- で始まる言葉（today など）は「トゥ」
    if word.startswith("to") and ph[:2] == ["T", "AH"] and stress[1] == "0":
        out.append("トゥ")
        i = 2
    # for- で始まる言葉（forget など）は「フォー」
    elif word.startswith("for") and ph[:2] == ["F", "ER"]:
        out.append("フォー")
        i = 2
    while i < n:
        p = ph[i]
        if p in VOWELS:
            out.append(vowel_kana("", p, stress[i], i == n - 1, ph, i))
            i += 1
            continue
        # 子音 + Y + 母音（ミュ・キュ）
        if i + 2 < n and ph[i + 1] == "Y" and is_vowel(i + 2) and p in ROW and p not in ("Y", "W", ""):
            col, tail = VOWEL[ph[i + 2]]
            base = ROW[p][1]
            out.append(base + SMALL_Y.get(col, "ュ") + tail_of(tail, stress[i + 2], i + 2 == n - 1, ph, i + 2))
            i += 3
            continue
        # 子音 + 母音
        if is_vowel(i + 1):
            out.append(vowel_kana(p, ph[i + 1], stress[i + 1], i + 1 == n - 1, ph, i + 1))
            i += 2
            continue
        # 子音だけ
        prev_v = i > 0 and ph[i - 1] in VOWELS
        if p == "R":
            if prev_v:
                pv = ph[i - 1]
                if pv in ("IH", "EH", "UH", "AY", "AW", "IY", "EY"):
                    out.append("ア")
                elif not out or not out[-1].endswith("ー"):
                    out.append("ー")
            else:
                out.append("ル")
            i += 1
            continue
        nxt = ph[i + 1] if i + 1 < n else ""
        # 短い母音 + 止まる子音で終わる → 「ッ」（cat → キャット、good → グッド）
        # 「ッ」は語末の子音（と、そのあとの複数形の s・z）の前だけ。perfect は「パーフェクト」
        word_end = i + 1 == n or (i + 2 == n and ph[i + 1] in ("S", "Z"))
        if prev_v and p in GEM and word_end and (
                (ph[i - 1] in SHORT and stress[i - 1] in ("1", "2"))
                or (ph[i - 1] == "IH" and p in ("K", "T", "P"))):  # music → ミュージック、rabbit → ラビット
            out.append("ッ")
        if p == "T" and nxt == "S" and not is_vowel(i + 2):
            out.append("ツ"); i += 2; continue
        if p == "D" and nxt == "Z" and not is_vowel(i + 2):
            out.append("ズ"); i += 2; continue
        if p == "NG":
            out.append("ン" if nxt in ("K", "G") else "ング"); i += 1; continue
        if p == "M" and nxt in ("P", "B"):
            out.append("ン"); i += 1; continue
        out.append(CODA.get(p, ""))
        i += 1
    return "".join(out)

def tail_of(tail, st, last, ph, k):
    if tail == "long":
        # 強く読むか語末なら「ー」。OW は don't のように N + 子音が続くときは短く
        if ph[k] == "OW" and k + 2 < len(ph) and ph[k + 1] == "N" and ph[k + 2] not in VOWELS:
            return ""
        if ph[k] == "AO" and k + 1 < len(ph) and ph[k + 1] == "R":
            return ""  # R が「ー」を付ける
        return "ー" if (st in ("1", "2") or last) else ""
    return tail

def vowel_kana(cons, v, st, last, ph, k):
    col, tail = VOWEL[v]
    row = ROW.get(cons, ROW[""])
    if v == "AE" and cons in ("K", "G"):
        kana = row[1] + "ャ"                       # cat → キャット
    elif v == "ER" and cons == "":
        kana = "アー"; tail = ""
    elif v == "AA" and "o" in CUR["word"] and "a" not in CUR["word"]:
        kana = row[4]                              # つづりが o の AA は「オ」（hot → ホット、stop → ストップ）
    else:
        kana = row[col]
    # 強く読む短い母音 + P・K + 弱い母音 → 「ッ」（happy → ハッピー、lucky → ラッキー）
    nk = k + 1
    if (v in SHORT and st in ("1", "2") and nk + 1 < len(ph) and ph[nk] in ("P", "K") and ph[nk + 1] in VOWELS
            and not ph[nk + 1] == "ER"):
        tail_s = tail_of(tail, st, last, ph, k)
        return kana + tail_s + "ッ"
    return kana + tail_of(tail, st, last, ph, k)

def main():
    dict_path, license_path = Path(sys.argv[1]), Path(sys.argv[2])
    out = Path(__file__).resolve().parents[2] / "lyrics" / "en-kana.txt"
    lines = []
    seen = set()
    for raw in dict_path.read_text(encoding="utf-8").splitlines():
        raw = raw.split("#")[0].strip()
        if not raw:
            continue
        word, *phones = raw.split()
        if "(" in word or word in seen:
            continue
        if not re.fullmatch(r"[a-z][a-z']{0,15}", word):
            continue
        seen.add(word)
        kana = word_kana(word, phones)
        if kana:
            lines.append(word + "\t" + kana)
    for w, k in OVERRIDE.items():
        if w not in seen:
            lines.append(w + "\t" + k)
    lines.sort()
    head = ["# Lyrics Flow: 英語の歌詞のカタカナの読み（_build/lyrics/en_kana.py が作る。直接編集しない）",
            "# CMU Pronouncing Dictionary の発音記号を、カタカナに置き換えたもの。元のライセンス:"]
    head += ["# " + l if l else "#" for l in license_path.read_text(encoding="utf-8").splitlines()]
    out.write_text("\n".join(head + lines) + "\n", encoding="utf-8")
    print("wrote", out, len(lines), "words")

if __name__ == "__main__":
    main()
