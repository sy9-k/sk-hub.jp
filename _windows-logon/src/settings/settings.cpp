// SK Hub で Windows にサインイン — 設定（ウィンドウ版。管理者として動く）
//   最初の画面: サインイン画面に入っているか（追加・外す）と、つないだアカウントの一覧（つなぐ・外す）
//   「アカウントをつなぐ」: Windows のユーザーとパスワード → QR コード（スマートフォンで承認）→ つなぎました
//   入れる・外す・パスワードの確認は common/admin.cpp、承認の流れは common/skhub.cpp（コマンド版の skhub-logon-setup と同じ）
#include <windows.h>
#include <commctrl.h>
#include <uxtheme.h>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "../common/admin.h"
#include "../common/config.h"
#include "../common/qr.h"
#include "../common/skhub.h"
#include "resource.h"

namespace {

HINSTANCE g_hinst = nullptr;
HWND g_main = nullptr;
HWND g_link = nullptr;

const wchar_t kMainClass[] = L"SKHubLogonSettings";
const wchar_t kLinkClass[] = L"SKHubLogonSettingsLink";
const UINT WM_APP_REFRESH = WM_APP + 1;
const UINT WM_APP_LINK = WM_APP + 2;  // wParam = LinkFlow の id

const COLORREF kInk = RGB(17, 17, 17);
const COLORREF kMuted = RGB(90, 99, 113);
const COLORREF kAccent = RGB(37, 99, 235);
const COLORREF kGreen = RGB(22, 128, 61);
const COLORREF kRed = RGB(180, 35, 24);
const COLORREF kLine = RGB(225, 228, 233);

// ---------- 部品 ----------

struct Fonts {
  UINT dpi = 96;
  HFONT title = nullptr, heading = nullptr, body = nullptr, note = nullptr, code = nullptr;

  int S(int v) const { return MulDiv(v, dpi, 96); }
  HFONT Make(int px, int weight, const wchar_t* face = L"Yu Gothic UI") const {
    return CreateFontW(-S(px), 0, 0, 0, weight, FALSE, FALSE, FALSE, DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS, CLEARTYPE_QUALITY,
                       DEFAULT_PITCH, face);
  }
  void Create(UINT newDpi) {
    Destroy();
    dpi = newDpi ? newDpi : 96;
    title = Make(24, FW_BOLD);
    heading = Make(15, FW_BOLD);
    body = Make(14, FW_NORMAL);
    note = Make(12, FW_NORMAL);
    code = Make(34, FW_BOLD, L"Segoe UI");
  }
  void Destroy() {
    for (HFONT* f : { &title, &heading, &body, &note, &code }) {
      if (*f) DeleteObject(*f);
      *f = nullptr;
    }
  }
};

HWND Control(HWND parent, const wchar_t* cls, const wchar_t* text, DWORD style, int id, DWORD exStyle = 0) {
  return CreateWindowExW(exStyle, cls, text, WS_CHILD | WS_VISIBLE | style, 0, 0, 0, 0, parent, reinterpret_cast<HMENU>((INT_PTR)id), g_hinst, nullptr);
}

void SetFont(HWND parent, int id, HFONT font) {
  SendMessageW(GetDlgItem(parent, id), WM_SETFONT, reinterpret_cast<WPARAM>(font), TRUE);
}

void Place(HWND parent, int id, int x, int y, int w, int h) {
  SetWindowPos(GetDlgItem(parent, id), nullptr, x, y, w, h, SWP_NOZORDER | SWP_NOACTIVATE);
}

void Show(HWND parent, int id, bool visible) {
  ShowWindow(GetDlgItem(parent, id), visible ? SW_SHOWNA : SW_HIDE);
}

// 出すことにしているか（IsWindowVisible は、親のウィンドウがまだ出ていないと false になるので使わない）
bool Shown(HWND parent, int id) {
  return (GetWindowLongW(GetDlgItem(parent, id), GWL_STYLE) & WS_VISIBLE) != 0;
}

std::wstring Text(HWND parent, int id) {
  HWND h = GetDlgItem(parent, id);
  std::wstring s(GetWindowTextLengthW(h) + 1, L'\0');
  s.resize(GetWindowTextW(h, &s[0], (int)s.size()));
  return s;
}

// 折り返したときの高さ
int TextHeight(HWND hwnd, HFONT font, const std::wstring& text, int width) {
  HDC dc = GetDC(hwnd);
  HGDIOBJ old = SelectObject(dc, font);
  RECT r = { 0, 0, width, 0 };
  DrawTextW(dc, text.empty() ? L" " : text.c_str(), -1, &r, DT_WORDBREAK | DT_CALCRECT | DT_NOPREFIX);
  SelectObject(dc, old);
  ReleaseDC(hwnd, dc);
  return r.bottom;
}

void ResizeClient(HWND hwnd, int w, int h, UINT dpi) {
  RECT r = { 0, 0, w, h };
  AdjustWindowRectExForDpi(&r, (DWORD)GetWindowLongW(hwnd, GWL_STYLE), FALSE, (DWORD)GetWindowLongW(hwnd, GWL_EXSTYLE), dpi);
  SetWindowPos(hwnd, nullptr, 0, 0, r.right - r.left, r.bottom - r.top, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
}

void CenterOn(HWND hwnd, HWND parent) {
  RECT r, p;
  GetWindowRect(hwnd, &r);
  if (parent) {
    GetWindowRect(parent, &p);
  } else {
    MONITORINFO mi = { sizeof(mi) };
    GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTOPRIMARY), &mi);
    p = mi.rcWork;
  }
  const int x = p.left + ((p.right - p.left) - (r.right - r.left)) / 2;
  const int y = p.top + ((p.bottom - p.top) - (r.bottom - r.top)) / 2;
  SetWindowPos(hwnd, nullptr, x, y > 0 ? y : 0, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
}

bool Confirm(HWND owner, const wchar_t* text) {
  return MessageBoxW(owner, text, L"Sign in with SK Hub", MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2) == IDYES;
}

void Alert(HWND owner, const std::wstring& text) {
  MessageBoxW(owner, text.c_str(), L"Sign in with SK Hub", MB_OK | MB_ICONWARNING);
}

// ---------- 最初の画面 ----------

enum MainId {
  IDC_TITLE = 100,
  IDC_LEAD,
  IDC_H_SCREEN,
  IDC_SCREEN_STATUS,
  IDC_SCREEN_BUTTON,
  IDC_H_ACCOUNTS,
  IDC_LIST,
  IDC_ADD,
  IDC_ADD_OF8,
  IDC_REMOVE,
  IDC_NOTE,
};

struct MainState {
  Fonts fonts;
  bool installed = false;
  std::vector<skhub::LinkedUser> users;
  int separators[2] = {};
};

MainState* MainOf(HWND hwnd) { return reinterpret_cast<MainState*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA)); }

void OpenLinkWindow(HWND owner, bool of8);

// 一覧の「アカウント」の列（0F8 はメールアドレス、SK Hub Systems アカウントは UID）
std::wstring AccountText(const skhub::LinkedUser& user) {
  if (skhub::IsOf8LinkId(user.uid)) return L"0F8: " + (user.label.empty() ? user.uid.substr(4) : user.label);
  return L"SK Hub: " + user.uid;
}

void RefreshMain(HWND hwnd) {
  MainState* st = MainOf(hwnd);
  st->installed = skhub::IsProviderInstalled();
  SetDlgItemTextW(hwnd, IDC_SCREEN_STATUS,
                  st->installed ? L"●  サインイン画面に「Sign in with SK Hub」が出ています" : L"サインイン画面には、まだ追加されていません");
  SetDlgItemTextW(hwnd, IDC_SCREEN_BUTTON, st->installed ? L"サインイン画面から外す" : L"サインイン画面に追加");
  InvalidateRect(GetDlgItem(hwnd, IDC_SCREEN_STATUS), nullptr, TRUE);

  skhub::ListLinkedUsers(st->users);
  HWND list = GetDlgItem(hwnd, IDC_LIST);
  ListView_DeleteAllItems(list);
  for (int i = 0; i < (int)st->users.size(); i++) {
    std::wstring user = skhub::DisplayUser(st->users[i].domain, st->users[i].userName);
    LVITEMW item = {};
    item.mask = LVIF_TEXT | LVIF_PARAM;
    item.iItem = i;
    item.pszText = &user[0];
    item.lParam = i;
    ListView_InsertItem(list, &item);
    std::wstring account = AccountText(st->users[i]);
    ListView_SetItemText(list, i, 1, &account[0]);
  }
  EnableWindow(GetDlgItem(hwnd, IDC_REMOVE), FALSE);
}

// 置いて、使った高さを返す
int LayoutMain(HWND hwnd) {
  MainState* st = MainOf(hwnd);
  const Fonts& f = st->fonts;
  const int width = f.S(600);
  const int m = f.S(32), w = width - m * 2;
  int y = f.S(28);
  int h = TextHeight(hwnd, f.title, Text(hwnd, IDC_TITLE), w);
  Place(hwnd, IDC_TITLE, m, y, w, h);
  y += h + f.S(6);
  h = TextHeight(hwnd, f.body, Text(hwnd, IDC_LEAD), w);
  Place(hwnd, IDC_LEAD, m, y, w, h);
  y += h + f.S(22);

  st->separators[0] = y;
  y += f.S(20);
  Place(hwnd, IDC_H_SCREEN, m, y, w, f.S(24));
  y += f.S(32);
  const int buttonW = f.S(210), buttonH = f.S(34);
  Place(hwnd, IDC_SCREEN_STATUS, m, y, w - buttonW - f.S(12), buttonH);
  Place(hwnd, IDC_SCREEN_BUTTON, m + w - buttonW, y, buttonW, buttonH);
  y += buttonH + f.S(22);

  st->separators[1] = y;
  y += f.S(20);
  Place(hwnd, IDC_H_ACCOUNTS, m, y, w, f.S(24));
  y += f.S(32);
  const int listH = f.S(170);
  Place(hwnd, IDC_LIST, m, y, w, listH);
  HWND list = GetDlgItem(hwnd, IDC_LIST);
  ListView_SetColumnWidth(list, 0, f.S(230));
  ListView_SetColumnWidth(list, 1, w - f.S(230) - GetSystemMetricsForDpi(SM_CXVSCROLL, f.dpi) - f.S(4));
  y += listH + f.S(12);
  Place(hwnd, IDC_ADD, m, y, f.S(190), buttonH);
  Place(hwnd, IDC_ADD_OF8, m + f.S(200), y, f.S(220), buttonH);
  Place(hwnd, IDC_REMOVE, m + w - f.S(100), y, f.S(100), buttonH);
  y += buttonH + f.S(22);
  h = TextHeight(hwnd, f.note, Text(hwnd, IDC_NOTE), w);
  Place(hwnd, IDC_NOTE, m, y, w, h);
  y += h + f.S(26);
  InvalidateRect(hwnd, nullptr, TRUE);
  return y;
}

void ApplyMainFonts(HWND hwnd) {
  const Fonts& f = MainOf(hwnd)->fonts;
  SetFont(hwnd, IDC_TITLE, f.title);
  SetFont(hwnd, IDC_LEAD, f.body);
  SetFont(hwnd, IDC_H_SCREEN, f.heading);
  SetFont(hwnd, IDC_SCREEN_STATUS, f.body);
  SetFont(hwnd, IDC_SCREEN_BUTTON, f.body);
  SetFont(hwnd, IDC_H_ACCOUNTS, f.heading);
  SetFont(hwnd, IDC_LIST, f.body);
  SetFont(hwnd, IDC_ADD, f.body);
  SetFont(hwnd, IDC_ADD_OF8, f.body);
  SetFont(hwnd, IDC_REMOVE, f.body);
  SetFont(hwnd, IDC_NOTE, f.note);
}

void OnScreenButton(HWND hwnd) {
  MainState* st = MainOf(hwnd);
  std::wstring error;
  if (st->installed) {
    if (!Confirm(hwnd, L"サインイン画面から「Sign in with SK Hub」を外しますか？\n\nつないだアカウントと、保存した Windows のパスワードも消えます。")) return;
    if (FAILED(skhub::UninstallProvider(error))) Alert(hwnd, error);
  } else {
    std::wstring path;
    HCURSOR old = SetCursor(LoadCursorW(nullptr, IDC_WAIT));
    HRESULT hr = skhub::InstallProvider(skhub::ExeDir(), path, error);
    SetCursor(old);
    if (FAILED(hr)) Alert(hwnd, error);
  }
  RefreshMain(hwnd);
}

void OnRemove(HWND hwnd) {
  MainState* st = MainOf(hwnd);
  const int index = ListView_GetNextItem(GetDlgItem(hwnd, IDC_LIST), -1, LVNI_SELECTED);
  if (index < 0 || index >= (int)st->users.size()) return;
  const skhub::LinkedUser& user = st->users[index];
  const std::wstring text = skhub::DisplayUser(user.domain, user.userName) + L" と SK Hub Systems アカウントのつながりを外しますか？\n\n保存した Windows のパスワードも消えます。";
  if (!Confirm(hwnd, text.c_str())) return;
  HRESULT hr = skhub::RemoveLinkedUser(user.uid);
  if (FAILED(hr)) Alert(hwnd, L"外せませんでした: " + skhub::ErrorText(hr));
  RefreshMain(hwnd);
}

LRESULT CALLBACK MainProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  MainState* st = MainOf(hwnd);
  switch (msg) {
    case WM_CREATE: {
      st = new MainState();
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(st));
      st->fonts.Create(GetDpiForWindow(hwnd));
      Control(hwnd, L"STATIC", L"Sign in with SK Hub", SS_NOPREFIX, IDC_TITLE);
      Control(hwnd, L"STATIC",
              L"スマートフォンで承認するだけで、Windows にサインインできるようにします。",
              SS_NOPREFIX, IDC_LEAD);
      Control(hwnd, L"STATIC", L"サインイン画面", SS_NOPREFIX, IDC_H_SCREEN);
      Control(hwnd, L"STATIC", L"", SS_NOPREFIX | SS_CENTERIMAGE, IDC_SCREEN_STATUS);
      Control(hwnd, L"BUTTON", L"", BS_PUSHBUTTON | WS_TABSTOP, IDC_SCREEN_BUTTON);
      Control(hwnd, L"STATIC", L"つないだアカウント", SS_NOPREFIX, IDC_H_ACCOUNTS);
      HWND list = Control(hwnd, WC_LISTVIEWW, L"", LVS_REPORT | LVS_SINGLESEL | LVS_SHOWSELALWAYS | LVS_NOSORTHEADER | WS_TABSTOP, IDC_LIST,
                          WS_EX_CLIENTEDGE);
      SetWindowTheme(list, L"Explorer", nullptr);
      ListView_SetExtendedListViewStyle(list, LVS_EX_FULLROWSELECT | LVS_EX_DOUBLEBUFFER);
      LVCOLUMNW col = {};
      col.mask = LVCF_TEXT | LVCF_WIDTH;
      col.pszText = const_cast<LPWSTR>(L"Windows のユーザー");
      col.cx = 200;
      ListView_InsertColumn(list, 0, &col);
      col.pszText = const_cast<LPWSTR>(L"アカウント");
      ListView_InsertColumn(list, 1, &col);
      Control(hwnd, L"BUTTON", L"アカウントをつなぐ…", BS_DEFPUSHBUTTON | WS_TABSTOP, IDC_ADD);
      Control(hwnd, L"BUTTON", L"0F8 アカウントをつなぐ…", BS_PUSHBUTTON | WS_TABSTOP, IDC_ADD_OF8);
      Control(hwnd, L"BUTTON", L"外す", BS_PUSHBUTTON | WS_TABSTOP, IDC_REMOVE);
      Control(hwnd, L"STATIC",
              L"パスワード・PIN・Windows Hello でのサインインは、これまでどおり使えます。Windows のパスワードを変えたら、アカウントをつなぎ直してください。",
              SS_NOPREFIX, IDC_NOTE);
      ApplyMainFonts(hwnd);
      RefreshMain(hwnd);
      ResizeClient(hwnd, st->fonts.S(600), LayoutMain(hwnd), st->fonts.dpi);
      return 0;
    }
    case WM_DPICHANGED: {
      st->fonts.Create(HIWORD(wParam));
      ApplyMainFonts(hwnd);
      const RECT* suggested = reinterpret_cast<RECT*>(lParam);
      SetWindowPos(hwnd, nullptr, suggested->left, suggested->top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
      ResizeClient(hwnd, st->fonts.S(600), LayoutMain(hwnd), st->fonts.dpi);
      return 0;
    }
    case WM_CTLCOLORSTATIC: {
      HDC dc = reinterpret_cast<HDC>(wParam);
      const int id = GetDlgCtrlID(reinterpret_cast<HWND>(lParam));
      COLORREF color = kInk;
      if (id == IDC_LEAD || id == IDC_NOTE) color = kMuted;
      if (id == IDC_SCREEN_STATUS) color = st->installed ? kGreen : kMuted;
      SetTextColor(dc, color);
      SetBkColor(dc, RGB(255, 255, 255));
      return reinterpret_cast<LRESULT>(GetStockObject(WHITE_BRUSH));
    }
    case WM_PAINT: {
      PAINTSTRUCT ps;
      HDC dc = BeginPaint(hwnd, &ps);
      RECT rc;
      GetClientRect(hwnd, &rc);
      HBRUSH line = CreateSolidBrush(kLine);
      const int m = st->fonts.S(32);
      for (int y : st->separators) {
        RECT r = { m, y, rc.right - m, y + 1 };
        FillRect(dc, &r, line);
      }
      DeleteObject(line);
      EndPaint(hwnd, &ps);
      return 0;
    }
    case WM_COMMAND:
      switch (LOWORD(wParam)) {
        case IDC_SCREEN_BUTTON: OnScreenButton(hwnd); break;
        case IDC_ADD: OpenLinkWindow(hwnd, false); break;
        case IDC_ADD_OF8: OpenLinkWindow(hwnd, true); break;
        case IDC_REMOVE: OnRemove(hwnd); break;
      }
      return 0;
    case WM_NOTIFY: {
      auto* hdr = reinterpret_cast<NMHDR*>(lParam);
      if (hdr->idFrom == IDC_LIST && hdr->code == LVN_ITEMCHANGED)
        EnableWindow(GetDlgItem(hwnd, IDC_REMOVE), ListView_GetNextItem(hdr->hwndFrom, -1, LVNI_SELECTED) >= 0);
      return 0;
    }
    case WM_APP_REFRESH:
      RefreshMain(hwnd);
      return 0;
    case WM_DESTROY:
      PostQuitMessage(0);
      return 0;
    case WM_NCDESTROY:
      if (st) {
        st->fonts.Destroy();
        delete st;
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
      }
      break;
  }
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}

// ---------- アカウントをつなぐ ----------

enum LinkId {
  IDL_NEXT = IDOK,  // Enter
  IDL_CANCEL = IDCANCEL,  // Esc
  IDL_TITLE = 200,
  IDL_LEAD,
  IDL_USER_LABEL,
  IDL_USER,
  IDL_PASSWORD_LABEL,
  IDL_PASSWORD,
  IDL_ERROR,
  IDL_CODE,
  IDL_STATUS,
  IDL_RETRY,
  IDL_OF8_EMAIL_LABEL,  // 0F8 アカウントをつなぐときだけ
  IDL_OF8_EMAIL,
  IDL_OF8_PASSWORD_LABEL,
  IDL_OF8_PASSWORD,
};

// 承認を待つスレッドと、画面のあいだで共有するもの（lock で守る）
struct LinkFlow {
  UINT id = 0;
  HWND hwnd = nullptr;
  HANDLE stop = nullptr;
  SRWLOCK lock = SRWLOCK_INIT;
  std::wstring code, status, uid;
  int result = 0;  // 0 = 待っている、1 = 承認された、2 = 失敗（やり直せる）
  ~LinkFlow() { if (stop) CloseHandle(stop); }
};

struct LinkState {
  Fonts fonts;
  bool of8 = false;  // 0F8 アカウントをつなぐ（QR コードの代わりに、0F8 のメールアドレスとパスワードを確かめる）
  int page = 1;  // 1 = ユーザーとパスワード、2 = QR コード、3 = つなぎました
  std::wstring domain, user, password;
  std::shared_ptr<LinkFlow> flow;
  UINT nextFlowId = 1;
  std::wstring code;
  bool failed = false;
  RECT qr = {};
};

LinkState* LinkOf(HWND hwnd) { return reinterpret_cast<LinkState*>(GetWindowLongPtrW(hwnd, GWLP_USERDATA)); }

std::wstring Waiting(ULONGLONG deadline) {
  ULONGLONG now = GetTickCount64();
  ULONGLONG left = deadline > now ? (deadline - now + 999) / 1000 : 0;
  wchar_t buf[96];
  swprintf_s(buf, L"スマートフォンで承認されるのを待っています（残り %llu:%02llu）", left / 60, left % 60);
  return buf;
}

void RunLinkFlow(std::shared_ptr<LinkFlow> f) {
  auto set = [&](const std::wstring* code, const std::wstring& status, int result, const std::wstring& uid = L"") {
    AcquireSRWLockExclusive(&f->lock);
    if (code) f->code = *code;
    f->status = status;
    f->result = result;
    if (!uid.empty()) f->uid = uid;
    ReleaseSRWLockExclusive(&f->lock);
    PostMessageW(f->hwnd, WM_APP_LINK, f->id, 0);
  };
  const std::wstring none;
  skhub::DeviceToken token;
  std::wstring code, error;
  set(&none, L"コードを発行しています…", 0);
  if (FAILED(skhub::CreateRequest(token, skhub::Purpose::Register, code, error))) {
    set(nullptr, error, 2);
    return;
  }
  const ULONGLONG deadline = GetTickCount64() + SKHUB_CODE_TTL_SECONDS * 1000ULL;
  set(&code, Waiting(deadline), 0);
  int failures = 0;
  while (WaitForSingleObject(f->stop, 2000) != WAIT_OBJECT_0) {
    if (GetTickCount64() >= deadline) {
      set(&none, L"コードの有効期限が切れました。", 2);
      break;
    }
    skhub::RequestState state;
    std::wstring uid;
    if (FAILED(skhub::CheckRequest(token, code, state, uid, error))) {
      if (++failures >= 5) {
        set(&none, error, 2);
        break;
      }
      continue;
    }
    failures = 0;
    if (state == skhub::RequestState::Pending) {
      set(nullptr, Waiting(deadline), 0);
    } else if (state == skhub::RequestState::Approved) {
      set(nullptr, L"承認されました", 1, uid);
      break;
    } else {
      set(&none, state == skhub::RequestState::Denied ? L"スマートフォンで拒否されました。" : L"コードが見つからなくなりました。", 2);
      break;
    }
  }
  skhub::DeleteRequest(token, code);
}

void StopLinkFlow(LinkState* st) {
  if (!st->flow) return;
  SetEvent(st->flow->stop);
  st->flow.reset();
}

void StartLinkFlow(HWND hwnd) {
  LinkState* st = LinkOf(hwnd);
  StopLinkFlow(st);
  auto flow = std::make_shared<LinkFlow>();
  flow->id = st->nextFlowId++;
  flow->hwnd = hwnd;
  flow->stop = CreateEventW(nullptr, TRUE, FALSE, nullptr);
  st->flow = flow;
  st->code.clear();
  st->failed = false;
  std::thread([flow] { RunLinkFlow(flow); }).detach();
}

int LayoutLink(HWND hwnd) {
  LinkState* st = LinkOf(hwnd);
  const Fonts& f = st->fonts;
  const int width = f.S(460);
  const int m = f.S(28), w = width - m * 2;
  const int buttonH = f.S(34);
  int y = f.S(24);
  int h = TextHeight(hwnd, f.title, Text(hwnd, IDL_TITLE), w);
  Place(hwnd, IDL_TITLE, m, y, w, h);
  y += h + f.S(6);
  h = TextHeight(hwnd, f.body, Text(hwnd, IDL_LEAD), w);
  Place(hwnd, IDL_LEAD, m, y, w, h);
  y += h + f.S(20);

  if (st->page == 1) {
    Place(hwnd, IDL_USER_LABEL, m, y, w, f.S(22));
    y += f.S(24);
    Place(hwnd, IDL_USER, m, y, w, f.S(300));  // 高さはドロップダウンの分も含む
    RECT combo;
    GetWindowRect(GetDlgItem(hwnd, IDL_USER), &combo);
    y += (combo.bottom - combo.top) + f.S(16);
    Place(hwnd, IDL_PASSWORD_LABEL, m, y, w, f.S(22));
    y += f.S(24);
    Place(hwnd, IDL_PASSWORD, m, y, w, f.S(32));
    y += f.S(32) + f.S(10);
    if (st->of8) {
      y += f.S(6);
      Place(hwnd, IDL_OF8_EMAIL_LABEL, m, y, w, f.S(22));
      y += f.S(24);
      Place(hwnd, IDL_OF8_EMAIL, m, y, w, f.S(32));
      y += f.S(32) + f.S(16);
      Place(hwnd, IDL_OF8_PASSWORD_LABEL, m, y, w, f.S(22));
      y += f.S(24);
      Place(hwnd, IDL_OF8_PASSWORD, m, y, w, f.S(32));
      y += f.S(32) + f.S(10);
    }
    h = TextHeight(hwnd, f.note, Text(hwnd, IDL_ERROR), w);
    Place(hwnd, IDL_ERROR, m, y, w, h);
    y += h + f.S(16);
  } else if (st->page == 2) {
    const int side = f.S(250);
    st->qr = { (width - side) / 2, y, (width + side) / 2, y + side };
    y += side + f.S(10);
    Place(hwnd, IDL_CODE, m, y, w, f.S(48));
    y += f.S(52);
    h = TextHeight(hwnd, f.note, Text(hwnd, IDL_STATUS), w);
    Place(hwnd, IDL_STATUS, m, y, w, h);
    y += h + f.S(20);
  }

  // ボタン（右下）
  const int bw = f.S(120), gap = f.S(10);
  int x = width - m;
  if (Shown(hwnd, IDL_CANCEL)) {
    x -= bw;
    Place(hwnd, IDL_CANCEL, x, y, bw, buttonH);
    x -= gap;
  }
  if (Shown(hwnd, IDL_NEXT)) {
    x -= bw;
    Place(hwnd, IDL_NEXT, x, y, bw, buttonH);
    x -= gap;
  }
  if (Shown(hwnd, IDL_RETRY)) {
    const int rw = f.S(170);
    x -= rw;
    Place(hwnd, IDL_RETRY, x, y, rw, buttonH);
  }
  y += buttonH + f.S(24);
  InvalidateRect(hwnd, nullptr, TRUE);
  return y;
}

void RelayoutLink(HWND hwnd) {
  LinkState* st = LinkOf(hwnd);
  ResizeClient(hwnd, st->fonts.S(460), LayoutLink(hwnd), st->fonts.dpi);
}

void ApplyLinkFonts(HWND hwnd) {
  const Fonts& f = LinkOf(hwnd)->fonts;
  SetFont(hwnd, IDL_TITLE, f.title);
  SetFont(hwnd, IDL_LEAD, f.body);
  SetFont(hwnd, IDL_USER_LABEL, f.heading);
  SetFont(hwnd, IDL_USER, f.body);
  SetFont(hwnd, IDL_PASSWORD_LABEL, f.heading);
  SetFont(hwnd, IDL_PASSWORD, f.body);
  SetFont(hwnd, IDL_ERROR, f.note);
  SetFont(hwnd, IDL_CODE, f.code);
  SetFont(hwnd, IDL_STATUS, f.note);
  SetFont(hwnd, IDL_NEXT, f.body);
  SetFont(hwnd, IDL_CANCEL, f.body);
  SetFont(hwnd, IDL_RETRY, f.body);
  SetFont(hwnd, IDL_OF8_EMAIL_LABEL, f.heading);
  SetFont(hwnd, IDL_OF8_EMAIL, f.body);
  SetFont(hwnd, IDL_OF8_PASSWORD_LABEL, f.heading);
  SetFont(hwnd, IDL_OF8_PASSWORD, f.body);
}

void ShowLinkPage(HWND hwnd, int page, const std::wstring& doneText = L"") {
  LinkState* st = LinkOf(hwnd);
  st->page = page;
  for (int id : { IDL_USER_LABEL, IDL_USER, IDL_PASSWORD_LABEL, IDL_PASSWORD, IDL_ERROR }) Show(hwnd, id, page == 1);
  for (int id : { IDL_OF8_EMAIL_LABEL, IDL_OF8_EMAIL, IDL_OF8_PASSWORD_LABEL, IDL_OF8_PASSWORD }) Show(hwnd, id, page == 1 && st->of8);
  for (int id : { IDL_CODE, IDL_STATUS }) Show(hwnd, id, page == 2);
  Show(hwnd, IDL_RETRY, page == 2 && st->failed);
  Show(hwnd, IDL_NEXT, page != 2);
  Show(hwnd, IDL_CANCEL, page != 3);
  if (page == 1) {
    SetDlgItemTextW(hwnd, IDL_TITLE, st->of8 ? L"0F8 アカウントをつなぐ" : L"アカウントをつなぐ");
    SetDlgItemTextW(hwnd, IDL_LEAD, st->of8 ? L"つなぐ Windows のユーザーとパスワード、0F8 アカウントのメールアドレスとパスワードを入力してください。"
                                            : L"つなぐ Windows のユーザーを選んで、そのユーザーの Windows のパスワードを入力してください。");
    SetDlgItemTextW(hwnd, IDL_NEXT, st->of8 ? L"つなぐ" : L"次へ");
    SetDlgItemTextW(hwnd, IDL_CANCEL, L"キャンセル");
  } else if (page == 2) {
    SetDlgItemTextW(hwnd, IDL_TITLE, L"スマートフォンで承認してください");
    SetDlgItemTextW(hwnd, IDL_LEAD, L"スマートフォンのカメラで QR コードを読み取り、つなぐ SK Hub Systems アカウントで承認してください。読み取れないときは " SKHUB_APPROVE_URL L" でコードを入力します。");
    SetDlgItemTextW(hwnd, IDL_CANCEL, L"やめる");
  } else {
    SetDlgItemTextW(hwnd, IDL_TITLE, L"つなぎました");
    SetDlgItemTextW(hwnd, IDL_LEAD, doneText.c_str());
    SetDlgItemTextW(hwnd, IDL_NEXT, L"閉じる");
  }
  RelayoutLink(hwnd);
  SetFocus(GetDlgItem(hwnd, page == 1 ? IDL_PASSWORD : page == 2 ? IDL_CANCEL : IDL_NEXT));
}

void OnLinkNext(HWND hwnd) {
  LinkState* st = LinkOf(hwnd);
  if (st->page == 3) {
    DestroyWindow(hwnd);
    return;
  }
  if (st->page != 1) return;
  std::wstring domain, user;
  skhub::SplitUser(Text(hwnd, IDL_USER), domain, user);
  std::wstring password = Text(hwnd, IDL_PASSWORD);
  std::wstring error;
  if (user.empty()) error = L"Windows のユーザーを選んでください。";
  else if (password.empty()) error = L"Windows のパスワードを入力してください（PIN ではなく、パスワード）。";
  if (error.empty()) {
    HCURSOR old = SetCursor(LoadCursorW(nullptr, IDC_WAIT));
    skhub::VerifyWindowsPassword(domain, user, password, error);
    SetCursor(old);
  }
  if (!error.empty()) {
    skhub::Wipe(password);
    SetDlgItemTextW(hwnd, IDL_ERROR, error.c_str());
    RelayoutLink(hwnd);
    SetFocus(GetDlgItem(hwnd, IDL_PASSWORD));
    SendDlgItemMessageW(hwnd, IDL_PASSWORD, EM_SETSEL, 0, -1);
    return;
  }
  if (st->of8) {
    // 0F8: その場でメールアドレスとパスワードを確かめて、つなぐ（QR コードは使わない）
    const std::wstring email = Text(hwnd, IDL_OF8_EMAIL);
    std::wstring of8Password = Text(hwnd, IDL_OF8_PASSWORD);
    std::wstring of8Uid;
    HCURSOR old = SetCursor(LoadCursorW(nullptr, IDC_WAIT));
    HRESULT hr = skhub::Of8SignIn(email, of8Password, of8Uid, error);
    SetCursor(old);
    skhub::Wipe(of8Password);
    SetDlgItemTextW(hwnd, IDL_OF8_PASSWORD, L"");
    if (SUCCEEDED(hr)) {
      hr = skhub::SaveLinkedUser({ skhub::Of8LinkId(of8Uid), user, domain, email }, password);
      if (FAILED(hr)) error = L"保存できませんでした: " + skhub::ErrorText(hr);
    }
    skhub::Wipe(password);
    if (FAILED(hr)) {
      SetDlgItemTextW(hwnd, IDL_ERROR, error.c_str());
      RelayoutLink(hwnd);
      SetFocus(GetDlgItem(hwnd, IDL_OF8_PASSWORD));
      return;
    }
    SetDlgItemTextW(hwnd, IDL_PASSWORD, L"");
    std::wstring text = L"サインイン画面の「Sign in with SK Hub」で「0F8 の ID とパスワードでサインイン」を選ぶと、" + email + L" で " +
                        skhub::DisplayUser(domain, user) + L" にサインインできます。\n\nWindows のパスワードを変えたら、もう一度つなぎ直してください。";
    if (!skhub::IsProviderInstalled()) text += L"\n\nサインイン画面にはまだ追加されていません。最初の画面で「サインイン画面に追加」を押してください。";
    ShowLinkPage(hwnd, 3, text);
    return;
  }
  st->domain = domain;
  st->user = user;
  st->password = password;
  skhub::Wipe(password);
  SetDlgItemTextW(hwnd, IDL_PASSWORD, L"");
  SetDlgItemTextW(hwnd, IDL_CODE, L"");
  SetDlgItemTextW(hwnd, IDL_STATUS, L"");
  StartLinkFlow(hwnd);
  ShowLinkPage(hwnd, 2);
}

void OnLinkUpdate(HWND hwnd, UINT id) {
  LinkState* st = LinkOf(hwnd);
  if (!st->flow || st->flow->id != id) return;  // やめたあとの知らせ
  AcquireSRWLockExclusive(&st->flow->lock);
  const std::wstring code = st->flow->code, status = st->flow->status, uid = st->flow->uid;
  const int result = st->flow->result;
  ReleaseSRWLockExclusive(&st->flow->lock);

  if (code != st->code) {
    st->code = code;
    SetDlgItemTextW(hwnd, IDL_CODE, code.empty() ? L"" : skhub::FormatCode(code).c_str());
    InvalidateRect(hwnd, &st->qr, FALSE);
  }
  SetDlgItemTextW(hwnd, IDL_STATUS, status.c_str());
  const bool failed = result == 2;
  if (failed != st->failed) {
    st->failed = failed;
    Show(hwnd, IDL_RETRY, failed);
    RelayoutLink(hwnd);
  }
  if (result != 1) return;

  // 承認された: つないで保存する
  st->flow.reset();
  if (skhub::IsOf8LinkId(uid)) {
    // 0F8 でつないだものと同じ名前にはしない（ありえないはずだが、念のため）
    st->failed = true;
    SetDlgItemTextW(hwnd, IDL_STATUS, L"このアカウントはつなげません。");
    RelayoutLink(hwnd);
    return;
  }
  skhub::LinkedUser before;
  const bool relinked = SUCCEEDED(skhub::FindLinkedUser(uid, before));
  HRESULT hr = skhub::SaveLinkedUser({ uid, st->user, st->domain }, st->password);
  skhub::Wipe(st->password);
  if (FAILED(hr)) {
    st->failed = true;
    SetDlgItemTextW(hwnd, IDL_STATUS, (L"保存できませんでした: " + skhub::ErrorText(hr)).c_str());
    Show(hwnd, IDL_RETRY, false);
    RelayoutLink(hwnd);
    return;
  }
  std::wstring text = L"サインイン画面の「Sign in with SK Hub」から\n" + skhub::DisplayUser(st->domain, st->user) +
                      L" にサインインできます。\n\nWindows のパスワードを変えたら、もう一度つなぎ直してください。";
  if (relinked && (_wcsicmp(before.userName.c_str(), st->user.c_str()) != 0 || before.domain != st->domain))
    text += L"\n\nこのアカウントは " + skhub::DisplayUser(before.domain, before.userName) + L" につながっていたので、つなぎ直しました。";
  if (!skhub::IsProviderInstalled()) text += L"\n\nサインイン画面にはまだ追加されていません。最初の画面で「サインイン画面に追加」を押してください。";
  ShowLinkPage(hwnd, 3, text);
}

void PaintQr(HWND hwnd, HDC dc) {
  LinkState* st = LinkOf(hwnd);
  if (st->page != 2) return;
  if (!st->code.empty()) {
    qr::Paint(dc, st->qr, qr::Encode(skhub::ToUtf8(L"https://" SKHUB_APPROVE_URL L"/?code=" + st->code)), 2);
    return;
  }
  // コードがまだない・期限切れなど
  FillRect(dc, &st->qr, static_cast<HBRUSH>(GetStockObject(WHITE_BRUSH)));
  HBRUSH line = CreateSolidBrush(kLine);
  FrameRect(dc, &st->qr, line);
  DeleteObject(line);
  HGDIOBJ old = SelectObject(dc, st->fonts.body);
  SetBkMode(dc, TRANSPARENT);
  SetTextColor(dc, kMuted);
  RECT r = st->qr;
  DrawTextW(dc, st->failed ? L"「新しいコードを表示」を押してください" : L"コードを用意しています…", -1, &r, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
  SelectObject(dc, old);
}

LRESULT CALLBACK LinkProc(HWND hwnd, UINT msg, WPARAM wParam, LPARAM lParam) {
  LinkState* st = LinkOf(hwnd);
  switch (msg) {
    case WM_CREATE: {
      st = new LinkState();
      st->of8 = reinterpret_cast<CREATESTRUCTW*>(lParam)->lpCreateParams != nullptr;
      SetWindowLongPtrW(hwnd, GWLP_USERDATA, reinterpret_cast<LONG_PTR>(st));
      st->fonts.Create(GetDpiForWindow(hwnd));
      Control(hwnd, L"STATIC", L"", SS_NOPREFIX, IDL_TITLE);
      Control(hwnd, L"STATIC", L"", SS_NOPREFIX, IDL_LEAD);
      Control(hwnd, L"STATIC", L"Windows のユーザー", SS_NOPREFIX, IDL_USER_LABEL);
      HWND combo = Control(hwnd, L"COMBOBOX", L"", CBS_DROPDOWN | CBS_AUTOHSCROLL | WS_VSCROLL | WS_TABSTOP, IDL_USER);
      Control(hwnd, L"STATIC", L"Windows のパスワード（PIN ではなく）", SS_NOPREFIX, IDL_PASSWORD_LABEL);
      Control(hwnd, L"EDIT", L"", ES_PASSWORD | ES_AUTOHSCROLL | WS_TABSTOP, IDL_PASSWORD, WS_EX_CLIENTEDGE);
      Control(hwnd, L"STATIC", L"", SS_NOPREFIX, IDL_ERROR);
      Control(hwnd, L"STATIC", L"", SS_NOPREFIX | SS_CENTER, IDL_CODE);
      Control(hwnd, L"STATIC", L"", SS_NOPREFIX | SS_CENTER, IDL_STATUS);
      Control(hwnd, L"STATIC", L"0F8 のメールアドレス", SS_NOPREFIX, IDL_OF8_EMAIL_LABEL);
      Control(hwnd, L"EDIT", L"", ES_AUTOHSCROLL | WS_TABSTOP, IDL_OF8_EMAIL, WS_EX_CLIENTEDGE);
      Control(hwnd, L"STATIC", L"0F8 のパスワード", SS_NOPREFIX, IDL_OF8_PASSWORD_LABEL);
      Control(hwnd, L"EDIT", L"", ES_PASSWORD | ES_AUTOHSCROLL | WS_TABSTOP, IDL_OF8_PASSWORD, WS_EX_CLIENTEDGE);
      Control(hwnd, L"BUTTON", L"新しいコードを表示", BS_PUSHBUTTON | WS_TABSTOP, IDL_RETRY);
      Control(hwnd, L"BUTTON", L"次へ", BS_DEFPUSHBUTTON | WS_TABSTOP, IDL_NEXT);
      Control(hwnd, L"BUTTON", L"キャンセル", BS_PUSHBUTTON | WS_TABSTOP, IDL_CANCEL);
      ApplyLinkFonts(hwnd);
      // いまのユーザーを先頭に、この PC のユーザーを選べるようにする（ほかの名前も入力できる）
      const std::wstring current = skhub::CurrentUser();
      if (!current.empty()) SendMessageW(combo, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(current.c_str()));
      for (const std::wstring& name : skhub::LocalUsers()) {
        const std::wstring shown = skhub::DisplayUser(L"", name);
        if (_wcsicmp(shown.c_str(), current.c_str()) != 0) SendMessageW(combo, CB_ADDSTRING, 0, reinterpret_cast<LPARAM>(shown.c_str()));
      }
      SendMessageW(combo, CB_SETCURSEL, 0, 0);
      ShowLinkPage(hwnd, 1);
      return 0;
    }
    case WM_DPICHANGED: {
      st->fonts.Create(HIWORD(wParam));
      ApplyLinkFonts(hwnd);
      const RECT* suggested = reinterpret_cast<RECT*>(lParam);
      SetWindowPos(hwnd, nullptr, suggested->left, suggested->top, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
      RelayoutLink(hwnd);
      return 0;
    }
    case WM_CTLCOLORSTATIC: {
      HDC dc = reinterpret_cast<HDC>(wParam);
      const int id = GetDlgCtrlID(reinterpret_cast<HWND>(lParam));
      COLORREF color = kInk;
      if (id == IDL_LEAD) color = kMuted;
      if (id == IDL_ERROR) color = kRed;
      if (id == IDL_STATUS) color = st->failed ? kRed : kAccent;
      SetTextColor(dc, color);
      SetBkColor(dc, RGB(255, 255, 255));
      return reinterpret_cast<LRESULT>(GetStockObject(WHITE_BRUSH));
    }
    case WM_PAINT: {
      PAINTSTRUCT ps;
      HDC dc = BeginPaint(hwnd, &ps);
      PaintQr(hwnd, dc);
      EndPaint(hwnd, &ps);
      return 0;
    }
    case WM_COMMAND:
      switch (LOWORD(wParam)) {
        case IDL_NEXT: OnLinkNext(hwnd); break;
        case IDL_CANCEL: DestroyWindow(hwnd); break;
        case IDL_RETRY:
          StartLinkFlow(hwnd);
          Show(hwnd, IDL_RETRY, false);
          SetDlgItemTextW(hwnd, IDL_CODE, L"");
          InvalidateRect(hwnd, &st->qr, FALSE);
          RelayoutLink(hwnd);
          break;
      }
      return 0;
    case WM_APP_LINK:
      OnLinkUpdate(hwnd, (UINT)wParam);
      return 0;
    case WM_CLOSE:
      DestroyWindow(hwnd);
      return 0;
    case WM_DESTROY:
      // 最初の画面に戻る（モーダルにしていた）
      EnableWindow(g_main, TRUE);
      SetActiveWindow(g_main);
      PostMessageW(g_main, WM_APP_REFRESH, 0, 0);
      g_link = nullptr;
      return 0;
    case WM_NCDESTROY:
      if (st) {
        StopLinkFlow(st);
        skhub::Wipe(st->password);
        st->fonts.Destroy();
        delete st;
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
      }
      break;
  }
  return DefWindowProcW(hwnd, msg, wParam, lParam);
}

void OpenLinkWindow(HWND owner, bool of8) {
  if (g_link) {
    SetForegroundWindow(g_link);
    return;
  }
  // lpCreateParams が空でなければ 0F8 アカウントをつなぐ
  g_link = CreateWindowExW(WS_EX_DLGMODALFRAME, kLinkClass, of8 ? L"0F8 アカウントをつなぐ" : L"アカウントをつなぐ", WS_POPUP | WS_CAPTION | WS_SYSMENU,
                           CW_USEDEFAULT, CW_USEDEFAULT, 100, 100, owner, nullptr, g_hinst, of8 ? reinterpret_cast<LPVOID>(1) : nullptr);
  if (!g_link) return;
  CenterOn(g_link, owner);
  EnableWindow(owner, FALSE);
  ShowWindow(g_link, SW_SHOW);
}

void RegisterClasses() {
  WNDCLASSEXW wc = { sizeof(wc) };
  wc.hInstance = g_hinst;
  wc.hCursor = LoadCursorW(nullptr, IDC_ARROW);
  wc.hbrBackground = static_cast<HBRUSH>(GetStockObject(WHITE_BRUSH));
  wc.hIcon = LoadIconW(g_hinst, MAKEINTRESOURCEW(IDI_APP));
  wc.hIconSm = static_cast<HICON>(LoadImageW(g_hinst, MAKEINTRESOURCEW(IDI_APP), IMAGE_ICON, GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0));
  wc.lpfnWndProc = MainProc;
  wc.lpszClassName = kMainClass;
  RegisterClassExW(&wc);
  wc.lpfnWndProc = LinkProc;
  wc.lpszClassName = kLinkClass;
  RegisterClassExW(&wc);
}

#ifdef SKHUB_PREVIEW
// 見た目の確かめ用（build.cmd test がつくる out\obj\preview の版だけ）。それぞれの画面を BMP に書き出して終わる。何も変えない
void SaveWindow(HWND hwnd, const std::wstring& path) {
  UpdateWindow(hwnd);
  RECT rc;
  GetWindowRect(hwnd, &rc);
  const int w = rc.right - rc.left, h = rc.bottom - rc.top;
  HDC screen = GetDC(nullptr);
  HDC dc = CreateCompatibleDC(screen);
  BITMAPINFO bi = {};
  bi.bmiHeader = { sizeof(bi.bmiHeader), w, h, 1, 24, BI_RGB };
  void* bits = nullptr;
  HBITMAP bmp = CreateDIBSection(dc, &bi, DIB_RGB_COLORS, &bits, nullptr, 0);
  HGDIOBJ old = SelectObject(dc, bmp);
  if (!PrintWindow(hwnd, dc, 0)) PrintWindow(hwnd, dc, PW_RENDERFULLCONTENT);
  GdiFlush();
  const DWORD stride = ((w * 3 + 3) & ~3), size = stride * h;
  BITMAPFILEHEADER fh = { 0x4D42, (DWORD)(sizeof(fh) + sizeof(bi.bmiHeader) + size), 0, 0, (DWORD)(sizeof(fh) + sizeof(bi.bmiHeader)) };
  HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, 0, nullptr);
  DWORD written;
  WriteFile(file, &fh, sizeof(fh), &written, nullptr);
  WriteFile(file, &bi.bmiHeader, sizeof(bi.bmiHeader), &written, nullptr);
  WriteFile(file, bits, size, &written, nullptr);
  CloseHandle(file);
  SelectObject(dc, old);
  DeleteObject(bmp);
  DeleteDC(dc);
  ReleaseDC(nullptr, screen);
}

void Pump() {
  MSG msg;
  for (int i = 0; i < 20; i++) {
    while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) DispatchMessageW(&msg);
    Sleep(15);
  }
}

void Snapshot(const std::wstring& dir) {
  Pump();
  SaveWindow(g_main, dir + L"\\settings-main.bmp");
  OpenLinkWindow(g_main, true);
  Pump();
  SaveWindow(g_link, dir + L"\\settings-of8.bmp");
  DestroyWindow(g_link);
  Pump();
  OpenLinkWindow(g_main, false);
  Pump();
  SaveWindow(g_link, dir + L"\\settings-link1.bmp");
  SetDlgItemTextW(g_link, IDL_ERROR, L"ユーザー名かパスワードが違います。");
  RelayoutLink(g_link);
  Pump();
  SaveWindow(g_link, dir + L"\\settings-link1-error.bmp");
  LinkState* st = LinkOf(g_link);
  st->code = L"ABCD2345";
  SetDlgItemTextW(g_link, IDL_CODE, L"ABCD-2345");
  SetDlgItemTextW(g_link, IDL_STATUS, L"スマートフォンで承認されるのを待っています（残り 9:41）");
  ShowLinkPage(g_link, 2);
  Pump();
  SaveWindow(g_link, dir + L"\\settings-link2.bmp");
  ShowLinkPage(g_link, 3, L"サインイン画面の「Sign in with SK Hub」から\n" + skhub::CurrentUser() +
                              L" にサインインできます。\n\nWindows のパスワードを変えたら、もう一度つなぎ直してください。");
  Pump();
  SaveWindow(g_link, dir + L"\\settings-link3.bmp");
  DestroyWindow(g_link);
  DestroyWindow(g_main);
}
#endif

}  // namespace

int WINAPI wWinMain(HINSTANCE hinst, HINSTANCE, PWSTR, int nCmdShow) {
  g_hinst = hinst;
  SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
  INITCOMMONCONTROLSEX icc = { sizeof(icc), ICC_LISTVIEW_CLASSES | ICC_STANDARD_CLASSES };
  InitCommonControlsEx(&icc);
#ifndef SKHUB_PREVIEW
  // マニフェストで管理者を求めているので、ふつうはここに来ない
  if (!skhub::IsElevated()) {
    MessageBoxW(nullptr, L"管理者として実行してください。", L"Sign in with SK Hub", MB_OK | MB_ICONWARNING);
    return 1;
  }
#endif
  RegisterClasses();
  g_main = CreateWindowExW(0, kMainClass, L"Sign in with SK Hub — 設定", WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX, CW_USEDEFAULT,
                           CW_USEDEFAULT, 100, 100, nullptr, nullptr, hinst, nullptr);
  if (!g_main) return 1;
  CenterOn(g_main, nullptr);
  ShowWindow(g_main, nCmdShow);
#ifdef SKHUB_PREVIEW
  int argc = 0;
  LPWSTR* argv = CommandLineToArgvW(GetCommandLineW(), &argc);
  if (argc >= 3 && wcscmp(argv[1], L"--snapshot") == 0) Snapshot(argv[2]);
  LocalFree(argv);
#endif

  MSG msg;
  while (GetMessageW(&msg, nullptr, 0, 0) > 0) {
    // Tab で移る・Enter で「次へ」・Esc で閉じる
    HWND active = GetActiveWindow();
    if (active && IsDialogMessageW(active, &msg)) continue;
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }
  return (int)msg.wParam;
}
