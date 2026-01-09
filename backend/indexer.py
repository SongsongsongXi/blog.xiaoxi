from __future__ import annotations
import hashlib
import html
import os
import re
import threading
from dataclasses import dataclass
import base64
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Any

import frontmatter
from markdown import Markdown

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from .models import Post, PostMeta

try:
    from PIL import Image  # type: ignore
except Exception:
    Image = None  # Pillow 可选；缺失时跳过 LQIP 生成


MD_EXTENSIONS = [
    "extra",
    "toc",
    "admonition",
    "codehilite",
    "smarty",
    "footnotes",
    "tables",
    "attr_list",
    "sane_lists",  # 修复列表混合问题
    "abbr",
    "def_list",
    "pymdownx.superfences",
    "pymdownx.tasklist",
    "pymdownx.details",
    "pymdownx.caret",
    "pymdownx.mark",
    "pymdownx.tilde",
    # 使用 arithmatex 以便前端用 KaTeX 渲染
    "pymdownx.arithmatex",
]


@dataclass
class _PostData:
    meta: PostMeta
    content_html: str
    content_text: str
    updated_at: float
    chunks: List[str]
    toc_html: str
    chunk_types: Optional[List[str]] = None
    ph_ids: Optional[List[Optional[str]]] = None


# 配置扩展参数
MD_EXTENSION_CONFIGS = {
    "pymdownx.superfences": {
        "custom_fences": [
            {
                "name": "mermaid",
                "class": "mermaid",
                "format": lambda source, language, css_class, options, md, classes, id_value, attrs, **kwargs:
                    f'<div class="{css_class}">{html.escape(source)}</div>'
            }
        ]
    },
    "pymdownx.arithmatex": {
        "generic": True,
    }
}


class _DocsEventHandler(FileSystemEventHandler):
    def __init__(self, indexer: "DocsIndexer") -> None:
        super().__init__()
        self.indexer = indexer

    def on_modified(self, event):
        if event.is_directory:
            return
        if event.src_path.lower().endswith(".md"):
            self.indexer.index_file(Path(event.src_path))

    def on_created(self, event):
        if event.is_directory:
            return
        if event.src_path.lower().endswith(".md"):
            self.indexer.index_file(Path(event.src_path))

    def on_deleted(self, event):
        if event.is_directory:
            return
        if event.src_path.lower().endswith(".md"):
            self.indexer.remove_file(Path(event.src_path))


class DocsIndexer:
    def __init__(self, docs_root: Path, public_dir: Optional[Path] = None) -> None:
        self.docs_root = docs_root
        self.public_dir = public_dir
        self._lock = threading.Lock()
        self._posts: Dict[str, _PostData] = {}
        self.version = 0
        self._observer: Optional[Any] = None
        self._md = self._create_markdown()
        self.scan_all()

    def _create_markdown(self) -> Markdown:
        # 合并默认配置与全局配置
        configs = MD_EXTENSION_CONFIGS.copy()
        configs.update({
            "codehilite": {
                "guess_lang": False,
                "pygments_style": "default",
                "noclasses": False,
            },
            # 仅生成 TOC，不依赖文中 [TOC] 占位符
            "toc": {
                # 包含 H1-H6，避免只有一级标题时目录不全
                "toc_depth": "1-6",
                "toc_class": "toc",
            }
        })
        
        md = Markdown(
            extensions=MD_EXTENSIONS,
            extension_configs=configs
        )
        return md

    def _make_slug(self, path: Path) -> str:
        rel = path.relative_to(self.docs_root)
        slug = rel.as_posix()
        if slug.lower().endswith('.md'):
            slug = slug[:-3]
        return slug

    def _extract_summary(self, text: str) -> str:
        # 提取前 200 个字符作为摘要，忽略空行
        summary_parts = []
        current_len = 0
        for line in text.splitlines():
            t = line.strip()
            if not t:
                continue
            summary_parts.append(t)
            current_len += len(t)
            if current_len >= 200:
                break
        
        full_summary = " ".join(summary_parts)
        if len(full_summary) > 200:
            return full_summary[:197] + "..."
        return full_summary

    def _render(self, body: str) -> Tuple[str, str, str]:
        # 重新创建 Markdown 实例以避免全局状态污染（如 toc）
        md = self._create_markdown()
        html_content = md.convert(body)
        # 若文中未显式写 [TOC]，也自动在文首插入目录（由 toc 扩展生成）
        try:
            toc_html = getattr(md, "toc", "") or ""
        except Exception:
            toc_html = ""
        if toc_html and "[TOC]" not in body:
            # 默认仍在文首插入目录，便于非分块模式前端直接移动到侧栏；
            # 分块模式下会在后续切分前去除该文首 TOC（保持仅侧栏显示）。
            html_content = f"{toc_html}\n" + html_content
        # 后处理：标题分段内重置有序列表序号（避免由于段落/代码块等元素导致的 Markdown 序号断裂）
        # 逻辑：找到所有顶级标题（h1-h6），对其之间的区块中的 <ol> 重写内部 <li> 的序号，遇到新标题时重置。
        # 仅当 <ol> 标记未显式设置 start 属性时才重写。
        try:
            html_content = self._renumber_ol_by_heading(html_content)
        except Exception:
            pass
        # 简单去除 HTML 标签获取纯文本用于摘要与搜索
        text = re.sub(r"<[^>]+>", "", html_content)
        text = html.unescape(text)
        return html_content, text, toc_html

    def _strip_leading_toc(self, html_content: str) -> str:
        """移除文首自动插入的 TOC（<div class="toc">...</div>）块，供分块模式使用。
        仅当它出现在开头（忽略前导空白）时移除，避免误删正文中的目录片段。
        """
        if not html_content:
            return html_content
        # 允许前导空白与换行
        m = re.match(r"^\s*<div\b[^>]*\bclass=\"[^\"]*\btoc\b[^\"]*\"[^>]*>.*?</div>\s*", html_content, re.IGNORECASE | re.DOTALL)
        if m:
            return html_content[m.end():]
        return html_content

    def _chunk_html(self, html_content: str, base_dir: Optional[Path] = None) -> Tuple[List[str], List[str], List[Optional[str]]]:
        """按“行”（块级结尾）切分文本，并将每个 <img> 单独成块。

        返回：
        - chunks: List[str]
        - chunk_types: 同长度，'text' 或 'image'
        - ph_ids: 同长度，图片块对应其占位符 id；文本块为 None
        约定：chunks 顺序为：先所有文本块（保持原文顺序），再所有图片块（保持出现顺序）。
        文本中原来的 <img> 被替换为占位占位 DOM：<div class="img-ph" data-ph="phN"><div class="lazy-spinner"></div></div>
        这样可以先加载文本，再按 phN 回填图片。
        """
        if not html_content:
            return [], [], []
        # 1) 提取所有图片，生成占位符
        img_re = re.compile(r"<img\b[^>]*>", re.IGNORECASE | re.DOTALL)
        images: List[str] = []
        ph_for_img: List[str] = []
        # 内部：根据 <img> 的 src 生成 LQIP（仅本地文件）；返回 (data_url, (w,h)) 或 (None, None)
        def _gen_lqip(src_val: str) -> Tuple[Optional[str], Optional[Tuple[int, int]]]:
            if not src_val:
                return None, None
            s = src_val.strip()
            # data: 或 http(s): 跳过
            if s.lower().startswith('data:') or s.lower().startswith('http:') or s.lower().startswith('https:'):
                return None, None
            # 解析本地路径：
            # - 以 /static/ 开头 -> 映射到 public_dir
            # - 以 / 开头 -> 若有 public_dir 则去掉前导 / 后拼接
            # - 否则按 base_dir 相对路径解析
            fs_path: Optional[Path] = None
            try:
                if s.startswith('/'):
                    # /static/foo/bar.png -> PUBLIC_DIR/static/foo/bar.png
                    if s.startswith('/static/') and self.public_dir:
                        fs_path = self.public_dir / s.lstrip('/')
                    elif self.public_dir:
                        fs_path = self.public_dir / s.lstrip('/')
                else:
                    if base_dir:
                        fs_path = (base_dir / s).resolve()
            except Exception:
                fs_path = None
            if not fs_path or not fs_path.exists():
                return None, None
            # 生成小图（宽 24px）
            if Image is None:
                return None, None
            try:
                with Image.open(str(fs_path)) as im:
                    im = im.convert('RGB')
                    w0, h0 = im.size
                    if w0 <= 0 or h0 <= 0:
                        return None, None
                    target_w = 24
                    target_h = max(1, int(round(h0 * (target_w / float(w0)))))
                    im_small = im.resize((target_w, target_h))
                    import io
                    buf = io.BytesIO()
                    im_small.save(buf, format='JPEG', quality=30, optimize=True)
                    b64 = base64.b64encode(buf.getvalue()).decode('ascii')
                    data_url = f'data:image/jpeg;base64,{b64}'
                    return data_url, (w0, h0)
            except Exception:
                return None, None
            return None, None
        def repl_img(m):
            idx = len(images)
            html_img = m.group(0)
            images.append(html_img)
            ph = f"ph{idx}"
            ph_for_img.append(ph)
            # 提取 src
            src_m = re.search(r"\bsrc\s*=\s*(\"([^\"]*)\"|'([^']*)')", html_img, re.IGNORECASE)
            src_val = src_m.group(2) if src_m and src_m.group(2) is not None else (src_m.group(3) if src_m else '')
            lqip_url, wh = _gen_lqip(src_val or '')
            style_bits: List[str] = []
            if wh and wh[0] > 0 and wh[1] > 0:
                style_bits.append(f"aspect-ratio: {wh[0]} / {wh[1]}")
            if lqip_url:
                # 直接内联背景，便于在图片块到达前展示模糊预览
                style_bits.append(f"background-image: url('{lqip_url}')")
                style_bits.append("background-size: cover")
                style_bits.append("background-position: center")
                style_bits.append("filter: blur(14px)")
            style_attr = (" style=\"" + "; ".join(style_bits) + "\"") if style_bits else ""
            data_attr = (f" data-lqip=\"{lqip_url}\"") if lqip_url else ""
            return f'<div class="img-ph" data-ph="{ph}"{data_attr}{style_attr}><div class="lazy-spinner"></div></div>'
        text_with_ph = img_re.sub(repl_img, html_content)
        # 2) 将文本按“行”（块级结束）切分
        # 使用常见块级元素结束作为换行点；保留分隔符在同一段末尾
        sep = re.compile(r'(</(?:p|pre|h[1-6]|li|ul|ol|table)>|<br\s*/?>)', re.IGNORECASE)
        parts = sep.split(text_with_ph)
        text_chunks: List[str] = []
        
        # 优化：合并过小的文本块，避免 chunk 数量过多导致加载变慢
        current_parts: List[str] = []
        current_len = 0
        MIN_CHUNK_SIZE = 3000  # 设定阈值，例如 3000 字符

        i = 0
        while i < len(parts):
            segment = parts[i]
            delim = parts[i+1] if (i + 1) < len(parts) and sep.fullmatch(parts[i+1] or '') else ''
            chunk = (segment or '') + (delim or '')
            
            if chunk.strip():
                current_parts.append(chunk)
                current_len += len(chunk)
                if current_len >= MIN_CHUNK_SIZE:
                    text_chunks.append("".join(current_parts))
                    current_parts = []
                    current_len = 0

            i += 2 if delim else 1
        
        if current_parts:
            text_chunks.append("".join(current_parts))
        # 3) 构造总列表：文本块在前，图片块在后
        chunks: List[str] = []
        types: List[str] = []
        ph_ids: List[Optional[str]] = []
        for t in text_chunks:
            chunks.append(t)
            types.append('text')
            ph_ids.append(None)
        for idx, img_html in enumerate(images):
            chunks.append(img_html)
            types.append('image')
            ph_ids.append(ph_for_img[idx])
        return chunks, types, ph_ids

    def _renumber_ol_by_heading(self, html_content: str) -> str:
        # 将 HTML 拆分为基于块级标题的段，然后在每段内按出现顺序重写 <ol> 中的 <li> 序号
        # 简单正则方式：适用于常规博客正文结构；遇到嵌套 <ol> 时保持原样，仅处理顶级 <ol>。
        # 注意：不对代码块或预格式内容中的 <ol> 操作。
        # 策略：逐行扫描，维护当前是否处于 <ol>，以及 heading 边界。
        lines = html_content.splitlines()
        result_lines: List[str] = []
        ol_counter = 0
        in_ol = False
        # 利用一个栈记录嵌套层级，只在最外层 <ol> 重写
        ol_depth = 0
        heading_re = re.compile(r"<h[1-6]\b[^>]*>", re.IGNORECASE)
        ol_open_re = re.compile(r"<ol\b[^>]*>", re.IGNORECASE)
        ol_close_re = re.compile(r"</ol>", re.IGNORECASE)
        li_re = re.compile(r"<li\b[^>]*>", re.IGNORECASE)

        for ln in lines:
            # 标题行：重置计数（仅当之前在最外层列表外）
            if heading_re.search(ln):
                # 在新标题前若有未关闭的 ol_depth，保持；我们仅重置计数器
                ol_counter = 0
            # 处理 ol 开始
            if ol_open_re.search(ln):
                ol_depth += 1
                if ol_depth == 1:
                    in_ol = True
                    ol_counter = 0
            # 处理 li（仅最外层）
            if in_ol and ol_depth == 1 and li_re.search(ln):
                ol_counter += 1
                # 重写内容：插入 data-ol-index 属性供前端 CSS 或 JS 使用（而不是直接改文本）
                # 不覆盖用户已有的自定义属性。
                if 'data-ol-index' not in ln:
                    ln = ln.replace('<li', f'<li data-ol-index="{ol_counter}"', 1)
            # 处理 ol 结束
            if ol_close_re.search(ln):
                if ol_depth == 1:
                    in_ol = False
                    ol_counter = 0
                ol_depth = max(0, ol_depth - 1)
            result_lines.append(ln)
        return '\n'.join(result_lines)

    def scan_all(self) -> None:
        if not self.docs_root.exists():
            self.docs_root.mkdir(parents=True, exist_ok=True)
        for path in self.docs_root.rglob('*.md'):
            self.index_file(path, bump=False)
        # 全量扫描完毕后统一 bump
        with self._lock:
            self.version += 1

    def index_file(self, path: Path, bump: bool = True) -> None:
        if not path.exists():
            return
        try:
            fm = frontmatter.load(path)
        except Exception:
            return
        meta = fm.metadata or {}
        title = str(meta.get('title') or path.stem)
        date_val = meta.get('date')
        if isinstance(date_val, (datetime,)):
            date_str = date_val.isoformat()
        else:
            date_str = str(date_val) if date_val else None
        tags = meta.get('tags') or []
        if isinstance(tags, str):
            tags = [t.strip() for t in tags.split(',') if t.strip()]
        vis = str(meta.get('visibility') or 'public').strip().lower()
        if vis not in ('public', 'unlisted', 'hidden'):
            vis = 'public'
        body = fm.content or ""
        content_html, content_text, toc_html = self._render(body)
        rel = path.relative_to(self.docs_root).as_posix()
        slug = self._make_slug(path)
        summary = meta.get('summary') or self._extract_summary(content_text)

        # 计算字数与阅读时长
        # 简单策略：中文字符数 + 英文单词数
        cn_chars = len(re.findall(r'[\u4e00-\u9fa5]', content_text))
        en_words = len(re.findall(r'\b[a-zA-Z0-9]+\b', content_text))
        total_words = cn_chars + en_words
        # 假设阅读速度：400字/分钟
        read_mins = max(1, round(total_words / 400))
        reading_time = f"{read_mins} 分钟"

        post_meta = PostMeta(
            slug=slug,
            title=title,
            date=date_str,
            tags=tags,
            summary=summary,
            visibility=vis,
            path=rel,
            word_count=total_words,
            reading_time=reading_time,
        )
        updated_at = path.stat().st_mtime
        # 去除开头的 TOC 再进行分块，避免目录混入正文顶部（仅用于分块数据）
        content_for_chunks = self._strip_leading_toc(content_html)
        chunks, types, ph_ids = self._chunk_html(content_for_chunks, base_dir=path.parent)
        data = _PostData(meta=post_meta, content_html=content_html, content_text=content_text, updated_at=updated_at, chunks=chunks, toc_html=toc_html or "", chunk_types=types, ph_ids=ph_ids)
        with self._lock:
            self._posts[slug] = data
            if bump:
                self.version += 1

    def remove_file(self, path: Path) -> None:
        slug = self._make_slug(path)
        with self._lock:
            if slug in self._posts:
                del self._posts[slug]
                self.version += 1

    def _sorted_posts(self, metas_only: bool = True) -> List[PostMeta]:
        # 依据 frontmatter 的 date 或文件修改时间排序（新->旧）
        with self._lock:
            data_list = list(self._posts.values())
        def key(pd: _PostData):
            if pd.meta.date:
                try:
                    return datetime.fromisoformat(pd.meta.date)
                except Exception:
                    return datetime.fromtimestamp(pd.updated_at)
            return datetime.fromtimestamp(pd.updated_at)
        data_list.sort(key=key, reverse=True)
        return [p.meta for p in data_list] if metas_only else data_list

    def list_posts(self) -> List[PostMeta]:
        # 列表仅显示 public
        items = self._sorted_posts(metas_only=True)
        return [m for m in items if getattr(m, 'visibility', 'public') == 'public']

    def search_posts(self, query: Optional[str]) -> List[PostMeta]:
        if not query:
            # 无搜索时，仅返回 public（用于分页等场景）
            items = self._sorted_posts(metas_only=True)
            return [m for m in items if getattr(m, 'visibility', 'public') == 'public']

        raw_q = query.strip()
        # 支持前端传入的 tag:前缀，用于按标签精确筛选
        tag_prefix = 'tag:'
        tag_only: Optional[str] = None
        if raw_q.lower().startswith(tag_prefix):
            tag_only = raw_q[len(tag_prefix):].strip().lower()

        q = raw_q.lower()
        with self._lock:
            data_list = list(self._posts.values())

        def hit(pd: _PostData) -> bool:
            # 若为 tag: 前缀，则只按标签精确/包含匹配
            if tag_only is not None:
                return any(tag_only == (t or '').lower() for t in pd.meta.tags)
            if q in (pd.meta.title or '').lower():
                return True
            if any(q in (t or '').lower() for t in pd.meta.tags):
                return True
            if q in (pd.content_text or '').lower():
                return True
            return False

        filtered = [pd for pd in data_list if hit(pd) and getattr(pd.meta, 'visibility', 'public') in ('public', 'unlisted')]
        # 按新->旧
        filtered.sort(key=lambda pd: datetime.fromisoformat(pd.meta.date) if pd.meta.date else datetime.fromtimestamp(pd.updated_at), reverse=True)
        return [pd.meta for pd in filtered]

    def get_post(self, slug: str) -> Optional[Post]:
        with self._lock:
            data = self._posts.get(slug)
            if not data:
                return None
            if getattr(data.meta, 'visibility', 'public') == 'hidden':
                return None
            return Post(
                slug=data.meta.slug,
                title=data.meta.title,
                date=data.meta.date,
                tags=data.meta.tags,
                summary=data.meta.summary,
                path=data.meta.path,
                content_html=data.content_html,
                content_text=data.content_text,
            )

    def get_post_updated_at(self, slug: str) -> Optional[float]:
        with self._lock:
            data = self._posts.get(slug)
            return data.updated_at if data else None

    def get_post_manifest(self, slug: str) -> Optional[Tuple[PostMeta, int, str, Optional[List[str]], Optional[List[Optional[str]]]]]:
        with self._lock:
            data = self._posts.get(slug)
            if not data:
                return None
            if getattr(data.meta, 'visibility', 'public') == 'hidden':
                return None
            total = len(data.chunks) if data.chunks else 0
            return (data.meta, total, data.toc_html, data.chunk_types, data.ph_ids)

    def get_post_chunk(self, slug: str, index: int) -> Optional[str]:
        with self._lock:
            data = self._posts.get(slug)
            if not data:
                return None
            if getattr(data.meta, 'visibility', 'public') == 'hidden':
                return None
            if index < 0 or index >= len(data.chunks):
                return None
            return data.chunks[index]

    def get_post_meta(self, slug: str) -> Optional[PostMeta]:
        with self._lock:
            data = self._posts.get(slug)
            if not data:
                return None
            if getattr(data.meta, 'visibility', 'public') == 'hidden':
                return None
            return data.meta

    def start_watch(self) -> None:
        if self._observer:
            return
        handler = _DocsEventHandler(self)
        observer = Observer()
        observer.schedule(handler, str(self.docs_root), recursive=True)
        observer.start()
        self._observer = observer

    def stop_watch(self) -> None:
        if self._observer:
            self._observer.stop()
            self._observer.join(timeout=2)
            self._observer = None

    def etag_for_posts(self) -> str:
        with self._lock:
            v = self.version
        return f'W/"posts-{v}"'

    def etag_for_post(self, slug: str) -> Optional[str]:
        ts = self.get_post_updated_at(slug)
        if ts is None:
            return None
        return f'W/"post-{slug}-{int(ts)}"'
