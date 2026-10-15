// 移行の進み具合（/migration/）。アクセスチェックの記録（hub_access_logs）の直近 30 日を、
//   page が sk-hub.jp か sy9-k.github.io かで日ごとに数える（最大 5000 件をブラウザで集計）
//   ・人数はサポート ID の数。サポート ID はアドレスごとに別なので、同じ人が両方で 1 人ずつ数えられることがある
//   ・記録は、規約に同意して RedFlag Checker が動いたページだけ（/moved/・/move/ などは数えない）
//   旧ドメインのサポートを終える時期を決めるときに使う（_build/README.md の「旧ドメインのサポートを終えるとき」）
import {
  collection, getDocs, limit, orderBy, query, where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  $, DAY_MS, NEW_ORIGIN, ago, badge, button, card, db, el, empty, errorNote, num, startAdmin
} from "/shared/admin.js";

const OLD_ORIGIN = "https://sy9-k.github.io";
const MAX = 5000;
const root = $("[data-page]");
const summary = el("div", "ad-grid");
const daily = el("div", "ad-stack");
const pages = el("div", "ad-stack");

const pct = (a, b) => (a + b ? Math.round((a / (a + b)) * 100) : 0);
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function stat(title, value, unit, sub) {
  const c = el("section", "ad-card");
  c.append(el("h2", "ad-card__title", title));
  const s = el("p", "ad-stat", value);
  if (unit) s.append(el("small", null, unit));
  c.append(s);
  if (sub) c.append(el("p", "ad-card__sub", sub));
  return c;
}

async function load() {
  summary.replaceChildren(el("p", "ad-hint", "読み込み中…"));
  daily.replaceChildren();
  pages.replaceChildren();
  try {
    const snap = await getDocs(query(collection(db, "hub_access_logs"), where("createdAt", ">=", ago(30 * DAY_MS)), orderBy("createdAt", "desc"), limit(MAX)));
    const days = new Map();
    const oldPages = new Map();
    const week = { old: 0, new: 0, oldIds: new Set(), newIds: new Set() };
    const weekAgo = Date.now() - 7 * DAY_MS;
    snap.docs.forEach((d) => {
      const x = d.data();
      const page = x.page || "";
      const side = page.startsWith(NEW_ORIGIN) ? "new" : page.startsWith(OLD_ORIGIN) ? "old" : null;
      if (!side) return;
      const ms = x.createdAt && x.createdAt.toMillis ? x.createdAt.toMillis() : 0;
      const key = dayKey(ms);
      if (!days.has(key)) days.set(key, { old: 0, new: 0 });
      days.get(key)[side] += 1;
      if (ms >= weekAgo) {
        week[side] += 1;
        week[`${side}Ids`].add(x.uuid);
      }
      if (side === "old") {
        const path = page.slice(OLD_ORIGIN.length) || "/";
        oldPages.set(path, (oldPages.get(path) || 0) + 1);
      }
    });

    const p = pct(week.new, week.old);
    summary.replaceChildren(
      stat("直近 7 日の sk-hub.jp の割合", String(p), "%", p >= 95 ? "ほとんどの人が新しいアドレスを使っています" : "まだ古いアドレスで開いている人がいます"),
      stat("sk-hub.jp（7 日）", num(week.newIds.size), "人", `${num(week.new)} 回開かれました`),
      stat("sy9-k.github.io（7 日）", num(week.oldIds.size), "人", `${num(week.old)} 回開かれました`)
    );

    // 日ごと（新しい日が上）
    if (!days.size) {
      daily.replaceChildren(empty("直近 30 日の記録はありません。", "receipt_long"));
    } else {
      const legend = el("div", "ad-legend");
      const lNew = el("span");
      const iNew = el("i");
      iNew.style.background = "var(--md-primary)";
      lNew.append(iNew, document.createTextNode("sk-hub.jp"));
      const lOld = el("span");
      const iOld = el("i");
      iOld.style.background = "#e5793f";
      lOld.append(iOld, document.createTextNode("sy9-k.github.io"));
      legend.append(lNew, lOld);
      const bars = el("div", "ad-bars");
      const max = Math.max(...[...days.values()].map((v) => v.old + v.new));
      [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).forEach(([key, v]) => {
        const rowEl = el("div", "ad-bars__row");
        const track = el("div", "ad-bars__track");
        const segNew = el("span", "ad-bars__seg ad-bars__seg--new");
        segNew.style.width = `${(v.new / max) * 100}%`;
        const segOld = el("span", "ad-bars__seg ad-bars__seg--old");
        segOld.style.width = `${(v.old / max) * 100}%`;
        track.append(segNew, segOld);
        track.title = `sk-hub.jp ${v.new} 回・sy9-k.github.io ${v.old} 回`;
        rowEl.append(el("span", "ad-bars__num", key.slice(5).replace("-", "/")), track, el("span", "ad-bars__num", `${pct(v.new, v.old)}%（${num(v.new + v.old)}）`));
        bars.append(rowEl);
      });
      daily.replaceChildren(legend, bars);
    }
    if (snap.size >= MAX) daily.append(el("p", "ad-hint", `新しい ${num(MAX)} 件から数えています（古い日は少なく出ます）。`));

    // 旧ドメインでよく開かれているページ
    const top = [...oldPages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
    if (!top.length) pages.replaceChildren(empty("旧ドメインで開かれたページはありません。", "check_circle"));
    else {
      const wrap = el("div", "ad-table-wrap");
      const table = el("table", "ad-table");
      const hr = el("tr");
      hr.append(el("th", null, "ページ（sy9-k.github.io）"), el("th", "ad-num", "回数"));
      const thead = el("thead");
      thead.append(hr);
      const tbody = el("tbody");
      top.forEach(([path, n]) => {
        const tr = el("tr");
        tr.append(el("td", "ad-mono", path), el("td", "ad-num", num(n)));
        tbody.append(tr);
      });
      table.append(thead, tbody);
      wrap.append(table);
      pages.replaceChildren(wrap, el("p", "ad-hint", "ホーム画面に追加したアプリ（PWA）やブックマークから、古いアドレスで開いている人が多いページです。"));
    }
  } catch (err) {
    summary.replaceChildren(errorNote(err));
  }
}

const reload = button("読み込み直す", { kind: "m3-btn m3-btn--tonal", iconName: "refresh", small: true, onClick: load });
const head = el("div", "ad-row ad-row--end");
head.append(badge("直近 30 日"), el("span", "ad-grow"), reload);
root.append(head, summary, card("bar_chart", "日ごとの割合", daily), card("history", "旧ドメインでよく開かれているページ（30 日）", pages));

startAdmin({ page: "migration", onReady: load });
