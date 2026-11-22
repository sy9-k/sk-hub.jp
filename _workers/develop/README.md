# SK Hub Develop の Worker（develop.sk-hub.jp）

`develop.sk-hub.jp` を、`sk-hub.jp`（GitHub Pages）の `/develop/` につなぐ中継です（`_workers/admin/` と同じしくみ）。サイトのファイルはこのリポジトリの `develop/` にあり、**直すときはプッシュするだけ**（Worker の deploy はいりません。反映まで最大 60 秒）。

## はじめて出すとき（1 回だけ）

```
cd _workers/develop
npx wrangler deploy
```

- ゾーン `sk-hub.jp` が同じ Cloudflare アカウントにあれば、`develop.sk-hub.jp` の DNS は自動で作られます。
- 共通の部品（`/assets/…`）を新しく使うときは、`src/worker.js` の `SHARED` に足して deploy します。
- `sk-hub.jp/develop/` を直接開くと `develop.sk-hub.jp` ではなく、そのまま表示されます（相対パスで書いてあるので、どちらでも動きます）。
