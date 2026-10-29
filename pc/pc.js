// PC へのサインインを承認する（/pc/?code=コード）
//   Windows のサインイン画面の「Sign in with SK Hub」と、設定ツール（skhub-logon-setup add）が出すコードを入力して承認する。
//   1. SK Hub Systems アカウントでログイン（アカウントの作成・規約の同意がまだなら /account/ で済ませて戻ってくる）
//   2. コードの依頼（windowsLogons/{コード}）を読んで、PC の名前と、サインインかアカウントをつなぐのかを見せる
//   3. 承認 → status: approved・uid: 自分の UID。PC は、その UID がつないだアカウントならサインインする
// PC の側: _windows-logon（C++ の Credential Provider と設定ツール）。権限: y-filter リポジトリの systems/firestore.rules（windowsLogons）
import { accountPageUrl, db, profileOf, rememberAccount, watchAccount } from "/assets/hub/account.js";
import { doc, getDoc, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CODE_TTL_MS = 10 * 60 * 1000; // _windows-logon/src/common/config.h の SKHUB_CODE_TTL_SECONDS と同じ
const CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;

const $ = (sel) => document.querySelector(sel);
let current = null;
let pending = null; // { code, purpose }
let busy = false;

function showView(name) {
  document.querySelectorAll("[data-pc-view]").forEach((el) => { el.hidden = el.dataset.pcView !== name; });
}

function message(text) {
  $("#pc-msg").textContent = text || "";
}

// 入力のゆれをなおす（小文字・ハイフン・空白）
function normalizeCode(raw) {
  return String(raw || "").toUpperCase().replace(/[\s-]/g, "");
}

const formatCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;

function userChip(user, account) {
  const p = profileOf(user, account);
  const box = document.createDocumentFragment();
  let avatar;
  if (p.photo) {
    avatar = document.createElement("img");
    avatar.src = p.photo;
    avatar.alt = "";
    avatar.referrerPolicy = "no-referrer";
  } else {
    avatar = document.createElement("span");
    avatar.className = "pc-letter";
    avatar.style.background = p.colorValue;
    avatar.textContent = p.letter;
  }
  const text = document.createElement("div");
  text.textContent = p.name || user.email || "";
  const small = document.createElement("small");
  small.textContent = user.email || "";
  text.appendChild(small);
  box.append(avatar, text);
  return box;
}

function showUser() {
  document.querySelectorAll("[data-pc-user]").forEach((el) => el.replaceChildren(userChip(current.user, current.account)));
}

function done(title, text) {
  $("[data-pc-done-title]").textContent = title;
  $("[data-pc-done-text]").textContent = text;
  history.replaceState(null, "", location.pathname);
  showView("done");
}

async function lookup(code) {
  if (!CODE_PATTERN.test(code)) {
    message("コードは 8 文字です（0・1・I・O は使っていません）。");
    return;
  }
  busy = true;
  message("確かめています…");
  try {
    const snap = await getDoc(doc(db, "windowsLogons", code));
    const data = snap.exists() ? snap.data() : null;
    const createdAt = data?.createdAt?.toMillis?.() || 0;
    if (!data || data.status !== "pending" || Date.now() - createdAt > CODE_TTL_MS) {
      message("このコードは見つからないか、有効期限が切れています。PC で新しいコードを表示してください。");
      return;
    }
    pending = { code, purpose: data.purpose === "register" ? "register" : "signin" };
    const register = pending.purpose === "register";
    $("[data-pc-title]").textContent = register ? "この PC のサインインに、アカウントをつなぎますか？" : "この PC にサインインしますか？";
    $("[data-pc-name]").textContent = data.pcName || "名前のない PC";
    $("[data-pc-code]").textContent = `コード ${formatCode(code)}`;
    $("[data-pc-desc]").textContent = register
      ? "承認すると、この PC の Windows のサインイン画面で「Sign in with SK Hub」を選び、このアカウントで承認するだけでサインインできるようになります。"
      : "承認すると、この PC の Windows に、このアカウントにつながっているユーザーでサインインします。";
    message("");
    showView("confirm");
  } catch (err) {
    message(`確かめられませんでした（${err?.code || err?.message || err}）`);
  } finally {
    busy = false;
  }
}

async function decide(approved) {
  if (busy || !pending || !current) return;
  busy = true;
  document.querySelectorAll("#pc-approve, #pc-deny").forEach((b) => { b.disabled = true; });
  message(approved ? "承認しています…" : "");
  try {
    await updateDoc(doc(db, "windowsLogons", pending.code), {
      status: approved ? "approved" : "denied",
      uid: current.user.uid,
      decidedAt: serverTimestamp()
    });
    message("");
    if (!approved) {
      done("拒否しました", "PC にはサインインしません。心当たりがない場合は、アカウントのページでログインの方法を確かめてください。");
    } else if (pending.purpose === "register") {
      done("承認しました", "PC の設定ツールに「つなぎました」と表示されたら完了です。このページは閉じてかまいません。");
    } else {
      done("承認しました", "まもなく PC がサインインします。このページは閉じてかまいません。");
    }
    pending = null;
  } catch (err) {
    // 期限切れ・ほかの端末で決めた後はルールで拒否される
    message(err?.code === "permission-denied"
      ? "承認できませんでした。コードの有効期限が切れたか、すでに承認・拒否されています。"
      : `承認できませんでした（${err?.code || err?.message || err}）`);
  } finally {
    busy = false;
    document.querySelectorAll("#pc-approve, #pc-deny").forEach((b) => { b.disabled = false; });
  }
}

$("#pc-form").addEventListener("submit", (e) => {
  e.preventDefault();
  if (!busy) lookup(normalizeCode($("#pc-code").value));
});
$("#pc-code").addEventListener("input", (e) => {
  // 4 文字ごとにハイフンを入れて見やすくする
  const code = normalizeCode(e.target.value).slice(0, 8);
  e.target.value = code.length > 4 ? formatCode(code) : code;
});
$("#pc-approve").addEventListener("click", () => decide(true));
$("#pc-deny").addEventListener("click", () => decide(false));

watchAccount((state) => {
  if (state.status === "error") {
    showView("loading");
    message(`アカウントを確認できませんでした（${state.error?.code || state.error?.message || state.error}）`);
    return;
  }
  // ログイン・アカウントの作成・規約の同意がまだなら、アカウントのページで済ませて戻ってくる
  if (state.status !== "ready") {
    location.replace(accountPageUrl(location.pathname + location.search));
    return;
  }
  const first = !current;
  current = state;
  rememberAccount(state.user, state.account);
  showUser();
  if (!first) return;
  const code = normalizeCode(new URLSearchParams(location.search).get("code"));
  if (code) $("#pc-code").value = formatCode(code);
  showView("code");
  if (CODE_PATTERN.test(code)) lookup(code);
});
