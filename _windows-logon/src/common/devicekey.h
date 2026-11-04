// この PC の鍵（NCrypt。TPM があれば TPM の中に作り、秘密鍵は外に出ない）
//   サインインの依頼に署名して、承認が同じ PC のものかを確かめるのに使う。サインイン画面（SYSTEM）でも動くよう、マシンの鍵にしている
#pragma once

#include <windows.h>
#include <string>

namespace skhub {

// 公開鍵（X||Y の 64 バイト）と、その指紋（公開鍵の SHA-256 の先頭 8 バイトを 16 進にしたもの）。鍵がなければ作る
HRESULT DeviceKeyPublic(std::string& publicXY, std::string& keyId);
// 依頼の内容に署名する（メッセージを SHA-256 してから ECDSA P-256。結果は r||s の 64 バイト）
HRESULT SignWithDeviceKey(const std::string& message, std::string& signature);
// 署名するメッセージ（sk-hub.jp/pc/pc.js と同じ形にする。行は "\n" で区切る）
std::string LogonMessage(const std::string& code, const std::string& nonce, const std::string& pcUid);
// 16 バイトの乱数を 16 進（小文字）にする。依頼ごとに変える
std::string RandomHex(size_t bytes);
// パディングなしの base64url（RFC 4648）
std::string Base64Url(const std::string& bytes);

}  // namespace skhub
