#include "qr.h"

#include <algorithm>
#include <climits>
#include <cstdlib>

namespace qr {
namespace {

// 誤り訂正レベル M の表（型番 1〜6。この範囲は、ブロックの大きさがすべて同じ）
struct Version {
  int dataPerBlock;
  int ecPerBlock;
  int blocks;
  int alignment;  // 位置合わせパターンの中心（6 以外。型番 1 は 0 = なし）
};
const Version kVersions[] = {
  { 0, 0, 0, 0 },
  { 16, 10, 1, 0 },
  { 28, 16, 1, 18 },
  { 44, 26, 1, 22 },
  { 32, 18, 2, 26 },
  { 43, 24, 2, 30 },
  { 27, 16, 4, 34 },
};
const int kMaxVersion = 6;

// ---------- リード・ソロモン（GF(256)、x^8 + x^4 + x^3 + x^2 + 1） ----------

unsigned char GfMul(unsigned char x, unsigned char y) {
  int z = 0;
  for (int i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >> 7) * 0x11D);
    z ^= ((y >> i) & 1) * x;
  }
  return (unsigned char)z;
}

std::vector<unsigned char> RsDivisor(int degree) {
  std::vector<unsigned char> result(degree, 0);
  result[degree - 1] = 1;
  unsigned char root = 1;
  for (int i = 0; i < degree; i++) {
    for (int j = 0; j < degree; j++) {
      result[j] = GfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = GfMul(root, 0x02);
  }
  return result;
}

std::vector<unsigned char> RsRemainder(const std::vector<unsigned char>& data, const std::vector<unsigned char>& divisor) {
  std::vector<unsigned char> result(divisor.size(), 0);
  for (unsigned char b : data) {
    unsigned char factor = b ^ result[0];
    result.erase(result.begin());
    result.push_back(0);
    for (size_t i = 0; i < result.size(); i++) result[i] ^= GfMul(divisor[i], factor);
  }
  return result;
}

// ---------- 模様 ----------

class Builder {
 public:
  explicit Builder(int version) : version_(version), size_(version * 4 + 17), m_(size_ * size_, 0), fn_(size_ * size_, 0) {}

  Code Build(const std::vector<unsigned char>& codewords) {
    DrawFunctionPatterns();
    DrawCodewords(codewords);
    // 8 種類のマスクのうち、失点がいちばん少ないもの
    int best = 0;
    long bestPenalty = LONG_MAX;
    for (int mask = 0; mask < 8; mask++) {
      ApplyMask(mask);
      DrawFormat(mask);
      long penalty = Penalty();
      if (penalty < bestPenalty) {
        best = mask;
        bestPenalty = penalty;
      }
      ApplyMask(mask);  // もう一度かけると元に戻る
    }
    ApplyMask(best);
    DrawFormat(best);
    Code code;
    code.size = size_;
    code.m = m_;
    return code;
  }

 private:
  void Set(int x, int y, bool dark) {
    m_[y * size_ + x] = dark ? 1 : 0;
    fn_[y * size_ + x] = 1;
  }
  bool Get(int x, int y) const { return m_[y * size_ + x] != 0; }

  void DrawFunctionPatterns() {
    for (int i = 0; i < size_; i++) {
      Set(6, i, i % 2 == 0);
      Set(i, 6, i % 2 == 0);
    }
    DrawFinder(3, 3);
    DrawFinder(size_ - 4, 3);
    DrawFinder(3, size_ - 4);
    const int align = kVersions[version_].alignment;
    if (align) {
      const int pos[2] = { 6, align };
      for (int i = 0; i < 2; i++) {
        for (int j = 0; j < 2; j++) {
          if ((i == 0 && j == 0) || (i == 0 && j == 1) || (i == 1 && j == 0)) continue;  // 位置検出パターンと重なる
          DrawAlignment(pos[i], pos[j]);
        }
      }
    }
    DrawFormat(0);  // 場所を確保する（あとで本当の値を書く）
  }

  void DrawFinder(int cx, int cy) {
    for (int dy = -4; dy <= 4; dy++) {
      for (int dx = -4; dx <= 4; dx++) {
        int x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size_ || y >= size_) continue;
        int dist = std::max(abs(dx), abs(dy));
        Set(x, y, dist != 2 && dist != 4);
      }
    }
  }

  void DrawAlignment(int cx, int cy) {
    for (int dy = -2; dy <= 2; dy++)
      for (int dx = -2; dx <= 2; dx++) Set(cx + dx, cy + dy, std::max(abs(dx), abs(dy)) != 1);
  }

  // 形式情報（誤り訂正レベル M = 00 とマスク）
  void DrawFormat(int mask) {
    const int data = (0 << 3) | mask;
    int rem = data;
    for (int i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
    const int bits = ((data << 10) | rem) ^ 0x5412;
    auto bit = [&](int i) { return ((bits >> i) & 1) != 0; };
    for (int i = 0; i <= 5; i++) Set(8, i, bit(i));
    Set(8, 7, bit(6));
    Set(8, 8, bit(7));
    Set(7, 8, bit(8));
    for (int i = 9; i < 15; i++) Set(14 - i, 8, bit(i));
    for (int i = 0; i < 8; i++) Set(size_ - 1 - i, 8, bit(i));
    for (int i = 8; i < 15; i++) Set(8, size_ - 15 + i, bit(i));
    Set(8, size_ - 8, true);  // 暗モジュール
  }

  // 右下から 2 列ずつ、上下にジグザグに置く（縦のタイミングパターンの列 6 は飛ばす）
  void DrawCodewords(const std::vector<unsigned char>& data) {
    size_t i = 0;
    const size_t total = data.size() * 8;
    for (int right = size_ - 1; right >= 1; right -= 2) {
      if (right == 6) right = 5;
      for (int vert = 0; vert < size_; vert++) {
        for (int j = 0; j < 2; j++) {
          const int x = right - j;
          const bool upward = ((right + 1) & 2) == 0;
          const int y = upward ? size_ - 1 - vert : vert;
          if (!fn_[y * size_ + x] && i < total) {
            m_[y * size_ + x] = (data[i >> 3] >> (7 - (i & 7))) & 1;
            i++;
          }
        }
      }
    }
  }

  void ApplyMask(int mask) {
    for (int y = 0; y < size_; y++) {
      for (int x = 0; x < size_; x++) {
        if (fn_[y * size_ + x]) continue;
        bool invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 == 0; break;
          case 1: invert = y % 2 == 0; break;
          case 2: invert = x % 3 == 0; break;
          case 3: invert = (x + y) % 3 == 0; break;
          case 4: invert = (x / 3 + y / 2) % 2 == 0; break;
          case 5: invert = x * y % 2 + x * y % 3 == 0; break;
          case 6: invert = (x * y % 2 + x * y % 3) % 2 == 0; break;
          default: invert = ((x + y) % 2 + x * y % 3) % 2 == 0; break;
        }
        if (invert) m_[y * size_ + x] ^= 1;
      }
    }
  }

  // 読み取りにくい模様の失点（規格の N1〜N4）
  long Penalty() const {
    long result = 0;
    auto at = [&](int x, int y, bool horizontal) { return horizontal ? Get(x, y) : Get(y, x); };
    for (int pass = 0; pass < 2; pass++) {
      const bool horizontal = pass == 0;
      for (int a = 0; a < size_; a++) {
        // N1: 同じ色が 5 つ以上続く
        int run = 1;
        for (int b = 1; b < size_; b++) {
          if (at(b, a, horizontal) == at(b - 1, a, horizontal)) {
            run++;
          } else {
            if (run >= 5) result += 3 + (run - 5);
            run = 1;
          }
        }
        if (run >= 5) result += 3 + (run - 5);
        // N3: 1:1:3:1:1 の暗明の並びの片側に、明が 4 つ（外は明とみなす）
        for (int b = -10; b < size_; b++) {
          static const int kPattern[11] = { 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0 };
          bool forward = true, backward = true;
          for (int k = 0; k < 11; k++) {
            const int p = b + k;
            const int v = (p >= 0 && p < size_) ? (at(p, a, horizontal) ? 1 : 0) : 0;
            if (v != kPattern[k]) forward = false;
            if (v != kPattern[10 - k]) backward = false;
          }
          if (forward) result += 40;
          if (backward) result += 40;
        }
      }
    }
    // N2: 2×2 の同じ色
    for (int y = 0; y + 1 < size_; y++) {
      for (int x = 0; x + 1 < size_; x++) {
        const bool c = Get(x, y);
        if (c == Get(x + 1, y) && c == Get(x, y + 1) && c == Get(x + 1, y + 1)) result += 3;
      }
    }
    // N4: 暗モジュールの割合が 50% から離れている
    long dark = 0;
    for (unsigned char v : m_) dark += v;
    const long total = (long)size_ * size_;
    const long k = (labs(dark * 20 - total * 10) + total - 1) / total - 1;
    result += k * 10;
    return result;
  }

  int version_;
  int size_;
  std::vector<unsigned char> m_;
  std::vector<unsigned char> fn_;
};

}  // namespace

Code Encode(const std::string& text) {
  // 入るいちばん小さい型番（モード 4 ビット + 文字数 8 ビット + データ）
  int version = 1;
  for (; version <= kMaxVersion; version++) {
    const Version& v = kVersions[version];
    if (4 + 8 + (int)text.size() * 8 <= v.dataPerBlock * v.blocks * 8) break;
  }
  if (version > kMaxVersion) return Code();
  const Version& v = kVersions[version];
  const int capacityBits = v.dataPerBlock * v.blocks * 8;

  std::vector<bool> bits;
  auto append = [&](unsigned value, int count) {
    for (int i = count - 1; i >= 0; i--) bits.push_back(((value >> i) & 1) != 0);
  };
  append(0x4, 4);  // バイトモード
  append((unsigned)text.size(), 8);
  for (unsigned char c : text) append(c, 8);
  append(0, std::min(4, capacityBits - (int)bits.size()));  // 終端
  while (bits.size() % 8) bits.push_back(false);
  for (unsigned char pad = 0xEC; (int)bits.size() < capacityBits; pad ^= 0xEC ^ 0x11) append(pad, 8);

  std::vector<unsigned char> data(bits.size() / 8, 0);
  for (size_t i = 0; i < bits.size(); i++)
    if (bits[i]) data[i >> 3] |= (unsigned char)(1 << (7 - (i & 7)));

  // ブロックに分けて誤り訂正の符号を付け、互い違いに並べる
  const std::vector<unsigned char> divisor = RsDivisor(v.ecPerBlock);
  std::vector<std::vector<unsigned char>> blocks, ecs;
  for (int b = 0; b < v.blocks; b++) {
    std::vector<unsigned char> block(data.begin() + b * v.dataPerBlock, data.begin() + (b + 1) * v.dataPerBlock);
    ecs.push_back(RsRemainder(block, divisor));
    blocks.push_back(block);
  }
  std::vector<unsigned char> codewords;
  for (int i = 0; i < v.dataPerBlock; i++)
    for (int b = 0; b < v.blocks; b++) codewords.push_back(blocks[b][i]);
  for (int i = 0; i < v.ecPerBlock; i++)
    for (int b = 0; b < v.blocks; b++) codewords.push_back(ecs[b][i]);

  return Builder(version).Build(codewords);
}

void Paint(HDC dc, const RECT& rc, const Code& code, int quiet) {
  HBRUSH white = (HBRUSH)GetStockObject(WHITE_BRUSH);
  HBRUSH black = (HBRUSH)GetStockObject(BLACK_BRUSH);
  FillRect(dc, &rc, white);
  if (!code.size) return;
  const int width = rc.right - rc.left, height = rc.bottom - rc.top;
  const int modules = code.size + quiet * 2;
  const int px = std::max(1, std::min(width, height) / modules);
  const int left = rc.left + (width - code.size * px) / 2;
  const int top = rc.top + (height - code.size * px) / 2;
  for (int y = 0; y < code.size; y++) {
    for (int x = 0; x < code.size; x++) {
      if (!code.Dark(x, y)) continue;
      RECT r = { left + x * px, top + y * px, left + (x + 1) * px, top + (y + 1) * px };
      FillRect(dc, &r, black);
    }
  }
}

}  // namespace qr
