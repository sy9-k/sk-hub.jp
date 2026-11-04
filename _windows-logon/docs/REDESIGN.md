# Windows サインインの作り直し（設計メモ・案）

ブランチ: `feat/windows-logon-rebuild`（`claude/windows-logon` の未コミット変更を含む。両方を残す）

## 現状の問題

| 項目 | 今の仕組み | 問題 |
|---|---|---|
| 承認 | 8 文字のコードを Firestore に置き、スマホで承認すると uid が書かれる | PC 側に本人性の証拠がない。コードを見た人が承認すれば、そのコードの PC はサインインしてしまう |
| 通信相手 | 匿名ログインの UID と Firestore のドキュメント | PC の鍵ではなく Firebase の匿名 UID に頼っている |
| 0F8 | サインイン画面で ID とパスワードを受け取り、0F8 の API に直接確かめる | LogonUI の中で平文のパスワードを扱う。画面の作りも承認と分かれていて分かりにくい |
| 画面 | タイルとコード表示、QR 用の別ウィンドウ | 「どこに」「誰として」入ろうとしているかを出していない |

## 作り直しの方向（案 A・推奨）

1. **PC ごとの鍵**: 連携するときに PC の中で鍵（P-256）を作り、TPM に保護して保存する（NCrypt・Microsoft Platform Crypto Provider。TPM がなければソフトウェア鍵へ落とす）。秘密鍵は外に出ない。
2. **連携の承認**: スマホで承認するとき、PC が出したチャレンジ（ランダム値・有効期限・PC の公開鍵のハッシュ）にサイト側が署名を付け、PC が検証する。承認の中身が「この PC」に結びつく。
3. **サインイン**: 承認された PC だけが、Firestore の依頼に自分の鍵で署名できる。LogonUI は署名が正しいときだけ Windows のパスワードを受け取る。
4. **独立したウィンドウ**: QR ウィンドウを認証ウィンドウに広げる。要求元（この PC・アカウント名）、残り時間、合言葉画像を出す。閉じたら即キャンセル。
5. **0F8 のパスワード**: LogonUI で平文を扱うのをやめるか（案 A-1: 0F8 の認証はスマホ側に寄せ、PC は承認だけを受け取る）、今のまま残すか（案 A-2）。**ここは決めてもらう必要がある。**

### 案 B（代替）
認可サーバーを新設し、OAuth 2.1 / OIDC（PKCE）で全部まとめる。標準に沿うが、工数が大きく、サインイン画面との接続も別に作る必要がある。

## リポジトリをまたぐ部分
- Firestore のルール（`windowsLogons`）は `y-filter` の `systems/firestore.rules`。鍵と署名の形を変えるなら、ルールも直す必要がある。
- サイトの `pc/`（承認ページ）も、署名を付ける処理が増える。

## 検証の方法
- ビルド: `build.cmd` は LF 改行のため、この PC の cmd.exe からは起動できない（黙って終わる）。`out/` へのビルドは、VS の開発環境を読み込んだ PowerShell で同じ手順を実行する（スクリプトはスクラッチパッドにある）。
- ベースライン（作り直し前・未コミット変更込み）: `harness.exe` が `PASSED (0 failures)`。
- 実機のサインイン画面は、仮想マシンでだけ試す（ここでは確かめられない）。

## 実装状況（案 A・0F8 は A-2 = 今のまま）

実装済み（未コミット）:
- `src/common/devicekey.{h,cpp}`: PC の鍵（NCrypt・マシンの鍵・TPM があれば Platform Crypto、なければ Software KSP）、署名、指紋、base64url
- `src/common/skhub.cpp`: 依頼に `pcKey` `pcKeyId` `nonce` `signature` を入れる。承認の `keyId` がこの PC の指紋と違えば、サインインしない
- `src/common/config.h`: `SKHUB_DEVICE_KEY_NAME` `SKHUB_SIGN_TAG`
- `build.cmd`: `devicekey.cpp` と `ncrypt.lib` を追加
- `src/test/harness.cpp`: base64url のテスト（どの権限でも動く）。鍵・署名の検証は管理者のときだけ動く
- `pc/pc.js` と `pc/index.html`: 依頼の署名を確かめてから表示し、承認・拒否の両方に `keyId` を入れる。署名が合わない依頼は承認させない
- `y-filter/systems/firestore.rules`: 依頼の鍵の項目を検める。承認の `keyId` は依頼の `pcKeyId` と同じでなければならない
- `y-filter/systems/rules-test/windows.test.mjs`: 鍵の項目を入れた依頼と、指紋が違う承認を確かめる

確かめた内容:
- `build.cmd` と同じ手順でビルドできた（警告は /WX でエラー扱い。通った）
- `harness.exe` が `PASSED (0 failures)`（管理者でない実行）
- `pc/pc.js` の構文チェック（`node --check`）

まだ確かめていないこと:
- 鍵の作成・署名・検証（`harness.exe` を管理者で実行すると動く）
- Firestore のルールのテスト（Java と `npm install` が要る。`npm run test:windows`）
- 実際のサインイン（仮想マシンで試す。Firebase のルールはまだデプロイしていない）

注意:
- 鍵の項目が入る前の古い依頼（10 分以内のもの）は、ルールで作れない。PC と承認ページの両方を新しくしてから使う。
- 承認の署名（ECDSA）はルールでは確かめられない。確かめるのは承認のページ（pc.js）。ルールは「指紋が一致すること」だけを確かめる。
- PC の鍵は、この PC の TPM 内にある（TPM がない PC はソフトウェアの鍵）。PC を初期化すると鍵も変わるので、依頼の指紋も変わる（つないだアカウントの登録はそのまま使える）。

## 未決事項
1. 0F8 のパスワードを、サインイン画面で扱うのをやめるか（A-1）。今は残している（A-2）
2. 既存の `claude/windows-logon` の未コミット変更は、新しいブランチでどう引き継ぐか（今は両方の作業を残す方針）
