#!/usr/bin/env python3
"""家庭サーバー用の非公開ページサーバー（標準ライブラリのみで動作）。

- pages フォルダ内の HTML をそのまま配信し、右下にメニューボタンを差し込む
- "/" でページ一覧を表示し、"/manage" でページの追加・削除ができる
- 接続元が家の LAN・Tailscale・このPC自身の場合だけ応答する（ログインはなし）
- Host ヘッダーも許可リストで確認する（DNS リバインディング対策）

使い方:
  python server.py
  python server.py --allow-host xxx.ts.net   # Tailscale の https 名などで開く場合
"""

import argparse
import html
import http.client
import ipaddress
import json
import mimetypes
import os
import re
import sys
import urllib.parse
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
SHELL_PATH = "/_shell.js"
ASSETS_PREFIX = "/_assets/"
MANAGE_PATH = "/manage"
UPLOAD_PATH = "/api/upload"
DELETE_PATH = "/api/delete"
CSRF_HEADER = "X-SK-Home"      # 操作（追加・削除）には、この独自ヘッダーが必要。別のサイトからの送信を防ぐ
MAX_UPLOAD = 5 * 1024 * 1024   # 1 ファイル 5 MB まで

# 接続を許可する送信元。公開IP（インターネット側）からは届いても拒否される。
ALLOWED_NETWORKS = [
    ipaddress.ip_network(n)
    for n in (
        "127.0.0.0/8",
        "::1/128",
        "10.0.0.0/8",          # 家庭内LAN
        "172.16.0.0/12",       # 家庭内LAN
        "192.168.0.0/16",      # 家庭内LAN
        "169.254.0.0/16",      # リンクローカル
        "100.64.0.0/10",       # Tailscale (IPv4)
        "fc00::/7",            # IPv6 ULA（Tailscale の IPv6 もここに含まれる）
        "fe80::/10",           # IPv6 リンクローカル
    )
]

# Host 名ごとの転送（リバースプロキシ）。送信元は Tailscale と このPC だけに限る。
TAILSCALE_NETWORKS = [
    ipaddress.ip_network(n)
    for n in (
        "127.0.0.0/8",
        "::1/128",
        "100.64.0.0/10",       # Tailscale (IPv4)
        "fd7a:115c:a1e0::/48", # Tailscale (IPv6)
    )
]
# 既定: wordpress.private.sk-hub.jp → このPCの Docker 上の WordPress（_home-server/wordpress 参照）
DEFAULT_PROXIES = ["wordpress.private.sk-hub.jp=http://127.0.0.1:8080"]
# 転送のときに中継しないヘッダー（ホップごとのもの）。Host は中継する（WordPress が URL を作るのに使う）
HOP_BY_HOP = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
              "te", "trailers", "transfer-encoding", "upgrade"}


class ProxyRoute:
    """Host 名 → 転送先（http://127.0.0.1:ポート）。"""

    def __init__(self, host: str, target: str):
        url = urllib.parse.urlsplit(target)
        self.host = host
        self.hostname = url.hostname
        self.port = url.port or 80


def parse_proxy(spec: str) -> ProxyRoute:
    host, sep, target = spec.partition("=")
    host = host.strip().lower()
    url = urllib.parse.urlsplit(target.strip())
    if not sep or not host or url.scheme != "http" or url.hostname not in ("127.0.0.1", "localhost", "::1"):
        raise ValueError(f"--proxy の形式が正しくありません: {spec}（例: wordpress.private.sk-hub.jp=http://127.0.0.1:8080）")
    return ProxyRoute(host, target.strip())


PROXY_ROUTES: dict = {}

DEFAULT_HOSTS = {"private.sk-hub.jp", "localhost", "127.0.0.1", "::1"}
DEFAULT_PAGES = Path.home() / "home-pages"   # リポジトリの外に置く（公開リポジトリに載せないため）

TITLE_RE = re.compile(rb"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
BODY_CLOSE_RE = re.compile(rb"</body\s*>", re.IGNORECASE)
NAME_RE = re.compile(r"^[A-Za-z0-9_\-぀-ヿ一-鿿]{1,60}$")

FONTS_URL = (
    "https://fonts.googleapis.com/css2?family=M+PLUS+1:wght@400;500;700;800&display=swap"
    "&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0&display=block"
)


# ---------- ページ一覧 ----------

def ip_in(addr: str, networks) -> bool:
    try:
        ip = ipaddress.ip_address(addr.split("%")[0])
    except ValueError:
        return False
    if ip.version == 6 and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return any(ip in net for net in networks)


def is_allowed_ip(addr: str) -> bool:
    return ip_in(addr, ALLOWED_NETWORKS)


def page_title(path: Path) -> str:
    try:
        with path.open("rb") as f:
            head = f.read(64 * 1024)
    except OSError:
        return path.stem
    m = TITLE_RE.search(head)
    if m:
        text = html.unescape(" ".join(m.group(1).decode("utf-8", "replace").split()))
        if text:
            return text
    return path.stem


def list_pages(root: Path) -> list[dict]:
    """pages 以下の HTML を一覧にする。サブフォルダは index.html があれば1ページとして扱う。"""
    items = []
    for p in root.rglob("*.html"):
        if not p.is_file():
            continue
        rel = p.relative_to(root)
        parts = rel.parts
        if any(part.startswith(".") for part in parts):
            continue
        if len(parts) == 1 and p.name == "index.html":
            continue  # ルートの index.html は "/" （ページ一覧）に使うため除外
        if p.name == "index.html":
            url_parts = parts[:-1]
            url = "/" + "/".join(urllib.parse.quote(x) for x in url_parts) + "/"
        else:
            url = "/" + "/".join(urllib.parse.quote(x) for x in parts)
        stat = p.stat()
        items.append({
            "title": page_title(p),
            "url": url,
            "file": "/".join(parts),          # 削除に使う、pages からの相対パス
            "path": "/".join(parts[:-1]) or ".",
            "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
            "_mtime": stat.st_mtime,
        })
    items.sort(key=lambda it: it["_mtime"], reverse=True)
    for it in items:
        del it["_mtime"]
    return items


def safe_relative_file(rel: str, root: Path):
    """pages の中の HTML ファイルだけを許す。外へ出る・隠しファイル・HTML 以外は None。"""
    if not rel or rel.startswith("/") or "\\" in rel or "\x00" in rel:
        return None
    parts = rel.split("/")
    if any(part in ("", ".", "..") or part.startswith(".") for part in parts):
        return None
    if not rel.lower().endswith((".html", ".htm")):
        return None
    target = (root / rel).resolve()
    try:
        target.relative_to(root.resolve())
    except ValueError:
        return None
    return target


# ---------- 画面（SK Material） ----------

def page_head(title: str) -> str:
    return (
        '<!doctype html>\n<html lang="ja"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
        '<meta name="robots" content="noindex,nofollow">'
        '<meta name="theme-color" content="#faf8ff" media="(prefers-color-scheme: light)">'
        '<meta name="theme-color" content="#11131b" media="(prefers-color-scheme: dark)">'
        f'<link rel="icon" type="image/svg+xml" href="{ASSETS_PREFIX}favicon.svg">'
        f"<title>{html.escape(title)}</title>"
        f'<link rel="stylesheet" href="{FONTS_URL}">'
        f'<link rel="stylesheet" href="{ASSETS_PREFIX}sk-material.css">'
        "</head>\n<body>\n"
    )


def top_bar(end_html: str = "") -> str:
    return (
        '<header class="sm-top"><a class="sm-brand" href="/">'
        f'<img src="{ASSETS_PREFIX}favicon.svg" width="28" height="28" alt="">'
        "<span>SK Hub</span></a>"
        f'<div class="sm-top__end">{end_html}</div></header>\n'
    )


def render_index(items: list[dict]) -> bytes:
    if items:
        cards = "\n".join(
            '<a class="md-card md-card--filled sm-card" href="{url}">'
            '<span class="sm-card__title"><span class="msr" aria-hidden="true">description</span>'
            "<span>{title}</span></span>"
            '<p class="sm-card__sub">{path}</p>'
            '<p class="sm-card__sub">更新 {modified}</p></a>'.format(
                url=html.escape(it["url"], quote=True),
                title=html.escape(it["title"]),
                path=html.escape(it["url"]),
                modified=html.escape(it["modified"]),
            )
            for it in items
        )
        body = f'<div class="sm-grid">\n{cards}\n</div>'
    else:
        body = (
            '<div class="md-card md-card--filled sm-empty"><span class="msr" aria-hidden="true">info</span>'
            "<span>まだページがありません。「ページの管理」から HTML を追加できます。</span></div>"
        )
    count = f"{len(items)} 件のページ"
    doc = (
        page_head("ホーム | SK Hub")
        + top_bar(f'<a class="md-btn md-btn--tonal" href="{MANAGE_PATH}">'
                  '<span class="msr" aria-hidden="true">edit_note</span>ページの管理</a>')
        + '<main class="sm-main">\n'
        '<div class="sm-head"><h1 class="sm-title">ホーム</h1>'
        f'<p class="sm-lead">{html.escape(count)}</p></div>\n'
        + body
        + "\n</main>\n</body></html>\n"
    )
    return doc.encode("utf-8")


def render_manage(items: list[dict]) -> bytes:
    if items:
        rows = "\n".join(
            '<li class="md-card md-card--filled sm-row">'
            '<div class="sm-row__text">'
            f'<a class="sm-row__title" href="{html.escape(it["url"], quote=True)}" target="_blank" rel="noopener">'
            f'{html.escape(it["title"])}</a>'
            f'<p class="sm-card__sub">{html.escape(it["file"])} ・ 更新 {html.escape(it["modified"])}</p></div>'
            '<button class="md-btn md-btn--tonal" type="button" data-delete="'
            + html.escape(it["file"], quote=True) + '" data-title="' + html.escape(it["title"], quote=True) + '">'
            '<span class="msr" aria-hidden="true">delete</span>削除</button></li>'
            for it in items
        )
        listing = f'<ul class="sm-list">\n{rows}\n</ul>'
    else:
        listing = (
            '<div class="md-card md-card--filled sm-empty"><span class="msr" aria-hidden="true">info</span>'
            "<span>まだページがありません。下のフォームから HTML を追加してください。</span></div>"
        )
    doc = (
        page_head("ページの管理 | SK Hub")
        + top_bar('<a class="md-btn md-btn--text" href="/">ホームへ</a>')
        + '<main class="sm-main">\n'
        '<div class="sm-head"><h1 class="sm-title">ページの管理</h1>'
        '<p class="sm-lead">HTML を追加・削除できます。削除は取り消せません。</p></div>\n'
        '<section class="md-card md-card--filled sm-form" aria-labelledby="add-h">'
        '<h2 id="add-h" class="sm-h2">ページを追加</h2>'
        '<label class="md-field"><span>ファイル（.html）</span>'
        '<input id="file" type="file" accept=".html,.htm,text/html"></label>'
        '<label class="md-field"><span>ページ名（英数字・ひらがな・カタカナ・漢字。例: memo）</span>'
        '<input id="name" type="text" maxlength="60" autocapitalize="off" spellcheck="false"></label>'
        '<div class="sm-actions"><button class="md-btn" type="button" id="add">追加する</button></div>'
        '<p id="msg" class="sm-msg" role="status" hidden></p>'
        "</section>\n"
        '<h2 class="sm-h2 sm-h2--list">今あるページ</h2>\n'
        + listing
        + "\n</main>\n"
        '<script src="/_assets/manage.js" defer></script>\n</body></html>\n'
    )
    return doc.encode("utf-8")


def inject_shell(data: bytes) -> bytes:
    """HTML の </body> 直前にメニューボタンの読み込みを差し込む。"""
    if SHELL_PATH.encode() in data:
        return data
    tag = ('<script src="' + SHELL_PATH + '" defer></script>').encode()
    matches = list(BODY_CLOSE_RE.finditer(data))
    if matches:
        pos = matches[-1].start()
        return data[:pos] + tag + data[pos:]
    return data + tag


# ---------- HTTP ----------

class Handler(BaseHTTPRequestHandler):
    server_version = "HomePages/3.0"
    pages_root: Path = DEFAULT_PAGES
    allowed_hosts: set = DEFAULT_HOSTS
    shell_js: bytes = b""

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

    def do_GET(self):
        if self._proxy_if_routed("GET"):
            return
        self._handle(head=False)

    def do_HEAD(self):
        if self._proxy_if_routed("HEAD"):
            return
        self._handle(head=True)

    def do_PUT(self):
        self._other_method("PUT")

    def do_PATCH(self):
        self._other_method("PATCH")

    def do_DELETE(self):
        self._other_method("DELETE")

    def do_OPTIONS(self):
        self._other_method("OPTIONS")

    def _other_method(self, method: str):
        if not self._proxy_if_routed(method):
            self._send(405, b"Method Not Allowed", "text/plain; charset=utf-8")

    def do_POST(self):
        if self._proxy_if_routed("POST"):
            return
        if not self._precheck(head=False):
            return
        if self.headers.get(CSRF_HEADER) != "1":
            return self._json(403, {"error": "この操作はできません"})
        path = self._path()
        if path == UPLOAD_PATH:
            return self._upload()
        if path == DELETE_PATH:
            return self._delete()
        return self._send(404, b"Not Found", "text/plain; charset=utf-8")

    def _send(self, status: int, body: bytes, ctype: str, head: bool = False, headers=()):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        for name, value in headers:
            self.send_header(name, value)
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def _json(self, status: int, obj, headers=()):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self._send(status, body, "application/json; charset=utf-8", False, headers)

    def _forbidden(self, head: bool):
        self._send(403, b"Forbidden", "text/plain; charset=utf-8", head)

    def _path(self):
        path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
        return None if "\x00" in path else path

    def _query(self) -> dict:
        return urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)

    def _precheck(self, head: bool) -> bool:
        """接続元 IP と Host を確かめる。だめなら 403 を返して False。"""
        if not is_allowed_ip(self.client_address[0]):
            self._forbidden(head)
            return False
        if self._hostname() not in self.allowed_hosts:
            self._forbidden(head)
            return False
        return True

    def _hostname(self) -> str:
        return (urllib.parse.urlsplit("//" + self.headers.get("Host", "")).hostname or "").lower()

    def _proxy_if_routed(self, method: str) -> bool:
        """Host 名が転送先に登録されていれば転送する。True なら応答済み。"""
        route = PROXY_ROUTES.get(self._hostname())
        if route is None:
            return False
        if not ip_in(self.client_address[0], TAILSCALE_NETWORKS):
            self._forbidden(method == "HEAD")
            return True
        self._forward(route, method)
        return True

    def _forward(self, route: ProxyRoute, method: str):
        head = method == "HEAD"
        if "chunked" in self.headers.get("Transfer-Encoding", "").lower():
            return self._send(411, "Content-Length が必要です".encode("utf-8"), "text/plain; charset=utf-8", head)
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._send(400, b"Bad Request", "text/plain; charset=utf-8", head)
        body = self.rfile.read(length) if length > 0 else None

        headers: dict = {}
        for name, value in self.headers.items():
            key = name.lower()
            if key in HOP_BY_HOP or key in ("x-forwarded-for", "x-forwarded-proto"):
                continue
            headers[name] = f"{headers[name]}, {value}" if name in headers else value
        headers["X-Forwarded-For"] = self.client_address[0]
        headers["X-Forwarded-Proto"] = "http"

        conn = http.client.HTTPConnection(route.hostname, route.port, timeout=120)
        try:
            conn.request(method, self.path, body=body, headers=headers)
            resp = conn.getresponse()
            data = resp.read()
        except OSError:
            return self._send(502, "WordPress に接続できません（Docker が起動しているか確認してください）".encode("utf-8"),
                              "text/plain; charset=utf-8", head)
        finally:
            conn.close()

        self.send_response(resp.status, resp.reason)
        for name, value in resp.getheaders():
            key = name.lower()
            if key in HOP_BY_HOP or key in ("server", "date"):
                continue
            if key == "content-length" and not head:
                continue
            self.send_header(name, value)
        if not head:
            self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        if not head:
            self.wfile.write(data)

    def _upload(self):
        name = (self._query().get("name") or [""])[0].strip()
        overwrite = (self._query().get("overwrite") or [""])[0] == "1"
        if not NAME_RE.match(name):
            return self._json(400, {"error": "ページ名は 1〜60 文字の英数字・ひらがな・カタカナ・漢字にしてください"})
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0:
            return self._json(411, {"error": "ファイルが空です"})
        if length > MAX_UPLOAD:
            return self._json(413, {"error": "ファイルが大きすぎます（5 MB まで）"})
        data = self.rfile.read(length)
        target = self.pages_root / f"{name}.html"
        root = self.pages_root.resolve()
        if target.resolve().parent != root:
            return self._json(400, {"error": "保存先が正しくありません"})
        if target.exists() and not overwrite:
            return self._json(409, {"error": "同じ名前のページがあります", "exists": True})
        self.pages_root.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(".html.tmp")
        tmp.write_bytes(data)
        os.replace(tmp, target)
        return self._json(200, {"ok": True, "url": f"/{name}.html"})

    def _delete(self):
        rel = (self._query().get("path") or [""])[0]
        target = safe_relative_file(rel, self.pages_root)
        if target is None or not target.is_file():
            return self._json(404, {"error": "ページが見つかりません"})
        target.unlink()
        return self._json(200, {"ok": True})

    def _handle(self, head: bool):
        if not self._precheck(head):
            return
        path = self._path()
        if path is None:
            return self._send(400, b"Bad Request", "text/plain; charset=utf-8", head)

        if path.startswith(ASSETS_PREFIX):
            return self._asset(path, head)
        if path == SHELL_PATH:
            return self._send(200, self.shell_js, "application/javascript; charset=utf-8", head)
        if path == "/api/pages":
            body = json.dumps(list_pages(self.pages_root), ensure_ascii=False).encode("utf-8")
            return self._send(200, body, "application/json; charset=utf-8", head)
        if path == MANAGE_PATH:
            return self._send(200, render_manage(list_pages(self.pages_root)),
                              "text/html; charset=utf-8", head)
        if path == "/":
            return self._send(200, render_index(list_pages(self.pages_root)),
                              "text/html; charset=utf-8", head)

        root = self.pages_root.resolve()
        target = (root / path.lstrip("/")).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            return self._forbidden(head)
        if any(part.startswith(".") for part in target.relative_to(root).parts):
            return self._send(404, b"Not Found", "text/plain; charset=utf-8", head)
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            return self._send(404, "ページが見つかりません".encode("utf-8"),
                              "text/plain; charset=utf-8", head)

        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        data = target.read_bytes()
        if target.suffix.lower() in (".html", ".htm"):
            data = inject_shell(data)
            ctype = "text/html; charset=utf-8"
        return self._send(200, data, ctype, head)

    def _asset(self, path: str, head: bool):
        assets_root = (HERE / "assets").resolve()
        asset = (assets_root / path[len(ASSETS_PREFIX):]).resolve()
        try:
            asset.relative_to(assets_root)
        except ValueError:
            return self._forbidden(head)
        if not asset.is_file():
            return self._send(404, b"Not Found", "text/plain; charset=utf-8", head)
        ctype = {
            ".css": "text/css; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".svg": "image/svg+xml",
        }.get(asset.suffix.lower(), mimetypes.guess_type(asset.name)[0] or "application/octet-stream")
        return self._send(200, asset.read_bytes(), ctype, head)


def main():
    # Windows の既定コンソール（cp949 など）では日本語の表示でエラーになるので UTF-8 に固定する
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="家庭サーバー用の非公開ページサーバー")
    parser.add_argument("--host", default="0.0.0.0", help="待ち受けアドレス（既定: 0.0.0.0）")
    parser.add_argument("--port", type=int, default=8787, help="ポート番号（既定: 8787）")
    parser.add_argument("--pages", default=str(DEFAULT_PAGES), help="HTML を置くフォルダ")
    parser.add_argument("--allow-host", action="append", default=[],
                        help="追加で許可する Host 名（例: IP アドレス や xxx.ts.net）。複数指定可")
    parser.add_argument("--proxy", action="append", default=[],
                        help="Host 名を転送する（例: wordpress.private.sk-hub.jp=http://127.0.0.1:8080）。複数指定可。"
                             "指定しなければ既定の転送（DEFAULT_PROXIES）を使う")
    args = parser.parse_args()

    root = Path(args.pages).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)

    Handler.pages_root = root
    Handler.allowed_hosts = DEFAULT_HOSTS | {h.lower() for h in args.allow_host}
    Handler.shell_js = (HERE / "shell.js").read_bytes()
    try:
        routes = [parse_proxy(s) for s in (args.proxy or DEFAULT_PROXIES)]
    except ValueError as e:
        parser.error(str(e))
    PROXY_ROUTES.clear()
    PROXY_ROUTES.update({r.host: r for r in routes})
    for r in routes:
        print(f"転送: {r.host} → http://{r.hostname}:{r.port}/  （Tailscale からだけ）")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"ページフォルダ: {root}")
    print(f"待ち受け: http://{args.host}:{args.port}/  (許可ホスト: {', '.join(sorted(Handler.allowed_hosts))})")
    print("停止するには Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
