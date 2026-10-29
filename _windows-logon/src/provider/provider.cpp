#include "provider.h"

#include <new>

#include "credential.h"
#include "helpers.h"

CProvider::CProvider() : _cRef(1), _credential(nullptr), _events(nullptr), _adviseContext(0) {
  DllAddRef();
}

CProvider::~CProvider() {
  if (_credential) {
    _credential->DetachProvider();
    _credential->Release();
  }
  if (_events) _events->Release();
  DllRelease();
}

IFACEMETHODIMP CProvider::QueryInterface(REFIID riid, void** ppv) {
  if (!ppv) return E_POINTER;
  if (riid == IID_IUnknown || riid == IID_ICredentialProvider) {
    *ppv = static_cast<ICredentialProvider*>(this);
    AddRef();
    return S_OK;
  }
  *ppv = nullptr;
  return E_NOINTERFACE;
}

void CProvider::OnCredentialReady() {
  // GetCredentialCount を呼び直してもらい、自動でサインインする
  if (_events) _events->CredentialsChanged(_adviseContext);
}

IFACEMETHODIMP CProvider::SetUsageScenario(CREDENTIAL_PROVIDER_USAGE_SCENARIO cpus, DWORD) {
  switch (cpus) {
    case CPUS_LOGON:
    case CPUS_UNLOCK_WORKSTATION:
      if (!_credential) {
        _credential = new (std::nothrow) CCredential();
        if (!_credential) return E_OUTOFMEMORY;
        HRESULT hr = _credential->Initialize(cpus, this);
        if (FAILED(hr)) {
          _credential->Release();
          _credential = nullptr;
          return hr;
        }
      }
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
  *pdwCount = _credential ? 1 : 0;
  *pdwDefault = CREDENTIAL_PROVIDER_NO_DEFAULT;
  *pbAutoLogonWithDefault = FALSE;
  // 承認が済んでいれば、このタイルで自動でサインインする
  if (_credential && _credential->IsReady()) {
    *pdwDefault = 0;
    *pbAutoLogonWithDefault = TRUE;
  }
  return S_OK;
}

IFACEMETHODIMP CProvider::GetCredentialAt(DWORD dwIndex, ICredentialProviderCredential** ppcpc) {
  if (!ppcpc) return E_INVALIDARG;
  *ppcpc = nullptr;
  if (dwIndex != 0 || !_credential) return E_INVALIDARG;
  return _credential->QueryInterface(IID_PPV_ARGS(ppcpc));
}

HRESULT CProvider_CreateInstance(REFIID riid, void** ppv) {
  auto* provider = new (std::nothrow) CProvider();
  if (!provider) return E_OUTOFMEMORY;
  HRESULT hr = provider->QueryInterface(riid, ppv);
  provider->Release();
  return hr;
}
