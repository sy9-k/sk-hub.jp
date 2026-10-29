#include "helpers.h"

#include <wincred.h>

HRESULT FieldDescriptorCoAllocCopy(const CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR& rcpfd, CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR** ppcpfd) {
  *ppcpfd = nullptr;
  auto* pcpfd = static_cast<CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR*>(CoTaskMemAlloc(sizeof(CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR)));
  if (!pcpfd) return E_OUTOFMEMORY;
  pcpfd->dwFieldID = rcpfd.dwFieldID;
  pcpfd->cpft = rcpfd.cpft;
  pcpfd->guidFieldType = rcpfd.guidFieldType;
  pcpfd->pszLabel = nullptr;
  HRESULT hr = rcpfd.pszLabel ? SHStrDupW(rcpfd.pszLabel, &pcpfd->pszLabel) : S_OK;
  if (FAILED(hr)) {
    CoTaskMemFree(pcpfd);
    return hr;
  }
  *ppcpfd = pcpfd;
  return S_OK;
}

namespace {

void InitUnicodeString(PWSTR pwz, UNICODE_STRING* pus) {
  size_t cch = wcslen(pwz);
  pus->Length = (USHORT)(cch * sizeof(wchar_t));
  pus->MaximumLength = pus->Length;
  pus->Buffer = pwz;
}

// 文字列を詰めたバッファにコピーし、Buffer をバッファの先頭からの位置にする（LSA が受け取る形）
void PackString(const UNICODE_STRING& src, BYTE* base, BYTE*& cursor, UNICODE_STRING* dst) {
  dst->Length = src.Length;
  dst->MaximumLength = src.Length;
  CopyMemory(cursor, src.Buffer, src.Length);
  dst->Buffer = (PWSTR)(cursor - base);
  cursor += src.Length;
}

// LogonUI は CredProtect したパスワードを受け取れる（メモリに平文で残る時間を短くする）
HRESULT ProtectPassword(PCWSTR password, PWSTR* protectedOut) {
  *protectedOut = nullptr;
  PWSTR copy = nullptr;
  HRESULT hr = SHStrDupW(password, &copy);
  if (FAILED(hr)) return hr;
  DWORD cchCopy = (DWORD)wcslen(copy) + 1;
  CRED_PROTECTION_TYPE type;
  if (cchCopy > 1 && !(CredIsProtectedW(copy, &type) && type != CredUnprotected)) {
    DWORD cch = 0;
    if (!CredProtectW(FALSE, copy, cchCopy, nullptr, &cch, nullptr) && GetLastError() == ERROR_INSUFFICIENT_BUFFER && cch > 0) {
      auto* out = static_cast<PWSTR>(CoTaskMemAlloc(cch * sizeof(wchar_t)));
      if (out && CredProtectW(FALSE, copy, cchCopy, out, &cch, nullptr)) {
        SecureZeroMemory(copy, cchCopy * sizeof(wchar_t));
        CoTaskMemFree(copy);
        *protectedOut = out;
        return S_OK;
      }
      if (out) CoTaskMemFree(out);
      hr = HRESULT_FROM_WIN32(GetLastError());
      SecureZeroMemory(copy, cchCopy * sizeof(wchar_t));
      CoTaskMemFree(copy);
      return FAILED(hr) ? hr : E_FAIL;
    }
  }
  // 空、またはすでに守られている
  *protectedOut = copy;
  return S_OK;
}

}  // namespace

HRESULT PackLogon(CREDENTIAL_PROVIDER_USAGE_SCENARIO cpus, PCWSTR domain, PCWSTR user, PCWSTR password, BYTE** prgb, ULONG* pcb) {
  *prgb = nullptr;
  *pcb = 0;
  PWSTR protectedPassword = nullptr;
  HRESULT hr = ProtectPassword(password, &protectedPassword);
  if (FAILED(hr)) return hr;

  KERB_INTERACTIVE_UNLOCK_LOGON in = {};
  InitUnicodeString(const_cast<PWSTR>(domain), &in.Logon.LogonDomainName);
  InitUnicodeString(const_cast<PWSTR>(user), &in.Logon.UserName);
  InitUnicodeString(protectedPassword, &in.Logon.Password);
  in.Logon.MessageType = cpus == CPUS_UNLOCK_WORKSTATION ? KerbWorkstationUnlockLogon : KerbInteractiveLogon;

  DWORD cb = sizeof(in) + in.Logon.LogonDomainName.Length + in.Logon.UserName.Length + in.Logon.Password.Length;
  auto* out = static_cast<KERB_INTERACTIVE_UNLOCK_LOGON*>(CoTaskMemAlloc(cb));
  if (!out) {
    hr = E_OUTOFMEMORY;
  } else {
    ZeroMemory(out, sizeof(*out));
    BYTE* base = reinterpret_cast<BYTE*>(out);
    BYTE* cursor = base + sizeof(*out);
    out->Logon.MessageType = in.Logon.MessageType;
    PackString(in.Logon.LogonDomainName, base, cursor, &out->Logon.LogonDomainName);
    PackString(in.Logon.UserName, base, cursor, &out->Logon.UserName);
    PackString(in.Logon.Password, base, cursor, &out->Logon.Password);
    *prgb = base;
    *pcb = cb;
  }
  SecureZeroMemory(protectedPassword, wcslen(protectedPassword) * sizeof(wchar_t));
  CoTaskMemFree(protectedPassword);
  return hr;
}

HRESULT RetrieveNegotiateAuthPackage(ULONG* pulAuthPackage) {
  HANDLE lsa;
  NTSTATUS status = LsaConnectUntrusted(&lsa);
  if (status != STATUS_SUCCESS) return HRESULT_FROM_NT(status);
  LSA_STRING name;
  name.Buffer = const_cast<PCHAR>(NEGOSSP_NAME_A);
  name.Length = (USHORT)strlen(name.Buffer);
  name.MaximumLength = name.Length + 1;
  ULONG package = 0;
  status = LsaLookupAuthenticationPackage(lsa, &name, &package);
  LsaDeregisterLogonProcess(lsa);
  if (status != STATUS_SUCCESS) return HRESULT_FROM_NT(status);
  *pulAuthPackage = package;
  return S_OK;
}
