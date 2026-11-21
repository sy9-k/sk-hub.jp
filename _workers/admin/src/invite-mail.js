// 招待のメール（POST admin.sk-hub.jp/api/invite-mail）。管理画面の「招待と順番待ち」（admin/invites/）が呼ぶ
//   受け取るもの: Authorization: Bearer <Firebase の ID トークン>、本文 { email }
//   ・開発者かどうかは、そのトークンで Firestore の config/developers を読めるかで確かめる（ルールで、登録された本人だけが読める）。
//     トークンが本物かどうかも Firestore が確かめるので、ここで署名を調べなくてよい
//   ・送るのは、hub_invites/{email} に招待があるときだけ（招待のプロダクトを、そのまま本文に入れる）。ほかのアドレスには送れない
//   ・送るのは Resend（https://resend.com/）。API キーは Worker のシークレット RESEND_API_KEY（手順は ../README.md）
//   ・送れたら { ok: true }。送った日時（hub_invites の mailedAt）は、管理画面が入れる
const PROJECT = "y-filter-systems";
const FIRESTORE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const EMAIL_RE = /^[^\s@/]{1,64}@[^\s@/]{1,190}\.[^\s@/]{2,}$/;

const PRODUCTS = {
  study: { name: "SK Study", url: "https://sk-hub.jp/study/", what: "単語カード・小テスト・プリント・クラスで学習するアプリ" },
  office: { name: "SK Office", url: "https://office.sk-hub.jp/", what: "文書・表・プレゼンテーションを作るアプリ（Doc・Sheet・Slide）" }
};

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" }
});

const readDoc = (path, token) => fetch(`${FIRESTORE}/${path}`, { headers: { Authorization: `Bearer ${token}` } });

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// 招待のプロダクト（Firestore の REST の形）→ ["study", "office"]
function productsOf(doc) {
  const values = doc && doc.fields && doc.fields.products && doc.fields.products.arrayValue && doc.fields.products.arrayValue.values || [];
  const list = values.map((v) => v.stringValue).filter(Boolean);
  if (list.includes("*")) return Object.keys(PRODUCTS);
  return list.filter((p) => PRODUCTS[p]);
}

export function inviteMail(email, products) {
  const items = products.map((p) => PRODUCTS[p]);
  const names = items.map((x) => x.name).join("・");
  const subject = `${names} に招待されました`;
  const text = [
    `${names} に招待されました。`,
    "",
    "使いはじめるには、下のページを開いて「SK Hub Systems アカウント」に、",
    `このメールアドレス（${email}）の Google アカウントでログインしてください。`,
    "Google 以外の方法（GitHub・LINE など）でログインすると開けません。",
    "",
    ...items.flatMap((x) => [`■ ${x.name} … ${x.what}`, `  ${x.url}`, ""]),
    "アカウントをまだ持っていない方も、ログインの画面から無料で作れます。",
    "心当たりのない方は、このメールを破棄してください。",
    "",
    "---",
    `You have been invited to ${names}. Open the link above and sign in to your SK Hub Systems account with the Google account for ${email}.`,
    "",
    "SK Hub Systems",
    "https://sk-hub.jp/"
  ].join("\n");
  // SK らしい見た目: SK's Blue・やさしいことば・静かな余白。メールは Web フォントが使えないので、日本語の標準のフォントにする
  //   画像は sk-hub.jp に置いてある PNG（SVG はメールで出ないことがある）。ダークモードは prefers-color-scheme で色を入れかえる
  const ACCENT = { study: "#2563eb", office: "#d97706" };
  const STEPS = [
    ["上のボタンを開く", "SK Hub Systems アカウントのログインの画面が開きます。"],
    ["このメールアドレスの Google でログイン", `<strong style="font-weight:700">${esc(email)}</strong> の Google アカウントで。アカウントがなくても、その画面から無料で作れます。`],
    ["はじめる", "ログインできたら、そのまま使いはじめられます。"]
  ];
  const step = ([title, body], i) => `
        <tr>
          <td width="36" valign="top" style="padding:0 0 14px"><div class="sk-num" style="width:28px;height:28px;border-radius:14px;background:#e6efff;color:#2563eb;font-size:14px;font-weight:700;line-height:28px;text-align:center">${i + 1}</div></td>
          <td valign="top" style="padding:0 0 14px"><p class="sk-ink" style="margin:0;font-size:15px;font-weight:700;line-height:1.6;color:#0d1014">${esc(title)}</p><p class="sk-muted" style="margin:2px 0 0;font-size:13px;line-height:1.7;color:#5a6371">${body}</p></td>
        </tr>`;
  const card = (p) => {
    const x = PRODUCTS[p];
    const c = ACCENT[p] || ACCENT.study;
    return `
        <tr><td style="padding:0 0 12px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="sk-panel" style="border-radius:20px;background:#f3f6ff;border:1px solid #dbe5ff">
            <tr><td style="padding:18px 20px 20px">
              <p class="sk-ink" style="margin:0 0 2px;font-size:17px;font-weight:700;line-height:1.5;color:#0d1014"><span style="display:inline-block;width:8px;height:8px;border-radius:4px;background:${c};margin-right:8px"></span>${esc(x.name)}</p>
              <p class="sk-muted" style="margin:0 0 16px;font-size:13px;line-height:1.7;color:#5a6371">${esc(x.what)}</p>
              <a href="${esc(x.url)}" style="display:inline-block;padding:13px 26px;border-radius:999px;background:${c};color:#ffffff;font-size:15px;font-weight:700;line-height:1;text-decoration:none">${esc(x.name)} を開く&nbsp;&rarr;</a>
            </td></tr>
          </table>
        </td></tr>`;
  };
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(subject)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .sk-bg { background:#0d1014 !important }
    .sk-card { background:#161a21 !important }
    .sk-ink { color:#f1f3f7 !important }
    .sk-muted { color:#a3acba !important }
    .sk-panel { background:#1b2434 !important; border-color:#2f4a7a !important }
    .sk-num { background:#1c2c4d !important; color:#8fb0ff !important }
    .sk-note { background:#1f2530 !important }
    .sk-line { border-color:#2a303b !important }
    .sk-foot, .sk-foot a { color:#7d8696 !important }
  }
  @media (max-width: 480px) { .sk-pad { padding-left:22px !important; padding-right:22px !important } }
</style></head>
<body class="sk-bg" style="margin:0;padding:0;background:#f5f6f8;font-family:'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic UI','Yu Gothic','Noto Sans JP',Meiryo,sans-serif;color:#0d1014">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px">${esc(names)} を使えるようになりました。下のボタンから、はじめられます。</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="sk-bg" style="background:#f5f6f8"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px">
      <tr><td style="padding:0 4px 16px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle"><img src="https://sk-hub.jp/assets/apple-touch-icon.png" width="36" height="36" alt="" style="display:block;border:0;border-radius:9px"></td>
          <td valign="middle" style="padding-left:10px"><span class="sk-ink" style="font-size:15px;font-weight:700;color:#0d1014">SK Hub Systems</span></td>
        </tr></table>
      </td></tr>
      <tr><td class="sk-card" style="background:#ffffff;border-radius:28px;overflow:hidden">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr><td style="height:6px;line-height:6px;font-size:0;background:#2563eb;background-image:linear-gradient(90deg,#2563eb,#5a5fe0)">&nbsp;</td></tr>
          <tr><td class="sk-pad" style="padding:32px 32px 4px">
            <p style="margin:0 0 10px"><span style="display:inline-block;padding:4px 12px;border-radius:999px;background:#e6efff;color:#2563eb;font-size:12px;font-weight:700;letter-spacing:.06em">ご招待</span></p>
            <h1 class="sk-ink" style="margin:0 0 12px;font-size:24px;line-height:1.45;font-weight:800;color:#0d1014">${esc(names)} に<br>招待されました</h1>
            <p class="sk-muted" style="margin:0 0 24px;font-size:15px;line-height:1.9;color:#5a6371">いまは、招待した方だけに公開しています。お待たせしました。下のボタンから、すぐにはじめられます。</p>
          </td></tr>
          <tr><td class="sk-pad" style="padding:0 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.map((_, i) => card(products[i])).join("")}
          </table></td></tr>
          <tr><td class="sk-pad" style="padding:12px 32px 0">
            <p class="sk-ink" style="margin:0 0 14px;font-size:14px;font-weight:700;color:#0d1014">はじめかた</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${STEPS.map(step).join("")}
            </table>
          </td></tr>
          <tr><td class="sk-pad" style="padding:4px 32px 0">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="sk-note" style="border-radius:16px;background:#f5f6f8"><tr><td style="padding:14px 18px">
              <p class="sk-muted" style="margin:0;font-size:13px;line-height:1.8;color:#5a6371"><strong class="sk-ink" style="color:#0d1014">ご注意</strong><br>Google 以外の方法（GitHub・LINE など）でログインすると、開けません。かならず、このメールアドレスの Google アカウントでログインしてください。</p>
            </td></tr></table>
          </td></tr>
          <tr><td class="sk-pad" style="padding:24px 32px 32px">
            <p class="sk-muted" style="margin:0;font-size:12px;line-height:1.8;color:#5a6371">心当たりのない方は、このメールを破棄してください。</p>
            <p class="sk-muted" lang="en" style="margin:12px 0 0;padding-top:12px;border-top:1px solid #e1e4e9;font-size:12px;line-height:1.7;color:#8a93a3">You have been invited to ${esc(names)}. Open a button above and sign in to your SK Hub Systems account with the Google account for ${esc(email)}.</p>
          </td></tr>
        </table>
      </td></tr>
      <tr><td align="center" class="sk-foot" style="padding:20px 8px 0;font-size:12px;line-height:1.8;color:#8a93a3">
        毎日のネットを、もう少し安心で便利に。<br>
        <a href="https://sk-hub.jp/" style="color:#8a93a3;text-decoration:underline">sk-hub.jp</a>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
  return { subject, text, html };
}

export async function handleInviteMail(request, env) {
  const url = new URL(request.url);
  if (request.method !== "POST") return json({ error: "method" }, 405);
  // 管理画面（このアドレス）からだけ
  if (request.headers.get("Origin") !== url.origin) return json({ error: "origin" }, 403);
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || token.length > 4096) return json({ error: "signed-out" }, 401);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "bad-request" }, 400); }
  const email = String((body && body.email) || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) return json({ error: "bad-request" }, 400);

  // 開発者か（config/developers を読めるのは、登録された本人だけ）
  const dev = await readDoc("config/developers", token);
  if (dev.status === 401) return json({ error: "signed-out" }, 401);
  if (!dev.ok) return json({ error: "not-developer" }, 403);

  // 招待されているか
  const inv = await readDoc(`hub_invites/${encodeURIComponent(email)}`, token);
  if (inv.status === 404) return json({ error: "not-invited" }, 404);
  if (!inv.ok) return json({ error: "firestore" }, 502);
  const products = productsOf(await inv.json());
  if (!products.length) return json({ error: "not-invited" }, 404);

  if (!env.RESEND_API_KEY) return json({ error: "mail-not-configured" }, 503);
  const mail = inviteMail(email, products);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.MAIL_FROM || "SK Hub Systems <noreply@sk-hub.jp>",
      to: [email],
      ...(env.MAIL_REPLY_TO ? { reply_to: env.MAIL_REPLY_TO } : {}),
      subject: mail.subject,
      text: mail.text,
      html: mail.html
    })
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("resend", res.status, detail.slice(0, 500));
    return json({ error: "mail-failed", status: res.status }, 502);
  }
  return json({ ok: true, products });
}
