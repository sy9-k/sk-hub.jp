// SK Hub Systems で Windows にサインインする（_windows-logon）の設定
//   Firebase の値は /y-filter/firebase-config.js と同じ（公開してよい値）
#pragma once

#define SKHUB_PROJECT_ID L"y-filter-systems"
#define SKHUB_API_KEY L"AIzaSyB4gqzPEPyP0NrEJw33-OTAxUrF48MmiuI"

// 0F8 アカウント（Search3958 の 0F8。ID とパスワードでログインする）。
//   サインイン画面ではポップアップ（0F8 の SDK。https://search3958.github.io/frameworks/client-service.js）が使えないので、
//   0F8 のアカウントサービスの /v1/auth/login で直接確かめる（0F8 側の了承ずみ）。送り先は SDK の apiBase と同じ。
//   サービスは Origin ヘッダーを求めるので、sk-hub.jp から使うときと同じ https://sk-hub.jp を送る
#define SKHUB_OF8_HOST L"sentaro-0f8-accounts.takesen2278.workers.dev"
#define SKHUB_OF8_ORIGIN "https://sk-hub.jp"

// サインインの依頼（Firestore）。権限は y-filter リポジトリの systems/firestore.rules の windowsLogons
#define SKHUB_LOGIN_COLLECTION L"windowsLogons"
// 承認するページ（sk-hub.jp/pc/）。サインイン画面にこのまま出すので、打ちやすい短い URL にしている
#define SKHUB_APPROVE_URL L"sk-hub.jp/pc"
// コードの有効期限（ルールの duration.value(10, 'm') と同じにする）
#define SKHUB_CODE_TTL_SECONDS 600
// この PC の鍵（マシンの NCrypt の鍵の名前）。依頼に署名するのに使う（devicekey.cpp）
#define SKHUB_DEVICE_KEY_NAME L"SKHubLogonDevice"
// 署名するメッセージの先頭（sk-hub.jp/pc/pc.js の SIGN_TAG と同じにする）
#define SKHUB_SIGN_TAG "skhub-logon-v1"

// Credential Provider の CLSID（変えると、入れ直しが必要）
#define SKHUB_CLSID_STRING L"{17ED1991-2E40-4BA4-9807-C1BAD45211AE}"
// {17ED1991-2E40-4BA4-9807-C1BAD45211AE}
#define SKHUB_CLSID_INIT { 0x17ed1991, 0x2e40, 0x4ba4, { 0x98, 0x07, 0xc1, 0xba, 0xd4, 0x52, 0x11, 0xae } }

// つないだアカウント（UID → Windows のユーザー）。HKLM\SOFTWARE\SK Hub\Windows Logon\Users\<UID> に UserName・Domain
#define SKHUB_REG_ROOT L"SOFTWARE\\SK Hub\\Windows Logon"
#define SKHUB_REG_USERS SKHUB_REG_ROOT L"\\Users"
// LSA の秘密の領域（SYSTEM と管理者だけが読める）に保存するもの
//   L$SKHubLogon_Device   … この PC の匿名ログイン（Firebase）のリフレッシュトークン
//   L$SKHubLogon_Pw_<UID> … つないだ Windows のユーザーのパスワード
#define SKHUB_SECRET_DEVICE L"L$SKHubLogon_Device"
#define SKHUB_SECRET_PASSWORD_PREFIX L"L$SKHubLogon_Pw_"

#define SKHUB_DLL_NAME L"SKHubCredentialProvider.dll"
#define SKHUB_INSTALL_DIR L"SK Hub\\Windows Logon"
