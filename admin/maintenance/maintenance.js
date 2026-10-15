// メンテナンスの告知（/maintenance/）。config/maintenance を変えると、sk-hub.jp の各ページに出る（/assets/maintenance.js）
//   帯を出す（close: false）か、ページを閉じて「ただいまメンテナンス中です」の画面にする（close: true）か
//   { active, close, level: info|warning|maintenance, message, services: [], startsAt, endsAt, updatedAt, updatedBy（管理者の UID） }
//   ページ側は 5 分だけ覚えておくので、変えてから出る・消えるまで最大 5 分かかる
import {
  Timestamp, doc, getDoc, serverTimestamp, setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  $, NEW_ORIGIN, badge, busy, button, card, confirmDialog, db, el, errorNote, explain, fmtDateTime, logAction, me, note, startAdmin, toMillis, toast
} from "/shared/admin.js";

const MESSAGE_MAX = 500;
const LEVELS = [["maintenance", "メンテナンス", "construction"], ["warning", "障害", "warning"], ["info", "お知らせ", "info"]];
const SERVICES = [["y-filter", "Y-FILTER."], ["malu", "MALU"], ["nagi", "Nagi"], ["toolbox", "SK's Toolbox"], ["account", "アカウント"], ["lab", "SK's Lab"], ["view", "SK Share"]];
const TEMPLATES = [
  ["メンテナンスの予定", "maintenance", "○月○日 ○:○○〜○:○○ にメンテナンスを行います。この間、ログインと同期が使えません。"],
  ["障害が起きている", "warning", "現在、一部の機能が使えなくなっています。原因を調べています。ご迷惑をおかけしてすみません。"],
  ["障害が直った", "info", "○時ごろから起きていた障害は直りました。ご迷惑をおかけしました。"]
];

const root = $("[data-page]");
const state = { active: false, close: false, level: "maintenance", message: "", services: [], startsAt: null, endsAt: null };
const MODES = [[false, "帯を出す", "view_day", "ページのいちばん上に帯を出します。ページはふつうに使えます。"], [true, "ページを閉じる", "block", "ページ全体を「ただいまメンテナンス中です」の画面にして、使えなくします。終わると自動で開き直します。稼働状況・規約のページは閉じません。"]];

const current = el("div", "ad-stack");
const form = el("form", "ad-form");
const activeRow = el("label", "ad-switch-row");
const active = el("input", "tbs-switch");
active.type = "checkbox";
activeRow.append(el("span", null, "告知を出す"), active);
const modeTabs = el("div", "ad-tabs");
const modeHint = el("p", "ad-hint");
MODES.forEach(([v, label, ic]) => {
  const b = el("button", "tbs-chip m3-state");
  b.type = "button";
  b.dataset.mode = String(v);
  const i = el("span", "msr", ic);
  i.setAttribute("aria-hidden", "true");
  b.append(i, document.createTextNode(label));
  b.addEventListener("click", () => { state.close = v; sync(); });
  modeTabs.append(b);
});
const levelTabs = el("div", "ad-tabs");
LEVELS.forEach(([v, label, ic]) => {
  const b = el("button", "tbs-chip m3-state");
  b.type = "button";
  b.dataset.level = v;
  const i = el("span", "msr", ic);
  i.setAttribute("aria-hidden", "true");
  b.append(i, document.createTextNode(label));
  b.addEventListener("click", () => { state.level = v; sync(); });
  levelTabs.append(b);
});
const msgField = el("label", "m3-field");
const msg = el("textarea");
msg.rows = 3;
msg.maxLength = MESSAGE_MAX;
msgField.append(el("span", "m3-field__label", `お知らせの文（${MESSAGE_MAX} 文字まで）`), msg);
const templates = el("div", "ad-row");
templates.append(el("span", "ad-hint", "ひな形:"));
TEMPLATES.forEach(([label, level, text]) => templates.append(button(label, { kind: "text-btn", onClick: () => { state.level = level; msg.value = text; sync(); msg.focus(); } })));
const svcBox = el("div", "ad-tabs");
SERVICES.forEach(([v, label]) => {
  const b = el("button", "tbs-chip m3-state", label);
  b.type = "button";
  b.dataset.service = v;
  b.addEventListener("click", () => {
    state.services = state.services.includes(v) ? state.services.filter((s) => s !== v) : [...state.services, v];
    sync();
  });
  svcBox.append(b);
});
const svcHint = el("p", "ad-hint");
const times = el("div", "ad-fields");
const timeField = (label) => {
  const f = el("label", "m3-field");
  const i = el("input", "m3-field__input");
  i.type = "datetime-local";
  f.append(el("span", "m3-field__label", label), i);
  times.append(f);
  return i;
};
const startsAt = timeField("出し始める日時（空ならすぐ）");
const endsAt = timeField("消す日時（空なら消すまで）");
const preview = el("div");
const save = button("保存する", { iconName: "save", type: "submit" });
const saveRow = el("div", "ad-row ad-row--end");
saveRow.append(save);
const skipHint = el("p", "ad-hint", "閉じているあいだに自分でページを確かめるときは、URL の最後に ?maintenance=skip を付けて開きます（そのタブだけ、閉じずに帯になります）。");
form.append(activeRow, modeTabs, modeHint, levelTabs, msgField, templates, el("p", "ad-hint", "出すページ（選ばなければすべてのページ）"), svcBox, svcHint, times, el("p", "ad-hint", "プレビュー"), preview, skipHint, saveRow);

const toLocal = (ms) => {
  if (!ms) return "";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocal = (v) => (v ? new Date(v).getTime() : null);

function sync() {
  levelTabs.querySelectorAll("[data-level]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.level === state.level)));
  svcBox.querySelectorAll("[data-service]").forEach((b) => b.setAttribute("aria-pressed", String(state.services.includes(b.dataset.service))));
  modeTabs.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === String(state.close))));
  modeHint.textContent = MODES.find((x) => x[0] === state.close)[3];
  skipHint.hidden = !state.close;
  const names = state.services.map((s) => SERVICES.find((x) => x[0] === s)[1]).join("・");
  svcHint.textContent = state.close
    ? (state.services.length ? `閉じるページ: ${names}（ほかのページには帯を出します）` : "すべてのページを閉じます（稼働状況・規約は閉じません）。")
    : (state.services.length ? `出すページ: ${names}（とホーム・稼働状況・サポート）` : "すべてのページに出します。");
  renderPreview();
}
function renderPreview() {
  const M = window.SKMaintenance;
  if (!M) { preview.replaceChildren(el("p", "ad-hint", "プレビューを読み込めませんでした")); return; }
  const data = { level: state.level, message: msg.value.trim() || (state.close ? "" : "（お知らせの文）"), startsAt: fromLocal(startsAt.value), endsAt: fromLocal(endsAt.value) };
  preview.className = state.close ? "ad-closed-preview" : "ad-banner-preview";
  preview.replaceChildren(state.close ? M.renderClosed(data) : M.render(data, true));
  preview.querySelectorAll("button, a").forEach((b) => { b.tabIndex = -1; b.addEventListener("click", (e) => e.preventDefault()); });
}
msg.addEventListener("input", renderPreview);
startsAt.addEventListener("input", renderPreview);
endsAt.addEventListener("input", renderPreview);

function renderCurrent(m) {
  const now = Date.now();
  const r = el("div", "ad-row");
  if (!m) { r.append(badge("まだ一度も出していません")); current.replaceChildren(r); return; }
  const live = window.SKMaintenance ? window.SKMaintenance.live(m, now) : m.active;
  const scheduled = m.active && !live && m.startsAt && toMillis(m.startsAt) > now;
  const what = m.close ? "ページを閉じて" : "帯を出して";
  r.append(live ? badge(m.close ? "ページを閉じています" : "帯を出しています", m.close ? "error" : "warn")
    : scheduled ? badge(`${fmtDateTime(m.startsAt)} から${what}います`, "info") : badge("出していません", "ok"));
  r.append(el("span", "ad-hint", `最後に変えた日時 ${fmtDateTime(m.updatedAt)}${m.updatedBy && me() && m.updatedBy === me().uid ? "（自分）" : ""}`));
  const open = el("a", "text-btn m3-state", "sk-hub.jp で見る");
  open.href = `${NEW_ORIGIN}/`;
  open.target = "_blank";
  open.rel = "noopener";
  r.append(el("span", "ad-grow"), open);
  current.replaceChildren(r);
  if (m.active && m.message) current.append(el("p", "ad-msg", m.message));
}

async function load() {
  try {
    const snap = await getDoc(doc(db, "config", "maintenance"));
    const m = snap.exists() ? snap.data() : null;
    if (m) {
      state.active = !!m.active;
      state.close = !!m.close;
      state.level = m.level || "maintenance";
      state.services = Array.isArray(m.services) ? m.services : [];
      msg.value = m.message || "";
      startsAt.value = toLocal(toMillis(m.startsAt));
      endsAt.value = toLocal(toMillis(m.endsAt));
    }
    active.checked = state.active;
    renderCurrent(m);
  } catch (err) {
    current.replaceChildren(err.code === "permission-denied" ? note("まだ一度も出していないか、Firestore のルールが反映されていません。") : errorNote(err));
  }
  sync();
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  busy(save, async () => {
    const message = msg.value.trim();
    const start = fromLocal(startsAt.value);
    const end = fromLocal(endsAt.value);
    if (active.checked && !state.close && !message) { toast("お知らせの文を入れてください"); msg.focus(); return; }
    if (start && end && end <= start) { toast("消す日時は、出し始める日時より後にしてください"); endsAt.focus(); return; }
    if (active.checked && state.close) {
      const where = state.services.length ? state.services.map((x) => SERVICES.find((y) => y[0] === x)[1]).join("・") : "sk-hub.jp のすべて";
      const ok = await confirmDialog({
        title: "ページを閉じますか？",
        text: `${where}のページが${start && start > Date.now() ? ` ${fmtDateTime(start)} から` : ""}使えなくなります（稼働状況・規約は閉じません）。5 分ほどで閉じます。`,
        ok: "閉じる", danger: true, icon: "block"
      });
      if (!ok) return;
    }
    const data = {
      active: active.checked,
      close: state.close,
      level: state.level,
      message: message.slice(0, MESSAGE_MAX),
      services: state.services,
      startsAt: start ? Timestamp.fromMillis(start) : null,
      endsAt: end ? Timestamp.fromMillis(end) : null,
      updatedAt: serverTimestamp(),
      updatedBy: me().uid
    };
    try {
      await setDoc(doc(db, "config", "maintenance"), data);
      logAction("maintenance.save", state.level, `${!data.active ? "出さない" : data.close ? "ページを閉じる" : "帯を出す"}「${message.slice(0, 60)}」`);
      toast(!data.active ? "保存しました。5 分ほどで元に戻ります" : data.close ? "保存しました。5 分ほどでページが閉じます" : "保存しました。5 分ほどで各ページに出ます");
      load();
    } catch (err) {
      toast(explain(err));
    }
  });
});

root.append(card("campaign", "いまの状態", current), card("edit", "告知を変える", form));

startAdmin({ page: "maintenance", onReady: load });
