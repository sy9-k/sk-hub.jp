// Nagi と SK Hub Systems アカウントの連携（集中の記録と 1 日の目標の同期）
//   ・ログインしていない人には Firebase を読み込まない（ヘッダーの表示用の情報 skhub_account があるときだけ確認する）
//   ・Nagi を最初に使うときは、アカウントのページで「Nagi で使いますか？」と確かめてから接続する
//     （/account/?connect=nagi&next=/nagi/。接続の記録は accounts/{UID}.services.nagi）
//   ・記録 … accounts/{UID}/nagi/data = { sessions: [{ i, s, m }], goal, goalUpdatedAt, updatedAt }
//     端末の記録とアカウントの記録を ID でまとめ（どちらかにしかないものは足す）、両方を同じにする。
//     目標は、あとで変えたほう（goalUpdatedAt が新しいほう）にそろえる
//   ・Nagi の本体（app.js）とは window.NAGI でやり取りする
const NAGI = window.NAGI || null;
const t = NAGI ? NAGI.t : (s) => s;
const FIRESTORE = "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const CONNECT_URL = `/account/?connect=nagi&next=${encodeURIComponent("/nagi/")}`;
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const box = $("nagi-account");
const syncButton = $("sync-button");

// status: loading / signed-out / offline / unregistered / not-connected / connected
const state = { status: "loading", user: null, account: null, hub: null, fs: null, syncing: false, lastSyncAt: 0, error: false, timer: null };

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function hasHint() {
  try { return !!localStorage.getItem("skhub_account"); } catch (e) { return false; }
}

// ---------- 表示（設定の「SK Hub Systems アカウント」と、上の同期のボタン） ----------

function userChip() {
  const { hub, user, account } = state;
  const p = hub.profileOf(user, account);
  const row = el("div", "account-user");
  if (p.photo) {
    const img = el("img");
    img.src = p.photo;
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    row.appendChild(img);
  } else {
    const letter = el("span", "letter", p.letter);
    letter.style.background = p.colorValue;
    row.appendChild(letter);
  }
  const text = el("div");
  text.append(el("strong", null, p.name || user.email || ""), el("small", null, user.email || ""));
  row.appendChild(text);
  return row;
}

function linkButton(label, href, filled) {
  const a = el("a", filled ? "filled-btn" : "outlined-btn", label);
  a.href = href;
  return a;
}

function render() {
  if (!box) return;
  box.replaceChildren();
  syncButton.hidden = state.status !== "connected";
  if (state.status === "loading") {
    box.appendChild(el("p", "support", t("確認中…")));
  } else if (state.status === "signed-out") {
    box.append(
      el("strong", null, t("記録をほかの端末と同期できます")),
      el("p", "support", t("SK Hub Systems アカウントでログインすると、スマホとパソコンの集中の記録と目標をまとめられます。")),
      linkButton(t("ログインして同期する"), CONNECT_URL, true)
    );
  } else if (state.status === "offline") {
    box.appendChild(el("p", "support", t("アカウントを確認できませんでした。インターネットの接続を確認してください。")));
  } else if (state.status === "unregistered") {
    box.append(
      el("p", "support", t("SK Hub Systems アカウントの作成（規約への同意）がまだです。")),
      linkButton(t("アカウントのページを開く"), CONNECT_URL, true)
    );
  } else if (state.status === "not-connected") {
    box.append(
      userChip(),
      el("p", "support", t("このアカウントを Nagi に接続すると、集中の記録と目標をほかの端末と同期できます。")),
      linkButton(t("Nagi に接続する"), CONNECT_URL, true)
    );
  } else {
    const when = state.lastSyncAt ? t("最後に同期: {time}", { time: new Date(state.lastSyncAt).toLocaleTimeString() }) : t("同期しています…");
    const syncNow = el("button", "outlined-btn", t("今すぐ同期"));
    syncNow.type = "button";
    syncNow.addEventListener("click", () => sync(true));
    box.append(userChip(), el("p", "support", state.error ? t("同期できませんでした。時間をおいてもう一度お試しください。") : when), syncNow);
  }
  syncButton.classList.toggle("is-syncing", state.syncing);
  syncButton.classList.toggle("is-ok", !state.syncing && !state.error && state.lastSyncAt > 0);
  syncButton.classList.toggle("is-error", state.error);
  const label = state.error ? t("同期できませんでした") : state.syncing ? t("同期しています…") : t("同期しました");
  syncButton.setAttribute("aria-label", label);
  syncButton.title = label;
}

// ---------- 読み込み ----------

async function init() {
  if (!NAGI) return; // 更新の直後で app.js が古いときは何もしない（次に開いたときに動く）
  if (!hasHint()) {
    state.status = "signed-out";
    render();
    return;
  }
  render();
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
  else if (!hub.isConnected(account, "nagi")) state.status = "not-connected";
  else state.status = "connected";
  if (state.status !== "unregistered") hub.rememberAccount(user, account);
  render();
  if (state.status === "connected") {
    await sync(false);
    clearInterval(state.timer);
    state.timer = setInterval(() => sync(false), SYNC_INTERVAL_MS);
  }
}

// ---------- 同期 ----------

let pending = false;
async function sync(manual) {
  if (state.status !== "connected") return;
  if (state.syncing) { pending = true; return; }
  const { hub, fs, user } = state;
  state.syncing = true;
  state.error = false;
  render();
  try {
    const ref = fs.doc(hub.db, "accounts", user.uid, "nagi", "data");
    const snap = await fs.getDoc(ref);
    const remote = snap.exists() ? snap.data() : { sessions: [], goal: 0, goalUpdatedAt: 0 };
    // 目標: あとで変えたほうにそろえる
    NAGI.setGoal(remote.goal, Number(remote.goalUpdatedAt) || 0);
    // 記録: ID でまとめる（アカウントにだけあるものを端末に足す）
    NAGI.mergeSessions(remote.sessions || []);
    const local = NAGI.getSessions();
    const goal = NAGI.getGoal();
    const remoteIds = new Set((remote.sessions || []).map((x) => x.i));
    const needsUpload = !snap.exists()
      || local.length !== remoteIds.size
      || local.some((x) => !remoteIds.has(x.i))
      || goal.goal !== remote.goal
      || goal.updatedAt !== (Number(remote.goalUpdatedAt) || 0);
    if (needsUpload) {
      await fs.setDoc(ref, {
        sessions: local.map((x) => ({ i: x.i, s: x.s, m: x.m })),
        goal: goal.goal,
        goalUpdatedAt: goal.updatedAt,
        updatedAt: fs.serverTimestamp()
      });
    }
    state.lastSyncAt = Date.now();
    if (manual) NAGI.toast(t("同期しました"));
  } catch (e) {
    state.error = true;
    if (manual) NAGI.toast(t("同期できませんでした。時間をおいてもう一度お試しください。"));
  } finally {
    state.syncing = false;
    render();
    if (pending) { pending = false; sync(false); }
  }
}

// 記録が増えた・目標を変えたら、少し待ってから同期する
let soon = null;
if (NAGI) {
  NAGI.onChange((kind) => {
    if (kind === "cleared") return; // このブラウザの記録を消しても、アカウントの記録は消さない
    clearTimeout(soon);
    soon = setTimeout(() => sync(false), 2000);
  });
}
syncButton.addEventListener("click", () => sync(true));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && Date.now() - state.lastSyncAt > 60 * 1000) sync(false);
});

init();
