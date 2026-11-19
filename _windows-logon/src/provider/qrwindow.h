// サインイン画面の独自ウィンドウ（QR コードで承認・ID とパスワードでサインインを切りかえる）
//   タイルの画像は丸く切り抜かれるので、QR コードや入力欄は別のウィンドウで大きく出す。
//   LogonUI の UI のスレッドで作る（メッセージは LogonUI のメッセージループが回す）
#pragma once

#include <windows.h>
#include <string>

struct QrWindowContent {
  std::wstring code;    // 8 文字のコード（空 = まだ用意できていない）
  std::wstring status;  // 承認を待っています・期限切れなど（コードがないときに枠の中に出す）
  std::wstring pcName;  // 要求元: この PC の名前
  int seal = 0;         // 合言葉（0〜7）。この PC の設定。本物のウィンドウだと見分けるための印
  bool formAvailable = false;  // ID とパスワードでサインインできる（つないだアカウントがあるとき）
  bool form = false;           // いまは ID とパスワードの入力を出している（ウィンドウが持つ。UpdateQrWindow は変えない）
  std::wstring error;          // ID とパスワードが合わなかったときの理由（form のとき）
  ULONGLONG deadline = 0;      // コードの期限（GetTickCount64）。ウィンドウが残り時間を数える。UpdateQrWindow が決める
};

// ID とパスワードで確かめる。成功したら true（そのあとウィンドウは閉じられる）。失敗なら error に理由を入れて false
// password は確かめたら消す（呼び出し側のコピーも消す）
using QrWindowSubmitFn = bool (*)(void* context, const std::wstring& id, std::wstring& password, std::wstring& error);

// ウィンドウを作って出す。閉じられると WM_DESTROY のあとで onClosed を呼ぶ
HWND CreateQrWindow(HINSTANCE hinst, HWND owner, void (*onClosed)(void* context), void* context, QrWindowSubmitFn onSubmit);
// 中身を変えて描き直す（form の切りかえは、ウィンドウの側が持つので変わらない）
void UpdateQrWindow(HWND hwnd, const QrWindowContent& content);
void UnregisterQrWindowClass(HINSTANCE hinst);

// 描く（確かめ用に、ウィンドウなしでも呼べる）。scale = DPI / 96
void PaintQrWindow(HDC dc, const RECT& rc, double scale, const QrWindowContent& content);
SIZE QrWindowSize(double scale);
// 合言葉の図形を描く（0〜7。色と図形の組み合わせ）・名前（「赤い丸」など）
void PaintSeal(HDC dc, const RECT& box, int seal);
const wchar_t* SealName(int seal);
