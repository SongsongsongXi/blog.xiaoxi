
# 小曦的园子博客系统

这是一个快速、轻量且现代的博客，使用 Markdown 文件作为文章。它采用 Python/FastAPI 后端和原生 JavaScript 单页应用（SPA）前端。

## 功能特性

-   **快速 & 轻量:** 以性能为核心构建。
-   **Markdown 驱动:** 使用 Markdown 撰写您的文章。
-   **SPA 前端:** 流畅、快速的单页应用体验。
-   **丰富内容:** 支持代码语法高亮、数学公式（KaTeX）和图表（Mermaid）。
-   **搜索功能:** 命令面板风格的文章和命令搜索。
-   **暗黑模式:** 支持亮色和暗色主题。
-   **PWA:** 可作为渐进式 Web 应用安装，以供离线访问。
-   **SEO 友好:** 生成站点地图、RSS 源和 meta 标签。
-   **以及更多:** 音乐播放器、翻译、懒加载等等。

## 技术栈

-   **后端:**
    -   Python 3
    -   FastAPI
    -   Uvicorn
-   **前端:**
    -   原生 JavaScript (ES6+)
    -   无框架
-   **内容:**
    -   Markdown

## 开发

### 环境要求

-   Python 3.8+
-   `pip` 用于安装 Python 包。

### 安装步骤

1.  **克隆仓库:**
    ```bash
    git clone https://github.com/SongsongsongXi/blog.xiaoxi
    cd your-repo-name
    ```

2.  **创建虚拟环境:**
    ```bash
    python -m venv venv
    ```

3.  **激活虚拟环境:**
    -   **Windows:**
        ```bash
        .\venv\Scripts\activate
        ```
    -   **macOS/Linux:**
        ```bash
        source venv/bin/activate
        ```

4.  **安装依赖:**
    ```bash
    pip install -r requirements.txt
    ```

### 运行应用

要运行开发服务器，请使用以下命令：

```bash
uvicorn backend.app:app --reload
```

应用将在 `http://localhost:8000` 上可用。当您更改代码时，后端将自动重新加载。前端也会反映更改，但某些更改可能需要您清除浏览器缓存。

## 配置

博客的主要配置在 `config.json` 文件中。您可以在此设置站点名称、描述、导航链接等。

`book.json` 文件用于“读书”页面。您可以添加正在阅读或已读完的书籍的 ISBN。您需要提供自己的 API 端点和令牌来获取书籍信息。

## 内容

博客文章位于 `docs` 目录中。它们是用 Markdown 编写的。每篇文章都应以一个 frontmatter 块开始，以定义标题、日期、标签和摘要。

示例:
```markdown
---
title: 你好，世界
date: 2024-01-01
tags: [示例, 博客]
summary: 这是第一篇博文。
---

欢迎来到你的新博客！
```

## 部署

此应用可以使用多种方法进行部署。

### Docker Compose (推荐)

这是最简单的本地运行和部署方式。

1.  **安装 Docker 和 Docker Compose:**
    请确保您的系统上已安装 [Docker](https://docs.docker.com/get-docker/) 和 [Docker Compose](https://docs.docker.com/compose/install/)。

2.  **运行应用:**
    在项目根目录下，运行以下命令：
    ```bash
    docker-compose up -d
    ```
    应用将在后台启动，并通过 `http://localhost:8000` 访问。

    要停止应用，请运行：
    ```bash
    docker-compose down
    ```

### Docker (手动)

如果您不想使用 `docker-compose`，也可以手动构建和运行 Docker 镜像。

1.  **创建 `Dockerfile`:**
    文件内容如下：
    ```dockerfile
    # 使用官方 Python 运行时作为父镜像
    FROM python:3.10-slim

    # 在容器中设置工作目录
    WORKDIR /app

    # 复制需求文件并安装依赖
    COPY requirements.txt .
    RUN pip install --no-cache-dir -r requirements.txt

    # 复制应用程序代码的其余部分
    COPY . .

    # 公开应用运行的端口
    EXPOSE 8000

    # 运行应用
    CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8000"]
    ```

2.  **构建 Docker 镜像:**
    ```bash
    docker build -t my-blog .
    ```

3.  **运行 Docker 容器:**
    ```bash
    docker run -p 8000:8000 my-blog
    ```

### 环境变量

您可以在生产环境中使用以下环境变量来配置应用程序：

-   `BLOG_DOCS_DIR`: `docs` 目录的路径。
-   `BLOG_PUBLIC_DIR`: `public` 目录的路径。
-   `BLOG_CONFIG_PATH`: `config.json` 文件的路径。
-   `BLOG_SITE_ORIGIN`: 您站点的源 URL (例如, `https://your-domain.com`)。
-   `BAIDU_PUSH_TOKEN`: 您的百度搜索引擎推送令牌。
-   `BING_API_KEY`: 您的必应搜索引擎 API 密钥。

## 许可证

本项目是开源的，根据 [MIT 许可证](LICENSE) 提供。
