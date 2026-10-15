// ダッシュボード（/）。毎日最初に開く画面
//   上: 数（未対応のお問い合わせ・未処理のリクエスト・アカウント・端末・SK Share・記事）。数は getCountFromServer で数えるだけ
//   下: 稼働状況・メンテナンスの告知・移行（直近 24 時間）・最近のお問い合わせ・最近の操作
//   開いたときに、期限切れのデータを自動で消す（/shared/housekeeping.js。12 時間に 1 回まで）
import {
  collection, doc, getDocFromServer, getDocs, limit, orderBy, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "/y-filter/firebase-config.js";
import {
  DAY_MS, LOG_LABEL, NEW_ORIGIN, $, ago, badge, card, countWhere, db, el, empty, errorNote, fmtAgo, fmtDateTime, icon, listItem, num,
  setBadge, startAdmin, toMillis
} from "/shared/admin.js";
import { autoCleanup } from "/shared/housekeeping.js";

const KIND = { bug: "不具合", question: "質問", request: "要望", data: "データ", other: "その他" };

function hello() {
  const h = new Date().getHours();
  $("[data-dash-hello]").textContent = h < 5 ? "おつかれさまです" : h < 11 ? "おはようございます" : h < 18 ? "こんにちは" : "こんばんは";
  $("[data-dash-date]").textContent = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
}

// 数のカード。load() は { value, unit, sub, alert } を返す
function statCard({ iconName, title, href, load }) {
  const c = el(href ? "a" : "section", "ad-card");
  if (href) c.href = href;
  const h = el("h2", "ad-card__title");
  h.append(icon(iconName), document.createTextNode(title));
  if (href) h.append(el("span", "ad-card__more", "開く ›"));
  const stat = el("p", "ad-stat", "…");
  const sub = el("p", "ad-card__sub", "");
  c.append(h, stat, sub);
  load().then((r) => {
    stat.textContent = num(r.value);
    if (r.unit) stat.append(el("small", null, r.unit));
    stat.classList.toggle("is-alert", !!r.alert);
    sub.textContent = r.sub || "";
  }, (err) => {
    stat.textContent = "-";
    sub.replaceWith(errorNote(err));
  });
  return c;
}

function renderStats() {
  const minutesAgo = (m) => ago(m * 60 * 1000);
  $("[data-dash-stats]").replaceChildren(
    statCard({
      iconName: "inbox", title: "未対応のお問い合わせ", href: "/inbox/",
      load: async () => {
        const n = await countWhere(query(collection(db, "contacts"), where("status", "==", "new")));
        setBadge("inbox", n);
        return { value: n, unit: "件", alert: n > 0, sub: n ? "返事をするか、対応済みにしましょう" : "すべて対応済みです" };
      }
    }),
    statCard({
      iconName: "rule", title: "Y-FILTER. の未処理のリクエスト",
      load: async () => {
        const n = await countWhere(query(collection(db, "requests"), where("status", "==", "pending")));
        return { value: n, unit: "件", sub: "返事は各管理グループの管理コンソールで行います" };
      }
    }),
    statCard({
      iconName: "group", title: "アカウント", href: "/accounts/",
      load: async () => {
        const [total, week] = await Promise.all([
          countWhere(collection(db, "accounts")),
          countWhere(query(collection(db, "accounts"), where("createdAt", ">=", ago(7 * DAY_MS))))
        ]);
        return { value: total, unit: "人", sub: `この 7 日間で ${num(week)} 人増えました` };
      }
    }),
    statCard({
      iconName: "devices", title: "Y-FILTER. の端末",
      load: async () => {
        const [total, online] = await Promise.all([
          countWhere(collection(db, "devices")),
          countWhere(query(collection(db, "devices"), where("reported.lastSeenAt", ">=", minutesAgo(15))))
        ]);
        return { value: total, unit: "台", sub: `いまオンライン ${num(online)} 台（15 分以内に報告）` };
      }
    }),
    statCard({
      iconName: "lock_open", title: "SK Share のページ", href: "/share/",
      load: async () => ({ value: await countWhere(collection(db, "viewPages")), unit: "件" })
    }),
    statCard({
      iconName: "edit_note", title: "公開中の記事", href: "/articles/",
      load: async () => {
        const [pub, total] = await Promise.all([
          countWhere(query(collection(db, "articles"), where("published", "==", true))),
          countWhere(collection(db, "articles"))
        ]);
        return { value: pub, unit: "件", sub: total > pub ? `下書き ${num(total - pub)} 件` : "" };
      }
    })
  );
}

// ---------- 稼働状況 ----------
const SLOW_MS = 2500;
async function timed(fn) {
  const start = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    await fn(controller.signal);
    const ms = Math.round(performance.now() - start);
    return { state: ms > SLOW_MS ? "slow" : "ok", ms };
  } catch (err) {
    return { state: "down", ms: null, note: err.name === "AbortError" ? "10 秒以内に応答がありません" : (err.code || err.message) };
  } finally {
    clearTimeout(timer);
  }
}
const CHECKS = [
  { label: "sk-hub.jp（サイト）", run: (signal) => fetch(`${NEW_ORIGIN}/`, { mode: "no-cors", cache: "no-store", signal }) },
  { label: "sy9-k.github.io（旧ドメイン）", run: (signal) => fetch("https://sy9-k.github.io/", { mode: "no-cors", cache: "no-store", signal }) },
  { label: "admin.sk-hub.jp（管理画面）", run: (signal) => fetch("/shared/admin.css", { cache: "no-store", signal }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); }) },
  { label: "データベース（Firestore）", run: () => getDocFromServer(doc(db, "config", "categories")) },
  {
    label: "ログイン（Firebase Authentication）",
    run: (signal) => fetch(`https://www.googleapis.com/identitytoolkit/v3/relyingparty/getProjectConfig?key=${firebaseConfig.apiKey}`, { cache: "no-store", signal })
      .then((r) => { if (!r.ok && r.status !== 403) throw new Error(`HTTP ${r.status}`); })
  }
];
const STATE = { ok: ["正常", "ok"], slow: ["遅延", "warn"], down: ["停止", "error"] };
function statusPanel() {
  const list = el("ul", "ad-list");
  const more = el("a", "ad-card__more", "公開の稼働状況 ›");
  more.href = "https://sk-hub.online/";
  more.target = "_blank";
  more.rel = "noopener";
  const c = card("monitor_heart", "稼働状況", list);
  c.querySelector(".ad-card__title").append(more);
  CHECKS.forEach((check) => {
    const end = badge("確認中");
    const li = listItem({ iconName: "radio_button_checked", title: check.label, sub: "", end });
    list.append(li);
    timed(check.run).then((r) => {
      const [label, kind] = STATE[r.state];
      end.replaceWith(badge(label, kind));
      li.querySelector(".ad-li__sub").textContent = r.ms != null ? `${r.ms} ms` : r.note || "";
    });
  });
  return c;
}

// ---------- メンテナンスの告知 ----------
function maintenancePanel() {
  const body = el("div", "ad-stack");
  body.append(el("p", "ad-hint", "読み込み中…"));
  const c = card("construction", "メンテナンスの告知", body);
  const more = el("a", "ad-card__more", "変える ›");
  more.href = "/maintenance/";
  c.querySelector(".ad-card__title").append(more);
  getDocFromServer(doc(db, "config", "maintenance")).then((snap) => {
    const m = snap.exists() ? snap.data() : null;
    const now = Date.now();
    const live = m && m.active && (!m.startsAt || toMillis(m.startsAt) <= now) && (!m.endsAt || toMillis(m.endsAt) > now);
    const scheduled = m && m.active && !live && m.startsAt && toMillis(m.startsAt) > now;
    const row = el("div", "ad-row");
    row.append(live ? badge(m.close ? "ページを閉じています" : "帯を出しています", m.close ? "error" : "warn") : scheduled ? badge(m.close ? "閉じる予定" : "帯の予定", "info") : badge("出していません", "ok"));
    if (m && m.active && m.endsAt) row.append(el("span", "ad-hint", `${fmtDateTime(m.endsAt)} まで`));
    body.replaceChildren(row);
    if (m && m.active && m.message) body.append(el("p", "ad-msg", m.message));
  }, (err) => body.replaceChildren(err.code === "permission-denied" ? el("p", "ad-hint", "まだ一度も告知を出していないか、ルールが反映されていません。") : errorNote(err)));
  return c;
}

// ---------- 移行（直近 24 時間のアクセスチェックの記録） ----------
function migrationPanel() {
  const body = el("div", "ad-stack");
  body.append(el("p", "ad-hint", "読み込み中…"));
  const c = card("moving", "移行（直近 24 時間）", body);
  const more = el("a", "ad-card__more", "くわしく ›");
  more.href = "/migration/";
  c.querySelector(".ad-card__title").append(more);
  getDocs(query(collection(db, "hub_access_logs"), where("createdAt", ">=", ago(DAY_MS)), limit(2000))).then((snap) => {
    let oldN = 0;
    let newN = 0;
    const oldIds = new Set();
    const newIds = new Set();
    snap.docs.forEach((d) => {
      const { page = "", uuid = "" } = d.data();
      if (page.startsWith("https://sy9-k.github.io")) { oldN += 1; oldIds.add(uuid); } else if (page.startsWith(NEW_ORIGIN)) { newN += 1; newIds.add(uuid); }
    });
    const total = oldN + newN;
    const pct = total ? Math.round((newN / total) * 100) : 0;
    const stat = el("p", "ad-stat", total ? `${pct}` : "-");
    if (total) stat.append(el("small", null, "% が sk-hub.jp"));
    const track = el("div", "ad-bars__track");
    const segNew = el("span", "ad-bars__seg ad-bars__seg--new");
    segNew.style.width = `${pct}%`;
    const segOld = el("span", "ad-bars__seg ad-bars__seg--old");
    segOld.style.width = `${total ? 100 - pct : 0}%`;
    track.append(segNew, segOld);
    body.replaceChildren(stat, track, el("p", "ad-hint",
      `sk-hub.jp ${num(newN)} 件（${num(newIds.size)} 人）・sy9-k.github.io ${num(oldN)} 件（${num(oldIds.size)} 人）${snap.size >= 2000 ? "（最新 2000 件から）" : ""}`));
  }, (err) => body.replaceChildren(errorNote(err)));
  return c;
}

// ---------- 最近のお問い合わせ ----------
function contactsPanel() {
  const list = el("ul", "ad-list");
  const c = card("mail", "最近のお問い合わせ", list);
  const more = el("a", "ad-card__more", "すべて ›");
  more.href = "/inbox/";
  c.querySelector(".ad-card__title").append(more);
  getDocs(query(collection(db, "contacts"), orderBy("createdAt", "desc"), limit(5))).then((snap) => {
    if (snap.empty) { list.replaceWith(empty("お問い合わせはありません。")); return; }
    list.replaceChildren(...snap.docs.map((d) => {
      const x = d.data();
      return listItem({
        iconName: x.status === "done" ? "drafts" : "mark_email_unread",
        title: (x.message || "").slice(0, 60) + ((x.message || "").length > 60 ? "…" : ""),
        sub: `${KIND[x.kind] || x.kind || ""}・${fmtAgo(x.createdAt)}`,
        end: x.status === "done" ? badge("対応済み") : badge("未対応", "error"),
        href: "/inbox/"
      });
    }));
  }, (err) => list.replaceWith(errorNote(err)));
  return c;
}

// ---------- 最近の操作 ----------
function logsPanel() {
  const list = el("ul", "ad-list");
  const c = card("history", "最近の操作", list);
  const more = el("a", "ad-card__more", "すべて ›");
  more.href = "/logs/";
  c.querySelector(".ad-card__title").append(more);
  getDocs(query(collection(db, "adminLogs"), orderBy("createdAt", "desc"), limit(6))).then((snap) => {
    if (snap.empty) { list.replaceWith(empty("まだ操作の記録はありません。", "history")); return; }
    list.replaceChildren(...snap.docs.map((d) => {
      const x = d.data();
      return listItem({ iconName: "history", title: LOG_LABEL[x.action] || x.action, sub: [x.detail || x.target, fmtAgo(x.createdAt)].filter(Boolean).join("・") });
    }));
  }, (err) => list.replaceWith(errorNote(err)));
  return c;
}

// ---------- アクセスの制限 ----------
function accessPanel() {
  const body = el("div", "ad-stack");
  body.append(el("p", "ad-hint", "読み込み中…"));
  const c = card("shield_person", "アクセスの制限", body);
  const more = el("a", "ad-card__more", "開く ›");
  more.href = "/access/";
  c.querySelector(".ad-card__title").append(more);
  countWhere(collection(db, "hub_blocklist")).then((n) => {
    const stat = el("p", "ad-stat", num(n));
    stat.append(el("small", null, "件のサポート ID を制限中"));
    body.replaceChildren(stat);
  }, (err) => body.replaceChildren(errorNote(err)));
  return c;
}

function renderPanels() {
  $("[data-dash-panels]").replaceChildren(statusPanel(), contactsPanel(), migrationPanel(), maintenancePanel(), logsPanel(), accessPanel());
}

async function cleanupNote() {
  const box = $("[data-dash-clean]");
  const done = await autoCleanup().catch(() => null);
  if (!done || !done.total) return;
  box.replaceChildren(icon("cleaning_services"), el("span", null, `期限切れのデータを ${num(done.total)} 件、自動で消しました（くわしくは「操作の記録」）。`));
  box.hidden = false;
}

function renderAll() {
  hello();
  renderStats();
  renderPanels();
}

$("[data-dash-reload]").addEventListener("click", renderAll);
startAdmin({
  page: "dashboard",
  onReady: () => {
    renderAll();
    cleanupNote();
  }
});
