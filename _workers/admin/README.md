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

## 招待のメール（`/api/invite-mail`）

SK Study・SK Office は招待制です（招待は管理画面の「招待と早期アクセス」 https://admin.sk-hub.jp/invites/ ）。招待すると、管理画面がこの Worker の `POST /api/invite-mail` を呼び、招待された人に使いはじめ方のメールを送ります（`src/invite-mail.js`）。

- 送れるのは開発者だけです（ID トークンで Firestore の `config/developers` を読めるかで確かめる）。送り先は `hub_invites` に招待があるアドレスだけで、本文には招待したプロダクトが入ります。
- 送るのは [Resend](https://resend.com/) です（無料の範囲: 1 日 100 通・月 3,000 通）。送れたら、管理画面が `hub_invites` の `mailedAt` に日時を入れます（一覧の「メール」の列）。送れなかったときも招待はそのままで、一覧の「メールを送る」で送り直せます。

### はじめの設定（1 回だけ）

1. Resend にサインアップします。
2. Resend の **Domains → Add Domain** で `sk-hub.jp` を足します（リージョンは Tokyo）。表示される DNS のレコード（`resend._domainkey` の TXT、`send` の MX と TXT）を、Cloudflare の sk-hub.jp の DNS に足します（どれも「DNS のみ」。サイトのメールの MX・SPF とはぶつからない）。Resend で **Verify** して「Verified」になるのを待ちます。
3. Resend の **API Keys → Create API Key**（Permission: Sending access、Domain: sk-hub.jp）でキーを作り、Worker のシークレットに入れます。

   ```
   cd _workers/admin
   npx wrangler secret put RESEND_API_KEY
   ```

4. `npx wrangler deploy` します。

- 送信元は `wrangler.jsonc` の `vars.MAIL_FROM`（いまは `SK Hub Systems <noreply@sk-hub.jp>`）。返信を受け取りたいときは `vars.MAIL_REPLY_TO` にアドレスを入れます（入れなければ Reply-To なし）。
- 設定がまだのときは、管理画面に「メールを送るしくみの設定がまだです」と出ます（招待そのものはできる）。
- 送れなかった理由は Cloudflare の Worker（sk-admin）のログ（Observability）に `resend` として残ります。

