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

- **つなぐ**のは PC の管理者が設定ツール（`skhub-logon-setup add`）で行います。Windows のパスワードを 1 回入力して Windows に確かめてもらい、同じコードの流れで SK Hub Systems アカウントの承認を受けて、`UID → Windows のユーザー` を保存します。
- Windows のパスワードは **LSA の秘密の領域**（`L$SKHubLogon_Pw_<UID>`。SYSTEM と管理者だけが読める）に保存し、サインインのときだけ読み出して `CredProtect` してから LogonUI に渡します。
- PC は自分が作った依頼（`pcUid` が自分の匿名ログイン）しか読めず、承認は**本人の UID でしか書けません**（`systems/firestore.rules` の `windowsLogons`）。ほかの人がコードを承認しても、その人のアカウントがこの PC につながっていなければサインインしません。
- コードは 8 文字（`0・1・I・O` を除いた 32 文字）、有効期限は 10 分。使い終わった依頼は PC が消します。
- **パスワード・PIN・Windows Hello でのサインインはそのまま残ります**（ほかのサインイン方法を隠すことはしません）。

| ファイル | 中身 |
|---|---|
| `src/provider/` | Credential Provider（`ICredentialProvider`・`ICredentialProviderCredential`）。承認を待つのは別のスレッドで、画面の更新はメッセージ用のウィンドウで UI のスレッドに戻してから行う |
| `src/common/` | 匿名ログイン・Firestore の REST（WinHTTP）・レジストリ・LSA。設定ツールと共通 |
| `src/setup/` | 設定ツール `skhub-logon-setup.exe` |
| `src/test/harness.cpp` | LogonUI の代わりに DLL を読み込んで呼ぶ確かめ |
| `res/tile.bmp` | タイルの画像（`/account/icon-192.png` を白地の BMP にしたもの） |
| `/pc/`（サイト） | 承認するページ。サインイン画面にそのまま `sk-hub.jp/pc` と出すので、URL は変えない |

## ビルド

Visual Studio 2022（または Build Tools）の「C++ によるデスクトップ開発」が要ります。

```bat
build.cmd test
```

`out\` に `SKHubCredentialProvider.dll`・`skhub-logon-setup.exe`・`harness.exe` ができ、通信しない確かめ（項目・タイルの画像・承認前にサインインしないこと・KERB の詰め方）が動きます。

## 使い始める前に（1 回だけ）

1. **Firestore のルールを公開する**: y-filter リポジトリの `systems/firestore.rules` に `windowsLogons` を足してあります。`cd systems && firebase deploy --only firestore:rules`
   - 確かめ（エミュレーター。Java が要る）: `cd systems/rules-test && npm run test:windows`
2. **サイトを公開する**: このリポジトリの `pc/`（`sk-hub.jp/pc/`）をプッシュする
3. Firebase の Authentication で**匿名ログインが有効**なこと（Y-FILTER. の端末が使っているので、有効のはず）

## PC に入れる

> ⚠️ Credential Provider はサインイン画面（LogonUI）の中で動きます。最初は**仮想マシン（Hyper-V など）で試す**のがおすすめです。パスワードでのサインインは残るので、ふつうは入れなくなることはありませんが、念のため下の「戻せなくなったとき」を読んでおいてください。

`out\` の `SKHubCredentialProvider.dll` と `skhub-logon-setup.exe` を同じフォルダーに置き、**管理者として開いたターミナル**で:

```bat
skhub-logon-setup install
skhub-logon-setup add
```

- `install` … DLL を `C:\Program Files\SK Hub\Windows Logon\` にコピーして、サインイン画面に登録します
- `add [ユーザー名]` … ユーザー名を省くと、いまのユーザー。パスワードを入力すると、コードと `https://sk-hub.jp/pc/?code=…` が出るので、スマートフォンで承認します
- `list` … つないだアカウントの一覧 / `remove <UID か ユーザー名>` … 外す
- `uninstall` … サインイン画面から外し、つないだアカウント・保存したパスワード・この PC の匿名ログインの記録を消します

Win+L でロックすると、「サインイン オプション」に SK Hub のアイコンが出ます。

## 気をつけること

- **Windows のパスワードを変えたら、`add` でつなぎ直す**必要があります（サインイン画面に「パスワードが変わったため…」と出ます）。
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
