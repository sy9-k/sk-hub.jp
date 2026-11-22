// 招待のメール（POST admin.sk-hub.jp/api/invite-mail）。管理画面の「招待と早期アクセス」（admin/invites/）が呼ぶ
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
  office: { name: "SK Office", url: "https://office.sk-hub.jp/", what: "文書・表・プレゼンテーションを作るアプリ（Doc・Sheet・Slide）" },
  yfilter: { name: "Y-FILTER.", url: "https://sk-hub.jp/y-filter/", what: "有害なサイトのブロックや利用時間の管理ができるブラウザフィルター" }
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
    `${names} に、招待されました。`,
    "",
    "いまは、招待した人だけが使えます。下のページを開いて、ログインするとはじめられます。",
    "",
    ...items.flatMap((x) => [`${x.name}（${x.what}）`, x.url, ""]),
    `ログインは、このメールアドレス（${email}）の Google アカウントで行ってください。GitHub や LINE など、Google 以外のログインでは開けません。`,
    "SK Hub Systems のアカウントがまだない場合も、ログインの画面から無料で作れます。",
    "",
    "心当たりがない場合は、このメールを破棄してください。",
    "",
    "---",
    `You have been invited to ${names}. Open the link above and sign in to your SK Hub Systems account with the Google account for ${email}.`,
    "",
    "SK Hub Systems",
    "https://sk-hub.jp/"
  ].join("\n");
  // 見た目は SK のトップページ・SK's Brand にそろえる（飾りは足さない）
  //   ・文字: 見出し 800・本文 400（行間 1.75）・ラベル 12/800 字間 .14em。メールは Web フォントが使えないので、日本語の標準のフォントにする
  //   ・色: 黒（#0d1014）・灰（#5a6371）・線（#e1e4e9）・地（#f5f6f8）。青は小さなラベルとリンクだけ
  //   ・形: カード 28・アイコン 12・ボタンは丸（トップページの「プロダクトを見る」と同じ黒い丸ボタン）
  //   ・ことば: です・ます、短く、やさしく、次にすることを伝える（SK's Brand「ことば」）。日本語と英数字のあいだは半角スペース
  //   ・画像は sk-hub.jp に置いてある PNG（SVG はメールで出ないことがある）。ダークモードは prefers-color-scheme で色を入れかえる
  const ICONS = { study: "https://sk-hub.jp/study/ico/icon-192.png", office: "https://office.sk-hub.jp/icons/office-logo.png", yfilter: "https://sk-hub.jp/y-filter/shared/icon-128.png" };
  const row = (p, last) => {
    const x = PRODUCTS[p];
    return `
          <tr><td class="sk-line" style="padding:20px 0;${last ? "" : "border-bottom:1px solid #e1e4e9"}">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
              <td width="52" valign="top"><img src="${esc(ICONS[p])}" width="40" height="40" alt="" style="display:block;border:0;border-radius:12px"></td>
              <td valign="top">
                <p class="sk-ink" style="margin:0;font-size:17px;font-weight:800;line-height:1.5;color:#0d1014">${esc(x.name)}</p>
                <p class="sk-muted" style="margin:2px 0 14px;font-size:13px;line-height:1.7;color:#5a6371">${esc(x.what)}</p>
                <a class="sk-btn" href="${esc(x.url)}" style="display:inline-block;padding:13px 24px;border-radius:999px;background:#0d1014;color:#f5f6f8;font-size:14px;font-weight:800;line-height:1;text-decoration:none">${esc(x.name)} を開く&nbsp;&rarr;</a>
              </td>
            </tr></table>
          </td></tr>`;
  };
  const html = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${esc(subject)}</title>
<style>
  @media (prefers-color-scheme: dark) {
    .sk-bg { background:#0d1014 !important }
    .sk-card { background:#161a21 !important; border-color:#2a303b !important }
    .sk-ink { color:#f1f3f7 !important }
    .sk-muted { color:#a3acba !important }
    .sk-line { border-color:#2a303b !important }
    .sk-btn { background:#f1f3f7 !important; color:#0d1014 !important }
    .sk-foot, .sk-foot a { color:#7d8696 !important }
  }
  @media (max-width: 480px) { .sk-pad { padding-left:22px !important; padding-right:22px !important } .sk-h1 { font-size:22px !important } }
</style></head>
<body class="sk-bg" style="margin:0;padding:0;background:#f5f6f8;font-family:'Inter','Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','Yu Gothic UI','Yu Gothic',Meiryo,sans-serif;color:#0d1014">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;line-height:1px">${esc(names)} を使えるようになりました。</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="sk-bg" style="background:#f5f6f8"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px">
      <tr><td style="padding:0 4px 18px">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td valign="middle"><img src="https://sk-hub.jp/assets/apple-touch-icon.png" width="32" height="32" alt="SK" style="display:block;border:0;border-radius:8px"></td>
          <td valign="middle" style="padding-left:10px"><span class="sk-ink" style="font-size:16px;font-weight:800;letter-spacing:-.01em;color:#0d1014">SK</span></td>
        </tr></table>
      </td></tr>
      <tr><td class="sk-card sk-pad" style="background:#ffffff;border:1px solid #e1e4e9;border-radius:28px;padding:36px 36px 12px">
        <p style="margin:0 0 14px;font-size:12px;font-weight:800;letter-spacing:.14em;color:#2563eb">&mdash;&nbsp; 招待</p>
        <h1 class="sk-ink sk-h1" style="margin:0 0 16px;font-size:26px;line-height:1.5;font-weight:800;letter-spacing:-.01em;color:#0d1014">${esc(names)} に、<br>招待されました。</h1>
        <p class="sk-muted" style="margin:0 0 8px;font-size:15px;line-height:1.75;color:#5a6371">いまは、招待した人だけが使えます。下のボタンを開いて、ログインするとはじめられます。</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0 0">${items.map((_, i) => row(products[i], i === items.length - 1)).join("")}
        </table>
      </td></tr>
      <tr><td style="padding:24px 8px 0">
        <p class="sk-muted" style="margin:0 0 10px;font-size:13px;line-height:1.8;color:#5a6371">ログインは、このメールアドレス（<strong class="sk-ink" style="color:#0d1014">${esc(email)}</strong>）の Google アカウントで行ってください。GitHub や LINE など、Google 以外のログインでは開けません。</p>
        <p class="sk-muted" style="margin:0;font-size:13px;line-height:1.8;color:#5a6371">SK Hub Systems のアカウントがまだない場合も、ログインの画面から無料で作れます。</p>
      </td></tr>
      <tr><td class="sk-foot" style="padding:28px 8px 0;font-size:12px;line-height:1.8;color:#8a93a3">
        心当たりがない場合は、このメールを破棄してください。<br>
        <a href="https://sk-hub.jp/" style="color:#8a93a3;text-decoration:underline">sk-hub.jp</a>
        <p lang="en" style="margin:14px 0 0;font-size:11px;line-height:1.7;color:#8a93a3">You have been invited to ${esc(names)}. Open a button above and sign in to your SK Hub Systems account with the Google account for ${esc(email)}.</p>
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
