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

// サインイン画面の項目（タイルを選ぶと出る）
enum FIELD_ID {
  SFI_TILEIMAGE = 0,  // アイコン
  SFI_TITLE,          // 「SK Hub でサインイン」
  SFI_INSTRUCTION,    // sk-hub.jp/pc を開いてコードを入力する、という説明
  SFI_CODE,           // コード（ABCD-EFGH）
  SFI_STATUS,         // 承認を待っています（残り 9:30）など
  SFI_NEWCODE,        // 新しいコードを表示
  SFI_SUBMIT,         // サインイン（承認されると自動でサインインするので、押さなくてもよい）
  SFI_NUM_FIELDS
};

struct FIELD_STATE_PAIR {
  CREDENTIAL_PROVIDER_FIELD_STATE cpfs;
  CREDENTIAL_PROVIDER_FIELD_INTERACTIVE_STATE cpfis;
};

static const FIELD_STATE_PAIR s_rgFieldStatePairs[SFI_NUM_FIELDS] = {
  { CPFS_DISPLAY_IN_BOTH, CPFIS_NONE },           // SFI_TILEIMAGE
  { CPFS_DISPLAY_IN_BOTH, CPFIS_NONE },           // SFI_TITLE
  { CPFS_DISPLAY_IN_SELECTED_TILE, CPFIS_NONE },  // SFI_INSTRUCTION
  { CPFS_DISPLAY_IN_SELECTED_TILE, CPFIS_NONE },  // SFI_CODE
  { CPFS_DISPLAY_IN_SELECTED_TILE, CPFIS_NONE },  // SFI_STATUS
  { CPFS_DISPLAY_IN_SELECTED_TILE, CPFIS_NONE },  // SFI_NEWCODE
  { CPFS_DISPLAY_IN_SELECTED_TILE, CPFIS_NONE },  // SFI_SUBMIT
};

static const CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR s_rgFieldDescriptors[SFI_NUM_FIELDS] = {
  { SFI_TILEIMAGE, CPFT_TILE_IMAGE, const_cast<LPWSTR>(L"Image"), CPFG_CREDENTIAL_PROVIDER_LOGO },
  { SFI_TITLE, CPFT_LARGE_TEXT, const_cast<LPWSTR>(L"SK Hub でサインイン"), CPFG_CREDENTIAL_PROVIDER_LABEL },
  { SFI_INSTRUCTION, CPFT_SMALL_TEXT, const_cast<LPWSTR>(L"説明") },
  { SFI_CODE, CPFT_LARGE_TEXT, const_cast<LPWSTR>(L"コード") },
  { SFI_STATUS, CPFT_SMALL_TEXT, const_cast<LPWSTR>(L"状態") },
  { SFI_NEWCODE, CPFT_COMMAND_LINK, const_cast<LPWSTR>(L"新しいコードを表示") },
  { SFI_SUBMIT, CPFT_SUBMIT_BUTTON, const_cast<LPWSTR>(L"サインイン") },
};
