#include "qrwindow.h"

#include <algorithm>
#include <cmath>
#include <cwchar>
#include <vector>

#include "../common/config.h"
#include "../common/qr.h"
#include "../common/skhub.h"

namespace {

const wchar_t kClass[] = L"SKHubQrWindow";
const wchar_t kJapaneseFont[] = L"Yu Gothic UI";
enum : int { kCloseId = 1, kToggleId = 2, kIdEditId = 3, kPasswordEditId = 4, kSubmitId = 5 };
const UINT_PTR kTickId = 10;
const int kTickMs = 1000;
// コードの期限が切れてから、この秒数たったらウィンドウを閉じる（そのあいだに「期限切れ」を読めるように）
const int kCloseAfterExpiredSeconds = 10;
const COLORREF kInk = RGB(17, 17, 17);
const COLORREF kMuted = RGB(90, 99, 113);
const COLORREF kAccent = RGB(37, 99, 235);
const COLORREF kError = RGB(185, 28, 28);
const COLORREF kLine = RGB(225, 228, 233);
const COLORREF kBand = RGB(243, 245, 248);

// 合言葉: 色と図形の組み合わせ（8 通り）。この PC の設定（HKLM）に 0〜7 で入る
const COLORREF kSealColors[8] = { RGB(220, 38, 38), RGB(37, 99, 235), RGB(22, 163, 74), RGB(234, 179, 8),
                                  RGB(147, 51, 234), RGB(234, 88, 12), RGB(8, 145, 178), RGB(219, 39, 119) };
const wchar_t* const kSealNames[8] = { L"赤い丸", L"青い四角", L"緑の三角", L"黄色のひし形", L"紫の五角形", L"橙の六角形", L"水色の十字", L"桃色の星" };

struct State {
  QrWindowContent content;
  double scale = 1.0;
  void (*onClosed)(void* context) = nullptr;
  void* context = nullptr;
  QrWindowSubmitFn onSubmit = nullptr;
  HFONT buttonFont = nullptr;
  ULONGLONG deadline = 0;   // コードの期限（GetTickCount64）。コードが出ている間だけ
  bool hadCode = false;     // コードが出たことがある（そのあと消えたら、期限切れ）
  int expiredSeconds = 0;   // 期限切れになってから数えた秒数
  HWND closeButton = nullptr;
  HWND toggleButton = nullptr;
  HWND idEdit = nullptr;
  HWND passwordEdit = nullptr;
  HWND submitButton = nullptr;
};

int S(double scale, int v) { return (int)(v * scale + 0.5); }

HFONT MakeFont(double scale, int px, int weight, const wchar_t* face) {
  return CreateFontW(-S(scale, px), 0, 0, 0, weight, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
                     CLEARTYPE_QUALITY, DEFAULT_PITCH, face);
}

const wchar_t* TitleFor(bool form) {
  return form ? L"ID とパスワードでサインイン" : L"スマートフォンで読み取ってください";
}

const wchar_t* LeadFor(bool form) {
  return form ? L"つないだアカウントの ID とパスワードを入力してください。" : L"カメラで QR コードを読み取ると、承認のページが開きます。";
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

// 描かずに高さだけ測る（DrawBlock と同じ折り返し）
int Measure(HDC dc, const std::wstring& text, HFONT font, int left, int right) {
  HGDIOBJ old = SelectObject(dc, font);
  RECT calc = { left, 0, right, 0 };
  DrawTextW(dc, text.c_str(), -1, &calc, DT_CENTER | DT_WORDBREAK | DT_NOPREFIX | DT_CALCRECT);
  SelectObject(dc, old);
  return calc.bottom - calc.top;
}

// 左そろえで 1 行描く
void DrawLine(HDC dc, const std::wstring& text, HFONT font, COLORREF color, int left, int right, int top) {
  HGDIOBJ old = SelectObject(dc, font);
  SetTextColor(dc, color);
  RECT rc = { left, top, right, top + 200 };
  DrawTextW(dc, text.c_str(), -1, &rc, DT_LEFT | DT_SINGLELINE | DT_NOPREFIX | DT_END_ELLIPSIS);
  SelectObject(dc, old);
}

// 本文の上端（上の帯・タイトル・説明の下）。描くのと、入力欄を置くのに同じ値を使う
int BodyTop(HDC dc, const RECT& rc, double scale, bool form) {
  HFONT title = MakeFont(scale, 21, FW_BOLD, kJapaneseFont);
  HFONT body = MakeFont(scale, 14, FW_NORMAL, kJapaneseFont);
  const int pad = S(scale, 28);
  const int left = rc.left + pad, right = rc.right - pad;
  int y = rc.top + S(scale, 84) + S(scale, 22);
  y += Measure(dc, TitleFor(form), title, left, right) + S(scale, 6);
  y += Measure(dc, LeadFor(form), body, left, right) + S(scale, 16);
  DeleteObject(title);
  DeleteObject(body);
  return y;
}

// 残り時間（秒）。期限が過ぎていれば 0
ULONGLONG SecondsLeft(ULONGLONG deadline) {
  const ULONGLONG now = GetTickCount64();
  return deadline > now ? (deadline - now + 999) / 1000 : 0;
}

std::wstring ReadText(HWND edit) {
  const int len = GetWindowTextLengthW(edit);
  std::wstring text(len, L'\0');
  if (len > 0) GetWindowTextW(edit, &text[0], len + 1);
  return text;
}

// 入力欄・ボタンの位置と表示を、いまの状態に合わせる
void PlaceControls(HWND hwnd, State* st) {
  RECT rc;
  GetClientRect(hwnd, &rc);
  const double s = st->scale;
  const bool form = st->content.form;
  HDC dc = GetDC(hwnd);
  const int y0 = BodyTop(dc, rc, s, form);
  ReleaseDC(hwnd, dc);
  const int pad = S(s, 28);
  const int left = rc.left + pad, width = rc.right - rc.left - 2 * pad;
  MoveWindow(st->idEdit, left, y0 + S(s, 24), width, S(s, 30), TRUE);
  MoveWindow(st->passwordEdit, left, y0 + S(s, 90), width, S(s, 30), TRUE);
  MoveWindow(st->submitButton, left, y0 + S(s, 136), width, S(s, 38), TRUE);
  const int closeTop = rc.bottom - S(s, 38) - S(s, 22);
  MoveWindow(st->toggleButton, left, closeTop - S(s, 44), width, S(s, 34), TRUE);
  ShowWindow(st->idEdit, form ? SW_SHOW : SW_HIDE);
  ShowWindow(st->passwordEdit, form ? SW_SHOW : SW_HIDE);
  ShowWindow(st->submitButton, form ? SW_SHOW : SW_HIDE);
  ShowWindow(st->toggleButton, st->content.formAvailable ? SW_SHOW : SW_HIDE);
  SetWindowTextW(st->toggleButton, form ? L"QR コードで承認する" : L"ID とパスワードでサインイン");
}

// 入力された ID とパスワードで確かめる。成功すると、窓は閉じられる（st は使えなくなる）
void SubmitForm(HWND hwnd, State* st) {
  if (!st->onSubmit) return;
  std::wstring id = ReadText(st->idEdit);
  std::wstring password = ReadText(st->passwordEdit);
  SetWindowTextW(st->passwordEdit, L"");  // 画面に残さない
  std::wstring error;
  const bool ok = st->onSubmit(st->context, id, password, error);
  skhub::Wipe(id);
  skhub::Wipe(password);
  if (ok) return;  // 窓は閉じられている。st はもう使わない
  st->content.error = error.empty() ? L"ID かパスワードが違います" : error;
  InvalidateRect(hwnd, nullptr, FALSE);
  SetFocus(st->passwordEdit);
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
      HINSTANCE hinst = reinterpret_cast<CREATESTRUCTW*>(lParam)->hInstance;
      const int w = S(st->scale, 140), h = S(st->scale, 38);
      st->closeButton = CreateWindowExW(0, L"BUTTON", L"閉じる", WS_CHILD | WS_VISIBLE | WS_TABSTOP | BS_DEFPUSHBUTTON, (rc.right - w) / 2,
                                        rc.bottom - h - S(st->scale, 22), w, h, hwnd, reinterpret_cast<HMENU>((INT_PTR)kCloseId), hinst, nullptr);
      st->toggleButton = CreateWindowExW(0, L"BUTTON", L"", WS_CHILD | WS_TABSTOP | BS_PUSHBUTTON, 0, 0, 10, 10, hwnd,
                                         reinterpret_cast<HMENU>((INT_PTR)kToggleId), hinst, nullptr);
      st->idEdit = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_TABSTOP | ES_AUTOHSCROLL, 0, 0, 10, 10, hwnd,
                                   reinterpret_cast<HMENU>((INT_PTR)kIdEditId), hinst, nullptr);
      st->passwordEdit = CreateWindowExW(WS_EX_CLIENTEDGE, L"EDIT", L"", WS_CHILD | WS_TABSTOP | ES_AUTOHSCROLL | ES_PASSWORD, 0, 0, 10, 10,
                                         hwnd, reinterpret_cast<HMENU>((INT_PTR)kPasswordEditId), hinst, nullptr);
      st->submitButton = CreateWindowExW(0, L"BUTTON", L"サインイン", WS_CHILD | WS_TABSTOP | BS_DEFPUSHBUTTON, 0, 0, 10, 10, hwnd,
                                         reinterpret_cast<HMENU>((INT_PTR)kSubmitId), hinst, nullptr);
      for (HWND c : { st->closeButton, st->toggleButton, st->idEdit, st->passwordEdit, st->submitButton }) {
        if (c) SendMessageW(c, WM_SETFONT, reinterpret_cast<WPARAM>(st->buttonFont), TRUE);
      }
      SendMessageW(st->idEdit, EM_SETLIMITTEXT, 128, 0);
      SendMessageW(st->passwordEdit, EM_SETLIMITTEXT, 256, 0);
      PlaceControls(hwnd, st);
      if (st->closeButton) SetFocus(st->closeButton);
      // 残り時間を 1 秒ごとに描き直す
      SetTimer(hwnd, kTickId, kTickMs, nullptr);
      return 0;
    }
    case WM_TIMER:
      if (st && wParam == kTickId) {
        // 期限が切れたあと、しばらくして閉じる（入力中は閉じない）
        if (st->content.code.empty() && st->hadCode && !st->content.form && ++st->expiredSeconds >= kCloseAfterExpiredSeconds) {
          DestroyWindow(hwnd);
          return 0;
        }
        InvalidateRect(hwnd, nullptr, FALSE);
      }
      return 0;
    case WM_COMMAND:
      if (!st) return 0;
      switch (static_cast<int>(LOWORD(wParam))) {
        case kCloseId:
          DestroyWindow(hwnd);
          return 0;
        case kToggleId:
          if (HIWORD(wParam) != BN_CLICKED) return 0;
          st->content.form = !st->content.form;
          st->content.error.clear();
          PlaceControls(hwnd, st);
          SetFocus(st->content.form ? st->idEdit : st->toggleButton);
          InvalidateRect(hwnd, nullptr, FALSE);
          return 0;
        case kSubmitId:
          if (HIWORD(wParam) == BN_CLICKED) SubmitForm(hwnd, st);
          return 0;
      }
      return 0;
    case WM_CTLCOLORBTN:
      return reinterpret_cast<LRESULT>(GetStockObject(WHITE_BRUSH));
    case WM_CTLCOLOREDIT:
      return reinterpret_cast<LRESULT>(GetStockObject(WHITE_BRUSH));
    case WM_ERASEBKGND:
      return 1;
    case WM_PAINT: {
      PAINTSTRUCT ps;
      HDC dc = BeginPaint(hwnd, &ps);
      RECT rc;
      GetClientRect(hwnd, &rc);
      // ちらつかないよう、裏で描いてから写す（入力欄などの子ウィンドウは WS_CLIPCHILDREN で避ける）
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
  return { S(scale, 400), S(scale, 720) };
}

const wchar_t* SealName(int seal) {
  return kSealNames[((seal % 8) + 8) % 8];
}

void PaintSeal(HDC dc, const RECT& box, int seal) {
  const int i = ((seal % 8) + 8) % 8;
  HBRUSH brush = CreateSolidBrush(kSealColors[i]);
  HGDIOBJ oldBrush = SelectObject(dc, brush);
  HGDIOBJ oldPen = SelectObject(dc, GetStockObject(NULL_PEN));
  const double cx = (box.left + box.right) / 2.0, cy = (box.top + box.bottom) / 2.0;
  const double r = (box.right - box.left) / 2.0;
  const double pi = 3.14159265358979323846;

  if (i == 0) {
    Ellipse(dc, box.left, box.top, box.right, box.bottom);
  } else if (i == 1) {
    const int inset = (int)(r * 0.2);
    Rectangle(dc, box.left + inset, box.top + inset, box.right - inset, box.bottom - inset);
  } else if (i == 6) {
    // 十字: 腕の幅は半径の 0.4 倍
    const double w = r * 0.4;
    const double pts[12][2] = { { -w, -r }, { w, -r }, { w, -w }, { r, -w }, { r, w }, { w, w }, { w, r }, { -w, r }, { -w, w }, { -r, w }, { -r, -w }, { -w, -w } };
    std::vector<POINT> poly;
    for (auto& p : pts) poly.push_back({ (LONG)std::lround(cx + p[0]), (LONG)std::lround(cy + p[1]) });
    Polygon(dc, poly.data(), (int)poly.size());
  } else {
    // 三角（3）・ひし形（4）・五角形（5）・六角形（6）・星（10 点、外と内の半径を交互に）
    int n = i == 2 ? 3 : i == 3 ? 4 : i == 4 ? 5 : i == 5 ? 6 : 10;
    std::vector<POINT> poly;
    for (int k = 0; k < n; k++) {
      double radius = r;
      if (i == 7) radius = (k % 2 == 0) ? r : r * 0.45;
      const double angle = -pi / 2 + 2 * pi * k / n;
      poly.push_back({ (LONG)std::lround(cx + radius * std::cos(angle)), (LONG)std::lround(cy + radius * std::sin(angle)) });
    }
    Polygon(dc, poly.data(), (int)poly.size());
  }

  SelectObject(dc, oldPen);
  SelectObject(dc, oldBrush);
  DeleteObject(brush);
}

void PaintQrWindow(HDC dc, const RECT& rc, double scale, const QrWindowContent& content) {
  FillRect(dc, &rc, static_cast<HBRUSH>(GetStockObject(WHITE_BRUSH)));
  SetBkMode(dc, TRANSPARENT);
  HFONT title = MakeFont(scale, 21, FW_BOLD, kJapaneseFont);
  HFONT body = MakeFont(scale, 14, FW_NORMAL, kJapaneseFont);
  HFONT bodyBold = MakeFont(scale, 15, FW_BOLD, kJapaneseFont);
  HFONT note = MakeFont(scale, 12, FW_NORMAL, kJapaneseFont);
  HFONT codeFont = MakeFont(scale, 30, FW_BOLD, L"Segoe UI");

  const bool form = content.form;
  const int pad = S(scale, 28);
  const int left = rc.left + pad, right = rc.right - pad;

  // 上の帯: 要求元（この PC）と、合言葉。本物のウィンドウなら、いつも同じ合言葉が出る
  const int bandH = S(scale, 84);
  RECT band = { rc.left, rc.top, rc.right, rc.top + bandH };
  HBRUSH bandBrush = CreateSolidBrush(kBand);
  FillRect(dc, &band, bandBrush);
  DeleteObject(bandBrush);
  const int sealSize = S(scale, 52);
  const int sealLeft = rc.left + S(scale, 24);
  const int sealTop = band.top + (bandH - sealSize) / 2;
  PaintSeal(dc, { sealLeft, sealTop, sealLeft + sealSize, sealTop + sealSize }, content.seal);
  const int textLeft = sealLeft + sealSize + S(scale, 14);
  DrawLine(dc, L"合言葉: " + std::wstring(SealName(content.seal)), bodyBold, kInk, textLeft, right, band.top + S(scale, 20));
  DrawLine(dc, L"要求元: この PC（" + (content.pcName.empty() ? std::wstring(L"名前のない PC") : content.pcName) + L"）", note, kMuted, textLeft,
           right, band.top + S(scale, 48));

  int y = band.bottom + S(scale, 22);
  y += DrawBlock(dc, TitleFor(form), title, kInk, left, right, y) + S(scale, 6);
  y += DrawBlock(dc, LeadFor(form), body, kMuted, left, right, y) + S(scale, 16);

  if (form) {
    // ID とパスワードの入力（入力欄は子ウィンドウ。ここでは見出しとエラーだけ描く）
    DrawLine(dc, L"ID", bodyBold, kInk, left, right, y);
    DrawLine(dc, L"パスワード", bodyBold, kInk, left, right, y + S(scale, 66));
    if (!content.error.empty()) DrawBlock(dc, content.error, note, kError, left, right, y + S(scale, 186));
  } else {
    const int side = std::min(right - left, S(scale, 240));
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
    if (!content.code.empty()) {
      // 残り時間は、ウィンドウが数える（1 秒ごとに描き直す）
      const ULONGLONG remaining = SecondsLeft(content.deadline);
      wchar_t line[96];
      if (remaining > 0) swprintf_s(line, L"承認を待っています（残り %llu:%02llu）", remaining / 60, remaining % 60);
      else wcscpy_s(line, L"有効期限が切れました");
      DrawBlock(dc, line, note, kAccent, left, right, y);
    }
  }

  DeleteObject(title);
  DeleteObject(body);
  DeleteObject(bodyBold);
  DeleteObject(note);
  DeleteObject(codeFont);
}

HWND CreateQrWindow(HINSTANCE hinst, HWND owner, void (*onClosed)(void* context), void* context, QrWindowSubmitFn onSubmit) {
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
  auto* st = new State();
  st->scale = scale;
  st->onClosed = onClosed;
  st->context = context;
  st->onSubmit = onSubmit;
  st->buttonFont = MakeFont(scale, 14, FW_NORMAL, kJapaneseFont);

  // 入力欄を子ウィンドウに置くので、親の描き直しで消えないように WS_CLIPCHILDREN を付ける
  const DWORD style = WS_POPUP | WS_CAPTION | WS_SYSMENU | WS_CLIPCHILDREN;
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
  HWND hwnd = CreateWindowExW(exStyle, kClass, L"SK Hub でサインイン", style, x, y, w, h, owner, nullptr, hinst, st);
  if (!hwnd) return nullptr;
  ShowWindow(hwnd, SW_SHOW);
  SetForegroundWindow(hwnd);
  return hwnd;
}

void UpdateQrWindow(HWND hwnd, const QrWindowContent& content) {
  auto* st = reinterpret_cast<State*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA));
  if (!st) return;
  // コードが出た時点から期限を数える（コードが変わったら、数え直す）
  if (content.code.empty()) {
    st->deadline = 0;
  } else if (content.code != st->content.code || st->deadline == 0) {
    st->deadline = GetTickCount64() + SKHUB_CODE_TTL_SECONDS * 1000ULL;
    st->expiredSeconds = 0;
  }
  if (!content.code.empty()) st->hadCode = true;
  // 入力の状態（form・error）は、ウィンドウが持つ。状況の更新で消さない
  const bool form = st->content.form;
  const std::wstring error = st->content.error;
  st->content = content;
  st->content.form = form;
  st->content.error = error;
  st->content.deadline = st->deadline;
  PlaceControls(hwnd, st);
  InvalidateRect(hwnd, nullptr, FALSE);
}

void UnregisterQrWindowClass(HINSTANCE hinst) {
  UnregisterClassW(kClass, hinst);
}
