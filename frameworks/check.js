// SK Hub Systems アクセスチェック
// RedFlag Checker OSS by Sentaro（search3958/search3958.github.io の frameworks/check-oss.js）を SK 向けに改変したものです。
// 元ファイル: "You are permitted to freely modify this file."
//
// 使い方: <script src="/frameworks/check.js" defer></script>
//         規約・サポートなど、ブロック中の人も読めるべきページは ?check=none を付ける
//         （同意カードと情報ウィジェットは出るが、リダイレクトはしない）
(function() {
    "use strict";

    // SK's Toolbox を LINE のミニアプリとして開いているときは、同意カード・情報ウィジェット・チェックを出さない
    //（/toolbox/shared/line.js。規約とポリシーは、Toolbox の設定・LINE の同意の画面から読める）
    if ((function () { try { return /[?&]line=/.test(location.search) || /[?&]liff\.state=/.test(location.search) || !!sessionStorage.getItem("sk_line"); } catch (e) { return false; } })()) return;

    const LOG_PREFIX = "[SKHubCheck]";
    const HEAVY_SCRIPT_ATTR = "data-RedCheckOSS-heavy-script";

    const SCRIPT_SOURCE = (() => {
        try {
            const currentScript = document.currentScript;

            if (currentScript && currentScript.src) {
                return currentScript.src;
            }

            const scripts = document.getElementsByTagName("script");

            for (let index = scripts.length - 1; index >= 0; index -= 1) {
                const script = scripts[index];

                if (!script || typeof script.src !== "string" || !script.src) {
                    continue;
                }

                try {
                    const scriptUrl = new URL(script.src, document.baseURI);
                    if (scriptUrl.pathname.endsWith("/check.js")) {
                        return scriptUrl.href;
                    }
                } catch (error) {
                    console.error(
                        `${LOG_PREFIX} ❌ Script URL parse error:`,
                        error
                    );
                }
            }

            return "";
        } catch (error) {
            console.error(
                `${LOG_PREFIX} ❌ Script source detection error:`,
                error
            );
            return "";
        }
    })();

    const SCRIPT_CHECK_MODE = (() => {
        if (!SCRIPT_SOURCE) {
            return null;
        }

        try {
            return new URL(
                SCRIPT_SOURCE,
                document.baseURI
            ).searchParams.get("check");
        } catch (error) {
            console.error(
                `${LOG_PREFIX} ❌ check.js query parse error:`,
                error
            );
            return null;
        }
    })();

    const RedCheckOSS = {
        CONFIG: {
            // SK Hub Systems（Firebase プロジェクト y-filter-systems）
            // 値は y-filter/firebase-config.js と同じ。Firestore のルールは y-filter リポジトリの systems/firestore.rules（hub_access_logs・hub_blocklist）。
            HUB: {
                FIREBASE_PROJECT_ID: "y-filter-systems",
                FIREBASE_API_KEY: "AIzaSyB4gqzPEPyP0NrEJw33-OTAxUrF48MmiuI",
                LOG_COLLECTION: "hub_access_logs",
                BLOCKLIST_COLLECTION: "hub_blocklist"
            },
            ENTRY_URL:
                "/usercheck/entry.html",
            BLOCKED_URL:
                "/usercheck/blocked.html",
            ABOUT_URL:
                "/about/",
            POLICIES_URL:
                "/policies/",
            // 右下に出すアイコン（暗い背景のボタンなので、白〜水色の SK アイコン。64px を 22px で表示）
            ICON_URL:
                "/assets/sk-dark.png",
            UUID_KEY:
                "skhub_uuid",
            TERMS_ACCEPTED_KEY:
                "skhub_terms_accepted",
            TERMS_NOTICE_SHOWN_KEY:
                "skhub_terms_notice_shown",
            // check.js からの相対パス
            HEAVY_SCRIPT_NAME:
                "check-heavy.js"
        },

        STATE: {
            scriptSource: SCRIPT_SOURCE,
            checkMode: SCRIPT_CHECK_MODE,
            uuid: null,
            termsState: null,
            serverStatus: null,
            initialized: false,
            heavyLoadPromise: null
        },

        async init() {
            console.log(
                `${LOG_PREFIX} 🔧 MODE=${
                    this.STATE.checkMode === "none"
                        ? "check=none"
                        : "normal"
                }`
            );

            // Heavy is mandatory and is loaded before any core processing.
            let heavy;
            try {
                heavy = await this.loadHeavyScript();
            } catch (error) {
                console.error(
                    `${LOG_PREFIX} ❌ Heavy module is required but failed to load:`,
                    error
                );
                return;
            }

            if (
                !heavy ||
                typeof heavy.generateUUID !== "function" ||
                typeof heavy.checkServerStatus !== "function"
            ) {
                console.error(
                    `${LOG_PREFIX} ❌ Heavy core is unavailable`
                );
                return;
            }

            let termsState = null;

            try {
                termsState = localStorage.getItem(this.CONFIG.TERMS_ACCEPTED_KEY);
                this.STATE.termsState = termsState;
            } catch (error) {
                console.error(
                    `${LOG_PREFIX} ❌ Failed to read termsAccepted:`,
                    error
                );
            }

            const termsPending =
                termsState === null ||
                (typeof termsState === "string" && termsState.trim() === "");

            let noticeShown = false;

            try {
                noticeShown =
                    localStorage.getItem(
                        this.CONFIG.TERMS_NOTICE_SHOWN_KEY
                    ) === "true";
            } catch (error) {
                console.error(
                    `${LOG_PREFIX} ❌ Failed to read initial notice state:`,
                    error
                );
            }

            // まだ同意していない（「同意して閉じる」も「同意しない」も押していない）: 押すまで、どのページでも帯を出す。
            // 同意するまでは、アクセスチェックの記録を送らない（SK 利用規約 第二条2・SK プライバシーポリシー 第三条5）
            if (termsPending) {
                const injected = this.injectConsentCard();

                if (!injected) {
                    console.error(
                        `${LOG_PREFIX} ❌ Initial consent UI injection failed`
                    );
                    return;
                }

                try {
                    localStorage.setItem(
                        this.CONFIG.TERMS_NOTICE_SHOWN_KEY,
                        "true"
                    );
                } catch (error) {
                    console.error(
                        `${LOG_PREFIX} ❌ Failed to save initial notice flag:`,
                        error
                    );
                }

                return;
            }

            if (termsState === "false") {
                if (this.STATE.checkMode !== "none") {
                    window.location.replace(this.CONFIG.ENTRY_URL);
                }
                // 同意していない人の情報はサーバーに送らない
                return;
            }

            let uuid = null;

            try {
                uuid = localStorage.getItem(this.CONFIG.UUID_KEY);
            } catch (error) {
                console.error(
                    `${LOG_PREFIX} ❌ Failed to read UUID:`,
                    error
                );
            }

            if (!uuid) {
                try {
                    uuid = heavy.generateUUID();
                    localStorage.setItem(this.CONFIG.UUID_KEY, uuid);
                } catch (error) {
                    console.error(
                        `${LOG_PREFIX} ❌ Failed to generate/save UUID:`,
                        error
                    );
                    return;
                }
            }

            this.STATE.uuid = uuid;

            try {
                const serverResult =
                    await heavy.checkServerStatus(uuid, this.CONFIG.HUB);

                this.STATE.serverStatus =
                    serverResult.status;

                if (
                    this.STATE.checkMode !== "none" &&
                    serverResult.status === "blocked"
                ) {
                    window.location.replace(
                        this.CONFIG.BLOCKED_URL
                    );
                    return;
                }

                if (termsPending) {
                    try {
                        localStorage.setItem(
                            this.CONFIG.TERMS_ACCEPTED_KEY,
                            "true"
                        );
                        this.STATE.termsState = "true";
                    } catch (error) {
                        console.error(
                            `${LOG_PREFIX} ❌ Failed to save termsAccepted:`,
                            error
                        );
                    }
                }

                this.injectViewTransitionStyle();
                this.injectInfoWidget();
                this.STATE.initialized = true;
                document.dispatchEvent(new CustomEvent("skhub:ready", { detail: { uuid } }));
            } catch (error) {
                console.error(
                    `${LOG_PREFIX} ❌ Heavy module execution failed:`,
                    error
                );
            }
        },

        async loadHeavyScript() {
            if (
                window.RedCheckOSSHeavy &&
                typeof window.RedCheckOSSHeavy.checkServerStatus === "function" &&
                typeof window.RedCheckOSSHeavy.generateUUID === "function"
            ) {
                return window.RedCheckOSSHeavy;
            }

            if (this.STATE.heavyLoadPromise) {
                return this.STATE.heavyLoadPromise;
            }

            this.STATE.heavyLoadPromise = new Promise((resolve, reject) => {
                const target =
                    document.head ||
                    document.documentElement;

                if (!target) {
                    reject(
                        new Error("No valid script injection target")
                    );
                    return;
                }

                const existingScript =
                    document.querySelector(
                        `script[${HEAVY_SCRIPT_ATTR}="true"]`
                    );

                if (existingScript) {
                    if (
                        window.RedCheckOSSHeavy &&
                        typeof window.RedCheckOSSHeavy.checkServerStatus === "function" &&
                        typeof window.RedCheckOSSHeavy.generateUUID === "function"
                    ) {
                        resolve(window.RedCheckOSSHeavy);
                        return;
                    }
                }

                let heavyUrl;

                try {
                    heavyUrl = new URL(
                        this.CONFIG.HEAVY_SCRIPT_NAME,
                        this.STATE.scriptSource ||
                            document.baseURI ||
                            window.location.href
                    ).href;
                } catch (error) {
                    reject(error);
                    return;
                }

                const script = document.createElement("script");
                script.src = heavyUrl;
                script.async = false;
                script.setAttribute(HEAVY_SCRIPT_ATTR, "true");

                script.onload = () => {
                    if (
                        window.RedCheckOSSHeavy &&
                        typeof window.RedCheckOSSHeavy.checkServerStatus === "function" &&
                        typeof window.RedCheckOSSHeavy.generateUUID === "function"
                    ) {
                        resolve(window.RedCheckOSSHeavy);
                        return;
                    }

                    reject(
                        new Error("RedCheckOSSHeavy global was not initialized")
                    );
                };

                script.onerror = () => {
                    reject(
                        new Error(`Failed to load ${heavyUrl}`)
                    );
                };

                target.appendChild(script);
            });

            try {
                return await this.STATE.heavyLoadPromise;
            } catch (error) {
                this.STATE.heavyLoadPromise = null;
                throw error;
            }
        },

        injectConsentCard() {
            if (!document.body || !document.head) {
                return false;
            }

            if (
                document.querySelector(
                    '[data-RedCheckOSS-consent-card="true"]'
                )
            ) {
                return true;
            }

            this.removeInfoWidget();

            const style = document.createElement("style");
            style.setAttribute(
                "data-RedCheckOSS-style",
                "consent-card"
            );
            // 初回の案内は、画面の下いっぱいの帯（スマホでは文とボタンを 2 段に）
            style.textContent = `
                .RedCheckOSS-consent-card{
                    position:fixed;
                    left:0;
                    right:0;
                    bottom:0;
                    z-index:2147483647;
                    box-sizing:border-box;
                    font-family:Inter,"Noto Sans JP",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
                    animation:RedCheckOSS-bar-in .35s cubic-bezier(.22,1,.36,1) both;
                }
                @keyframes RedCheckOSS-bar-in{from{transform:translateY(100%)}to{transform:none}}
                .RedCheckOSS-consent-card__panel{
                    display:flex;
                    align-items:center;
                    gap:12px 20px;
                    box-sizing:border-box;
                    width:100%;
                    padding:12px max(16px,calc((100% - 1120px) / 2)) calc(12px + env(safe-area-inset-bottom));
                    background:#fff;
                    color:#1d1d1f;
                    border-top:1px solid #e3e5e8;
                    box-shadow:0 -6px 24px rgba(0,0,0,.08);
                }
                .RedCheckOSS-consent-card__text{
                    flex:1;
                    min-width:0;
                    margin:0;
                    color:#3a3a3c;
                    font-size:13px;
                    line-height:1.65;
                }
                .RedCheckOSS-consent-card__title{
                    margin:0 6px 0 0;
                    color:#1d1d1f;
                    font-size:13px;
                    font-weight:700;
                }
                .RedCheckOSS-consent-card__text a{
                    color:#2563eb;
                    text-decoration:underline;
                    text-underline-offset:2px;
                }
                .RedCheckOSS-consent-card__actions{
                    display:flex;
                    align-items:center;
                    gap:8px;
                    flex:none;
                }
                .RedCheckOSS-consent-card__extra:empty{display:none}
                .RedCheckOSS-consent-card__extra{margin-right:6px}
                .RedCheckOSS-consent-card__button{
                    display:inline-flex;
                    align-items:center;
                    justify-content:center;
                    min-height:34px;
                    box-sizing:border-box;
                    padding:0 14px;
                    border:0;
                    border-radius:999px;
                    font:inherit;
                    font-size:12.5px;
                    font-weight:600;
                    line-height:1;
                    white-space:nowrap;
                    cursor:pointer;
                    transition:background-color .15s ease,opacity .15s ease;
                }
                .RedCheckOSS-consent-card__button--deny{
                    background:#f0f1f3;
                    color:#1d1d1f;
                }
                .RedCheckOSS-consent-card__button--deny:hover{background:#e6e7ea}
                .RedCheckOSS-consent-card__button--agree{
                    background:#2563eb;
                    color:#fff;
                }
                .RedCheckOSS-consent-card__button--agree:hover{background:#1d4fd8}
                @media(max-width:720px){
                    .RedCheckOSS-consent-card__panel{flex-direction:column;align-items:stretch;gap:10px}
                    .RedCheckOSS-consent-card__actions{flex-wrap:wrap}
                    .RedCheckOSS-consent-card__extra{flex:1 1 100%;margin-right:0}
                    .RedCheckOSS-consent-card__button{flex:1}
                }
                @media(prefers-reduced-motion:reduce){
                    .RedCheckOSS-consent-card{animation:none}
                    .RedCheckOSS-consent-card__button{transition:none}
                }
            `;

            const card = document.createElement("div");
            const panel = document.createElement("div");

            card.className = "RedCheckOSS-consent-card";
            card.setAttribute(
                "data-RedCheckOSS-consent-card",
                "true"
            );

            panel.className = "RedCheckOSS-consent-card__panel";
            panel.setAttribute("role", "region");
            panel.setAttribute(
                "aria-labelledby",
                "RedCheckOSS-consent-card-title"
            );

            // 多言語（assets/i18n.js があるページだけ。ないページは日本語）
            const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
            const tx = (s) => esc(window.SKI18N ? window.SKI18N.t(s) : s);
            const lx = (u) => (window.SKI18N ? window.SKI18N.path(u) : u);
            const policy = (hash, label) => `<a href="${lx(this.CONFIG.POLICIES_URL)}#${hash}" target="_blank" rel="noopener noreferrer">${tx(label)}</a>`;
            // 文の中の {terms}・{privacy} をリンクにする（文は訳してから入れ替える）
            const sentence = tx("使う前に、{terms}と{privacy}を確認して、同意してください。")
                .replace("{terms}", policy("sk-terms", "利用規約"))
                .replace("{privacy}", policy("sk-privacy", "プライバシーポリシー"));
            // __extra … ほかのスクリプトが選択肢を足す場所（assets/analytics.js がアクセス解析のスイッチを入れる）
            panel.innerHTML = `
                <p class="RedCheckOSS-consent-card__text"><strong
                    id="RedCheckOSS-consent-card-title"
                    class="RedCheckOSS-consent-card__title"
                >${tx("ようこそ！")}</strong>${sentence}</p>
                <div class="RedCheckOSS-consent-card__actions">
                    <div class="RedCheckOSS-consent-card__extra" data-RedCheckOSS-consent-extra></div>
                    <button
                        type="button"
                        class="RedCheckOSS-consent-card__button RedCheckOSS-consent-card__button--deny"
                        data-RedCheckOSS-consent-action="deny"
                    >${tx("同意しない")}</button>
                    <button
                        type="button"
                        class="RedCheckOSS-consent-card__button RedCheckOSS-consent-card__button--agree"
                        data-RedCheckOSS-consent-action="agree"
                    >${tx("同意して閉じる")}</button>
                </div>
            `;

            const agreeButton =
                panel.querySelector(
                    '[data-RedCheckOSS-consent-action="agree"]'
                );
            const denyButton =
                panel.querySelector(
                    '[data-RedCheckOSS-consent-action="deny"]'
                );

            if (!agreeButton || !denyButton) {
                return false;
            }

            agreeButton.addEventListener("click", () => {
                try {
                    localStorage.setItem(this.CONFIG.TERMS_ACCEPTED_KEY, "true");
                    this.STATE.termsState = "true";
                    card.remove();
                    this.init().catch(error => {
                        console.error(
                            `${LOG_PREFIX} ❌ Init failed after agreement:`,
                            error
                        );
                    });
                } catch (error) {
                    console.error(
                        `${LOG_PREFIX} ❌ Agreement handling failed:`,
                        error
                    );
                }
            });

            denyButton.addEventListener("click", () => {
                try {
                    localStorage.setItem(this.CONFIG.TERMS_ACCEPTED_KEY, "false");
                    this.STATE.termsState = "false";
                    window.location.replace(this.CONFIG.ENTRY_URL);
                } catch (error) {
                    console.error(
                        `${LOG_PREFIX} ❌ Deny handling failed:`,
                        error
                    );
                }
            });

            document.head.appendChild(style);
            card.appendChild(panel);
            document.body.appendChild(card);
            return true;
        },

        injectInfoWidget() {
            if (!document.body || !document.head) {
                return false;
            }

            if (
                document.querySelector(
                    '[data-RedCheckOSS-consent-card="true"]'
                )
            ) {
                return false;
            }

            if (
                document.querySelector(
                    '[data-RedCheckOSS-info-widget="true"]'
                )
            ) {
                this.setupLogoDiagnostic();
                return true;
            }

            const style = document.createElement("style");
            style.setAttribute(
                "data-RedCheckOSS-style",
                "info-widget"
            );
            style.textContent = `
                .RedCheckOSS-info-widget{
                    position:fixed;
                    right:16px;
                    bottom:16px;
                    z-index:2147483646;
                    display:flex;
                    flex-direction:row-reverse;
                    align-items:stretch;
                    gap:0;
                    padding:5px;
                    background:rgba(0,0,0,.3);
                    border:none;
                    border-radius:99px;
                    corner-shape:superellipse(1.5);
                    backdrop-filter:blur(4px);
                    -webkit-backdrop-filter:blur(4px);
                    font-family:Inter,"Noto Sans JP",system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
                    overflow:hidden;
                }
                .RedCheckOSS-info-widget:hover{background:rgba(0,0,0,.8)}
                .RedCheckOSS-info-widget__toggle{
                    display:flex;
                    align-items:center;
                    justify-content:center;
                    flex:0 0 20px;
                    width:20px;
                    height:20px;
                    padding:0;
                    margin:2px;
                    border:0;
                    color:#fff9;
                }
                .RedCheckOSS-info-widget__toggle img{
                    display:block;
                    width:22px;
                    height:22px;
                    border-radius:6px;
                }
                .RedCheckOSS-info-widget__links{
                    display:flex;
                    gap:4px;
                    max-width:0;
                    max-height:0;
                    opacity:0;
                    overflow:hidden;
                    transform:translateY(3px);
                    transition:max-width .2s ease,max-height .2s ease,opacity .2s ease,transform .2s ease;
                }
                .RedCheckOSS-info-widget:hover .RedCheckOSS-info-widget__links,
                .RedCheckOSS-info-widget:focus-within .RedCheckOSS-info-widget__links{
                    max-width:360px;
                    max-height:120px;
                    opacity:1;
                    transform:translateY(0);
                }
                .RedCheckOSS-info-widget__link{
                    display:block;
                    padding:6px;
                    border-radius:99px;
                    corner-shape:superellipse(1.6);
                    background:#0000;
                    color:#e3e3e3;
                    text-decoration:none;
                    white-space:nowrap;
                    font-size:12px;
                    font-weight:500;
                    line-height:1 !important;
                    transition:background-color .15s ease,color .15s ease;
                }
                button.RedCheckOSS-info-widget__link{border:0;font-family:inherit;cursor:pointer}
                .RedCheckOSS-info-widget__link:hover,
                .RedCheckOSS-info-widget__link:focus-visible{
                    background:#fff3;
                    color:#fff;
                    outline:none;
                }
                @media(max-width:600px){
                    .RedCheckOSS-info-widget{
                        right:10px;
                        bottom:10px;
                    }
                    .RedCheckOSS-info-widget__link{font-size:11px}
                }
                @media(prefers-reduced-motion:reduce){
                    .RedCheckOSS-info-widget,
                    .RedCheckOSS-info-widget__links,
                    .RedCheckOSS-info-widget__toggle,
                    .RedCheckOSS-info-widget__link{
                        transition:none;
                    }
                }
            `;

            const toggle = document.createElement("div");
            toggle.className = "RedCheckOSS-info-widget__toggle";
            toggle.setAttribute("aria-hidden", "true");
            // 右下のアイコン（SK の小さいアイコン）
            const toggleIcon = document.createElement("img");
            toggleIcon.src = this.CONFIG.ICON_URL;
            toggleIcon.alt = "";
            toggleIcon.width = 22;
            toggleIcon.height = 22;
            toggle.appendChild(toggleIcon);

            const links = document.createElement("div");
            links.className = "RedCheckOSS-info-widget__links";

            const aboutLink = document.createElement("a");
            aboutLink.className = "RedCheckOSS-info-widget__link";
            const tw = (s) => (window.SKI18N ? window.SKI18N.t(s) : s);
            const lw = (u) => (window.SKI18N ? window.SKI18N.path(u) : u);
            aboutLink.href = lw(this.CONFIG.ABOUT_URL);
            aboutLink.textContent = tw("SKについて");
            aboutLink.setAttribute("aria-label", tw("SKについて"));

            const policyLink = document.createElement("a");
            policyLink.className = "RedCheckOSS-info-widget__link";
            policyLink.href = lw(this.CONFIG.POLICIES_URL);
            policyLink.textContent = tw("利用規約・プライバシー");
            policyLink.setAttribute("aria-label", tw("利用規約・プライバシーポリシー"));

            // 設定: アカウントがなくても、このブラウザの同意（規約・プライバシー、アクセス解析）を見直せる
            const settingsLink = document.createElement("button");
            settingsLink.type = "button";
            settingsLink.className = "RedCheckOSS-info-widget__link";
            settingsLink.textContent = tw("設定");
            settingsLink.setAttribute("aria-label", tw("設定"));
            settingsLink.addEventListener("click", () => this.openSettings());

            links.appendChild(aboutLink);
            links.appendChild(policyLink);
            links.appendChild(settingsLink);

            const widget = document.createElement("div");
            widget.className = "RedCheckOSS-info-widget";
            widget.setAttribute(
                "data-RedCheckOSS-info-widget",
                "true"
            );
            widget.setAttribute("aria-label", tw("サイト情報"));
            widget.appendChild(toggle);
            widget.appendChild(links);

            document.head.appendChild(style);
            document.body.appendChild(widget);

            this.setupLogoDiagnostic();
            return true;
        },

        // 設定のパネル。アカウントとは関係なく、このブラウザの同意だけを変える
        openSettings() {
            if (document.querySelector('[data-RedCheckOSS-settings="true"]')) {
                return;
            }

            const tw = (s) => (window.SKI18N ? window.SKI18N.t(s) : s);
            const lw = (u) => (window.SKI18N ? window.SKI18N.path(u) : u);

            if (!document.querySelector('[data-RedCheckOSS-style="settings"]')) {
                const style = document.createElement("style");
                style.setAttribute("data-RedCheckOSS-style", "settings");
                style.textContent = `
                    .RedCheckOSS-set{
                        --bg:#fff;--fg:#1d1d1f;--sub:#6e6e73;--line:#0000001a;--soft:#f2f2f7;--acc:#2563eb;
                        position:fixed;inset:0;z-index:2147483647;display:flex;align-items:flex-end;justify-content:center;
                        padding:16px;background:rgba(0,0,0,.35);
                        -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);
                        font:14px/1.5 Inter,"Noto Sans JP",system-ui,-apple-system,"Segoe UI",sans-serif;
                        animation:RedCheckOSS-set-fade .18s ease;
                    }
                    @media(min-width:600px){.RedCheckOSS-set{align-items:center}}
                    @media(prefers-color-scheme:dark){
                        :root:not([data-theme="light"]) .RedCheckOSS-set{--bg:#1c1c1e;--fg:#f5f5f7;--sub:#98989f;--line:#ffffff1f;--soft:#2c2c2e}
                    }
                    :root[data-theme="dark"] .RedCheckOSS-set{--bg:#1c1c1e;--fg:#f5f5f7;--sub:#98989f;--line:#ffffff1f;--soft:#2c2c2e}
                    .RedCheckOSS-set__card{
                        width:min(400px,100%);padding:6px 6px 16px;border-radius:28px;corner-shape:superellipse(1.5);
                        background:var(--bg);color:var(--fg);box-shadow:0 20px 60px rgba(0,0,0,.35);
                        animation:RedCheckOSS-set-rise .22s cubic-bezier(.2,.8,.2,1);
                    }
                    .RedCheckOSS-set__head{display:flex;align-items:center;justify-content:space-between;padding:14px 14px 6px 18px}
                    .RedCheckOSS-set__title{font-size:18px;font-weight:700;letter-spacing:.01em}
                    .RedCheckOSS-set__x{
                        width:32px;height:32px;border:0;border-radius:50%;background:var(--soft);color:var(--sub);
                        font-size:18px;line-height:1;cursor:pointer;transition:filter .15s;
                    }
                    .RedCheckOSS-set__x:hover{filter:brightness(.94)}
                    .RedCheckOSS-set__lead{margin:0;padding:0 18px 12px;color:var(--sub);font-size:12.5px}
                    .RedCheckOSS-set__group{margin:0 10px;border-radius:18px;background:var(--soft);overflow:hidden}
                    .RedCheckOSS-set__row{display:flex;align-items:center;gap:12px;padding:14px 16px;min-height:56px}
                    .RedCheckOSS-set__row + .RedCheckOSS-set__row{border-top:1px solid var(--line)}
                    .RedCheckOSS-set__text{flex:1;min-width:0}
                    .RedCheckOSS-set__name{display:block;font-size:14px;font-weight:600}
                    .RedCheckOSS-set__desc{display:block;margin-top:1px;color:var(--sub);font-size:12px}
                    .RedCheckOSS-set__ok{display:inline-block;margin-top:4px;padding:1px 8px;border-radius:99px;background:#16a34a22;color:#16a34a;font-size:11.5px;font-weight:600}
                    .RedCheckOSS-set__go{
                        flex:none;padding:7px 12px;border-radius:99px;background:var(--bg);color:#dc2626;
                        font-size:12.5px;font-weight:600;text-decoration:none;white-space:nowrap;
                    }
                    .RedCheckOSS-set__go:hover{filter:brightness(.95)}
                    .RedCheckOSS-set__switch{position:relative;flex:none;width:46px;height:28px;cursor:pointer}
                    .RedCheckOSS-set__switch input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0;cursor:pointer}
                    .RedCheckOSS-set__switch i{position:absolute;inset:0;border-radius:99px;background:#78788052;transition:background-color .18s}
                    .RedCheckOSS-set__switch i::after{
                        content:"";position:absolute;top:2px;left:2px;width:24px;height:24px;border-radius:50%;
                        background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .18s;
                    }
                    .RedCheckOSS-set__switch input:checked + i{background:var(--acc)}
                    .RedCheckOSS-set__switch input:checked + i::after{transform:translateX(18px)}
                    .RedCheckOSS-set__switch input:focus-visible + i{outline:2px solid var(--acc);outline-offset:2px}
                    .RedCheckOSS-set__foot{padding:12px 18px 0;font-size:12.5px}
                    .RedCheckOSS-set__foot a{color:var(--acc);text-decoration:none}
                    .RedCheckOSS-set__foot a:hover{text-decoration:underline}
                    @keyframes RedCheckOSS-set-fade{from{opacity:0}}
                    @keyframes RedCheckOSS-set-rise{from{opacity:0;transform:translateY(12px) scale(.98)}}
                    @media(prefers-reduced-motion:reduce){
                        .RedCheckOSS-set,.RedCheckOSS-set__card{animation:none}
                        .RedCheckOSS-set__switch i,.RedCheckOSS-set__switch i::after{transition:none}
                    }
                `;
                document.head.appendChild(style);
            }

            const el = (tag, cls, text) => {
                const e = document.createElement(tag);
                e.className = "RedCheckOSS-set" + cls;
                if (text !== undefined) e.textContent = text;
                return e;
            };

            const overlay = el("div", "");
            overlay.setAttribute("data-RedCheckOSS-settings", "true");
            overlay.setAttribute("role", "dialog");
            overlay.setAttribute("aria-modal", "true");
            overlay.setAttribute("aria-label", tw("設定"));

            const card = el("div", "__card");

            const close = () => {
                overlay.remove();
                document.removeEventListener("keydown", onKey);
            };
            const onKey = (e) => { if (e.key === "Escape") close(); };

            const head = el("div", "__head");
            const x = el("button", "__x", "×");
            x.type = "button";
            x.setAttribute("aria-label", tw("閉じる"));
            x.addEventListener("click", close);
            head.append(el("span", "__title", tw("設定")), x);
            card.append(head, el("p", "__lead", tw("アカウントがなくても使えます。このブラウザだけの設定です。")));

            const group = el("div", "__group");

            // 利用規約・プライバシー: 撤回は、案内のページ（/usercheck/entry.html → terms_not_accepted.html）に移る
            const terms = el("div", "__row");
            const termsText = el("div", "__text");
            termsText.append(
                el("span", "__name", tw("利用規約・プライバシーポリシー")),
                el("span", "__ok", "✓ " + tw("同意しています"))
            );
            const revoke = el("a", "__go", tw("同意を撤回する"));
            revoke.href = lw(this.CONFIG.ENTRY_URL);
            terms.append(termsText, revoke);
            group.appendChild(terms);

            // アクセス解析（assets/analytics.js があるページだけ）
            const analytics = window.SKAnalytics;
            if (analytics && analytics.enabled()) {
                const row = el("label", "__row");
                const text = el("span", "__text");
                text.append(
                    el("span", "__name", tw("アクセス解析")),
                    el("span", "__desc", tw("見られたページなどを、Google アナリティクスで集計します。広告には使いません。"))
                );
                const sw = el("span", "__switch");
                const box = document.createElement("input");
                box.type = "checkbox";
                box.checked = analytics.choice() === "granted";
                box.addEventListener("change", () => analytics.set(box.checked ? "granted" : "denied"));
                sw.append(box, document.createElement("i"));
                row.append(text, sw);
                group.appendChild(row);
            }
            card.appendChild(group);

            const foot = el("div", "__foot");
            const policy = document.createElement("a");
            policy.href = lw(this.CONFIG.POLICIES_URL);
            policy.textContent = tw("利用規約・プライバシーを読む");
            foot.appendChild(policy);
            card.appendChild(foot);

            overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
            document.addEventListener("keydown", onKey);
            overlay.appendChild(card);
            document.body.appendChild(overlay);
            x.focus();
        },

        removeInfoWidget() {
            document
                .querySelectorAll(
                    '[data-RedCheckOSS-info-widget="true"]'
                )
                .forEach(widget => widget.remove());
        },

        setupLogoDiagnostic() {
            if (!document.body) {
                return;
            }

            const selector =
                '[data-RedCheckOSS-logo-diagnostic="true"]';

            if (document.querySelector(selector)) {
                return;
            }

            const attach = logoElement => {
                if (
                    !logoElement ||
                    !logoElement.classList ||
                    logoElement.getAttribute(
                        "data-RedCheckOSS-logo-diagnostic"
                    ) === "true"
                ) {
                    return !!logoElement;
                }

                logoElement.classList.add(
                    "RedCheckOSS-logo-diagnostic-trigger"
                );
                logoElement.setAttribute(
                    "data-RedCheckOSS-logo-diagnostic",
                    "true"
                );
                logoElement.setAttribute("tabindex", "0");
                logoElement.setAttribute("role", "button");
                logoElement.setAttribute(
                    "aria-label",
                    "SK Hub Systems debug"
                );
                logoElement.style.cursor = "pointer";

                let clickCount = 0;
                let resetTimer = null;

                const handlePress = () => {
                    clickCount += 1;

                    if (resetTimer !== null) {
                        window.clearTimeout(resetTimer);
                        resetTimer = null;
                    }

                    if (clickCount >= 5) {
                        clickCount = 0;
                        this.showDebugState();
                        return;
                    }

                    resetTimer = window.setTimeout(() => {
                        clickCount = 0;
                        resetTimer = null;
                    }, 1800);
                };

                logoElement.addEventListener("click", handlePress);
                logoElement.addEventListener("keydown", event => {
                    if (
                        event &&
                        (event.key === "Enter" || event.key === " ")
                    ) {
                        event.preventDefault();
                        handlePress();
                    }
                });

                return true;
            };

            const findInjectedLogo = () =>
                document.querySelector(
                    '[data-RedCheckOSS-info-widget="true"] .RedCheckOSS-info-widget__toggle'
                );

            const initialLogo = findInjectedLogo();

            if (initialLogo) {
                attach(initialLogo);
                return;
            }

            if (typeof MutationObserver !== "function") {
                return;
            }

            const observer = new MutationObserver(() => {
                const logo = findInjectedLogo();

                if (!logo) {
                    return;
                }

                if (attach(logo)) {
                    observer.disconnect();
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });
        },

        showDebugState() {
            try {
                const state = {
                    "SK Hub Systems (based on RedFlag Checker OSS by Sentaro)": "3",
                    モード:
                        this.STATE.checkMode === "none"
                            ? "check=none"
                            : "normal",
                    ソース: this.STATE.scriptSource || null,
                    UUID: this.STATE.uuid || null,
                    利用規約の同意: this.STATE.termsState,
                    サーバー判定: this.STATE.serverStatus,
                    現在位置: window.location.href,
                    読み込み状態: document.readyState,
                    言語: navigator.language,
                    環境: navigator.userAgent,
                    時間: new Date().toISOString()
                };

                window.alert(
                    Object.entries(state)
                        .map(
                            ([key, value]) =>
                                `${key}:${value}`
                        )
                        .join("\n")
                );
            } catch (error) {
                console.error(
                    `${LOG_PREFIX} ❌ DEBUG STATE ERROR:`,
                    error
                );
            }
        },

        injectViewTransitionStyle() {
            const head =
                document.head ||
                document.documentElement;

            if (!head) {
                return false;
            }

            if (
                !document.querySelector(
                    'meta[name="view-transition"]'
                )
            ) {
                const meta = document.createElement("meta");
                meta.name = "view-transition";
                meta.content = "same-origin";
                head.appendChild(meta);
            }

            if (
                document.querySelector(
                    '[data-RedCheckOSS-style="view-transition"]'
                )
            ) {
                return true;
            }

            const style = document.createElement("style");
            style.setAttribute(
                "data-RedCheckOSS-style",
                "view-transition"
            );
            // assets/header.css と同じ内容（header.css を読み込まないページ用。値を変えるときは両方そろえる）
            style.textContent = `
                @view-transition{navigation:auto}
                ::view-transition-old(root){
                    animation:sk-page-out .3s cubic-bezier(.4,.04,0,1) both;
                }
                ::view-transition-new(root){
                    animation:sk-page-in .3s cubic-bezier(.4,.04,0,1) both;
                }
                @keyframes sk-page-out{
                    to{opacity:0;transform:scale(.96)}
                }
                @keyframes sk-page-in{
                    from{opacity:0;transform:scale(.96)}
                }
                @media(prefers-reduced-motion:reduce){
                    ::view-transition-old(root),::view-transition-new(root){animation:none}
                }
            `;

            head.appendChild(style);
            return true;
        }
    };

    if (window.RedCheckOSS) {
        console.warn(
            `${LOG_PREFIX} ⚠️ Existing RedCheckOSS global detected; replacing it`
        );
    }

    window.RedCheckOSS = RedCheckOSS;

    const start = () => {
        try {
            RedCheckOSS.init().catch(error => {
                console.error(
                    `${LOG_PREFIX} ❌ INIT FATAL ERROR:`,
                    error
                );
            });
        } catch (error) {
            console.error(
                `${LOG_PREFIX} ❌ INIT START ERROR:`,
                error
            );
        }
    };

    const boot = () => {
        try {
            // Heavy is intentionally loaded on every boot.
            // UI/config remain entirely in check.js.
            start();
        } catch (error) {
            console.error(
                `${LOG_PREFIX} ❌ BOOT ERROR:`,
                error
            );
        }
    };

    if (document.readyState === "loading") {
        document.addEventListener(
            "DOMContentLoaded",
            boot,
            { once: true }
        );
    } else {
        boot();
    }
})();
