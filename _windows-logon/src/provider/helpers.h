// Credential Provider の決まった処理（Microsoft の SampleV2CredentialProvider の helpers.cpp と同じ流れ）
#pragma once

#include "common.h"

HRESULT FieldDescriptorCoAllocCopy(const CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR& rcpfd, CREDENTIAL_PROVIDER_FIELD_DESCRIPTOR** ppcpfd);

// パスワードを CredProtect で守ってから、KERB_INTERACTIVE_UNLOCK_LOGON を作って詰める
HRESULT PackLogon(CREDENTIAL_PROVIDER_USAGE_SCENARIO cpus, PCWSTR domain, PCWSTR user, PCWSTR password, BYTE** prgb, ULONG* pcb);

HRESULT RetrieveNegotiateAuthPackage(ULONG* pulAuthPackage);
