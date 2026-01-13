<div align="center">
  <img src="public/icon/logo.png" alt="Logo" width="120" height="120">
  <h1 align="center">小曦的园子 (Blog.Xiaoxi)</h1>
  
  <p align="center">
    <strong>一个快速、轻量且现代的博客系统</strong>
  </p>
  
  <p align="center">
    <a href="https://github.com/SongsongsongXi/blog.xiaoxi/blob/main/LICENSE">
      <img src="https://img.shields.io/github/license/SongsongsongXi/blog.xiaoxi?style=flat-square&logo=opensourceinitiative&logoColor=white&color=0080ff" alt="license">
    </a>
    <img src="https://img.shields.io/badge/python-3.8+-blue.svg?style=flat-square&logo=python&logoColor=white" alt="python">
    <img src="https://img.shields.io/badge/FastAPI-0.115.2-009688.svg?style=flat-square&logo=fastapi&logoColor=white" alt="FastAPI">
    <img src="https://img.shields.io/badge/Dev-SongSongSongXi-brightgreen.svg?style=flat-square" alt="PRs Welcome">
  </p>
  
  <p align="center">
    <a href="#-简介">简介</a> •
    <a href="#-功能特性">功能特性</a> •
    <a href="#-技术栈">技术栈</a> •
    <a href="#-本地开发">本地开发</a> •
    <a href="#-部署">部署</a> •
    <a href="https://xiaoxi.ac.cn">Demo</a>
  </p>
</div>

---

## 📖 简介

**小曦的园子** 是一个使用 **Markdown** 文件作为文章存储的现代化博客系统。它采用了 **Python/FastAPI** 作为高性能后端，配合原生 JavaScript打造的 **SPA (单页应用)** 前端，为您提供极致流畅的阅读体验。

## ✨ 功能特性

- ⚡ **极致性能:** 前后端分离，以性能为核心构建，秒级加载。
- 📝 **Markdown 驱动:** 直接编写 Markdown 文件即可发布文章，专注于内容创作。
- 🚀 **SPA 体验:** 原生 JavaScript (ES6+) 构建的单页应用，无刷新跳转，如丝般顺滑。
- 🎨 **丰富呈现:** 内置代码语法高亮 (Highlight.js)、数学公式 (KaTeX) 和流程图 (Mermaid) 支持。
- 🔍 **便捷搜索:** 命令面板风格 (Ctrl/Cmd + K) 的全局搜索，快速定位文章和功能。
- 🌗 **日夜模式:** 支持亮色和暗色主题自动/手动切换，呵护您的眼睛。
- 📱 **PWA 支持:** 支持渐进式 Web 应用 (PWA)，可安装到桌面或手机，支持离线访问。
- 🕸️ **SEO 优化:** 自动生成站点地图 (Sitemap)、RSS 源和 Meta 标签，对搜索引擎友好。
- 🎵 **多媒体集成:** 内置音乐播放器，支持懒加载、翻译等实用功能。

## 😜 界面预览

| 首页 (亮色) | 首页 (暗色) |
| :---: | :---: |
| ![首页](public/ReadmeIMG/首页.png) | ![暗色模式](public/ReadmeIMG/首页黑暗版本.png) |

| 归档页 | 读书页 |
| :---: | :---: |
| ![归档页](public/ReadmeIMG/归档页.png) | ![读书页](public/ReadmeIMG/读书页.png) |

| 标签页 | 友链页 |
| :---: | :---: |
| ![标签页](public/ReadmeIMG/标签页.png) | ![友链页](public/ReadmeIMG/友链页.png) |

<div align="center">
  <p><strong>命令面板 & 全局搜索</strong></p>
  <img src="public/ReadmeIMG/搜索和命令功能页.png" alt="搜索和命令功能页" width="80%">
</div>

## 🛠️ 技术栈

| 类别 | 技术 | 说明 |
| :--- | :--- | :--- |
| **后端** | ![Python](https://img.shields.io/badge/-Python-3776AB?style=flat-square&logo=python&logoColor=white) | 核心语言 |
| | ![FastAPI](https://img.shields.io/badge/-FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white) | 高性能 Web 框架 |
| | ![Uvicorn](https://img.shields.io/badge/-Uvicorn-4051B5?style=flat-square) | ASGI 服务器 |
| **前端** | ![JavaScript](https://img.shields.io/badge/-JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black) | 原生 ES6+，无框架依赖 |
| | ![CSS3](https://img.shields.io/badge/-CSS3-1572B6?style=flat-square&logo=css3&logoColor=white) | 样式设计 |
| **内容** | ![Markdown](https://img.shields.io/badge/-Markdown-000000?style=flat-square&logo=markdown&logoColor=white) | 文章格式 |

## 💻 本地开发

### 环境要求

- Python 3.8+
- pip (Python 包管理器)

### 快速开始

1.  **克隆仓库**
    ```bash
    git clone https://github.com/SongsongsongXi/blog.xiaoxi.git
    cd blog.xiaoxi
    ```

2.  **创建并激活虚拟环境**
    ```bash
    # Windows
    python -m venv venv
    .\venv\Scripts\activate

    # macOS/Linux
    python3 -m venv venv
    source venv/bin/activate
    ```

3.  **安装依赖**
    ```bash
    pip install -r requirements.txt
    ```

4.  **运行应用**
    ```bash
    uvicorn backend.app:app --reload
    ```
    应用将在 `http://localhost:8000` 上可用。

## ⚙️ 配置说明

### 1. 核心配置 (`config.json`)

`config.json` 文件控制了博客的绝大多数外观和功能。以下是主要配置项的说明：

| 字段 | 类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `siteName` | string | 网站标题 | `"小曦的园子"` |
| `iconUrl` | string | 网站图标/头像路径 | `"/public/icon/logo.png"` |
| `description` | string | 网站元描述 (SEO) | `"一个现代化的个人博客"` |
| `notice` | string | 首页顶部公告栏内容 | `"欢迎访问！"` |
| `noticeDuration` | number | 公告显示时长(秒) | `10` |
| `musicId` | string | 网易云音乐歌单 ID | `"2061299955"` |
| `musicServer` | string | 音乐服务商 | `"netease"` |
| `footerHtml` | string | 页脚 HTML 内容 | `"<p>© 2024 ...</p>"` |
| `navLinks` | array | 顶部导航菜单 | `[{"title": "首页", "href": "/"}]` |
| `friends` | array | 友情链接列表 | `[{"name": "名称", "link": "..."}]` |

### 2. 读书页面配置 (`book.json`)

博客内置了一个精美的"读书"页面，用于展示您的阅读清单。该功能依赖外部图书 API 获取书籍元数据。

#### 配置步骤

1.  **获取 API Token**:
    由于图书 API 采用了域名绑定的签名验证机制，您需要前往 **[Token 生成器](https://token.xiaoxi.ac.cn/token_generator.html)** 页面。输入您的博客域名（例如 `blog.example.com` 或 `localhost:8000`）生成专属 Token。

2.  **编辑 `book.json`**:
    将生成的 Token 和 API 地址填入配置文件。

    ```json
    {
      "token": "您的专属TOKEN",
      "api_url": "https://isbn.xiaoxi.ac.cn/search",
      "reading": [
        "9787115546081",
        "9787121362085"
      ],
      "finished": [
         "9787111128069"
      ]
    }
    ```

    *   `token`: 您生成的 API 访问令牌。
    *   `api_url`: 图书搜索接口地址，默认为 `https://isbn.xiaoxi.ac.cn/search`。
    *   `reading`: **正在阅读**的书籍 ISBN 列表（字符串数组）。
    *   `finished`: **已读完**的书籍 ISBN 列表。

    > 📚 **API 接口说明**: 详细的图书接口文档和使用限制，请参阅 [图书搜索 API 文档](https://xiaoxi.ac.cn/post/20260106)。

## 📝 文章发布

博客文章位于 `docs` 目录中。每篇文章都应以一个 frontmatter 块开始：

```markdown
---
title: 你好，世界
date: 2024-01-01
tags: [示例, 博客]
summary: 这是第一篇博文。
---

欢迎来到你的新博客！
```

## 🐳 部署

### Docker Compose (推荐)

```bash
docker-compose up -d
```

### 手动 Docker 构建

```bash
docker build -t blog.xiaoxi .
docker run -p 8000:8000 blog.xiaoxi
```

### 环境变量

| 变量名 | 描述 |
| :--- | :--- |
| `BLOG_DOCS_DIR` | `docs` 目录的路径 |
| `BLOG_PUBLIC_DIR` | `public` 目录的路径 |
| `BLOG_CONFIG_PATH` | `config.json` 文件的路径 |
| `BLOG_SITE_ORIGIN` | 站点源 URL (例如 `https://your-domain.com`) |
| `BAIDU_PUSH_TOKEN` | 百度推送 Token |
| `BING_API_KEY` | Bing 搜索 API Key |

## 💻更新日志

### 2026年01月08日
- [X] 本地化所有CDN资源（JS/CSS/字体），加快国内访问速度
- [X] 添加数学公式渲染支持 (Math/KaTeX)
- [X] 添加流程图渲染支持 (Mermaid)
- [X] 添加提示块 (Admonition) 样式支持
- [X] 修复有序列表序号重置的问题
- [X] 优化右侧目录栏为固定高度内部滚动
- [X] 优化目录栏自动跟随阅读进度滚动
- [X] 修复读书页图片因防盗链无法显示的问题
- [X] 优化黑暗模式下的引用、表格、代码块等样式显示
- [X] 优化搜索功能的样式与交互体验

### 2026年01月07日
- [X] 添加读书页面

### 2026年01月06日
- [X] 修复网站RSS订阅的文章详情地址错误

### 2026年01月05日
- [X] 修复API携带错误信息导致网页加载缓慢的问题
- [X] 修复分块加载效率低的问题

### 2026年01月04日
- [X] 添加网站暗黑模式
- [X] 添加SSR订阅功能
- [X] 添加文章归纳页功能
- [X] 添加图片灯箱功能
- [X] 添加Web App功能
- [X] 添加Service Worker功能
- [X] 添加网站阅读进度条功能
- [X] 添加友情连接页功能
- [X] 优化网站移动端样式显示
- [X] 优化网站SEO设置
- [X] 优化网站加载速度
- [X] 优化网站文章页样式与排版
- [X] 优化网站首页样式与排版
- [X] 优化搜索功能
- [X] 优化网站暗黑模式下的样式显示
- [X] 优化后台管理逻辑
- [X] 优化网站顶部导航栏样式与交互
- [X] 优化网站底部样式与信息展示
- [X] 优化网站分页按钮样式与交互

### 2025年11月17日

- [X] 修复爬虫无法获取到文章页title标题的问题
- [X] 添加自动向必应及百度提交链接的功能

### 2025年11月14日

- [X] 添加网站标签页和跳转功能
- [X] 修复网站因在线状态检测失效导致的文章页被自动跳回主页的问题
- [X] 修复tags无法正常筛选文章的问题

### 2025年11月13日

- [X] 添加了网站文章目录跟随文章滚动的功能
- [X] 优化了目录的样式显示
- [X] 修复了网站图片加载过慢的问题
- [X] 修改了文章内容的主体配色和部分样式

### 2025年11月12日

- [X] 添加网站对base64图片的懒加载支持
- [X] 添加网站文章页内容分块加载功能
- [X] 添加网站分区块加载的验证和回退功能
- [X] 修复分区块加载导致的文章加载不全、样式丢失和目录加载失败等问题

### 2025年11月11日

- [X] 扩充站点描述、打通robots.txt、补充Meta Keywords、确保sitemap.xml可访问
- [X] 修复网站会自动停止运行的问题
- [X] 修复有序排列的序号被打乱重新排序导致反复是1的问题
- [X] 添加多语言切换功能，支持英、日、韩三语
- [X] 修复切换页面、刷新页面语言切换失败的问题
- [X] 调整顶栏元素更加美观的间距

### 2025年11月10日
园子正式开门！修了特别多的东西！

- [X] 添加首页轮播图功能
- [X] 修复刷新导致链接改变无法访问的问题
- [X] 添加LOGO和favicon.ico
- [X] 修复顶部文字和图标不对齐的问题
- [X] 修复微信浏览器出现缩放摁钮的问题
- [X] 修复手机黑暗模式下css错误显示的问题
- [X] 修复文章页顶部标题只显示网站名不显示文章名的问题

## 📜 许可证

本项目基于 [Apache-2.0 许可证](LICENSE) 开源。
