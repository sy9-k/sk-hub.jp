// 管理コンソールのヘッダーのメニュー（見た目と動きはサイト共通の assets/header.css・assets/site.js）
// site.js より先に読み込む。操作（端末を追加など）は、画面にあるボタンを押すのと同じにする
(function () {
  "use strict";

  const press = (id) => () => {
    const el = document.getElementById(id);
    if (el) el.click();
  };

  window.SK_HEADER = {
    menus: {
      devices: {
        title: "端末",
        items: [
          { label: "端末の一覧", href: "/y-filter/", action: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
          { label: "端末を追加", action: press("add-device") },
          { label: "利用レポート", action: press("open-report") }
        ]
      },
      team: {
        title: "管理グループ",
        items: [
          // 招待・招待コードでの参加も、この画面から
          { label: "管理者・共同管理者の招待", action: press("team-btn") },
          ["共同管理者について", "https://support.sk-hub.jp/?a=hub-co-admins"]
        ]
      },
      help: {
        title: "ヘルプ",
        groups: [
          {
            title: "使い方",
            items: [
              ["SK Hub Systems のサポート記事", "https://support.sk-hub.jp/#hub"],
              ["端末を追加する（ペアリングコード）", "https://support.sk-hub.jp/?a=hub-add-device"],
              ["設定が端末に反映されないとき", "https://support.sk-hub.jp/?a=hub-settings-not-applied"]
            ]
          },
          {
            title: "情報と連絡",
            items: [
              ["システム稼働状況", "https://sk-hub.online/"],
              ["SK Hub Systems 利用規約", "/policies/#sk-hub-systems"],
              ["お問い合わせ", "https://support.sk-hub.jp/contact/?product=hub"]
            ]
          }
        ]
      },
      // ログイン情報（名前・アイコン）があれば、一覧の上に出す
      account: (hint) => (hint ? {
        title: "SK Hub Systems アカウント",
        profile: hint,
        items: [
          ["アカウント", "/account/"],
          ["データのダウンロード・削除", "/account/#privacy"],
          ["SK のホームページ", "/"],
          // アカウントとの接続だけを外す（console.js。確かめてから）
          { label: "管理コンソールとの接続を解除", action: () => document.dispatchEvent(new CustomEvent("skconsole:disconnect")) },
          { label: "ログアウト", action: () => document.dispatchEvent(new CustomEvent("skconsole:signout")) }
        ]
      } : {
        title: "SK Hub Systems アカウント",
        items: [
          ["SK Hub Systems アカウントとは", "https://support.sk-hub.jp/?a=account-about"],
          ["アカウントのページ", "/account/"],
          ["SK のホームページ", "/"]
        ]
      })
    }
  };
})();
