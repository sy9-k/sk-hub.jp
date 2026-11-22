// 早期アクセス（/waiting/）。登録は assets/hub/invite.js の joinWaitlist（hub_waitlist に 1 人 1 回だけ）
import { INVITE_PRODUCTS, joinWaitlist, validEmail } from "/assets/hub/invite.js";

const form = document.getElementById("wt-form");
const formWrap = document.getElementById("wt-form-wrap");
const email = document.getElementById("wt-email");
const submit = document.getElementById("wt-submit");
const msg = document.getElementById("wt-msg");
const done = document.getElementById("wt-done");
const doneTitle = document.getElementById("wt-done-title");
const doneText = document.getElementById("wt-done-text");
const again = document.getElementById("wt-again");

// ?product=study|office で、はじめに選んでおく。ログインのヒントがあれば、メールアドレスを入れておく
const wanted = new URLSearchParams(location.search).get("product");
if (INVITE_PRODUCTS[wanted]) {
  const r = form.querySelector(`input[name="product"][value="${wanted}"]`);
  if (r) r.checked = true;
}
// ?need=invite|google … 招待が必要なページ（Y-FILTER. の管理コンソールなど）から来たとき
const need = new URLSearchParams(location.search).get("need");
if (need === "invite" || need === "google") {
  const name = INVITE_PRODUCTS[wanted] || "このサービス";
  document.getElementById("wt-need-title").textContent = need === "google" ? `${name} は、Google アカウントでログインしてください` : `${name} は、いま招待制です`;
  document.getElementById("wt-need-text").textContent = need === "google"
    ? "招待された方も、そのメールアドレスの Google アカウントでログインしたときだけ開けます。GitHub や LINE など、Google 以外のログインでは開けません。"
    : "このアカウントは、まだ招待されていません。早期アクセスに登録しておくと、順番がきたときにメールでお知らせします。";
  document.getElementById("wt-need").hidden = false;
}
try {
  const hint = JSON.parse(localStorage.getItem("skhub_account") || "null");
  if (hint && typeof hint.email === "string") email.value = hint.email;
} catch (e) { /* ヒントがなくてもよい */ }

function say(text, error) {
  msg.textContent = text;
  msg.classList.toggle("is-error", !!error);
  msg.hidden = false;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.hidden = true;
  const product = form.querySelector('input[name="product"]:checked').value;
  if (!validEmail(email.value)) { say("メールアドレスの形をご確認ください。", true); email.focus(); return; }
  submit.disabled = true;
  try {
    const r = await joinWaitlist(product, email.value);
    const name = INVITE_PRODUCTS[product];
    // 登録できた画面に切りかえる（登録ずみのときも、同じ画面で伝える）
    doneTitle.textContent = r.already ? "すでに登録されています" : "登録しました";
    doneText.textContent = r.already
      ? `${name} の早期アクセスには、このメールアドレスがすでに入っています。順番は変わらないので、そのままお待ちください。`
      : `${name} の早期アクセスに登録しました。順番がきたら、${email.value.trim()} にお知らせします。`;
    formWrap.hidden = true;
    done.hidden = false;
    done.querySelector("h2").focus?.();
  } catch (err) {
    say("登録できませんでした。ネットワークをご確認のうえ、もう一度お試しください。", true);
  } finally {
    submit.disabled = false;
  }
});

// 別のプロダクトも登録する
again.addEventListener("click", () => {
  done.hidden = true;
  formWrap.hidden = false;
  const other = form.querySelector('input[name="product"]:not(:checked)');
  if (other) other.checked = true;
  email.focus();
});
