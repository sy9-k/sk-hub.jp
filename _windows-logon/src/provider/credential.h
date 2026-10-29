// 「SK Hub でサインイン」のタイル
//   選ぶと、別のスレッドでコードを発行し（Firestore の windowsLogons/{コード}）、スマートフォンで承認されるのを待つ。
//   承認されたら、つないだ Windows のユーザーとパスワードを読み出し、プロバイダーに知らせて自動でサインインする。
//   別のスレッドからは画面を直接さわらず、UI のスレッドに作ったメッセージ用のウィンドウに知らせる
#pragma once

#include <memory>
#include <string>

#include "common.h"

class CProvider;

// 承認を待つスレッドと、タイルのあいだで共有するもの（lock で守る）
struct Flow {
  UINT id = 0;
  HANDLE stop = nullptr;  // 止めるときにセットする
  HWND hwnd = nullptr;    // 知らせる先
  SRWLOCK lock = SRWLOCK_INIT;
  std::wstring code;
  std::wstring status;
  bool ready = false;
  std::wstring user, domain, password;
  ~Flow();
};

class CCredential : public ICredentialProviderCredential {
 public:
  CCredential();

  HRESULT Initialize(CREDENTIAL_PROVIDER_USAGE_SCENARIO cpus, CProvider* provider);
  // プロバイダーが先に消えるとき
  void DetachProvider() { _provider = nullptr; }
  bool IsReady() const { return _ready; }

  // IUnknown
  IFACEMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&_cRef); }
  IFACEMETHODIMP_(ULONG) Release() {
    LONG cRef = InterlockedDecrement(&_cRef);
    if (!cRef) delete this;
    return cRef;
  }
  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv);

  // ICredentialProviderCredential
  IFACEMETHODIMP Advise(ICredentialProviderCredentialEvents* pcpce);
  IFACEMETHODIMP UnAdvise();
  IFACEMETHODIMP SetSelected(BOOL* pbAutoLogon);
  IFACEMETHODIMP SetDeselected();
  IFACEMETHODIMP GetFieldState(DWORD dwFieldID, CREDENTIAL_PROVIDER_FIELD_STATE* pcpfs, CREDENTIAL_PROVIDER_FIELD_INTERACTIVE_STATE* pcpfis);
  IFACEMETHODIMP GetStringValue(DWORD dwFieldID, PWSTR* ppwsz);
  IFACEMETHODIMP GetBitmapValue(DWORD dwFieldID, HBITMAP* phbmp);
  IFACEMETHODIMP GetCheckboxValue(DWORD dwFieldID, BOOL* pbChecked, PWSTR* ppwszLabel);
  IFACEMETHODIMP GetSubmitButtonValue(DWORD dwFieldID, DWORD* pdwAdjacentTo);
  IFACEMETHODIMP GetComboBoxValueCount(DWORD dwFieldID, DWORD* pcItems, DWORD* pdwSelectedItem);
  IFACEMETHODIMP GetComboBoxValueAt(DWORD dwFieldID, DWORD dwItem, PWSTR* ppwszItem);
  IFACEMETHODIMP SetStringValue(DWORD dwFieldID, PCWSTR pwz);
  IFACEMETHODIMP SetCheckboxValue(DWORD dwFieldID, BOOL bChecked);
  IFACEMETHODIMP SetComboBoxSelectedValue(DWORD dwFieldID, DWORD dwSelectedItem);
  IFACEMETHODIMP CommandLinkClicked(DWORD dwFieldID);
  IFACEMETHODIMP GetSerialization(CREDENTIAL_PROVIDER_GET_SERIALIZATION_RESPONSE* pcpgsr, CREDENTIAL_PROVIDER_CREDENTIAL_SERIALIZATION* pcpcs,
                                  PWSTR* ppwszOptionalStatusText, CREDENTIAL_PROVIDER_STATUS_ICON* pcpsiOptionalStatusIcon);
  IFACEMETHODIMP ReportResult(NTSTATUS ntsStatus, NTSTATUS ntsSubstatus, PWSTR* ppwszOptionalStatusText,
                              CREDENTIAL_PROVIDER_STATUS_ICON* pcpsiOptionalStatusIcon);

 private:
  ~CCredential();
  static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam);
  void EnsureWindow();
  void StartFlow();
  void StopFlow();
  void OnFlowUpdate(UINT id);
  void SetText(FIELD_ID id, const std::wstring& text);
  void ClearSecret();
  void OpenQrWindow();
  void CloseQrWindow();
  void UpdateQr();
  static void OnQrWindowClosed(void* context);

  LONG _cRef;
  CREDENTIAL_PROVIDER_USAGE_SCENARIO _cpus;
  CProvider* _provider;
  ICredentialProviderCredentialEvents* _events;
  std::wstring _text[SFI_NUM_FIELDS];
  HWND _hwnd;
  HWND _qrWnd;        // QR コードのウィンドウ（開いているときだけ）
  std::wstring _code;  // いまのコード（8 文字。ハイフンなし）
  std::shared_ptr<Flow> _flow;
  UINT _nextFlowId;
  bool _ready;
  std::wstring _user, _domain, _password;
};
