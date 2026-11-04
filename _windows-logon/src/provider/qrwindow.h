// サインイン画面の「QR コードで承認」で開くウィンドウ
//   タイルの画像は丸く切り抜かれるので、QR コードは別のウィンドウで大きく出す。
//   LogonUI の UI のスレッドで作る（メッセージは LogonUI のメッセージループが回す）
#pragma once

#include <windows.h>
#include <string>

struct QrWindowContent {
  std::wstring code;    // 8 文字のコード（空 = まだ用意できていない）
  std::wstring status;  // 承認を待っています（残り 9:30）など
};

// ウィンドウを作って出す。閉じられると WM_DESTROY のあとで onClosed を呼ぶ
HWND CreateQrWindow(HINSTANCE hinst, HWND owner, void (*onClosed)(void* context), void* context);
// 中身を変えて描き直す
void UpdateQrWindow(HWND hwnd, const QrWindowContent& content);
void UnregisterQrWindowClass(HINSTANCE hinst);

// 描く（確かめ用に、ウィンドウなしでも呼べる）。scale = DPI / 96
void PaintQrWindow(HDC dc, const RECT& rc, double scale, const QrWindowContent& content);
SIZE QrWindowSize(double scale);
