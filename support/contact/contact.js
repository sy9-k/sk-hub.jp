// お問い合わせフォーム（https://support.sk-hub.jp/contact/。元は sk-hub.jp の /support/contact/）
// SK Hub Systems（Cloud Firestore の contacts）に REST API で 1 件追加する。Firebase の SDK は使わない。
// 送られた内容は、開発者だけが /inbox/ で読める（y-filter リポジトリの systems/firestore.rules）。
(function () {
  "use strict";

  const HUB = { projectId: "y-filter-systems", apiKey: "AIzaSyB4gqzPEPyP0NrEJw33-OTAxUrF48MmiuI" }; // frameworks/check.js と同じ
  const URL_ = `https://firestore.googleapis.com/v1/projects/${HUB.projectId}/databases/(default)/documents/contacts?key=${HUB.apiKey}`;
  const MAX = 2000;
  const COOLDOWN_MS = 60 * 1000; // 続けて送れるのは 1 分に 1 回まで
  const COOLDOWN_KEY = "skhub_contact_sent";
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

  const t = window.SKI18N ? window.SKI18N.t : (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m)) : s);
  const form = document.querySelector("[data-contact]");
  if (!form) return;
  const done = document.querySelector("[data-contact-done]");
  const msg = form.querySelector("[data-contact-msg]");
  const submit = form.querySelector("[data-contact-submit]");
  const count = form.querySelector("[data-contact-count]");
  const message = form.elements.message;

  // どれについてか: ページの ?product= で選んでおける（例: https://support.sk-hub.jp/contact/?product=y-filter）
  const preset = new URLSearchParams(location.search).get("product");
  if (preset && [...form.elements.product.options].some((o) => o.value === preset)) form.elements.product.value = preset;

  message.addEventListener("input", () => { count.textContent = `${message.value.length} / ${MAX}`; });

  const lastSent = () => { try { return Number(localStorage.getItem(COOLDOWN_KEY) || 0); } catch (e) { return 0; } };
  const supportId = () => { try { return localStorage.getItem("skhub_uuid") || ""; } catch (e) { return ""; } };

  // SK Hub Systems アカウントでログイン中なら、返事をアカウントのお知らせで受け取れる（uid を添えて、ログインの証明つきで送る）
  // support.sk-hub.jp では、ログインは sk-hub.jp にあるので、橋渡し（support/support.js の SKBridge）から受け取る
  const bridge = window.SKBridge;
  const viaBridge = location.hostname === "support.sk-hub.jp" && !!bridge;
  const accountOption = form.querySelector("[data-contact-account]");
  const loggedIn = () => { try { return !!localStorage.getItem("skhub_account"); } catch (e) { return false; } };
  const showAccountOption = () => { if (accountOption) accountOption.hidden = !loggedIn(); };
  showAccountOption();
  if (viaBridge) bridge.ready.then(showAccountOption);
  async function accountAuth() {
    if (!accountOption || accountOption.hidden || !form.elements.account.checked) return null;
    try {
      if (viaBridge) return await bridge.token();
      const { currentUser } = await import("/assets/hub/account.js");
      const user = await currentUser();
      if (!user) return null;
      return { uid: user.uid, token: await user.getIdToken() };
    } catch (e) {
      return null; // 読み込めなければ、アカウントなしで送る
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.textContent = "";
    const text = message.value.trim();
    const email = form.elements.email.value.trim();
    if (form.elements.website.value) return; // 人には見えない欄に入力がある = 機械的な送信
    if (text.length < 5) { msg.textContent = t("内容を 5 文字以上書いてください。"); message.focus(); return; }
    if (email && !EMAIL_PATTERN.test(email)) { msg.textContent = t("メールアドレスの形を確認してください。"); form.elements.email.focus(); return; }
    const wait = COOLDOWN_MS - (Date.now() - lastSent());
    if (wait > 0) { msg.textContent = t("続けて送るには、あと {n} 秒お待ちください。", { n: Math.ceil(wait / 1000) }); return; }

    const attach = form.elements.attach.checked;
    const id = supportId();
    const fields = {
      kind: { stringValue: form.elements.kind.value },
      product: { stringValue: form.elements.product.value },
      message: { stringValue: text.slice(0, MAX) },
      email: { stringValue: email },
      supportId: { stringValue: attach && UUID_PATTERN.test(id) ? id : "" },
      userAgent: { stringValue: attach ? navigator.userAgent.slice(0, 512) : "" },
      language: { stringValue: attach ? String(navigator.language || "").slice(0, 32) : "" },
      status: { stringValue: "new" },
      createdAt: { timestampValue: new Date().toISOString() }
    };

    submit.disabled = true;
    submit.textContent = t("送信しています…");
    try {
      const headers = { "Content-Type": "application/json" };
      const account = await accountAuth();
      if (account) {
        fields.uid = { stringValue: account.uid };
        headers.Authorization = `Bearer ${account.token}`;
      }
      const res = await fetch(URL_, {
        method: "POST",
        headers,
        body: JSON.stringify({ fields }),
        credentials: "omit",
        referrerPolicy: "no-referrer"
      });
      if (!res.ok) throw new Error(String(res.status));
      const doc = await res.json();
      try { localStorage.setItem(COOLDOWN_KEY, String(Date.now())); } catch (err) { /* 保存できなくても送れる */ }
      done.querySelector("[data-contact-receipt]").textContent = String(doc.name || "").split("/").pop().slice(0, 8).toUpperCase();
      form.hidden = true;
      done.hidden = false;
      done.focus();
      form.reset();
      count.textContent = `0 / ${MAX}`;
    } catch (err) {
      msg.textContent = t("送信できませんでした。時間をおいてもう一度お試しください。続くときは、システム稼働状況をご確認ください。");
    } finally {
      submit.disabled = false;
      submit.textContent = t("送信する");
    }
  });

  done.querySelector("[data-contact-again]").addEventListener("click", () => {
    done.hidden = true;
    form.hidden = false;
    message.focus();
  });
})();
