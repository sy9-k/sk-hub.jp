// SK Hub で Windows にサインイン — 設定ツール（管理者として実行する）
//   skhub-logon-setup install          サインイン画面に「SK Hub でサインイン」を出す
//   skhub-logon-setup add [ユーザー名]  SK Hub Systems アカウントと Windows のユーザーをつなぐ
//   skhub-logon-setup list             つないだアカウントの一覧
//   skhub-logon-setup remove <UID か ユーザー名>
//   skhub-logon-setup uninstall        サインイン画面から外し、つないだアカウントもすべて消す
#define SECURITY_WIN32
#include <windows.h>
#include <security.h>
#include <shlobj.h>
#include <string>
#include <vector>

#include "../common/config.h"
#include "../common/skhub.h"

namespace {

const wchar_t kClsidKey[] = L"SOFTWARE\\Classes\\CLSID\\" SKHUB_CLSID_STRING;
const wchar_t kProviderKey[] = L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Authentication\\Credential Providers\\" SKHUB_CLSID_STRING;

void Print(const std::wstring& s) {
  HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
  DWORD mode, written;
  if (GetConsoleMode(out, &mode)) {
    WriteConsoleW(out, s.c_str(), (DWORD)s.size(), &written, nullptr);
  } else {
    std::string utf8 = skhub::ToUtf8(s);
    WriteFile(out, utf8.data(), (DWORD)utf8.size(), &written, nullptr);
  }
}

void PrintLine(const std::wstring& s = L"") { Print(s + L"\n"); }

std::wstring ErrorText(HRESULT hr) {
  wchar_t* text = nullptr;
  FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS, nullptr, hr, 0, (LPWSTR)&text, 0, nullptr);
  wchar_t code[16];
  swprintf_s(code, L"0x%08X", (unsigned)hr);
  std::wstring out = text ? std::wstring(text) + L"（" + code + L"）" : code;
  if (text) LocalFree(text);
  while (!out.empty() && (out.back() == L'\n' || out.back() == L'\r')) out.pop_back();
  return out;
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

// ---------- install / uninstall ----------

int Install() {
  const std::wstring source = ExeDir() + L"\\" SKHUB_DLL_NAME;
  if (GetFileAttributesW(source.c_str()) == INVALID_FILE_ATTRIBUTES) {
    PrintLine(L"この設定ツールと同じフォルダーに " SKHUB_DLL_NAME L" が見つかりません。");
    return 1;
  }
  const std::wstring dir = InstallDir();
  const std::wstring target = dir + L"\\" SKHUB_DLL_NAME;
  int created = SHCreateDirectoryExW(nullptr, dir.c_str(), nullptr);
  if (created != ERROR_SUCCESS && created != ERROR_ALREADY_EXISTS) {
    PrintLine(L"フォルダーを作れませんでした: " + dir);
    return 1;
  }
  RemoveFile(target);
  if (!CopyFileW(source.c_str(), target.c_str(), FALSE)) {
    PrintLine(L"コピーできませんでした: " + ErrorText(HRESULT_FROM_WIN32(GetLastError())));
    return 1;
  }
  LSTATUS st = SetString(kClsidKey, nullptr, L"SK Hub Credential Provider");
  if (st == ERROR_SUCCESS) st = SetString((std::wstring(kClsidKey) + L"\\InprocServer32").c_str(), nullptr, target);
  if (st == ERROR_SUCCESS) st = SetString((std::wstring(kClsidKey) + L"\\InprocServer32").c_str(), L"ThreadingModel", L"Apartment");
  if (st == ERROR_SUCCESS) st = SetString(kProviderKey, nullptr, L"SKHubCredentialProvider");
  if (st != ERROR_SUCCESS) {
    PrintLine(L"レジストリに書けませんでした: " + ErrorText(HRESULT_FROM_WIN32(st)));
    return 1;
  }
  PrintLine(L"サインイン画面に「SK Hub でサインイン」を追加しました。");
  PrintLine(L"  " + target);
  PrintLine();
  PrintLine(L"次に、使う人ごとに次のコマンドで SK Hub Systems アカウントをつないでください。");
  PrintLine(L"  skhub-logon-setup add [Windows のユーザー名]");
  PrintLine(L"パスワード・PIN でのサインインはこれまでどおり使えます。");
  return 0;
}

int Uninstall() {
  LSTATUS a = RegDeleteTreeW(HKEY_LOCAL_MACHINE, kProviderKey);
  LSTATUS b = RegDeleteTreeW(HKEY_LOCAL_MACHINE, kClsidKey);
  skhub::ForgetDevice();
  const std::wstring dir = InstallDir();
  RemoveFile(dir + L"\\" SKHUB_DLL_NAME);
  RemoveDirectoryW(dir.c_str());
  RemoveDirectoryW(dir.substr(0, dir.find_last_of(L'\\')).c_str());
  if ((a != ERROR_SUCCESS && a != ERROR_FILE_NOT_FOUND) || (b != ERROR_SUCCESS && b != ERROR_FILE_NOT_FOUND)) {
    PrintLine(L"レジストリから消せませんでした: " + ErrorText(HRESULT_FROM_WIN32(a != ERROR_SUCCESS ? a : b)));
    return 1;
  }
  PrintLine(L"サインイン画面から「SK Hub でサインイン」を外し、つないだアカウントと保存したパスワードを消しました。");
  return 0;
}

// ---------- add ----------

std::wstring CurrentUser() {
  wchar_t name[512];
  ULONG size = ARRAYSIZE(name);
  return GetUserNameExW(NameSamCompatible, name, &size) ? std::wstring(name, size) : std::wstring();
}

// 「PC名\ユーザー」「.\ユーザー」「ユーザー」はこの PC のユーザー（Domain は空）。「ドメイン\ユーザー」「user@example.com」もそのまま使う
void SplitUser(const std::wstring& input, std::wstring& domain, std::wstring& user) {
  size_t slash = input.find(L'\\');
  if (slash == std::wstring::npos) {
    domain.clear();
    user = input;
    return;
  }
  domain = input.substr(0, slash);
  user = input.substr(slash + 1);
  if (domain == L"." || _wcsicmp(domain.c_str(), skhub::ComputerName().c_str()) == 0) domain.clear();
}

bool ReadPassword(std::wstring& password) {
  password.clear();
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE);
  DWORD mode;
  if (!GetConsoleMode(in, &mode)) return false;
  SetConsoleMode(in, (mode & ~ENABLE_ECHO_INPUT) | ENABLE_LINE_INPUT);
  wchar_t buf[512];
  DWORD read = 0;
  BOOL ok = ReadConsoleW(in, buf, ARRAYSIZE(buf) - 1, &read, nullptr);
  SetConsoleMode(in, mode);
  PrintLine();
  if (!ok) return false;
  password.assign(buf, read);
  SecureZeroMemory(buf, sizeof(buf));
  while (!password.empty() && (password.back() == L'\n' || password.back() == L'\r')) password.pop_back();
  return true;
}

int Add(const std::wstring& input) {
  std::wstring account = input.empty() ? CurrentUser() : input;
  std::wstring domain, user;
  SplitUser(account, domain, user);
  if (user.empty()) {
    PrintLine(L"Windows のユーザー名を指定してください。");
    return 1;
  }
  const std::wstring shown = (domain.empty() ? skhub::ComputerName() : domain) + L"\\" + user;
  PrintLine(L"Windows のユーザー: " + shown);
  if (input.empty()) PrintLine(L"（別のユーザーをつなぐときは skhub-logon-setup add <ユーザー名>）");
  Print(L"このユーザーの Windows のパスワード（PIN ではなく）: ");
  std::wstring password;
  if (!ReadPassword(password)) {
    PrintLine(L"パスワードを読めませんでした。コマンドプロンプトなどから直接実行してください。");
    return 1;
  }

  // パスワードが合っているか、Windows に確かめてもらう
  HANDLE token = nullptr;
  const bool upn = domain.empty() && user.find(L'@') != std::wstring::npos;
  if (!LogonUserW(user.c_str(), upn ? nullptr : (domain.empty() ? L"." : domain.c_str()), password.c_str(), LOGON32_LOGON_INTERACTIVE,
                  LOGON32_PROVIDER_DEFAULT, &token)) {
    DWORD e = GetLastError();
    skhub::Wipe(password);
    if (e == ERROR_LOGON_FAILURE) PrintLine(L"ユーザー名かパスワードが違います。");
    else if (e == ERROR_ACCOUNT_RESTRICTION) PrintLine(L"パスワードが空のユーザーはつなげません。先にパスワードを設定してください。");
    else PrintLine(L"パスワードを確かめられませんでした: " + ErrorText(HRESULT_FROM_WIN32(e)));
    return 1;
  }
  CloseHandle(token);

  // SK Hub Systems アカウントで承認してもらう
  PrintLine(L"コードを発行しています…");
  skhub::DeviceToken device;
  std::wstring code, error;
  if (FAILED(skhub::CreateRequest(device, skhub::Purpose::Register, code, error))) {
    skhub::Wipe(password);
    PrintLine(error);
    return 1;
  }
  PrintLine();
  PrintLine(L"スマートフォンなどで次のページを開き、つなぐ SK Hub Systems アカウントで承認してください。");
  PrintLine(L"  https://" SKHUB_APPROVE_URL L"/?code=" + code);
  PrintLine(L"  コード: " + skhub::FormatCode(code));
  PrintLine();

  const ULONGLONG deadline = GetTickCount64() + SKHUB_CODE_TTL_SECONDS * 1000ULL;
  int result = 1;
  int failures = 0;
  for (;;) {
    Sleep(2000);
    ULONGLONG now = GetTickCount64();
    if (now >= deadline) {
      PrintLine(L"\nコードの有効期限が切れました。もう一度 add からやり直してください。");
      break;
    }
    ULONGLONG left = (deadline - now) / 1000;
    wchar_t line[96];
    swprintf_s(line, L"\r承認を待っています（残り %llu:%02llu）  ", left / 60, left % 60);
    Print(line);

    skhub::RequestState state;
    std::wstring uid;
    if (FAILED(skhub::CheckRequest(device, code, state, uid, error))) {
      if (++failures >= 5) {
        PrintLine(L"\n" + error);
        break;
      }
      continue;
    }
    failures = 0;
    if (state == skhub::RequestState::Pending) continue;
    PrintLine();
    if (state == skhub::RequestState::Denied) {
      PrintLine(L"拒否されました。");
    } else if (state != skhub::RequestState::Approved) {
      PrintLine(L"コードが見つからなくなりました。もう一度 add からやり直してください。");
    } else {
      skhub::LinkedUser before;
      if (SUCCEEDED(skhub::FindLinkedUser(uid, before)))
        PrintLine(L"（このアカウントは " + before.userName + L" につながっていました。つなぎ直します）");
      skhub::LinkedUser linked{ uid, user, domain };
      HRESULT hr = skhub::SaveLinkedUser(linked, password);
      if (FAILED(hr)) {
        PrintLine(L"保存できませんでした: " + ErrorText(hr));
      } else {
        PrintLine(L"つなぎました。サインイン画面の「SK Hub でサインイン」から " + shown + L" にサインインできます。");
        PrintLine(L"  SK Hub Systems アカウントの UID: " + uid);
        PrintLine(L"Windows のパスワードを変えたら、もう一度 add でつなぎ直してください。");
        result = 0;
      }
    }
    break;
  }
  skhub::Wipe(password);
  skhub::DeleteRequest(device, code);
  return result;
}

// ---------- list / remove ----------

int List() {
  std::vector<skhub::LinkedUser> users;
  skhub::ListLinkedUsers(users);
  if (users.empty()) {
    PrintLine(L"つないだアカウントはありません。");
    return 0;
  }
  for (const auto& u : users) PrintLine(u.uid + L"  →  " + (u.domain.empty() ? skhub::ComputerName() : u.domain) + L"\\" + u.userName);
  return 0;
}

int Remove(const std::wstring& target) {
  std::vector<skhub::LinkedUser> users;
  skhub::ListLinkedUsers(users);
  int removed = 0;
  for (const auto& u : users) {
    if (u.uid == target || _wcsicmp(u.userName.c_str(), target.c_str()) == 0) {
      HRESULT hr = skhub::RemoveLinkedUser(u.uid);
      if (FAILED(hr)) {
        PrintLine(L"消せませんでした（" + u.uid + L"）: " + ErrorText(hr));
        return 1;
      }
      PrintLine(L"外しました: " + u.uid + L"  →  " + u.userName);
      removed++;
    }
  }
  if (!removed) {
    PrintLine(L"見つかりませんでした。list で確かめてください。");
    return 1;
  }
  return 0;
}

void Usage() {
  PrintLine(L"SK Hub で Windows にサインイン — 設定ツール");
  PrintLine();
  PrintLine(L"  skhub-logon-setup install          サインイン画面に「SK Hub でサインイン」を追加する");
  PrintLine(L"  skhub-logon-setup add [ユーザー名]  SK Hub Systems アカウントと Windows のユーザーをつなぐ");
  PrintLine(L"  skhub-logon-setup list             つないだアカウントの一覧");
  PrintLine(L"  skhub-logon-setup remove <UID か ユーザー名>");
  PrintLine(L"  skhub-logon-setup uninstall        外して、つないだアカウントと保存したパスワードを消す");
  PrintLine();
  PrintLine(L"管理者として実行してください。");
}

}  // namespace

int wmain(int argc, wchar_t** argv) {
  if (argc < 2) {
    Usage();
    return 0;
  }
  const std::wstring command = argv[1];
  if (command == L"help" || command == L"/?" || command == L"--help") {
    Usage();
    return 0;
  }
  if (!IsElevated()) {
    PrintLine(L"管理者として実行してください（スタートメニューで「ターミナル」を右クリック →「管理者として実行」）。");
    return 1;
  }
  if (command == L"install") return Install();
  if (command == L"uninstall") return Uninstall();
  if (command == L"add") return Add(argc >= 3 ? argv[2] : L"");
  if (command == L"list") return List();
  if (command == L"remove" && argc >= 3) return Remove(argv[2]);
  Usage();
  return 1;
}
