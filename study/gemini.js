// SK Study の変換ツールで使う Gemini API（Google AI Studio の API キー。無料枠あり）
//   ・キーは使う人のもの。ブラウザから Google に直接送る（SK のサーバーは通らない）。保存するのは本人が選んだときだけ（この端末の localStorage）
//   ・モデルの名前は変わっていくので決め打ちしない。キーで使えるモデルの一覧を読み、新しい Flash を選ぶ（無料枠は Flash 系）
//   ・PDF はそのまま渡し、決まった形の JSON（printfmt.js のプリントのデータ）で返してもらう
const API = "https://generativelanguage.googleapis.com/v1beta";
const KEY_STORE = "sk_study_gemini_key";
const MODEL_STORE = "sk_study_gemini_model";
export const MAX_PDF = 18 * 1024 * 1024; // まとめて送れるのは 20MB まで

export function savedKey() { try { return localStorage.getItem(KEY_STORE) || ""; } catch (e) { return ""; } }
export function rememberKey(key) { try { if (key) localStorage.setItem(KEY_STORE, key); else localStorage.removeItem(KEY_STORE); } catch (e) { /* 保存できなくても使える */ } }
export function savedModel() { try { return localStorage.getItem(MODEL_STORE) || ""; } catch (e) { return ""; } }
export function rememberModel(m) { try { localStorage.setItem(MODEL_STORE, m); } catch (e) { /* 同上 */ } }

async function call(path, key, body) {
  const res = await fetch(`${API}/${path}`, {
    method: body ? "POST" : "GET",
    headers: { "x-goog-api-key": key, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.message) || `HTTP ${res.status}`;
    const err = new Error(res.status === 429 ? "無料枠の回数の上限に達しました。少し待ってから（1 日の上限なら翌日に）やり直してください。"
      : res.status === 400 && /API key/i.test(msg) ? "API キーが正しくないようです。"
        : res.status === 403 ? "この API キーでは使えません（キーの設定を確かめてください）。" : msg);
    err.status = res.status;
    throw err;
  }
  return data;
}

// 使えるモデル（generateContent ができるもの）。おすすめ順: 数字の大きい Flash（lite・画像・音声用などは後ろ）
export async function listModels(key) {
  const out = [];
  let token = "";
  for (let i = 0; i < 5; i++) {
    const data = await call(`models?pageSize=200${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, key);
    for (const m of data.models || []) {
      if (!(m.supportedGenerationMethods || []).includes("generateContent")) continue;
      const id = String(m.name || "").replace(/^models\//, "");
      if (!/^gemini-/.test(id) || /tts|image|audio|live|embedding|vision|learnlm|robotics|computer-use/i.test(id)) continue;
      out.push({ id, name: m.displayName || id });
    }
    token = data.nextPageToken;
    if (!token) break;
  }
  const ver = (id) => { const m = /gemini-(\d+(?:\.\d+)?)/.exec(id); return m ? Number(m[1]) : 0; };
  const score = (id) => ver(id) * 100 + (/flash/.test(id) ? 30 : 0) - (/lite/.test(id) ? 20 : 0) - (/preview|exp/.test(id) ? 5 : 0) - (/pro/.test(id) ? 40 : 0) + (/latest/.test(id) ? 3 : 0);
  return out.sort((a, b) => score(b.id) - score(a.id));
}

const SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    answerPages: { type: "ARRAY", items: { type: "INTEGER" } },
    articles: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          sections: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                name: { type: "STRING" },
                questions: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      n: { type: "STRING" },
                      text: { type: "STRING" },
                      choices: { type: "ARRAY", items: { type: "OBJECT", properties: { k: { type: "STRING" }, t: { type: "STRING" } }, required: ["k", "t"] } },
                      blanks: {
                        type: "ARRAY",
                        items: {
                          type: "OBJECT",
                          properties: {
                            kind: { type: "STRING", enum: ["box", "choice", "lines"] },
                            answer: { type: "STRING" },
                            alts: { type: "ARRAY", items: { type: "STRING" } }
                          },
                          required: ["kind", "answer"]
                        }
                      },
                      explanation: { type: "STRING" }
                    },
                    required: ["n", "text", "blanks"]
                  }
                }
              },
              required: ["name", "questions"]
            }
          }
        },
        required: ["title", "sections"]
      }
    }
  },
  required: ["title", "answerPages", "articles"]
};

const PROMPT = `あなたは学校のプリント（問題用紙）を、学習アプリで解けるデータに書き起こす係です。
添付の PDF を読み、次の決まりで JSON を作ってください。

- title: プリント全体の名前。
- answerPages: 解答・解説が書かれているページの番号（1 から）。なければ空。
- articles: 作品・単元ごと（見出しごと）。sections は「◆漢字の確認◆」のような節（◆は付けない。節がなければ name は空文字）。
- questions: 問題 1 つずつ。n は問題番号（「1」「２」「・」など、プリントのまま）。
- text: 問題文。解答を書きこむ場所（四角・空欄・かっこ・罫線）は {{1}} {{2}} … と書き、blanks の順番と合わせる。
  傍線・下線のある語は __語__ と書く。改行はそのまま。漢字の書き取り・読みの一覧は、1 つの問題にまとめ、
  各行を「①__系譜__（{{1}}）」のように書いてよい。
- choices: 記号で選ぶ選択肢（ア・イ・ウ…）。k が記号、t がその文。
- blanks: 解答欄 1 つずつ。kind は、記号で答えるなら choice、文で説明する記述なら lines、それ以外（語句・漢字・抜き出し）は box。
  answer は解答ページに書かれている答え（記号なら記号 1 文字）。解答ページに答えがないときは、自分で考えず空文字にする。
  alts は別解（解答に「（…）」で書かれている別の答えなど）。
- explanation: 解答・解説ページにある、その問題の解説（なければ空文字）。
- 氏名・クラス・番号などを書く欄は入れない。
- 本文（長い文章）そのものは書き写さなくてよい。問題文に必要な部分だけ書く。
- 書かれていないことを付け足さない。読めない文字は〔？〕と書く。`;

// PDF（ArrayBuffer）を読み取る。戻り値はプリントのデータ（printfmt.js）
export async function convertPdf({ key, model, pdf, hint = "" }) {
  const bytes = new Uint8Array(pdf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const body = {
    contents: [{
      role: "user",
      parts: [
        { inline_data: { mime_type: "application/pdf", data: btoa(bin) } },
        { text: PROMPT + (hint ? `\n\n補足: ${hint}` : "") }
      ]
    }],
    generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0.1 }
  };
  const data = await call(`models/${encodeURIComponent(model)}:generateContent`, key, body);
  const cand = (data.candidates || [])[0];
  const text = cand && cand.content && (cand.content.parts || []).map((p) => p.text || "").join("");
  if (!text) {
    const reason = (cand && cand.finishReason) || (data.promptFeedback && data.promptFeedback.blockReason) || "不明";
    throw new Error(`読み取れませんでした（理由: ${reason}）`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(cand.finishReason === "MAX_TOKENS" ? "プリントが長すぎて、途中で切れました。ページを分けて読み取ってください。" : "AI の返事を読めませんでした。もう一度ためしてください。");
  }
}
