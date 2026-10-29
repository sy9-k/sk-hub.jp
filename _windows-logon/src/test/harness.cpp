// サインイン画面に入れる前の確かめ（LogonUI の代わりに DLL を読み込んで呼ぶ）
//   harness <DLL のパス>          通信しない確かめ（項目・タイルの画像・承認前の GetSerialization・KERB の詰め方）
//   harness <DLL のパス> --live   タイルを選んだときの流れ（本番の Firebase に匿名ログインし、コードを発行する。管理者として実行）
//   harness --qr <フォルダー>      QR コードとウィンドウの絵を BMP に書き出す（読み取れるかを別の道具で確かめる）
#include <cstdio>
#include <string>

// common.h を先に（windows.h より前に WIN32_NO_STATUS を決める）
#include "../provider/common.h"
#include "../provider/helpers.h"
#include "../common/qr.h"
#include "../common/skhub.h"
#include "../provider/qrwindow.h"
#include <set>
#include <vector>

HINSTANCE g_hinst = nullptr;
void DllAddRef() {}
void DllRelease() {}
const CLSID CLSID_SKHubProvider = SKHUB_CLSID_INIT;

static int g_failures = 0;

static void Check(bool ok, const char* what) {
  printf("%s %s\n", ok ? "[ok]  " : "[FAIL]", what);
  if (!ok) g_failures++;
}

static void PrintW(const wchar_t* prefix, const wchar_t* text) {
  DWORD written;
  std::wstring line = std::wstring(prefix) + (text ? text : L"(null)") + L"\n";
  HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
  DWORD mode;
  if (GetConsoleMode(out, &mode)) {
    WriteConsoleW(out, line.c_str(), (DWORD)line.size(), &written, nullptr);
  } else {
    int n = WideCharToMultiByte(CP_UTF8, 0, line.c_str(), (int)line.size(), nullptr, 0, nullptr, nullptr);
    std::string utf8(n, '\0');
    WideCharToMultiByte(CP_UTF8, 0, line.c_str(), (int)line.size(), &utf8[0], n, nullptr, nullptr);
    fflush(stdout);
    WriteFile(out, utf8.data(), (DWORD)utf8.size(), &written, nullptr);
  }
}

class FakeProviderEvents : public ICredentialProviderEvents {
 public:
  int changed = 0;
  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) {
    if (riid == IID_IUnknown || riid == IID_ICredentialProviderEvents) {
      *ppv = this;
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  IFACEMETHODIMP_(ULONG) AddRef() { return 2; }
  IFACEMETHODIMP_(ULONG) Release() { return 1; }
  IFACEMETHODIMP CredentialsChanged(UINT_PTR) {
    changed++;
    printf("  CredentialsChanged\n");
    return S_OK;
  }
};

class FakeCredentialEvents : public ICredentialProviderCredentialEvents {
 public:
  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) {
    if (riid == IID_IUnknown || riid == IID_ICredentialProviderCredentialEvents) {
      *ppv = this;
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  IFACEMETHODIMP_(ULONG) AddRef() { return 2; }
  IFACEMETHODIMP_(ULONG) Release() { return 1; }
  IFACEMETHODIMP SetFieldState(ICredentialProviderCredential*, DWORD, CREDENTIAL_PROVIDER_FIELD_STATE) { return S_OK; }
  IFACEMETHODIMP SetFieldInteractiveState(ICredentialProviderCredential*, DWORD, CREDENTIAL_PROVIDER_FIELD_INTERACTIVE_STATE) { return S_OK; }
  IFACEMETHODIMP SetFieldString(ICredentialProviderCredential*, DWORD id, LPCWSTR psz) {
    wchar_t prefix[32];
    swprintf_s(prefix, L"  field %lu = ", id);
    PrintW(prefix, psz);
    return S_OK;
  }
  IFACEMETHODIMP SetFieldCheckbox(ICredentialProviderCredential*, DWORD, BOOL, LPCWSTR) { return S_OK; }
  IFACEMETHODIMP SetFieldBitmap(ICredentialProviderCredential*, DWORD, HBITMAP) { return S_OK; }
  IFACEMETHODIMP SetFieldComboBoxSelectedItem(ICredentialProviderCredential*, DWORD, DWORD) { return S_OK; }
  IFACEMETHODIMP DeleteFieldComboBoxItem(ICredentialProviderCredential*, DWORD, DWORD) { return S_OK; }
  IFACEMETHODIMP AppendFieldComboBoxItem(ICredentialProviderCredential*, DWORD, LPCWSTR) { return S_OK; }
  IFACEMETHODIMP SetFieldSubmitButton(ICredentialProviderCredential*, DWORD, DWORD) { return S_OK; }
  IFACEMETHODIMP OnCreatingWindow(HWND* phwndOwner) {
    *phwndOwner = nullptr;
    return S_OK;
  }
};

// サインイン画面のユーザーの一覧（V2 の SetUserArray に渡す）
class FakeUser : public ICredentialProviderUser {
 public:
  explicit FakeUser(const std::wstring& sid) : sid_(sid) {}
  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) {
    if (riid == IID_IUnknown || riid == IID_ICredentialProviderUser) {
      *ppv = this;
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  IFACEMETHODIMP_(ULONG) AddRef() { return 2; }
  IFACEMETHODIMP_(ULONG) Release() { return 1; }
  IFACEMETHODIMP GetSid(LPWSTR* sid) { return SHStrDupW(sid_.c_str(), sid); }
  IFACEMETHODIMP GetProviderID(GUID* id) {
    *id = GUID_NULL;
    return S_OK;
  }
  IFACEMETHODIMP GetStringValue(REFPROPERTYKEY, LPWSTR* value) {
    *value = nullptr;
    return E_NOTIMPL;
  }
  IFACEMETHODIMP GetValue(REFPROPERTYKEY, PROPVARIANT*) { return E_NOTIMPL; }

 private:
  std::wstring sid_;
};

class FakeUserArray : public ICredentialProviderUserArray {
 public:
  std::vector<FakeUser*> users;
  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) {
    if (riid == IID_IUnknown || riid == IID_ICredentialProviderUserArray) {
      *ppv = this;
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  IFACEMETHODIMP_(ULONG) AddRef() { return 2; }
  IFACEMETHODIMP_(ULONG) Release() { return 1; }
  IFACEMETHODIMP SetProviderFilter(REFGUID) { return S_OK; }
  IFACEMETHODIMP GetAccountOptions(CREDENTIAL_PROVIDER_ACCOUNT_OPTIONS* options) {
    *options = CPAO_NONE;
    return S_OK;
  }
  IFACEMETHODIMP GetCount(DWORD* count) {
    *count = (DWORD)users.size();
    return S_OK;
  }
  IFACEMETHODIMP GetAt(DWORD index, ICredentialProviderUser** user) {
    if (index >= users.size()) return E_INVALIDARG;
    *user = users[index];
    return S_OK;
  }
};

// V2: つないだユーザーのタイルにだけ出して、「他のユーザー」用にも 1 つ出す（この PC のレジストリにつないだユーザーがあれば、それを使う）
static void TestUserTiles(IClassFactory* factory) {
  std::vector<skhub::LinkedUser> linked;
  skhub::ListLinkedUsers(linked);
  std::set<std::wstring> linkedSids;
  for (const auto& user : linked) {
    std::wstring sid;
    if (SUCCEEDED(skhub::LinkedUserSid(user, sid))) linkedSids.insert(sid);
  }
  printf("  linked users on this PC: %zu (SIDs found: %zu)\n", linked.size(), linkedSids.size());

  std::vector<FakeUser> users;
  for (const auto& sid : linkedSids) users.emplace_back(sid);
  users.emplace_back(L"S-1-5-21-1-2-3-9999");  // つないでいないユーザー
  FakeUserArray array;
  for (auto& u : users) array.users.push_back(&u);

  ICredentialProvider* provider = nullptr;
  ICredentialProviderSetUserArray* setUsers = nullptr;
  Check(SUCCEEDED(factory->CreateInstance(nullptr, IID_PPV_ARGS(&provider))), "CreateInstance (V2)");
  Check(SUCCEEDED(provider->QueryInterface(IID_PPV_ARGS(&setUsers))), "ICredentialProviderSetUserArray");
  setUsers->SetUserArray(&array);
  setUsers->Release();
  provider->SetUsageScenario(CPUS_LOGON, 0);
  DWORD count = 0, def = 0;
  BOOL autoLogon = FALSE;
  provider->GetCredentialCount(&count, &def, &autoLogon);
  Check(count == linkedSids.size() + 1, "one tile per linked user + other user");
  DWORD again = 0;
  provider->GetCredentialCount(&again, &def, &autoLogon);
  Check(again == count, "tiles are not created twice");
  size_t matched = 0, other = 0;
  for (DWORD i = 0; i < count; i++) {
    ICredentialProviderCredential* cred = nullptr;
    ICredentialProviderCredential2* cred2 = nullptr;
    provider->GetCredentialAt(i, &cred);
    if (!cred || FAILED(cred->QueryInterface(IID_PPV_ARGS(&cred2)))) {
      Check(false, "ICredentialProviderCredential2");
      if (cred) cred->Release();
      continue;
    }
    PWSTR sid = nullptr;
    HRESULT hr = cred2->GetUserSid(&sid);
    if (hr == S_FALSE && !sid) other++;
    else if (hr == S_OK && sid && linkedSids.count(sid)) matched++;
    if (sid) CoTaskMemFree(sid);
    cred2->Release();
    cred->Release();
  }
  Check(matched == linkedSids.size(), "linked users' tiles have their SIDs");
  Check(other == 1, "other user tile returns S_FALSE and no SID");
  provider->Release();
}

// KERB_INTERACTIVE_UNLOCK_LOGON の詰め方（Buffer がバッファの先頭からの位置になっているか）
static void TestPack() {
  BYTE* rgb = nullptr;
  ULONG cb = 0;
  HRESULT hr = PackLogon(CPUS_LOGON, L"MYPC", L"taro", L"secret-password", &rgb, &cb);
  Check(SUCCEEDED(hr) && rgb && cb > sizeof(KERB_INTERACTIVE_UNLOCK_LOGON), "PackLogon");
  if (SUCCEEDED(hr)) {
    auto* k = reinterpret_cast<KERB_INTERACTIVE_UNLOCK_LOGON*>(rgb);
    auto at = [&](const UNICODE_STRING& s) { return std::wstring(reinterpret_cast<wchar_t*>(rgb + (ULONG_PTR)s.Buffer), s.Length / sizeof(wchar_t)); };
    Check(k->Logon.MessageType == KerbInteractiveLogon, "MessageType = KerbInteractiveLogon");
    Check(at(k->Logon.LogonDomainName) == L"MYPC", "domain");
    Check(at(k->Logon.UserName) == L"taro", "user");
    Check(k->Logon.Password.Length > 0 && (ULONG_PTR)k->Logon.Password.Buffer + k->Logon.Password.Length == cb, "password (protected) at the end");
    Check(at(k->Logon.Password) != L"secret-password", "password is CredProtect-ed");
    CoTaskMemFree(rgb);
  }
  hr = PackLogon(CPUS_UNLOCK_WORKSTATION, L"MYPC", L"taro", L"x", &rgb, &cb);
  Check(SUCCEEDED(hr) && reinterpret_cast<KERB_INTERACTIVE_UNLOCK_LOGON*>(rgb)->Logon.MessageType == KerbWorkstationUnlockLogon, "unlock MessageType");
  if (SUCCEEDED(hr)) CoTaskMemFree(rgb);
  ULONG package = 0;
  Check(SUCCEEDED(RetrieveNegotiateAuthPackage(&package)), "Negotiate auth package");
}

// 32 ビットの DIB に描いて BMP に保存する
template <typename PaintFn>
static bool SaveBmp(const std::wstring& path, int width, int height, PaintFn paint) {
  BITMAPINFO bi = {};
  bi.bmiHeader.biSize = sizeof(bi.bmiHeader);
  bi.bmiHeader.biWidth = width;
  bi.bmiHeader.biHeight = -height;
  bi.bmiHeader.biPlanes = 1;
  bi.bmiHeader.biBitCount = 32;
  void* bits = nullptr;
  HDC dc = CreateCompatibleDC(nullptr);
  HBITMAP bmp = CreateDIBSection(dc, &bi, DIB_RGB_COLORS, &bits, nullptr, 0);
  if (!bmp) return false;
  HGDIOBJ old = SelectObject(dc, bmp);
  RECT rc = { 0, 0, width, height };
  paint(dc, rc);
  GdiFlush();
  BITMAPFILEHEADER fh = {};
  fh.bfType = 0x4D42;
  fh.bfOffBits = sizeof(fh) + sizeof(bi.bmiHeader);
  fh.bfSize = fh.bfOffBits + width * height * 4;
  BITMAPINFOHEADER ih = bi.bmiHeader;
  ih.biHeight = height;  // ファイルは下から
  bool ok = false;
  HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, 0, nullptr);
  if (file != INVALID_HANDLE_VALUE) {
    DWORD written;
    ok = WriteFile(file, &fh, sizeof(fh), &written, nullptr) && WriteFile(file, &ih, sizeof(ih), &written, nullptr);
    for (int y = height - 1; ok && y >= 0; y--) ok = WriteFile(file, static_cast<BYTE*>(bits) + y * width * 4, width * 4, &written, nullptr);
    CloseHandle(file);
  }
  SelectObject(dc, old);
  DeleteObject(bmp);
  DeleteDC(dc);
  return ok;
}

static int ExportQr(const std::wstring& dir) {
  // 型番 1（HELLO）・3（いつもの URL）・5・6（ブロックが 2 つ・4 つ）
  struct Sample { const wchar_t* name; std::string text; } samples[] = {
    { L"qr-v1.bmp", "HELLO" },
    { L"qr-url.bmp", "https://sk-hub.jp/pc/?code=ABCD2345" },
    { L"qr-v5.bmp", "https://sk-hub.jp/pc/?code=ABCD2345&padding=0123456789abcdefghijklmnopqrstuvwxyz0123" },
    { L"qr-v6.bmp", std::string(100, 'x') + "END" },
  };
  for (const Sample& s : samples) {
    qr::Code code = qr::Encode(s.text);
    printf("  %ls: size %d (version %d)\n", s.name, code.size, (code.size - 17) / 4);
    Check(code.size > 0 && SaveBmp(dir + L"\\" + s.name, 360, 360, [&](HDC dc, const RECT& rc) { qr::Paint(dc, rc, code); }), "export QR");
  }
  Check(qr::Encode(std::string(200, 'x')).size == 0, "too long text is rejected");
  for (int i = 0; i < 2; i++) {
    QrWindowContent content;
    if (i == 0) {
      content.code = L"ABCD2345";
      content.status = L"スマートフォンで承認されるのを待っています（残り 9:41）";
    }
    SIZE size = QrWindowSize(1.0);
    Check(SaveBmp(dir + (i == 0 ? L"\\qr-window.bmp" : L"\\qr-window-empty.bmp"), size.cx, size.cy,
                  [&](HDC dc, const RECT& rc) { PaintQrWindow(dc, rc, 1.0, content); }),
          "export window");
  }
  printf("%s (%d failures)\n", g_failures ? "FAILED" : "PASSED", g_failures);
  return g_failures ? 1 : 0;
}

int wmain(int argc, wchar_t** argv) {
  if (argc >= 3 && wcscmp(argv[1], L"--qr") == 0) return ExportQr(argv[2]);
  if (argc < 2) {
    printf("usage: harness <dll> [--live] | harness --qr <dir>\n");
    return 2;
  }
  const bool live = argc >= 3 && wcscmp(argv[2], L"--live") == 0;
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);

  TestPack();

  HMODULE dll = LoadLibraryW(argv[1]);
  Check(dll != nullptr, "LoadLibrary");
  if (!dll) return 1;
  auto getClassObject = reinterpret_cast<HRESULT(STDAPICALLTYPE*)(REFCLSID, REFIID, void**)>(GetProcAddress(dll, "DllGetClassObject"));
  auto canUnload = reinterpret_cast<HRESULT(STDAPICALLTYPE*)()>(GetProcAddress(dll, "DllCanUnloadNow"));
  Check(getClassObject && canUnload, "exports");

  IClassFactory* factory = nullptr;
  Check(SUCCEEDED(getClassObject(CLSID_SKHubProvider, IID_PPV_ARGS(&factory))), "DllGetClassObject");
  CLSID other = {};
  void* dummy = nullptr;
  Check(getClassObject(other, IID_IClassFactory, &dummy) == CLASS_E_CLASSNOTAVAILABLE, "other CLSID is rejected");

  TestUserTiles(factory);

  ICredentialProvider* provider = nullptr;
  Check(SUCCEEDED(factory->CreateInstance(nullptr, IID_PPV_ARGS(&provider))), "CreateInstance");
  factory->Release();

  Check(provider->SetUsageScenario(CPUS_CREDUI, 0) == E_NOTIMPL, "CPUS_CREDUI is not supported");
  Check(SUCCEEDED(provider->SetUsageScenario(CPUS_LOGON, 0)), "SetUsageScenario(CPUS_LOGON)");
  FakeProviderEvents providerEvents;
  provider->Advise(&providerEvents, 42);

  DWORD count = 0;
  provider->GetFieldDescriptorCount(&count);
  Check(count == SFI_NUM_FIELDS, "field count");
  for (DWORD i = 0; i < count; i++) {
    CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR* fd = nullptr;
    HRESULT hr = provider->GetFieldDescriptorAt(i, &fd);
    Check(SUCCEEDED(hr) && fd && fd->dwFieldID == i, "GetFieldDescriptorAt");
    if (fd) {
      PrintW(L"  label: ", fd->pszLabel);
      CoTaskMemFree(fd->pszLabel);
      CoTaskMemFree(fd);
    }
  }

  DWORD credCount = 0, def = 0;
  BOOL autoLogon = TRUE;
  provider->GetCredentialCount(&credCount, &def, &autoLogon);
  Check(credCount == 1 && def == CREDENTIAL_PROVIDER_NO_DEFAULT && !autoLogon, "GetCredentialCount (not ready)");

  ICredentialProviderCredential* cred = nullptr;
  Check(SUCCEEDED(provider->GetCredentialAt(0, &cred)), "GetCredentialAt");
  FakeCredentialEvents credEvents;
  cred->Advise(&credEvents);

  for (DWORD i = SFI_TITLE; i < SFI_NUM_FIELDS; i++) {
    PWSTR s = nullptr;
    if (SUCCEEDED(cred->GetStringValue(i, &s))) {
      PrintW(L"  string: ", s);
      CoTaskMemFree(s);
    }
  }
  HBITMAP bmp = nullptr;
  Check(SUCCEEDED(cred->GetBitmapValue(SFI_TILEIMAGE, &bmp)) && bmp, "tile image");
  if (bmp) {
    BITMAP info = {};
    GetObjectW(bmp, sizeof(info), &info);
    printf("  tile image %ldx%ld\n", info.bmWidth, info.bmHeight);
    DeleteObject(bmp);
  }
  DWORD adjacent = 0;
  Check(SUCCEEDED(cred->GetSubmitButtonValue(SFI_SUBMIT, &adjacent)) && adjacent == SFI_CODE, "submit button");

  CREDENTIAL_PROVIDER_GET_SERIALIZATION_RESPONSE response;
  CREDENTIAL_PROVIDER_CREDENTIAL_SERIALIZATION serialization;
  PWSTR status = nullptr;
  CREDENTIAL_PROVIDER_STATUS_ICON icon;
  Check(SUCCEEDED(cred->GetSerialization(&response, &serialization, &status, &icon)) && response == CPGSR_NO_CREDENTIAL_NOT_FINISHED,
        "GetSerialization before approval does not log on");
  if (status) {
    PrintW(L"  status: ", status);
    CoTaskMemFree(status);
  }

  if (live) {
    // タイルを選んで、承認されるまで（最大 10 分）メッセージを回す
    BOOL autoLogonSelected = TRUE;
    cred->SetSelected(&autoLogonSelected);
    // QR コードのウィンドウも開く（画面のQRをスマートフォンで読み取って確かめられる）
    Check(SUCCEEDED(cred->CommandLinkClicked(SFI_QR)), "open QR window");
    printf("waiting... (approve at https://sk-hub.jp/pc/ , Ctrl+C to stop)\n");
    ULONGLONG until = GetTickCount64() + 11 * 60 * 1000;
    while (GetTickCount64() < until && providerEvents.changed == 0) {
      MSG msg;
      while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) DispatchMessageW(&msg);
      MsgWaitForMultipleObjects(0, nullptr, FALSE, 200, QS_ALLINPUT);
    }
    provider->GetCredentialCount(&credCount, &def, &autoLogon);
    Check(def == 0 && autoLogon, "GetCredentialCount asks for auto logon after approval");
    Check(SUCCEEDED(cred->GetSerialization(&response, &serialization, &status, &icon)) && response == CPGSR_RETURN_CREDENTIAL_FINISHED,
          "GetSerialization after approval");
    if (serialization.rgbSerialization) {
      SecureZeroMemory(serialization.rgbSerialization, serialization.cbSerialization);
      CoTaskMemFree(serialization.rgbSerialization);
    }
    cred->SetDeselected();
  }

  cred->UnAdvise();
  cred->Release();
  provider->UnAdvise();
  provider->Release();
  Check(canUnload() == S_OK, "DllCanUnloadNow after release");
  FreeLibrary(dll);
  CoUninitialize();
  printf("%s (%d failures)\n", g_failures ? "FAILED" : "PASSED", g_failures);
  return g_failures ? 1 : 0;
}
