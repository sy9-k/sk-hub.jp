// SK Hub で Windows にサインイン — 設定ツール（管理者として実行する）
//   skhub-logon-setup install          サインイン画面に「SK Hub でサインイン」を出す
//   skhub-logon-setup add [ユーザー名]  SK Hub Systems アカウントと Windows のユーザーをつなぐ
//   skhub-logon-setup list             つないだアカウントの一覧
//   skhub-logon-setup remove <UID か ユーザー名>
//   skhub-logon-setup uninstall        サインイン画面から外し、つないだアカウントもすべて消す
#include <windows.h>
#include <string>
#include <vector>

#include "../common/admin.h"
#include "../common/config.h"
#include "../common/qr.h"
#include "../common/skhub.h"

namespace {

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

// QR コードをコンソールに出す。1 モジュール = 空白 2 つで、背景の色を白・黒に塗る
//   （█ などの記号は、日本語のフォントでは幅が 2 文字分になって崩れるので使わない）。コンソールでなければ出さない
bool PrintQr(const std::wstring& text) {
  HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
  CONSOLE_SCREEN_BUFFER_INFO info;
  if (!GetConsoleScreenBufferInfo(out, &info)) return false;
  const qr::Code code = qr::Encode(skhub::ToUtf8(text));
  if (!code.size) return false;
  const WORD light = BACKGROUND_RED | BACKGROUND_GREEN | BACKGROUND_BLUE | BACKGROUND_INTENSITY;
  const WORD dark = 0;
  const int quiet = 3;
  DWORD written;
  for (int y = -quiet; y < code.size + quiet; y++) {
    Print(L"  ");
    for (int x = -quiet; x < code.size + quiet; x++) {
      SetConsoleTextAttribute(out, code.Dark(x, y) ? dark : light);
      WriteConsoleW(out, L"  ", 2, &written, nullptr);
    }
    SetConsoleTextAttribute(out, info.wAttributes);
    Print(L"\n");
  }
  return true;
}

// ---------- install / uninstall ----------

int Install() {
  std::wstring target, error;
  if (FAILED(skhub::InstallProvider(skhub::ExeDir(), target, error))) {
    PrintLine(error);
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
  std::wstring error;
  if (FAILED(skhub::UninstallProvider(error))) {
    PrintLine(error);
    return 1;
  }
  PrintLine(L"サインイン画面から「SK Hub でサインイン」を外し、つないだアカウントと保存したパスワードを消しました。");
  return 0;
}

// ---------- add ----------

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
  std::wstring account = input.empty() ? skhub::CurrentUser() : input;
  std::wstring domain, user;
  skhub::SplitUser(account, domain, user);
  if (user.empty()) {
    PrintLine(L"Windows のユーザー名を指定してください。");
    return 1;
  }
  const std::wstring shown = skhub::DisplayUser(domain, user);
  PrintLine(L"Windows のユーザー: " + shown);
  if (input.empty()) PrintLine(L"（別のユーザーをつなぐときは skhub-logon-setup add <ユーザー名>）");
  Print(L"このユーザーの Windows のパスワード（PIN ではなく）: ");
  std::wstring password;
  if (!ReadPassword(password)) {
    PrintLine(L"パスワードを読めませんでした。コマンドプロンプトなどから直接実行してください。");
    return 1;
  }

  // パスワードが合っているか、Windows に確かめてもらう
  std::wstring error;
  if (FAILED(skhub::VerifyWindowsPassword(domain, user, password, error))) {
    skhub::Wipe(password);
    PrintLine(error);
    return 1;
  }

  // SK Hub Systems アカウントで承認してもらう
  PrintLine(L"コードを発行しています…");
  skhub::DeviceToken device;
  std::wstring code;
  if (FAILED(skhub::CreateRequest(device, skhub::Purpose::Register, code, error))) {
    skhub::Wipe(password);
    PrintLine(error);
    return 1;
  }
  const std::wstring url = L"https://" SKHUB_APPROVE_URL L"/?code=" + code;
  PrintLine();
  PrintLine(L"スマートフォンのカメラで QR コードを読み取るか、次のページを開いて、つなぐ SK Hub Systems アカウントで承認してください。");
  PrintLine();
  PrintQr(url);
  PrintLine();
  PrintLine(L"  " + url);
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
        PrintLine(L"保存できませんでした: " + skhub::ErrorText(hr));
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
  for (const auto& u : users) PrintLine(u.uid + L"  →  " + skhub::DisplayUser(u.domain, u.userName));
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
        PrintLine(L"消せませんでした（" + u.uid + L"）: " + skhub::ErrorText(hr));
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
  // 確かめ用（QR コードの出かただけを見る。管理者でなくてよい）
  if (command == L"qr" && argc >= 3) return PrintQr(argv[2]) ? 0 : 1;
  if (!skhub::IsElevated()) {
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
