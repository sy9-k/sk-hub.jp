// 順番待ち（/waiting/）。登録は assets/hub/invite.js の joinWaitlist（hub_waitlist に 1 人 1 回だけ）
import { INVITE_PRODUCTS, joinWaitlist, validEmail } from "/assets/hub/invite.js";

const form = document.getElementById("wt-form");
const email = document.getElementById("wt-email");
const submit = document.getElementById("wt-submit");
const msg = document.getElementById("wt-msg");

// ?product=study|office で、はじめに選んでおく。ログインのヒントがあれば、メールアドレスを入れておく
const wanted = new URLSearchParams(location.search).get("product");
if (INVITE_PRODUCTS[wanted]) {
  const r = form.querySelector(`input[name="product"][value="${wanted}"]`);
  if (r) r.checked = true;
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
  const product = form.querySelector('input[name="product"]:checked').value;
  if (!validEmail(email.value)) { say("メールアドレスの形をご確認ください。", true); email.focus(); return; }
  submit.disabled = true;
  try {
    const r = await joinWaitlist(product, email.value);
    say(r.already
      ? `${INVITE_PRODUCTS[product]} の順番待ちには、すでに登録されています（登録の確認だけで、順番は変わりません）。`
      : `${INVITE_PRODUCTS[product]} の順番待ちに登録しました。順番がきたら、このメールアドレスにお知らせします。`);
    if (!r.already) email.value = "";
  } catch (err) {
    say("登録できませんでした。ネットワークをご確認のうえ、もう一度お試しください。", true);
  } finally {
    submit.disabled = false;
  }
});
