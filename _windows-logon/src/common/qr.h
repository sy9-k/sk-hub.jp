// QR コード（バイトモード・誤り訂正レベル M・型番 1〜6）
//   サインイン画面のウィンドウと設定ツールで、承認のページの URL（https://sk-hub.jp/pc/?code=…）を出すのに使う。
//   型番 6 まで（106 バイト）なので、型番情報（7 から）は扱わない
#pragma once

#include <windows.h>
#include <string>
#include <vector>

namespace qr {

struct Code {
  int size = 0;                  // 1 辺のモジュールの数（0 = 作れなかった）
  std::vector<unsigned char> m;  // size * size。1 = 黒
  bool Dark(int x, int y) const { return x >= 0 && y >= 0 && x < size && y < size && m[y * size + x]; }
};

// text は UTF-8
Code Encode(const std::string& text);

// rc の中に、白地の上で真ん中に描く（モジュールは整数のピクセル。まわりに quiet モジュール分の余白をとる）
void Paint(HDC dc, const RECT& rc, const Code& code, int quiet = 4);

}  // namespace qr
