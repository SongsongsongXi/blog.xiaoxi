from __future__ import annotations
import os
from pathlib import Path
import time
from typing import Optional
import logging
import sys
import re
import html
import urllib.request
import urllib.error

from fastapi import FastAPI, HTTPException, Request, Query
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import ORJSONResponse, Response, HTMLResponse, PlainTextResponse, FileResponse
import json
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config_loader import ConfigLoader
from .indexer import DocsIndexer
from .models import Health, PostPage, PageMeta, PostManifest, PostChunk, PostMeta

ROOT = Path(__file__).resolve().parent.parent

def _env_path(var_name: str, default_path: Path) -> Path:
    """Resolve a path from environment variable if provided, else fallback.
    Allows overriding docs/public/config locations via env:
      - BLOG_DOCS_DIR
      - BLOG_PUBLIC_DIR
      - BLOG_CONFIG_PATH
    """
    val = os.environ.get(var_name)
    if val:
        try:
            return Path(val).resolve()
        except Exception:
            return Path(val)
    return default_path

DOCS_DIR = _env_path("BLOG_DOCS_DIR", ROOT / "docs")
PUBLIC_DIR = _env_path("BLOG_PUBLIC_DIR", ROOT / "public")
CONFIG_PATH = _env_path("BLOG_CONFIG_PATH", ROOT / "config.json")

# 配置日志：控制台输出 INFO 以上，run.log 只记录 FATAL
root_logger = logging.getLogger()
if not root_logger.handlers:
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(logging.INFO)
    console.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))

    fatal_handler = logging.FileHandler("run.log", encoding="utf-8")
    fatal_handler.setLevel(logging.FATAL)
    fatal_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))

    root_logger.setLevel(logging.INFO)
    root_logger.addHandler(console)
    root_logger.addHandler(fatal_handler)

app = FastAPI(title="Markdown Blog", default_response_class=ORJSONResponse)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET"],
    allow_headers=["*"]
)
app.add_middleware(GZipMiddleware, minimum_size=1000)

indexer = DocsIndexer(DOCS_DIR, PUBLIC_DIR)
indexer.start_watch()

config_loader = ConfigLoader(CONFIG_PATH)
config_loader.start_watch()

app.mount("/static", StaticFiles(directory=str(PUBLIC_DIR)), name="static")

# Build tag for static cache-busting (helps clients/CDN fetch the latest app.js/app.css)
BUILD_TAG = os.environ.get("BLOG_BUILD_TAG") or str(int(time.time()))

SITE_ORIGIN = (os.environ.get("BLOG_SITE_ORIGIN") or "http://localhost:8000").rstrip('/')

BAIDU_PUSH_ENDPOINT = os.environ.get("BAIDU_PUSH_ENDPOINT")
if not BAIDU_PUSH_ENDPOINT:
    baidu_token = (os.environ.get("BAIDU_PUSH_TOKEN") or "").strip()
    baidu_site = (os.environ.get("BAIDU_PUSH_SITE") or SITE_ORIGIN)
    if baidu_token and baidu_site:
        BAIDU_PUSH_ENDPOINT = f"https://data.zz.baidu.com/urls?site={baidu_site}&token={baidu_token}"
    else:
        BAIDU_PUSH_ENDPOINT = ""

BING_API_KEY = (os.environ.get("BING_API_KEY") or "").strip()
BING_PUSH_ENDPOINT = os.environ.get("BING_PUSH_ENDPOINT")
if not BING_PUSH_ENDPOINT and BING_API_KEY:
    BING_PUSH_ENDPOINT = f"https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlbatch?apikey={BING_API_KEY}"
elif not BING_PUSH_ENDPOINT:
    BING_PUSH_ENDPOINT = ""
BING_SITE_URL = (os.environ.get("BING_SITE_URL") or SITE_ORIGIN)


def _maybe_304(request: Request, etag: Optional[str]) -> Optional[Response]:
    if not etag:
        return None
    inm = request.headers.get("if-none-match")
    if inm and etag in inm:
        return Response(status_code=304)
    return None


class PushPayload(BaseModel):
    url: str


def _push_to_search_engines(url: str) -> dict:
    result: dict[str, dict] = {}
    if BAIDU_PUSH_ENDPOINT:
        result["baidu"] = _push_baidu([url])
    else:
        result["baidu"] = {"ok": False, "skipped": True, "reason": "BAIDU endpoint missing"}
    if BING_PUSH_ENDPOINT and BING_SITE_URL:
        result["bing"] = _push_bing([url])
    else:
        result["bing"] = {"ok": False, "skipped": True, "reason": "Bing endpoint missing"}
    return result


def _push_baidu(urls: list[str]) -> dict:
    payload = "\n".join(urls).encode("utf-8")
    req = urllib.request.Request(
        BAIDU_PUSH_ENDPOINT,
        data=payload,
        headers={"Content-Type": "text/plain"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8", "ignore")
            try:
                body = json.loads(raw) if raw else {}
            except Exception:
                body = {"raw": raw}
            return {"ok": True, "status": resp.status, "body": body}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "ignore")
        return {"ok": False, "status": exc.code, "body": raw or exc.reason}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


def _push_bing(urls: list[str]) -> dict:
    payload = json.dumps({"siteUrl": BING_SITE_URL, "urlList": urls}).encode("utf-8")
    req = urllib.request.Request(
        BING_PUSH_ENDPOINT,
        data=payload,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = resp.read().decode("utf-8", "ignore")
            parsed = None
            if raw:
                try:
                    parsed = json.loads(raw)
                except Exception:
                    parsed = raw
            return {"ok": True, "status": resp.status, "body": parsed}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", "ignore")
        return {"ok": False, "status": exc.code, "body": raw or exc.reason}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}


@app.get("/api/health", response_model=Health)
async def health() -> Health:
    return Health(status="ok", docsVersion=indexer.version, configVersion=config_loader.version)


@app.get("/api/version")
async def version():
    return {"docsVersion": indexer.version, "configVersion": config_loader.version}


@app.get("/api/config")
async def get_config(request: Request):
    cfg = config_loader.get()
    return ORJSONResponse(cfg.model_dump(), headers={
        # 明确禁止缓存，避免 CDN/浏览器产生 304 导致前端拿不到包体
        "Cache-Control": "no-store"
    })


@app.get("/book.json")
async def get_book_json():
    if not (ROOT / "book.json").exists():
         raise HTTPException(status_code=404)
    return FileResponse(ROOT / "book.json")


@app.get("/api/posts")
async def list_posts(
    request: Request,
    q: str | None = Query(default=None, description="搜索关键词，匹配标题、标签、正文"),
    page: int = Query(default=1, ge=1),
    pageSize: int = Query(default=10, ge=1, le=2000),
    paged: bool = Query(default=False, description="为 true 时返回分页对象；否则按旧格式返回数组")
):
    all_items = indexer.search_posts(q)
    if not paged and q is None and page == 1:
        # 兼容旧格式：无搜索且第一页、未显式请求分页 -> 返回完整数组
        items = [m.model_dump() for m in all_items]
        return ORJSONResponse(items, headers={
            "Cache-Control": "no-store"
        })
    total = len(all_items)
    start = (page - 1) * pageSize
    end = start + pageSize
    page_items = all_items[start:end]
    total_pages = (total + pageSize - 1) // pageSize if pageSize else 1
    resp = PostPage(
        items=[m for m in page_items],
        page=PageMeta(
            total=total,
            page=page,
            pageSize=pageSize,
            totalPages=total_pages,
            hasPrev=page > 1,
            hasNext=page < total_pages,
        )
    )
    return ORJSONResponse(resp.model_dump(), headers={
        "Cache-Control": "no-store"
    })


@app.get("/api/post/{slug}")
async def get_post(slug: str, request: Request, chunked: bool | None = Query(default=False)):
    if chunked:
        mf = indexer.get_post_manifest(slug)
        if not mf:
            raise HTTPException(status_code=404, detail="Post not found")
        meta, total, toc_html, chunk_types, ph_ids = mf
        pm = PostManifest(
            slug=meta.slug, title=meta.title, date=meta.date, tags=meta.tags,
            summary=meta.summary, totalChunks=total, toc_html=toc_html or None,
            chunk_types=chunk_types, ph_ids=ph_ids
        )
        return ORJSONResponse(pm.model_dump(), headers={"Cache-Control": "no-store"})
    post = indexer.get_post(slug)
    if not post:
        raise HTTPException(status_code=404, detail="Post not found")
    return ORJSONResponse(post.model_dump(), headers={
        "Cache-Control": "no-store"
    })

@app.get("/api/post/{slug}/chunk/{index}")
async def get_post_chunk(slug: str, index: int):
    html = indexer.get_post_chunk(slug, index)
    if html is None:
        raise HTTPException(status_code=404, detail="Chunk not found")
    pc = PostChunk(slug=slug, index=index, html=html)
    return ORJSONResponse(pc.model_dump(), headers={"Cache-Control": "no-store"})


@app.post("/api/push")
async def push_url(payload: PushPayload):
    url = (payload.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="url 不能为空")
    
    # 校验域名（允许本地调试）
    is_local = "localhost" in url or "127.0.0.1" in url
    if SITE_ORIGIN and not url.startswith(SITE_ORIGIN) and not is_local:
        raise HTTPException(status_code=400, detail="仅允许推送本站链接")
    
    result = await run_in_threadpool(lambda: _push_to_search_engines(url))
    return ORJSONResponse(result, headers={"Cache-Control": "no-store"})



@app.get("/api/stats/post_activity")
async def get_post_activity():
    from datetime import datetime, timedelta

    posts = indexer._sorted_posts(metas_only=True)
    
    # We only care about the last year of activity
    one_year_ago = datetime.now() - timedelta(days=365)
    
    activity = {}
    for post in posts:
        if not post.date:
            continue
        try:
            # Assuming date is in ISO format like '2023-10-27T10:00:00Z' or just '2023-10-27'
            post_date = datetime.fromisoformat(post.date.replace('Z', '+00:00'))
            if post_date > one_year_ago:
                # cal-heatmap prefers unix timestamps in seconds
                timestamp = int(post_date.timestamp())
                day_start_timestamp = timestamp - (timestamp % 86400) # Floor to the start of the day
                activity[day_start_timestamp] = activity.get(day_start_timestamp, 0) + 1
        except (ValueError, TypeError):
            continue
            
    return ORJSONResponse(activity, headers={"Cache-Control": "public, max-age=3600"})


def _inject_site_config(html_text: str, request: Optional[Request] = None, post_meta: Optional[PostMeta] = None) -> str:
    try:
        cfg = config_loader.get()
        payload = cfg.model_dump()
        cfg_json = json.dumps(payload, ensure_ascii=False)
        cfg_json = cfg_json.replace("</script>", "<\\/script>")
        site_name = payload.get("siteName") or "学术博客"
        site_desc = payload.get("description") or ""
        site_keywords = payload.get("keywords") or []

        seo = []
        if not post_meta and site_desc:
            seo.append(f"<meta name=\"description\" content=\"{_escape_attr(site_desc)}\" />")
        if not post_meta and isinstance(site_keywords, list) and site_keywords:
            kw = ", ".join([str(x) for x in site_keywords if str(x).strip()])
            if kw:
                seo.append(f"<meta name=\"keywords\" content=\"{_escape_attr(kw)}\" />")
        seo.append(f"<meta property=\"og:site_name\" content=\"{_escape_attr(site_name)}\" />")
        if not post_meta:
            seo.append("<meta property=\"og:type\" content=\"website\" />")
            if site_name:
                seo.append(f"<meta property=\"og:title\" content=\"{_escape_attr(site_name)}\" />")
            if site_desc:
                seo.append(f"<meta property=\"og:description\" content=\"{_escape_attr(site_desc)}\" />")

        page_meta_tags: list[str] = []
        if post_meta:
            html_text = _replace_title_with_post(html_text, site_name, post_meta)
            page_meta_tags = _build_post_meta_tags(site_name, post_meta, request)

        snippet = "\n".join([
            f"<script id=\"site-config\" type=\"application/json\">{cfg_json}</script>",
            *seo,
            *page_meta_tags,
        ])

        def add_ver(s: str) -> str:
            out = s
            out = out.replace('/static/app.js"', f'/static/app.js?v={BUILD_TAG}"')
            out = out.replace('/static/app.css"', f'/static/app.css?v={BUILD_TAG}"')
            out = out.replace('/static/highlight.min.js"', f'/static/highlight.min.js?v={BUILD_TAG}"')
            out = out.replace('/static/push.js"', f'/static/push.js?v={BUILD_TAG}"')
            return out

        html_text = add_ver(html_text)
        if "</head>" in html_text:
            return html_text.replace("</head>", snippet + "\n</head>")
        if "</body>" in html_text:
            return html_text.replace("</body>", snippet + "\n</body>")
        return html_text + snippet
    except Exception:
        return html_text


def _escape_attr(value: str) -> str:
    return html.escape(value, quote=True)


def _replace_title_with_post(html_text: str, site_name: str, post_meta: PostMeta) -> str:
    base = post_meta.title or site_name or "学术博客"
    if post_meta.title and site_name:
        title = f"{post_meta.title} - {site_name}"
    else:
        title = base
    escaped = _escape_attr(title)
    pattern = re.compile(r"<title>.*?</title>", re.IGNORECASE | re.DOTALL)
    replacement = f"<title>{escaped}</title>"
    if pattern.search(html_text):
        return pattern.sub(replacement, html_text, count=1)
    return replacement + html_text


def _build_post_meta_tags(site_name: str, post_meta: PostMeta, request: Optional[Request]) -> list[str]:
    tags: list[str] = []
    summary = (post_meta.summary or "").strip()
    keywords = ", ".join([str(t) for t in (post_meta.tags or []) if str(t).strip()])
    if summary:
        tags.append(f"<meta name=\"description\" content=\"{_escape_attr(summary)}\" data-page=\"post\" />")
    if keywords:
        tags.append(f"<meta name=\"keywords\" content=\"{_escape_attr(keywords)}\" data-page=\"post\" />")

    og_title = post_meta.title or site_name or "学术博客"
    og_desc = summary or ""
    tags.append("<meta property=\"og:type\" content=\"article\" />")
    tags.append(f"<meta property=\"og:title\" content=\"{_escape_attr(og_title)}\" data-page=\"post\" />")
    if og_desc:
        tags.append(f"<meta property=\"og:description\" content=\"{_escape_attr(og_desc)}\" data-page=\"post\" />")

    canonical_path = f"/post/{post_meta.slug}"
    canonical = _build_abs(request, canonical_path) if request else canonical_path
    tags.append(f"<link rel=\"canonical\" href=\"{_escape_attr(canonical)}\" data-page=\"post\" />")
    tags.append(f"<meta property=\"og:url\" content=\"{_escape_attr(canonical)}\" data-page=\"post\" />")

    if post_meta.date:
        tags.append(f"<meta property=\"article:published_time\" content=\"{_escape_attr(post_meta.date)}\" data-page=\"post\" />")

    return tags


@app.get("/")
async def home(request: Request):
    index_html = PUBLIC_DIR / "index.html"
    if index_html.exists():
        text = index_html.read_text(encoding="utf-8")
        text = _inject_site_config(text, request=request)
        return HTMLResponse(text, headers={"Cache-Control": "no-cache, must-revalidate"})
    return HTMLResponse("<h1>Markdown Blog</h1>")


def _build_abs(request: Request, path: str) -> str:
    base = str(request.base_url).rstrip('/')
    if not path.startswith('/'):
        path = '/' + path
    return base + path


@app.get("/robots.txt")
async def robots(request: Request):
    txt = "\n".join([
        "User-agent: *",
        "Allow: /",
        f"Sitemap: {_build_abs(request, '/sitemap.xml')}"
    ])
    return PlainTextResponse(txt)


@app.get("/sitemap.xml")
async def sitemap(request: Request):
    # 生成简易 sitemap：首页 + 文章
    from datetime import datetime
    def xmlesc(s: str) -> str:
        return (s.replace("&", "&amp;")
                 .replace("<", "&lt;")
                 .replace(">", "&gt;")
                 .replace('"', "&quot;")
                 .replace("'", "&apos;"))

    urls = []
    # 首页
    urls.append({
        "loc": _build_abs(request, "/"),
        "lastmod": datetime.utcfromtimestamp(indexer.version or int(time.time())).strftime('%Y-%m-%dT%H:%M:%SZ'),
        "changefreq": "daily",
        "priority": "1.0",
    })
    # 文章（注意：前端为 hash 路由，站点仍列出 #/post/slug，实际抓取依赖于搜索引擎执行 JS）
    for meta in indexer.list_posts():
        slug = meta.slug
        # 使用 hash 路由形式
        loc = _build_abs(request, f"/#/post/{slug}")
        last = meta.date or None
        if last:
            try:
                # 标准化时间格式
                dt = datetime.fromisoformat(last.replace('Z','+00:00'))
                lastmod = dt.strftime('%Y-%m-%dT%H:%M:%SZ')
            except Exception:
                lastmod = None
        else:
            # 退化为当前时间
            lastmod = datetime.utcfromtimestamp(int(time.time())).strftime('%Y-%m-%dT%H:%M:%SZ')
        urls.append({
            "loc": loc,
            "lastmod": lastmod,
            "changefreq": "weekly",
            "priority": "0.8",
        })

    parts = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    ]
    for u in urls:
        parts.append("  <url>")
        parts.append(f"    <loc>{xmlesc(u['loc'])}</loc>")
        if u.get('lastmod'):
            parts.append(f"    <lastmod>{u['lastmod']}</lastmod>")
        if u.get('changefreq'):
            parts.append(f"    <changefreq>{u['changefreq']}</changefreq>")
        if u.get('priority'):
            parts.append(f"    <priority>{u['priority']}</priority>")
        parts.append("  </url>")
    parts.append("</urlset>")
    xml = "\n".join(parts)
    return Response(content=xml, media_type="application/xml")


@app.get("/manifest.json")
async def get_manifest():
    return FileResponse(PUBLIC_DIR / "manifest.json", media_type="application/json")


@app.get("/sw.js")
async def get_sw():
    return FileResponse(PUBLIC_DIR / "sw.js", media_type="application/javascript")


@app.get("/feed")
@app.get("/rss.xml")
async def rss(request: Request):
    # 生成 RSS 2.0 Feed
    from datetime import datetime
    import email.utils

    def xmlesc(s: str) -> str:
        if not s: return ""
        return (s.replace("&", "&amp;")
                 .replace("<", "&lt;")
                 .replace(">", "&gt;")
                 .replace('"', "&quot;")
                 .replace("'", "&apos;"))

    cfg = config_loader.get()
    site_name = cfg.siteName or "学术博客"
    site_desc = cfg.description or ""
    site_url = str(request.base_url).rstrip('/')

    items = []
    for meta in indexer.list_posts():
        slug = meta.slug
        link = f"{site_url}/post/{slug}"
        title = meta.title
        desc = meta.summary or ""
        pub_date = ""
        if meta.date:
            try:
                dt = datetime.fromisoformat(meta.date.replace('Z','+00:00'))
                pub_date = email.utils.format_datetime(dt)
            except Exception:
                pass
        
        items.append(f"""
    <item>
      <title>{xmlesc(title)}</title>
      <link>{link}</link>
      <guid>{link}</guid>
      <description>{xmlesc(desc)}</description>
      <pubDate>{pub_date}</pubDate>
    </item>""")

    rss_xml = f"""<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>{xmlesc(site_name)}</title>
    <link>{site_url}</link>
    <description>{xmlesc(site_desc)}</description>
    <language>zh-cn</language>
    {"".join(items)}
  </channel>
</rss>"""
    return Response(content=rss_xml, media_type="application/xml")


@app.get("/{full_path:path}")
async def spa(full_path: str, request: Request):
    # 非 API 路径统一返回 index.html，交给前端路由处理
    if full_path.startswith("api/"):
        raise HTTPException(status_code=404)
    post_meta = None
    if full_path.startswith("post/"):
        slug = full_path[len("post/"):]
        if slug:
            post_meta = indexer.get_post_meta(slug)
    index_html = PUBLIC_DIR / "index.html"
    if index_html.exists():
        text = index_html.read_text(encoding="utf-8")
        text = _inject_site_config(text, request=request, post_meta=post_meta)
        return HTMLResponse(text, headers={"Cache-Control": "no-cache, must-revalidate"})
    raise HTTPException(status_code=404)