#include "provider.h"

#include <new>
#include <set>

#include "../common/skhub.h"
#include "credential.h"
#include "helpers.h"

CProvider::CProvider()
    : _cRef(1), _cpus(CPUS_INVALID), _users(nullptr), _enumerated(false), _events(nullptr), _adviseContext(0) {
  DllAddRef();
}

CProvider::~CProvider() {
  ReleaseCredentials();
  if (_users) _users->Release();
  if (_events) _events->Release();
  DllRelease();
}

IFACEMETHODIMP CProvider::QueryInterface(REFIID riid, void** ppv) {
  if (!ppv) return E_POINTER;
  if (riid == IID_IUnknown || riid == IID_ICredentialProvider) {
    *ppv = static_cast<ICredentialProvider*>(this);
  } else if (riid == IID_ICredentialProviderSetUserArray) {
    *ppv = static_cast<ICredentialProviderSetUserArray*>(this);
  } else {
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  AddRef();
  return S_OK;
}

void CProvider::OnCredentialReady() {
  // GetCredentialCount を呼び直してもらい、自動でサインインする
  if (_events) _events->CredentialsChanged(_adviseContext);
}

IFACEMETHODIMP CProvider::SetUsageScenario(CREDENTIAL_PROVIDER_USAGE_SCENARIO cpus, DWORD) {
  switch (cpus) {
    case CPUS_LOGON:
    case CPUS_UNLOCK_WORKSTATION:
      _cpus = cpus;
      return S_OK;
    case CPUS_CHANGE_PASSWORD:
    case CPUS_CREDUI:
      return E_NOTIMPL;
    default:
      return E_INVALIDARG;
  }
}

IFACEMETHODIMP CProvider::SetSerialization(const CREDENTIAL_PROVIDER_CREDENTIAL_SERIALIZATION*) {
  return E_NOTIMPL;
}

IFACEMETHODIMP CProvider::SetUserArray(ICredentialProviderUserArray* users) {
  if (_users) _users->Release();
  _users = users;
  if (_users) _users->AddRef();
  return S_OK;
}

void CProvider::AddCredential(const std::wstring& sid) {
  auto* credential = new (std::nothrow) CCredential();
  if (!credential) return;
  if (FAILED(credential->Initialize(_cpus, this, sid))) {
    credential->Release();
    return;
  }
  _credentials.push_back(credential);
}

// タイルを作る（1 回だけ。CredentialsChanged のあとで作り直すと、承認を待っている流れが消えてしまう）
void CProvider::EnsureCredentials() {
  if (_enumerated || _cpus == CPUS_INVALID) return;
  _enumerated = true;
  if (_users) {
    // つないだ Windows のユーザーの SID（同じユーザーに複数のアカウントをつないでいても 1 つ）
    std::vector<skhub::LinkedUser> linked;
    skhub::ListLinkedUsers(linked);
    std::set<std::wstring> sids;
    for (const skhub::LinkedUser& user : linked) {
      std::wstring sid;
      if (SUCCEEDED(skhub::LinkedUserSid(user, sid))) {
        CharUpperW(&sid[0]);
        sids.insert(sid);
      }
    }
    DWORD count = 0;
    if (!sids.empty() && SUCCEEDED(_users->GetCount(&count))) {
      for (DWORD i = 0; i < count; i++) {
        ICredentialProviderUser* user = nullptr;
        if (FAILED(_users->GetAt(i, &user))) continue;
        PWSTR sid = nullptr;
        if (SUCCEEDED(user->GetSid(&sid)) && sid) {
          std::wstring key = sid;
          CharUpperW(&key[0]);
          if (sids.count(key)) AddCredential(sid);
          CoTaskMemFree(sid);
        }
        user->Release();
      }
    }
  }
  // 「他のユーザー」（承認したアカウントにつないだユーザーでサインインする）
  AddCredential(L"");
}

void CProvider::ReleaseCredentials() {
  for (CCredential* credential : _credentials) {
    credential->DetachProvider();
    credential->Release();
  }
  _credentials.clear();
}

IFACEMETHODIMP CProvider::Advise(ICredentialProviderEvents* pcpe, UINT_PTR upAdviseContext) {
  if (_events) _events->Release();
  _events = pcpe;
  if (_events) _events->AddRef();
  _adviseContext = upAdviseContext;
  return S_OK;
}

IFACEMETHODIMP CProvider::UnAdvise() {
  if (_events) _events->Release();
  _events = nullptr;
  _adviseContext = 0;
  return S_OK;
}

IFACEMETHODIMP CProvider::GetFieldDescriptorCount(DWORD* pdwCount) {
  *pdwCount = SFI_NUM_FIELDS;
  return S_OK;
}

IFACEMETHODIMP CProvider::GetFieldDescriptorAt(DWORD dwIndex, CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR** ppcpfd) {
  if (!ppcpfd) return E_INVALIDARG;
  *ppcpfd = nullptr;
  if (dwIndex >= SFI_NUM_FIELDS) return E_INVALIDARG;
  return FieldDescriptorCoAllocCopy(s_rgFieldDescriptors[dwIndex], ppcpfd);
}

IFACEMETHODIMP CProvider::GetCredentialCount(DWORD* pdwCount, DWORD* pdwDefault, BOOL* pbAutoLogonWithDefault) {
  EnsureCredentials();
  *pdwCount = (DWORD)_credentials.size();
  *pdwDefault = CREDENTIAL_PROVIDER_NO_DEFAULT;
  *pbAutoLogonWithDefault = FALSE;
  // 承認が済んだタイルで、自動でサインインする
  for (DWORD i = 0; i < _credentials.size(); i++) {
    if (_credentials[i]->IsReady()) {
      *pdwDefault = i;
      *pbAutoLogonWithDefault = TRUE;
      break;
    }
  }
  return S_OK;
}

IFACEMETHODIMP CProvider::GetCredentialAt(DWORD dwIndex, ICredentialProviderCredential** ppcpc) {
  if (!ppcpc) return E_INVALIDARG;
  *ppcpc = nullptr;
  if (dwIndex >= _credentials.size()) return E_INVALIDARG;
  return _credentials[dwIndex]->QueryInterface(IID_PPV_ARGS(ppcpc));
}

HRESULT CProvider_CreateInstance(REFIID riid, void** ppv) {
  auto* provider = new (std::nothrow) CProvider();
  if (!provider) return E_OUTOFMEMORY;
  HRESULT hr = provider->QueryInterface(riid, ppv);
  provider->Release();
  return hr;
}
