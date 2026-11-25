# SK Hub の地域版の Worker（kr / cn / tw / eu / global.sk-hub.jp・その国から開いた sk-hub.jp）

`_` で始まるフォルダなので、GitHub Pages では公開されません。Worker の名前は `sk-kr` のままです（名前を変えると、ドメインの設定が作り直しになるため）。

## しくみ

地域ごとの**専用サイト**です。専用のページは置かず、この Worker が sk-hub.jp（GitHub Pages）のページをそのつど取ってきて、**その地域で出さないプロダクトを隠し、その地域の言語で出して**返します（Samsung などの国別サイトと同じ考え方）。

| 地域 | アドレス | 言語 | 出すプロダクト |
|---|---|---|---|
| 日本 | sk-hub.jp | 日本語 | すべて |
| 大韓民国 | kr.sk-hub.jp | 한국어 | Nagi・SK's Toolbox・SK Study・SK Hub Office・SK Hub Systems |
| 中国大陆 | cn.sk-hub.jp | 简体中文 | Nagi・SK's Toolbox（アカウントのいらないものだけ。Google Fonts とアナリティクスも外す） |
| 台灣・香港 | tw.sk-hub.jp | 繁體中文 | Nagi・SK's Toolbox（と、アカウントの SK Hub Systems） |
| ヨーロッパ | eu.sk-hub.jp | English | Nagi・SK's Toolbox（と、アカウントの SK Hub Systems） |
| その他 | global.sk-hub.jp | English | Nagi・SK's Toolbox（と、アカウントの SK Hub Systems） |

MALU・Y-FILTER.・SK's Lab・Sentaro さんとの提携は、日本だけです。SK Study・SK Hub Office は、日本と大韓民国だけです。**出すものを変えるときは、`src/worker.js` の `REGIONS` の `products` を直して deploy します**（HTML は直さない）。

| 開いたもの | 出るもの |
|---|---|
| `<地域>.sk-hub.jp/` と `/products/` `/policies/` など（`MIRROR`） | sk-hub.jp の同じページを、その地域向けに整えたもの |
| `<地域>.sk-hub.jp/assets/…` など（`SHARED`） | sk-hub.jp の同じパス |
| その地域で出さないプロダクトのページ・アプリ | `<地域>.sk-hub.jp/` に移す |
| それ以外（アプリ・ログイン・`/about/` など） | sk-hub.jp の同じページに移す（`?hl=<言語>` を付けて、地域の言語のまま開く） |
| `sk-hub.jp/` と読むページ（その国から） | その地域のサイトの同じページへ移す（`wrangler.jsonc` の route に並べたパスだけ） |
| `sk-hub.jp` のその地域で出さないプロダクト（その国から） | その地域のサイトのトップへ移す |
| `sk-hub.jp/?site=jp` | 日本のサイト。30 日のあいだ（cookie `sk_site=jp`）地域サイトへ移すのをやめる |

## HTML 側の印

sk-hub.jp の HTML の要素に、次の印を付けます（Worker は直さない。プッシュすれば 1 分ほどで反映）。

- `data-product="<プロダクト>"` … その地域で出さないプロダクトのとき、Worker が要素を消す（`nagi` `toolbox` `study` `office` `systems` `malu` `y-filter` `lab`）。プロダクトのタイル・ドック・フッターの項目・一覧などに付ける
- `data-region="jp"` … 日本だけで出すもの（地域版では消す）。例: Sentaro さんとの提携、お知らせ
- `data-region="kr"` ＋ `hidden` … 地域版だけで出す言い換えの文（地域版で `hidden` が外れる）。プロダクト名は並べない（地域ごとに出すものがちがうため）
- ヘッダーのメニューとアップデート情報は HTML ではないので、Worker が入れる `window.SK_BLOCKED`・`window.SK_HIDDEN_CATEGORIES` で `assets/site.js` が出さないものを決める

## 整えるもの

- 言語を選んでいなければ、その地域の言語で出す（`<head>` の先頭にスクリプトを入れる）。
- タイトル・説明文をその地域の言語にする（sk-hub.jp の訳の辞書。トップと `/products/` は専用の説明文 `DESC`）。canonical・og:url・og:locale を地域のものにし、hreflang を付ける。
- 国は、Cloudflare がつける `request.cf.country` で見ます（韓国は `KR`、中国は `CN`、台湾と香港とマカオは `TW` `HK` `MO`、EEA・英国・スイスは `eu`）。検索エンジンのクローラー（UA に bot・crawler・spider を含む）には、sk-hub.jp では出し分けません。

## 気をつけること

- 言語・表示の設定は、アドレスごとに別に保存されます（地域のサイトと `sk-hub.jp` は別の場所）。地域のサイトから `sk-hub.jp` のアプリに移るときは、`?hl=<言語>` で、まだ言語を選んでいない人だけその言語にします（`assets/i18n.js`）。地域のサイトではログインできません（アカウントのログインやアプリは `sk-hub.jp` に移ります）。
- `/lang/`（地域と言語の選択）は、sk-hub.jp の同じページです。別の地域を選ぶと、その地域のサイトへ `?setlang=<言語>` で言語を引き継いで移ります（`lang/lang.js`）。地域を足すときは、ここの `SITES` と `/lang/` のカード（`_build/pages/lang.html`）も足します。
- **中国（cn）**: Google・Firebase に届かないので、アカウントのいらない Nagi と SK's Toolbox だけを出し、Google Fonts とアナリティクスの読み込みを外します。それでも、Nagi と SK's Toolbox のアプリのページ（sk-hub.jp）は、Google Fonts を読み込むため、文字が端末の文字になることがあります。中国向けのサービスとして公開するときは、現地の法令（ICP 届出など）の確認が要ります。
- `/korea/`（日本と韓国をつなぐ SK Hub の紹介ページ）は、sk-hub.jp の通常のページです（地域のサイトからは開けません）。

## 最初にすること

`sk-hub.jp/` で出し分けるには、**sk-hub.jp の DNS がプロキシ済み**（Cloudflare ダッシュボードの DNS で、雲がオレンジ）になっている必要があります。GitHub Pages に直接向いている（雲がグレー＝DNS のみ）ときは、プロキシに切り替えます。専用のサイト（`<地域>.sk-hub.jp`）だけなら、この設定はいりません。

1. Cloudflare → sk-hub.jp → DNS → `sk-hub.jp`（A / AAAA / CNAME）の雲をオレンジにする。
2. SSL/TLS の暗号化モードを **Full**（できれば Full (strict)）にする。「Flexible」だと無限にリダイレクトされます。
3. 地域のサイトの DNS は、下の deploy で自動で作られます。

プロキシに切り替えたあと、GitHub Pages の「Enforce HTTPS」が外れて見えることがあります。サイトが開けることを確認してください。

## deploy

```
cd _workers/kr
npx wrangler deploy
```

wrangler は sakueinakai2023@gmail.com の Cloudflare アカウントにログインして使います（sk-support などと同じ）。Workers Builds（Git 連携）でルートディレクトリを `_workers/kr` にすると、プッシュしたら自動で deploy されるようにもできます。

## 確かめ方

- 各地域のサイト（`kr.sk-hub.jp/` など）を開く → その地域の言語のトップ（出さないプロダクトがない）。
- その地域で出さないプロダクトのページ（例: `cn.sk-hub.jp/products/study/`）を開く → その地域のトップに移る。
- `sk-hub.jp/` を、その国の VPN で開く → その地域のサイトへ移る。`sk-hub.jp/?site=jp` で日本のサイトに戻れる。
- 出し分けが効かないとき: sk-hub.jp の DNS がプロキシ済みか、Workers の route に `sk-hub.jp/` があるかを見る（Cloudflare → Workers → sk-kr → 設定 → ドメインとルート）。
