# SK Hub Korea の Worker（kr.sk-hub.jp・韓国から開いた sk-hub.jp）

`_` で始まるフォルダなので、GitHub Pages では公開されません。

## しくみ

kr.sk-hub.jp は、SK のサイトの**韓国版（地域版）**です。専用のページは置かず、この Worker が sk-hub.jp（GitHub Pages）のページをそのつど取ってきて、**韓国で出さないものを隠し、韓国語で出して**返します（Samsung などの国別サイトと同じ考え方）。

| 開いたもの | 開いた人 | 出るもの |
|---|---|---|
| `kr.sk-hub.jp/` | どの国でも | sk-hub.jp のトップを、韓国向けに整えたもの |
| `kr.sk-hub.jp/products/` `/policies/` など（`MIRROR`） | どの国でも | 同じページを、同じように整えたもの |
| `kr.sk-hub.jp/products/y-filter/` `/products/malu/` `/lab/` など（`BLOCKED`） | どの国でも | `kr.sk-hub.jp/` に移す（韓国では出さないもの） |
| `kr.sk-hub.jp/assets/…` など（`SHARED`） | どの国でも | sk-hub.jp の同じパス |
| `kr.sk-hub.jp/` のそれ以外（アプリ・ログイン・`/about/` など） | どの国でも | sk-hub.jp の同じページに移す（`?hl=ko` を付けて、韓国語のまま開く） |
| `sk-hub.jp/` | 韓国から | トップを韓国向けに整えたもの（アドレスは `sk-hub.jp` のまま。トップだけ） |
| `sk-hub.jp/` | 韓国以外から | いつもの日本語のトップ（Worker は何もしない） |
| `sk-hub.jp/?site=jp` | どこでも | 日本語のトップ。30 日のあいだ（cookie `sk_site=jp`）出し分けをやめる |

## 韓国で出さないものを決める

sk-hub.jp の HTML で、**韓国で隠したい要素に `data-region="jp"` を付ける**だけです（Worker は直さない。プッシュすれば 1 分ほどで反映）。

```html
<section class="section" data-region="jp"> … 日本だけで出すもの … </section>
```

- 韓国で公開してよいのは、**SK Study・SK Hub Office・SK's Toolbox・Nagi** です（SK Hub Systems はアカウントのために残し、説明文は韓国版用に差し替え）。それ以外（**Y-FILTER.・MALU・SK's Lab**・SaeTab・Sentaro さんとの提携）に `data-region="jp"` を付けています（トップ・トップのドック・フッター・プロダクト一覧）。
- ヘッダーのメニュー（`assets/site.js`）は HTML ではないので、Worker が入れる `window.SK_REGION = "kr"` を見て、同じものを出しません（`REGION_HIDDEN_KR`）。新しく隠すものが増えたら、ここと `BLOCKED` にも足します。
- 文が日本向けのものは、日本用の要素に `data-region="jp"`、韓国用の要素に `data-region="kr"` と `hidden` を付けて、入れ替えます（トップの説明文・フッターの紹介・SK Hub Systems の説明文）。
- 逆に、**韓国だけで出したい要素**は `hidden` を付けたうえで `data-region="kr"` を付けます（韓国版でだけ `hidden` が外れる）。
- 隠すのはこの Worker を通ったとき（kr.sk-hub.jp と、韓国から開いた sk-hub.jp のトップ）だけです。sk-hub.jp の HTML 自体は変わりません。

## 整えるもの

- 言語を選んでいなければ韓国語で出す（`<head>` の先頭にスクリプトを入れる）。
- `kr.sk-hub.jp` では、canonical・og:url を `https://kr.sk-hub.jp/…` に、og:locale を `ko_KR` にする。
- 国は、Cloudflare がつける `request.cf.country`（`KR`）で見ます。検索エンジンのクローラー（UA に bot・crawler・spider を含む）には、sk-hub.jp では出し分けません。

## 気をつけること

- 言語・表示の設定は、アドレスごとに別に保存されます（`kr.sk-hub.jp` と `sk-hub.jp` は別の場所）。`kr.sk-hub.jp` から `sk-hub.jp` のアプリに移るときは、`?hl=ko` で、まだ言語を選んでいない人だけ韓国語にします（`assets/i18n.js`）。`kr.sk-hub.jp` ではログインできません（アカウントのログインやアプリは `sk-hub.jp` に移ります）。
- `/korea/`（日本と韓国をつなぐ SK Hub の紹介ページ。`_build/pages/korea.html`）は、この Worker のトップとは別のふつうのページです（`kr.sk-hub.jp` からは開けません）。

## 最初にすること

`sk-hub.jp/` で出し分けるには、**sk-hub.jp の DNS がプロキシ済み**（Cloudflare ダッシュボードの DNS で、雲がオレンジ）になっている必要があります。GitHub Pages に直接向いている（雲がグレー＝DNS のみ）ときは、プロキシに切り替えます。

1. Cloudflare → sk-hub.jp → DNS → `sk-hub.jp`（A / AAAA / CNAME）の雲をオレンジにする。
2. SSL/TLS の暗号化モードを **Full**（できれば Full (strict)）にする。「Flexible」だと無限にリダイレクトされます。
3. `kr.sk-hub.jp` の DNS は、下の deploy で自動で作られます。

プロキシに切り替えたあと、GitHub Pages の「Enforce HTTPS」が外れて見えることがあります。サイトが開けることを確認してください。

## deploy

```
cd _workers/kr
npx wrangler deploy
```

wrangler は sakueinakai2023@gmail.com の Cloudflare アカウントにログインして使います（sk-support などと同じ）。Workers Builds（Git 連携）でルートディレクトリを `_workers/kr` にすると、プッシュしたら自動で deploy されるようにもできます。

## 確かめ方

- `kr.sk-hub.jp/` を開く → 韓国語のトップ（`data-region="jp"` の要素がない）。
- `sk-hub.jp/` を、韓国の VPN で開く → 同じ韓国語のトップ（アドレスは `sk-hub.jp` のまま）。`sk-hub.jp/?site=jp` で日本語のトップに戻れる。
- 出し分けが効かないとき: sk-hub.jp の DNS がプロキシ済みか、Workers の route に `sk-hub.jp/` があるかを見る（Cloudflare → Workers → sk-kr → 設定 → ドメインとルート）。
