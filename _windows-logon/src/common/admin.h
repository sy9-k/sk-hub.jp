// 設定ツール（コマンド版 skhub-logon-setup・ウィンドウ版 SKHubLogonSettings）で共通に使う、管理者の操作
//   サインイン画面に入れる・外す、Windows のパスワードを確かめる、ユーザーの一覧
#pragma once

#include <windows.h>
#include <string>
#include <vector>

namespace skhub {

std::wstring ErrorText(HRESULT hr);
bool IsElevated();
std::wstring ExeDir();

// サインイン画面に入っているか（レジストリの登録と DLL があるか）
bool IsProviderInstalled();
// sourceDir の SKHubCredentialProvider.dll を Program Files にコピーして、サインイン画面に登録する
HRESULT InstallProvider(const std::wstring& sourceDir, std::wstring& installedPath, std::wstring& error);
// サインイン画面から外し、つないだアカウント・保存したパスワード・この PC の匿名ログインの記録を消す
HRESULT UninstallProvider(std::wstring& error);

// いまのユーザー（PC名\ユーザー）
std::wstring CurrentUser();
// 「PC名\ユーザー」「.\ユーザー」「ユーザー」はこの PC のユーザー（domain は空）。「ドメイン\ユーザー」「user@example.com」はそのまま
void SplitUser(const std::wstring& input, std::wstring& domain, std::wstring& user);
// 表示用（PC名\ユーザー）
std::wstring DisplayUser(const std::wstring& domain, const std::wstring& user);
// この PC の、使えるローカルユーザー（無効なアカウントは除く）
std::vector<std::wstring> LocalUsers();
// パスワードが合っているか、Windows に確かめてもらう
HRESULT VerifyWindowsPassword(const std::wstring& domain, const std::wstring& user, const std::wstring& password, std::wstring& error);

}  // namespace skhub
