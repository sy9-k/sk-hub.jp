// SK Hub Systems 管理コンソール（Y-FILTER.）
// Google ログインした管理者が、管理グループに接続した端末の設定をまとめて管理する。
//   管理グループ … 持ち主（最初の管理者）の UID が ID。共同管理者を招待して一緒に管理できる
//   リクエスト   … 端末のブロック画面から届く「このサイトを開きたい」。許可すると許可リストに追加する
// ブロックリスト（カテゴリ）は読むだけ（カテゴリの選択肢に使う）。編集は開発者の PC だけで動く
// y-filter リポジトリの systems/blocklist-editor で行い、この管理コンソールには置かない。
// データ構造・権限は y-filter リポジトリの systems/firestore.rules を参照。
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  Timestamp, arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getFirestore,
  increment, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { NEWTAB_MODES, REMOTE_SETTING_KEYS, buildDefaultSettings, localDateKey, normalizeSettings } from "./shared/settings-schema.js";
import { hashAccessCode, validateNewAccessCode } from "./shared/access-code.js";
import "./shared/time-rules.js"; // globalThis.YFilterTime（ルールの説明文に使う）
// SK Hub Systems アカウント（未作成・規約が新しくなったときは /account/ で同意してから戻ってくる）
import { ACCOUNT_TERMS_VERSION, accountPageUrl, disconnectService, isConnected, profileOf, rememberAccount, signOutAccount } from "/assets/hub/account.js";

const ONLINE_WINDOW_MS = 15 * 60 * 1000; // 端末は最長 10 分ごとに報告する
const PAIRING_TTL_MS = 30 * 60 * 1000;
const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 読み間違えやすい I O 0 1 を除く
const EXTENSIONS = ["exe", "msi", "zip", "rar", "7z", "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "apk"];
const TEAM_STORAGE_KEY = "yfilter-console-team";

const $ = (id) => document.getElementById(id);
const show = (id, visible) => { $(id).hidden = !visible; };

// ---------- 起動 ----------

const configured = !!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.authDomain);
show("loading", false);
if (!configured) {
  show("unconfigured", true);
  throw new Error("firebase-config.js が未設定です");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  user: null,
  teams: [],            // 自分が参加している管理グループ
  teamId: "",           // 表示中の管理グループ（= 持ち主の UID）
  pendingTeamId: "",    // 一覧に入りしだい開くグループ
  devices: [],          // { id, ...data }
  requests: [],
  selected: new Set(),
  pairingCodes: [],
  invites: [],
  backups: [],          // 自分の端末の設定のバックアップ（持ち主だけ。teams/{UID}/backups）
  categories: {},       // ブロックリスト（読むだけ）
  userUnsubs: [],       // ログイン中ずっと使う購読
  teamUnsubs: []        // 管理グループごとの購読
};

// ---------- 共通 ----------

let toastTimer = null;
function toast(message, isError = false) {
  const el = $("toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const toMillis = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : Number(v || 0));
const errText = (err) => err?.code || err?.message || String(err);

function timeAgo(ms) {
  if (!ms) return "-";
  const diff = Date.now() - ms;
  if (diff < 60 * 1000) return "たった今";
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分前`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}時間前`;
  return new Date(ms).toLocaleString();
}

function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}
const formatCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;
const normalizeCode = (raw) => String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// キーの順番に左右されない比較用の文字列
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

// 配信設定と端末の設定の違い（learningModeUntil は時間で変わるので比較しない）
function diffKeys(a, b) {
  const x = normalizeSettings(a || {});
  const y = normalizeSettings(b || {});
  return REMOTE_SETTING_KEYS.filter((k) => k !== "learningModeUntil" && stable(x[k]) !== stable(y[k]));
}

function deviceStatus(d) {
  const lastSeen = toMillis(d.reported?.lastSeenAt);
  const online = lastSeen && Date.now() - lastSeen < ONLINE_WINDOW_MS;
  const pending = Number(d.reported?.appliedRev || 0) < Number(d.settingsRev || 0);
  const changed = !pending && d.reported?.settings && diffKeys(d.settings, d.reported.settings).length > 0;
  return { lastSeen, online, pending, changed };
}

// 自分の端末（Y-FILTER. の設定画面の「自分の端末としてつなぐ」でつないだ端末。持ち主にだけ見える）
const isPersonal = (d) => d?.mode === "personal";

// 種類（mode）のない以前の端末に mode: managed を付ける（共同管理者の一覧は mode == managed で取るため）。持ち主が開いたときに 1 回
const backfilledTeams = new Set();
async function backfillDeviceModes(teamId) {
  if (backfilledTeams.has(teamId) || teamId !== state.teamId) return;
  backfilledTeams.add(teamId);
  const legacy = state.devices.filter((d) => !d.mode);
  for (let i = 0; i < legacy.length; i += 400) {
    const batch = writeBatch(db);
    legacy.slice(i, i + 400).forEach((d) => batch.update(doc(db, "devices", d.id), { mode: "managed" }));
    await batch.commit();
  }
}

// 今日の利用時間（端末の報告から）。今日の報告がなければ null
function usageText(d) {
  const usage = d.reported?.usage;
  if (!usage || usage.date !== localDateKey()) return null;
  const used = formatMinutes(Number(usage.minutes || 0));
  return usage.limitMinutes === null || usage.limitMinutes === undefined
    ? used
    : `${used} / ${formatMinutes(Number(usage.limitMinutes))}`;
}

const OS_LABEL = { win: "Windows", mac: "Mac", cros: "Chromebook", linux: "Linux", android: "Android" };

// ---------- ログイン ----------

$("signin-btn").addEventListener("click", async () => {
  $("signin-msg").textContent = "";
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    $("signin-msg").textContent = `ログインできませんでした（${errText(e)}）`;
  }
});
// ヘッダーのアカウントのメニューの「ログアウト」（console-header.js）。ヘッダーのログイン表示も一緒に消す
document.addEventListener("skconsole:signout", () => signOutAccount());

// ヘッダーの「管理コンソールとの接続を解除」: アカウントとの接続だけを外す（管理グループ・端末は残る）。
// データも消したいときは、アカウントのページの「サービス」から
document.addEventListener("skconsole:disconnect", async () => {
  if (!state.user) return;
  if (!confirm("この SK Hub Systems アカウントと管理コンソールの接続を解除します。管理グループと接続している端末はそのまま残り、次に管理コンソールを開いたときに、もう一度接続するか確認します。よろしいですか？")) return;
  try {
    await disconnectService(state.user, "yfilter");
    location.href = "/account/#services";
  } catch (err) {
    toast(`接続を解除できませんでした: ${errText(err)}`, true);
  }
});

// ヘッダーの「端末」「管理グループ」は、管理画面を開いているときだけ出す
function showConsoleMenus(visible) {
  document.querySelectorAll("[data-console-only]").forEach((el) => { el.hidden = !visible; });
}

onAuthStateChanged(auth, async (user) => {
  state.userUnsubs.forEach((fn) => fn());
  state.userUnsubs = [];
  clearTeamSubscriptions();
  state.user = user;
  state.account = null;
  state.teams = [];
  state.teamId = "";
  show("signin", !user);
  show("app", !!user);
  showConsoleMenus(false);
  if (!user) return;
  if (!(await hasAccount(user))) return;
  showConsoleMenus(true);
  await ensureOwnTeam();
  // まず自分のグループを開き、前回ほかのグループを表示していたら一覧が届いてから切り替える
  const saved = savedTeamId();
  state.pendingTeamId = saved && saved !== user.uid ? saved : "";
  selectTeam(user.uid);
  subscribeTeams();
  loadCategories();
});

// SK Hub Systems アカウントを作っていない（規約に同意していない）・管理コンソールに接続していないときは、
// アカウントのページで同意・接続してもらってから戻ってくる（/account/?connect=yfilter&next=/y-filter/）
async function hasAccount(user) {
  // 招待制（assets/hub/invite.js）。招待された Google アカウントでログインしていないときは、早期アクセスのページへ
  try {
    const { inviteStatus, WAITING_URL } = await import("/assets/hub/invite.js");
    const inv = await inviteStatus(user, "yfilter");
    if (!inv.ok) {
      show("app", false);
      location.replace(`${WAITING_URL("yfilter")}&need=${inv.reason === "not-google" ? "google" : "invite"}`);
      return false;
    }
  } catch (err) {
    toast(`招待を確認できませんでした: ${errText(err)}`, true);
    return false;
  }
  try {
    const snap = await getDoc(doc(db, "accounts", user.uid));
    if (snap.exists() && snap.data().termsVersion === ACCOUNT_TERMS_VERSION && isConnected(snap.data(), "yfilter")) {
      state.account = snap.data();
      rememberAccount(user, state.account);
      return true;
    }
  } catch (err) {
    toast(`アカウントを確認できませんでした: ${errText(err)}`, true);
    return false;
  }
  show("app", false);
  location.replace(accountPageUrl("/y-filter/", "yfilter"));
  return false;
}

// ---------- 管理グループ（共同管理者） ----------

// 共同管理者に見せる名前は、SK Hub Systems アカウントのプロフィールの表示名（決めていなければ Google の名前）
const myName = () => profileOf(state.user, state.account).name;

function memberEntry() {
  return { email: state.user.email || "", name: myName(), joinedAt: serverTimestamp() };
}

// 自分のグループ（ID = 自分の UID）がなければ作る。名前・メールが変わっていれば更新する
async function ensureOwnTeam() {
  const uid = state.user.uid;
  const ref = doc(db, "teams", uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { ownerUid: uid, members: [uid], memberInfo: { [uid]: memberEntry() }, createdAt: serverTimestamp() });
      return;
    }
    const info = snap.data().memberInfo?.[uid] || {};
    if (info.email !== (state.user.email || "") || info.name !== myName()) {
      await updateDoc(ref, { [`memberInfo.${uid}`]: memberEntry() });
    }
  } catch (err) {
    toast(`管理グループを準備できませんでした: ${errText(err)}`, true);
  }
}

function subscribeTeams() {
  state.userUnsubs.push(onSnapshot(
    query(collection(db, "teams"), where("members", "array-contains", state.user.uid)),
    (snap) => {
      state.teams = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // 開きたいグループ（前回表示していた・参加したばかり）が一覧に入ったら切り替える
      if (state.pendingTeamId && state.teams.some((t) => t.id === state.pendingTeamId)) {
        const id = state.pendingTeamId;
        state.pendingTeamId = "";
        selectTeam(id);
      }
      // 外された・抜けたグループを表示していたら、自分のグループに戻す
      if (state.teamId && state.teamId !== state.user.uid && !state.teams.some((t) => t.id === state.teamId)) {
        toast("このグループの管理者ではなくなりました");
        selectTeam(state.user.uid);
      }
      renderTeamSelect();
      if ($("dlg-team").open) renderTeamDialog();
    },
    (err) => toast(`管理グループを読み込めません: ${errText(err)}`, true)
  ));
}

function savedTeamId() {
  try { return localStorage.getItem(TEAM_STORAGE_KEY) || ""; } catch (e) { return ""; }
}

function currentTeam() {
  return state.teams.find((t) => t.id === state.teamId) || null;
}

function teamLabel(team) {
  if (!team) return "";
  if (team.id === state.user.uid) return "自分のグループ";
  const owner = team.memberInfo?.[team.ownerUid] || {};
  return `${owner.name || owner.email || "ほかの人"} のグループ`;
}

function renderTeamSelect() {
  const select = $("team-select");
  const teams = [...state.teams].sort((a, b) => (a.id === state.user.uid ? -1 : b.id === state.user.uid ? 1 : 0));
  select.innerHTML = teams.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(teamLabel(t))}</option>`).join("");
  select.value = state.teamId;
  select.hidden = teams.length < 2;
  const team = currentTeam();
  $("devices-lead").textContent = team && team.id !== state.user.uid
    ? `${teamLabel(team)}に接続している端末です（共同管理者として管理しています）。`
    : "このグループに接続している端末です。選んだ端末の設定をまとめて変更できます。";
}

$("team-select").addEventListener("change", (e) => selectTeam(e.target.value));

function clearTeamSubscriptions() {
  state.teamUnsubs.forEach((fn) => fn());
  state.teamUnsubs = [];
}

function selectTeam(teamId) {
  const uid = state.user.uid;
  // 参加していないグループ（保存していた ID が古い等）は開かない
  const id = teamId === uid || state.teams.some((t) => t.id === teamId) ? teamId : uid;
  if (id === state.teamId && state.teamUnsubs.length) return;
  state.teamId = id;
  try { localStorage.setItem(TEAM_STORAGE_KEY, id); } catch (e) { /* 保存できなくてもよい */ }
  clearTeamSubscriptions();
  state.devices = [];
  state.requests = [];
  state.allRequests = [];
  state.pairingCodes = [];
  state.invites = [];
  state.backups = [];
  state.selected.clear();
  renderDevices();
  renderBackups();
  renderRequests();
  renderTeamSelect();
  subscribeTeam();
}

function subscribeTeam() {
  const teamId = state.teamId;
  const isOwner = teamId === state.user.uid;
  const loaded = new Set();
  const markLoaded = (name) => {
    loaded.add(name);
    // 必要な一覧がそろったら、古いデータを片付ける
    if (["devices", "codes", "requests", ...(isOwner ? ["invites", "backups"] : [])].every((n) => loaded.has(n))) {
      cleanupStaleData(teamId).catch(() => {});
    }
  };
  // 自分の端末（mode: personal）は持ち主にだけ見える。共同管理者は管理する端末だけを一覧する（rules もそうなっている）
  const devicesQuery = isOwner
    ? query(collection(db, "devices"), where("ownerUid", "==", teamId))
    : query(collection(db, "devices"), where("ownerUid", "==", teamId), where("mode", "==", "managed"));
  state.teamUnsubs.push(onSnapshot(
    devicesQuery,
    (snap) => {
      state.devices = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (isPersonal(b) - isPersonal(a)) || String(a.name || "").localeCompare(String(b.name || ""), "ja"));
      for (const id of [...state.selected]) if (!state.devices.some((d) => d.id === id)) state.selected.delete(id);
      renderDevices();
      renderRequests();
      renderBackups();
      if (!snap.metadata?.fromCache) {
        markLoaded("devices");
        if (isOwner) backfillDeviceModes(teamId).catch(() => {});
      }
    },
    (err) => toast(`端末一覧を読み込めません: ${errText(err)}`, true)
  ));
  // 自分の端末の設定のバックアップ（持ち主だけ）
  if (isOwner) {
    state.teamUnsubs.push(onSnapshot(
      collection(db, "teams", teamId, "backups"),
      (snap) => {
        state.backups = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => toMillis(b.savedAt) - toMillis(a.savedAt));
        renderBackups();
        if (!snap.metadata?.fromCache) markLoaded("backups");
      },
      () => {}
    ));
  }
  state.teamUnsubs.push(onSnapshot(
    query(collection(db, "pairingCodes"), where("ownerUid", "==", teamId)),
    (snap) => {
      state.pairingCodes = snap.docs.map((d) => ({ code: d.id, ...d.data() }));
      renderPairingList();
      if (!snap.metadata?.fromCache) markLoaded("codes");
    },
    () => {}
  ));
  // 返事済みのものも受け取り、表示は返事待ちだけにする（返事済みは片付けに使う）
  state.teamUnsubs.push(onSnapshot(
    query(collection(db, "requests"), where("ownerUid", "==", teamId)),
    (snap) => {
      state.allRequests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      state.requests = state.allRequests.filter((r) => r.status === "pending")
        .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      renderRequests();
      if (!snap.metadata?.fromCache) markLoaded("requests");
    },
    (err) => toast(`リクエストを読み込めません: ${errText(err)}`, true)
  ));
  // 招待コードは持ち主だけが発行・一覧できる
  if (isOwner) {
    state.teamUnsubs.push(onSnapshot(
      query(collection(db, "teamInvites"), where("teamId", "==", teamId)),
      (snap) => {
        state.invites = snap.docs.map((d) => ({ code: d.id, ...d.data() }));
        if ($("dlg-team").open) renderInviteList();
        if (!snap.metadata?.fromCache) markLoaded("invites");
      },
      () => {}
    ));
  }
}

// ---------- 古いデータの片付け ----------
// 管理コンソールを開いたときに、使い終わったデータを Firebase から削除する（管理グループごとに 10 分に 1 回まで）
//   ・期限切れから 1 時間たったペアリングコード・招待コード
//   ・返事から 7 日たったリクエスト（端末が返事を受け取れなかったもの）
//   ・30 日たっても返事のないリクエスト、接続を解除した端末のリクエスト
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const lastCleanupAt = new Map();

async function cleanupStaleData(teamId) {
  const now = Date.now();
  if (teamId !== state.teamId || now - (lastCleanupAt.get(teamId) || 0) < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt.set(teamId, now);
  const deviceIds = new Set(state.devices.map((d) => d.id));
  const refs = [
    // 接続を解除した自分の端末のバックアップで、1 年以上前のもの（持ち主だけが読めるので、持ち主のときだけ入る）
    ...state.backups.filter((b) => !deviceIds.has(b.id) && toMillis(b.savedAt) < now - 365 * DAY_MS).map((b) => doc(db, "teams", teamId, "backups", b.id)),
    ...state.pairingCodes.filter((p) => toMillis(p.expiresAt) < now - 60 * 60 * 1000).map((p) => doc(db, "pairingCodes", p.code)),
    ...state.invites.filter((i) => toMillis(i.expiresAt) < now - 60 * 60 * 1000).map((i) => doc(db, "teamInvites", i.code)),
    ...(state.allRequests || []).filter((r) => {
      const created = toMillis(r.createdAt);
      if (r.status !== "pending") return toMillis(r.decidedAt || r.createdAt) < now - 7 * DAY_MS;
      return created < now - 30 * DAY_MS || (!deviceIds.has(r.deviceId) && created < now - DAY_MS);
    }).map((r) => doc(db, "requests", r.id))
  ];
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}

// 管理者ダイアログ
function renderTeamDialog() {
  const team = currentTeam();
  const uid = state.user.uid;
  const isOwner = state.teamId === uid;
  $("team-lead").textContent = isOwner
    ? "このグループの管理者です。共同管理者は、このグループのすべての端末の設定を変更できます。"
    : `${teamLabel(team)}の共同管理者として管理しています。`;
  const members = team?.members || [uid];
  $("team-members").replaceChildren(...members.map((m) => {
    const info = team?.memberInfo?.[m] || {};
    const row = document.createElement("div");
    row.className = "member-row";
    const badges = [
      m === (team?.ownerUid || uid) ? '<span class="pill info">持ち主</span>' : "",
      m === uid ? '<span class="pill off">あなた</span>' : ""
    ].join("");
    row.innerHTML = `
      <div class="member-main"><div class="dev-name">${escapeHtml(info.name || info.email || "名前なし")} ${badges}</div>
      <div class="hint">${escapeHtml(info.email || "")}</div></div>`;
    if (isOwner && m !== uid) {
      const btn = document.createElement("button");
      btn.className = "link-btn danger-text";
      btn.type = "button";
      btn.textContent = "外す";
      btn.addEventListener("click", () => removeMember(m, info));
      row.appendChild(btn);
    }
    return row;
  }));
  show("team-invite-box", isOwner);
  show("team-leave", !isOwner);
  if (isOwner) renderInviteList();
}

function renderInviteList() {
  const active = state.invites.filter((i) => toMillis(i.expiresAt) > Date.now());
  const list = $("team-invite-list");
  if (!active.length) {
    list.innerHTML = '<div class="hint">有効な招待コードはありません。</div>';
    return;
  }
  list.replaceChildren(...active.map((i) => {
    const row = document.createElement("div");
    row.className = "pair-row";
    row.innerHTML = `<b>${escapeHtml(formatCode(i.code))}</b><span class="hint">${escapeHtml(new Date(toMillis(i.expiresAt)).toLocaleString())} まで</span><button class="link-btn" type="button">無効にする</button>`;
    row.querySelector("button").addEventListener("click", async () => {
      try {
        await deleteDoc(doc(db, "teamInvites", i.code));
      } catch (err) {
        toast(`無効にできませんでした: ${errText(err)}`, true);
      }
    });
    return row;
  }));
}

$("team-btn").addEventListener("click", () => {
  $("team-msg").textContent = "";
  $("team-invite-code").textContent = "";
  $("team-join-code").value = "";
  renderTeamDialog();
  $("dlg-team").showModal();
});

$("team-invite-new").addEventListener("click", async () => {
  const code = generateCode();
  try {
    await setDoc(doc(db, "teamInvites", code), {
      teamId: state.user.uid,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(Date.now() + INVITE_TTL_MS)
    });
    $("team-invite-code").textContent = formatCode(code);
  } catch (err) {
    $("team-msg").textContent = `招待コードを発行できませんでした（${errText(err)}）`;
  }
});

async function removeMember(memberUid, info) {
  if (!confirm(`${info.name || info.email || "この人"} をこのグループの管理者から外します。よろしいですか？`)) return;
  try {
    await updateDoc(doc(db, "teams", state.user.uid), {
      members: arrayRemove(memberUid),
      [`memberInfo.${memberUid}`]: deleteField()
    });
    toast("管理者から外しました");
  } catch (err) {
    toast(`外せませんでした: ${errText(err)}`, true);
  }
}

$("team-leave").addEventListener("click", async () => {
  const team = currentTeam();
  if (!team || !confirm(`${teamLabel(team)}から抜けます。このグループの端末は管理できなくなります。よろしいですか？`)) return;
  const uid = state.user.uid;
  try {
    await updateDoc(doc(db, "teams", team.id), {
      members: arrayRemove(uid),
      [`memberInfo.${uid}`]: deleteField()
    });
    $("dlg-team").close();
    selectTeam(uid);
    toast("グループから抜けました");
  } catch (err) {
    $("team-msg").textContent = `抜けられませんでした（${errText(err)}）`;
  }
});

$("team-join").addEventListener("click", async () => {
  const code = normalizeCode($("team-join-code").value);
  const uid = state.user.uid;
  $("team-msg").textContent = "";
  if (code.length !== 8) {
    $("team-msg").textContent = "招待コードは 8 文字です。";
    return;
  }
  try {
    const invite = await getDoc(doc(db, "teamInvites", code));
    if (!invite.exists()) throw new Error("招待コードが見つかりません。");
    const { teamId, expiresAt } = invite.data();
    if (toMillis(expiresAt) < Date.now()) throw new Error("招待コードの有効期限が切れています。");
    if (teamId === uid) throw new Error("自分のグループの招待コードです。");
    if (state.teams.some((t) => t.id === teamId)) throw new Error("すでにこのグループの管理者です。");
    const batch = writeBatch(db);
    batch.update(doc(db, "teams", teamId), {
      members: arrayUnion(uid),
      [`memberInfo.${uid}`]: memberEntry(),
      lastInvite: code
    });
    batch.delete(doc(db, "teamInvites", code));
    await batch.commit();
    $("team-join-code").value = "";
    $("dlg-team").close();
    toast("グループに参加しました");
    // 参加したグループは teams の購読で一覧に入ったときに開く
    state.pendingTeamId = teamId;
  } catch (err) {
    $("team-msg").textContent = err?.code ? `参加できませんでした（${errText(err)}）` : err.message;
  }
});

// ---------- ブロックリスト（カテゴリ）の読み込み（読むだけ） ----------

// JSON のほか `export const CATEGORY_DATA = {...}` 形式（以前の categories.json）も読める
function parseCategoryData(text) {
  const raw = String(text || "").replace(/^﻿/, "");
  try {
    return JSON.parse(raw);
  } catch (e) {
    const m = raw.match(/CATEGORY_DATA\s*=\s*({[\s\S]*})\s*;?\s*$/m);
    if (!m) return {};
    const src = m[1]
      .replace(/([{,]\s*)(domains|keywords)\s*:/g, '$1"$2":')
      .replace(/,\s*([}\]])/g, "$1");
    try {
      return JSON.parse(src);
    } catch (err) {
      return {};
    }
  }
}

async function loadCategories() {
  try {
    const snap = await getDoc(doc(db, "config", "categories"));
    state.categories = snap.exists() ? parseCategoryData(snap.data().json) : {};
  } catch (e) {
    state.categories = {};
  }
}

// ---------- 端末一覧 ----------

function renderDevices() {
  const rows = $("device-rows");
  rows.replaceChildren();
  let online = 0, pending = 0;
  const noIncognito = [];
  // 自分の端末と管理している端末の両方があるときは、見出しの行で分ける（自分の端末が先）
  const bothKinds = state.devices.some(isPersonal) && state.devices.some((d) => !isPersonal(d));
  let lastKind = null;
  for (const d of state.devices) {
    if (bothKinds && isPersonal(d) !== lastKind) {
      lastKind = isPersonal(d);
      const head = document.createElement("tr");
      head.className = "group-row";
      head.innerHTML = `<td colspan="8">${lastKind ? "自分の端末（あなたにだけ見えます）" : "管理している端末"}</td>`;
      rows.appendChild(head);
    }
    const st = deviceStatus(d);
    if (st.online) online++;
    if (st.pending) pending++;
    const info = d.reported?.info || {};
    const usage = usageText(d);
    if (info.incognitoAllowed === false) noIncognito.push(d);
    const tr = document.createElement("tr");
    tr.classList.toggle("selected", state.selected.has(d.id));
    tr.innerHTML = `
      <td class="cb"><input type="checkbox" ${state.selected.has(d.id) ? "checked" : ""} aria-label="選択"></td>
      <td><div class="dev-name">${escapeHtml(d.name || "名前なし")}${isPersonal(d) ? ' <span class="pill info" title="Y-FILTER. の設定画面から、SK Hub Systems アカウントにつないだ端末です">自分の端末</span>' : ""}</div><div class="dev-sub">${escapeHtml(d.id.slice(0, 10))}…</div></td>
      <td><span class="pill ${st.online ? "on" : "off"}">${st.online ? "オンライン" : "オフライン"}</span>${info.incognitoAllowed === false ? ' <span class="pill danger" title="シークレットウィンドウではフィルターがかかりません">シークレット未対策</span>' : ""}</td>
      <td>${st.pending ? '<span class="pill warn">反映待ち</span>' : st.changed ? '<span class="pill info">端末側で変更あり</span>' : '<span class="pill on">最新</span>'}</td>
      <td class="usage">${usage ? escapeHtml(usage) : '<span class="hint">-</span>'}</td>
      <td>${escapeHtml(timeAgo(st.lastSeen))}</td>
      <td class="hint">${escapeHtml(OS_LABEL[info.os] || info.os || "-")}${info.extensionVersion ? ` · v${escapeHtml(info.extensionVersion)}` : ""}</td>
      <td><button class="link-btn" type="button">詳細</button></td>`;
    tr.querySelector("input").addEventListener("change", (e) => {
      if (e.target.checked) state.selected.add(d.id);
      else state.selected.delete(d.id);
      renderDevices();
    });
    tr.querySelector(".link-btn").addEventListener("click", () => openDetail(d.id));
    rows.appendChild(tr);
  }
  show("empty", state.devices.length === 0);
  show("incognito-notice", noIncognito.length > 0);
  $("incognito-notice").textContent = noIncognito.length
    ? `${noIncognito.map((d) => d.name || "名前なし").join("、")} では、シークレットモードで Y-FILTER. が動いていません（シークレットウィンドウではフィルターがかかりません）。`
      + "その端末の chrome://extensions で Y-FILTER. の「詳細」を開き、「シークレット モードでの実行を許可する」をオンにしてください。"
      + "シークレットモード自体を使えなくすることもできます（y-filter リポジトリの docs/SYSTEMS_SETUP_JA.md「シークレットモード対策」）。"
    : "";
  $("sum-total").textContent = `${state.devices.length} 台`;
  $("sum-online").textContent = `${online} 台`;
  $("sum-pending").textContent = `${pending} 台`;
  $("sum-online").dataset.state = online ? "on" : "off";

  const n = state.selected.size;
  $("sel-count").textContent = `${n} 台を選択中`;
  $("select-all").checked = n > 0 && n === state.devices.length;
  $("select-all").indeterminate = n > 0 && n < state.devices.length;
  ["bulk-edit", "bulk-copy", "bulk-learning", "bulk-extend", "bulk-remove"].forEach((id) => { $(id).disabled = n === 0; });
}

$("select-all").addEventListener("change", (e) => {
  state.selected = new Set(e.target.checked ? state.devices.map((d) => d.id) : []);
  renderDevices();
});

const selectedDevices = () => state.devices.filter((d) => state.selected.has(d.id));

// ---------- 自分の端末のバックアップ（持ち主だけ） ----------
// 自分の端末が保存した設定。接続を解除しても残る。配信は「ほかの端末の設定をコピー」から（コピー元に出る）

function renderBackups() {
  const list = $("backup-rows");
  const isOwner = state.user && state.teamId === state.user.uid;
  show("backups-card", !!isOwner && state.backups.length > 0);
  if (!isOwner) return;
  const deviceIds = new Set(state.devices.map((d) => d.id));
  list.replaceChildren(...state.backups.map((b) => {
    const row = document.createElement("div");
    row.className = "pair-row";
    const when = toMillis(b.savedAt) ? new Date(toMillis(b.savedAt)).toLocaleString() : "-";
    row.innerHTML = `<b>${escapeHtml(b.deviceName || "名前なし")}</b>`
      + `<span class="hint">${escapeHtml(when)}${b.extensionVersion ? ` · v${escapeHtml(b.extensionVersion)}` : ""}${deviceIds.has(b.id) ? "" : " · 接続を解除した端末"}</span>`
      + '<button class="link-btn danger-text" type="button">削除</button>';
    row.querySelector("button").addEventListener("click", async () => {
      if (!confirm(`「${b.deviceName || "名前なし"}」のバックアップを削除します。よろしいですか？`)) return;
      try {
        await deleteDoc(doc(db, "teams", state.teamId, "backups", b.id));
        toast("バックアップを削除しました");
      } catch (err) {
        toast(`削除できませんでした: ${errText(err)}`, true);
      }
    });
    return row;
  }));
}

// 端末へ設定を配信する書き込みを batch に追加する（端末ごとの設定に patch を重ねて、配信番号を 1 つ進める）
function addDeliveries(batch, devices, makeSettings) {
  for (const d of devices) {
    batch.update(doc(db, "devices", d.id), {
      settings: normalizeSettings(makeSettings(d)),
      settingsRev: increment(1),
      settingsUpdatedAt: serverTimestamp(),
      settingsUpdatedBy: state.user.email || state.user.uid
    });
  }
}

async function deliver(devices, makeSettings) {
  const batch = writeBatch(db);
  addDeliveries(batch, devices, makeSettings);
  await batch.commit();
}

// ---------- リクエスト ----------

function renderRequests() {
  const list = $("request-rows");
  const requests = state.requests;
  $("sum-requests").textContent = `${requests.length} 件`;
  $("sum-requests").dataset.state = requests.length ? "warn" : "off";
  show("requests-card", requests.length > 0);
  list.replaceChildren(...requests.map((r) => {
    const device = state.devices.find((d) => d.id === r.deviceId);
    const row = document.createElement("div");
    row.className = "request-row";
    const who = `${escapeHtml(device?.name || r.deviceName || "不明な端末")} · ${escapeHtml(timeAgo(toMillis(r.createdAt)))}`;
    const message = r.message ? `<div class="request-message">「${escapeHtml(r.message)}」</div>` : "";
    if (r.kind === "extend") {
      const usage = usageText(device || {});
      row.innerHTML = `
        <div class="request-main">
          <div class="request-domain">利用時間の延長 +${escapeHtml(r.minutes)}分</div>
          <div class="hint">${who}${usage ? ` · 今日の利用 ${escapeHtml(usage)}` : ""}</div>
          ${message}
        </div>
        <div class="request-actions">
          <button class="btn btn-primary" type="button" data-act="device">許可（今日だけ ${escapeHtml(r.minutes)} 分延長）</button>
          <button class="btn btn-tonal danger-text" type="button" data-act="reject">許可しない</button>
        </div>`;
    } else {
      row.innerHTML = `
        <div class="request-main">
          <div class="request-domain">${escapeHtml(r.domain)}</div>
          <div class="hint">${who} · ${escapeHtml(r.category || "未分類")}</div>
          <a class="request-url hint" href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.url)}</a>
          ${message}
        </div>
        <div class="request-actions">
          <button class="btn btn-primary" type="button" data-act="device">この端末で許可</button>
          <button class="btn btn-tonal" type="button" data-act="all">すべての端末で許可</button>
          <button class="btn btn-tonal danger-text" type="button" data-act="reject">許可しない</button>
        </div>`;
    }
    row.querySelector('[data-act="device"]').disabled = !device;
    row.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => decideRequest(r, btn.dataset.act));
    });
    return row;
  }));
}

// その日だけ上限を延ばす（dailyLimit.extra。日付が違えば 0 から数え直す）
function withExtraMinutes(settings, date, minutes) {
  const s = normalizeSettings(settings || {});
  const current = s.dailyLimit.extra.date === date ? s.dailyLimit.extra.minutes : 0;
  return { ...s, dailyLimit: { ...s.dailyLimit, extra: { date, minutes: Math.min(24 * 60, current + minutes) } } };
}

async function decideRequest(r, action) {
  const approve = action !== "reject";
  if (r.kind === "extend") {
    const device = state.devices.find((d) => d.id === r.deviceId);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, "requests", r.id), {
        status: approve ? "approved" : "rejected",
        decidedAt: serverTimestamp(),
        decidedBy: state.user.email || state.user.uid
      });
      if (approve && device) addDeliveries(batch, [device], (d) => withExtraMinutes(d.settings, r.date, Number(r.minutes || 0)));
      await batch.commit();
      toast(approve ? `${device?.name || "端末"} の今日の利用時間を ${r.minutes} 分延長しました` : "延長のリクエストを許可しませんでした");
    } catch (err) {
      toast(`処理できませんでした: ${errText(err)}`, true);
    }
    return;
  }
  const targets = action === "all" ? state.devices : state.devices.filter((d) => d.id === r.deviceId);
  if (action === "all" && !confirm(`${r.domain} を、このグループのすべての端末（${targets.length} 台）の許可リストに追加します。よろしいですか？`)) return;
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, "requests", r.id), {
      status: approve ? "approved" : "rejected",
      decidedAt: serverTimestamp(),
      decidedBy: state.user.email || state.user.uid
    });
    if (approve) {
      const needs = targets.filter((d) => !normalizeSettings(d.settings || {}).allowList.includes(r.domain));
      addDeliveries(batch, needs, (d) => {
        const s = normalizeSettings(d.settings || {});
        return { ...s, allowList: [...s.allowList, r.domain] };
      });
    }
    await batch.commit();
    toast(approve ? `${r.domain} を許可しました（${targets.length} 台）` : `${r.domain} のリクエストを許可しませんでした`);
  } catch (err) {
    toast(`処理できませんでした: ${errText(err)}`, true);
  }
}

// ---------- 学習モード・接続解除 ----------

$("bulk-learning").addEventListener("change", async (e) => {
  const value = e.target.value;
  e.target.value = "";
  if (!value) return;
  const until = value === "stop" ? 0 : Date.now() + Number(value) * 60 * 1000;
  const targets = selectedDevices();
  try {
    await deliver(targets, (d) => ({ ...d.settings, learningModeUntil: until }));
    toast(value === "stop" ? `${targets.length} 台の学習モードを終了します` : `${targets.length} 台で学習モードを ${value} 分開始します`);
  } catch (err) {
    toast(`配信に失敗しました: ${errText(err)}`, true);
  }
});

$("bulk-extend").addEventListener("change", async (e) => {
  const minutes = Number(e.target.value);
  e.target.value = "";
  if (!minutes) return;
  const targets = selectedDevices();
  const today = localDateKey();
  try {
    await deliver(targets, (d) => withExtraMinutes(d.settings, today, minutes));
    toast(`${targets.length} 台の今日の利用時間を ${minutes} 分延長しました`);
  } catch (err) {
    toast(`配信に失敗しました: ${errText(err)}`, true);
  }
});

// ---------- 利用レポート ----------

const WEEK_DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

function lastSevenDays() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({ key: localDateKey(d), label: `${d.getMonth() + 1}/${d.getDate()}(${WEEK_DAY_LABELS[d.getDay()]})` });
  }
  return days;
}

// 端末の報告から、日付ごとの利用時間（分）を取り出す
function usageByDate(device) {
  const map = new Map();
  for (const h of device.reported?.usage?.history || []) map.set(h.date, Number(h.minutes || 0));
  const u = device.reported?.usage;
  if (u?.date) map.set(u.date, Number(u.minutes || 0));
  return map;
}

// 端末の設定から、その日の上限（分）。上限なしなら null
function limitOn(device, dateKey) {
  const s = normalizeSettings(device.settings || {});
  if (!s.dailyLimit.enabled) return null;
  const date = new Date(`${dateKey}T00:00:00`);
  const base = date.getDay() === 0 || date.getDay() === 6 ? s.dailyLimit.weekend : s.dailyLimit.weekday;
  return base + (s.dailyLimit.extra.date === dateKey ? s.dailyLimit.extra.minutes : 0);
}

function renderUsageBars(container, device) {
  const byDate = usageByDate(device);
  const days = lastSevenDays();
  const values = days.map((d) => byDate.get(d.key) ?? 0);
  const max = Math.max(60, ...values, ...days.map((d) => limitOn(device, d.key) || 0));
  container.replaceChildren(...days.map((d, i) => {
    const col = document.createElement("div");
    col.className = "usage-day";
    const limit = limitOn(device, d.key);
    col.innerHTML = `<b>${values[i] ? escapeHtml(formatMinutes(values[i])) : "-"}</b>
      <div class="usage-bar${limit !== null && values[i] >= limit ? " over" : ""}" style="height:${Math.round((values[i] / max) * 70)}px"></div>
      <span>${escapeHtml(d.label)}</span>`;
    return col;
  }));
  return byDate.size > 0;
}

$("open-report").addEventListener("click", () => {
  const days = lastSevenDays();
  const head = `<thead><tr><th>端末</th>${days.map((d) => `<th>${escapeHtml(d.label)}</th>`).join("")}<th>合計</th><th>1日平均</th></tr></thead>`;
  const rows = state.devices.map((device) => {
    const byDate = usageByDate(device);
    const values = days.map((d) => byDate.get(d.key) ?? null);
    const known = values.filter((v) => v !== null);
    const total = known.reduce((a, b) => a + b, 0);
    const cells = values.map((v, i) => {
      if (v === null) return '<td class="hint">-</td>';
      const limit = limitOn(device, days[i].key);
      return `<td class="${limit !== null && v >= limit ? "danger-text" : ""}">${escapeHtml(formatMinutes(v))}</td>`;
    }).join("");
    return `<tr><td><div class="dev-name">${escapeHtml(device.name || "名前なし")}</div></td>${cells}
      <td><b>${escapeHtml(formatMinutes(total))}</b></td><td>${known.length ? escapeHtml(formatMinutes(Math.round(total / known.length))) : "-"}</td></tr>`;
  }).join("");
  $("report-table").innerHTML = head + `<tbody>${rows || `<tr><td colspan="${days.length + 3}" class="hint">端末がありません。</td></tr>`}</tbody>`;
  $("dlg-report").showModal();
});

$("bulk-remove").addEventListener("click", async () => {
  const targets = selectedDevices();
  if (!confirm(`${targets.length} 台の接続を解除します。解除した端末は管理できなくなります（端末の設定はそのまま残ります）。よろしいですか？`)) return;
  try {
    const batch = writeBatch(db);
    targets.forEach((d) => batch.delete(doc(db, "devices", d.id)));
    await batch.commit();
    state.selected.clear();
    toast(`${targets.length} 台の接続を解除しました`);
  } catch (err) {
    toast(`解除に失敗しました: ${errText(err)}`, true);
  }
});

// ---------- 設定エディタ（変更した項目だけを一斉に適用） ----------

const SECTIONS = [
  { title: "基本", fields: [
    { key: "systemEnabled", type: "switch", label: "Y-FILTER を有効にする" },
    { key: "uiMode", type: "select", label: "ユーザーモード", options: [["admin", "管理者モード"], ["user", "ユーザーモード（閲覧のみ）"]] },
    { key: "accessMode", type: "select", label: "設定画面へのアクセス", desc: "完全ブロック・利用者表示にすると、その端末からこの管理コンソールも開けなくなります", number: true, options: [["0", "通常（アクセスコードで開ける）"], ["1", "完全ブロック（開けない）"], ["2", "利用者表示（ステータスのみ）"]] },
    { key: "accessCodeHash", type: "accesscode", label: "アクセスコード", desc: "設定画面などを開くときのコード。変更するときだけ入力します（コードは保存されず、元に戻せない形で配信します）" }
  ] },
  { title: "ブロック", fields: [
    { key: "safeSearchEnabled", type: "switch", label: "セーフサーチ", desc: "検索結果の安全フィルタと YouTube の制限付きモード" },
    { key: "enabledCategories", type: "categories", label: "ブロックするカテゴリ" },
    { key: "blockRules", type: "rules", label: "個別URLブロック", desc: "1行に1件、ドメイン,カテゴリ の形式" },
    { key: "allowList", type: "lines", label: "許可リスト", desc: "常に許可するドメイン（1行1件）" },
    { key: "blockPageStyle", type: "select", label: "ブロック画面のデザイン", options: [["modern", "新しいデザイン"], ["classic", "従来のデザイン"], ["kids", "子供向け"]] }
  ] },
  { title: "時間", fields: [
    { key: "timeConfig", type: "time", label: "時間制限（毎日）", desc: "指定した時間帯は毎日アクセスを制限します" },
    { key: "timeSchedule", type: "schedule", label: "曜日・時間帯のルール", desc: "曜日ごとに使えない時間帯を決めます（例: 平日 9:00〜15:00 は授業中）。最大 10 件。開始が終了より遅いときは日をまたぎます" },
    { key: "dailyLimit", type: "dailylimit", label: "1日の利用時間の上限", desc: "Web ページを見ていた時間を数え、上限に達したらその日はアクセスを制限します" }
  ] },
  { title: "広告ブロック", fields: [
    { key: "adBlockEnabled", type: "switch", label: "広告ブロックを有効にする" },
    { key: "adBlockLevel", type: "select", label: "ブロックレベル", options: [["low", "弱"], ["medium", "中（推奨）"], ["high", "強"]] },
    { key: "adBlockBadge", type: "switch", label: "ツールバーのアイコンにブロック数を表示" }
  ] },
  { title: "ファイル", fields: [
    { key: "blockAllDownloads", type: "switch", label: "すべてのダウンロードをブロック" },
    { key: "downloadExtensions", type: "exts", label: "ブロックする拡張子（ダウンロード）" },
    { key: "downloadBlockedDomains", type: "lines", label: "ダウンロードをブロックするドメイン", desc: "1行1件" },
    { key: "blockAllUploads", type: "switch", label: "すべてのアップロードをブロック" },
    { key: "uploadExtensions", type: "exts", label: "ブロックする拡張子（アップロード）" }
  ] },
  { title: "Newtab", fields: [
    { key: "newTabConfig", type: "newtab", label: "Newtab", desc: "端末側で Newtab の規約に同意している場合に有効になります" }
  ] },
  { title: "Chromebook", fields: [
    { key: "chromeOsLiteMode", type: "switch", label: "軽量化モード" },
    { key: "chromeOsOfflineScreen", type: "switch", label: "オフライン画面" },
    { key: "chromeOsReportHardwareStats", type: "switch", label: "端末情報（バッテリー・メモリ・資産ID・ログインユーザー）を送信", desc: "端末側の同意が前提です" }
  ] }
];

const editor = { fields: new Map(), dirty: new Set() };

// 設定項目の表示名（エディタにない項目も含む）
const KEY_LABELS = new Map([
  ...SECTIONS.flatMap((s) => s.fields.map((f) => [f.key, f.label])),
  ["blockKeywords", "ブロックするキーワード"],
  ["blockedExtensions", "ブロックする拡張子（旧設定）"],
  ["learningModeUntil", "学習モード"]
]);
const keyLabel = (key) => KEY_LABELS.get(key) || key;

function minutesInput(value) {
  return `<input type="number" min="0" max="1440" step="5" value="${escapeHtml(value)}" class="num">`;
}
const readMinutes = (input, fallback) => {
  const n = Math.floor(Number(input.value));
  return Number.isFinite(n) ? Math.min(1440, Math.max(0, n)) : fallback;
};

function fieldControl(field, value) {
  const wrap = document.createElement("div");
  switch (field.type) {
    case "switch":
      wrap.innerHTML = `<input type="checkbox" class="switch" ${value ? "checked" : ""}>`;
      return { el: wrap, get: () => wrap.querySelector("input").checked };
    case "select": {
      wrap.innerHTML = `<select>${field.options.map(([v, l]) => `<option value="${escapeHtml(v)}">${escapeHtml(l)}</option>`).join("")}</select>`;
      wrap.querySelector("select").value = String(value);
      return { el: wrap, get: () => (field.number ? Number(wrap.querySelector("select").value) : wrap.querySelector("select").value) };
    }
    case "text":
      wrap.innerHTML = `<input type="text" value="${escapeHtml(value)}">`;
      return { el: wrap, get: () => wrap.querySelector("input").value.trim() };
    case "lines":
      wrap.innerHTML = `<textarea spellcheck="false">${escapeHtml((value || []).join("\n"))}</textarea>`;
      return { el: wrap, get: () => wrap.querySelector("textarea").value.split("\n").map((s) => s.trim()).filter(Boolean) };
    case "rules":
      wrap.innerHTML = `<textarea spellcheck="false" placeholder="example.com,SNS">${escapeHtml((value || []).map((r) => `${r.pattern},${r.category}`).join("\n"))}</textarea>`;
      return {
        el: wrap,
        get: () => wrap.querySelector("textarea").value.split("\n").filter((l) => l.includes(",")).map((l) => {
          const [p, ...c] = l.split(",");
          return { pattern: p.trim(), category: c.join(",").trim() || "未分類" };
        })
      };
    case "time":
      wrap.className = "inline";
      wrap.innerHTML = `<input type="checkbox" class="switch" ${value?.enabled ? "checked" : ""}>
        <input type="time" value="${escapeHtml(value?.start || "21:00")}"><span class="hint">〜</span><input type="time" value="${escapeHtml(value?.end || "07:00")}">`;
      return {
        el: wrap,
        get: () => {
          const [on, s, e] = wrap.querySelectorAll("input");
          return { enabled: on.checked, start: s.value || "21:00", end: e.value || "07:00" };
        }
      };
    case "dailylimit":
      wrap.className = "inline";
      wrap.innerHTML = `<input type="checkbox" class="switch" ${value?.enabled ? "checked" : ""}>
        <span class="hint">平日</span>${minutesInput(value?.weekday ?? 120)}<span class="hint">分</span>
        <span class="hint">土日</span>${minutesInput(value?.weekend ?? 180)}<span class="hint">分</span>`;
      return {
        el: wrap,
        get: () => {
          const [on, wd, we] = wrap.querySelectorAll("input");
          // その日の延長（extra）はそのまま残す
          return { ...(value || {}), enabled: on.checked, weekday: readMinutes(wd, 120), weekend: readMinutes(we, 180) };
        }
      };
    case "accesscode":
      // 入力したときだけ変更する（入力したコードは「適用」のときにハッシュにして配信する）
      wrap.className = "inline";
      wrap.innerHTML = `<input type="password" maxlength="32" autocomplete="new-password" placeholder="新しいコード（変更するときだけ）">
        <input type="password" maxlength="32" autocomplete="new-password" placeholder="もう一度入力">`;
      return {
        el: wrap,
        get: () => {
          const [code, confirmCode] = wrap.querySelectorAll("input");
          if (!code.value && !confirmCode.value) return value ?? null;
          return { newCode: code.value.trim(), confirm: confirmCode.value.trim() };
        }
      };
    case "schedule":
      return scheduleControl(value);
    case "categories":
    case "exts": {
      const names = field.type === "exts" ? EXTENSIONS : Object.keys(state.categories);
      const set = new Set(value || []);
      wrap.className = `chips${field.type === "exts" ? " mono" : " grid"}`;
      wrap.innerHTML = names.length
        ? names.map((n) => `<label class="chip"><input type="checkbox" value="${escapeHtml(n)}" ${set.has(n) ? "checked" : ""}><span>${escapeHtml(n)}</span></label>`).join("")
        : '<span class="hint">カテゴリ一覧を読み込めませんでした。</span>';
      return { el: wrap, get: () => Array.from(wrap.querySelectorAll("input:checked")).map((i) => i.value) };
    }
    case "newtab":
      wrap.className = "inline";
      wrap.innerHTML = `<input type="checkbox" class="switch" ${value?.enabled ? "checked" : ""}>
        <select>${NEWTAB_MODES.map((m) => `<option value="${m}">${m === "normal" ? "v7（通常）" : m === "lite" ? "Simple" : m === "beta" ? "v7 Beta" : m}</option>`).join("")}</select>`;
      wrap.querySelector("select").value = value?.mode || "normal";
      return {
        el: wrap,
        get: () => ({ enabled: wrap.querySelector("input").checked, agreed: !!value?.agreed, mode: wrap.querySelector("select").value })
      };
    default:
      return { el: wrap, get: () => value };
  }
}

// 曜日・時間帯のルールの入力欄
const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];
function scheduleControl(value) {
  const wrap = document.createElement("div");
  wrap.className = "schedule-edit";
  wrap.innerHTML = `
    <label class="inline"><input type="checkbox" class="switch" ${value?.enabled ? "checked" : ""}><span class="hint">ルールを使う</span></label>
    <div class="schedule-rules"></div>
    <button class="btn btn-tonal" type="button">ルールを追加</button>`;
  const list = wrap.querySelector(".schedule-rules");
  const addRow = (rule = { days: [1, 2, 3, 4, 5], start: "09:00", end: "15:00" }) => {
    if (list.children.length >= 10) return;
    const row = document.createElement("div");
    row.className = "schedule-rule";
    row.innerHTML = `
      <div class="schedule-days">${DAY_LABELS.map((l, d) => `<label><input type="checkbox" value="${d}" ${rule.days?.includes(d) ? "checked" : ""}>${l}</label>`).join("")}</div>
      <input type="time" value="${escapeHtml(rule.start || "09:00")}"><span class="hint">〜</span><input type="time" value="${escapeHtml(rule.end || "15:00")}">
      <button class="link-btn danger-text remove" type="button">削除</button>`;
    row.querySelector(".remove").addEventListener("click", () => {
      row.remove();
      wrap.dispatchEvent(new Event("change", { bubbles: true }));
    });
    list.appendChild(row);
  };
  (value?.rules || []).forEach((r) => addRow(r));
  wrap.querySelector("button.btn").addEventListener("click", () => {
    addRow();
    wrap.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return {
    el: wrap,
    get: () => ({
      enabled: wrap.querySelector(".switch").checked,
      rules: Array.from(list.querySelectorAll(".schedule-rule")).map((row) => {
        const [s, e] = row.querySelectorAll('input[type="time"]');
        return { days: Array.from(row.querySelectorAll(".schedule-days input:checked")).map((i) => Number(i.value)), start: s.value, end: e.value };
      }).filter((r) => r.days.length && r.start && r.end)
    })
  };
}

function openEditor() {
  const targets = selectedDevices();
  if (!targets.length) return;
  const base = normalizeSettings(targets[0].settings || buildDefaultSettings());
  editor.fields.clear();
  editor.dirty.clear();
  $("edit-title").textContent = `設定を変更（${targets.length} 台）`;
  $("edit-note").textContent = targets.length > 1
    ? `「${targets[0].name || "名前なし"}」の配信設定を表示しています。変更した項目だけが、選んだ ${targets.length} 台すべてに適用されます（ほかの項目は端末ごとの設定のまま）。`
    : `「${targets[0].name || "名前なし"}」の配信設定です。変更した項目が適用されます。`;
  const form = $("edit-form");
  form.replaceChildren();
  for (const section of SECTIONS) {
    const sec = document.createElement("div");
    sec.className = "ed-section";
    sec.innerHTML = `<h3>${escapeHtml(section.title)}</h3>`;
    for (const field of section.fields) {
      const control = fieldControl(field, base[field.key]);
      const row = document.createElement("div");
      const stacked = ["lines", "rules", "categories", "exts", "schedule"].includes(field.type);
      row.className = `ed-field${stacked ? " stack" : ""}`;
      row.innerHTML = `<div><div class="ed-label">${escapeHtml(field.label)}<span class="ed-badge">変更</span></div>${field.desc ? `<div class="ed-desc">${escapeHtml(field.desc)}</div>` : ""}</div>`;
      row.appendChild(control.el);
      const initial = stable(control.get());
      const markDirty = () => {
        const isDirty = stable(control.get()) !== initial;
        row.classList.toggle("dirty", isDirty);
        if (isDirty) editor.dirty.add(field.key);
        else editor.dirty.delete(field.key);
        $("edit-dirty").textContent = `変更した項目: ${editor.dirty.size}`;
        $("edit-apply").disabled = editor.dirty.size === 0;
      };
      row.addEventListener("input", markDirty);
      row.addEventListener("change", markDirty);
      editor.fields.set(field.key, control);
      sec.appendChild(row);
    }
    form.appendChild(sec);
  }
  $("edit-dirty").textContent = "変更した項目: 0";
  $("edit-apply").disabled = true;
  $("dlg-edit").showModal();
}

// カテゴリに対応するキーワード（拡張機能の設定画面と同じく、カテゴリ選択から作る）
function keywordsFor(categories) {
  return categories.flatMap((c) => state.categories[c]?.keywords || []);
}

$("edit-apply").addEventListener("click", async () => {
  const patch = {};
  for (const key of editor.dirty) patch[key] = editor.fields.get(key).get();
  if (patch.enabledCategories) patch.blockKeywords = keywordsFor(patch.enabledCategories);
  // 新しいアクセスコードは、ここでハッシュにする（コードそのものは配信しない）
  if (patch.accessCodeHash?.newCode !== undefined) {
    const { newCode, confirm: confirmCode } = patch.accessCodeHash;
    const error = validateNewAccessCode(newCode) || (newCode !== confirmCode ? "確認のために入力したアクセスコードが一致しません。" : "");
    if (error) return toast(error, true);
    patch.accessCodeHash = await hashAccessCode(newCode);
  }
  const targets = selectedDevices();
  try {
    await deliver(targets, (d) => ({ ...d.settings, ...patch }));
    $("dlg-edit").close();
    toast(`${targets.length} 台に ${editor.dirty.size} 項目を配信しました`);
  } catch (err) {
    toast(`配信に失敗しました: ${errText(err)}`, true);
  }
});
$("bulk-edit").addEventListener("click", openEditor);

// ---------- ほかの端末の設定をコピー ----------

// コピー元: 端末（value = 端末 ID）と、自分の端末のバックアップ（value = backup:端末 ID。持ち主だけ）
function copySource() {
  const value = $("copy-source").value;
  if (value.startsWith("backup:")) {
    const b = state.backups.find((x) => x.id === value.slice(7));
    return b ? { id: "", name: `${b.deviceName || "名前なし"} のバックアップ`, settings: b.settings, backup: true } : null;
  }
  const d = state.devices.find((x) => x.id === value);
  if (!d) return null;
  const kind = document.querySelector('input[name="copy-kind"]:checked').value;
  return { id: d.id, name: d.name || "名前なし", settings: kind === "reported" ? d.reported?.settings : d.settings, backup: false };
}

function updateCopyNote() {
  const src = copySource();
  const targets = selectedDevices().filter((d) => d.id !== src?.id);
  // バックアップには「今の設定 / 配信した設定」の区別がないので、選べなくする
  document.querySelectorAll('input[name="copy-kind"]').forEach((r) => { r.disabled = !!src?.backup; });
  const has = !!src?.settings;
  $("copy-note").textContent = !src ? "" : !has
    ? "この端末にはまだその設定がありません。"
    : `「${src.name}」の設定をまるごと、選んだ ${targets.length} 台に適用します（アクセスコードなども含めてすべて上書きします）。`;
  $("copy-apply").disabled = !src || !has || targets.length === 0;
}

$("bulk-copy").addEventListener("click", () => {
  const select = $("copy-source");
  const backups = state.teamId === state.user.uid ? state.backups : [];
  select.innerHTML = state.devices.map((d) => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.name || "名前なし")}${isPersonal(d) ? "（自分の端末）" : ""}</option>`).join("")
    + (backups.length
      ? `<optgroup label="自分の端末のバックアップ">${backups.map((b) => `<option value="backup:${escapeHtml(b.id)}">${escapeHtml(b.deviceName || "名前なし")}（${escapeHtml(toMillis(b.savedAt) ? new Date(toMillis(b.savedAt)).toLocaleString() : "-")}）</option>`).join("")}</optgroup>`
      : "");
  const firstUnselected = state.devices.find((d) => !state.selected.has(d.id));
  if (firstUnselected) select.value = firstUnselected.id;
  updateCopyNote();
  $("dlg-copy").showModal();
});
$("copy-source").addEventListener("change", updateCopyNote);
document.querySelectorAll('input[name="copy-kind"]').forEach((r) => r.addEventListener("change", updateCopyNote));

$("copy-apply").addEventListener("click", async () => {
  const src = copySource();
  if (!src?.settings) return;
  const settings = src.settings;
  const targets = selectedDevices().filter((d) => d.id !== src.id);
  try {
    await deliver(targets, () => ({ ...settings }));
    $("dlg-copy").close();
    toast(`「${src.name}」の設定を ${targets.length} 台に配信しました`);
  } catch (err) {
    toast(`配信に失敗しました: ${errText(err)}`, true);
  }
});

// ---------- 端末の詳細 ----------

let detailId = "";
function openDetail(id) {
  const d = state.devices.find((x) => x.id === id);
  if (!d) return;
  detailId = id;
  const st = deviceStatus(d);
  const info = d.reported?.info || {};
  $("detail-name").value = d.name || "";
  const rows = [
    ["端末 ID", `<span class="mono">${escapeHtml(d.id)}</span>`],
    ["種類", isPersonal(d) ? "自分の端末（SK Hub Systems アカウント。あなたにだけ見えます）" : "管理している端末"],
    ["状態", st.online ? "オンライン" : "オフライン"],
    ["最終接続", escapeHtml(timeAgo(st.lastSeen))],
    ["今日の利用時間", escapeHtml(usageText(d) || "-")],
    ["接続した日時", escapeHtml(d.pairedAt ? new Date(toMillis(d.pairedAt)).toLocaleString() : "-")],
    ["配信番号（反映済み / 最新）", `${Number(d.reported?.appliedRev || 0)} / ${Number(d.settingsRev || 0)}`],
    ["OS", escapeHtml(OS_LABEL[info.os] || info.os || "-")],
    ["Y-FILTER のバージョン", escapeHtml(info.extensionVersion || "-")],
    ["シークレットモード", info.incognitoAllowed === false
      ? '<span class="danger-text">Y-FILTER. が動いていません（拡張機能の詳細で許可が必要）</span>'
      : info.incognitoAllowed === true ? "Y-FILTER. が動いています" : "-"]
  ];
  if (d.settingsUpdatedBy) rows.push(["最後に配信した人", escapeHtml(d.settingsUpdatedBy)]);
  if (info.assetId) rows.push(["資産 ID", escapeHtml(info.assetId)]);
  if (info.loginEmail) rows.push(["ログインユーザー", escapeHtml(info.loginEmail)]);
  if (info.memoryUsage !== undefined) rows.push(["メモリ使用率", `${escapeHtml(info.memoryUsage)}%`]);
  $("detail-kv").innerHTML = rows.map(([k, v]) => `<div class="row"><div class="k">${escapeHtml(k)}</div><div class="v">${v}</div></div>`).join("");

  const hasUsage = renderUsageBars($("detail-usage"), d);
  show("detail-usage", hasUsage);
  show("detail-usage-empty", !hasUsage);

  const changedKeys = d.reported?.settings ? diffKeys(d.settings, d.reported.settings) : [];
  show("detail-diff", !st.pending && changedKeys.length > 0);
  show("detail-adopt", !st.pending && changedKeys.length > 0);
  $("detail-diff").textContent = `端末側で変更された項目: ${changedKeys.map(keyLabel).join("、")}。「取り込む」を押すと、端末の今の設定を配信設定にします（次の配信でこの内容が使われます）。`;
  $("dlg-detail").showModal();
}

$("detail-rename").addEventListener("click", async () => {
  const name = $("detail-name").value.trim().slice(0, 60);
  if (!name) return;
  try {
    await updateDoc(doc(db, "devices", detailId), { name });
    toast("端末名を変更しました");
  } catch (err) {
    toast(`変更に失敗しました: ${errText(err)}`, true);
  }
});

$("detail-adopt").addEventListener("click", async () => {
  const d = state.devices.find((x) => x.id === detailId);
  if (!d?.reported?.settings) return;
  try {
    await deliver([d], () => ({ ...d.reported.settings }));
    $("dlg-detail").close();
    toast("端末の設定を配信設定として取り込みました");
  } catch (err) {
    toast(`取り込みに失敗しました: ${errText(err)}`, true);
  }
});

// ---------- ペアリングコード ----------

let shownCode = null;
let pairTimer = null;

async function issueCode() {
  $("pair-msg").textContent = "";
  const code = generateCode();
  const expiresAt = Date.now() + PAIRING_TTL_MS;
  try {
    await setDoc(doc(db, "pairingCodes", code), {
      ownerUid: state.teamId,
      createdBy: state.user.uid,
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromMillis(expiresAt)
    });
    shownCode = { code, expiresAt, teamId: state.teamId };
    renderShownCode();
  } catch (err) {
    $("pair-msg").textContent = `コードを発行できませんでした（${errText(err)}）`;
  }
}

function renderShownCode() {
  if (!shownCode) return;
  const left = Math.max(0, shownCode.expiresAt - Date.now());
  $("pair-code").textContent = left > 0 ? formatCode(shownCode.code) : "期限切れ";
  $("pair-exp").textContent = left > 0
    ? `有効期限まで ${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`
    : "「新しいコードを発行」を押してください";
}

function renderPairingList() {
  const list = $("pair-list");
  const active = state.pairingCodes.filter((p) => toMillis(p.expiresAt) > Date.now());
  if (!active.length) {
    list.innerHTML = '<div class="hint">有効なコードはありません。</div>';
    return;
  }
  list.replaceChildren(...active.map((p) => {
    const row = document.createElement("div");
    row.className = "pair-row";
    row.innerHTML = `<b>${escapeHtml(formatCode(p.code))}</b><span class="hint">${escapeHtml(new Date(toMillis(p.expiresAt)).toLocaleTimeString())} まで</span><button class="link-btn" type="button">無効にする</button>`;
    row.querySelector("button").addEventListener("click", async () => {
      try {
        await deleteDoc(doc(db, "pairingCodes", p.code));
        if (shownCode?.code === p.code) shownCode = { ...shownCode, expiresAt: 0 };
        renderShownCode();
      } catch (err) {
        toast(`無効にできませんでした: ${errText(err)}`, true);
      }
    });
    return row;
  }));
}

$("add-device").addEventListener("click", async () => {
  $("dlg-pair").showModal();
  if (!shownCode || shownCode.expiresAt < Date.now() || shownCode.teamId !== state.teamId) await issueCode();
  else renderShownCode();
  clearInterval(pairTimer);
  pairTimer = setInterval(() => { renderShownCode(); renderPairingList(); }, 1000);
});
$("pair-new").addEventListener("click", issueCode);
$("dlg-pair").addEventListener("close", () => clearInterval(pairTimer));

// ---------- ダイアログ共通 ----------

document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => btn.closest("dialog").close());
});

// 最終接続・リクエストの経過時間の表示を定期的に更新する
setInterval(() => {
  if (!state.user) return;
  renderDevices();
  renderRequests();
}, 30 * 1000);
