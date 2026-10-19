// SK Study の共有リンク
//   単語帳をまるごとリンクの中（# のあと）に詰める。サーバーには何も保存しない（# のあとはサーバーに送られない）
//   形: /study/#/import/1.<圧縮した JSON を base64url にしたもの>（圧縮できないブラウザは 0.<JSON の base64url>）
//   中身: { v: 1, t: タイトル, l: 言語, n: 言語の名前, s: 読み上げ, d: 説明, w: [[単語, 意味, 読み, 例文, 例文の訳], …] }
//   受け取った側では store.js の cleanSet() で形と長さをそろえてから保存する
//   あとで SK Hub Systems に保存できるようになったら、短いリンク（ID だけ）に切りかえる
const VERSION = 1;

function toBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(text) {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeSet(set) {
  const data = {
    v: VERSION,
    t: set.title,
    l: set.lang,
    d: set.description || "",
    w: set.words.map((x) => {
      const row = [x.w, x.m, x.r || "", x.ex || "", x.exm || ""];
      while (row.length > 2 && !row[row.length - 1]) row.pop();
      return row;
    })
  };
  if (set.lang === "custom") { data.n = set.langName || ""; data.s = set.speech || ""; }
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  if (typeof CompressionStream === "function") {
    try { return "1." + toBase64Url(await pipe(bytes, new CompressionStream("deflate-raw"))); } catch (e) { /* 圧縮しない */ }
  }
  return "0." + toBase64Url(bytes);
}

export async function decodeSet(code) {
  const m = /^([01])\.([A-Za-z0-9_-]+)$/.exec(String(code || "").trim());
  if (!m) throw new Error("bad-format");
  let bytes = fromBase64Url(m[2]);
  if (m[1] === "1") {
    if (typeof DecompressionStream !== "function") throw new Error("unsupported");
    bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
  }
  const data = JSON.parse(new TextDecoder().decode(bytes));
  if (!data || data.v !== VERSION || !Array.isArray(data.w)) throw new Error("bad-data");
  return {
    title: data.t,
    lang: data.l,
    langName: data.n,
    speech: data.s,
    description: data.d,
    words: data.w.filter(Array.isArray).map(([w, m, r, ex, exm]) => ({ w, m, r, ex, exm }))
  };
}

// 貼りつけられた文（リンク全体・# のあと・コードだけ）からコードを取り出す
export function extractCode(text) {
  const s = String(text || "").trim();
  const m = /#\/import\/([01]\.[A-Za-z0-9_-]+)/.exec(s);
  if (m) return m[1];
  if (/^[01]\.[A-Za-z0-9_-]+$/.test(s)) return s;
  return "";
}

export function shareUrl(code) {
  return `${location.origin}/study/#/import/${code}`;
}
