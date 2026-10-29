// サインイン画面（Credential Provider）と設定ツールで共通に使うもの
//   ・この PC の匿名ログイン（Firebase Authentication の REST）
//   ・サインインの依頼（Firestore の windowsLogons/{コード}）を作る・確かめる・消す
//   ・つないだアカウント（レジストリ）とパスワード（LSA の秘密の領域）
#pragma once

#include <windows.h>
#include <string>
#include <vector>

namespace skhub {

// ---------- 文字列 ----------
std::string ToUtf8(const std::wstring& s);
std::wstring FromUtf8(const std::string& s);
// パスワードなどを消してから捨てる
void Wipe(std::wstring& s);
void Wipe(std::string& s);

// ---------- 匿名ログイン ----------
struct DeviceToken {
  std::string uid;      // この PC の匿名ログインの UID（依頼の pcUid）
  std::string idToken;
  ULONGLONG expiresAt = 0;  // GetTickCount64
};
// ID トークンを返す（なければ匿名で登録し、リフレッシュトークンを LSA に保存する）。SYSTEM か管理者で動かす
HRESULT EnsureDeviceToken(DeviceToken& token, std::wstring& error);

// ---------- サインインの依頼 ----------
enum class Purpose { SignIn, Register };
enum class RequestState { Pending, Approved, Denied, Missing, Error };

// 8 文字のコード（紛らわしい 0・O・1・I のない 32 文字）
std::wstring NewCode();
// 表示用（ABCD-EFGH）
std::wstring FormatCode(const std::wstring& code);
std::wstring ComputerName();

// 新しいコードで依頼を作る（同じコードがあれば作り直す）
HRESULT CreateRequest(DeviceToken& token, Purpose purpose, std::wstring& code, std::wstring& error);
// 承認されたら uid に SK Hub Systems アカウントの UID が入る
HRESULT CheckRequest(DeviceToken& token, const std::wstring& code, RequestState& state, std::wstring& uid, std::wstring& error);
void DeleteRequest(DeviceToken& token, const std::wstring& code);

// ---------- つないだアカウント ----------
struct LinkedUser {
  std::wstring uid;
  std::wstring userName;
  std::wstring domain;  // 空 = この PC
};
HRESULT FindLinkedUser(const std::wstring& uid, LinkedUser& out);
HRESULT ListLinkedUsers(std::vector<LinkedUser>& out);
HRESULT SaveLinkedUser(const LinkedUser& user, const std::wstring& password);
HRESULT RemoveLinkedUser(const std::wstring& uid);
HRESULT ReadLinkedPassword(const std::wstring& uid, std::wstring& password);
// 匿名ログインの記録も消す（アンインストール）
void ForgetDevice();

}  // namespace skhub
