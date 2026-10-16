(() => {
  "use strict";
  const FEATURE_NAME = "stbNewtabSetting";
  const BUTTON_ID = `${FEATURE_NAME}-button`;
  const WRAPPER_ID = `${FEATURE_NAME}-wrapper`;
  const STYLE_ID = `${FEATURE_NAME}-style`;
  const TARGET_SELECTOR = ".tbh-top";
  const INSERT_DELAY = 200;
  const ANIMATION_DURATION = 1200;
  const ANIMATION_EASING = "cubic-bezier(.58,.2,0,1)";
  const STORAGE_KEY = "saetab_bridge_enabled"; // ローカルストレージキー

  let observer = null;
  let insertTimer = null;
  let inserted = false;

  const log = (message, details = "") => {
    console.info(`[${FEATURE_NAME}] ${message}`, details);
  };

  // bridgeが有効か取得
  const isBridgeEnabled = () => localStorage.getItem(STORAGE_KEY) === "true";

  // bridge状態を保存
  const setBridgeEnabled = (enabled) => {
    if (enabled) {
      localStorage.setItem(STORAGE_KEY, "true");
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
    updateButtonUI(); // 状態に応じてボタン表示を更新
  };

  const addStyle = () => {
    if (document.getElementById(STYLE_ID)) return true;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${WRAPPER_ID} {
        opacity: 0;
        transform: scale(0);
        transform-origin: center;
        pointer-events: none;
        filter: blur(16px);
      }
      #${WRAPPER_ID}.${FEATURE_NAME}-visible {
        opacity: 1;
        transform: scale(1);
        pointer-events: auto;
        filter: blur(0);
        transition:
          opacity ${ANIMATION_DURATION}ms ${ANIMATION_EASING},
          filter ${ANIMATION_DURATION}ms ${ANIMATION_EASING},
          transform ${ANIMATION_DURATION}ms ${ANIMATION_EASING};
      }
      #${BUTTON_ID} {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        box-sizing: border-box;
        width: 100%;
        min-height: 40px;
        margin: 0;
        padding: 10px 16px;
        border: none;
        border-radius: 99px;
        background: var(--ink);
        color: var(--surface);
        font: inherit;
        text-align: center;
        cursor: pointer;
        transition: background-color 120ms ease;
      }
      /* アイコンのみ表示時 */
      #${BUTTON_ID}.${FEATURE_NAME}-icon-only {
        padding: 10px;
        width: auto;
        min-width: 40px;
      }
      #${BUTTON_ID} img {
        height: 26px;
        scale: 1.4;
        width: 28px;
      }
      #${BUTTON_ID}:focus-visible {
        outline: 2px solid #1a73e8;
        outline-offset: 2px;
      }
      @media (prefers-reduced-motion: reduce) {
        #${WRAPPER_ID},
        #${WRAPPER_ID}.${FEATURE_NAME}-visible {
          transition: none;
          transform: none;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
    log("CSSを追加しました。");
    return true;
  };

  // ボタン表示を現在の状態に合わせて更新
  const updateButtonUI = () => {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;

    const enabled = isBridgeEnabled();
    if (enabled) {
      // 有効時：アイコンのみ
      button.classList.add(`${FEATURE_NAME}-icon-only`);
      button.innerHTML = `<img src="https://search3958.github.io/project/logos/saetab_main.svg" alt="Saetab">`;
      button.setAttribute("aria-label", "連携解除");
    } else {
      // 無効時：アイコン＋テキスト
      button.classList.remove(`${FEATURE_NAME}-icon-only`);
      button.innerHTML = `<img src="https://search3958.github.io/project/logos/saetab_main.svg" alt="Saetab">新しいタブに設定`;
      button.setAttribute("aria-label", "新しいタブに設定");
    }
  };
  const BRIDGE_PAGE_URL = "https://search3958.github.io/newtab/extension/saetab-bridge.html";

  // 確認はツールボックス共通のダイアログ（/toolbox/shared/m3.js の M3.confirm）で出す
  const t = (s) => (window.SKI18N ? window.SKI18N.t(s) : s);
  const ask = (opts) => (window.M3 ? window.M3.confirm(opts) : Promise.resolve(confirm(opts.title + "\n\n" + opts.text)));

  // ボタンクリック時の処理
  const handleButtonClick = () => {
    if (isBridgeEnabled()) {
      // 有効時 → 連携解除確認
      ask({
        title: t("Saetabとの連携を解除しますか？"),
        text: t("解除したあと、Saetabの「同期と管理」から拡張機能を削除してください。"),
        ok: t("連携を解除"),
        icon: "link_off",
        danger: true
      }).then((yes) => {
        if (!yes) return;
        setBridgeEnabled(false);
        log("bridgeを無効にしました。");
      });
    } else {
      // 無効時 → 連携承認確認
      ask({
        title: t("Saetabを新しいタブに設定しますか？"),
        text: t("Saetab 7に表示するため、時間割とメモの内容がSentaroさんに共有されます。"),
        ok: t("共有して設定"),
        icon: "tab"
      }).then((yes) => {
        if (!yes) return;
        setBridgeEnabled(true);
        log("bridgeを有効にしました。");

        // 指定ページを新しいタブで開く（ダイアログのボタンを押した流れの中なので、ブロックされない）
        window.open(BRIDGE_PAGE_URL, "_blank", "noopener");
      });
    }
  };

  const insertButton = () => {
    if (inserted || document.getElementById(WRAPPER_ID)) {
      inserted = true;
      return true;
    }
    const target = document.querySelector(TARGET_SELECTOR);
    if (!target) return false;

    addStyle();
    const wrapper = document.createElement("div");
    wrapper.id = WRAPPER_ID;

    // 初期状態でボタンHTMLを生成（状態に応じてupdateButtonUIで調整）
    wrapper.innerHTML = `
      <button type="button" id="${BUTTON_ID}"></button>
    `;

    const secondElement = target.children[1];
    if (secondElement) {
      target.insertBefore(wrapper, secondElement);
    } else {
      target.appendChild(wrapper);
    }

    const button = wrapper.querySelector(`#${BUTTON_ID}`);
    if (!button) {
      log("ボタンの取得に失敗しました。");
      wrapper.remove();
      return false;
    }

    // 最新の状態で表示を初期化
    updateButtonUI();
    button.addEventListener("click", handleButtonClick);

    inserted = true;
    log("ボタンを挿入しました。");

    insertTimer = window.setTimeout(() => {
      if (!wrapper.isConnected) {
        log("表示前に要素が削除されました。");
        inserted = false;
        return;
      }
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          wrapper.classList.add(`${FEATURE_NAME}-visible`);
          log("フェードイン＋スケールアップを開始しました。");
        });
      });
    }, INSERT_DELAY);

    return true;
  };

  // SaeTab の拡張機能ページで「追加」を押すと ?saetab=connect 付きで開かれる。
  // そのときは、ボタンを押したときと同じ確認をすぐ出す（共有の許可はここで本人が押す）
  const CONNECT_PARAM = "saetab";
  const openFromSaetab = () => {
    const params = new URLSearchParams(location.search);
    if (params.get(CONNECT_PARAM) !== "connect") return;
    params.delete(CONNECT_PARAM);
    const query = params.toString();
    history.replaceState(null, "", location.pathname + (query ? "?" + query : "") + location.hash);
    const button = document.getElementById(BUTTON_ID);
    if (button) button.scrollIntoView({ block: "center" });
    if (isBridgeEnabled()) {
      log("SaeTab から開かれましたが、すでに連携しています。");
      return;
    }
    log("SaeTab から開かれたので、確認を出します。");
    // ボタンが出るアニメーションのあと（M3 のダイアログも読み込み済みになってから）
    window.setTimeout(handleButtonClick, INSERT_DELAY + 400);
  };

  const start = () => {
    if (insertButton()) { openFromSaetab(); return; }
    log("挿入先を待機しています。");
    observer = new MutationObserver(() => {
      if (insertButton()) {
        observer.disconnect();
        observer = null;
        log("挿入先を検出しました。");
        openFromSaetab();
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();