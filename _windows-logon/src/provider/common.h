// Credential Provider の共通のヘッダーと、サインイン画面に出す項目
#pragma once

#define WIN32_NO_STATUS
#include <windows.h>
#undef WIN32_NO_STATUS
#include <ntstatus.h>
#define SECURITY_WIN32
#include <security.h>
#include <ntsecapi.h>
#include <credentialprovider.h>
#include <shlguid.h>
#include <shlwapi.h>
#include <strsafe.h>

#include "../common/config.h"

extern HINSTANCE g_hinst;
void DllAddRef();
void DllRelease();

extern const CLSID CLSID_SKHubProvider;

// サインイン画面の項目（タイルを選ぶと出る）。説明は短く、リンクは使えるときだけ出す
//   QR コード（コード）でサインイン … SFI_CODE・SFI_STATUS・SFI_QR・SFI_NEWCODE
//   0F8 の ID とパスワードでサインイン … SFI_OF8_EMAIL・SFI_OF8_PASSWORD・SFI_SUBMIT・SFI_STATUS
//   SFI_SWITCH で切りかえる（0F8 アカウントをつないでいるときだけ出す）
enum FIELD_ID {
  SFI_TILEIMAGE = 0,  // アイコン（暗い四角に白い丸）
  SFI_TITLE,          // 「Sign in with SK Hub」
  SFI_CODE,           // コード（ABCD-EFGH）
  SFI_STATUS,         // sk-hub.jp/pc で承認（残り 9:30）・0F8 のエラーなど
  SFI_QR,             // QR コードを表示（コードがあるときだけ。qrwindow.cpp）
  SFI_NEWCODE,        // 新しいコードを表示（期限切れ・失敗のときだけ）
  SFI_OF8_EMAIL,      // 0F8 のメールアドレス
  SFI_OF8_PASSWORD,   // 0F8 のパスワード
  SFI_SUBMIT,         // サインイン（0F8 のときだけ）
  SFI_SWITCH,         // 0F8 の ID とパスワードでサインイン ⇔ QR コードでサインイン
  SFI_NUM_FIELDS
};

struct FIELD_STATE_PAIR {
  CREDENTIAL_PROVIDER_FIELD_STATE cpfs;
  CREDENTIAL_PROVIDER_FIELD_INTERACTIVE_STATE cpfis;
};

// 最初の状態（QR コードでサインイン。ほかは credential.cpp の ApplyMode で出し入れする）
static const FIELD_STATE_PAIR s_rgFieldStatePairs[SFI_NUM_FIELDS] = {
  { CPFS_DISPLAY_IN_BOTH, CPFIS_NONE },           // SFI_TILEIMAGE
  { CPFS_DISPLAY_IN_BOTH, CPFIS_NONE },           // SFI_TITLE
  { CPFS_DISPLAY_IN_SELECTED_TILE, CPFIS_NONE },  // SFI_CODE
  { CPFS_DISPLAY_IN_SELECTED_TILE, CPFIS_NONE },  // SFI_STATUS
  { CPFS_HIDDEN, CPFIS_NONE },                    // SFI_QR
  { CPFS_HIDDEN, CPFIS_NONE },                    // SFI_NEWCODE
  { CPFS_HIDDEN, CPFIS_NONE },                    // SFI_OF8_EMAIL
  { CPFS_HIDDEN, CPFIS_NONE },                    // SFI_OF8_PASSWORD
  { CPFS_HIDDEN, CPFIS_NONE },                    // SFI_SUBMIT
  { CPFS_HIDDEN, CPFIS_NONE },                    // SFI_SWITCH
};

static const CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR s_rgFieldDescriptors[SFI_NUM_FIELDS] = {
  { SFI_TILEIMAGE, CPFT_TILE_IMAGE, const_cast<LPWSTR>(L"Image"), CPFG_CREDENTIAL_PROVIDER_LOGO },
  { SFI_TITLE, CPFT_LARGE_TEXT, const_cast<LPWSTR>(L"Sign in with SK Hub"), CPFG_CREDENTIAL_PROVIDER_LABEL },
  { SFI_CODE, CPFT_LARGE_TEXT, const_cast<LPWSTR>(L"コード") },
  { SFI_STATUS, CPFT_SMALL_TEXT, const_cast<LPWSTR>(L"状態") },
  { SFI_QR, CPFT_COMMAND_LINK, const_cast<LPWSTR>(L"QR コードを表示") },
  { SFI_NEWCODE, CPFT_COMMAND_LINK, const_cast<LPWSTR>(L"新しいコードを表示") },
  { SFI_OF8_EMAIL, CPFT_EDIT_TEXT, const_cast<LPWSTR>(L"0F8 のメールアドレス") },
  { SFI_OF8_PASSWORD, CPFT_PASSWORD_TEXT, const_cast<LPWSTR>(L"0F8 のパスワード") },
  { SFI_SUBMIT, CPFT_SUBMIT_BUTTON, const_cast<LPWSTR>(L"サインイン") },
  { SFI_SWITCH, CPFT_COMMAND_LINK, const_cast<LPWSTR>(L"0F8 の ID とパスワードでサインイン") },
};
