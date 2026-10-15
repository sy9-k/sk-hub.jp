// アクセスの制限（hub_blocklist）。ドキュメント ID = 制限するサポート ID（端末のブラウザごとの ID。frameworks/check.js の skhub_uuid）
//   ドキュメントがあれば制限（中身は見ていない）。frameworks/check-heavy.js が ID を指定して 1 件だけ読む
//   管理画面から作るものは { reason, createdAt, createdBy（管理者の UID） }。Firebase コンソールで作った、中身のないものもある
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, logAction, me } from "/shared/admin.js";

export const SUPPORT_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export const REASON_MAX = 200;

export async function isBlocked(supportId) {
  return (await getDoc(doc(db, "hub_blocklist", supportId))).exists();
}

export async function block(supportId, reason) {
  const id = supportId.trim().toLowerCase();
  if (!SUPPORT_ID.test(id)) throw Object.assign(new Error("サポート ID の形が違います（8-4-4-4-12 の英数字）"), { code: "invalid-argument" });
  await setDoc(doc(db, "hub_blocklist", id), { reason: String(reason || "").slice(0, REASON_MAX), createdAt: serverTimestamp(), createdBy: me().uid });
  logAction("block.add", id, reason || "");
  return id;
}

export async function unblock(supportId) {
  await deleteDoc(doc(db, "hub_blocklist", supportId));
  logAction("block.remove", supportId, "");
}
