// 招待の状況（/account/invites/）。ログイン中のアカウントが、どのプロダクトに招待されているかを見せる
//   判定は assets/hub/invite.js の inviteStatus（hub_invites/{メールアドレス} を読む）。ここで招待を変えることはできない
import { accountPageUrl, currentUser } from "/assets/hub/account.js";
import { INVITE_PRODUCTS, WAITING_URL, inviteStatus } from "/assets/hub/invite.js";

// 開くところ（SK Study・Y-FILTER. の管理コンソールは sk-hub.jp の中。SK Office は別のドメイン）
const OPEN = { study: "/study/", office: "https://office.sk-hub.jp/", yfilter: "/y-filter/" };

const who = document.getElementById("iv-who");
const list = document.getElementById("iv-list");

function link(text, href, kind) {
  const a = document.createElement("a");
  a.className = `btn ${kind}`;
  a.href = href;
  a.textContent = text;
  return a;
}

function say(html, buttons) {
  who.replaceChildren();
  const p = document.createElement("p");
  p.innerHTML = html;
  who.append(p);
  if (buttons && buttons.length) {
    const row = document.createElement("div");
    row.className = "btn-row";
    row.append(...buttons);
    who.append(row);
  }
}

function setItem(product, state, tone, actions) {
  const item = list.querySelector(`[data-product="${product}"]`);
  const s = item.querySelector("[data-state]");
  s.textContent = state;
  s.dataset.tone = tone;
  item.querySelector("[data-act]").replaceChildren(...actions);
}

async function main() {
  let user = null;
  try { user = await currentUser(); } catch (e) { user = null; }
  if (!user) {
    say("招待を確かめるには、ログインしてください。招待されたメールアドレスの Google アカウントでログインします。", [link("ログイン", accountPageUrl("/account/invites/"), "btn-primary")]);
    return;
  }
  const email = user.email || "";
  say(`ログイン中のアカウント: <strong></strong>`);
  who.querySelector("strong").textContent = email || "メールアドレスなし";
  list.hidden = false;

  const products = Object.keys(INVITE_PRODUCTS);
  const results = await Promise.all(products.map((p) => inviteStatus(user, p).catch(() => ({ ok: false, reason: "error" }))));
  const notGoogle = results.some((r) => r.reason === "not-google");
  products.forEach((p, i) => {
    const r = results[i];
    if (r.ok) {
      setItem(p, "招待されています", "ok", [link("開く", OPEN[p], "btn-primary")]);
    } else if (r.reason === "error") {
      setItem(p, "確認できませんでした", "warn", [link("もう一度", location.href, "btn-tonal")]);
    } else {
      setItem(p, r.reason === "not-google" ? "Google でログインしてください" : "まだ招待されていません", "off", [link("早期アクセスに登録", WAITING_URL(p), "btn-tonal")]);
    }
  });
  if (notGoogle) {
    say(`ログイン中のアカウントは Google ではないため、招待を確かめられません。招待されたメールアドレスの Google アカウントでログインし直してください。`, [link("ログインし直す", accountPageUrl("/account/invites/"), "btn-tonal")]);
  }
}
main();
