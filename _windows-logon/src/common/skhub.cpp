#define WIN32_NO_STATUS
#include <windows.h>
#undef WIN32_NO_STATUS
#include <ntstatus.h>
#include <ntsecapi.h>
#include <winhttp.h>
#include <bcrypt.h>
#include <cctype>
#include <cstdlib>

#include "skhub.h"
#include "config.h"

namespace skhub {

// ---------- 文字列 ----------

std::string ToUtf8(const std::wstring& s) {
  if (s.empty()) return std::string();
  int n = WideCharToMultiByte(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0, nullptr, nullptr);
  std::string out(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, s.data(), (int)s.size(), &out[0], n, nullptr, nullptr);
  return out;
}

std::wstring FromUtf8(const std::string& s) {
  if (s.empty()) return std::wstring();
  int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), nullptr, 0);
  std::wstring out(n, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, s.data(), (int)s.size(), &out[0], n);
  return out;
}

void Wipe(std::wstring& s) {
  if (!s.empty()) SecureZeroMemory(&s[0], s.size() * sizeof(wchar_t));
  s.clear();
}

void Wipe(std::string& s) {
  if (!s.empty()) SecureZeroMemory(&s[0], s.size());
  s.clear();
}

namespace {

// ---------- HTTPS（WinHTTP） ----------

struct Handle {
  HINTERNET h = nullptr;
  ~Handle() { if (h) WinHttpCloseHandle(h); }
};

struct Response {
  DWORD status = 0;
  std::string body;
};

HRESULT Http(const wchar_t* method, const wchar_t* host, const std::wstring& path, const std::string& body,
             const wchar_t* contentType, const std::string& bearer, Response& out, std::wstring& error) {
  out = Response();
  Handle session, connect, request;
  session.h = WinHttpOpen(L"SKHubWindowsLogon/1.0", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  // AUTOMATIC_PROXY は Windows 8.1 から
  if (!session.h) session.h = WinHttpOpen(L"SKHubWindowsLogon/1.0", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY, WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  BOOL ok = session.h != nullptr;
  if (ok) {
    WinHttpSetTimeouts(session.h, 10000, 10000, 15000, 15000);
    connect.h = WinHttpConnect(session.h, host, INTERNET_DEFAULT_HTTPS_PORT, 0);
    ok = connect.h != nullptr;
  }
  if (ok) {
    request.h = WinHttpOpenRequest(connect.h, method, path.c_str(), nullptr, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE);
    ok = request.h != nullptr;
  }
  if (ok) {
    std::wstring headers;
    if (contentType) headers += std::wstring(L"Content-Type: ") + contentType + L"\r\n";
    if (!bearer.empty()) headers += L"Authorization: Bearer " + FromUtf8(bearer) + L"\r\n";
    ok = WinHttpSendRequest(request.h, headers.empty() ? WINHTTP_NO_ADDITIONAL_HEADERS : headers.c_str(), (DWORD)-1L,
                            body.empty() ? WINHTTP_NO_REQUEST_DATA : (LPVOID)body.data(), (DWORD)body.size(), (DWORD)body.size(), 0)
         && WinHttpReceiveResponse(request.h, nullptr);
  }
  if (ok) {
    DWORD size = sizeof(out.status);
    ok = WinHttpQueryHeaders(request.h, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX,
                             &out.status, &size, WINHTTP_NO_HEADER_INDEX);
  }
  while (ok) {
    DWORD available = 0;
    ok = WinHttpQueryDataAvailable(request.h, &available);
    if (!ok || available == 0) break;
    std::string chunk(available, '\0');
    DWORD read = 0;
    ok = WinHttpReadData(request.h, &chunk[0], available, &read);
    out.body.append(chunk.data(), read);
  }
  if (!ok) {
    DWORD e = GetLastError();
    error = L"インターネットにつながりませんでした（WinHTTP " + std::to_wstring(e) + L"）";
    return HRESULT_FROM_WIN32(e ? e : ERROR_GEN_FAILURE);
  }
  return S_OK;
}

// ---------- JSON（返ってくる形が決まっているので、必要なところだけ読む） ----------

// "key": の値の始まりの位置（なければ npos）
size_t FindKey(const std::string& json, const char* key, size_t from = 0) {
  const std::string pattern = std::string("\"") + key + "\"";
  size_t pos = from;
  while ((pos = json.find(pattern, pos)) != std::string::npos) {
    size_t p = pos + pattern.size();
    while (p < json.size() && isspace((unsigned char)json[p])) p++;
    if (p < json.size() && json[p] == ':') {
      p++;
      while (p < json.size() && isspace((unsigned char)json[p])) p++;
      return p;
    }
    pos += pattern.size();
  }
  return std::string::npos;
}

void AppendUtf8(std::string& out, unsigned cp) {
  if (cp < 0x80) {
    out += (char)cp;
  } else if (cp < 0x800) {
    out += (char)(0xC0 | (cp >> 6));
    out += (char)(0x80 | (cp & 0x3F));
  } else if (cp < 0x10000) {
    out += (char)(0xE0 | (cp >> 12));
    out += (char)(0x80 | ((cp >> 6) & 0x3F));
    out += (char)(0x80 | (cp & 0x3F));
  } else {
    out += (char)(0xF0 | (cp >> 18));
    out += (char)(0x80 | ((cp >> 12) & 0x3F));
    out += (char)(0x80 | ((cp >> 6) & 0x3F));
    out += (char)(0x80 | (cp & 0x3F));
  }
}

bool ParseString(const std::string& json, size_t p, std::string& out) {
  out.clear();
  if (p >= json.size() || json[p] != '"') return false;
  for (++p; p < json.size(); ++p) {
    char c = json[p];
    if (c == '"') return true;
    if (c != '\\') {
      out += c;
      continue;
    }
    if (++p >= json.size()) return false;
    switch (json[p]) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'u': {
        if (p + 4 >= json.size()) return false;
        unsigned cp = strtoul(json.substr(p + 1, 4).c_str(), nullptr, 16);
        p += 4;
        if (cp >= 0xD800 && cp <= 0xDBFF && p + 6 < json.size() && json[p + 1] == '\\' && json[p + 2] == 'u') {
          unsigned lo = strtoul(json.substr(p + 3, 4).c_str(), nullptr, 16);
          if (lo >= 0xDC00 && lo <= 0xDFFF) {
            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
            p += 6;
          }
        }
        AppendUtf8(out, cp);
        break;
      }
      default: out += json[p]; break;  // \" \\ \/
    }
  }
  return false;
}

bool JsonString(const std::string& json, const char* key, std::string& out) {
  size_t p = FindKey(json, key);
  return p != std::string::npos && ParseString(json, p, out);
}

// Firestore のドキュメントの fields.<field>.stringValue
bool FirestoreString(const std::string& json, const char* field, std::string& out) {
  size_t fields = FindKey(json, "fields");
  if (fields == std::string::npos) return false;
  size_t p = FindKey(json, field, fields);
  if (p == std::string::npos || json[p] != '{') return false;
  size_t value = FindKey(json, "stringValue", p);
  size_t close = json.find('}', p);
  if (value == std::string::npos || value > close) return false;
  return ParseString(json, value, out);
}

std::string JsonEscape(const std::string& s) {
  std::string out;
  for (unsigned char c : s) {
    if (c == '"') out += "\\\"";
    else if (c == '\\') out += "\\\\";
    else if (c < 0x20) {
      char buf[8];
      sprintf_s(buf, "\\u%04x", c);
      out += buf;
    } else out += (char)c;
  }
  return out;
}

std::string UrlEncode(const std::string& s) {
  static const char hex[] = "0123456789ABCDEF";
  std::string out;
  for (unsigned char c : s) {
    if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') out += (char)c;
    else {
      out += '%';
      out += hex[c >> 4];
      out += hex[c & 15];
    }
  }
  return out;
}

// エラーの説明（Google の API は error.message）
std::wstring Describe(const Response& r) {
  std::string message;
  JsonString(r.body, "message", message);
  std::wstring text = L"HTTP " + std::to_wstring(r.status);
  if (!message.empty()) text += L": " + FromUtf8(message);
  return text;
}

// ---------- LSA の秘密の領域 ----------

HRESULT FromNtStatus(NTSTATUS st) {
  return st == STATUS_SUCCESS ? S_OK : HRESULT_FROM_WIN32(LsaNtStatusToWinError(st));
}

void InitLsaString(LSA_UNICODE_STRING& s, const std::wstring& w) {
  s.Buffer = const_cast<PWSTR>(w.c_str());
  s.Length = (USHORT)(w.size() * sizeof(wchar_t));
  s.MaximumLength = s.Length;
}

// value が nullptr なら消す
HRESULT StoreSecret(const std::wstring& key, const std::wstring* value) {
  LSA_OBJECT_ATTRIBUTES oa = {};
  LSA_HANDLE policy = nullptr;
  HRESULT hr = FromNtStatus(LsaOpenPolicy(nullptr, &oa, POLICY_CREATE_SECRET, &policy));
  if (FAILED(hr)) return hr;
  LSA_UNICODE_STRING k, v;
  InitLsaString(k, key);
  if (value) InitLsaString(v, *value);
  NTSTATUS st = LsaStorePrivateData(policy, &k, value ? &v : nullptr);
  LsaClose(policy);
  if (!value && st == STATUS_OBJECT_NAME_NOT_FOUND) return S_OK;
  return FromNtStatus(st);
}

HRESULT ReadSecret(const std::wstring& key, std::wstring& value) {
  value.clear();
  LSA_OBJECT_ATTRIBUTES oa = {};
  LSA_HANDLE policy = nullptr;
  HRESULT hr = FromNtStatus(LsaOpenPolicy(nullptr, &oa, POLICY_GET_PRIVATE_INFORMATION, &policy));
  if (FAILED(hr)) return hr;
  LSA_UNICODE_STRING k;
  InitLsaString(k, key);
  PLSA_UNICODE_STRING data = nullptr;
  NTSTATUS st = LsaRetrievePrivateData(policy, &k, &data);
  LsaClose(policy);
  if (st != STATUS_SUCCESS) return FromNtStatus(st);
  if (data) {
    if (data->Buffer) {
      value.assign(data->Buffer, data->Length / sizeof(wchar_t));
      SecureZeroMemory(data->Buffer, data->Length);
    }
    LsaFreeMemory(data);
  }
  return S_OK;
}

// ---------- 匿名ログイン ----------

const wchar_t kKeyQuery[] = L"?key=" SKHUB_API_KEY;

ULONGLONG ExpiresAt(const std::string& seconds) {
  long n = atol(seconds.c_str());
  if (n <= 0) n = 3600;
  return GetTickCount64() + (ULONGLONG)n * 1000;
}

HRESULT SignUp(DeviceToken& token, std::string& refresh, std::wstring& error) {
  Response r;
  HRESULT hr = Http(L"POST", L"identitytoolkit.googleapis.com", std::wstring(L"/v1/accounts:signUp") + kKeyQuery,
                    "{\"returnSecureToken\":true}", L"application/json", "", r, error);
  if (FAILED(hr)) return hr;
  std::string expires;
  if (r.status != 200 || !JsonString(r.body, "localId", token.uid) || !JsonString(r.body, "idToken", token.idToken)
      || !JsonString(r.body, "refreshToken", refresh)) {
    error = L"この PC を SK Hub Systems に登録できませんでした（" + Describe(r) + L"）";
    return E_FAIL;
  }
  JsonString(r.body, "expiresIn", expires);
  token.expiresAt = ExpiresAt(expires);
  return S_OK;
}

// rejected … リフレッシュトークンが使えなくなっていた（匿名ログインを作り直す）
HRESULT Refresh(DeviceToken& token, std::string& refresh, bool& rejected, std::wstring& error) {
  rejected = false;
  Response r;
  HRESULT hr = Http(L"POST", L"securetoken.googleapis.com", std::wstring(L"/v1/token") + kKeyQuery,
                    "grant_type=refresh_token&refresh_token=" + UrlEncode(refresh), L"application/x-www-form-urlencoded", "", r, error);
  if (FAILED(hr)) return hr;
  std::string next, expires;
  if (r.status != 200 || !JsonString(r.body, "id_token", token.idToken) || !JsonString(r.body, "user_id", token.uid)) {
    rejected = r.status == 400 || r.status == 401 || r.status == 403;
    error = L"SK Hub Systems にログインできませんでした（" + Describe(r) + L"）";
    return E_FAIL;
  }
  if (JsonString(r.body, "refresh_token", next) && !next.empty()) refresh = next;
  JsonString(r.body, "expires_in", expires);
  token.expiresAt = ExpiresAt(expires);
  return S_OK;
}

const std::wstring kDocsPath = L"/v1/projects/" SKHUB_PROJECT_ID L"/databases/(default)/documents";

std::wstring RequestPath(const std::wstring& code) {
  return kDocsPath + L"/" SKHUB_LOGIN_COLLECTION L"/" + code + kKeyQuery;
}

// UID はレジストリのキー名・LSA の名前に使うので、使える文字を決めておく（Firebase の UID と sk-api のカスタムトークンの UID）
bool ValidUid(const std::wstring& uid) {
  if (uid.empty() || uid.size() > 128) return false;
  for (wchar_t c : uid) {
    if (!(iswalnum(c) && c < 0x80) && c != L'_' && c != L'-' && c != L':' && c != L'.') return false;
  }
  return true;
}

HRESULT ReadRegString(HKEY key, const wchar_t* name, std::wstring& out) {
  out.clear();
  DWORD size = 0;
  LSTATUS st = RegGetValueW(key, nullptr, name, RRF_RT_REG_SZ, nullptr, nullptr, &size);
  if (st != ERROR_SUCCESS) return HRESULT_FROM_WIN32(st);
  std::wstring buf(size / sizeof(wchar_t) + 1, L'\0');
  st = RegGetValueW(key, nullptr, name, RRF_RT_REG_SZ, nullptr, &buf[0], &size);
  if (st != ERROR_SUCCESS) return HRESULT_FROM_WIN32(st);
  buf.resize(wcslen(buf.c_str()));
  out = buf;
  return S_OK;
}

HRESULT ReadLinkedUserKey(HKEY users, const std::wstring& uid, LinkedUser& out) {
  HKEY key;
  LSTATUS st = RegOpenKeyExW(users, uid.c_str(), 0, KEY_READ, &key);
  if (st != ERROR_SUCCESS) return HRESULT_FROM_WIN32(st);
  out.uid = uid;
  HRESULT hr = ReadRegString(key, L"UserName", out.userName);
  if (SUCCEEDED(hr)) ReadRegString(key, L"Domain", out.domain);
  RegCloseKey(key);
  return hr;
}

}  // namespace

HRESULT EnsureDeviceToken(DeviceToken& token, std::wstring& error) {
  // 有効期限まで 5 分以上あれば、そのまま使う
  if (!token.idToken.empty() && GetTickCount64() + 5 * 60 * 1000 < token.expiresAt) return S_OK;
  std::wstring stored;
  std::string refresh, before;
  if (SUCCEEDED(ReadSecret(SKHUB_SECRET_DEVICE, stored))) refresh = ToUtf8(stored);
  before = refresh;
  HRESULT hr = E_FAIL;
  bool rejected = refresh.empty();
  if (!refresh.empty()) hr = Refresh(token, refresh, rejected, error);
  if (FAILED(hr) && rejected) hr = SignUp(token, refresh, error);
  if (FAILED(hr)) {
    token.idToken.clear();
    return hr;
  }
  if (refresh != before) {
    std::wstring value = FromUtf8(refresh);
    HRESULT saved = StoreSecret(SKHUB_SECRET_DEVICE, &value);
    if (FAILED(saved)) {
      error = L"この PC の登録を保存できませんでした。管理者として実行してください";
      token.idToken.clear();
      return saved;
    }
  }
  return S_OK;
}

std::wstring NewCode() {
  static const wchar_t kAlphabet[] = L"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  BYTE bytes[8] = {};
  BCryptGenRandom(nullptr, bytes, sizeof(bytes), BCRYPT_USE_SYSTEM_PREFERRED_RNG);
  std::wstring code;
  for (BYTE b : bytes) code += kAlphabet[b % 32];
  return code;
}

std::wstring FormatCode(const std::wstring& code) {
  return code.size() == 8 ? code.substr(0, 4) + L"-" + code.substr(4) : code;
}

std::wstring ComputerName() {
  wchar_t name[MAX_COMPUTERNAME_LENGTH + 1] = {};
  DWORD size = ARRAYSIZE(name);
  return GetComputerNameW(name, &size) ? std::wstring(name, size) : std::wstring();
}

HRESULT CreateRequest(DeviceToken& token, Purpose purpose, std::wstring& code, std::wstring& error) {
  for (int attempt = 0; attempt < 4; attempt++) {
    HRESULT hr = EnsureDeviceToken(token, error);
    if (FAILED(hr)) return hr;
    code = NewCode();
    // createdAt はサーバーの時刻（ルールで request.time と同じか確かめる）。同じコードがすでにあれば作らない
    const std::string name = ToUtf8(L"projects/" SKHUB_PROJECT_ID L"/databases/(default)/documents/" SKHUB_LOGIN_COLLECTION L"/" + code);
    const std::string body =
        "{\"writes\":[{\"update\":{\"name\":\"" + name + "\",\"fields\":{"
        "\"pcUid\":{\"stringValue\":\"" + JsonEscape(token.uid) + "\"},"
        "\"pcName\":{\"stringValue\":\"" + JsonEscape(ToUtf8(ComputerName().substr(0, 64))) + "\"},"
        "\"purpose\":{\"stringValue\":\"" + (purpose == Purpose::Register ? "register" : "signin") + "\"},"
        "\"status\":{\"stringValue\":\"pending\"}}},"
        "\"updateTransforms\":[{\"fieldPath\":\"createdAt\",\"setToServerValue\":\"REQUEST_TIME\"}],"
        "\"currentDocument\":{\"exists\":false}}]}";
    Response r;
    hr = Http(L"POST", L"firestore.googleapis.com", kDocsPath + L":commit" + kKeyQuery, body, L"application/json", token.idToken, r, error);
    if (FAILED(hr)) return hr;
    if (r.status == 200) return S_OK;
    if (r.status == 401) {
      token.idToken.clear();
      continue;
    }
    if (r.status == 409 || r.body.find("ALREADY_EXISTS") != std::string::npos || r.body.find("FAILED_PRECONDITION") != std::string::npos) continue;
    error = L"コードを発行できませんでした（" + Describe(r) + L"）";
    return E_FAIL;
  }
  error = L"コードを発行できませんでした。しばらくしてからお試しください";
  return E_FAIL;
}

HRESULT CheckRequest(DeviceToken& token, const std::wstring& code, RequestState& state, std::wstring& uid, std::wstring& error) {
  state = RequestState::Error;
  uid.clear();
  for (int attempt = 0; attempt < 2; attempt++) {
    HRESULT hr = EnsureDeviceToken(token, error);
    if (FAILED(hr)) return hr;
    Response r;
    hr = Http(L"GET", L"firestore.googleapis.com", RequestPath(code), "", nullptr, token.idToken, r, error);
    if (FAILED(hr)) return hr;
    if (r.status == 401) {
      token.idToken.clear();
      continue;
    }
    // ドキュメントがないと、ルールで読めない（403）
    if (r.status == 404 || r.status == 403) {
      state = RequestState::Missing;
      return S_OK;
    }
    std::string status, pcUid, approver;
    if (r.status != 200 || !FirestoreString(r.body, "status", status) || !FirestoreString(r.body, "pcUid", pcUid)) {
      error = L"承認の状態を確かめられませんでした（" + Describe(r) + L"）";
      return E_FAIL;
    }
    // この PC が作った依頼だけを信じる
    if (pcUid != token.uid) {
      state = RequestState::Missing;
      return S_OK;
    }
    if (status == "approved" && FirestoreString(r.body, "uid", approver) && ValidUid(FromUtf8(approver))) {
      uid = FromUtf8(approver);
      state = RequestState::Approved;
    } else if (status == "denied") {
      state = RequestState::Denied;
    } else {
      state = RequestState::Pending;
    }
    return S_OK;
  }
  error = L"SK Hub Systems にログインできませんでした";
  return E_FAIL;
}

void DeleteRequest(DeviceToken& token, const std::wstring& code) {
  std::wstring error;
  if (code.empty() || FAILED(EnsureDeviceToken(token, error))) return;
  Response r;
  Http(L"DELETE", L"firestore.googleapis.com", RequestPath(code), "", nullptr, token.idToken, r, error);
}

// ---------- つないだアカウント ----------

HRESULT FindLinkedUser(const std::wstring& uid, LinkedUser& out) {
  if (!ValidUid(uid)) return E_INVALIDARG;
  HKEY users;
  LSTATUS st = RegOpenKeyExW(HKEY_LOCAL_MACHINE, SKHUB_REG_USERS, 0, KEY_READ, &users);
  if (st != ERROR_SUCCESS) return HRESULT_FROM_WIN32(st);
  HRESULT hr = ReadLinkedUserKey(users, uid, out);
  RegCloseKey(users);
  return hr;
}

HRESULT ListLinkedUsers(std::vector<LinkedUser>& out) {
  out.clear();
  HKEY users;
  LSTATUS st = RegOpenKeyExW(HKEY_LOCAL_MACHINE, SKHUB_REG_USERS, 0, KEY_READ, &users);
  if (st == ERROR_FILE_NOT_FOUND) return S_OK;
  if (st != ERROR_SUCCESS) return HRESULT_FROM_WIN32(st);
  for (DWORD i = 0;; i++) {
    wchar_t name[256];
    DWORD size = ARRAYSIZE(name);
    if (RegEnumKeyExW(users, i, name, &size, nullptr, nullptr, nullptr, nullptr) != ERROR_SUCCESS) break;
    LinkedUser user;
    if (SUCCEEDED(ReadLinkedUserKey(users, name, user))) out.push_back(user);
  }
  RegCloseKey(users);
  return S_OK;
}

HRESULT SaveLinkedUser(const LinkedUser& user, const std::wstring& password) {
  if (!ValidUid(user.uid) || user.userName.empty()) return E_INVALIDARG;
  HRESULT hr = StoreSecret(SKHUB_SECRET_PASSWORD_PREFIX + user.uid, &password);
  if (FAILED(hr)) return hr;
  HKEY key;
  LSTATUS st = RegCreateKeyExW(HKEY_LOCAL_MACHINE, (std::wstring(SKHUB_REG_USERS L"\\") + user.uid).c_str(), 0, nullptr, 0,
                               KEY_WRITE, nullptr, &key, nullptr);
  if (st != ERROR_SUCCESS) return HRESULT_FROM_WIN32(st);
  st = RegSetValueExW(key, L"UserName", 0, REG_SZ, (const BYTE*)user.userName.c_str(), (DWORD)((user.userName.size() + 1) * sizeof(wchar_t)));
  if (st == ERROR_SUCCESS)
    st = RegSetValueExW(key, L"Domain", 0, REG_SZ, (const BYTE*)user.domain.c_str(), (DWORD)((user.domain.size() + 1) * sizeof(wchar_t)));
  RegCloseKey(key);
  return HRESULT_FROM_WIN32(st);
}

HRESULT RemoveLinkedUser(const std::wstring& uid) {
  if (!ValidUid(uid)) return E_INVALIDARG;
  HRESULT hr = StoreSecret(SKHUB_SECRET_PASSWORD_PREFIX + uid, nullptr);
  LSTATUS st = RegDeleteTreeW(HKEY_LOCAL_MACHINE, (std::wstring(SKHUB_REG_USERS L"\\") + uid).c_str());
  if (st != ERROR_SUCCESS && st != ERROR_FILE_NOT_FOUND) return HRESULT_FROM_WIN32(st);
  return hr;
}

HRESULT ReadLinkedPassword(const std::wstring& uid, std::wstring& password) {
  if (!ValidUid(uid)) return E_INVALIDARG;
  return ReadSecret(SKHUB_SECRET_PASSWORD_PREFIX + uid, password);
}

void ForgetDevice() {
  std::vector<LinkedUser> users;
  ListLinkedUsers(users);
  for (const LinkedUser& user : users) RemoveLinkedUser(user.uid);
  StoreSecret(SKHUB_SECRET_DEVICE, nullptr);
  RegDeleteTreeW(HKEY_LOCAL_MACHINE, SKHUB_REG_ROOT);
  RegDeleteKeyW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\SK Hub");  // ほかに何もなければ
}

}  // namespace skhub
