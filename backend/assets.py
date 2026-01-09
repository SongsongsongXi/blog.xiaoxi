from __future__ import annotations
import re
import urllib.request
from pathlib import Path
from typing import Iterable

KA_TEX_VER = "0.16.11"
HLJS_VER = "11.10.0"

# 优先使用较稳定的 unpkg 镜像
KATEX_BASE = f"https://unpkg.com/katex@{KA_TEX_VER}/dist"
HLJS_BASE = f"https://unpkg.com/highlight.js@{HLJS_VER}"


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            data = resp.read()
        dest.write_bytes(data)
    except Exception as e:
        # 失败时留空，由前端 fallback 或后续重试
        if not dest.exists():
            try:
                dest.write_text("", encoding="utf-8")
            except Exception:
                pass


def _parse_font_urls(css_text: str) -> Iterable[str]:
    # 匹配 url(...) 中的 KaTeX 字体文件名（woff2/woff/ttf）
    for m in re.finditer(r"url\((?:'|\")?(?:\.\./)?fonts/([^'\")]+)\1?\)", css_text):
        fname = m.group(1)
        if any(fname.endswith(ext) for ext in (".woff2", ".woff", ".ttf")):
            yield fname


def ensure_vendor_assets(public_dir: Path) -> None:
    vendor = public_dir / "vendor"
    katex_dir = vendor / "katex"
    hljs_dir = vendor / "highlight.js"

    # KaTeX: css + js + auto-render + fonts referenced by css
    katex_css = katex_dir / "katex.min.css"
    if not katex_css.exists() or katex_css.stat().st_size == 0:
        _download(f"{KATEX_BASE}/katex.min.css", katex_css)
    try:
        css_text = katex_css.read_text(encoding="utf-8")
    except Exception:
        css_text = ""
    for fname in set(_parse_font_urls(css_text)):
        _download(f"{KATEX_BASE}/fonts/{fname}", katex_dir / "fonts" / fname)
    # js
    _download(f"{KATEX_BASE}/katex.min.js", katex_dir / "katex.min.js")
    _download(f"{KATEX_BASE}/contrib/auto-render.min.js", katex_dir / "auto-render.min.js")

    # highlight.js: 浏览器 UMD 版本位于 build 目录
    _download(f"{HLJS_BASE}/build/highlight.min.js", hljs_dir / "highlight.min.js")
    _download(f"{HLJS_BASE}/styles/github.min.css", hljs_dir / "styles" / "github.min.css")
