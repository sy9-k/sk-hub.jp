// MALU と SK Hub Systems アカウントの連携（単語帳・検索履歴の同期）
//   ・ログインしていない人には Firebase を読み込まない（ヘッダーの表示用の情報 skhub_account があるときだけ確認する）
//   ・MALU を最初に使うときは、アカウントのページで「MALU で使いますか？」と確かめてから接続する
//     （/account/?connect=malu&next=/dictionary/。接続の記録は accounts/{UID}.services.malu）
//   ・単語帳 … accounts/{UID}/maluWords/{ID}（ID = 辞書と言葉から作るハッシュ。同じ言葉を二重に保存しない）
//   ・検索履歴の同期 … 本人が設定で有効にしたときだけ（services.malu.historySync）。accounts/{UID}/malu/history に
//     { items: [{ term, dictionaryKey, timestamp }], clearedAt } を置き、端末の履歴とまとめる。
//     履歴を消した時刻（clearedAt）より前のものは、どの端末でも消す
//   ・MALU の本体（script.js）とは window.MALU でやり取りする
// 更新の直後は、古い script.js（window.MALU がない）と組み合わさることがある。そのときは何もしない（次に開いたときに動く）
const MALU = window.MALU || null;
const t = MALU ? MALU.t : (s) => s;
const FIRESTORE = "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const CONNECT_URL = `/account/?connect=malu&next=${encodeURIComponent("/dictionary/")}`;
const HISTORY_MAX = 60;
const CLEARED_KEY = "malu_history_cleared_at";

const $ = (id) => document.getElementById(id);
const accountBox = $("malu-account");
const wordbookView = $("wordbook-view");
const wordbookContent = $("wordbook-content");
const saveButton = $("save-word");
const mainView = $("main-view");
const settingsOverlay = $("settings-overlay");

// status: loading / signed-out / offline / unregistered（アカウント未作成・規約が新しい）/ not-connected / connected
const state = { status: "loading", user: null, account: null, words: new Map(), hub: null, fs: null, unsubscribe: null };

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function hasHint() {
  try { return !!localStorage.getItem("skhub_account"); } catch (e) { return false; }
}

// ---------- 読み込み ----------

async function init() {
  if (!hasHint()) {
    state.status = "signed-out";
    render();
    return;
  }
  try {
    [state.hub, state.fs] = await Promise.all([import("/assets/hub/account.js"), import(FIRESTORE)]);
  } catch (e) {
    state.status = "offline";
    render();
    return;
  }
  await refresh();
}

async function refresh() {
  const { hub, fs } = state;
  const user = await hub.currentUser();
  if (!user) {
    state.status = "signed-out";
    render();
    return;
  }
  state.user = user;
  try {
    const snap = await fs.getDoc(fs.doc(hub.db, "accounts", user.uid));
    state.account = snap.exists() ? snap.data() : null;
  } catch (e) {
    state.status = "offline";
    render();
    return;
  }
  const account = state.account;
  if (!hub.accountUsable(account)) state.status = "unregistered";
  else if (!hub.isConnected(account, "malu")) state.status = "not-connected";
  else state.status = "connected";
  if (state.status !== "unregistered") hub.rememberAccount(user, account);
  render();
  if (state.status === "connected") {
    watchWords();
    if (historySyncOn()) syncHistory().catch(() => {});
  }
}

// ---------- 単語帳 ----------

function watchWords() {
  const { hub, fs, user } = state;
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = fs.onSnapshot(fs.collection(hub.db, "accounts", user.uid, "maluWords"), (snap) => {
    state.words = new Map(snap.docs.map((d) => [d.id, d.data()]));
    renderWordbook();
    renderAccount();
    updateSaveButton();
  }, () => {
    state.words = new Map();
    renderWordbook();
  });
}

async function wordId(word, dictionary) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${dictionary}\n${word}`));
  return [...new Uint8Array(hash)].slice(0, 20).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function findWord(word, dictionary) {
  for (const [id, w] of state.words) if (w.word === word && w.dictionary === dictionary) return id;
  return null;
}

function updateSaveButton() {
  if (!saveButton) return;
  const { term, dictionary } = MALU.current();
  const saved = state.status === "connected" && !!term && !!findWord(term, dictionary);
  saveButton.disabled = !term;
  saveButton.setAttribute("aria-pressed", String(saved));
  const label = saved ? t("単語帳から外す") : t("単語帳に保存");
  saveButton.setAttribute("aria-label", label);
  saveButton.title = label;
}

async function toggleWord() {
  const { term, dictionary } = MALU.current();
  if (!term) return;
  // 接続していなければ、単語帳の画面で接続を案内する
  if (state.status !== "connected") {
    openWordbook();
    return;
  }
  const { hub, fs, user } = state;
  saveButton.disabled = true;
  try {
    const existing = findWord(term, dictionary);
    if (existing) {
      await fs.deleteDoc(fs.doc(hub.db, "accounts", user.uid, "maluWords", existing));
      toast(t("単語帳から外しました。"));
    } else {
      const id = await wordId(term.slice(0, 200), dictionary);
      await fs.setDoc(fs.doc(hub.db, "accounts", user.uid, "maluWords", id), {
        word: term.slice(0, 200),
        dictionary,
        addedAt: fs.serverTimestamp()
      });
      toast(t("「{word}」を単語帳に保存しました。", { word: term.slice(0, 40) }));
    }
  } catch (e) {
    toast(t("単語帳を更新できませんでした。時間をおいてもう一度お試しください。"));
  } finally {
    updateSaveButton();
  }
}

// ---------- 検索履歴の同期 ----------

function historySyncOn() {
  return !!(state.account && state.account.services && state.account.services.malu && state.account.services.malu.historySync);
}
function localCleared() {
  try { return Number(localStorage.getItem(CLEARED_KEY) || 0); } catch (e) { return 0; }
}
function setLocalCleared(value) {
  try { localStorage.setItem(CLEARED_KEY, String(value)); } catch (e) { /* 保存できなくても同期はできる */ }
}

let syncing = null;
let syncAgain = false;
function syncHistory() {
  if (syncing) {
    syncAgain = true;
    return syncing;
  }
  syncing = doSyncHistory().finally(() => {
    syncing = null;
    if (syncAgain) {
      syncAgain = false;
      syncHistory().catch(() => {});
    }
  });
  return syncing;
}

async function doSyncHistory() {
  const { hub, fs, user } = state;
  const ref = fs.doc(hub.db, "accounts", user.uid, "malu", "history");
  const snap = await fs.getDoc(ref);
  const remote = snap.exists() ? snap.data() : { items: [], clearedAt: 0 };
  const clearedAt = Math.max(Number(remote.clearedAt) || 0, localCleared());

  // 同じ辞書・同じ言葉は、新しいほうを残す
  const byKey = new Map();
  [...(Array.isArray(remote.items) ? remote.items : []), ...MALU.getHistory()].forEach((item) => {
    if (!item || typeof item.term !== "string" || typeof item.dictionaryKey !== "string") return;
    const timestamp = Number(item.timestamp) || 0;
    if (timestamp <= clearedAt) return;
    const key = `${item.dictionaryKey}\n${item.term}`;
    const prev = byKey.get(key);
    if (!prev || prev.timestamp < timestamp) byKey.set(key, { term: item.term, dictionaryKey: item.dictionaryKey, timestamp });
  });
  const merged = [...byKey.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-HISTORY_MAX);
  setLocalCleared(clearedAt);

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  if (!same(merged, MALU.getHistory())) MALU.setHistory(merged);
  if (!snap.exists() || !same(merged, remote.items || []) || (Number(remote.clearedAt) || 0) !== clearedAt) {
    await fs.setDoc(ref, { items: merged, clearedAt, updatedAt: fs.serverTimestamp() });
  }
}

async function setHistorySync(on, input) {
  const { hub, fs, user } = state;
  if (!on && !confirm(t("検索履歴の同期をやめます。アカウントに保存した検索履歴は削除されます（この端末の検索履歴は残ります）。よろしいですか？"))) {
    input.checked = true;
    return;
  }
  input.disabled = true;
  try {
    // やめるときは、先にアカウントの履歴を消す
    if (!on) await fs.deleteDoc(fs.doc(hub.db, "accounts", user.uid, "malu", "history"));
    await fs.updateDoc(fs.doc(hub.db, "accounts", user.uid), { "services.malu.historySync": on });
    state.account.services.malu.historySync = on;
    if (on) await syncHistory();
    toast(on ? t("検索履歴の同期を始めました。") : t("検索履歴の同期をやめ、アカウントに保存した検索履歴を削除しました。"));
  } catch (e) {
    input.checked = !on;
    toast(t("変更できませんでした。時間をおいてもう一度お試しください。"));
  } finally {
    input.disabled = false;
    renderAccount();
  }
}

// MALU の本体からの知らせ（script.js の notifyAccount）
let historyTimer = null;
function onMaluChange(what) {
  updateSaveButton();
  if (what === "clear") setLocalCleared(Date.now());
  if ((what === "history" || what === "clear") && state.status === "connected" && historySyncOn()) {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => syncHistory().catch(() => {}), what === "clear" ? 0 : 1500);
  }
}

// ---------- 画面 ----------

function render() {
  renderAccount();
  renderWordbook();
  updateSaveButton();
}

function item(title, description, action) {
  const row = el("div", "settings-item");
  const text = el("div");
  text.appendChild(el("p", "settings-item__title", title));
  if (description) text.appendChild(el("p", "settings-item__description", description));
  row.appendChild(text);
  if (action) row.appendChild(action);
  return row;
}

function linkButton(label, href) {
  const a = el("a", "settings-action malu-link-action", label);
  a.href = href;
  return a;
}

function profileRow() {
  const { hub, user, account } = state;
  const p = hub.profileOf(user, account);
  const row = el("div", "settings-item malu-profile");
  if (p.photo) {
    const img = el("img", "malu-avatar");
    img.src = p.photo;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    row.appendChild(img);
  } else {
    const letter = el("span", "malu-avatar malu-avatar--letter", p.letter);
    letter.style.background = p.colorValue;
    letter.setAttribute("aria-hidden", "true");
    row.appendChild(letter);
  }
  const text = el("div", "malu-profile__text");
  text.appendChild(el("p", "settings-item__title", p.name || t("（名前なし）")));
  text.appendChild(el("p", "settings-item__description", user.email || ""));
  row.appendChild(text);
  row.appendChild(linkButton(t("アカウント"), "/account/"));
  return row;
}

function renderAccount() {
  if (!accountBox) return;
  const nodes = [];
  const s = state.status;
  if (s === "loading") {
    nodes.push(item(t("SK Hub Systems アカウント"), t("読み込み中…")));
  } else if (s === "signed-out") {
    nodes.push(item(t("SK Hub Systems アカウント"), t("ログインして MALU に接続すると、単語帳と、検索履歴の端末のあいだの同期が使えます。"), linkButton(t("ログイン"), CONNECT_URL)));
  } else if (s === "offline") {
    nodes.push(item(t("SK Hub Systems アカウント"), t("オフラインのため、アカウントを確認できません。")));
  } else if (s === "unregistered" || s === "not-connected") {
    nodes.push(profileRow());
    nodes.push(item(t("MALU に接続"), t("このアカウントを MALU に接続すると、単語帳と、検索履歴の端末のあいだの同期が使えます。"), linkButton(t("接続する"), CONNECT_URL)));
  } else {
    nodes.push(profileRow());
    const open = el("button", "settings-action", t("開く"));
    open.type = "button";
    open.addEventListener("click", openWordbook);
    nodes.push(item(t("単語帳"), t("{n} 語を保存しています。", { n: state.words.size }), open));

    const sw = el("label", "malu-switch");
    const input = el("input");
    input.type = "checkbox";
    input.checked = historySyncOn();
    input.setAttribute("aria-label", t("検索履歴の同期"));
    input.addEventListener("change", () => setHistorySync(input.checked, input));
    sw.append(input, el("span", "malu-switch__track"));
    nodes.push(item(t("検索履歴の同期"), t("検索履歴をアカウントに保存して、ほかの端末と同期します。オフにすると、アカウントに保存した検索履歴を削除します。"), sw));

    const since = state.account.services.malu.connectedAt;
    const date = since && since.toDate ? (window.SKI18N ? window.SKI18N.date(since.toDate()) : since.toDate().toLocaleDateString()) : "";
    nodes.push(item(t("接続"), date ? t("{date} に接続しました。解除は、アカウントのページの「サービス」からできます。", { date }) : "", linkButton(t("接続を管理"), "/account/#services")));
  }
  accountBox.replaceChildren(...nodes);
}

function renderWordbook() {
  if (!wordbookContent) return;
  const s = state.status;
  if (s === "loading") {
    wordbookContent.replaceChildren(el("p", "wordbook-empty", t("読み込み中…")));
    return;
  }
  if (s === "offline") {
    wordbookContent.replaceChildren(el("p", "wordbook-empty", t("オフラインのため、単語帳を読み込めません。")));
    return;
  }
  if (s !== "connected") {
    const box = el("div", "wordbook-prompt");
    box.appendChild(el("p", "wordbook-prompt__title", t("単語帳を使うには")));
    box.appendChild(el("p", "wordbook-prompt__text", s === "signed-out"
      ? t("SK Hub Systems アカウントでログインして、MALU に接続してください。保存した言葉は、あなただけが見られます。")
      : t("この SK Hub Systems アカウントを MALU に接続してください。保存した言葉は、あなただけが見られます。")));
    box.appendChild(linkButton(s === "signed-out" ? t("ログインして接続") : t("MALU に接続"), CONNECT_URL));
    wordbookContent.replaceChildren(box);
    return;
  }
  const words = [...state.words.entries()]
    .map(([id, w]) => ({ id, ...w, at: w.addedAt && w.addedAt.toMillis ? w.addedAt.toMillis() : Date.now() }))
    .sort((a, b) => b.at - a.at);
  if (!words.length) {
    wordbookContent.replaceChildren(el("p", "wordbook-empty", t("まだ保存した言葉はありません。言葉を入力して、検索欄のしおりのボタンで保存できます。")));
    return;
  }
  const list = el("ul", "wordbook-list");
  words.forEach((w) => {
    const li = el("li", "wordbook-item");
    const main = el("button", "wordbook-item__main");
    main.type = "button";
    main.appendChild(el("span", "wordbook-item__word", w.word));
    main.appendChild(el("span", "wordbook-item__dict", `${MALU.categoryLabel(w.dictionary)} · ${MALU.dictionaryLabel(w.dictionary)}`));
    main.addEventListener("click", () => {
      closeWordbook();
      MALU.useWord(w.word, w.dictionary);
    });
    const del = el("button", "icon-button wordbook-item__delete");
    del.type = "button";
    del.setAttribute("aria-label", t("「{word}」を単語帳から外す", { word: w.word }));
    del.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor" aria-hidden="true"><path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360Z"/></svg>';
    del.addEventListener("click", async () => {
      del.disabled = true;
      try {
        await state.fs.deleteDoc(state.fs.doc(state.hub.db, "accounts", state.user.uid, "maluWords", w.id));
      } catch (e) {
        del.disabled = false;
        toast(t("単語帳を更新できませんでした。時間をおいてもう一度お試しください。"));
      }
    });
    li.append(main, del);
    list.appendChild(li);
  });
  wordbookContent.replaceChildren(list);
}

// ---------- 単語帳の画面の出し入れ ----------

function openWordbook() {
  renderWordbook();
  if (settingsOverlay) settingsOverlay.classList.add("hide");
  if (mainView) mainView.classList.add("hide");
  wordbookView.classList.remove("hide");
  $("wordbook-close").focus();
}

function closeWordbook() {
  wordbookView.classList.add("hide");
  if (mainView) mainView.classList.remove("hide");
  $("wordbook-button").focus();
}

let toastTimer = null;
function toast(text) {
  let box = document.querySelector(".malu-toast");
  if (!box) {
    box = el("div", "malu-toast");
    box.setAttribute("role", "status");
    document.body.appendChild(box);
  }
  box.textContent = text;
  box.classList.add("is-shown");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("is-shown"), 3200);
}

if (MALU) {
  MALU.onChange = onMaluChange;
  $("wordbook-button").addEventListener("click", openWordbook);
  $("wordbook-close").addEventListener("click", closeWordbook);
  if (saveButton) saveButton.addEventListener("click", toggleWord);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !wordbookView.classList.contains("hide")) closeWordbook();
  });
  // オンラインに戻ったら読み込み直す・ほかの端末で増えた検索履歴を取り込む
  window.addEventListener("online", () => {
    if (state.status === "offline") init();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.status === "connected" && historySyncOn()) syncHistory().catch(() => {});
  });

  render();
  init();
}
