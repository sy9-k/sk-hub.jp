# _build — サイトのページを作る元ファイル

`_` で始まるフォルダなので、GitHub Pages では公開されません（リポジトリにだけあるファイルです）。

## ページを作り直す

```
python _build/build.py
```

- 型は **トップページの `index.html`** です。`<main id="main">` の外側（`<head>`・ヘッダー・フッター）が全ページ共通になります。
- 各ページの中身は `_build/pages/*.html` です。ページを直すときは、ここを編集してから build します（書き出された `about/index.html` などを直接直しても、次の build で上書きされます）。
- トップページだけは `index.html` を直接編集します（編集したら build して、ほかのページのヘッダー・フッターにも反映します）。
- ページの一覧・タイトル・説明・追加で読み込むファイルは `build.py` の `pages` と `EXTRA` にあります。
- `sitemap.xml` も build で作り直されます。

## 共有画像（assets/og.png）を作り直す

```
python _build/og/render.py
```

`_build/og/og.html` を Microsoft Edge で撮影して `assets/og.png` に保存します。

## 多言語（日本語・英語・中国語・韓国語）

URL は変えずに、`/lang/` で選んだ言語でページを訳して表示します（`assets/i18n.js`）。

- 訳は `_build/i18n/<言語>.json`（キーが日本語の文）。build すると `assets/i18n/<言語>.js` が作られます。
- build が訳のない文を見つけると `_build/i18n/missing/<言語>.json` に書き出すので、訳を JSON に足してもう一度 build します。
- build で作らないページ（MALU など）とスクリプトの `t("…")` も、`build.py` の `STANDALONE_PAGES`・`RUNTIME_SOURCES` に入れておけば探します。
- SK's Lab（QR Drop・スマートダッシュボード）は日本語と英語だけです（`<html data-i18n-langs="ja en">`。ほかの言語を選んでいると英語で出る）。英訳は `en.json` にだけ入れ、`build.py` の `EN_ONLY_PAGES` で探します。

## サポートの記事・お知らせ

記事は **管理画面の記事エディター（https://admin.sk-hub.jp/articles/）** で書きます。保存すると SK Hub Systems に入り、サポートページにすぐ出ます（build もプッシュもいりません）。

- `support/articles.json` は予備です（SK Hub Systems に記事が 1 件もない・届かないときだけ使われる）。記事エディターの「バックアップを書き出す」で作ったファイルと入れ替えてプッシュすると、予備も新しくなります。
- 読み込みと本文の書き方は `support/articles.js` にまとめています。

## 規約を変えるとき

- 規約の文は `policies/docs/<名前>.txt`（日本語が正式）と、訳の `<名前>.<言語>.txt`（en / zh-CN / zh-TW / ko）です。日本語を直したら、訳も同じように直します。
- `sk-hub-systems.txt`・`y-filter.txt`・`newtab.txt` は、y-filter リポジトリの `policy/` がもとです（`systems/sync-console.mjs` でコピー）。y-filter 側も同じように直します。
- 取り扱う情報を増やすときは、`assets/hub/account.js` の `ACCOUNT_TERMS_VERSION` を上げると、次に使うときに同意し直してもらえます。附則に改定の記録を足します。

## SK Hub Systems の運用メモ

- **2 年以上ログインのないアカウント**（アカウント規約 第五条4）: Firebase コンソールの Authentication →「ユーザー」で「ログイン日時」の古い順に並べて確認します。削除するときは、先にそのユーザーの UID で Firestore の `accounts/<UID>`（とその下の `notices`・`maluWords`・`malu`）と、持ち主の管理グループ（`teams/<UID>`・`ownerUid` が同じ `devices`・`requests`・`pairingCodes`）を消してから、Authentication のユーザーを削除します。サーバーで動く処理（Cloud Functions）は無料プランでは使えないため、自動にはしていません。
- **お問い合わせ・アクセスチェックの記録の保存期間**: 開発者が管理画面（https://admin.sk-hub.jp/）のダッシュボードかお問い合わせを開いたときに、期限を過ぎたものを自動で削除します。ほかの期限切れは管理画面の「期限切れの掃除」で消します。
- **Firestore のルール**: y-filter リポジトリの `systems/firestore.rules`。`systems` で `firebase deploy --only firestore:rules` で反映します。
- **Google アナリティクス**: 測定 ID `G-LLN7RGHRTE`（アカウント「Default Account for Firebase」→ プロパティ「y-filter-system」→ データストリーム「SK」）。読み込みは `assets/analytics.js`（許可した人だけ）。プライバシーポリシー第四条の二に合わせて、データの保持は 2 か月、Google シグナルはオフ、拡張計測機能の「サイト内検索」「フォームの操作」はオフにしています。変えるときはポリシーも直します。
- **SK Share（/view/）**: パスワードを入れると、YouTube の限定公開動画・HTML 文書・Google ドライブのファイル（PDF・ドキュメント・スライド・フォルダなど）を見られるページです。作る・直す・止めるのは管理画面の https://admin.sk-hub.jp/share/（開発者だけ）。データは Firestore の `viewPages`（ID = パスワードから作った値。くわしくは `view/view-core.js` と y-filter リポジトリの `systems/firestore.rules`）。One UI 版の試作は `_mockups/view-oneui/`（配信しない）。
- **`google4b04249061c7d95f.html`（サイトの一番上）**: Google Search Console で sy9-k.github.io の持ち主であることを示すファイルです。Google のログイン画面に「SK Hub Systems」と出すためのブランドの確認に使うので、消さないでください。

## build で作らないページ

次のページは、それぞれのフォルダのファイルを直接編集します。

- `index.html`（トップ）
- `dictionary/`（MALU）
- `y-filter/`（Y-FILTER. 管理コンソール。共通部分は y-filter リポジトリの `systems/sync-console.mjs` でコピー）
- `qr-prj/`・`smart-dash/`（SK's Lab）
- `news/`（サポートへの転送）・`usercheck/`（同意・アクセス制限の画面）
- `view/`（SK Share。マテリアルデザイン）
- `office/`（SK Hub Office。開発中。**開くのは https://office.sk-hub.jp/**。`_workers/office/` の Worker が sk-hub.jp/office/ を中継する（admin.sk-hub.jp と同じしくみ。くわしくは `_workers/office/README.md`）。入り口の `/` と、Doc・Sheet・Slide の `/doc/`・`/sheet/`・`/slide/`。画面の形は Microsoft Office（スタート画面・リボン）、見た目は SK Material。共通の部分は `office/shared/`（`office.js`・`office.css`・保存の `store.js`・テンプレートの `templates.js`）で、ページからは相対パスで読む。ファイルは PC の選んだフォルダに 1 つずつ保存する（`名前.skdoc`・`.sksheet`・`.skslide`。Chrome・Edge のパソコンの File System Access API）。フォルダに保存できないブラウザは、ブラウザの localStorage の `sk_office_files`。オプション（ユーザー名・テーマ・自動保存など）は `sk_office_settings`。PWA は `office/manifest.json`（アプリ全体を 1 つの「SK Hub Office」として入れる。Doc・Sheet・Slide はショートカット。入れたあとは .skdoc などをダブルクリックで開ける）と `office/sw.js`（オフライン。部品を大きく変えたら `VERSION` を上げる）。アイコンは `python _build/office/icons.py` で `office/icons/` に作り直す。検索には載せない（noindex）。紹介ページは build で作る `/products/office/`）
- `inbox/`・`studio/`・`view/editor/`（管理画面 https://admin.sk-hub.jp/ へ転送するだけのページ）
- `admin/`（管理画面。下の「管理画面」）

## 管理画面（admin.sk-hub.jp）

開発者（Firestore の `config/developers` に UID がある Google アカウント）だけが使えるページです。ファイルはこのリポジトリの `admin/` で、**https://admin.sk-hub.jp/ から開きます**（`_workers/admin/` の Worker が sk-hub.jp/admin/ を中継する。直すときはプッシュするだけ）。sk-hub.jp/admin/ を直接開くと admin.sk-hub.jp に移ります。2026-10 に旧ドメイン（sy9-k.github.io/admin/）から移しました（旧ドメインの /admin/ は転送するだけ）。

- 入り口は https://admin.sk-hub.jp/（ダッシュボード）。ログインしていない人には「管理者のログイン」、開発者でない人には「管理者専用です」と sk-hub.jp へのリンクが出ます。
- 共通部分は `admin/shared/`（`admin.js` = ログインの確認・ナビゲーション・操作の記録、`admin.css` = 見た目、`housekeeping.js` = 期限切れの掃除、`blocklist.js` = アクセスの制限）。見た目は Material 3（`/toolbox/shared/m3.css`・`/view/view.css`）。
- 中のリンク・読み込みは admin.sk-hub.jp での形（`/inbox/`・`/shared/admin.js`）で書きます。`/…` とは書きません（同じモジュールが 2 つの URL で読まれて 2 回動いてしまう）。サイトの部品を新しく使うときは `_workers/admin/src/worker.js` の `SHARED` に足して deploy します。
- ページを足すときは、`admin/<名前>/index.html`（ほかのページの `<head>` をまねる）と `admin/<名前>/<名前>.js`（`startAdmin({ page, onReady })` を呼ぶ）を作り、`admin/shared/admin.js` の `NAV` に足します。
- データを書きかえる操作は `logAction()` で `adminLogs` に残します（「操作の記録」で見られる。1 年で消える）。
- 中身:

| ページ | すること |
|---|---|
| ダッシュボード（`/`） | 未対応のお問い合わせ・リクエスト・アカウント・端末・稼働状況・移行・メンテナンス・最近の操作 |
| お問い合わせ（`/inbox/`） | 前の `/inbox/`。アカウントのお知らせで返事 |
| お知らせを送る（`/notices/`） | アカウントのお知らせ（`accounts/{UID}/notices`）を 1 人・全員・サービスごとに送る |
| 記事エディター（`/articles/`） | 前の `/studio/` |
| メンテナンスの告知（`/maintenance/`） | `config/maintenance`。sk-hub.jp の各ページの上の帯か、ページを閉じた「ただいまメンテナンス中です」の画面（`/assets/maintenance.js`）になる |
| アカウントを探す（`/accounts/`） | UID かサポート ID で調べる。出すのはアカウント規約 第四条4 で決めたものだけ（アカウントの情報・表示名・利用の記録＝おおまかな地域とサポート ID・お問い合わせ）。Y-FILTER. の情報は出さない。調べると記録に残る |
| アクセスの制限（`/access/`） | `hub_blocklist` の追加・解除と、`hub_access_logs` を見る |
| SK Share（`/share/`） | 前の `/view/editor/`。配る URL は sk-hub.jp/view/ |
| 試作品のファイル（`/files/`） | 旧ドメインのリポジトリ（sy9-k/sy9-k.github.io）の `_mockups/` を GitHub API と jsDelivr で読む。HTML は管理画面から切り離した iframe でプレビュー |
| 期限切れの掃除（`/cleanup/`） | ペアリングコード・招待コード・古いリクエスト・1 年つながっていない端末など |
| 移行の進み具合（`/migration/`） | `hub_access_logs` の直近 30 日を、sk-hub.jp と sy9-k.github.io に分けて数える |
| 設定と情報（`/settings/`） | ブロックリストの版（編集は y-filter の `systems/blocklist-editor`）・開発者・運用のリンク・表示 |
| 操作の記録（`/logs/`） | `adminLogs` |

- **Firestore のルール**: 管理画面のために足したルールは、y-filter リポジトリの `systems/firestore.rules` の「管理画面」の印のところです。反映するまでは、ルールが要る部分（アカウント・端末・リクエストを読む、アクセスの制限を書く、メンテナンスの告知、操作の記録など）に「権限がありません」と出ます。ほかの部分は動きます。
- **Firebase の承認済みドメイン**: Authentication → 設定 → 承認済みドメイン に `admin.sk-hub.jp` が要ります（消すと管理画面にログインできなくなります）。
- **api.sk-hub.jp**（sk-api）の `/staff/…`・`/line/reply` は、管理画面のオリジン `https://admin.sk-hub.jp` からだけ呼べます（sk-api の `ADMIN_ORIGIN`）。
- 管理画面の表示・並べかえ・返事の定型文は、ブラウザごと（admin.sk-hub.jp の localStorage）に覚えます。旧ドメインから移ってきたときは、旧ドメインの転送ページが `#from-old=…` で渡して引き継ぎます（`admin/shared/admin.js` の `takeOverOldSettings`）。

## メンテナンス・障害のお知らせ（帯・ページを閉じる）

`/assets/maintenance.js` が、SK Hub Systems の `config/maintenance` を読んで、ページのいちばん上に帯を出すか、ページを閉じて「ただいまメンテナンス中です」の画面にします（変えるのは管理画面の「メンテナンスの告知」 https://admin.sk-hub.jp/maintenance/）。

- ページを閉じているあいだは、1 分ごとに確かめ直し、終わったら自動で開き直します。規約（`/policies/`）・同意と制限の画面（`/usercheck/`）は閉じません。
- 閉じているあいだに自分で確かめるときは、URL の最後に `?maintenance=skip` を付けて開きます（そのタブだけ、閉じずに帯になります）。
- 文字は M PLUS 1（`/assets/fonts.js` と同じく、EU・英国・スイスなどのタイムゾーンでは Google Fonts を読み込みません）。

- build のページはトップ（`index.html`）の型から入ります。build で作らないアプリ（SK's Toolbox・Nagi・MALU・SK's Lab・SK Share）は `/assets/domain-snack.js` の隣、Y-FILTER. の管理コンソール（`/y-filter/`・`/y-filter/link/`）は `site.js` の隣で読み込みます。
- 結果は 5 分だけ覚えておくので、管理画面で変えてから出る・消えるまで最大 5 分かかります。
- 管理画面の「メンテナンスの告知」のプレビューも、このファイルを使います（`data-manual`）。`sy9-k/sy9-k.github.io` にも古い版があります（旧ドメインのページ用）。

## システム稼働状況（sk-hub.online）

システム稼働状況は https://sk-hub.online/ です。sk-hub.jp とは別の場所（Cloudflare Workers）で動くので、sk-hub.jp が落ちていても見られます。5 分ごとに各システムを確かめて、いまの状態・過去 90 日の記録・停止の履歴を出します。メンテナンス・障害のお知らせ（`config/maintenance`）もそこに出ます。

- リポジトリはローカルの `~/Documents/GitHub/sk-status`（GitHub には置かない。公開は手元から `npm run deploy`）。確かめるものを増やすときは、その `src/worker.js` を直します
- サイト内のリンクはすべて `https://sk-hub.online/` です（フッター・ヘッダーのメニュー・トップ・お問い合わせ・サポート・プロダクト・SK Hub Systems・404・メンテナンスの画面・ターミナル・管理コンソールのヘッダー）。`/status/` は sk-hub.online への転送だけ（build では作らない）
- sk-hub.online は 2027 年 10 月で手放して `status.sk-hub.jp` に移す予定です。そのときは `https://sk-hub.online/` をまとめて置き換えます
