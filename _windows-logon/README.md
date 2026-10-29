# SK Hub で Windows にサインイン

Windows のサインイン画面（Ctrl+Alt+Del のあとの画面・ロック画面）に「**SK Hub でサインイン**」のタイルを追加します。
スマートフォンで SK Hub Systems アカウント（Google・GitHub・LINE・Kakao・パスキー・0F8）で承認するだけで、パスワードを打たずに Windows に入れます。

`_` で始まるフォルダなので、GitHub Pages では公開されません。

## しくみ

```
Windows のサインイン画面                    Firestore                         スマートフォン
（SKHubCredentialProvider.dll）            windowsLogons/{コード}             sk-hub.jp/pc/
──────────────────────────               ─────────────────                ───────────────
タイルを選ぶ
匿名ログイン（この PC の UID）
コードの依頼を作る ───────────────────▶ pcUid・pcName・status: pending
「ABCD-EFGH」を表示                                                       コードを入力
                                                                          SK Hub Systems アカウントでログイン
                                         status: approved・uid ◀──────── 「承認」
2 秒ごとに確かめる ◀──────────────────
uid → つないだ Windows のユーザー（レジストリ）
    → パスワード（LSA の秘密の領域）
自動でサインイン、依頼を消す
```

- **つなぐ**のは PC の管理者が設定アプリ（`SKHubLogonSettings.exe` の「アカウントをつなぐ」）で行います。Windows のパスワードを 1 回入力して Windows に確かめてもらい、同じコードの流れで SK Hub Systems アカウントの承認を受けて、`UID → Windows のユーザー` を保存します。
- Windows のパスワードは **LSA の秘密の領域**（`L$SKHubLogon_Pw_<UID>`。SYSTEM と管理者だけが読める）に保存し、サインインのときだけ読み出して `CredProtect` してから LogonUI に渡します。
- PC は自分が作った依頼（`pcUid` が自分の匿名ログイン）しか読めず、承認は**本人の UID でしか書けません**（`systems/firestore.rules` の `windowsLogons`）。ほかの人がコードを承認しても、その人のアカウントがこの PC につながっていなければサインインしません。
- コードは 8 文字（`0・1・I・O` を除いた 32 文字）、有効期限は 10 分。使い終わった依頼は PC が消します。
- タイルには、コード・状態（`sk-hub.jp/pc で承認（残り 9:41）`）と、使えるときだけのリンク（コードがあるときは「QR コードを表示」、期限切れ・失敗のときは「新しいコードを表示」）だけを出します。承認されると自動でサインインするので、「サインイン」のボタンは置いていません。
- 「**QR コードを表示**」を押すと、`https://sk-hub.jp/pc/?code=…` の QR コードを大きく出すウィンドウが開きます（タイルの画像は丸く切り抜けないので、QR コードは別のウィンドウにしている）。承認されると自動で閉じます。設定アプリの「アカウントをつなぐ」とコマンド版の `add` も、同じ QR コードを出します。
- **パスワード・PIN・Windows Hello でのサインインはそのまま残ります**（ほかのサインイン方法を隠すことはしません）。
- サインイン画面では、ユーザーの一覧（左下）に「**SK Hub でサインイン**」の**独立したタイル**として出ます（どのユーザーにも結びつけない V1 の Credential Provider。「他のユーザー」を有効にしていても同じ）。どの Windows のユーザーでサインインするかは、承認した SK Hub Systems アカウントで決まります。
  - ユーザーごとのタイルに結びつける V2（`ICredentialProviderCredential2`）にすると、独立したタイルではなく各ユーザーのタイルの「サインイン オプション」の中に入るので、使っていません

| ファイル | 中身 |
|---|---|
| `src/provider/` | Credential Provider（`ICredentialProvider`・`ICredentialProviderCredential`）。承認を待つのは別のスレッドで、画面の更新はメッセージ用のウィンドウで UI のスレッドに戻してから行う |
| `src/common/` | 匿名ログイン・Firestore の REST（WinHTTP）・レジストリ・LSA・QR コード（`qr.cpp`。バイトモード・誤り訂正 M・型番 1〜6）。入れる・外す・パスワードの確認（`admin.cpp`）。設定アプリ・コマンド版と共通 |
| `src/provider/qrwindow.cpp` | サインイン画面の QR コードのウィンドウ |
| `src/settings/` | 設定アプリ `SKHubLogonSettings.exe`（Win32 のウィンドウ。起動すると管理者の確認が出る） |
| `src/setup/` | コマンド版 `skhub-logon-setup.exe`（同じことをコマンドで。スクリプトから使うとき） |
| `src/test/harness.cpp` | LogonUI の代わりに DLL を読み込んで呼ぶ確かめ |
| `res/tile.bmp` | タイルの画像（`/account/icon-192.png` を白い丸に入れ、まわりを暗い色 #181A1F にした BMP。サインイン画面はこの画像の透明を使わず黒く出すので、透明にはしない） |
| `/pc/`（サイト） | 承認するページ。サインイン画面にそのまま `sk-hub.jp/pc` と出すので、URL は変えない |

## ビルド

Visual Studio 2022（または Build Tools）の「C++ によるデスクトップ開発」が要ります。

```bat
build.cmd test
```

`out\` に `SKHubCredentialProvider.dll`・`SKHubLogonSettings.exe`・`skhub-logon-setup.exe`・`harness.exe` ができ、通信しない確かめ（項目・タイルの画像・承認前にサインインしないこと・KERB の詰め方）が動きます。

- `harness.exe --qr <フォルダー>` … QR コード（型番 1・3・5・6）と QR コードのウィンドウの絵を BMP に書き出す。読み取れるかは別の道具（スマートフォン・jsQR など）で確かめる
- `out\obj\preview\SKHubLogonSettings-preview.exe --snapshot <フォルダー>` … 設定アプリの画面を BMP に書き出す（見た目の確かめ用。管理者でなくてよく、何も変えない）
- `skhub-logon-setup.exe qr <文字列>` … ターミナルに QR コードを出す（管理者でなくてよい）

## 使い始める前に（1 回だけ）

1. **Firestore のルールを公開する**: y-filter リポジトリの `systems/firestore.rules` に `windowsLogons` を足してあります。`cd systems && firebase deploy --only firestore:rules`
   - 確かめ（エミュレーター。Java が要る）: `cd systems/rules-test && npm run test:windows`
2. **サイトを公開する**: このリポジトリの `pc/`（`sk-hub.jp/pc/`）をプッシュする
3. Firebase の Authentication で**匿名ログインが有効**なこと（Y-FILTER. の端末が使っているので、有効のはず）

## PC に入れる

> ⚠️ Credential Provider はサインイン画面（LogonUI）の中で動きます。最初は**仮想マシン（Hyper-V など）で試す**のがおすすめです。パスワードでのサインインは残るので、ふつうは入れなくなることはありませんが、念のため下の「戻せなくなったとき」を読んでおいてください。

`out\` の `SKHubCredentialProvider.dll` と `SKHubLogonSettings.exe` を同じフォルダーに置き、`SKHubLogonSettings.exe` をダブルクリックします（管理者の確認が出ます）。

1. 「**サインイン画面に追加**」… DLL を `C:\Program Files\SK Hub\Windows Logon\` にコピーして、サインイン画面に登録します
2. 「**アカウントをつなぐ…**」… Windows のユーザーを選んでパスワードを入力 → 出てきた QR コードをスマートフォンで読み取って承認 →「つなぎました」
3. 一覧から選んで「外す」でつながりを外せます。「サインイン画面から外す」で、つないだアカウント・保存したパスワード・この PC の匿名ログインの記録もまとめて消えます

コマンド版（`skhub-logon-setup.exe`。管理者として開いたターミナルで）も同じことができます:

- `install` … サインイン画面に追加
- `add [ユーザー名]` … ユーザー名を省くと、いまのユーザー。パスワードを入力すると、コードと `https://sk-hub.jp/pc/?code=…` が出るので、スマートフォンで承認します
- `list` … つないだアカウントの一覧 / `remove <UID か ユーザー名>` … 外す
- `uninstall` … サインイン画面から外し、つないだアカウント・保存したパスワード・この PC の匿名ログインの記録を消します

Win+L でロックすると、サインイン画面の左下のユーザーの一覧に「SK Hub でサインイン」のタイルが出ます。

## 気をつけること

- **Windows のパスワードを変えたら、設定アプリの「アカウントをつなぐ」でつなぎ直す**必要があります（サインイン画面に「パスワードが変わったため…」と出ます）。
- Microsoft アカウントでサインインしているユーザー・ドメイン（Active Directory）のユーザーは、まだ試していません。まずはローカルアカウントで使ってください。
- サインイン画面がインターネットにつながっていないと使えません（Wi-Fi はサインイン画面の右下からつなげます）。
- リモート デスクトップの資格情報の画面（CredUI）とパスワードの変更には対応していません。

## 戻せなくなったとき

サインイン画面が開かない・落ちるときは、Windows 回復環境（Shift を押しながら「再起動」→ トラブルシューティング → 詳細オプション → コマンド プロンプト）で登録を消します（回復環境では Windows のドライブが `C:` でないことがあります。`dir D:\Windows` などで確かめてください）。

```bat
reg load HKLM\OFFSOFT C:\Windows\System32\config\SOFTWARE
reg delete "HKLM\OFFSOFT\Microsoft\Windows\CurrentVersion\Authentication\Credential Providers\{17ED1991-2E40-4BA4-9807-C1BAD45211AE}" /f
reg unload HKLM\OFFSOFT
```
