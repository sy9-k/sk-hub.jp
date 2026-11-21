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
  const button = (x) => `
        <tr><td style="padding:0 0 16px">
          <a href="${esc(x.url)}" style="display:block;padding:16px 20px;border-radius:16px;background:#eef0ff;color:#1b1f3b;text-decoration:none">
            <strong style="font-size:17px">${esc(x.name)}</strong><br>
            <span style="font-size:13px;color:#4a4f6a">${esc(x.what)}</span><br>
            <span style="font-size:13px;color:#3d5afe">${esc(x.url)}</span>
          </a>
        </td></tr>`;
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f6fb;font-family:'Hiragino Sans','Yu Gothic',Meiryo,sans-serif;color:#1b1f3b">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6fb"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:24px">
      <tr><td style="padding:32px 28px 8px">
        <p style="margin:0 0 4px;font-size:13px;color:#4a4f6a">SK Hub Systems</p>
        <h1 style="margin:0 0 16px;font-size:22px;line-height:1.4">${esc(names)} に招待されました</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.8">下のページを開いて、<strong>このメールアドレス（${esc(email)}）の Google アカウント</strong>で SK Hub Systems アカウントにログインすると使えます。Google 以外の方法（GitHub・LINE など）でログインすると開けません。</p>
      </td></tr>
      <tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${items.map(button).join("")}
      </table></td></tr>
      <tr><td style="padding:4px 28px 28px;font-size:13px;line-height:1.8;color:#4a4f6a">
        アカウントをまだ持っていない方も、ログインの画面から無料で作れます。<br>
        心当たりのない方は、このメールを破棄してください。
        <p style="margin:16px 0 0;font-size:12px;color:#6b7090" lang="en">You have been invited to ${esc(names)}. Open the link above and sign in to your SK Hub Systems account with the Google account for ${esc(email)}.</p>
      </td></tr>
    </table>
    <p style="margin:16px 0 0;font-size:12px;color:#6b7090"><a href="https://sk-hub.jp/" style="color:#6b7090">sk-hub.jp</a></p>
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
