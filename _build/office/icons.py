# SK Hub Office のアプリのアイコン（PWA・ホーム画面・ショートカット）を作るスクリプト
#   python _build/office/icons.py
# 絵は /products/office/icon.svg と同じ（後ろから Slide・Sheet・Doc の紙を重ねたもの。色は SK's Mikan・Matcha・Blue）。
# 書き出すもの（office/icons/）:
#   icon-192.png・icon-512.png         … ふつうのアイコン（白い角丸の板）
#   maskable-192.png・maskable-512.png … Android などで形を切り抜かれても大丈夫なアイコン（白い四角いっぱい・絵は真ん中 70%）
#   apple-touch-icon.png（180）        … iPhone・iPad のホーム画面
#   doc-96.png・sheet-96.png・slide-96.png … アプリのショートカット（manifest の shortcuts）
#   icon.svg                           … ファビコン（/products/office/icon.svg のコピー）
import pathlib, shutil
from PIL import Image, ImageDraw

REPO = pathlib.Path(__file__).resolve().parents[2]
OUT = REPO / "office" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
S = 4  # 4 倍で描いてから縮める（ふちをなめらかに）

BLUE, GREEN, ORANGE, WHITE = (37, 99, 235), (22, 163, 74), (234, 88, 12), (255, 255, 255)


def papers(d, box):
    """96×96 の絵（icon.svg と同じ座標）を box（x, y, 大きさ）に描く"""
    ox, oy, size = box
    k = size / 96

    def r(x, y, w, h, rad, fill):
        d.rounded_rectangle([ox + x * k, oy + y * k, ox + (x + w) * k, oy + (y + h) * k], radius=rad * k, fill=fill)

    def line(x1, y1, x2, y2, width, fill):
        d.line([ox + x1 * k, oy + y1 * k, ox + x2 * k, oy + y2 * k], fill=fill, width=max(1, round(width * k)))

    # Slide（いちばん後ろ）
    r(40, 16, 42, 30, 7, ORANGE)
    r(47, 23, 16, 4, 2, (255, 230, 215))
    # Sheet
    r(28, 31, 40, 34, 7, GREEN)
    for y in (43, 54):
        line(28, y, 68, y, 2.5, (190, 235, 205))
    line(41, 31, 41, 65, 2.5, (190, 235, 205))
    # Doc（いちばん前）
    r(14, 46, 36, 36, 7, BLUE)
    for y, x2 in ((57, 42), (64, 42), (71, 35)):
        line(22, y, x2, y, 3.5, WHITE)


def icon(size, maskable=False, rounded=True):
    big = size * S
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable or not rounded:
        d.rectangle([0, 0, big, big], fill=WHITE)
    else:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 24 / 96, fill=WHITE)
    if maskable:
        inner = big * 0.7
        papers(d, ((big - inner) / 2, (big - inner) / 2, inner))
    else:
        papers(d, (0, 0, big))
    return img.resize((size, size), Image.LANCZOS)


def app_icon(size, color, kind):
    """ショートカットのアイコン（アプリの色の角丸の板に、白い絵）"""
    big = size * S
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.26, fill=color)
    u = big / 24
    w = round(1.9 * u)
    if kind == "doc":
        d.rounded_rectangle([7 * u, 4 * u, 17 * u, 20 * u], radius=1.6 * u, outline=WHITE, width=w)
        for y in (9, 12.5, 16):
            d.line([9.8 * u, y * u, 14.2 * u, y * u], fill=WHITE, width=w)
    elif kind == "sheet":
        d.rounded_rectangle([5 * u, 5 * u, 19 * u, 19 * u], radius=1.6 * u, outline=WHITE, width=w)
        d.line([5 * u, 9.7 * u, 19 * u, 9.7 * u], fill=WHITE, width=w)
        d.line([5 * u, 14.3 * u, 19 * u, 14.3 * u], fill=WHITE, width=w)
        d.line([10.5 * u, 5 * u, 10.5 * u, 19 * u], fill=WHITE, width=w)
    else:
        d.rounded_rectangle([4 * u, 5 * u, 20 * u, 16 * u], radius=1.6 * u, outline=WHITE, width=w)
        d.line([12 * u, 16 * u, 12 * u, 19.5 * u], fill=WHITE, width=w)
        d.line([8.5 * u, 19.5 * u, 15.5 * u, 19.5 * u], fill=WHITE, width=w)
    return img.resize((size, size), Image.LANCZOS)


for n in (192, 512):
    icon(n).save(OUT / f"icon-{n}.png")
    icon(n, maskable=True).save(OUT / f"maskable-{n}.png")
icon(180, rounded=False).convert("RGB").save(OUT / "apple-touch-icon.png")
for kind, color in (("doc", BLUE), ("sheet", GREEN), ("slide", ORANGE)):
    app_icon(96, color, kind).save(OUT / f"{kind}-96.png")
shutil.copyfile(REPO / "products" / "office" / "icon.svg", OUT / "icon.svg")
print("wrote", ", ".join(sorted(p.name for p in OUT.iterdir())))
