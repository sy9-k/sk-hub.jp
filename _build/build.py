# サイトのページを作るスクリプト（使い方は _build/README.md）
#   python _build/build.py
# index.html（トップ）のヘッダー・フッターを型にして、_build/pages/*.html の中身を差し込み、各ページの index.html を書き出す。
# 多言語: URL は変えず、ブラウザで選んだ言語に訳す（assets/i18n.js）。ここでは
#   ・ブラウザで使う辞書（assets/i18n/<言語>.js）を _build/i18n/<言語>.json から作る
#   ・ページとスクリプトの中の「辞書にない文」を探して _build/i18n/missing/<言語>.json に書き出す（訳を入れて辞書に足す）
# あわせて sitemap.xml も作り直す。
import datetime, json, pathlib, re, sys

BUILD = pathlib.Path(__file__).resolve().parent
REPO = BUILD.parent
PAGES = BUILD / "pages"
I18N = BUILD / "i18n"
ORIGIN = "https://sk-hub.jp"
sys.path.insert(0, str(BUILD))
from i18n import LANGS, Translator, key_of, load_table, translate  # noqa: E402

index = (REPO / "index.html").read_text(encoding="utf-8")
head, rest = index.split('  <main id="main">\n', 1)
home_body, tail = rest.split("  </main>\n", 1)

# (元, 出力先, タイトル, 説明, リダイレクトしない, 検索に載せる)
pages = [
    ("sk-hub-systems.html", "sk-hub-systems/index.html", "SK Hub Systems | SK", "Y-FILTER. の遠隔管理・ブロックリストの配信・アクセスチェックを支える、SK が運営するサーバー基盤「SK Hub Systems」。", True, True),
    ("updates.html", "updates/index.html", "アップデート | SK", "SK のサイトとプロダクト（Y-FILTER.・SK Hub Systems・SK's Lab）のアップデート情報。", True, True),
    ("toolbox.html", "toolbox/index.html", "SK's Toolbox", "毎日ちょっと使う、小さなアプリを集めた SK の道具箱。時計とアラームの「Clock」、関数電卓にもなる「Calc」、画像も入るメモ帳「Memo」、リマインダー「Todo」、あと何日を数える「Countdown」、時間割の「Timetable」、回して決める「Roulette」。", False, True),
    ("lab.html", "lab/index.html", "SK's Lab | SK", "SK の実験的なツールを置いている場所。QR Drop やスマートダッシュボードなど。", False, True),
    ("domain.html", "domain/index.html", "sk-hub.jp への引っ越しのお知らせ | SK", "SK のサイトとプロダクトのアドレスが、sy9-k.github.io から sk-hub.jp に変わります。変わること・新しくできるようになること・変わらないこと・切り替えのときにしてほしいこと。", True, True),
    ("credits.html", "credits/index.html", "Link & Credit | SK", "SK のサイトとプロダクトで使わせてもらっているもの（RedCheck など）と、つながりのあるサイト。", True, True),
    ("about.html", "about/index.html", "私について | SK", "Y-FILTER. と MALU を開発している SK の自己紹介と、これまでにつくったもの。", False, True),
    ("y-filter.html", "products/y-filter/index.html", "Y-FILTER. | SK", "有害なサイトのブロックや利用時間の管理ができるブラウザ拡張機能「Y-FILTER.」（開発中）。", False, True),
    ("malu.html", "products/malu/index.html", "MALU | SK", "国語・英語・韓国語・中国語などの辞書をひとつの検索ボックスから引ける辞書検索アプリ「MALU」。", False, True),
    ("products.html", "products/index.html", "プロダクト | SK", "SK がつくっているアプリ・ブラウザ拡張機能・サーバー基盤・小さな道具・実験中のツール（MALU・Nagi・Y-FILTER.・SK Hub Systems・SK's Toolbox・SK's Lab）の一覧。", False, True),
    ("brand.html", "brand/index.html", "SK's Brand | SK", "SK のプロダクトに共通するデザインとことばのきまり。大切にしていること・ロゴ・色・文字・形と動き・使う人との約束。", False, True),
    ("nagi.html", "products/nagi/index.html", "Nagi | SK", "集中と休憩をくり返して、勉強や作業の時間を記録する集中タイマー「Nagi」。1 日の目標と連続日数、端末のあいだの同期。", False, True),
    ("hub-account.html", "sk-hub-systems/account/index.html", "SK Hub Systems アカウント | SK", "SK のサービスを、いつもの Google アカウントひとつで。使えるサービス、端末のあいだの同期、保存する情報、データのダウンロードと削除について。", False, True),
    ("account.html", "account/index.html", "SK Hub Systems アカウント | SK", "SK のサービスを 1 つの Google アカウントで使える「SK Hub Systems アカウント」。ログイン・アカウントの確認・削除。", True, True),
    ("privacy.html", "policies/privacy/index.html", "SK プライバシーポリシー | SK", "SK のサービス（サイト・MALU・Nagi・SK's Toolbox・Y-FILTER.・SK Hub Systems アカウント）での情報の取り扱い。Google アカウントでログインしたときの情報（Google のユーザーデータ）の取り扱いを含みます。", True, True),
    ("policies.html", "policies/index.html", "利用規約・プライバシーポリシー | SK", "SK 利用規約・SK プライバシーポリシーと、SK Hub Systems アカウント・Y-FILTER. の利用規約。", True, True),
    ("lang.html", "lang/index.html", "Language | SK", "Choose your language / 言語を選択", True, False),
    ("404.html", "404.html", "ページが見つかりません | SK", "お探しのページは見つかりませんでした。", True, False),
]
# フッターを出さないページ（SK's Toolbox のホーム画面。下にドックがある）
NO_FOOTER = {"toolbox.html"}
# 訳さないページ（開発者だけが使う）
NOT_TRANSLATED = {"privacy.html"}  # お問い合わせの受信箱・記事エディターは、管理画面（admin.sk-hub.jp）に移った

# ページごとに追加する <head> の中身と <body> のクラス
EXTRA = {
    "account.html": ('  <script type="module" src="/account/account-page.js"></script>\n', None),
    # 言語の画面。どこから開いたか（戻り先の next・LINE の中・アプリとして開いているか）を、画面が出る前に <html> に付ける
    #   data-lang-from="toolbox|malu|nagi|lab" … 戻り先のアプリ（?from= で指定もできる）
    #     Toolbox のときは、Toolbox の言語の画面（/toolbox/lang/。マテリアルデザイン）に移る
    #   data-lang-app … アプリから開いたとき。サイトのヘッダー・フッター・お知らせを隠し、アプリ用の画面にする（/assets/site.css・/lang/lang.js）
    "lang.html": (
        '  <script>(function(){try{var d=document.documentElement,q=new URLSearchParams(location.search),n=q.get("next")||"/",f=q.get("from")||"",'
        'A={toolbox:/^\\/toolbox\\//,malu:/^\\/dictionary\\//,nagi:/^\\/nagi\\//,lab:/^\\/(qr-prj|smart-dash)\\//};'
        'if(!A[f]){f="";for(var k in A)if(A[k].test(n))f=k;}if(f==="toolbox"){location.replace("/toolbox/lang/"+location.search);return;}'
        'var line=!!sessionStorage.getItem("sk_line")||/[?&]line=/.test(n),'
        'pwa=window.matchMedia&&matchMedia("(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: fullscreen), (display-mode: minimal-ui)").matches||navigator.standalone===true;'
        'if(f)d.setAttribute("data-lang-from",f);if(f||line||pwa)d.setAttribute("data-lang-app","");if(line)d.setAttribute("data-lang-line","");'
        '}catch(e){}})();</script>\n'
        '  <script src="/lang/lang.js" defer></script>\n',
        "lang-page",
    ),
    # 隠しコマンド（assets/nf-secret.js）
    "404.html": ('  <script src="/assets/nf-secret.js" defer></script>\n', None),
    # SK Hub Systems の紹介ページ（スクロールで見せる。/sk-hub-systems/hub.js）
    "sk-hub-systems.html": (
        '  <script src="/assets/fonts.js" data-fonts="https://fonts.googleapis.com/css2?family=M+PLUS+1+Code:wght@700&display=swap"></script>\n'
        '  <script src="/sk-hub-systems/hub.js" defer></script>\n',
        "hx-page",
    ),
    "hub-account.html": ('  <script src="/sk-hub-systems/hub.js" defer></script>\n', "hx-page"),
    "brand.html": (
        '  <script src="/assets/fonts.js" data-fonts="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&family=M+PLUS+1:wght@400;700&family=M+PLUS+1+Code:wght@500&display=swap"></script>\n'
        '  <script src="/brand/brand.js" defer></script>\n',
        None,
    ),
    # SK's Toolbox のホーム画面（マテリアルデザイン。共通の設定・PWA。/toolbox/home.css・home.js）
    "toolbox.html": (
        '  <script src="/assets/fonts.js" data-fonts="https://fonts.googleapis.com/css2?family=M+PLUS+1:wght@300;400;500;700&display=swap" data-icons="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0&display=block"></script>\n'
        '  <link rel="stylesheet" href="/toolbox/shared/m3.css">\n'
        '  <link rel="stylesheet" href="/toolbox/home.css">\n'
        '  <script src="/toolbox/shared/settings.js" data-app="home" data-scope="site"></script>\n'
        '  <script src="/toolbox/shared/titlebar.js"></script>\n'
        '  <script src="/toolbox/shared/tbcenter.js"></script>\n'
        '  <link rel="manifest" href="/toolbox/manifest.json">\n'
        '  <meta name="apple-mobile-web-app-capable" content="yes">\n'
        '  <meta name="apple-mobile-web-app-title" content="SK\'s Toolbox">\n',
        "tb-home-page",
    ),
    "credits.html": ('  <script src="/assets/fonts.js" data-fonts="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@700&display=swap"></script>\n', None),
    "y-filter.html": (
        '  <script src="/assets/fonts.js" data-fonts="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Noto+Sans+JP:wght@900&display=swap"></script>\n'
        '  <link rel="stylesheet" href="/products/y-filter/yf.css">\n',
        "yf-page",
    ),
}

# t("…") などで訳す文を探すファイル（ページの外でスクリプトが作る文字）
RUNTIME_SOURCES = [
    "assets/site.js", "assets/maintenance.js", "support/help.js", "support/articles.js", "support/support.js", "account/account-page.js",
    "support/contact/contact.js", "frameworks/check.js",
    "dictionary/script.js", "dictionary/account.js", "assets/hub/sync-loader.js", "assets/analytics.js", "assets/nf-secret.js", "assets/terminal.js",
    "nagi/app.js", "nagi/account.js", "brand/brand.js", "assets/hub/account-button.js",
    "toolbox/clock/clock.js", "toolbox/calc/calc.js", "toolbox/memo/memo.js", "toolbox/todo/todo.js", "toolbox/countdown/countdown.js", "toolbox/clock/clock-tools.js", "toolbox/shared/settings.js", "toolbox/shared/m3.js", "toolbox/shared/remind.js", "toolbox/home.js",
    "toolbox/shared/sync.js", "toolbox/shared/titlebar.js", "toolbox/shared/tbcenter.js", "toolbox/shared/pwa.js", "toolbox/shared/search.js", "toolbox/shared/line.js",
    "toolbox/timetable/timetable.js", "toolbox/roulette/roulette.js", "toolbox/lang/lang.js",
    "move/move.js", "moved/moved.js",
    "view/view.js",
]
# build で作らないページ（ブラウザでページごと訳す）
STANDALONE_PAGES = [
    "usercheck/blocked.html", "usercheck/terms_not_accepted.html",
    "dictionary/index.html", "dictionary/offline.html",
    "nagi/index.html",
    "toolbox/clock/index.html", "toolbox/calc/index.html", "toolbox/memo/index.html", "toolbox/todo/index.html", "toolbox/countdown/index.html", "toolbox/settings/index.html",
    "toolbox/timetable/index.html", "toolbox/roulette/index.html", "toolbox/install/index.html", "toolbox/lang/index.html",
    "move/index.html", "moved/index.html",
    "view/index.html",
    "support/index.html", "support/contact/index.html",
]
# 英語だけに訳すページ（SK's Lab のツール。<html data-i18n-langs="ja en">）。ページの文とスクリプトの t("…") の両方を探す
EN_ONLY_PAGES = ["qr-prj/index.html", "smart-dash/index.html"]


# プライバシーポリシーのページ（/policies/privacy/）: policies/docs/sk-privacy.txt と sk-privacy.en.txt の本文を、
# そのまま HTML にして載せる（/policies/ はスクリプトで本文を読み込むので、スクリプトを動かさない審査（Google の OAuth の
# 確認など）では本文が見えない）。日本語と英語を 1 ページに並べ、訳は自動ではしない（NOT_TRANSLATED）。
# 文の区切り方は assets/site.js の規約の表示（render）と同じ。_build/pages/privacy.html は作らない
def policy_html(text, lang, anchor):
    import html as H
    def para(line, cls=None):
        parts = re.split(r"(https?://[^\s）)」]+)", line)
        inner = "".join(f'<a href="{H.escape(x)}">{H.escape(x)}</a>' if re.match(r"https?://", x) else H.escape(x) for x in parts)
        return f'          <p class="{cls}">{inner}</p>\n' if cls else f"          <p>{inner}</p>\n"
    out, titled = [], False
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if not titled:
            out.append(f'          <h2 class="doc-title">{H.escape(line)}</h2>\n')
            titled = True
        elif re.match(r"^(制定日|Established)", line):
            out.append(para(line, "meta"))
        elif re.match(r"^(第[一二三四五六七八九十]+条|附則|Article \d+|Supplementary Provisions)", line):
            hid = f' id="{anchor}"' if re.match(r"^(第四条の三|Article 4-3)", line) else ""
            out.append(f"          <h3{hid}>{H.escape(line)}</h3>\n")
        elif re.match(r"^\([a-z]\)", line):
            out.append(para(line, "sub"))
        else:
            out.append(para(line))
    return "".join(out)


def privacy_body():
    docs = REPO / "policies" / "docs"
    ja = policy_html((docs / "sk-privacy.txt").read_text(encoding="utf-8"), "ja", "google-user-data")
    en = policy_html((docs / "sk-privacy.en.txt").read_text(encoding="utf-8"), "en", "google-user-data-en")
    return f"""    <!-- SK プライバシーポリシー（build で policies/docs/sk-privacy.txt・sk-privacy.en.txt から作る。直すのはテキストファイル） -->
    <section class="p-hero band band--plain">
      <div class="wrap">
        <span class="eyebrow">Privacy Policy</span>
        <h1>SK プライバシーポリシー</h1>
        <p class="lead">SK のサービス（サイト・MALU・Nagi・SK's Toolbox・Y-FILTER.・SK Hub Systems アカウント）での情報の取り扱いです。Google アカウントでログインしたときの情報は、<a href="#google-user-data">第四条の三</a>にあります。</p>
        <p class="lead" lang="en">How SK handles information in its services. For data received when you sign in with a Google Account, see <a href="#google-user-data-en">Article 4-3</a>. <a href="#en">Read in English</a></p>
      </div>
    </section>

    <section class="section" style="padding-top:0">
      <div class="wrap">
        <article class="doc" id="ja" lang="ja">
{ja}        </article>
        <article class="doc" id="en" lang="en" style="margin-top:32px">
{en}        </article>
        <p style="margin-top:24px">ほかの言語（参考訳） / Other languages: <a href="/policies/docs/sk-privacy.zh-CN.txt">简体中文</a> · <a href="/policies/docs/sk-privacy.zh-TW.txt">繁體中文</a> · <a href="/policies/docs/sk-privacy.ko.txt">한국어</a> · <a href="/policies/">利用規約・プライバシーポリシーの一覧</a></p>
      </div>
    </section>
"""


def write(path, text):
    # 改行は LF で書く（Path.write_text の newline= は Python 3.10 からなので、3.9 でも動くように open で）
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


def page_url(dst):
    return ORIGIN + "/" + dst.removesuffix("index.html")


def set_meta(h, pattern, value):
    return re.sub(pattern, lambda m: m.group(1) + value.replace("\\", "\\\\") + m.group(2), h, count=1)


def assemble(body, dst, title, desc, no_redirect, indexable, src=None):
    h = re.sub(r"<title>.*?</title>", f"<title>{title}</title>", head)
    h = set_meta(h, r'(<meta name="description" content=")[^"]*(">)', desc)
    h = set_meta(h, r'(<meta property="og:title" content=")[^"]*(">)', title)
    h = set_meta(h, r'(<meta property="og:description" content=")[^"]*(">)', desc)
    if indexable:
        h = set_meta(h, r'(<meta property="og:url" content=")[^"]*(">)', page_url(dst))
        h = set_meta(h, r'(<link rel="canonical" href=")[^"]*(">)', page_url(dst))
    else:
        # 検索に載せないページ（受信箱・404 など）: URL の指定を外して noindex にする
        h = re.sub(r'  <link rel="canonical" href="[^"]*">\n', "", h)
        h = re.sub(r'  <meta property="og:url" content="[^"]*">\n', "", h)
        h = h.replace('  <meta name="theme-color"', '  <meta name="robots" content="noindex">\n  <meta name="theme-color"', 1)
    if src in EXTRA:
        extra_head, body_class = EXTRA[src]
        h = h.replace("</head>\n", extra_head + "</head>\n", 1)
        if body_class:
            h = h.replace("<body>", f'<body class="{body_class}">', 1)
    t = tail
    if no_redirect:
        # ブロック中・同意撤回中の人も読めるように、リダイレクトしないモードで読み込む
        t = t.replace('/frameworks/check.js"', '/frameworks/check.js?check=none"')
    if src in NO_FOOTER:
        # 下にアプリのドックがあるページ: フッターは出さない
        t = re.sub(r'  <footer class="site-footer">[\s\S]*?</footer>\n', "", t, count=1)
    if src in NOT_TRANSLATED:
        # 開発者用のページは訳さない
        t = t.replace("<script>window.SKI18N && SKI18N.translatePage();</script>", "")
    return h + '  <main id="main">\n' + body + "  </main>\n" + t


translators = {code: Translator(code, load_table(I18N / f"{code}.json")) for code, *_ in LANGS if code != "ja"}
sitemap = [page_url("index.html")]
checked = [index]

for src, dst, title, desc, no_redirect, indexable in pages:
    body = privacy_body() if src == "privacy.html" else (PAGES / src).read_text(encoding="utf-8")
    text = assemble(body, dst, title, desc, no_redirect, indexable, src)
    out = REPO / dst
    out.parent.mkdir(parents=True, exist_ok=True)
    write(out, text)
    if indexable:
        sitemap.append(page_url(dst))
    if src not in NOT_TRANSLATED:
        checked.append(text)
print("wrote", len(pages), "pages")

# 辞書にない文を探す（ページ ＋ build で作らないページ ＋ スクリプトの t("…")）
for rel in STANDALONE_PAGES:
    checked.append((REPO / rel).read_text(encoding="utf-8"))
def runtime_keys_of(sources):
    keys = set()
    for source in sources:
        for q in ('"', "'"):
            for k in re.findall(r"\b(?:t|tx|tw)\(\s*" + q + r"((?:[^" + q + r"\\]|\\.)*)" + q, source):
                keys.add(json.loads('"' + k.replace("\\'", "'") + '"') if "\\" in k else k)
    return keys


def check_missing(tr, texts, keys):
    for text in texts:
        translate(text, tr)
    for k in keys:
        if re.search(r"[぀-ヿ㐀-鿿]", k) and not tr.table.get(key_of(k)):
            tr.missing.add(key_of(k))


runtime_keys = runtime_keys_of((REPO / rel).read_text(encoding="utf-8") for rel in RUNTIME_SOURCES)
en_only = [(REPO / rel).read_text(encoding="utf-8") for rel in EN_ONLY_PAGES]
en_only_keys = runtime_keys_of(en_only)
for code, tr in translators.items():
    check_missing(tr, checked, runtime_keys)
    if code == "en":
        check_missing(tr, en_only, en_only_keys)

# ブラウザで使う辞書（キーは assets/i18n.js の keyOf と同じ形）
(REPO / "assets" / "i18n").mkdir(parents=True, exist_ok=True)
for code, tr in translators.items():
    js = ("// build が作るファイル（_build/i18n/%s.json から）。直接編集しない\nwindow.SK_I18N_DICT = %s;\n"
          % (code, json.dumps(dict(sorted(tr.table.items())), ensure_ascii=False, separators=(",", ":"))))
    write(REPO / "assets" / "i18n" / f"{code}.js", js)

# 訳がない文の一覧
missing_dir = I18N / "missing"
missing_dir.mkdir(parents=True, exist_ok=True)
for code, tr in translators.items():
    path = missing_dir / f"{code}.json"
    if tr.missing:
        write(path, json.dumps({k: "" for k in sorted(tr.missing)}, ensure_ascii=False, indent=2) + "\n")
        print(f"missing {code}: {len(tr.missing)}")
    elif path.exists():
        path.unlink()

# サイトマップ（このスクリプトで作るページ ＋ 別に作っているアプリ）
sitemap += [ORIGIN + "/dictionary/", ORIGIN + "/nagi/", ORIGIN + "/y-filter/", ORIGIN + "/qr-prj/", ORIGIN + "/smart-dash/", ORIGIN + "/lyrics/", ORIGIN + "/toolbox/clock/", ORIGIN + "/toolbox/calc/", ORIGIN + "/toolbox/memo/", ORIGIN + "/toolbox/todo/", ORIGIN + "/toolbox/countdown/", ORIGIN + "/toolbox/timetable/", ORIGIN + "/toolbox/roulette/", ORIGIN + "/toolbox/install/"]
today = datetime.date.today().isoformat()
xml = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
xml += [f"  <url><loc>{u}</loc><lastmod>{today}</lastmod></url>" for u in sitemap]
xml.append("</urlset>")
write(REPO / "sitemap.xml", "\n".join(xml) + "\n")
print("wrote sitemap.xml", len(sitemap), "urls")
