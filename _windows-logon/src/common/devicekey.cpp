#include "devicekey.h"

#include <bcrypt.h>
#include <ncrypt.h>

#include <vector>

#include "config.h"

namespace skhub {
namespace {

// 開いた鍵とプロバイダーをまとめて閉じる
struct KeyHandles {
  NCRYPT_PROV_HANDLE prov = 0;
  NCRYPT_KEY_HANDLE key = 0;
  ~KeyHandles() {
    if (key) NCryptFreeObject(key);
    if (prov) NCryptFreeObject(prov);
  }
};

// 鍵を開く。なければ作る。TPM のない PC は Software Key Storage に落とす
HRESULT OpenDeviceKey(KeyHandles& h) {
  static const wchar_t* const kProviders[] = {MS_PLATFORM_CRYPTO_PROVIDER, MS_KEY_STORAGE_PROVIDER};
  for (const wchar_t* name : kProviders) {
    NCRYPT_PROV_HANDLE prov = 0;
    if (NCryptOpenStorageProvider(&prov, name, 0) != ERROR_SUCCESS) continue;
    NCRYPT_KEY_HANDLE key = 0;
    SECURITY_STATUS st = NCryptOpenKey(prov, &key, SKHUB_DEVICE_KEY_NAME, 0, NCRYPT_MACHINE_KEY_FLAG);
    if (st != ERROR_SUCCESS) {
      st = NCryptCreatePersistedKey(prov, &key, NCRYPT_ECDSA_P256_ALGORITHM, SKHUB_DEVICE_KEY_NAME, 0, NCRYPT_MACHINE_KEY_FLAG);
      if (st == ERROR_SUCCESS) st = NCryptFinalizeKey(key, 0);
    }
    if (st == ERROR_SUCCESS) {
      h.prov = prov;
      h.key = key;
      return S_OK;
    }
    if (key) NCryptFreeObject(key);
    NCryptFreeObject(prov);
  }
  return E_FAIL;
}

HRESULT Sha256(const void* data, ULONG size, std::string& digest) {
  digest.assign(32, '\0');
  BCRYPT_ALG_HANDLE alg = nullptr;
  if (!BCRYPT_SUCCESS(BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, nullptr, 0))) return E_FAIL;
  NTSTATUS st = BCryptHash(alg, nullptr, 0, static_cast<PUCHAR>(const_cast<void*>(data)), size, reinterpret_cast<PUCHAR>(&digest[0]), 32);
  BCryptCloseAlgorithmProvider(alg, 0);
  return BCRYPT_SUCCESS(st) ? S_OK : E_FAIL;
}

std::string Hex(const std::string& bytes, size_t count) {
  static const char kDigits[] = "0123456789abcdef";
  std::string out;
  for (size_t i = 0; i < count && i < bytes.size(); i++) {
    unsigned char c = static_cast<unsigned char>(bytes[i]);
    out += kDigits[c >> 4];
    out += kDigits[c & 15];
  }
  return out;
}

}  // namespace

HRESULT DeviceKeyPublic(std::string& publicXY, std::string& keyId) {
  publicXY.clear();
  keyId.clear();
  KeyHandles h;
  HRESULT hr = OpenDeviceKey(h);
  if (FAILED(hr)) return hr;

  DWORD size = 0;
  SECURITY_STATUS st = NCryptExportKey(h.key, 0, BCRYPT_ECCPUBLIC_BLOB, nullptr, nullptr, 0, &size, 0);
  if (st != ERROR_SUCCESS) return static_cast<HRESULT>(st);
  std::vector<BYTE> blob(size);
  st = NCryptExportKey(h.key, 0, BCRYPT_ECCPUBLIC_BLOB, nullptr, blob.data(), size, &size, 0);
  if (st != ERROR_SUCCESS) return static_cast<HRESULT>(st);

  const auto* header = reinterpret_cast<const BCRYPT_ECCKEY_BLOB*>(blob.data());
  if (size < sizeof(BCRYPT_ECCKEY_BLOB) + 64 || header->dwMagic != BCRYPT_ECDSA_PUBLIC_P256_MAGIC || header->cbKey != 32) return E_FAIL;
  publicXY.assign(reinterpret_cast<const char*>(blob.data() + sizeof(BCRYPT_ECCKEY_BLOB)), 64);

  std::string digest;
  hr = Sha256(publicXY.data(), 64, digest);
  if (FAILED(hr)) return hr;
  keyId = Hex(digest, 8);
  return S_OK;
}

HRESULT SignWithDeviceKey(const std::string& message, std::string& signature) {
  signature.clear();
  KeyHandles h;
  HRESULT hr = OpenDeviceKey(h);
  if (FAILED(hr)) return hr;

  std::string digest;
  hr = Sha256(message.data(), static_cast<ULONG>(message.size()), digest);
  if (FAILED(hr)) return hr;

  DWORD size = 0;
  SECURITY_STATUS st = NCryptSignHash(h.key, nullptr, reinterpret_cast<PBYTE>(&digest[0]), 32, nullptr, 0, &size, 0);
  if (st != ERROR_SUCCESS) return static_cast<HRESULT>(st);
  std::vector<BYTE> sig(size);
  st = NCryptSignHash(h.key, nullptr, reinterpret_cast<PBYTE>(&digest[0]), 32, sig.data(), size, &size, 0);
  if (st != ERROR_SUCCESS || size != 64) return E_FAIL;
  signature.assign(reinterpret_cast<const char*>(sig.data()), size);
  return S_OK;
}

std::string LogonMessage(const std::string& code, const std::string& nonce, const std::string& pcUid) {
  return std::string(SKHUB_SIGN_TAG) + "\n" + code + "\n" + nonce + "\n" + pcUid;
}

std::string RandomHex(size_t bytes) {
  std::string raw(bytes, '\0');
  BCryptGenRandom(nullptr, reinterpret_cast<PUCHAR>(&raw[0]), static_cast<ULONG>(bytes), BCRYPT_USE_SYSTEM_PREFERRED_RNG);
  return Hex(raw, bytes);
}

std::string Base64Url(const std::string& bytes) {
  static const char kChars[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  std::string out;
  size_t i = 0;
  for (; i + 2 < bytes.size(); i += 3) {
    unsigned n = (static_cast<unsigned char>(bytes[i]) << 16) | (static_cast<unsigned char>(bytes[i + 1]) << 8) | static_cast<unsigned char>(bytes[i + 2]);
    out += kChars[(n >> 18) & 63];
    out += kChars[(n >> 12) & 63];
    out += kChars[(n >> 6) & 63];
    out += kChars[n & 63];
  }
  const size_t rest = bytes.size() - i;
  if (rest == 1) {
    unsigned n = static_cast<unsigned char>(bytes[i]) << 16;
    out += kChars[(n >> 18) & 63];
    out += kChars[(n >> 12) & 63];
  } else if (rest == 2) {
    unsigned n = (static_cast<unsigned char>(bytes[i]) << 16) | (static_cast<unsigned char>(bytes[i + 1]) << 8);
    out += kChars[(n >> 18) & 63];
    out += kChars[(n >> 12) & 63];
    out += kChars[(n >> 6) & 63];
  }
  return out;
}

}  // namespace skhub
