#include "credential.h"

#include "../common/skhub.h"
#include "helpers.h"
#include "provider.h"
#include "qrwindow.h"
#include "resource.h"

namespace {

const wchar_t kWindowClass[] = L"SKHubCredentialWindow";
const UINT WM_SKHUB_UPDATE = WM_APP + 1;  // wParam = Flow の id

// ---------- 承認を待つスレッド ----------

void Notify(Flow& f) {
  PostMessageW(f.hwnd, WM_SKHUB_UPDATE, f.id, 0);
}

void Update(Flow& f, const std::wstring* code, const std::wstring& status) {
  AcquireSRWLockExclusive(&f.lock);
  if (code) f.code = *code;
  f.status = status;
  ReleaseSRWLockExclusive(&f.lock);
  Notify(f);
}

bool Stopped(Flow& f, DWORD waitMs = 0) {
  return WaitForSingleObject(f.stop, waitMs) == WAIT_OBJECT_0;
}

std::wstring Waiting(ULONGLONG deadline) {
  ULONGLONG now = GetTickCount64();
  ULONGLONG left = deadline > now ? (deadline - now + 999) / 1000 : 0;
  wchar_t buf[128];
  StringCchPrintfW(buf, ARRAYSIZE(buf), L"スマートフォンで承認されるのを待っています（残り %llu:%02llu）", left / 60, left % 60);
  return buf;
}

void RunFlow(Flow& f) {
  skhub::DeviceToken token;
  std::wstring code, error;
  const std::wstring none;
  Update(f, &none, L"コードを用意しています…");
  if (FAILED(skhub::CreateRequest(token, skhub::Purpose::SignIn, code, error))) {
    Update(f, nullptr, error + L"。「新しいコードを表示」でやり直せます。");
    return;
  }
  const ULONGLONG deadline = GetTickCount64() + SKHUB_CODE_TTL_SECONDS * 1000ULL;
  Update(f, &code, Waiting(deadline));

  int failures = 0;
  while (!Stopped(f, 2000)) {
    if (GetTickCount64() >= deadline) {
      Update(f, &none, L"コードの有効期限が切れました。「新しいコードを表示」を押してください。");
      break;
    }
    skhub::RequestState state;
    std::wstring uid;
    if (FAILED(skhub::CheckRequest(token, code, state, uid, error))) {
      // 少しのあいだの通信の失敗は待つ
      if (++failures >= 5) {
        Update(f, nullptr, error + L"。「新しいコードを表示」でやり直せます。");
        break;
      }
      continue;
    }
    failures = 0;
    if (state == skhub::RequestState::Pending) {
      Update(f, nullptr, Waiting(deadline));
      continue;
    }
    if (state == skhub::RequestState::Denied) {
      Update(f, &none, L"スマートフォンで拒否されました。サインインする場合は「新しいコードを表示」を押してください。");
      break;
    }
    if (state != skhub::RequestState::Approved) {
      Update(f, &none, L"コードが見つかりませんでした。「新しいコードを表示」を押してください。");
      break;
    }
    skhub::LinkedUser user;
    if (FAILED(skhub::FindLinkedUser(uid, user))) {
      Update(f, &none, L"承認したアカウントは、この PC につながっていません。PC の管理者が設定ツールでつないでください。");
      break;
    }
    std::wstring password;
    if (FAILED(skhub::ReadLinkedPassword(uid, password))) {
      Update(f, &none, L"Windows のパスワードを読み出せませんでした。設定ツールでつなぎ直してください。");
      break;
    }
    AcquireSRWLockExclusive(&f.lock);
    f.user = user.userName;
    f.domain = user.domain;
    f.password = password;
    f.ready = true;
    f.status = L"サインインしています…";
    ReleaseSRWLockExclusive(&f.lock);
    skhub::Wipe(password);
    Notify(f);
    break;
  }
  // 依頼は使い終わったらすぐ消す
  skhub::DeleteRequest(token, code);
}

struct ThreadArgs {
  std::shared_ptr<Flow> flow;
  HMODULE module;
};

DWORD WINAPI FlowThread(LPVOID param) {
  auto* args = static_cast<ThreadArgs*>(param);
  HMODULE module = args->module;
  RunFlow(*args->flow);
  delete args;
  // 待っているあいだに DLL が外されないよう、スレッドが DLL を持っておき、最後に放す
  FreeLibraryAndExitThread(module, 0);
}

}  // namespace

Flow::~Flow() {
  if (stop) CloseHandle(stop);
  skhub::Wipe(password);
}

CCredential::CCredential()
    : _cRef(1), _cpus(CPUS_INVALID), _provider(nullptr), _events(nullptr), _hwnd(nullptr), _qrWnd(nullptr), _nextFlowId(1), _ready(false) {
  DllAddRef();
}

CCredential::~CCredential() {
  CloseQrWindow();
  UnregisterQrWindowClass(g_hinst);
  StopFlow();
  ClearSecret();
  if (_events) _events->Release();
  if (_hwnd) {
    DestroyWindow(_hwnd);
    UnregisterClassW(kWindowClass, g_hinst);
  }
  DllRelease();
}

HRESULT CCredential::Initialize(CREDENTIAL_PROVIDER_USAGE_SCENARIO cpus, CProvider* provider) {
  _cpus = cpus;
  _provider = provider;
  _text[SFI_TITLE] = L"SK Hub でサインイン";
  _text[SFI_INSTRUCTION] = L"スマートフォンなどで " SKHUB_APPROVE_URL L" を開き、SK Hub Systems アカウントでログインして、次のコードを入力してください。「QR コードで承認」から読み取ることもできます。";
  _text[SFI_QR] = L"QR コードで承認";
  _text[SFI_NEWCODE] = L"新しいコードを表示";
  _text[SFI_SUBMIT] = L"サインイン";
  return S_OK;
}

IFACEMETHODIMP CCredential::QueryInterface(REFIID riid, void** ppv) {
  if (!ppv) return E_POINTER;
  if (riid == IID_IUnknown || riid == IID_ICredentialProviderCredential) {
    *ppv = static_cast<ICredentialProviderCredential*>(this);
    AddRef();
    return S_OK;
  }
  *ppv = nullptr;
  return E_NOINTERFACE;
}

// ---------- 知らせを受けるウィンドウ（UI のスレッド） ----------

LRESULT CALLBACK CCredential::WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  if (msg == WM_SKHUB_UPDATE) {
    auto* self = reinterpret_cast<CCredential*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
    if (self) self->OnFlowUpdate((UINT)wParam);
    return 0;
  }
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}

void CCredential::EnsureWindow() {
  if (_hwnd) return;
  WNDCLASSEXW wc = { sizeof(wc) };
  wc.lpfnWndProc = WndProc;
  wc.hInstance = g_hinst;
  wc.lpszClassName = kWindowClass;
  if (!RegisterClassExW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return;
  _hwnd = CreateWindowExW(0, kWindowClass, L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, g_hinst, nullptr);
  if (_hwnd) SetWindowLongPtrW(_hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(this));
}

void CCredential::StartFlow() {
  EnsureWindow();
  if (!_hwnd) {
    SetText(SFI_STATUS, L"準備できませんでした。もう一度タイルを選んでください。");
    return;
  }
  auto flow = std::make_shared<Flow>();
  flow->id = _nextFlowId++;
  flow->hwnd = _hwnd;
  flow->stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  HMODULE module = nullptr;
  if (!flow->stop || !GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS, reinterpret_cast<LPCWSTR>(&FlowThread), &module)) {
    SetText(SFI_STATUS, L"準備できませんでした。もう一度タイルを選んでください。");
    return;
  }
  auto* args = new ThreadArgs{ flow, module };
  HANDLE thread = CreateThread(nullptr, 0, FlowThread, args, 0, nullptr);
  if (!thread) {
    delete args;
    FreeLibrary(module);
    SetText(SFI_STATUS, L"準備できませんでした。もう一度タイルを選んでください。");
    return;
  }
  CloseHandle(thread);
  _flow = flow;
}

// スレッドは待たない（通信の途中なら、終わってから自分で依頼を消して抜ける）
void CCredential::StopFlow() {
  if (!_flow) return;
  SetEvent(_flow->stop);
  _flow.reset();
}

void CCredential::OnFlowUpdate(UINT id) {
  if (!_flow || _flow->id != id) return;  // 止めたあとの知らせ
  std::wstring code, status;
  bool ready = false;
  AcquireSRWLockExclusive(&_flow->lock);
  code = _flow->code;
  status = _flow->status;
  if (_flow->ready) {
    ready = true;
    _flow->ready = false;
    _user = _flow->user;
    _domain = _flow->domain;
    _password = _flow->password;
    skhub::Wipe(_flow->password);
  }
  ReleaseSRWLockExclusive(&_flow->lock);
  _code = code;
  SetText(SFI_CODE, code.empty() ? L"" : skhub::FormatCode(code));
  SetText(SFI_STATUS, status);
  UpdateQr();
  if (ready) {
    // QR コードのウィンドウを閉じてから、サインインしてもらう
    CloseQrWindow();
    _ready = true;
    if (_provider) _provider->OnCredentialReady();
  }
}

// ---------- QR コードのウィンドウ ----------

void CCredential::OpenQrWindow() {
  if (_qrWnd) {
    SetForegroundWindow(_qrWnd);
    return;
  }
  // サインイン画面の上に出すための親（LogonUI のウィンドウ）
  HWND owner = nullptr;
  if (_events) _events->OnCreatingWindow(&owner);
  _qrWnd = CreateQrWindow(g_hinst, owner, &CCredential::OnQrWindowClosed, this);
  UpdateQr();
}

void CCredential::CloseQrWindow() {
  if (_qrWnd) DestroyWindow(_qrWnd);  // OnQrWindowClosed で _qrWnd が空になる
  _qrWnd = nullptr;
}

void CCredential::UpdateQr() {
  if (_qrWnd) UpdateQrWindow(_qrWnd, { _code, _text[SFI_STATUS] });
}

void CCredential::OnQrWindowClosed(void* context) {
  static_cast<CCredential*>(context)->_qrWnd = nullptr;
}

void CCredential::SetText(FIELD_ID id, const std::wstring& text) {
  _text[id] = text;
  if (_events) _events->SetFieldString(this, id, _text[id].c_str());
}

void CCredential::ClearSecret() {
  _ready = false;
  _user.clear();
  _domain.clear();
  skhub::Wipe(_password);
}

// ---------- ICredentialProviderCredential ----------

IFACEMETHODIMP CCredential::Advise(ICredentialProviderCredentialEvents* pcpce) {
  if (_events) _events->Release();
  _events = nullptr;
  return pcpce ? pcpce->QueryInterface(IID_PPV_ARGS(&_events)) : E_INVALIDARG;
}

IFACEMETHODIMP CCredential::UnAdvise() {
  if (_events) _events->Release();
  _events = nullptr;
  return S_OK;
}

IFACEMETHODIMP CCredential::SetSelected(BOOL* pbAutoLogon) {
  *pbAutoLogon = FALSE;
  if (!_ready && !_flow) StartFlow();
  return S_OK;
}

IFACEMETHODIMP CCredential::SetDeselected() {
  CloseQrWindow();
  StopFlow();
  ClearSecret();
  _code.clear();
  SetText(SFI_CODE, L"");
  SetText(SFI_STATUS, L"");
  return S_OK;
}

IFACEMETHODIMP CCredential::GetFieldState(DWORD dwFieldID, CREDENTIAL_PROVIDER_FIELD_STATE* pcpfs, CREDENTIAL_PROVIDER_FIELD_INTERACTIVE_STATE* pcpfis) {
  if (dwFieldID >= SFI_NUM_FIELDS || !pcpfs || !pcpfis) return E_INVALIDARG;
  *pcpfs = s_rgFieldStatePairs[dwFieldID].cpfs;
  *pcpfis = s_rgFieldStatePairs[dwFieldID].cpfis;
  return S_OK;
}

IFACEMETHODIMP CCredential::GetStringValue(DWORD dwFieldID, PWSTR* ppwsz) {
  *ppwsz = nullptr;
  if (dwFieldID >= SFI_NUM_FIELDS || dwFieldID == SFI_TILEIMAGE) return E_INVALIDARG;
  return SHStrDupW(_text[dwFieldID].c_str(), ppwsz);
}

IFACEMETHODIMP CCredential::GetBitmapValue(DWORD dwFieldID, HBITMAP* phbmp) {
  *phbmp = nullptr;
  if (dwFieldID != SFI_TILEIMAGE) return E_INVALIDARG;
  HBITMAP bmp = LoadBitmapW(g_hinst, MAKEINTRESOURCEW(IDB_TILE_IMAGE));
  if (!bmp) return HRESULT_FROM_WIN32(GetLastError());
  *phbmp = bmp;
  return S_OK;
}

IFACEMETHODIMP CCredential::GetCheckboxValue(DWORD, BOOL*, PWSTR*) { return E_INVALIDARG; }

IFACEMETHODIMP CCredential::GetSubmitButtonValue(DWORD dwFieldID, DWORD* pdwAdjacentTo) {
  if (dwFieldID != SFI_SUBMIT) return E_INVALIDARG;
  *pdwAdjacentTo = SFI_CODE;
  return S_OK;
}

IFACEMETHODIMP CCredential::GetComboBoxValueCount(DWORD, DWORD*, DWORD*) { return E_INVALIDARG; }
IFACEMETHODIMP CCredential::GetComboBoxValueAt(DWORD, DWORD, PWSTR*) { return E_INVALIDARG; }
IFACEMETHODIMP CCredential::SetStringValue(DWORD, PCWSTR) { return E_INVALIDARG; }
IFACEMETHODIMP CCredential::SetCheckboxValue(DWORD, BOOL) { return E_INVALIDARG; }
IFACEMETHODIMP CCredential::SetComboBoxSelectedValue(DWORD, DWORD) { return E_INVALIDARG; }

IFACEMETHODIMP CCredential::CommandLinkClicked(DWORD dwFieldID) {
  if (dwFieldID == SFI_QR) {
    if (!_ready && !_flow) StartFlow();
    OpenQrWindow();
    return S_OK;
  }
  if (dwFieldID != SFI_NEWCODE) return E_INVALIDARG;
  // QR コードのウィンドウが開いていれば、新しいコードに描き変わる
  StopFlow();
  ClearSecret();
  _code.clear();
  StartFlow();
  return S_OK;
}

IFACEMETHODIMP CCredential::GetSerialization(CREDENTIAL_PROVIDER_GET_SERIALIZATION_RESPONSE* pcpgsr, CREDENTIAL_PROVIDER_CREDENTIAL_SERIALIZATION* pcpcs,
                                             PWSTR* ppwszOptionalStatusText, CREDENTIAL_PROVIDER_STATUS_ICON* pcpsiOptionalStatusIcon) {
  *pcpgsr = CPGSR_NO_CREDENTIAL_NOT_FINISHED;
  *ppwszOptionalStatusText = nullptr;
  *pcpsiOptionalStatusIcon = CPSI_NONE;
  ZeroMemory(pcpcs, sizeof(*pcpcs));

  if (!_ready) {
    SHStrDupW(L"スマートフォンで承認すると、自動でサインインします。", ppwszOptionalStatusText);
    *pcpsiOptionalStatusIcon = CPSI_WARNING;
    return S_OK;
  }

  // ドメインがなければこの PC のユーザー
  std::wstring domain = _domain.empty() || _domain == L"." ? skhub::ComputerName() : _domain;
  ULONG authPackage = 0;
  HRESULT hr = RetrieveNegotiateAuthPackage(&authPackage);
  if (SUCCEEDED(hr)) hr = PackLogon(_cpus, domain.c_str(), _user.c_str(), _password.c_str(), &pcpcs->rgbSerialization, &pcpcs->cbSerialization);
  // パスワードは 1 回だけ使う（失敗したら、新しいコードで承認し直す）
  ClearSecret();
  if (FAILED(hr)) {
    SHStrDupW(L"サインインの準備ができませんでした。「新しいコードを表示」でやり直してください。", ppwszOptionalStatusText);
    *pcpsiOptionalStatusIcon = CPSI_ERROR;
    return hr;
  }
  pcpcs->ulAuthenticationPackage = authPackage;
  pcpcs->clsidCredentialProvider = CLSID_SKHubProvider;
  *pcpgsr = CPGSR_RETURN_CREDENTIAL_FINISHED;
  return S_OK;
}

IFACEMETHODIMP CCredential::ReportResult(NTSTATUS ntsStatus, NTSTATUS ntsSubstatus, PWSTR* ppwszOptionalStatusText,
                                         CREDENTIAL_PROVIDER_STATUS_ICON* pcpsiOptionalStatusIcon) {
  *ppwszOptionalStatusText = nullptr;
  *pcpsiOptionalStatusIcon = CPSI_NONE;
  if (ntsStatus == STATUS_SUCCESS) return S_OK;

  wchar_t text[256];
  if (ntsStatus == STATUS_LOGON_FAILURE && ntsSubstatus != STATUS_ACCOUNT_RESTRICTION) {
    StringCchCopyW(text, ARRAYSIZE(text), L"Windows のパスワードが変わったため、サインインできませんでした。設定ツールでつなぎ直してください。");
  } else if (ntsStatus == STATUS_PASSWORD_EXPIRED || ntsStatus == STATUS_PASSWORD_MUST_CHANGE
             || ntsSubstatus == STATUS_PASSWORD_EXPIRED || ntsSubstatus == STATUS_PASSWORD_MUST_CHANGE) {
    StringCchCopyW(text, ARRAYSIZE(text), L"Windows のパスワードの期限が切れています。パスワードでサインインして変えてから、設定ツールでつなぎ直してください。");
  } else {
    StringCchPrintfW(text, ARRAYSIZE(text), L"サインインできませんでした（0x%08X）。", (unsigned)ntsStatus);
  }
  SetText(SFI_CODE, L"");
  SetText(SFI_STATUS, text);
  SHStrDupW(text, ppwszOptionalStatusText);
  *pcpsiOptionalStatusIcon = CPSI_ERROR;
  return S_OK;
}
