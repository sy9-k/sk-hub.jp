// サインイン画面に入れる前の確かめ（LogonUI の代わりに DLL を読み込んで呼ぶ）
//   harness <DLL のパス>          通信しない確かめ（項目・タイルの画像・承認前の GetSerialization・KERB の詰め方）
//   harness <DLL のパス> --live   タイルを選んだときの流れ（本番の Firebase に匿名ログインし、コードを発行する。管理者として実行）
#include <cstdio>
#include <string>

#include "../provider/common.h"
#include "../provider/helpers.h"

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

int wmain(int argc, wchar_t** argv) {
  if (argc < 2) {
    printf("usage: harness <dll> [--live]\n");
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
