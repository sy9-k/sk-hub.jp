// 招待制（SK Study・SK Office は、いまは招待した人だけが開ける）
//   ・招待 = hub_invites/{メールアドレス（小文字）} に { products: ["study", "office"], ... } を置くこと（開発者が管理画面 /invites/ で追加する）
//     招待すると、使いはじめ方のメールが自動で届く（admin.sk-hub.jp の /api/invite-mail。_workers/admin/README.md）
//   ・招待された人は、その Google アカウントでログインしたときだけ開ける（Google 以外のログインでは開けない）
//   ・順番待ち = hub_waitlist/{プロダクト}__{メールアドレス}。だれでも 1 回だけ登録できる（読めるのは開発者だけ）
//   ・データの形と権限は y-filter リポジトリの systems/firestore.rules の「hub_invites」「hub_waitlist」
//   ・この画面の判定は、使いはじめの入り口を閉じるためのもの。SK Study のクラスなどの Firestore のデータは、ルール側でも守る（invitedTo('study')）
//   ・SK Hub Office（office.sk-hub.jp）は、office リポジトリの shared/invite-gate.js が bridge（op: "invite"）で聞く
import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "/assets/hub/account.js";

export const INVITE_PRODUCTS = { study: "SK Study", office: "SK Office" };
export const WAITING_URL = (product) => `/waiting/?product=${encodeURIComponent(product)}`;

export const emailKey = (email) => String(email || "").trim().toLowerCase();
const EMAIL_RE = /^[^\s@/]{1,64}@[^\s@/]{1,190}\.[^\s@/]{2,}$/;
export const validEmail = (email) => EMAIL_RE.test(emailKey(email)) && emailKey(email).length <= 254;

// 招待されているか。{ ok, reason }  reason: not-google（Google 以外でログイン）/ not-invited（招待されていない）
// 確かめられなかったとき（ネットワークなど）は例外を投げる
export async function inviteStatus(user, product) {
  const tok = await user.getIdTokenResult();
  if (tok.signInProvider !== "google.com") return { ok: false, reason: "not-google" };
  if (!user.email || !user.emailVerified) return { ok: false, reason: "not-invited" };
  const snap = await getDoc(doc(db, "hub_invites", emailKey(user.email)));
  const data = snap.exists() ? snap.data() : null;
  const ok = !!data && Array.isArray(data.products) && (data.products.includes(product) || data.products.includes("*"));
  return ok ? { ok: true } : { ok: false, reason: "not-invited" };
}

// 順番待ちに登録する。登録済みのときは { already: true }
export async function joinWaitlist(product, email) {
  const e = emailKey(email);
  if (!INVITE_PRODUCTS[product]) throw new Error("product");
  if (!validEmail(e)) throw new Error("email");
  try {
    await setDoc(doc(db, "hub_waitlist", `${product}__${e}`), { product, email: e, createdAt: serverTimestamp() });
    return { already: false };
  } catch (err) {
    // 同じ人が 2 回目に登録すると、ルールが断る（更新はできない）= 登録済み
    if (err && err.code === "permission-denied") return { already: true };
    throw err;
  }
}
