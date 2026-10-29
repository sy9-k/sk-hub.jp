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
enum FIELD_ID {
  SFI_TILEIMAGE = 0,  // アイコン（暗い四角に白い丸）
  SFI_TITLE,          // 「SK Hub でサインイン」
  SFI_CODE,           // コード（ABCD-EFGH）
  SFI_STATUS,         // sk-hub.jp/pc で承認（残り 9:30）など
  SFI_QR,             // QR コードを表示（コードがあるときだけ。qrwindow.cpp）
  SFI_NEWCODE,        // 新しいコードを表示（期限切れ・失敗のときだけ）
  SFI_NUM_FIELDS
};

struct FIELD_STATE_PAIR {
  CREDENTIAL_PROVIDER_FIELD_STATE cpfs;
  CREDENTIAL_PROVIDER_FIELD_INTERACTIVE_STATE cpfis;
};

// 最初の状態（SFI_QR・SFI_NEWCODE は流れに合わせて出し入れする）
static const FIELD_STATE_PAIR s_rgFieldStatePairs[SFI_NUM_FIELDS] = {
  { CPFS_DISPLAY_IN_BOTH, CPFIS_NONE },           // SFI_TILEIMAGE
  { CPFS_DISPLAY_IN_BOTH, CPFIS_NONE },           // SFI_TITLE
  { CPFS_DISPLAY_IN_SELECTED_TILE, CPFIS_NONE },  // SFI_CODE
  { CPFS_DISPLAY_IN_SELECTED_TILE, CPFIS_NONE },  // SFI_STATUS
  { CPFS_HIDDEN, CPFIS_NONE },                    // SFI_QR
  { CPFS_HIDDEN, CPFIS_NONE },                    // SFI_NEWCODE
};

static const CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR s_rgFieldDescriptors[SFI_NUM_FIELDS] = {
  { SFI_TILEIMAGE, CPFT_TILE_IMAGE, const_cast<LPWSTR>(L"Image"), CPFG_CREDENTIAL_PROVIDER_LOGO },
  { SFI_TITLE, CPFT_LARGE_TEXT, const_cast<LPWSTR>(L"SK Hub でサインイン"), CPFG_CREDENTIAL_PROVIDER_LABEL },
  { SFI_CODE, CPFT_LARGE_TEXT, const_cast<LPWSTR>(L"コード") },
  { SFI_STATUS, CPFT_SMALL_TEXT, const_cast<LPWSTR>(L"状態") },
  { SFI_QR, CPFT_COMMAND_LINK, const_cast<LPWSTR>(L"QR コードを表示") },
  { SFI_NEWCODE, CPFT_COMMAND_LINK, const_cast<LPWSTR>(L"新しいコードを表示") },
};
