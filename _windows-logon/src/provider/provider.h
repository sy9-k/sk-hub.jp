// SK Hub の Credential Provider（V2）
//   サインイン画面のユーザーの一覧（SetUserArray）のうち、SK Hub Systems アカウントをつないだユーザーのタイルに
//   「SK Hub でサインイン」を出し、「他のユーザー」用にも 1 つ出す。
//   使うのはサインイン（CPUS_LOGON）とロックの解除（CPUS_UNLOCK_WORKSTATION）だけ
#pragma once

#include <string>
#include <vector>

#include "common.h"

class CCredential;

class CProvider : public ICredentialProvider, public ICredentialProviderSetUserArray {
 public:
  CProvider();

  // タイルで承認が済んだ（自動でサインインしてもらう）
  void OnCredentialReady();

  // IUnknown
  IFACEMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&_cRef); }
  IFACEMETHODIMP_(ULONG) Release() {
    LONG cRef = InterlockedDecrement(&_cRef);
    if (!cRef) delete this;
    return cRef;
  }
  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv);

  // ICredentialProvider
  IFACEMETHODIMP SetUsageScenario(CREDENTIAL_PROVIDER_USAGE_SCENARIO cpus, DWORD dwFlags);
  IFACEMETHODIMP SetSerialization(const CREDENTIAL_PROVIDER_CREDENTIAL_SERIALIZATION* pcpcs);
  IFACEMETHODIMP Advise(ICredentialProviderEvents* pcpe, UINT_PTR upAdviseContext);
  IFACEMETHODIMP UnAdvise();
  IFACEMETHODIMP GetFieldDescriptorCount(DWORD* pdwCount);
  IFACEMETHODIMP GetFieldDescriptorAt(DWORD dwIndex, CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR** ppcpfd);
  IFACEMETHODIMP GetCredentialCount(DWORD* pdwCount, DWORD* pdwDefault, BOOL* pbAutoLogonWithDefault);
  IFACEMETHODIMP GetCredentialAt(DWORD dwIndex, ICredentialProviderCredential** ppcpc);

  // ICredentialProviderSetUserArray（GetCredentialCount より先に呼ばれる）
  IFACEMETHODIMP SetUserArray(ICredentialProviderUserArray* users);

 private:
  ~CProvider();
  void EnsureCredentials();
  void AddCredential(const std::wstring& sid);
  void ReleaseCredentials();

  LONG _cRef;
  CREDENTIAL_PROVIDER_USAGE_SCENARIO _cpus;
  ICredentialProviderUserArray* _users;
  std::vector<CCredential*> _credentials;
  bool _enumerated;
  ICredentialProviderEvents* _events;
  UINT_PTR _adviseContext;
};

HRESULT CProvider_CreateInstance(REFIID riid, void** ppv);
