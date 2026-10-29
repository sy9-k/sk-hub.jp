#define SECURITY_WIN32
#include <windows.h>
#include <security.h>
#include <shlobj.h>
#include <lm.h>

#include "admin.h"
#include "config.h"
#include "skhub.h"

namespace skhub {
namespace {

const wchar_t kClsidKey[] = L"SOFTWARE\\Classes\\CLSID\\" SKHUB_CLSID_STRING;
const wchar_t kProviderKey[] = L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Authentication\\Credential Providers\\" SKHUB_CLSID_STRING;

std::wstring InstallDir() {
  PWSTR programFiles = nullptr;
  std::wstring dir;
  if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_ProgramFiles, 0, nullptr, &programFiles))) dir = std::wstring(programFiles) + L"\\" SKHUB_INSTALL_DIR;
  CoTaskMemFree(programFiles);
  return dir;
}

LSTATUS SetString(const wchar_t* key, const wchar_t* name, const std::wstring& value) {
  return RegSetKeyValueW(HKEY_LOCAL_MACHINE, key, name, REG_SZ, value.c_str(), (DWORD)((value.size() + 1) * sizeof(wchar_t)));
}

// 使用中（サインイン画面が読み込んでいる）で消せないファイルは、名前を変えて再起動のときに消す
void RemoveFile(const std::wstring& path) {
  if (DeleteFileW(path.c_str()) || GetLastError() == ERROR_FILE_NOT_FOUND) return;
  std::wstring old = path + L".old-" + std::to_wstring(GetTickCount64());
  if (MoveFileExW(path.c_str(), old.c_str(), MOVEFILE_REPLACE_EXISTING)) MoveFileExW(old.c_str(), nullptr, MOVEFILE_DELAY_UNTIL_REBOOT);
}

}  // namespace

std::wstring ErrorText(HRESULT hr) {
  wchar_t* text = nullptr;
  FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, nullptr, hr, 0, (LPWSTR)&text, 0, nullptr);
  wchar_t code[16];
  swprintf_s(code, L"0x%08X", (unsigned)hr);
  std::wstring out = text ? std::wstring(text) : std::wstring();
  if (text) LocalFree(text);
  while (!out.empty() && (out.back() == L'\n' || out.back() == L'\r')) out.pop_back();
  return out.empty() ? code : out + L"（" + code + L"）";
}

bool IsElevated() {
  HANDLE token;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return false;
  TOKEN_ELEVATION elevation = {};
  DWORD size = sizeof(elevation);
  BOOL ok = GetTokenInformation(token, TokenElevation, &elevation, sizeof(elevation), &size);
  CloseHandle(token);
  return ok && elevation.TokenIsElevated;
}

std::wstring ExeDir() {
  wchar_t path[MAX_PATH];
  DWORD n = GetModuleFileNameW(nullptr, path, MAX_PATH);
  std::wstring dir(path, n);
  return dir.substr(0, dir.find_last_of(L'\\'));
}

bool IsProviderInstalled() {
  HKEY key;
  if (RegOpenKeyExW(HKEY_LOCAL_MACHINE, kProviderKey, 0, KEY_READ, &key) != ERROR_SUCCESS) return false;
  RegCloseKey(key);
  wchar_t path[MAX_PATH] = {};
  DWORD size = sizeof(path);
  if (RegGetValueW(HKEY_LOCAL_MACHINE, (std::wstring(kClsidKey) + L"\\InprocServer32").c_str(), nullptr, RRF_RT_REG_SZ, nullptr, path, &size) != ERROR_SUCCESS)
    return false;
  return GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES;
}

HRESULT InstallProvider(const std::wstring& sourceDir, std::wstring& installedPath, std::wstring& error) {
  const std::wstring source = sourceDir + L"\\" SKHUB_DLL_NAME;
  if (GetFileAttributesW(source.c_str()) == INVALID_FILE_ATTRIBUTES) {
    error = L"この設定ツールと同じフォルダーに " SKHUB_DLL_NAME L" が見つかりません。";
    return HRESULT_FROM_WIN32(ERROR_FILE_NOT_FOUND);
  }
  const std::wstring dir = InstallDir();
  installedPath = dir + L"\\" SKHUB_DLL_NAME;
  int created = SHCreateDirectoryExW(nullptr, dir.c_str(), nullptr);
  if (created != ERROR_SUCCESS && created != ERROR_ALREADY_EXISTS && created != ERROR_FILE_EXISTS) {
    error = L"フォルダーを作れませんでした: " + dir;
    return HRESULT_FROM_WIN32(created);
  }
  RemoveFile(installedPath);
  if (!CopyFileW(source.c_str(), installedPath.c_str(), FALSE)) {
    HRESULT hr = HRESULT_FROM_WIN32(GetLastError());
    error = L"コピーできませんでした: " + ErrorText(hr);
    return hr;
  }
  LSTATUS st = SetString(kClsidKey, nullptr, L"SK Hub Credential Provider");
  if (st == ERROR_SUCCESS) st = SetString((std::wstring(kClsidKey) + L"\\InprocServer32").c_str(), nullptr, installedPath);
  if (st == ERROR_SUCCESS) st = SetString((std::wstring(kClsidKey) + L"\\InprocServer32").c_str(), L"ThreadingModel", L"Apartment");
  if (st == ERROR_SUCCESS) st = SetString(kProviderKey, nullptr, L"SKHubCredentialProvider");
  if (st != ERROR_SUCCESS) {
    error = L"レジストリに書けませんでした: " + ErrorText(HRESULT_FROM_WIN32(st));
    return HRESULT_FROM_WIN32(st);
  }
  return S_OK;
}

HRESULT UninstallProvider(std::wstring& error) {
  LSTATUS a = RegDeleteTreeW(HKEY_LOCAL_MACHINE, kProviderKey);
  LSTATUS b = RegDeleteTreeW(HKEY_LOCAL_MACHINE, kClsidKey);
  ForgetDevice();
  const std::wstring dir = InstallDir();
  RemoveFile(dir + L"\\" SKHUB_DLL_NAME);
  RemoveDirectoryW(dir.c_str());
  RemoveDirectoryW(dir.substr(0, dir.find_last_of(L'\\')).c_str());
  LSTATUS failed = (a != ERROR_SUCCESS && a != ERROR_FILE_NOT_FOUND) ? a : (b != ERROR_SUCCESS && b != ERROR_FILE_NOT_FOUND) ? b : ERROR_SUCCESS;
  if (failed != ERROR_SUCCESS) {
    error = L"レジストリから消せませんでした: " + ErrorText(HRESULT_FROM_WIN32(failed));
    return HRESULT_FROM_WIN32(failed);
  }
  return S_OK;
}

std::wstring CurrentUser() {
  wchar_t name[512];
  ULONG size = ARRAYSIZE(name);
  return GetUserNameExW(NameSamCompatible, name, &size) ? std::wstring(name, size) : std::wstring();
}

void SplitUser(const std::wstring& input, std::wstring& domain, std::wstring& user) {
  size_t slash = input.find(L'\\');
  if (slash == std::wstring::npos) {
    domain.clear();
    user = input;
    return;
  }
  domain = input.substr(0, slash);
  user = input.substr(slash + 1);
  if (domain == L"." || _wcsicmp(domain.c_str(), ComputerName().c_str()) == 0) domain.clear();
}

std::wstring DisplayUser(const std::wstring& domain, const std::wstring& user) {
  if (domain.empty() && user.find(L'@') != std::wstring::npos) return user;
  return (domain.empty() ? ComputerName() : domain) + L"\\" + user;
}

std::vector<std::wstring> LocalUsers() {
  std::vector<std::wstring> users;
  USER_INFO_1* info = nullptr;
  DWORD read = 0, total = 0;
  if (NetUserEnum(nullptr, 1, FILTER_NORMAL_ACCOUNT, reinterpret_cast<BYTE**>(&info), MAX_PREFERRED_LENGTH, &read, &total, nullptr) == NERR_Success) {
    for (DWORD i = 0; i < read; i++) {
      if (!(info[i].usri1_flags & UF_ACCOUNTDISABLE)) users.push_back(info[i].usri1_name);
    }
  }
  if (info) NetApiBufferFree(info);
  return users;
}

HRESULT VerifyWindowsPassword(const std::wstring& domain, const std::wstring& user, const std::wstring& password, std::wstring& error) {
  HANDLE token = nullptr;
  const bool upn = domain.empty() && user.find(L'@') != std::wstring::npos;
  if (LogonUserW(user.c_str(), upn ? nullptr : (domain.empty() ? L"." : domain.c_str()), password.c_str(), LOGON32_LOGON_INTERACTIVE,
                 LOGON32_PROVIDER_DEFAULT, &token)) {
    CloseHandle(token);
    return S_OK;
  }
  DWORD e = GetLastError();
  if (e == ERROR_LOGON_FAILURE) error = L"ユーザー名かパスワードが違います。";
  else if (e == ERROR_ACCOUNT_RESTRICTION) error = L"パスワードが空のユーザーはつなげません。先にパスワードを設定してください。";
  else error = L"パスワードを確かめられませんでした: " + ErrorText(HRESULT_FROM_WIN32(e));
  return HRESULT_FROM_WIN32(e);
}

}  // namespace skhub
