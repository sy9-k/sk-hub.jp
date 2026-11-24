// 参加コードの案内 PDF（SK Study）。コードを渡すときに、コードの入れ方の説明といっしょに 1 人 1 枚で出す
//   ブラウザの印刷の画面を開く（送信先を「PDF に保存」にすると PDF になる）。パソコンの印刷でも、そのまま配れる
//   kind: student（生徒のクラスのコード）/ teacher（学校の先生のコード）/ admin（総合管理者のコード）
//   items: [{ name, code }]（1 人 1 ページ）
//   手順には、実際の画面をまねた絵（どこを押すか・何を入れるか）をつける。絵はすべてこのファイルの中の SVG（外の画像・フォントは使わない）
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- 画面の絵の部品（viewBox 252 × 108） ----------
const FONT = `font-family="'Noto Sans JP','Hiragino Sans','Yu Gothic',Meiryo,sans-serif"`;
const R = (x, y, w, h, r, fill, stroke = "none", sw = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"/>`;
const T = (x, y, size, txt, { w = 500, c = "#1f2937", a = "start", ls = 0 } = {}) => `<text x="${x}" y="${y}" font-size="${size}" font-weight="${w}" fill="${c}" text-anchor="${a}" letter-spacing="${ls}" ${FONT}>${esc(txt)}</text>`;
// 押すところ・見るところを、赤い点線のわくで囲む
const HL = (x, y, w, h, r = 5) => `<rect x="${x - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="${r + 3}" fill="rgba(239,68,68,.08)" stroke="#ef4444" stroke-width="2" stroke-dasharray="5 3"/>`;
const CURSOR = (x, y) => `<path transform="translate(${x} ${y})" d="M0 0 L0 16 L4.200 12.200 L7.200 19 L10.400 17.600 L7.400 11 L13 11Z" fill="#111827" stroke="#fff" stroke-width="1.500" stroke-linejoin="round"/>`;
// ふき出し（x, y = 左上。しっぽは左下）
const CALL = (x, y, txt) => {
  const w = [...txt].length * 9.500 + 14;
  return `<g><path d="M${x + 8} ${y + 16} l-3 6 l9 -6Z" fill="#ef4444"/>${R(x, y, w, 17, 8.500, "#ef4444")}${T(x + w / 2, y + 12.200, 9.500, txt, { w: 700, c: "#fff", a: "middle" })}</g>`;
};
const BTN = (x, y, w, h, label, { fill = "#2563eb", c = "#fff", size = 9.500 } = {}) => `${R(x, y, w, h, 5, fill)}${T(x + w / 2, y + h / 2 + size * 0.36, size, label, { w: 700, c, a: "middle" })}`;
const MOCK = (inner) => `<svg viewBox="0 0 252 108" xmlns="http://www.w3.org/2000/svg">${R(0, 0, 252, 108, 8, "#eef2f9")}${inner}</svg>`;
const ARROW = (x, y) => `<path d="M${x} ${y} h14 m-5 -5 l5 5 l-5 5" stroke="#2563eb" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
// ブラウザの窓
const WIN = (title) => `${R(8, 7, 236, 94, 7, "#fff", "#cbd5e1")}${R(8, 7, 236, 20, 7, "#e2e8f0")}<rect x="8" y="20" width="236" height="7" fill="#e2e8f0"/><circle cx="19" cy="17" r="2.600" fill="#f87171"/><circle cx="27" cy="17" r="2.600" fill="#fbbf24"/><circle cx="35" cy="17" r="2.600" fill="#34d399"/>${R(46, 11, 190, 12, 6, "#fff", "#94a3b8")}${T(54, 19.800, 8, title, { c: "#475569" })}`;
// 左のメニュー（ドロワー）
const DRAWER = (x, y, w, items, active, head = null) => {
  let s = R(x, y, w, 94, 7, "#fff", "#cbd5e1");
  let yy = y + 8;
  if (head) { s += `<circle cx="${x + 14}" cy="${yy + 6}" r="6" fill="#bfdbfe"/>${T(x + 24, yy + 9, 8.500, head, { w: 700 })}<path d="M${x + w - 12} ${yy + 3} l3 -3 l3 3 M${x + w - 12} ${yy + 9} l3 3 l3 -3" stroke="#64748b" stroke-width="1.500" fill="none" stroke-linecap="round"/>`; yy += 20; }
  for (const it of items) {
    if (it === active) s += R(x + 4, yy - 3, w - 8, 14, 7, "#dbeafe");
    s += R(x + 9, yy, 7, 7, 2, it === active ? "#2563eb" : "#cbd5e1") + T(x + 21, yy + 7, 8.500, it, { w: it === active ? 700 : 500, c: it === active ? "#1d4ed8" : "#475569" });
    yy += 16;
  }
  return s;
};

const MOCKS = {
  // 1 SK Study を開く: アドレスバーに URL
  open: ({ host }) => MOCK(`${WIN(`${host}/study/`)}${R(112, 50, 28, 28, 8, "#2563eb")}${T(126, 69, 13, "SK", { w: 800, c: "#fff", a: "middle" })}${T(126, 92, 10, "SK Study", { w: 700, a: "middle" })}${HL(46, 11, 190, 12, 6)}${CURSOR(206, 26)}${CALL(66, 28, "URL を入れて開く")}`),
  // 2 ログイン
  login: () => MOCK(`${WIN("sk-hub.jp/study/")}${T(126, 47, 10.500, "ログインしてください", { w: 700, a: "middle" })}${T(126, 60, 7.500, "SK Hub Systems アカウントで入ります", { c: "#64748b", a: "middle" })}${BTN(86, 68, 80, 20, "ログイン")}${HL(86, 68, 80, 20)}${CURSOR(150, 80)}${CALL(176, 64, "ここを押す")}`),
  // 3 SK Study につなぐ
  link: () => MOCK(`${WIN("sk-hub.jp/account/")}${T(126, 46, 10, "SK Study に接続しますか？", { w: 700, a: "middle" })}${T(126, 59, 7.500, "初めてのときだけです", { c: "#64748b", a: "middle" })}${BTN(76, 68, 100, 20, "SK Study に接続する")}${HL(76, 68, 100, 20)}${CURSOR(160, 80)}${CALL(184, 64, "ここを押す")}`),
  // 4 生徒: メニューの「クラス」→「参加コードを入れる」
  classStudent: () => MOCK(`${DRAWER(8, 7, 104, ["ホーム", "SK認定コンテンツ", "マイ単語帳", "プリント", "クラス"], "クラス")}${HL(12, 76, 96, 14, 7)}${CURSOR(88, 88)}${ARROW(116, 50)}${R(134, 7, 110, 94, 7, "#fff", "#cbd5e1")}${T(144, 25, 10, "クラス", { w: 700 })}${R(144, 34, 90, 14, 4, "#f1f5f9")}${T(150, 44, 7.500, "まだ参加していません", { c: "#64748b" })}${BTN(144, 62, 90, 20, "参加コードを入れる", { size: 8.500 })}${HL(144, 62, 90, 20)}${CURSOR(220, 76)}`),
  // 4 先生・総合管理者: 「クラス」画面の「先生・管理者の方はこちら」→「コードを入れる」
  staffEntry: () => MOCK(`${R(8, 7, 116, 94, 7, "#fff", "#cbd5e1")}${T(18, 25, 10, "クラス", { w: 700 })}${R(18, 32, 96, 12, 6, "none", "#2563eb", 1.200)}${T(66, 40.500, 7.500, "先生・管理者の方はこちら", { w: 700, c: "#1d4ed8", a: "middle" })}${HL(18, 32, 96, 12, 6)}${CURSOR(98, 42)}${R(18, 56, 96, 22, 4, "#f1f5f9")}${T(66, 70, 7.500, "クラスの一覧", { c: "#64748b", a: "middle" })}${ARROW(127, 50)}${R(146, 7, 98, 94, 7, "#fff", "#cbd5e1")}${T(156, 25, 10, "先生・総合管理者", { w: 700 })}${T(156, 40, 7, "コードを入れると", { c: "#64748b" })}${T(156, 50, 7, "プロファイルができます", { c: "#64748b" })}${BTN(156, 62, 78, 20, "コードを入れる", { size: 8.500 })}${HL(156, 62, 78, 20)}${CURSOR(222, 76)}`),
  // 5 コードを入れる: ダイアログ
  codeDialog: ({ code, title, ok }) => MOCK(`${R(40, 8, 172, 92, 10, "#fff", "#cbd5e1")}${T(52, 27, 10.500, title, { w: 700 })}${T(52, 40, 7.500, "渡された 6 けたのコードを入れてください", { c: "#64748b" })}${R(52, 47, 148, 20, 4, "#fff", "#2563eb", 1.600)}${T(126, 61.500, 14, code, { w: 800, c: "#1d4ed8", a: "middle", ls: 4 })}${HL(52, 47, 148, 20, 4)}${BTN(138, 74, 62, 19, ok, { size: 8.500 })}${HL(138, 74, 62, 19)}${CURSOR(186, 86)}${CALL(70, 72, "ここを押す")}`),
  // 6 プロファイルを切りかえる
  switchProfile: ({ who }) => MOCK(`${DRAWER(8, 7, 120, ["指導者メニュー", "SK認定コンテンツ", "マイ単語帳"], "指導者メニュー", "個人")}${HL(10, 11, 116, 18, 6)}${CURSOR(104, 24)}${ARROW(132, 22)}${R(150, 7, 94, 56, 7, "#fff", "#cbd5e1")}${T(158, 22, 8, "個人", { c: "#475569" })}${R(154, 30, 86, 15, 7, "#dbeafe")}${T(160, 40.200, 6.600, who, { w: 700, c: "#1d4ed8" })}${HL(154, 30, 86, 15, 7)}${CURSOR(226, 42)}${T(158, 56, 6.500, "↑ これを選ぶ", { w: 700, c: "#ef4444" })}`)
};

// ---------- ヘッダーのイラスト ----------
const star = (x, y, s, c = "#fff") => `<path transform="translate(${x} ${y}) scale(${s})" d="M0-10 L2.6-2.6 L10 0 L2.6 2.6 L0 10 L-2.6 2.6 L-10 0 L-2.6-2.6Z" fill="${c}"/>`;
const HERO = {
  student: `<svg viewBox="0 0 270 150" xmlns="http://www.w3.org/2000/svg"><path d="M28 130 L135 144 L242 130 L242 62 L135 76 L28 62Z" fill="#fff"/><path d="M135 76 L135 144" stroke="#93c5fd" stroke-width="3"/><path d="M44 80 L120 92 M44 96 L120 108 M150 92 L226 80 M150 108 L226 96" stroke="#bfdbfe" stroke-width="4" stroke-linecap="round"/><g transform="rotate(-12 70 36)"><rect x="34" y="12" width="72" height="46" rx="10" fill="#fbbf24"/><text x="70" y="45" font-size="26" font-weight="800" text-anchor="middle" fill="#fff" ${FONT}>Abc</text></g><g transform="rotate(9 200 34)"><rect x="166" y="8" width="68" height="46" rx="10" fill="#f472b6"/><text x="200" y="43" font-size="28" font-weight="800" text-anchor="middle" fill="#fff" ${FONT}>あ</text></g><g transform="rotate(-4 135 18)"><rect x="104" y="0" width="62" height="40" rx="10" fill="#34d399"/><text x="135" y="28" font-size="22" font-weight="800" text-anchor="middle" fill="#fff" ${FONT}>안녕</text></g>${star(22, 30, 1)}${star(252, 80, .9)}</svg>`,
  teacher: `<svg viewBox="0 0 270 150" xmlns="http://www.w3.org/2000/svg"><rect x="30" y="8" width="210" height="116" rx="10" fill="#b45309"/><rect x="38" y="16" width="194" height="100" rx="6" fill="#14532d"/><text x="62" y="62" font-size="30" font-weight="800" fill="#fff" ${FONT}>Hello!</text><text x="62" y="98" font-size="24" font-weight="700" fill="#fde68a" ${FONT}>こんにちは</text><path d="M150 46 Q172 30 196 48 T230 40" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-dasharray="2 7"/><rect x="30" y="124" width="210" height="8" rx="4" fill="#92400e"/><circle cx="214" cy="120" r="12" fill="#ef4444"/><path d="M214 109 q-1 -8 7 -10" stroke="#166534" stroke-width="3" fill="none" stroke-linecap="round"/>${star(18, 28, 1)}${star(256, 12, .8)}</svg>`,
  admin: `<svg viewBox="0 0 270 150" xmlns="http://www.w3.org/2000/svg"><rect x="130" y="2" width="4" height="30" fill="#e5e7eb"/><path d="M134 4 L168 12 L134 22Z" fill="#f472b6"/><path d="M52 62 L135 30 L218 62Z" fill="#fff"/><rect x="62" y="62" width="146" height="76" fill="#eef4ff"/><rect x="52" y="136" width="166" height="10" rx="3" fill="#fff"/><g fill="#bfdbfe"><rect x="76" y="70" width="14" height="60" rx="3"/><rect x="104" y="70" width="14" height="60" rx="3"/><rect x="152" y="70" width="14" height="60" rx="3"/><rect x="180" y="70" width="14" height="60" rx="3"/></g><path d="M124 138 v-38 a11 11 0 0 1 22 0 v38Z" fill="#2563eb"/><g transform="translate(206 84)"><path d="M0 0 L34 0 L34 28 Q34 46 17 54 Q0 46 0 28Z" fill="#34d399"/><circle cx="17" cy="20" r="6.500" fill="none" stroke="#fff" stroke-width="3.200"/><path d="M17 27 v12 M17 33 h5" stroke="#fff" stroke-width="3.200" stroke-linecap="round"/></g>${star(24, 44, 1)}${star(252, 36, .9)}</svg>`
};
const TICKET_KEY = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="22" cy="32" r="14" fill="#fbbf24"/><circle cx="22" cy="32" r="6" fill="#fff7d6"/><rect x="34" y="28" width="26" height="8" rx="3" fill="#fbbf24"/><rect x="48" y="36" width="6" height="9" rx="2" fill="#fbbf24"/><rect x="38" y="36" width="6" height="6" rx="2" fill="#fbbf24"/></svg>`;

// 手順は [見出し, 説明, 絵の種類, 絵に渡すもの]。説明の <b> は強調（ここで書いた文字だけ。名前などの入力は esc を通す）
const STEPS = {
  open: (url) => ["SK Study を開く", `ブラウザで <b>${esc(url)}</b> を開きます。`, "open"],
  login: (who) => ["ログインする", `SK Hub Systems アカウントで入ります。招待制です。開けないときは${who}へ。`, "login"],
  link: () => ["SK Study につなぐ", "初めてのときだけ。画面の案内どおりに接続します。", "link"]
};
const KINDS = {
  student: {
    role: "生徒として参加", label: "クラス", subLabel: "管理人", greet: "さあ、クラスに参加しよう！",
    steps: (c) => [
      STEPS.open(c.url), STEPS.login("先生"), STEPS.link(),
      ["「クラス」→「参加コードを入れる」", "左のメニューの<b>「クラス」</b>を開き、<b>「参加コードを入れる」</b>を押します。", "classStudent"],
      ["コードを入れて参加", "上のコードを入れて<b>「確かめる」</b>→<b>「参加する」</b>を押せば完了です。", "codeDialog", { title: "クラスに参加", ok: "確かめる" }]
    ],
    notes: ["このコードは、あなた専用です。ほかの人に教えないでください。", "コードは 1 回だけ使えます。参加したあとは、左上のアカウントの欄から、個人とクラスのプロファイルを切り替えられます。"]
  },
  teacher: {
    role: "先生として参加", label: "学校", subLabel: "担当", greet: "学校の先生として、はじめよう！",
    steps: (c) => [
      STEPS.open(c.url), STEPS.login("総合管理者"), STEPS.link(),
      ["「先生・管理者の方はこちら」", "左のメニューの「クラス」で<b>「先生・管理者の方はこちら」</b>を押し、<b>「コードを入れる」</b>を押します。", "staffEntry"],
      ["コードを入れる", "上のコードを入れて<b>「確かめる」</b>→<b>「このコードを使う」</b>を押します。", "codeDialog", { title: "コードを入れる", ok: "確かめる" }],
      ["先生のプロファイルで入る", "左上のアカウントの欄を押し、<b>先生のプロファイル</b>を選びます。クラスを作って配信できます。", "switchProfile", { who: `${c.name}（先生）` }]
    ],
    notes: ["このコードは、あなた専用です。ほかの人に教えないでください。", "コードは 1 回だけ使えます。先生のプロファイルは、個人のプロファイルとは教材・学習の記録が別になります。"]
  },
  admin: {
    role: "総合管理者として参加", label: "役割", subLabel: "担当", greet: "学校をまとめる総合管理者へ！",
    steps: (c) => [
      STEPS.open(c.url), STEPS.login("SK"), STEPS.link(),
      ["「先生・管理者の方はこちら」", "左のメニューの「クラス」で<b>「先生・管理者の方はこちら」</b>を押し、<b>「コードを入れる」</b>を押します。", "staffEntry"],
      ["コードを入れる", "上のコードを入れて<b>「確かめる」</b>→<b>「このコードを使う」</b>を押します。", "codeDialog", { title: "コードを入れる", ok: "確かめる" }],
      ["総合管理者のプロファイルで入る", "左上のアカウントの欄を押し、<b>総合管理者のプロファイル</b>を選びます。学校を作って先生にコードを配れます。", "switchProfile", { who: `${c.name}（総合管理者）` }]
    ],
    notes: ["このコードは、あなた専用です。ほかの人に教えないでください。", "コードは 1 回だけ使えます。"]
  }
};

const CSS = `
@page { size: A4; margin: 0; }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
:root { --blue: #2563eb; --blue-d: #1d4ed8; --ink: #14171f; --sub: #5b6475; --line: #e3e7ef; --soft: #f4f7fe; }
html, body { margin: 0; background: #e9ecf2; }
body { font: 14px/1.7 "Noto Sans JP", "Hiragino Sans", "Yu Gothic UI", "Yu Gothic", Meiryo, sans-serif; color: var(--ink); }
svg { display: block; width: 100%; height: auto; }
.page { position: relative; width: 210mm; height: 297mm; margin: 0 auto 8mm; background: #fff; overflow: hidden; page-break-after: always; break-after: page; display: flex; flex-direction: column; }
.page:last-child { page-break-after: auto; break-after: auto; }
.hero { flex: none; position: relative; height: 46mm; padding: 10mm 16mm 0; color: #fff; background: linear-gradient(135deg, #1e40af 0%, #2563eb 55%, #3b82f6 100%); overflow: hidden; }
.hero::before { content: ""; position: absolute; width: 90mm; height: 90mm; right: -26mm; top: -48mm; border-radius: 50%; background: rgba(255, 255, 255, .1); }
.brand { position: relative; display: flex; align-items: center; gap: 9px; margin: 0 0 4mm; font-weight: 700; font-size: 15px; letter-spacing: .06em; }
.mark { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 8px; background: #fff; color: var(--blue); font-size: 13px; font-weight: 800; letter-spacing: 0; }
.hero h1 { position: relative; margin: 0; font-size: 28px; line-height: 1.25; letter-spacing: .04em; }
.chip { position: relative; display: inline-block; margin-top: 5px; padding: 2px 12px; border-radius: 999px; background: rgba(255, 255, 255, .2); border: 1px solid rgba(255, 255, 255, .5); font-size: 12.500px; font-weight: 500; }
.art { position: absolute; right: 12mm; bottom: -2mm; width: 62mm; }
.body { padding: 5mm 16mm 0; display: flex; flex-direction: column; flex: 1; }
.who { display: flex; align-items: flex-end; justify-content: space-between; gap: 10mm; margin-bottom: 3.500mm; }
.name { margin: 0; font-size: 26px; line-height: 1.25; font-weight: 700; }
.name small { margin-left: 6px; font-size: 15px; font-weight: 500; color: var(--sub); }
.meta { margin: 0; text-align: right; color: var(--sub); font-size: 12.500px; line-height: 1.55; }
.meta b { color: var(--ink); font-weight: 500; }
.ticket { position: relative; margin-bottom: 4mm; padding: 3mm 8mm 3.500mm 28mm; border-radius: 14px; background: var(--soft); border: 2px dashed #9db8f5; text-align: center; }
.ticket::before, .ticket::after { content: ""; position: absolute; top: 50%; width: 14px; height: 14px; margin-top: -7px; border-radius: 50%; background: #fff; border: 2px dashed #9db8f5; }
.ticket::before { left: -9px; clip-path: inset(0 0 0 50%); }
.ticket::after { right: -9px; clip-path: inset(0 50% 0 0); }
.ticket .key { position: absolute; left: 7mm; top: 50%; width: 15mm; margin-top: -7.500mm; transform: rotate(-18deg); }
.ticket .cap { margin: 0; color: var(--blue-d); font-size: 12px; font-weight: 700; letter-spacing: .2em; }
.code { font: 800 42px/1.2 "Consolas", "SF Mono", "Courier New", monospace; letter-spacing: .3em; padding-left: .3em; color: var(--blue-d); }
.ticket .once { margin: 0; color: var(--sub); font-size: 11px; }
h2 { display: flex; align-items: center; gap: 8px; margin: 0 0 2.500mm; font-size: 15px; }
h2::before { content: ""; width: 5px; height: 16px; border-radius: 3px; background: var(--blue); }
.steps { list-style: none; margin: 0 0 3mm; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 4mm; }
.steps li { border: 1px solid var(--line); border-radius: 12px; padding: 2.200mm 2.500mm 2.500mm; background: #fff; }
.steps .hd { display: flex; align-items: center; gap: 7px; margin-bottom: 1.500mm; }
.num { flex: none; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--blue); color: #fff; font-weight: 700; font-size: 12px; }
.steps h3 { margin: 0; font-size: 12.500px; line-height: 1.4; }
.steps .pic { border-radius: 8px; overflow: hidden; }
.steps p { margin: 1.200mm 0 0; color: #3b4252; font-size: 10.500px; line-height: 1.55; }
.steps b { color: var(--ink); background: linear-gradient(transparent 62%, #dbe7ff 62%); font-weight: 700; }
.notes { margin: 0; padding: 2.500mm 5mm; list-style: none; border-radius: 10px; background: #fff8e6; border: 1px solid #f6dfa1; font-size: 11px; line-height: 1.6; color: #5b4a12; }
.notes li { position: relative; padding-left: 1.300em; }
.notes li::before { content: "!"; position: absolute; left: 0; top: 3px; display: grid; place-items: center; width: 12px; height: 12px; border-radius: 50%; background: #e6a700; color: #fff; font-size: 9px; font-weight: 800; line-height: 1; }
.foot { margin: auto 16mm 0; padding: 2.500mm 0 5mm; display: flex; justify-content: space-between; align-items: center; color: var(--sub); font-size: 10.500px; border-top: 1px solid var(--line); }
.foot b { color: var(--blue-d); letter-spacing: .04em; }
@media print { html, body { background: #fff; } .page { margin: 0; } }
`;

// name = 案内をもらう人の名前、org = 学校・クラスの名前（絵の中の表示に使う）
export function inviteSheetHtml({ kind = "student", orgName = "", subName = "", items = [], origin = location.origin }) {
  const k = KINDS[kind] || KINDS.student;
  const art = HERO[kind] || HERO.student;
  const url = `${origin}/study/`;
  const host = origin.replace(/^https?:\/\//, "");
  const pages = items.map((it) => {
    const ctx = { url, host, name: it.name, org: orgName, code: it.code };
    const steps = k.steps(ctx).map(([t, d, mk, extra], i) => `<li><div class="hd"><span class="num">${i + 1}</span><h3>${esc(t)}</h3></div><div class="pic">${MOCKS[mk]({ ...ctx, ...(extra || {}) })}</div><p>${d}</p></li>`).join("");
    return `
  <section class="page">
    <div class="hero">
      <p class="brand"><span class="mark">SK</span>SK Study</p>
      <h1>参加のご案内</h1>
      <span class="chip">${esc(k.role)}</span>
      <div class="art">${art}</div>
    </div>
    <div class="body">
      <div class="who">
        <p class="name">${esc(it.name)}<small>さん</small></p>
        <p class="meta">${orgName && kind !== "teacher" ? `${esc(k.label)}　<b>${esc(orgName)}</b><br>` : ""}${subName ? `${esc(k.subLabel)}　<b>${esc(subName)}</b>` : ""}</p>
      </div>
      <div class="ticket">
        <div class="key">${TICKET_KEY}</div>
        <p class="cap">参加コード</p>
        <div class="code">${esc(it.code)}</div>
        <p class="once">${esc(k.greet)}　あなた専用 ・ 1 回だけ使えます</p>
      </div>
      <h2>参加のしかた　<small style="font-size:11px;font-weight:500;color:var(--sub)">赤いわくのところを押します</small></h2>
      <ol class="steps">${steps}</ol>
      <ul class="notes">${k.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>
    </div>
    <div class="foot"><span><b>SK Study</b>　単語・プリント・クラス</span><span>${esc(host)}/study/</span></div>
  </section>`;
  }).join("");
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>SK Study 参加のご案内</title><style>${CSS}</style></head><body>${pages}<script>addEventListener("load",function(){setTimeout(function(){print()},400)})</script></body></html>`;
}

// 印刷の画面を開く（ポップアップをさえぎられたら、false）
export function openInviteSheet(opts) {
  const items = (opts.items || []).filter((i) => i && i.code);
  if (!items.length) return false;
  const w = window.open("", "_blank");
  if (!w) return false;
  w.document.open();
  w.document.write(inviteSheetHtml({ ...opts, items }));
  w.document.close();
  return true;
}
