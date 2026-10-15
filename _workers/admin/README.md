# SK の管理画面の Worker（admin.sk-hub.jp）

`_` で始まるフォルダなので、GitHub Pages では公開されません。

## しくみ

admin.sk-hub.jp にはページを置いていません。この Worker が、来たアクセスごとに sk-hub.jp（GitHub Pages）の `/admin/` を取ってきて返します（support.sk-hub.jp と同じしくみ。`_workers/support/`）。

| admin.sk-hub.jp | 取ってくるところ |
|---|---|
| `/` | `https://sk-hub.jp/admin/` |
| `/inbox/` など | `https://sk-hub.jp/admin/inbox/` など |
| `/assets/…`・`/toolbox/shared/…`・`/y-filter/firebase-config.js`・`/view/view.css`・`/view/view-core.js`・`/support/articles.js`（`SHARED`） | `https://sk-hub.jp/` の同じパス |
| `/admin/…` | `/…` に移す（前の形のリンク） |
| `/robots.txt` | `Disallow: /`（検索に出さない。ページにも `X-Robots-Tag: noindex`） |

- **管理画面を直すときは、sk-hub.jp のリポジトリの `admin/` にプッシュするだけ**です（この Worker の deploy はいりません）。Cloudflare に 60 秒だけ置いておくので、出るまで最大 1 分ほどかかります。
- 管理画面の中のリンク・読み込みは `/inbox/`・`/shared/admin.js` のように admin.sk-hub.jp での形で書きます（`/admin/…` とは書かない。同じファイルが 2 つの URL で読まれると、モジュールが 2 回動いてしまう）。
- sk-hub.jp の `/admin/` を直接開くと、ページの最初のスクリプトで admin.sk-hub.jp の同じページに移ります。
- サイトと共通の部品を管理画面で新しく使うときは、`src/worker.js` の `SHARED` に足して deploy します。
- admin.sk-hub.jp は sk-hub.jp と別の場所なので、ログインはサイトと別です。Firebase の承認済みドメインに `admin.sk-hub.jp` が要ります。api.sk-hub.jp（sk-api）の `/staff/…`・`/line/reply` は、このオリジンからだけ呼べます。

## Worker を直したとき（deploy）

```
cd _workers/admin
npx wrangler deploy
```

wrangler は sakueinakai2023@gmail.com の Cloudflare アカウントにログインして使います（sk-support・sk-status・sk-api と同じ）。初めての deploy で、admin.sk-hub.jp の DNS とカスタムドメインが自動で作られます。
