// LINE の中の SK's Toolbox で、SK Hub Systems アカウントを使う（ES モジュール。/toolbox/shared/line.js が、使うときだけ読み込む）
//   ・ログイン: LIFF のアクセストークンを api.sk-hub.jp に送り、LINE ログインと同じアカウントに入る（assets/hub/account.js の signInWithLiff）
//     アカウントの作成（規約への同意）・Toolbox への接続がまだなら、いつもどおり /account/ で行う（LINE の中の画面のまま。終わったら戻ってくる）
//   ・公式 LINE（SK Hub）: 友だちか・お知らせを LINE で受け取るか（api.sk-hub.jp の /line/status・/line/notify）
import { ACCOUNT_TERMS_VERSION, accountPageUrl, currentUser, db, isConnected, lineStatus, rememberAccount, setLineNotify, signInWithLiff } from "/assets/hub/account.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// 戻り値: "ready"（使える）| "redirect"（/account/ に移動した）。つながったアカウントがなく create でなければ、code sk/not-linked で断られる
export async function signIn(accessToken, create) {
  const { user } = await signInWithLiff(accessToken, create);
  const snap = await getDoc(doc(db, "accounts", user.uid));
  const account = snap.exists() ? snap.data() : null;
  if (!account || account.termsVersion !== ACCOUNT_TERMS_VERSION || !isConnected(account, "toolbox")) {
    location.href = accountPageUrl(location.pathname + location.search + location.hash, "toolbox");
    return "redirect";
  }
  rememberAccount(user, account);
  return "ready";
}

function signedOut() { const e = new Error("signed-out"); e.code = "sk/signed-out"; return e; }

export async function status() {
  const user = await currentUser();
  if (!user) throw signedOut();
  return lineStatus(user);
}

export async function setNotify(on) {
  const user = await currentUser();
  if (!user) throw signedOut();
  return setLineNotify(user, on);
}
