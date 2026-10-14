# SK Hub Support の Worker（support.sk-hub.jp）

`_` で始まるフォルダなので、GitHub Pages では公開されません。

## しくみ

support.sk-hub.jp にはページを置いていません。この Worker が、来たアクセスごとに sk-hub.jp（GitHub Pages）の `/support/` を取ってきて返します。

| support.sk-hub.jp | 取ってくるところ |
|---|---|
| `/` | `https://sk-hub.jp/support/` |
| `/contact/` | `https://sk-hub.jp/support/contact/` |
| `/assets/…`・`/frameworks/…` など（`SHARED`） | `https://sk-hub.jp/` の同じパス |
| `/support/…` | `/…` に移す（記事の中の古いリンク） |
| sk-hub.jp の `/support/` にないもの | `https://sk-hub.jp/` の同じページに移す |

- **記事・ページの見た目・お問い合わせを直すときは、sk-hub.jp のリポジトリにプッシュするだけ**です（この Worker の deploy はいりません）。Cloudflare に 60 秒だけ置いておくので、出るまで最大 1 分ほどかかります。
- sk-hub.jp の `/support/` を開くと、ページの最初のスクリプトで support.sk-hub.jp の同じページに移ります（`/contact/` も）。
- support.sk-hub.jp は sk-hub.jp と別の場所なので、言語・表示・サポートID・ログインは sk-hub.jp の `/assets/hub/bridge.html`（見えない iframe）から受け取ります（`support/support.js` の `SKBridge`）。

## Worker を直したとき（deploy）

```
cd _workers/support
npx wrangler deploy
```

wrangler は sakueinakai2023@gmail.com の Cloudflare アカウントにログインして使います（sk-status・sk-api と同じ）。初めての deploy で、support.sk-hub.jp の DNS とカスタムドメインが自動で作られます。

Cloudflare の「Workers Builds」（Git 連携）でこのリポジトリをつなぎ、ルートディレクトリを `_workers/support` にすると、プッシュしたら自動で deploy されるようにもできます。
