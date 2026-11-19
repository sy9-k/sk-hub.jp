# 家庭サーバー用 非公開ページサーバー

家の LAN または Tailscale に接続しているときだけ見られる、HTML ページの一覧サーバーです。
Python 標準ライブラリのみで動くので、追加インストールは不要です（Python 3.9 以上）。
ログインはありません。アクセスは接続元の IP と Host 名で制限しています。

- `/` … ページ一覧（SK Material）
- `/manage` … ページの追加・削除
- 各ページ … そのまま表示され、右下の メニューボタン からページ一覧や管理画面を開けます

## 構成

| ファイル | 役割 |
|---|---|
| `server.py` | サーバー本体。接続元と Host の確認、一覧、追加・削除、HTML へのメニュー差し込み |
| `shell.js` | 右下のメニューボタン（Shadow DOM 内に閉じている。SK Material の見た目） |
| `assets/sk-material.css` | SK Material（M3 の色と部品。`brand/material/material.css` と同じ色の値） |
| `assets/manage.js` | ページ管理画面の動き（追加・削除） |
| `assets/favicon.svg` | SK のアイコン |
| `sample/example.html` | 動作確認用のサンプルページ |

ページ本体（Claude などで作った HTML）は **リポジトリの外** に置きます。
このリポジトリは GitHub Pages で公開されているため、ページを入れると世界中に公開されてしまいます。
既定の場所は `%USERPROFILE%\home-pages`（例: `C:\Users\sakue\home-pages`）です。

## 使い方

1. サーバーを起動します。

   ```bash
   python "C:\Users\sakue\home-server\_home-server\server.py" --allow-host s-asi7w11.tail9a26dd.ts.net
   ```

   既定ではポート `8787` で待ち受けます。

2. ブラウザで開きます。

   - `https://s-asi7w11.tail9a26dd.ts.net/`（Tailscale 接続中の端末から）
   - `http://localhost:8787/`（このPC上で確認する場合）

3. ページを追加するには、ホームの「ページの管理」を開きます。HTML ファイルを選び、ページ名を入れて「追加する」を押します。同じ名前があるときは、上書きするか確認されます。
4. ページを削除するには、「ページの管理」で「削除」を押します。確認のあと削除され、元に戻せません。

ページを手で追加することもできます。`home-pages` に HTML を入れるだけで、サーバーの再起動は要りません。

```bash
Copy-Item "C:\Users\sakue\Downloads\memo.html" "$env:USERPROFILE\home-pages\"
```

### ページの置き方

- `home-pages/memo.html` → `/memo.html` として見られます
- `home-pages/budget/index.html` → `/budget/` として見られます（サブフォルダ単位で1ページ扱い）
- 管理画面からは、直下に 1 ファイルずつ追加します。サブフォルダのページは手で入れてください。
- ルート直下の `index.html` は「ページ一覧」に使われるため、一覧には出ません
- 名前が `.` で始まるファイル・フォルダは無視されます

## アクセス制限

- 接続元 IP は、このPC・家庭内 LAN・Tailscale（`100.64.0.0/10` など）だけ許可します。それ以外は `403` です。
- Host 名も許可リストで確認します（DNS リバインディング対策）。許可する名前は `--allow-host` で追加します。
- 追加と削除は、独自のヘッダー（`X-SK-Home`）が付いた操作だけ受け付けます。別のサイトから勝手に送られるのを防ぐためです。

**ログインがないので、許可された範囲（家の LAN と Tailscale の端末）なら誰でも見て、追加・削除できます。** 家族や他人の端末を Tailscale に入れていないか、確認してください。

> 注意: `tailscale serve` 経由の接続は、サーバー内部では 127.0.0.1 から来るように見えます。外部からは Tailnet 内の端末しか届かないので、安全性は Tailscale 側の制限に頼っています。Funnel（インターネット公開）は**有効にしないでください**。

ルーターでポート転送して外部公開すると、接続元が公開 IP になるので拒否されます。外部からは見せない前提なので、ポート転送はしないでください。

## Tailscale の https（任意）

`tailscale serve` で、https の入口を作れます（サーバーPC で実行）。

```bash
tailscale serve --bg 8787
tailscale serve status
```

`status` に表示される `https://<PC名>.<tailnet名>.ts.net` が入口のアドレスです。

## Windows の注意点

- 初回起動時に「Windows Defender ファイアウォール」の許可ダイアログが出たら、**プライベート** と Tailscale 側のネットワークを許可してください。
- PC のスリープ中はサーバーも止まります。常時使うなら、タスクスケジューラで「ログオン時に `server.py` を起動」するのがおすすめです。

## WordPress（wordpress.private.sk-hub.jp）

`wordpress.private.sk-hub.jp` は、Tailscale に接続しているときだけ WordPress を表示します。
WordPress は `wordpress/` の Docker Compose で動かし、このサーバーが Host 名で中継します。

- 送信元が Tailscale（`100.64.0.0/10`・`fd7a:115c:a1e0::/48`）と このPC だけの場合に通します。LAN からは `403` です。
- WordPress 本体は `127.0.0.1:8080` でだけ待ち受けます（外から直接は届きません）。
- 転送先は `server.py` の `DEFAULT_PROXIES` で決めています。別の Host を足すときは `--proxy 名前=http://127.0.0.1:ポート` を付けます。

### 初回の準備

1. Docker Desktop を入れて起動します（Windows 用。WSL2 を使う設定で構いません）。
2. WordPress を起動します。

   ```bash
   cd "D:\GitHub\sk-hub.jp\_home-server\wordpress"
   docker compose up -d
   ```

3. `_home-server/wordpress/.env` にデータベースのパスワードを作ってあります（git には入りません）。消さないでください。
4. サーバーを起動します（上の「使い方」と同じ）。
5. Tailscale 接続中の端末で `http://wordpress.private.sk-hub.jp:8787/` を開き、WordPress の初期設定をします。

### 注意

- **ポート番号**: `.env` の `WP_SITE_URL` は `:8787` 付きです。`8787` 以外（:80 など）で開くなら、`.env` の `WP_SITE_URL` と `server.py` の待ち受けポートを合わせてください。
- **https は未対応**です（上の「今後の候補」と同じ）。WordPress のログインは平文の http を通ることになるので、Tailscale の中だけで使ってください。
- WordPress には**ログインがあります**（ホームのサイトと違い、誰でも編集できるわけではありません）。管理者のパスワードは忘れないでください。
- 停止は `docker compose down`（データは残ります）。データを消すのは `docker compose down -v` で、取り消せません。

## 今後の候補（今は入れていません）

- Tailscale の端末情報で、特定の端末だけ管理を許す（パスワードなしの簡単な制限）
- https 化（`private.sk-hub.jp` の証明書と DNS の設定）
