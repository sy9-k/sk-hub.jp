// 期限切れのデータの掃除（/cleanup/ と、ダッシュボード・お問い合わせを開いたときの自動の掃除）
// Firestore の TTL は有料プランが必要なので、管理者が画面を開いたときに消す（SK プライバシーポリシー第七条・SK Hub Systems 規約第六条）
//   auto: true のものは、ダッシュボードかお問い合わせを開いたときに自動で消す（12 時間に 1 回まで）
//   それ以外は /cleanup/ で数を確かめてから消す
import {
  Timestamp, collection, limit, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { DAY_MS, YEAR_MS, countWhere, db, logAction, purgeWhere } from "/shared/admin.js";

const HOUR_MS = 60 * 60 * 1000;
const now = () => Timestamp.now();
const before = (ms) => Timestamp.fromMillis(Date.now() - ms);

export const TASKS = [
  {
    id: "contacts",
    auto: true,
    icon: "mail",
    label: "対応から 1 年たったお問い合わせ",
    desc: "対応済みにしてから 1 年（expireAt）を過ぎたもの。",
    query: () => query(collection(db, "contacts"), where("expireAt", "<", now()))
  },
  {
    id: "accessLogs",
    auto: true,
    icon: "receipt_long",
    label: "1 年を過ぎたアクセスチェックの記録",
    desc: "RedFlag Checker（frameworks/check.js）の hub_access_logs。",
    query: () => query(collection(db, "hub_access_logs"), where("createdAt", "<", before(YEAR_MS)))
  },
  {
    id: "adminLogs",
    auto: true,
    icon: "history",
    label: "1 年を過ぎた操作の記録",
    desc: "管理画面の操作の記録（adminLogs）。",
    query: () => query(collection(db, "adminLogs"), where("expireAt", "<", now()))
  },
  {
    id: "pairingCodes",
    icon: "pin",
    label: "期限切れのペアリングコード",
    desc: "Y-FILTER. の端末をつなぐ 8 文字のコード。期限から 1 時間を過ぎたもの。",
    query: () => query(collection(db, "pairingCodes"), where("expiresAt", "<", before(HOUR_MS)))
  },
  {
    id: "teamInvites",
    icon: "group_add",
    label: "期限切れの共同管理者の招待コード",
    desc: "管理グループへの招待コード。期限から 1 時間を過ぎたもの。",
    query: () => query(collection(db, "teamInvites"), where("expiresAt", "<", before(HOUR_MS)))
  },
  {
    id: "requestsDecided",
    icon: "rule",
    label: "返事をして 7 日たったリクエスト",
    desc: "Y-FILTER. の「このサイトを開きたい」「あと○分使いたい」で、許可・却下してから 7 日を過ぎたもの（管理コンソールと同じ）。",
    query: () => query(collection(db, "requests"), where("decidedAt", "<", before(7 * DAY_MS)))
  },
  {
    id: "requestsOld",
    icon: "hourglass_bottom",
    label: "30 日より前のリクエスト",
    desc: "返事がないまま 30 日を過ぎたものも含めて、30 日より前に送られたリクエスト。",
    query: () => query(collection(db, "requests"), where("createdAt", "<", before(30 * DAY_MS)))
  },
  {
    id: "devicesIdle",
    icon: "devices_off",
    label: "1 年以上つながっていない端末",
    desc: "最後の報告から 1 年を過ぎた Y-FILTER. の端末（SK Hub Systems 規約 第六条6）。持ち主の管理グループから消えます。",
    danger: true,
    query: () => query(collection(db, "devices"), where("reported.lastSeenAt", "<", before(YEAR_MS)))
  },
  {
    id: "timetableInvites",
    icon: "event_busy",
    label: "期限切れの時間割の招待コード",
    desc: "SK's Toolbox の Timetable の招待コード（timetableInvites）。ルールを合わせるまでは「権限がありません」と出ます。",
    query: () => query(collection(db, "timetableInvites"), where("expiresAt", "<", now()))
  }
];

export async function countTask(task) {
  return countWhere(task.query());
}

export async function runTask(task) {
  return purgeWhere(query(task.query(), limit(400)));
}

// 自動の掃除（12 時間に 1 回まで）。消した数を返す
const AUTO_KEY = "sk_admin_autoclean";
export async function autoCleanup() {
  try {
    const last = Number(localStorage.getItem(AUTO_KEY) || 0);
    if (Date.now() - last < 12 * HOUR_MS) return null;
    localStorage.setItem(AUTO_KEY, String(Date.now()));
  } catch (e) { /* 保存できないときも続ける */ }
  const result = {};
  for (const task of TASKS.filter((t) => t.auto)) {
    try { result[task.id] = await runTask(task); } catch (err) { result[task.id] = null; }
  }
  const total = Object.values(result).reduce((a, b) => a + (b || 0), 0);
  if (total) logAction("cleanup.auto", "", TASKS.filter((t) => result[t.id]).map((t) => `${t.label} ${result[t.id]} 件`).join("・"));
  return { result, total };
}

