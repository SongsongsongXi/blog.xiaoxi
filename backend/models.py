from __future__ import annotations
from typing import List, Optional
from pydantic import BaseModel, Field
try:
    # Pydantic v2 config
    from pydantic import ConfigDict
except Exception:  # pragma: no cover - fallback for pydantic v1 if present
    ConfigDict = None  # type: ignore


class PostMeta(BaseModel):
    slug: str
    title: str
    date: Optional[str] = None  # ISO 8601 string
    tags: List[str] = Field(default_factory=list)
    summary: Optional[str] = None
    visibility: str = "public"  # public | unlisted | hidden
    path: str  # relative path from docs/
    word_count: int = 0
    reading_time: str = ""


class Post(PostMeta):
    content_html: str
    content_text: str

class PostManifest(BaseModel):
    slug: str
    title: str
    date: Optional[str] = None
    tags: List[str] = Field(default_factory=list)
    summary: Optional[str] = None
    totalChunks: int
    toc_html: Optional[str] = None
    # 分块元数据：与 chunk 索引一一对应
    chunk_types: Optional[List[str]] = None  # 'text' | 'image'
    ph_ids: Optional[List[Optional[str]]] = None  # 图片块对应的占位符 id，文本块为 None

class PostChunk(BaseModel):
    slug: str
    index: int
    html: str


class SiteConfig(BaseModel):
    siteName: str = "我的博客"
    iconUrl: Optional[str] = None
    description: Optional[str] = None
    keywords: Optional[List[str]] = None  # 站点级关键词，用于 <meta name="keywords">
    logoUrl: Optional[str] = None
    icpNumber: Optional[str] = None
    icpLink: Optional[str] = None
    footerHtml: Optional[str] = None
    navLinks: List[dict] = Field(default_factory=list)
    # 首页轮播配置
    class CarouselItem(BaseModel):
        image: Optional[str] = None
        link: Optional[str] = None
        title: Optional[str] = None

    class Carousel(BaseModel):
        enabled: bool = False
        interval: int = 5000
        height: int = 300
        items: List["SiteConfig.CarouselItem"] = Field(default_factory=list)

    carousel: Optional[Carousel] = None

    # 允许额外字段透传（未来可平滑新增配置项）
    if ConfigDict is not None:
        model_config = ConfigDict(extra='allow')


class Health(BaseModel):
    status: str
    docsVersion: int
    configVersion: int


class PageMeta(BaseModel):
    total: int
    page: int
    pageSize: int
    totalPages: int
    hasPrev: bool
    hasNext: bool


class PostPage(BaseModel):
    items: List[PostMeta]
    page: PageMeta
