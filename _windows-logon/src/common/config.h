// SK Hub Systems で Windows にサインインする（_windows-logon）の設定
//   Firebase の値は /y-filter/firebase-config.js と同じ（公開してよい値）
#pragma once

#define SKHUB_PROJECT_ID L"y-filter-systems"
#define SKHUB_API_KEY L"AIzaSyB4gqzPEPyP0NrEJw33-OTAxUrF48MmiuI"

// サインインの依頼（Firestore）。権限は y-filter リポジトリの systems/firestore.rules の windowsLogons
#define SKHUB_LOGIN_COLLECTION L"windowsLogons"
// 承認するページ（sk-hub.jp/pc/）。サインイン画面にこのまま出すので、打ちやすい短い URL にしている
#define SKHUB_APPROVE_URL L"sk-hub.jp/pc"
// コードの有効期限（ルールの duration.value(10, 'm') と同じにする）
#define SKHUB_CODE_TTL_SECONDS 600

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
