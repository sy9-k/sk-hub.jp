#include "qrwindow.h"

#include <algorithm>

#include "../common/config.h"
#include "../common/qr.h"
#include "../common/skhub.h"

namespace {

const wchar_t kClass[] = L"SKHubQrWindow";
const wchar_t kJapaneseFont[] = L"Yu Gothic UI";
const int kCloseId = 1;
const COLORREF kInk = RGB(17, 17, 17);
const COLORREF kMuted = RGB(90, 99, 113);
const COLORREF kAccent = RGB(37, 99, 235);
const COLORREF kLine = RGB(225, 228, 233);

struct State {
  QrWindowContent content;
  double scale;
  void (*onClosed)(void* context);
  void* context;
  HFONT buttonFont;
};

int S(double scale, int v) { return (int)(v * scale + 0.5); }

HFONT MakeFont(double scale, int px, int weight, const wchar_t* face) {
  return CreateFontW(-S(scale, px), 0, 0, 0, weight, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                     CLEARTYPE_QUALITY, DEFAULT_PITCH, face);
}

// 中央そろえで折り返して描き、高さを返す
int DrawBlock(HDC dc, const std::wstring& text, HFONT font, COLORREF color, int left, int right, int top) {
  HGDIOBJ old = SelectObject(dc, font);
  RECT calc = { left, top, right, top };
  DrawTextW(dc, text.c_str(), -1, &calc, DT_CENTER | DT_WORDBREAK | DT_NOPREFIX | DT_CALCRECT);
  const int height = calc.bottom - calc.top;
  RECT rc = { left, top, right, top + height };
  SetTextColor(dc, color);
  DrawTextW(dc, text.c_str(), -1, &rc, DT_CENTER | DT_WORDBREAK | DT_NOPREFIX);
  SelectObject(dc, old);
  return height;
}

LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  auto* st = reinterpret_cast<State*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  switch (msg) {
    case WM_NCCREATE:
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(reinterpret_cast<CREATESTRUCTW*>(lParam)->lpCreateParams));
      break;
    case WM_CREATE: {
      RECT rc;
      GetClientRect(hwnd, &rc);
      const int w = S(st->scale, 140), h = S(st->scale, 38);
      HWND button = CreateWindowExW(0, L"BUTTON", L"閉じる", WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON, (rc.right - w) / 2,
                                    rc.bottom - h - S(st->scale, 22), w, h, hwnd, reinterpret_cast<HMENU>((INT_PTR)kCloseId),
                                    reinterpret_cast<CREATESTRUCTW*>(lParam)->hInstance, nullptr);
      if (button) {
        SendMessageW(button, WM_SETFONT, reinterpret_cast<WPARAM>(st->buttonFont), TRUE);
        SetFocus(button);
      }
      return 0;
    }
    case WM_COMMAND:
      if (LOWORD(wParam) == kCloseId) DestroyWindow(hwnd);
      return 0;
    case WM_CTLCOLORBTN:
      return reinterpret_cast<LRESULT>(GetStockObject(WHITE_BRUSH));
    case WM_ERASEBKGND:
      return 1;
    case WM_PAINT: {
      PAINTSTRUCT ps;
      HDC dc = BeginPaint(hwnd, &ps);
      RECT rc;
      GetClientRect(hwnd, &rc);
      // ちらつかないよう、裏で描いてから写す
      HDC mem = CreateCompatibleDC(dc);
      HBITMAP bmp = CreateCompatibleBitmap(dc, rc.right, rc.bottom);
      HGDIOBJ old = SelectObject(mem, bmp);
      if (st) PaintQrWindow(mem, rc, st->scale, st->content);
      BitBlt(dc, 0, 0, rc.right, rc.bottom, mem, 0, 0, SRCCOPY);
      SelectObject(mem, old);
      DeleteObject(bmp);
      DeleteDC(mem);
      EndPaint(hwnd, &ps);
      return 0;
    }
    case WM_NCDESTROY:
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
      if (st) {
        auto onClosed = st->onClosed;
        void* context = st->context;
        DeleteObject(st->buttonFont);
        delete st;
        if (onClosed) onClosed(context);
      }
      break;
  }
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}

}  // namespace

SIZE QrWindowSize(double scale) {
  return { S(scale, 400), S(scale, 590) };
}

void PaintQrWindow(HDC dc, const RECT& rc, double scale, const QrWindowContent& content) {
  FillRect(dc, &rc, static_cast<HBRUSH>(GetStockObject(WHITE_BRUSH)));
  SetBkMode(dc, TRANSPARENT);
  HFONT title = MakeFont(scale, 21, FW_BOLD, kJapaneseFont);
  HFONT body = MakeFont(scale, 14, FW_NORMAL, kJapaneseFont);
  HFONT note = MakeFont(scale, 12, FW_NORMAL, kJapaneseFont);
  HFONT codeFont = MakeFont(scale, 30, FW_BOLD, L"Segoe UI");

  const int pad = S(scale, 28);
  const int left = rc.left + pad, right = rc.right - pad;
  int y = rc.top + S(scale, 26);
  y += DrawBlock(dc, L"スマートフォンで読み取ってください", title, kInk, left, right, y) + S(scale, 6);
  y += DrawBlock(dc, L"カメラで QR コードを読み取ると、承認のページが開きます。", body, kMuted, left, right, y) + S(scale, 16);

  const int side = std::min(right - left, S(scale, 264));
  RECT box = { (rc.left + rc.right - side) / 2, y, (rc.left + rc.right + side) / 2, y + side };
  if (!content.code.empty()) {
    qr::Paint(dc, box, qr::Encode(skhub::ToUtf8(L"https://" SKHUB_APPROVE_URL L"/?code=" + content.code)), 2);
  } else {
    // コードがない（用意している・期限切れなど）ときは、枠の中に状態を出す
    HBRUSH line = CreateSolidBrush(kLine);
    FrameRect(dc, &box, line);
    DeleteObject(line);
    RECT inner = { box.left + S(scale, 20), box.top, box.right - S(scale, 20), box.bottom };
    HGDIOBJ old = SelectObject(dc, body);
    const std::wstring text = content.status.empty() ? L"コードを用意しています…" : content.status;
    RECT calc = inner;
    DrawTextW(dc, text.c_str(), -1, &calc, DT_CENTER | DT_WORDBREAK | DT_NOPREFIX | DT_CALCRECT);
    const int h = calc.bottom - calc.top;
    inner.top = box.top + (side - h) / 2;
    inner.bottom = inner.top + h;
    SetTextColor(dc, kMuted);
    DrawTextW(dc, text.c_str(), -1, &inner, DT_CENTER | DT_WORDBREAK | DT_NOPREFIX);
    SelectObject(dc, old);
  }
  y += side + S(scale, 14);

  y += DrawBlock(dc, content.code.empty() ? L"----" : skhub::FormatCode(content.code), codeFont, kInk, left, right, y) + S(scale, 4);
  y += DrawBlock(dc, L"読み取れないときは " SKHUB_APPROVE_URL L" を開いて\nこのコードを入力してください。", note, kMuted, left, right, y) + S(scale, 10);
  if (!content.code.empty() && !content.status.empty()) DrawBlock(dc, content.status, note, kAccent, left, right, y);

  DeleteObject(title);
  DeleteObject(body);
  DeleteObject(note);
  DeleteObject(codeFont);
}

HWND CreateQrWindow(HINSTANCE hinst, HWND owner, void (*onClosed)(void* context), void* context) {
  WNDCLASSEXW wc = { sizeof(wc) };
  wc.lpfnWndProc = WndProc;
  wc.hInstance = hinst;
  wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  wc.lpszClassName = kClass;
  if (!RegisterClassExW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) return nullptr;

  UINT dpi = owner ? GetDpiForWindow(owner) : 0;
  if (!dpi) dpi = GetDpiForSystem();
  if (!dpi) dpi = 96;
  const double scale = dpi / 96.0;
  auto* st = new State{ {}, scale, onClosed, context, MakeFont(scale, 14, FW_NORMAL, kJapaneseFont) };

  const DWORD style = WS_POPUP | WS_CAPTION | WS_SYSMENU;
  const DWORD exStyle = WS_EX_TOPMOST | WS_EX_DLGMODALFRAME;
  const SIZE client = QrWindowSize(scale);
  RECT frame = { 0, 0, client.cx, client.cy };
  AdjustWindowRectExForDpi(&frame, style, FALSE, exStyle, dpi);
  const int w = frame.right - frame.left, h = frame.bottom - frame.top;
  MONITORINFO mi = { sizeof(mi) };
  GetMonitorInfoW(MonitorFromWindow(owner, MONITOR_DEFAULTTOPRIMARY), &mi);
  const int x = mi.rcWork.left + (mi.rcWork.right - mi.rcWork.left - w) / 2;
  const int y = mi.rcWork.top + std::max(0L, (mi.rcWork.bottom - mi.rcWork.top - h) / 2);

  // st はウィンドウが持ち、WM_NCDESTROY で消す（作るのに失敗したときも、そこで消えていることがあるので、ここでは消さない）
  HWND hwnd = CreateWindowExW(exStyle, kClass, L"QR コードで承認", style, x, y, w, h, owner, nullptr, hinst, st);
  if (!hwnd) return nullptr;
  ShowWindow(hwnd, SW_SHOW);
  SetForegroundWindow(hwnd);
  return hwnd;
}

void UpdateQrWindow(HWND hwnd, const QrWindowContent& content) {
  auto* st = reinterpret_cast<State*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (!st) return;
  st->content = content;
  InvalidateRect(hwnd, nullptr, FALSE);
}

void UnregisterQrWindowClass(HINSTANCE hinst) {
  UnregisterClassW(kClass, hinst);
}
