// DLL の入り口（COM のクラスファクトリー）
#include <new>

#include "common.h"
#include "provider.h"

HINSTANCE g_hinst = nullptr;
static LONG g_cRef = 0;

const CLSID CLSID_SKHubProvider = SKHUB_CLSID_INIT;

void DllAddRef() { InterlockedIncrement(&g_cRef); }
void DllRelease() { InterlockedDecrement(&g_cRef); }

class CClassFactory : public IClassFactory {
 public:
  CClassFactory() : _cRef(1) { DllAddRef(); }

  IFACEMETHODIMP QueryInterface(REFIID riid, void** ppv) {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == IID_IClassFactory) {
      *ppv = static_cast<IClassFactory*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  IFACEMETHODIMP_(ULONG) AddRef() { return InterlockedIncrement(&_cRef); }
  IFACEMETHODIMP_(ULONG) Release() {
    LONG cRef = InterlockedDecrement(&_cRef);
    if (!cRef) delete this;
    return cRef;
  }
  IFACEMETHODIMP CreateInstance(IUnknown* pUnkOuter, REFIID riid, void** ppv) {
    if (pUnkOuter) {
      *ppv = nullptr;
      return CLASS_E_NOAGGREGATION;
    }
    return CProvider_CreateInstance(riid, ppv);
  }
  IFACEMETHODIMP LockServer(BOOL bLock) {
    if (bLock) DllAddRef();
    else DllRelease();
    return S_OK;
  }

 private:
  ~CClassFactory() { DllRelease(); }
  LONG _cRef;
};

STDAPI DllCanUnloadNow() {
  return g_cRef > 0 ? S_FALSE : S_OK;
}

STDAPI DllGetClassObject(REFCLSID rclsid, REFIID riid, void** ppv) {
  *ppv = nullptr;
  if (rclsid != CLSID_SKHubProvider) return CLASS_E_CLASSNOTAVAILABLE;
  auto* factory = new (std::nothrow) CClassFactory();
  if (!factory) return E_OUTOFMEMORY;
  HRESULT hr = factory->QueryInterface(riid, ppv);
  factory->Release();
  return hr;
}

BOOL WINAPI DllMain(HINSTANCE hinstDll, DWORD dwReason, LPVOID) {
  if (dwReason == DLL_PROCESS_ATTACH) {
    g_hinst = hinstDll;
    DisableThreadLibraryCalls(hinstDll);
  }
  return TRUE;
}
