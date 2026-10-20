// SK Study の設定（#/settings、#/settings/<カテゴリ>）
//   MALU・Nagi の設定と同じ形（SK Material）。広い画面は左にカテゴリ、右に中身。
//   スマホは Android の設定アプリと同じで、最初はカテゴリの一覧（大きな「設定」・検索）、押すと中身に切りかわる
//   カテゴリ: 学習・読み上げ・表示・アカウント・データ・このアプリについて
import * as store from "./store.js";
import * as cloud from "./cloud.js";

export const VERSION = "0.2（試作）";
const THEME_KEY = "sk_theme";       // サイト全体の「表示」と同じ（assets/site.js）
const BACKUP_APP = "sk-study";

const CATEGORIES = [
  { key: "learn", icon: "school", name: "学習", sub: "問題の数・問題の形式", words: "学習 問題 数 形式 4 択 書き取り おまかせ 難易度" },
  { key: "speech", icon: "record_voice_over", name: "読み上げ", sub: "自動で読み上げ・速さ・声", words: "読み上げ 音声 声 速さ 自動 発音" },
  { key: "display", icon: "palette", name: "表示", sub: "ライト・ダーク", words: "表示 テーマ ライト ダーク 色 画面 明るさ" },
  { key: "account", icon: "person", name: "アカウント", sub: "SK Hub Systems アカウント", words: "アカウント ログイン クラス SK Hub Systems" },
  { key: "data", icon: "storage", name: "データ", sub: "書き出し・読みこみ・記録を消す", words: "データ バックアップ 書き出し 読みこみ 記録 消す キャッシュ 保存" },
  { key: "about", icon: "info", name: "このアプリについて", sub: "バージョン・ホーム画面に追加", words: "このアプリについて バージョン ホーム画面に追加 インストール 利用規約 プライバシーポリシー" }
];

const narrow = () => window.matchMedia("(max-width: 820px)").matches;

// ---------- 表示（ライト・ダーク） ----------

export function readTheme() {
  try {
    const v = JSON.parse(localStorage.getItem(THEME_KEY) || "{}");
    return { ...v, mode: v.mode === "light" || v.mode === "dark" ? v.mode : "auto" };
  } catch (e) {
    return { mode: "auto" };
  }
}

// ブラウザの上の帯の色（theme-color）を、いまの背景の色に合わせる
export function applyThemeColor() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--surface").trim();
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (readTheme().mode === "auto") m.setAttribute("content", m.media && m.media.includes("dark") ? "#10131c" : "#faf8ff");
    else m.setAttribute("content", bg);
  });
}

function saveTheme(mode) {
  const t = readTheme();
  t.mode = mode;
  try { localStorage.setItem(THEME_KEY, JSON.stringify(t)); } catch (e) {}
  const root = document.documentElement;
  if (mode === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", mode);
  applyThemeColor();
}

// ---------- データ ----------

function studyKeys() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("sk_study_")) keys.push(k);
  }
  return keys.sort();
}

function backupBlob() {
  const data = {};
  for (const k of studyKeys()) data[k] = localStorage.getItem(k);
  return new Blob([JSON.stringify({ app: BACKUP_APP, version: 1, at: new Date().toISOString(), data }, null, 1)], { type: "application/json" });
}

function counts() {
  const len = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || "null"); return Array.isArray(v) ? v.length : v && typeof v === "object" ? Object.keys(v).length : 0; } catch (e) { return 0; } };
  let words = 0;
  try { for (const set of Object.values(JSON.parse(localStorage.getItem("sk_study_progress") || "{}"))) words += Object.keys(set || {}).length; } catch (e) {}
  return { sets: len("sk_study_sets"), prints: len("sk_study_prints"), words, tests: len("sk_study_tests") };
}

// ---------- 画面 ----------

// ui: app.js の部品（h・icon・button・linkButton・toast・confirmDialog・go・app・speechPanel・install）
export function renderSettings(key, ui) {
  const { h, icon, button, toast, confirmDialog, go, app } = ui;
  const cat = CATEGORIES.find((c) => c.key === key) || null;
  if (key && !cat) { go("/settings", true); return; }
  const current = cat || (narrow() ? null : CATEGORIES[0]);
  document.title = current ? `${current.name} - 設定 - SK Study` : "設定 - SK Study";

  // 項目（左に名前と説明、右に操作）
  const item = (title, desc, ...end) => h("div", { class: "settings-item" },
    h("div", null, h("p", { class: "settings-item__title" }, title), desc ? h("p", { class: "settings-item__description" }, desc) : null),
    ...end);
  const action = (label, onclick, extra = {}) => h("button", { type: "button", class: `settings-action${extra.danger ? " settings-action--danger" : ""}`, onclick }, label);
  const linkAction = (label, href, ext = false) => h("a", { class: "settings-action", href, ...(ext ? { target: "_blank", rel: "noopener" } : {}) }, label);

  const sections = {
    learn() {
      const prefs = store.getPrefs();
      const count = h("select", { class: "field-select settings-select", "aria-label": "1 回の問題の数", onchange: (e) => { store.setPrefs({ count: Number(e.target.value) }); toast("保存しました"); } },
        ui.COUNTS.map(([v, label]) => h("option", { value: String(v), selected: prefs.count === v }, label)));
      const format = h("select", { class: "field-select settings-select", "aria-label": "問題の形式", onchange: (e) => { store.setPrefs({ format: e.target.value }); toast("保存しました"); } },
        ui.FORMATS.map(([v, label]) => h("option", { value: v, selected: prefs.format === v }, label)));
      return [
        item("1 回の問題の数", "「学習する」「小テスト」で出す問題の数", count),
        item("問題の形式", "おまかせは、覚えぐあいに合わせて 4 択と書き取りを切りかえます", format),
        h("p", { class: "settings-note" }, icon("info"), "単語セットの画面で変えたときも、ここに反映されます。")
      ];
    },
    speech() {
      const panel = ui.speechPanel();
      stopOnLeave.push(() => panel.stop());
      return [h("div", { class: "settings-card" }, panel)];
    },
    display() {
      const mode = readTheme().mode;
      const seg = h("div", { class: "segmented small settings-theme", role: "radiogroup", "aria-label": "テーマ" });
      const draw = (m) => seg.replaceChildren(...[["auto", "端末に合わせる"], ["light", "ライト"], ["dark", "ダーク"]].map(([v, label]) =>
        h("button", { type: "button", role: "radio", "aria-checked": String(m === v), onclick: () => { saveTheme(v); draw(v); } }, label)));
      draw(mode);
      return [
        h("div", { class: "settings-item settings-item--col" },
          h("div", null, h("p", { class: "settings-item__title" }, "テーマ"),
            h("p", { class: "settings-item__description" }, "SK のサイト全体の「表示」と同じ設定です。ここで変えると、ほかのページにも反映されます。")),
          seg),
        h("p", { class: "settings-note" }, icon("palette"), "SK Study は SK Material（Google の Material Design 3 がもと）で作っています。")
      ];
    },
    account() {
      const box = h("div", { class: "settings-card account-box" }, h("p", { class: "settings-item__description" }, "確認中…"));
      cloud.session().then((s) => {
        const who = s.name ? h("div", { class: "account-user" },
          h("span", { class: "account-avatar", "aria-hidden": "true" }, String(s.name).trim().slice(0, 1).toUpperCase() || "?"),
          h("div", null, h("strong", null, s.name), s.user && s.user.email ? h("small", null, s.user.email) : null)) : null;
        const text = {
          ready: "ログインしています。クラスに参加したり、課題を提出したりできます。",
          "not-connected": "ログインしていますが、SK Study とまだつながっていません。つなぐとクラスを使えます。",
          unregistered: "アカウントの登録が終わっていません。",
          "signed-out": "ログインすると、先生のクラスに参加して課題を提出できます。単語帳と学習の記録は、ログインしなくても使えます。",
          offline: "オフラインのため、確認できませんでした。"
        }[s.status] || "";
        box.replaceChildren(...[
          who,
          h("p", { class: "settings-item__description" }, text),
          h("div", { class: "account-actions" },
            s.status === "ready" ? ui.linkButton("tonal", "アカウントの設定", "manage_accounts", "/account/")
              : s.status === "offline" ? null
                : ui.linkButton("filled", s.status === "signed-out" ? "ログイン" : "SK Study とつなぐ", "login", cloud.accountUrl(true)))
        ].filter(Boolean));
      });
      return [box, h("p", { class: "settings-note" }, icon("lock"), "マイ単語帳・学習の記録・プリントは、このブラウザの中だけに保存します（クラスの提出だけはアカウントに送ります）。")];
    },
    data() {
      const c = counts();
      const file = h("input", { type: "file", accept: ".json,application/json", hidden: true, onchange: async () => {
        const f = file.files && file.files[0];
        file.value = "";
        if (!f) return;
        let json;
        try { json = JSON.parse(await f.text()); } catch (e) { toast("読みこめないファイルです"); return; }
        if (!json || json.app !== BACKUP_APP || !json.data || typeof json.data !== "object") { toast("SK Study のバックアップではないようです"); return; }
        const keys = Object.keys(json.data).filter((k) => k.startsWith("sk_study_") && typeof json.data[k] === "string");
        if (!keys.length) { toast("バックアップに中身がありません"); return; }
        if (!(await confirmDialog("バックアップを読みこむ", "いまのマイ単語帳・学習の記録・設定を、バックアップの中身に置きかえます。元に戻せません。", "読みこむ", true))) return;
        for (const k of studyKeys()) localStorage.removeItem(k);
        for (const k of keys) localStorage.setItem(k, json.data[k]);
        toast("読みこみました");
        setTimeout(() => location.reload(), 600);
      } });
      return [
        item("このブラウザに保存しているもの", `マイ単語帳 ${c.sets} 冊・プリント ${c.prints} 件・学習した単語 ${c.words} 語・小テスト ${c.tests} 回`),
        item("バックアップを書き出す", "マイ単語帳・学習の記録・設定を 1 つのファイルにします。ほかの端末やブラウザに移すときに。プリントの中身は入りません",
          action("書き出す", () => {
            const a = h("a", { href: URL.createObjectURL(backupBlob()), download: `sk-study-${new Date().toISOString().slice(0, 10)}.json` });
            document.body.append(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
          })),
        item("バックアップを読みこむ", "書き出したファイルから戻します。いまの中身は置きかわります", action("読みこむ", () => file.click()), file),
        item("学習の記録を消す", "覚えぐあい・続けた日数・小テストの点数を消します。マイ単語帳とプリントは残ります",
          action("消す", async () => {
            if (!(await confirmDialog("学習の記録を消す", "覚えぐあい・続けた日数・小テストの点数を消します。元に戻せません。", "消す", true))) return;
            for (const k of ["sk_study_progress", "sk_study_days", "sk_study_tests"]) localStorage.removeItem(k);
            toast("学習の記録を消しました");
            go("/settings/data", true);
          }, { danger: true })),
        item("キャッシュ", "オフライン用に保存してあるファイルを消して、最新の状態で読みこみ直します。マイ単語帳と記録は消えません",
          action("読みこみ直す", async () => {
            try {
              if ("caches" in window) for (const k of await caches.keys()) if (k.startsWith("study-")) await caches.delete(k);
              const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
              if (reg) await reg.unregister();
            } catch (e) {}
            location.reload();
          }))
      ];
    },
    about() {
      const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
      const install = ui.install();
      return [
        h("div", { class: "about-header" },
          h("img", { class: "about-icon", src: "ico/icon-192.png", alt: "", width: "72", height: "72" }),
          h("div", null,
            h("p", { class: "about-name" }, "SK Study ", h("span", { class: "beta" }, "試作")),
            h("p", { class: "about-description" }, "単語カード・4 択・書き取りで、英語・韓国語・中国語や自分で作った単語帳を覚える学習アプリです。"))),
        item("ホーム画面に追加",
          standalone ? "ホーム画面から開いています。オフラインでも学習できます"
            : install ? "アプリのように、すぐ開けます。オフラインでも学習できます"
              : "ブラウザのメニューの「ホーム画面に追加」（iPhone は共有ボタンから）で追加できます",
          !standalone && install ? action("追加", () => install.prompt()) : null),
        item("バージョン", VERSION),
        item("更新", "開くたびに最新の版を読みこみます（オフラインのときは、保存してある版を使います）"),
        item("利用規約・プライバシーポリシー", "SK Study は SK 利用規約・SK プライバシーポリシーのもとで提供しています", linkAction("開く", "/policies/", true))
      ];
    }
  };

  const stopOnLeave = [];
  window.addEventListener("hashchange", () => stopOnLeave.forEach((f) => f()), { once: true });

  // カテゴリの一覧（と検索）
  const search = h("input", { type: "search", placeholder: "設定を検索", "aria-label": "設定を検索", autocomplete: "off" });
  const none = h("p", { class: "settings-search__none", hidden: true }, "見つかりませんでした");
  const navItems = CATEGORIES.map((c) => h("a", {
    class: `settings-nav__item${current && current.key === c.key ? " active" : ""}`, href: `#/settings/${c.key}`,
    "aria-current": current && current.key === c.key ? "page" : null, "data-words": `${c.name} ${c.sub} ${c.words}`.toLowerCase()
  }, icon(c.icon), h("span", { class: "settings-nav__text" }, h("span", null, c.name), h("small", null, c.sub))));
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    navItems.forEach((a) => { const hit = !q || q.split(/\s+/).every((w) => a.dataset.words.includes(w)); a.hidden = !hit; if (hit) shown++; });
    none.hidden = shown > 0;
  });

  const back = h("a", { class: "icon-btn", href: cat && narrow() ? "#/settings" : "#/", "aria-label": cat && narrow() ? "設定の一覧へ" : "ホームへ", title: "戻る" }, icon("arrow_back"));
  app.append(h("section", { class: "settings-view" },
    h("header", { class: "settings-head" },
      back,
      h("h1", null, "設定"),
      h("sk-account-button", { app: "study", class: "settings-me", style: "--ska-size:32px" })),
    h("div", { class: `settings-layout${cat ? " is-detail" : ""}` },
      h("aside", { class: "settings-sidebar", "aria-label": "設定のカテゴリ" },
        h("p", { class: "settings-sidebar__title" }, "SK Study"),
        h("div", { class: "settings-listhead" },
          h("p", { class: "settings-listhead__title", "aria-hidden": "true" }, "設定"),
          h("label", { class: "settings-search" }, icon("search"), search)),
        h("nav", { class: "settings-nav" }, navItems),
        none),
      current ? h("div", { class: "settings-body" },
        h("section", { class: "settings-section", "aria-labelledby": "settings-section-title" },
          h("h2", { id: "settings-section-title" }, current.name),
          sections[current.key]())) : null)));
}
