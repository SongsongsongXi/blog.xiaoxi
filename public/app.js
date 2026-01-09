const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));
const API_BASE = (document.querySelector('meta[name="api-base"]')?.content || (window.__API_BASE__ || '')).trim();

const state = {
  config: null,
  posts: [],
  pagination: { total: 0, page: 1, pageSize: 10, totalPages: 0, hasPrev: false, hasNext: false },
  q: '',
  version: null
};

function joinUrl(base, path) {
  if (!base) return path;
  const b = base.endsWith('/') ? base.slice(0, -1) : base;
  const p = path.startsWith('/') ? path : '/' + path;
  return b + p;
}

function withBust(url) {
  try {
    const u = new URL(url, location.origin);
    u.searchParams.set('_b', String(Date.now()));
    return u.pathname + u.search;
  } catch {
    // url 可能是相对路径，简单追加
    const sep = url.includes('?') ? '&' : '?';
    return url + sep + '_b=' + Date.now();
  }
}

async function api(path, opts = {}) {
  const { cacheKey, bustOn304 } = opts;
  const storageKey = cacheKey ? 'apiCache:' + cacheKey : null;
  const readCache = () => {
    if (!storageKey) return null;
    try { const s = localStorage.getItem(storageKey); return s ? JSON.parse(s) : null; } catch { return null; }
  };
  const writeCache = (data) => {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(data)); } catch {}
  };
  const bases = Array.from(new Set([API_BASE, ''].filter(Boolean).concat(''))); // 确保至少包含相对路径
  for (let i = 0; i < bases.length; i++) {
    const base = bases[i];
    const url0 = joinUrl(base, path);
    try {
      let url = url0;
      let res = await fetch(url, { headers: { 'Accept': 'application/json' } });
      // 若返回 304，优先用缓存；首次无缓存时可 bust
      if (res.status === 304) {
        const cached = readCache();
        if (cached) return cached;
        if (bustOn304) {
          url = joinUrl(base, withBust(path));
          res = await fetch(url, { headers: { 'Accept': 'application/json' } });
        } else {
          continue;
        }
      }
      if (!res.ok) continue;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('application/json')) {
        // CDN 可能把 /api/* 重写到了 HTML，尝试 bust 一次；仍不行则尝试下一个 base
        const res2 = await fetch(joinUrl(base, withBust(path)), { headers: { 'Accept': 'application/json' } });
        if (!res2.ok) continue;
        const ct2 = (res2.headers.get('content-type') || '').toLowerCase();
        if (!ct2.includes('application/json')) continue;
        const data2 = await res2.json();
        writeCache(data2);
        return data2;
      }
      const data = await res.json();
      writeCache(data);
      return data;
    } catch (err) {
      // 尝试下一个 base
      continue;
    }
  }
  // 全部失败：尝试返回本地缓存
  const cached = (cacheKey ? (() => { try { return JSON.parse(localStorage.getItem('apiCache:' + cacheKey) || 'null'); } catch { return null; } })() : null);
  return cached;
}

async function loadConfig() {
  // 优先使用服务端内联注入的配置（绕过 CDN 对 /api/config 的干扰）
  try {
    const inline = document.getElementById('site-config');
    if (inline && inline.textContent) {
      const data = JSON.parse(inline.textContent);
      state.config = data || {};
      document.title = state.config.siteName || '学术博客';
      // 继续向下渲染头部与导航
      // 不返回，仍允许后续 API 机制在必要时刷新配置
    }
  } catch {}
  // 其次尝试通过 API 拉取，带缓存与 304 处理
  const data = await api('/api/config', { cacheKey: 'config', bustOn304: true });
  if (!data) {
    // 默认配置，避免首屏卡住
    state.config = { siteName: '学术博客', navLinks: [] };
    document.title = state.config.siteName;
    return;
  }
  state.config = data;
  // header
  const brand = $('.brand');
  if (data.siteName) {
    // 根据 iconUrl 渲染品牌图标 + 站点名
    try {
      const iconUrlRaw = (data.iconUrl || '').trim();
      let iconUrl = iconUrlRaw;
      if (iconUrl && !/^\/?static\//.test(iconUrl) && !/^\.\/static\//.test(iconUrl) && !/^https?:/.test(iconUrl) && !/^data:/.test(iconUrl)) {
        iconUrl = '/static/' + iconUrl.replace(/^\/+/, '');
      }
      brand.innerHTML = '';
      if (iconUrl) {
        const img = document.createElement('img');
        img.src = iconUrl; img.alt = data.siteName || 'logo';
        img.decoding = 'async'; img.loading = 'eager';
        img.setAttribute('data-no-spinner', '1'); // 禁止头部图标显示加载 spinner
        brand.appendChild(img);
      }
      const span = document.createElement('span');
      span.textContent = data.siteName;
      brand.appendChild(span);
      // 设置 favicon（同时作为浏览器标签图标）
      if (iconUrl) updateFavicon(iconUrl);
    } catch {
      brand.textContent = data.siteName;
    }
  }
  // nav
  const nav = $('#nav');
  nav.innerHTML = '';
  (data.navLinks || []).forEach(link => {
    nav.appendChild(renderNavLink(link));
  });
  // 固定 Tags 入口
  const tagsLink = document.createElement('a');
  tagsLink.href = '/tags';
  tagsLink.textContent = '标签';
  nav.appendChild(tagsLink);

  // 搜索框（右侧）- 触发器模式
  // 移动到 header-actions 中（暗黑模式按钮旁）
  const headerActions = $('.header-actions');
  // 移除旧的搜索入口（如果存在）
  const oldSearch = $('.search', headerActions) || $('.search', nav);
  if (oldSearch) oldSearch.remove();

  const wrap = document.createElement('div');
  wrap.className = 'search';
  const trigger = document.createElement('button');
  trigger.className = 'search-trigger';
  trigger.setAttribute('aria-label', '打开搜索');
  trigger.innerHTML = `
    <svg class="search-icon" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
    <span>搜索...</span>
  `;
  
  // 创建全屏命令面板（Command Palette）模态框（如果尚未存在）
  let modal = document.getElementById('search-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'search-modal';
    modal.className = 'search-modal';
    modal.innerHTML = `
      <div class="search-modal-content">
        <input class="search-modal-input" type="search" placeholder="输入命令或关键词搜索..." aria-label="搜索">
        <div class="search-results"></div>
      </div>
      <button class="search-close-btn" aria-label="关闭搜索">×</button>
    `;
    document.body.appendChild(modal);

    const input = modal.querySelector('input');
    const resultsContainer = modal.querySelector('.search-results');
    const closeBtn = modal.querySelector('.search-close-btn');
    let timer;

    // --- Command Palette Configuration ---
    const getCommands = () => [
      { type: 'nav', title: '首页', href: '/', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>' },
      { type: 'nav', title: '所有标签', href: '/tags', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>' },
      { type: 'nav', title: '归档', href: '/archive', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>' },
      { type: 'nav', title: '友情链接', href: '/friends', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>' },
      { type: 'action', title: '切换亮色/暗色主题', action: 'toggleTheme', icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>' },
    ];

    const renderResults = (results) => {
      if (results.length === 0) {
        resultsContainer.innerHTML = '<div class="search-empty">无结果</div>';
        return;
      }
      
      const groups = results.reduce((acc, item) => {
        const group = item.type === 'post' ? '文章' : '命令';
        if (!acc[group]) acc[group] = [];
        acc[group].push(item);
        return acc;
      }, {});

      let html = '';
      ['命令', '文章'].forEach(groupName => {
        if (groups[groupName]) {
          html += `<div class="cmd-palette-group">${groupName}</div>`;
          html += groups[groupName].map(item => {
            const dataAttrs = Object.entries(item).map(([key, value]) => `data-${key}="${String(value).replace(/"/g, '&quot;')}"`).join(' ');
            return `
              <div class="cmd-palette-item" ${dataAttrs}>
                <div class="icon">${item.icon || ''}</div>
                <div class="details">
                  <div class="title">${item.title}</div>
                  ${item.date ? `<div class="date">${item.date.substring(0, 10)}</div>` : ''}
                </div>
              </div>
            `;
          }).join('');
        }
      });
      resultsContainer.innerHTML = html;
    };

    const close = () => {
      modal.classList.remove('active');
      input.blur();
      resultsContainer.innerHTML = '';
    };

    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
    });

    resultsContainer.addEventListener('click', (e) => {
      const itemEl = e.target.closest('.cmd-palette-item');
      if (!itemEl) return;

      const { type, action, href } = itemEl.dataset;

      switch (type) {
        case 'nav':
        case 'post':
          if (href) {
            history.pushState(null, '', href);
            router({ skipLoading: true });
          }
          break;
        case 'action':
          if (action === 'toggleTheme') {
            const themeBtn = document.getElementById('theme-toggle');
            if (themeBtn) themeBtn.click();
          }
          break;
      }
      close();
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('active')) close();
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        window.openSearch ? window.openSearch() : null;
      }
    });

    input.addEventListener('input', () => {
      clearTimeout(timer);
      const q = input.value.trim().toLowerCase();
      
      timer = setTimeout(async () => {
        if (!q) {
          renderResults(getCommands());
          return;
        }

        // Filter static commands
        const filteredCommands = getCommands().filter(cmd => cmd.title.toLowerCase().includes(q));

        // Fetch posts from API
        let postResults = [];
        try {
          const resp = await api(`/api/posts?q=${encodeURIComponent(q)}&pageSize=10`);
          postResults = (resp.items || []).map(p => ({
            type: 'post',
            title: p.title,
            href: `/post/${p.slug}`,
            date: p.date,
            icon: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>'
          }));
        } catch {
          // Do nothing on API error, just show command results
        }

        renderResults([...filteredCommands, ...postResults]);
      }, 100);
    });

    window.openSearch = () => {
      modal.classList.add('active');
      input.value = '';
      renderResults(getCommands());
      setTimeout(() => input.focus(), 50);
    };
  }
  
  trigger.addEventListener('click', () => {
    if (window.openSearch) window.openSearch();
  });
  
  wrap.appendChild(trigger);
  // 插入到 theme-toggle 之前
  const themeBtn = document.getElementById('theme-toggle');
  if (themeBtn && headerActions) {
    headerActions.insertBefore(wrap, themeBtn);
  } else if (headerActions) {
    headerActions.appendChild(wrap);
  }
  // 语言切换挂载点（与 translate.js 配合）放在 footer 内
  const lang = document.createElement('div');
  lang.className = 'lang-switch';
  lang.id = 'langSwitch';
  lang.setAttribute('aria-label', '语言切换');
  const footerContainer = document.querySelector('.site-footer .container');
  if (footerContainer) {
    footerContainer.appendChild(lang);
  } else {
    const siteFooter = document.querySelector('.site-footer');
    if (siteFooter) siteFooter.appendChild(lang);
  }
  try {
    if (window.translate) {
      // 提前设置可用语种，避免网络获取失败或拉取全部语言
      translate.request = translate.request || {};
      translate.request.api = translate.request.api || {};
      translate.request.api.language = [
        { id: 'chinese_simplified', name: '简体中文' },
        { id: 'english', name: 'English' },
        { id: 'korean', name: '한국어' }
      ];
      translate.selectLanguageTag.documentId = 'langSwitch';
      translate.selectLanguageTag.show = true;
      translate.selectLanguageTag.languages = 'chinese_simplified,english,japanese,korean';
      translate.selectLanguageTag.refreshRender();
    }
  } catch {}
  // 移动端：汉堡菜单 + 侧边栏（避免挤压）
  setupMobileSidebar(data);
  // footer
  const icp = $('#icp');
  icp.innerHTML = '';
  
  // ICP 备案
  if (data.icpNumber) {
    const span = document.createElement('span');
    if (data.icpLink) {
      const a = document.createElement('a');
      a.href = data.icpLink;
      a.textContent = data.icpNumber;
      a.target = '_blank';
      span.appendChild(a);
    } else {
      span.textContent = data.icpNumber;
    }
    icp.appendChild(span);
  }

  // 公安备案
  if (data.gonganNumber) {
    if (data.icpNumber) {
      const sep = document.createElement('span');
      sep.style.margin = '0 10px';
      sep.textContent = '|';
      icp.appendChild(sep);
    }
    const span = document.createElement('span');
    const gonganHtml = `${data.gonganNumber}`;
    if (data.gonganLink) {
      const a = document.createElement('a');
      a.href = data.gonganLink;
      a.innerHTML = gonganHtml;
      a.target = '_blank';
      span.appendChild(a);
    } else {
      span.innerHTML = gonganHtml;
    }
    icp.appendChild(span);
  }

  const footer = $('#footerHtml');
  let fHtml = data.footerHtml || '';
  
  // 支持自定义扩展字段（数组），追加在 footerHtml 之后
  if (Array.isArray(data.footerExtras) && data.footerExtras.length > 0) {
    const extrasHtml = data.footerExtras.map(item => {
      if (typeof item === 'string') return `<span>${item}</span>`;
      if (item.link) {
        return `<a href="${item.link}" target="${item.target || '_blank'}">${item.text || item.link}</a>`;
      }
      return `<span>${item.text}</span>`;
    }).join(' · ');
    
    if (fHtml) fHtml += '<div class="footer-extras" style="margin-top:8px;">' + extrasHtml + '</div>';
    else fHtml = '<div class="footer-extras">' + extrasHtml + '</div>';
  }

  footer.innerHTML = fHtml;
  document.title = data.siteName || '学术博客';
  // 轮播渲染（仅首页 hash 为 #/ 或空时显示）
  setupCarousel(data);
  // 头部/导航中的图片（图标等）懒加载
  applyGlobalLazyLoading(document);
}

function setupMusicPlayer(data) {
  if (!data.musicId) return;
  
  const server = data.musicServer || 'netease';
  const type = data.musicType || 'playlist';
  
  // 移动端：嵌入侧边栏
  if (window.innerWidth <= 768) {
    const sidebar = document.getElementById('sidebarPanel');
    if (sidebar) {
      const div = document.createElement('div');
      div.className = 'sidebar-music';
      div.style.marginTop = 'auto'; // 推到底部
      div.style.paddingTop = '12px';
      div.style.borderTop = '1px solid var(--border)';
      
      div.innerHTML = `
        <meting-js
          server="${server}"
          type="${type}"
          id="${data.musicId}"
          fixed="false"
          list-folded="true"
          autoplay="false"
          order="list"
          theme="#ad7a86"
          list-max-height="200px">
        </meting-js>
      `;
      // 插入到 Sidebar 底部（在 LangSwitch 之前或之后都可以，这里放在最后）
      sidebar.appendChild(div);
    }
    return;
  }

  // 桌面端：悬浮窗
  const div = document.createElement('div');
  div.className = 'music-player minimized'; // 默认最小化，避免遮挡
  
  div.innerHTML = `
    <meting-js
      server="${server}"
      type="${type}"
      id="${data.musicId}"
      fixed="false"
      list-folded="false"
      autoplay="false"
      order="list"
      theme="#ad7a86"
      list-max-height="340px">
    </meting-js>
    <button class="music-toggle" aria-label="切换音乐播放器">
      <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>
    </button>
  `;
  document.body.appendChild(div);
  div.querySelector('.music-toggle').addEventListener('click', () => {
    div.classList.toggle('minimized');
  });
}

function checkCookieConsent() {
  if (localStorage.getItem('cookieConsent') === 'true') return;
  
  const div = document.createElement('div');
  div.className = 'cookie-banner';
  div.innerHTML = `
    <div class="cookie-content">
      <p>本网站使用 Cookie 技术以提供个性化文章推荐及优化用户体验，同时支持本网站使用的第三方服务。继续访问即表示您同意我们使用 Cookie。</p>
    </div>
    <div class="cookie-actions">
      <button class="cookie-btn accept">我知道了</button>
    </div>
  `;
  document.body.appendChild(div);
  
  // 动画入场
  requestAnimationFrame(() => div.classList.add('active'));
  
  div.querySelector('.accept').addEventListener('click', () => {
    localStorage.setItem('cookieConsent', 'true');
    div.classList.remove('active');
    setTimeout(() => div.remove(), 300);
  });
}

function showNotice() {
  if (state.config && state.config.notice) {
    // 检查是否已关闭
    if (sessionStorage.getItem('noticeClosed')) return;

    // 避免重复创建
    if (!document.querySelector('.notice-modal')) {
      const modal = document.createElement('div');
      modal.className = 'notice-modal';
      modal.innerHTML = `
        <div class="notice-card">
          <div class="notice-icon">
            <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
          </div>
          <div class="notice-content">${state.config.notice}</div>
          <button class="notice-close" aria-label="关闭">×</button>
        </div>
      `;
      document.body.appendChild(modal);
      
      // 强制重绘后添加 active 类以触发 transition
      requestAnimationFrame(() => modal.classList.add('active'));

      const hideNotice = () => {
        modal.classList.remove('active');
        setTimeout(() => {
          if (modal.parentNode) modal.parentNode.removeChild(modal);
        }, 300);
      };

      const dismissNotice = () => {
        sessionStorage.setItem('noticeClosed', 'true');
        hideNotice();
      };

      modal.querySelector('.notice-close').addEventListener('click', dismissNotice);

      // 自动关闭（不记录关闭状态，刷新后仍可见，除非用户手动关闭）
      const duration = state.config.noticeDuration;
      if (duration && duration > 0) {
        setTimeout(hideNotice, duration * 1000);
      }
    }
  }
}

function renderList() {
  const el = $('#app');
  el.innerHTML = '';
  // 列表或首页时恢复站点标题
  try {
    const site = (state.config && state.config.siteName) ? state.config.siteName : '学术博客';
    if (state.currentTag) {
      document.title = `${state.currentTag} - ${site}`;
    } else {
      document.title = site;
    }

    // 公告栏（全局显示）
    showNotice();

    // SEO: 恢复站点级 meta
    const descRaw = (state.config && state.config.description) ? String(state.config.description) : '';
    const extras = (state.posts || []).slice(0, 3).map(p => (p.summary || '')).join(' ');
    const desc = normalizeDescription(descRaw, extras);
    if (desc) setMeta('description', desc);
    // 设置 keywords
    const siteKws = Array.isArray(state.config?.keywords) ? state.config.keywords.filter(x => String(x).trim()) : [];
    let kwStr = '';
    if (siteKws.length) {
      kwStr = siteKws.join(', ');
    } else {
      const tagSet = new Set();
      (state.posts || []).forEach(p => (p.tags || []).forEach(t => { if (t && tagSet.size < 12) tagSet.add(String(t)); }));
      kwStr = Array.from(tagSet).join(', ');
    }
    if (kwStr) setMeta('keywords', kwStr);
    setOg('og:type', 'website');
    setOg('og:title', state.currentTag ? `${state.currentTag} - ${site}` : site);
    if (desc) setOg('og:description', desc);
    setOg('og:site_name', site);
    setCanonical(location.origin + (state.currentTag ? `/tags#/?q=${encodeURIComponent('tag:' + state.currentTag)}&page=${state.pagination?.page || 1}` : '/'));
  } catch {}
  const ul = document.createElement('ul');
  ul.className = 'post-list';
  if (!state.posts || state.posts.length === 0) {
    const box = document.createElement('div');
    box.className = 'empty-state';
    box.innerHTML = `
      <h2>404 · 暂无文章</h2>
      <p>可能是数据库中没有此数据，或者网络请求失败。</p>
    `;
    el.appendChild(box);
    el.appendChild(renderPager());
    return;
  }
  state.posts.forEach(p => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `/post/${encodeURIComponent(p.slug)}`;
    a.innerHTML = `
      <h3>${p.title}</h3>
      <div class="post-meta">${p.date ? p.date.substring(0,10) : ''} ${p.tags && p.tags.length ? ' · ' + p.tags.join(', ') : ''}</div>
      <p>${p.summary || ''}</p>
    `;
    li.appendChild(a);
    ul.appendChild(li);
  });
  el.appendChild(ul);
  el.appendChild(renderPager());
  // 列表中摘要里的图片（若有）处理懒加载
  applyGlobalLazyLoading(el);
  // 若当前处于非中文目标语言，渲染后补一次翻译
  applyLanguageIfNeeded(el);
}

function renderTagsPage() {
  const el = $('#app');
  el.innerHTML = '';
  const title = document.createElement('h1');
  if (state.currentTag) {
    title.textContent = `标签：${state.currentTag}`;
  } else {
    title.textContent = '所有标签';
  }
  el.appendChild(title);

  const tagMap = new Map(); // tag -> count
  (state.posts || []).forEach(p => {
    (p.tags || []).forEach(t => {
      const key = String(t || '').trim();
      if (!key) return;
      tagMap.set(key, (tagMap.get(key) || 0) + 1);
    });
  });

  if (!tagMap.size) {
    const empty = document.createElement('div');
    empty.className = 'loading';
    empty.textContent = '暂无标签。';
    el.appendChild(empty);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'tags-page-list';

  Array.from(tagMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
    .forEach(([tag, count]) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `/?q=${encodeURIComponent('tag:' + tag)}&page=1`;
      a.textContent = `${tag} (${count})`;
      if (state.currentTag && state.currentTag === tag) {
        a.classList.add('active');
      }
      li.appendChild(a);
      list.appendChild(li);
    });

  el.appendChild(list);
}

function renderArchivePage() {
  const el = $('#app');
  el.innerHTML = '';
  
  const h1 = document.createElement('h1'); h1.className = 'title'; h1.textContent = '归档';
  el.appendChild(h1);

  // 按年份分组
  const groups = {};
  state.posts.forEach(p => {
    const d = p.date ? new Date(p.date) : new Date();
    const y = d.getFullYear();
    if (!groups[y]) groups[y] = [];
    groups[y].push(p);
  });

  // 年份倒序
  const years = Object.keys(groups).sort((a, b) => b - a);
  
  const container = document.createElement('div');
  container.className = 'archive-timeline';
  container.style.marginTop = '24px';
  container.style.borderLeft = '2px solid var(--border)';
  container.style.paddingLeft = '20px';
  container.style.marginLeft = '10px';

  years.forEach(y => {
    const yearTitle = document.createElement('h2');
    yearTitle.textContent = y;
    yearTitle.style.fontSize = '24px';
    yearTitle.style.margin = '32px 0 16px';
    yearTitle.style.position = 'relative';
    // 小圆点
    const dot = document.createElement('span');
    dot.style.position = 'absolute';
    dot.style.left = '-27px';
    dot.style.top = '8px';
    dot.style.width = '12px';
    dot.style.height = '12px';
    dot.style.background = 'var(--bg)';
    dot.style.border = '2px solid var(--link)';
    dot.style.borderRadius = '50%';
    yearTitle.appendChild(dot);
    
    container.appendChild(yearTitle);

    const list = document.createElement('ul');
    list.style.listStyle = 'none';
    list.style.padding = '0';
    list.style.margin = '0';

    groups[y].forEach(p => {
      const li = document.createElement('li');
      li.style.marginBottom = '12px';
      li.style.display = 'flex';
      li.style.alignItems = 'baseline';
      
      const dateSpan = document.createElement('span');
      dateSpan.style.color = 'var(--muted)';
      dateSpan.style.fontSize = '14px';
      dateSpan.style.width = '60px';
      dateSpan.style.flexShrink = '0';
      // MM-DD
      const d = p.date ? new Date(p.date) : new Date();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      dateSpan.textContent = `${mm}-${dd}`;
      
      const link = document.createElement('a');
      link.href = `/post/${p.slug}`;
      link.textContent = p.title;
      link.style.color = 'var(--text)';
      link.style.textDecoration = 'none';
      link.style.fontSize = '16px';
      link.style.transition = 'color 0.2s';
      link.onmouseover = () => link.style.color = 'var(--link)';
      link.onmouseout = () => link.style.color = 'var(--text)';
      // 拦截点击
      link.onclick = (e) => {
        e.preventDefault();
        history.pushState(null, '', link.href);
        router({ skipLoading: true });
      };

      li.appendChild(dateSpan);
      li.appendChild(link);
      list.appendChild(li);
    });
    container.appendChild(list);
  });

  el.appendChild(container);
  document.title = `归档 - ${(state.config && state.config.siteName) || '学术博客'}`;
}

function renderFriendsPage() {
  const el = $('#app');
  el.innerHTML = '';
  const title = document.createElement('h1');
  title.textContent = '友情链接';
  el.appendChild(title);

  const friends = (state.config && state.config.friends) || [];
  if (!friends.length) {
    const p = document.createElement('p');
    p.textContent = '暂无友情链接。';
    el.appendChild(p);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'friends-grid';
  
  friends.forEach(f => {
    const card = document.createElement('a');
    card.className = 'friend-card';
    card.href = f.link;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    
    const avatar = document.createElement('img');
    avatar.src = f.avatar || '/static/icon/github.svg';
    avatar.alt = f.name;
    avatar.onerror = () => { avatar.src = '/static/icon/icon-192.png'; };
    
    const info = document.createElement('div');
    info.className = 'friend-info';
    
    const name = document.createElement('div');
    name.className = 'friend-name';
    name.textContent = f.name;
    
    const desc = document.createElement('div');
    desc.className = 'friend-desc';
    desc.textContent = f.desc || '';
    
    info.appendChild(name);
    info.appendChild(desc);
    card.appendChild(avatar);
    card.appendChild(info);
    grid.appendChild(card);
  });
  
  el.appendChild(grid);

  // 渲染底部自定义文本
  if (state.config && state.config.friendsPageText) {
    const footerText = document.createElement('div');
    footerText.className = 'friends-footer-text markdown-body';
    footerText.style.marginTop = '40px';
    footerText.innerHTML = state.config.friendsPageText;
    el.appendChild(footerText);
  }

  document.title = `友情链接 - ${(state.config && state.config.siteName) || '学术博客'}`;
}

async function renderBooksPage() {
  const el = $('#app');
  el.innerHTML = '<div class="loading">正在加载书单...</div>';
  document.title = '读书 - ' + (state.config.siteName || '小曦的园子');

  try {
    const bookConfigRes = await fetch('/book.json');
    if (!bookConfigRes.ok) {
        throw new Error('无法加载书单配置');
    }
    const bookConfig = await bookConfigRes.json();
    // 兼容旧的 books 字段，如果 reading/finished 都不存在，则尝试使用 books
    let { token, api_url, reading, finished, books } = bookConfig;
    if (!reading && !finished && books) {
        // Fallback: 全部视为已读或其他，这里简单都放进 reading 吧，或者根据具体需求，
        // 既然用户要求区分，如果没有区分就默认一种。
        // 既然用户刚才改了 json，应该会有 reading/finished
        reading = books; 
    }

    el.innerHTML = '';
    const title = document.createElement('h1');
    title.textContent = '读书';
    el.appendChild(title);

    if ((!reading || !reading.length) && (!finished || !finished.length)) {
      const p = document.createElement('p');
      p.textContent = '暂无书籍。';
      el.appendChild(p);
      return;
    }

    const fetchBook = async (isbn) => {
        try {
            const url = `${api_url}?isbn=${isbn}&token=${token}`;
            const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!res.ok) return null;
            return await res.json();
        } catch(e) {
            console.error('Book fetch error:', e);
            return null;
        }
    };

    const renderBookGrid = async (titleText, isbnList) => {
        if (!isbnList || !isbnList.length) return;
        
        const h2 = document.createElement('h2');
        h2.textContent = titleText;
        h2.style.marginTop = '2rem';
        h2.style.marginBottom = '1rem';
        el.appendChild(h2);

        const grid = document.createElement('div');
        grid.className = 'friends-grid books-grid'; 
        el.appendChild(grid); // 先挂载，以便按顺序显示（虽然是异步填充内容）

        const bookPromises = isbnList.map(isbn => fetchBook(isbn));
        const bookDataList = await Promise.all(bookPromises);

        bookDataList.forEach(book => {
            if (!book) return; 

            const card = document.createElement('a'); 
            card.className = 'friend-card book-card';
            card.href = book.douban_url;
            card.target = '_blank';
            card.rel = 'noopener noreferrer';
            
            const coverUrl = book.proxy_cover_url || book.cover_url;
            
            const avatar = document.createElement('img');
            // 添加 no-referrer 策略以绕过微信/豆瓣等防盗链限制
            avatar.referrerPolicy = 'no-referrer';
            avatar.src = coverUrl;
            avatar.alt = book.title;
            avatar.onerror = () => { avatar.src = '/static/icon/icon-192.png'; avatar.style.objectFit = 'contain'; };
            
            const info = document.createElement('div');
            info.className = 'friend-info';
            
            const name = document.createElement('div');
            name.className = 'friend-name';
            name.textContent = book.title;
            
            const desc = document.createElement('div');
            desc.className = 'friend-desc';
            desc.innerHTML = [
                book.author,
                book.publisher,
                book.publish_year
            ].filter(Boolean).join(' / ');
            
            info.appendChild(name);
            info.appendChild(desc);
            card.appendChild(avatar);
            card.appendChild(info);
            grid.appendChild(card);
        });
    };

    if (reading && reading.length > 0) {
        await renderBookGrid('在读的书', reading);
    }

    if (finished && finished.length > 0) {
        await renderBookGrid('读完的书', finished);
    }

  } catch (err) {
      el.innerHTML = `<div class="error">加载失败: ${err.message}</div>`;
  }
}

function renderProductsPage() {
  const el = $('#app');
  el.innerHTML = '';
  const title = document.createElement('h1');
  title.textContent = '我的产品';
  el.appendChild(title);

  const products = (state.config && state.config.products) || [];
  if (!products.length) {
    const p = document.createElement('p');
    p.textContent = '暂无产品展示。';
    el.appendChild(p);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'products-grid';
  
  products.forEach(p => {
    const card = document.createElement('a');
    card.className = 'product-card';
    card.href = p.link;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    
    const avatar = document.createElement('img');
    avatar.src = p.avatar || '/static/icon/github.svg';
    avatar.alt = p.name;
    avatar.onerror = () => { avatar.src = '/static/icon/icon-192.png'; };
    
    const info = document.createElement('div');
    info.className = 'product-info';
    
    const name = document.createElement('div');
    name.className = 'product-name';
    name.textContent = p.name;
    
    const desc = document.createElement('div');
    desc.className = 'product-desc';
    desc.textContent = p.desc || '';
    
    info.appendChild(name);
    info.appendChild(desc);
    card.appendChild(avatar);
    card.appendChild(info);
    grid.appendChild(card);
  });
  
  el.appendChild(grid);
  document.title = `我的产品 - ${(state.config && state.config.siteName) || '学术博客'}`;
}

function renderMath(container) {
  if (window.renderMathInElement) {
    window.renderMathInElement(container, {
      delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '$', right: '$', display: false},
        {left: '\\(', right: '\\)', display: false},
        {left: '\\[', right: '\\]', display: true}
      ],
      throwOnError: false
    });
  }
}

function renderCode(container) {
  if (window.hljs) {
    try {
      // 抑制 highlight.js 针对未转义 HTML 的警告（我们已在后端用 Markdown 严格转义普通代码内容）
      if (window.hljs.configure) {
        window.hljs.configure({ ignoreUnescapedHTML: true });
      }
    } catch {}
    $$('pre code', container).forEach(block => {
      // 若已被处理过（data-highlighted="yes" 或已有 hljs 类），避免重复高亮导致安全警告 spam
      if (block.getAttribute('data-highlighted') === 'yes' || /\bhljs\b/.test(block.className)) return;
      try { window.hljs.highlightElement(block); } catch {}
    });
  }
  enhanceCodeBlocks(container);
}


// TTS Functions
function stopReadAloud() {
  if (window.speechSynthesis && speechSynthesis.speaking) {
    speechSynthesis.cancel();
    // Also remove the reading class from any existing button
    const readBtn = document.getElementById('read-aloud-button');
    if (readBtn) {
      readBtn.classList.remove('reading');
    }
  }
}

function setupReadAloud() {
    const readBtn = document.getElementById('read-aloud-button');
    // The ID 'article-content' is now added dynamically in renderPost
    const articleContent = document.getElementById('article-content');

    if (!readBtn || !articleContent) {
        return;
    }

    if (!('speechSynthesis' in window)) {
        readBtn.style.display = 'none'; // If not supported, hide the button
        return;
    }

    readBtn.addEventListener('click', (e) => {
        e.preventDefault(); // Prevent any default link behavior
        e.stopPropagation(); // Stop the click from propagating to other listeners

        if (speechSynthesis.speaking) {
            stopReadAloud();
            return;
        }

        const textToSpeak = articleContent.textContent;
        if (!textToSpeak.trim()) {
            return; // If there is no content, do nothing
        }
        
        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        utterance.lang = 'zh-CN'; 

        utterance.onend = () => {
            readBtn.classList.remove('reading');
        };
        
        utterance.onerror = (event) => {
            readBtn.classList.remove('reading'); // Also remove on error
            console.error("Speech synthesis error:", event.error);
        };

        speechSynthesis.speak(utterance);
        readBtn.classList.add('reading');
    });
}

async function renderActivityHeatmap(container) {
  if (typeof CalHeatmap === 'undefined' || typeof d3 === 'undefined') {
    container.innerHTML = '热力图库加载失败。';
    return;
  }
  container.innerHTML = '<div class="loading" style="height: 128px;"></div>'; // Placeholder with height

  try {
    const activityData = await api('/api/stats/post_activity');
    if (!activityData || Object.keys(activityData).length === 0) {
      container.innerHTML = '过去一年暂无写作活动。';
      return;
    }

    const cal = new CalHeatmap();
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    
    container.innerHTML = '';

    const green_theme_light = ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'];
    const green_theme_dark = ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'];

    cal.paint({
      data: {
        source: activityData,
        type: 'json',
      },
      date: {
        start: new Date(new Date().setFullYear(new Date().getFullYear() - 1)),
      },
      range: 12,
      scale: {
        color: {
          type: 'threshold',
          domain: [1, 2, 4, 6],
          range: isDark ? green_theme_dark : green_theme_light,
        }
      },
      domain: {
        type: 'month',
        gutter: 4,
        label: { text: 'MMM', textAlign: 'start', position: 'top' }
      },
      subDomain: { type: 'ghDay', radius: 2, width: 11, height: 11, gutter: 4 },
      itemSelector: container,
      plugins: [
        [Tooltip, {
          text: function(date, value) {
            const d = new Date(date);
            return (value ? value : 'No') + ' contributions on ' + d.toLocaleDateString();
          }
        }]
      ]
    });

  } catch (err) {
    console.error("Failed to render heatmap:", err);
    container.innerHTML = '渲染热力图时出错。';
  }
}

async function renderPost(slug, opts = {}) {
  const el = $('#app');
  if (!opts.skipLoading) el.innerHTML = '<div class="loading">加载中…</div>';
  // 优先尝试分块清单
  let manifest = await api(`/api/post/${encodeURIComponent(slug)}?chunked=1`, { cacheKey: `post-manifest:${slug}`, bustOn304: true });
  if (!manifest || typeof manifest.totalChunks !== 'number') {
    // 回退为一次性加载
    const data = await api(`/api/post/${encodeURIComponent(slug)}` , { cacheKey: `post:${slug}`, bustOn304: true });
    if (!data) { el.innerHTML = '<div class="loading">加载失败（后端未启动或网络错误）。</div>'; return; }
    // 构造 meta 信息（含字数、阅读时长、阅读量）
    let metaParts = [];
    if (data.date) metaParts.push(data.date.substring(0,10));
    if (data.tags && data.tags.length) metaParts.push(data.tags.join(', '));
    if (data.word_count) metaParts.push(`约 ${data.word_count} 字`);
    if (data.reading_time) metaParts.push(data.reading_time);
    
    let metaHtml = metaParts.join(' · ');
    // Busuanzi 阅读量：将分隔符包含在 span 内，以便随 Busuanzi 一起隐藏/显示
    const bszPrefix = metaHtml ? ' · ' : '';
    metaHtml += `<span id="busuanzi_container_page_pv" style="display:none;">${bszPrefix}阅读 <span id="busuanzi_value_page_pv"></span> 次</span>`;
    
    const readAloudButtonHtml = `
      <a id="read-aloud-button" title="朗读文章">
          <svg xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 0 512 512" fill="currentColor">
              <path d="M215 71L144 142.1H48c-26.5 0-48 21.5-48 48v131.9c0 26.5 21.5 48 48 48h96l71 71c19.6 19.6 51.3 6 51.3-22.6V93.6c0-28.6-31.7-42.2-51.3-22.6zM425.8 32C407.2 13.4 376.2 13.4 357.5 32C338.8 50.6 339 82 357.8 100.5C399.4 140.7 424 196.5 424 256s-24.6 115.3-66.2 155.5C339 429.9 338.8 461.4 357.5 479.9c18.8 18.8 49.8 18.8 68.3 0C489.3 416.5 512 339.4 512 256s-22.7-160.5-86.2-224z"/>
          </svg>
      </a>`;
    metaHtml += readAloudButtonHtml;

    el.innerHTML = `
      <article class="post">
        <h1 class="title">${data.title}</h1>
        <div class="meta">${metaHtml}</div>
        <div class="post-layout">
          <div class="content markdown-body" id="article-content">${data.content_html}</div>
          <aside class="toc-side"></aside>
        </div>
      </article>
    `;
    // 触发 Busuanzi 刷新
    try { if (window.Busuanzi) window.Busuanzi.fetch(); } catch {}
    // SEO 与后处理
    try {
      const site = (state.config && state.config.siteName) ? state.config.siteName : '学术博客';
      if (data.title) document.title = `${data.title} - ${site}`; else document.title = site;
      const desc = normalizeDescription((data.summary || '').trim(), (data.content_text || '').trim());
      setMeta('description', desc || site);
      let kwStr = '';
      if (Array.isArray(data.tags) && data.tags.length) kwStr = data.tags.filter(t => String(t).trim()).slice(0, 12).join(', ');
      else if (Array.isArray(state.config?.keywords) && state.config.keywords.length) kwStr = state.config.keywords.filter(x => String(x).trim()).slice(0, 12).join(', ');
      if (kwStr) setMeta('keywords', kwStr);
      setOg('og:type', 'article'); setOg('og:title', data.title || site); if (desc) setOg('og:description', desc); setOg('og:site_name', site); setCanonical(location.href);
    } catch {}
  renderCode(el); renderArithmatex(el); renderMermaid(el); mountToc(el); applyGlobalLazyLoading(el); applyLanguageIfNeeded(el); styleImages(el); setupTocScrollSync(el);
    setupReadAloud(); // Enable TTS

    // Heatmap logic for about page
    if (slug === 'about') {
      const heatmapContainer = document.getElementById('heatmap-container');
      if (heatmapContainer) {
        renderActivityHeatmap(heatmapContainer);
      }
    }
    // 锚点
    const h = location.hash || ''; if (h.startsWith('#/post/')) { const parts = h.split('#'); if (parts.length > 2) { const anchor = '#' + parts.slice(2).join('#'); handleInternalAnchorNavigation(anchor); } }
    return;
  }
  // 分块渲染
  const data = manifest;
  
  // 构造 meta 信息（含字数、阅读时长、阅读量）
  let metaParts = [];
  if (data.date) metaParts.push(data.date.substring(0,10));
  if (data.tags && data.tags.length) metaParts.push(data.tags.join(', '));
  if (data.word_count) metaParts.push(`约 ${data.word_count} 字`);
  if (data.reading_time) metaParts.push(data.reading_time);
  
  let metaHtml = metaParts.join(' · ');
  const bszPrefix = metaHtml ? ' · ' : '';
  metaHtml += `<span id="busuanzi_container_page_pv" style="display:none;">${bszPrefix}阅读 <span id="busuanzi_value_page_pv"></span> 次</span>`;

  const readAloudButtonHtml = `
    <a id="read-aloud-button" title="朗读文章">
        <svg xmlns="http://www.w3.org/2000/svg" height="1em" viewBox="0 0 512 512" fill="currentColor">
            <path d="M215 71L144 142.1H48c-26.5 0-48 21.5-48 48v131.9c0 26.5 21.5 48 48 48h96l71 71c19.6 19.6 51.3 6 51.3-22.6V93.6c0-28.6-31.7-42.2-51.3-22.6zM425.8 32C407.2 13.4 376.2 13.4 357.5 32C338.8 50.6 339 82 357.8 100.5C399.4 140.7 424 196.5 424 256s-24.6 115.3-66.2 155.5C339 429.9 338.8 461.4 357.5 479.9c18.8 18.8 49.8 18.8 68.3 0C489.3 416.5 512 339.4 512 256s-22.7-160.5-86.2-224z"/>
        </svg>
    </a>`;
  metaHtml += readAloudButtonHtml;

  el.innerHTML = `
    <article class="post">
      <h1 class="title">${data.title}</h1>
      <div class="meta">${metaHtml}</div>
      <div class="post-layout">
        <div class="content markdown-body" id="article-content"></div>
        <aside class="toc-side"></aside>
      </div>
    </article>
  `;
  // 触发 Busuanzi 刷新
  try { if (window.Busuanzi) window.Busuanzi.fetch(); } catch {}

  const contentEl = el.querySelector('#article-content');
  // 初始隐藏侧栏目录，避免在加载阶段空白占位
  const asideEl = el.querySelector('.toc-side');
  if (asideEl) asideEl.classList.add('hidden');
  // 底部加载动画
  const postEl = el.querySelector('article.post');
  const loadingFooter = document.createElement('div');
  loadingFooter.className = 'post-loading-spinner';
  loadingFooter.innerHTML = '<div class="spinner" aria-label="正在加载"></div>';
  postEl.appendChild(loadingFooter);
  // 设置标题与 SEO（先用摘要 + toc，不等待全部 chunk）
  // 设置文档标题：文章标题 + 站点名
  try {
    const site = (state.config && state.config.siteName) ? state.config.siteName : '学术博客';
    if (data.title) { document.title = `${data.title} - ${site}`; } else { document.title = site; }
    // SEO: 更新 meta（先用 summary，后续可在全部加载后再加强）
    const desc = normalizeDescription((data.summary || '').trim(), '');
    setMeta('description', desc || site);
    // 文章页 keywords：优先标签
    let kwStr = '';
    if (Array.isArray(data.tags) && data.tags.length) {
      kwStr = data.tags.filter(t => String(t).trim()).slice(0, 12).join(', ');
    } else if (Array.isArray(state.config?.keywords) && state.config.keywords.length) {
      kwStr = state.config.keywords.filter(x => String(x).trim()).slice(0, 12).join(', ');
    }
    if (kwStr) setMeta('keywords', kwStr);
    setOg('og:type', 'article');
    setOg('og:title', data.title || site);
    if (desc) setOg('og:description', desc);
    setOg('og:site_name', site);
    setCanonical(location.href);
  } catch {}
  // 并发加载：一次性获取所有文本块，前端按顺序整体拼接后再统一解析渲染；图片块并发获取后替换占位
  const total = Number(data.totalChunks || 0);
  const types = Array.isArray(data.chunk_types) ? data.chunk_types : null;
  const phIds = Array.isArray(data.ph_ids) ? data.ph_ids : null;
  const textIndices = [];
  const imageIndices = [];
  for (let i = 0; i < total; i++) {
    const t = types ? types[i] : 'text';
    if (t === 'image') imageIndices.push(i); else textIndices.push(i);
  }
  // 并发获取所有文本块内容
  const textHtmlByIndex = new Map();
  const textResults = await Promise.all(textIndices.map(async (i) => {
    try {
      const ck = await api(`/api/post/${encodeURIComponent(slug)}/chunk/${i}`, { cacheKey: `post-chunk:${slug}:${i}`, bustOn304: false });
      if (ck && typeof ck.html === 'string') textHtmlByIndex.set(i, ck.html);
      return true;
    } catch { return false; }
  }));
  // 完整性与顺序校验：必须全部拿到文本块
  const allTextOk = textIndices.every(i => textHtmlByIndex.has(i));
  if (!allTextOk) {
    // 回退：整篇一次性加载以确保样式完整
    const full = await api(`/api/post/${encodeURIComponent(slug)}` , { cacheKey: `post:${slug}`, bustOn304: true });
    if (!full) { el.innerHTML = '<div class="loading">加载失败（后端未启动或网络错误）。</div>'; return; }
    
    let fullMetaParts = [];
    if (full.date) fullMetaParts.push(full.date.substring(0,10));
    if (full.tags && full.tags.length) fullMetaParts.push(full.tags.join(', '));
    let fullMetaHtml = fullMetaParts.join(' · ');
    fullMetaHtml += readAloudButtonHtml;

    el.innerHTML = `
      <article class="post">
        <h1 class="title">${full.title}</h1>
        <div class="meta">${fullMetaHtml}</div>
        <div class="post-layout">
          <div class="content markdown-body" id="article-content">${full.content_html}</div>
          <aside class="toc-side"></aside>
        </div>
      </article>
    `;
    try {
      const site = (state.config && state.config.siteName) ? state.config.siteName : '学术博客';
      if (full.title) document.title = `${full.title} - ${site}`; else document.title = site;
      const desc = normalizeDescription((full.summary || '').trim(), (full.content_text || '').trim());
      setMeta('description', desc || site);
      let kwStr = '';
      if (Array.isArray(full.tags) && full.tags.length) kwStr = full.tags.filter(t => String(t).trim()).slice(0, 12).join(', ');
      else if (Array.isArray(state.config?.keywords) && state.config.keywords.length) kwStr = state.config.keywords.filter(x => String(x).trim()).slice(0, 12).join(', ');
      if (kwStr) setMeta('keywords', kwStr);
      setOg('og:type', 'article'); setOg('og:title', full.title || site); if (desc) setOg('og:description', desc); setOg('og:site_name', site); setCanonical(location.href);
    } catch {}
  renderCode(el); renderArithmatex(el); renderMermaid(el); mountToc(el); applyGlobalLazyLoading(el); applyLanguageIfNeeded(el); styleImages(el); setupTocScrollSync(el);
    setupReadAloud(); // Enable TTS

    // Heatmap logic for about page
    if (slug === 'about') {
      const heatmapContainer = document.getElementById('heatmap-container');
      if (heatmapContainer) {
        renderActivityHeatmap(heatmapContainer);
      }
    }
    try { loadingFooter.remove(); } catch {}
    const h1 = location.hash || ''; if (h1.startsWith('#/post/')) { const parts = h1.split('#'); if (parts.length > 2) { const anchor = '#' + parts.slice(2).join('#'); handleInternalAnchorNavigation(anchor); } }
    return;
  }
  // 拼接为一个整体 HTML 再一次性解析插入，保持样式与结构
  const combinedHtml = textIndices.sort((a,b)=>a-b).map(i => textHtmlByIndex.get(i) || '').join('');
  contentEl.innerHTML = combinedHtml;
  // 二次校验：每个图片占位符必须存在（若 manifest 提供）
  let placeholdersOk = true;
  if (Array.isArray(phIds) && phIds.length) {
    for (let i = 0; i < phIds.length; i++) {
      if (types && types[i] === 'image') {
        const ph = phIds[i];
        if (ph && !contentEl.querySelector(`.img-ph[data-ph="${CSS.escape(String(ph))}"]`)) {
          placeholdersOk = false; break;
        }
      }
    }
  }
  if (!placeholdersOk) {
    // 回退整篇加载
    const full = await api(`/api/post/${encodeURIComponent(slug)}` , { cacheKey: `post:${slug}`, bustOn304: true });
    if (!full) { el.innerHTML = '<div class="loading">加载失败（后端未启动或网络错误）。</div>'; return; }
    
    let fullMetaParts = [];
    if (full.date) fullMetaParts.push(full.date.substring(0,10));
    if (full.tags && full.tags.length) fullMetaParts.push(full.tags.join(', '));
    let fullMetaHtml = fullMetaParts.join(' · ');
    fullMetaHtml += readAloudButtonHtml;
    
    el.innerHTML = `
      <article class="post">
        <h1 class="title">${full.title}</h1>
        <div class="meta">${fullMetaHtml}</div>
        <div class="post-layout">
          <div class="content markdown-body" id="article-content">${full.content_html}</div>
          <aside class="toc-side"></aside>
        </div>
      </article>
    `;
    try {
      const site = (state.config && state.config.siteName) ? state.config.siteName : '学术博客';
      if (full.title) document.title = `${full.title} - ${site}`; else document.title = site;
      const desc = normalizeDescription((full.summary || '').trim(), (full.content_text || '').trim());
      setMeta('description', desc || site);
      let kwStr = '';
      if (Array.isArray(full.tags) && full.tags.length) kwStr = full.tags.filter(t => String(t).trim()).slice(0, 12).join(', ');
      else if (Array.isArray(state.config?.keywords) && state.config.keywords.length) kwStr = state.config.keywords.filter(x => String(x).trim()).slice(0, 12).join(', ');
      if (kwStr) setMeta('keywords', kwStr);
      setOg('og:type', 'article'); setOg('og:title', full.title || site); if (desc) setOg('og:description', desc); setOg('og:site_name', site); setCanonical(location.href);
    } catch {}
  renderCode(el); renderArithmatex(el); renderMermaid(el); mountToc(el); applyGlobalLazyLoading(el); applyLanguageIfNeeded(el); styleImages(el); setupTocScrollSync(el);
    setupReadAloud(); // Enable TTS

    // Heatmap logic for about page
    if (slug === 'about') {
      const heatmapContainer = document.getElementById('heatmap-container');
      if (heatmapContainer) {
        renderActivityHeatmap(heatmapContainer);
      }
    }
    try { loadingFooter.remove(); } catch {}
    const h1 = location.hash || ''; if (h1.startsWith('#/post/')) { const parts = h1.split('#'); if (parts.length > 2) { const anchor = '#' + parts.slice(2).join('#'); handleInternalAnchorNavigation(anchor); } }
    return;
  }
  // 一次性对整体内容做高亮/懒加载/翻译
  renderCode(contentEl);
  renderArithmatex(contentEl);
  renderMermaid(contentEl);
  applyGlobalLazyLoading(contentEl);
  applyLanguageIfNeeded(contentEl);
  // 并发请求所有图片块并替换占位符（文本已整体稳定渲染）
  await Promise.all(imageIndices.map(async (i) => {
    const ph = phIds && phIds[i] ? String(phIds[i]) : null;
    const ck = await api(`/api/post/${encodeURIComponent(slug)}/chunk/${i}`, { cacheKey: `post-chunk:${slug}:${i}`, bustOn304: false });
    if (ck && ck.html != null) {
      const tmp = document.createElement('div'); tmp.innerHTML = ck.html;
      const node = tmp.firstElementChild || null;
      const placeholder = ph ? contentEl.querySelector(`.img-ph[data-ph="${CSS.escape(ph)}"]`) : null;
      if (placeholder) {
        if (node) {
          const lqip = placeholder.getAttribute('data-lqip') || '';
          if (lqip) {
            // 使用占位符作为 LQIP 背景，插入真实 <img> 后淡入，最后移除包装
            try { placeholder.innerHTML = ''; } catch {}
            placeholder.classList.add('lqip-holder');
            // 将 LQIP 传递给 <img>，以便懒加载包装器识别
            try { node.setAttribute('data-lqip', lqip); } catch {}
            placeholder.appendChild(node);
            // 仅作用于该占位节点，避免全局重新扫描
            applyGlobalLazyLoading(placeholder);
            applyLanguageIfNeeded(placeholder);
            const img = node;
            const unwrap = () => {
              try { placeholder.style.backgroundImage = 'none'; placeholder.style.filter = 'none'; } catch {}
              // 等待过渡结束后再移除包装（保留一次微小延时）
              setTimeout(() => { if (placeholder.parentNode) placeholder.replaceWith(img); }, 120);
            };
            if (img.complete) unwrap();
            else { img.addEventListener('load', unwrap, { once: true }); img.addEventListener('error', unwrap, { once: true }); }
          } else {
            placeholder.replaceWith(node);
            applyGlobalLazyLoading(contentEl);
            applyLanguageIfNeeded(contentEl);
          }
        } else {
          placeholder.outerHTML = ck.html;
          applyGlobalLazyLoading(contentEl);
          applyLanguageIfNeeded(contentEl);
        }
      } else {
        const wrap = document.createElement('div'); wrap.innerHTML = ck.html; contentEl.appendChild(wrap);
        applyGlobalLazyLoading(wrap); applyLanguageIfNeeded(wrap);
      }
    }
  }));
  // 全部块完成后再挂 TOC，保证出现在右侧目录栏
  try {
    if (data.toc_html) {
      const tocSide = el.querySelector('.toc-side');
      if (tocSide) {
        tocSide.innerHTML = data.toc_html;
      }
    }
  } catch {}
  mountToc(el); styleImages(el); setupTocScrollSync(el);
  // 移除底部加载动画
  try { loadingFooter.remove(); } catch {}
  // 锚点滚动（在 TOC 与所有内容完成后）
  const h1 = location.pathname + location.hash;
  if (h1.startsWith('/post/')) { const parts = h1.split('#'); if (parts.length > 1) { const anchor = '#' + parts.slice(1).join('#'); handleInternalAnchorNavigation(anchor); } }
  
  // 绑定阅读进度条
  window.removeEventListener('scroll', updateReadingProgress);
  window.addEventListener('scroll', updateReadingProgress, { passive: true });
  updateReadingProgress();
  setupReadAloud(); // Enable TTS
}

function updateReadingProgress() {
  const bar = document.getElementById('reading-progress');
  if (!bar) return;
  // 仅在文章页显示
  if (!location.pathname.startsWith('/post/')) {
    bar.style.width = '0%';
    return;
  }
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const docHeight = document.documentElement.scrollHeight - document.documentElement.clientHeight;
  const pct = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
  bar.style.width = pct + '%';
}

async function loadPosts(params = {}) {
  const page = Number(params.page || state.pagination.page || 1);
  const pageSize = Number(params.pageSize || state.pagination.pageSize || 10);
  const q = params.q != null ? params.q : state.q;
  const query = new URLSearchParams();
  query.set('paged', 'true');
  query.set('page', String(page));
  query.set('pageSize', String(pageSize));
  if (q && q.trim()) query.set('q', q.trim());
  const cacheKey = `posts:${page}:${pageSize}:${q || ''}`;
  const resp = await api(`/api/posts?${query.toString()}`, { cacheKey, bustOn304: true });
  if (!resp) {
    state.posts = [];
    state.pagination = { total: 0, page, pageSize, totalPages: 1, hasPrev: false, hasNext: false };
    state.q = q || '';
    state.currentTag = (q && q.toLowerCase().startsWith('tag:')) ? q.slice(4).trim() : null;
    return;
  }
  state.posts = resp.items || [];
  state.pagination = resp.page || { total: state.posts.length, page, pageSize, totalPages: 1, hasPrev: false, hasNext: false };
  state.q = q || '';
  state.currentTag = (q && q.toLowerCase().startsWith('tag:')) ? q.slice(4).trim() : null;
}

function parseListParamsFromHash() {
  const hash = location.hash || '#/'
  const qm = hash.indexOf('?');
  let query = qm >= 0 ? hash.slice(qm + 1) : '';
  // 兼容无 hash 时通过 /?q=...&page=... 访问的情况
  if (!query && !hash.startsWith('#/?') && location.search) {
    query = location.search.replace(/^\?/, '');
  }
  const sp = new URLSearchParams(query);
  const page = Number(sp.get('page') || '1');
  const q = sp.get('q') || '';
  return { page: isNaN(page) ? 1 : page, q };
}

async function setQueryAndNavigate(q, page = 1) {
  showSpinner();
  const url = new URL(location.href);
  url.pathname = '/';
  url.hash = `#/?q=${encodeURIComponent(q || '')}&page=${page}`;
  history.pushState(null, '', url.toString());
  try {
    await router();
  } finally {
    hideSpinner();
  }
}

async function router(opts = {}) {
  stopReadAloud();
  const path = location.pathname || '/';
  const hash = location.hash || '';
  const isHome = path === '/' && (!hash || hash === '#/' || hash.startsWith('#/?'));
  toggleCarousel(isHome);

  // 每次路由切换都尝试显示公告（内部有去重逻辑）
  showNotice();

  // /tags 或 #/tags -> 标签页
  if (path === '/tags' || hash === '#/tags') {
    // 加载全部文章以统计标签
    await loadPosts({ page: 1, q: '' });
    renderTagsPage();
    return;
  }

  // /archive 或 #/archive -> 归档页
  if (path === '/archive' || hash === '#/archive') {
    // 加载全部文章（不分页）以构建时间轴
    // 注意：这里复用 loadPosts 但传入较大的 pageSize 以获取所有文章
    // 或者后端支持 pageSize=-1，目前先传 1000
    await loadPosts({ page: 1, pageSize: 1000, q: '' });
    renderArchivePage();
    return;
  }

  // /friends 或 #/friends -> 友链页
  if (path === '/friends' || hash === '#/friends') {
    renderFriendsPage();
    return;
  }

  // /products 或 #/products -> 产品页
  if (path === '/products' || hash === '#/products') {
    renderProductsPage();
    return;
  }

  // /books 或 #/books -> 读书页
  if (path === '/books' || hash === '#/books') {
    await renderBooksPage();
    return;
  }

  // 帖子详情：/post/slug
  const postMatch = path.match(/^\/post\/([^#?]+)/);
  if (postMatch && postMatch[1]) {
    await renderPost(decodeURIComponent(postMatch[1]), opts);
    return;
  }

  // 列表（含搜索与标签过滤）
  const { page, q } = parseListParamsFromHash();
  await loadPosts({ page, q });
  renderList();
}
const spinner = document.getElementById('global-spinner');
function showSpinner() {
  if (spinner) spinner.hidden = false;
  document.body.style.cursor = 'wait';
}
function hideSpinner() {
  if (spinner) spinner.hidden = true;
  document.body.style.cursor = '';
}

// 拦截站内链接点击，实现 SPA 无刷新跳转（保持音乐播放）
document.addEventListener('click', async (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  
  // 忽略带 target="_blank" 或外部链接
  if (a.target === '_blank' || (a.origin && a.origin !== location.origin)) return;

  const href = a.getAttribute('href');
  if (!href) return;

  // 忽略纯锚点链接（由后续逻辑或浏览器默认处理）
  // 注意：本应用中 #/ 开头的 hash 被视为路由的一部分，需要拦截；
  // 而 #section 这种才视为页内锚点
  if (href.startsWith('#') && !href.startsWith('#/')) return;

  // 忽略非 http/https 协议（如 mailto:）
  if (!a.href.startsWith('http')) return;

  // 拦截所有站内链接
  e.preventDefault();
  
  showSpinner();
  
  // 更新 URL
  history.pushState(null, '', href);
  
  try {
    // 调用路由，并告知跳过初始 loading 清屏
    await router({ skipLoading: true });
  } catch (err) {
    console.error(err);
    location.href = href;
  } finally {
    hideSpinner();
  }
});

// 监听路径或 hash 变化用于 SPA 路由
window.addEventListener('popstate', async () => {
  showSpinner();
  try {
    await router();
  } finally {
    hideSpinner();
  }
});
window.addEventListener('hashchange', () => {
  // 仅处理同一文章内的锚点滚动，不重新渲染页面
  const h = location.hash || '';
  if (h && !h.startsWith('#/')) {
    handleInternalAnchorNavigation(h, { updateHash: false });
  }
});

(async function init() {
  await loadConfig();
  ensureCDNAssets();
  setupMusicPlayer(state.config);
  checkCookieConsent();
  // 不阻塞首屏渲染：先跑路由
  router();
  // 启动翻译库监听（若存在），并按用户上次选择的目标语言立即应用一次
  try {
    if (window.translate) {
      if (translate.listener && translate.listener.start) translate.listener.start();
      // 应用当前语言（若非中文）
      applyLanguageIfNeeded(document.body);
    }
  } catch {}
  // 轻量轮询版本变化，触发重新加载（仅在首页列表时刷新，避免详情页被意外跳回主页）
  setInterval(async () => {
    try {
      const path = location.pathname || '/';
      const hash = location.hash || '';
      const isHome = path === '/' && (!hash || hash === '#/' || hash.startsWith('#/?'));
      if (!isHome) return;
      const v = await api('/api/version');
      if (v && v.docsVersion != null) {
        if (state.version != null && state.version !== v.docsVersion) {
          const { page, q } = parseListParamsFromHash();
          await loadPosts({ page, q });
          renderList();
        }
        state.version = v.docsVersion;
      }
    } catch {}
  }, 10000);

  // 回到顶部逻辑
  const backToTop = document.getElementById('back-to-top');
  if (backToTop) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 300) backToTop.hidden = false;
      else backToTop.hidden = true;
    }, { passive: true });
    backToTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // 暗黑模式逻辑
  const themeBtn = document.getElementById('theme-toggle');
  const iconSun = document.querySelector('.icon-sun');
  const iconMoon = document.querySelector('.icon-moon');
  
  function applyTheme(isDark) {
    if (isDark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      if (iconSun) iconSun.style.display = 'none';
      if (iconMoon) iconMoon.style.display = 'block';
    } else {
      document.documentElement.removeAttribute('data-theme');
      if (iconSun) iconSun.style.display = 'block';
      if (iconMoon) iconMoon.style.display = 'none';
    }
  }

  // 初始化
  const saved = localStorage.getItem('theme');
  if (saved === 'dark') {
    applyTheme(true);
  } else if (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    applyTheme(true);
  }

  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      applyTheme(!isDark);
      localStorage.setItem('theme', !isDark ? 'dark' : 'light');
    });
  }
})();

function applyLanguageIfNeeded(root) {
  try {
    if (!window.translate) return;
    const cur = (translate.language && translate.language.getCurrent && translate.language.getCurrent()) || translate.to || '';
    // translate.js v2 简体中文标识为 chinese_simplified；也兼容 zh-CN
    if (cur && cur !== 'chinese_simplified' && cur !== 'zh-CN') {
      const nodes = root ? [root] : undefined;
      translate.execute(nodes);
    }
  } catch {}
}

function ensureMetaEl(selector, createCb) {
  let el = document.querySelector(selector);
  if (!el) { el = createCb(); document.head.appendChild(el); }
  return el;
}

function setMeta(name, content) {
  if (!name) return;
  const el = ensureMetaEl(`meta[name="${CSS.escape(name)}"]`, () => { const m = document.createElement('meta'); m.setAttribute('name', name); return m; });
  if (content != null) el.setAttribute('content', String(content));
}

function setOg(property, content) {
  if (!property) return;
  const el = ensureMetaEl(`meta[property="${CSS.escape(property)}"]`, () => { const m = document.createElement('meta'); m.setAttribute('property', property); return m; });
  if (content != null) el.setAttribute('content', String(content));
}

function setCanonical(href) {
  let link = document.querySelector('link[rel="canonical"]');
  if (!link) { link = document.createElement('link'); link.setAttribute('rel', 'canonical'); document.head.appendChild(link); }
  link.setAttribute('href', href);
}

function normalizeDescription(desc, extra = '') {
  const base = (desc || '').trim();
  let s = base;
  if (s.length < 80) {
    const more = (extra || '').trim();
    if (more) s = (s ? s + ' ' : '') + more;
  }
  if (s.length > 160) s = s.slice(0, 160);
  return s;
}

function enhanceCodeBlocks(container) {
  // 清理历史残留的行号侧栏（如果有）
  $$('.line-numbers', container).forEach(el => el.remove());
  $$("pre code", container).forEach(code => {
    const pre = code.parentElement;
    if (!pre || pre.dataset.enhanced) return;
    const classes = (code.className || '').split(/\s+/);
    let lang = '';
    for (const c of classes) {
      const m = c.match(/^language-([\w-]+)/);
      if (m) { lang = m[1]; break; }
    }
    const wrapper = document.createElement('div');
    wrapper.className = 'code-block';
    const bar = document.createElement('div');
    bar.className = 'code-toolbar';
    const left = document.createElement('span');
    left.className = 'code-lang';
    left.textContent = lang ? lang.toUpperCase() : 'CODE';
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = '复制';
    btn.addEventListener('click', async () => {
      const text = code.textContent || '';
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea');
          ta.value = text; document.body.appendChild(ta); ta.select();
          document.execCommand('copy'); document.body.removeChild(ta);
        }
        const old = btn.textContent; btn.textContent = '已复制';
        setTimeout(() => btn.textContent = old, 1200);
      } catch (e) {
        const old = btn.textContent; btn.textContent = '失败';
        setTimeout(() => btn.textContent = old, 1200);
      }
    });
    bar.appendChild(left); bar.appendChild(btn);
    const parent = pre.parentElement;
    parent.insertBefore(wrapper, pre);
    wrapper.appendChild(bar);
    wrapper.appendChild(pre);
    pre.dataset.enhanced = '1';
  });
}

// 轮播相关逻辑
let carouselState = { index: 0, timer: null, interval: 5000, items: [] };

function setupCarousel(cfg) {
  const wrap = $('#carousel');
  if (!wrap) return;
  const c = cfg.carousel || {};
  if (!c.enabled || !Array.isArray(c.items) || c.items.length === 0) {
    wrap.hidden = true; return;
  }
  carouselState.interval = Number(c.interval) > 0 ? Number(c.interval) : 5000;
  // 强制高度与宽比：886x300 固定视觉区域（CSS 已使用 aspect-ratio），忽略配置中的 height
  wrap.style.removeProperty('--carousel-height');
  // 支持后端/配置使用相对路径：自动补 /static/ 前缀（若以 ./static 或 /static 开头则保持原样）
  carouselState.items = c.items.map(it => {
    const image = (it.image || '').trim();
    let final = image;
    if (image && !/^\/?static\//.test(image) && !/^\.\/static\//.test(image) && !/^https?:/.test(image)) {
      final = '/static/' + image.replace(/^\/+/, '');
    }
    return { ...it, image: final };
  });
  // 清空并重建结构
  wrap.innerHTML = '';
  // 高度由 CSS aspect-ratio 决定，不再依赖配置
  const track = document.createElement('div'); track.className = 'carousel-track';
  carouselState.items.forEach(it => {
    const item = document.createElement('div'); item.className = 'carousel-item';
    if (it.image) {
      const a = document.createElement('a'); a.href = it.link || '#'; a.target = it.link && it.link.startsWith('http') ? '_blank' : '_self';
      const img = document.createElement('img'); img.src = it.image; img.alt = it.title || '';
      a.appendChild(img); item.appendChild(a);
    } else {
      item.textContent = it.title || '';
    }
    if (it.title) {
      const cap = document.createElement('div'); cap.className = 'carousel-caption'; cap.textContent = it.title; item.appendChild(cap);
    }
    track.appendChild(item);
  });
  wrap.appendChild(track);
  // 移除左右箭头，后续使用手势滑动
  // 点导航
  const dots = document.createElement('div'); dots.className = 'carousel-dots';
  carouselState.items.forEach((_, i) => {
    const d = document.createElement('button'); d.type = 'button'; if (i === 0) d.classList.add('active');
    d.addEventListener('click', () => goCarousel(i)); dots.appendChild(d);
  });
  wrap.appendChild(dots);
  wrap.hidden = false;
  startCarouselTimer();
  enableCarouselSwipe(wrap, track);
  // 轮播图图片懒加载处理
  applyGlobalLazyLoading(wrap);
}

function toggleCarousel(show) {
  const wrap = $('#carousel');
  if (!wrap) return;
  wrap.hidden = !show || wrap.innerHTML.trim() === '';
  if (wrap.hidden) stopCarouselTimer(); else startCarouselTimer();
}

function moveCarousel(delta) {
  const count = carouselState.items.length;
  carouselState.index = (carouselState.index + delta + count) % count;
  applyCarousel();
}

function goCarousel(i) {
  carouselState.index = i % carouselState.items.length;
  applyCarousel();
}

function applyCarousel() {
  const wrap = $('#carousel'); if (!wrap) return;
  const track = $('.carousel-track', wrap); if (!track) return;
  const count = carouselState.items.length;
  const idx = carouselState.index;
  track.style.transform = `translateX(-${idx * 100}%)`;
  $$('.carousel-dots button', wrap).forEach((b, i) => {
    if (i === idx) b.classList.add('active'); else b.classList.remove('active');
  });
  stopCarouselTimer(); startCarouselTimer();
}

function startCarouselTimer() {
  stopCarouselTimer();
  if (carouselState.items.length <= 1) return;
  carouselState.timer = setTimeout(() => { moveCarousel(1); }, carouselState.interval);
}

function stopCarouselTimer() {
  if (carouselState.timer) { clearTimeout(carouselState.timer); carouselState.timer = null; }
}

function enableCarouselSwipe(wrap, track) {
  let startX = 0, dx = 0, dragging = false;
  const threshold = 40;
  const onStart = (x) => { dragging = true; startX = x; dx = 0; stopCarouselTimer(); track.style.transition = 'none'; };
  const onMove = (x) => {
    if (!dragging) return; dx = x - startX;
    const base = -carouselState.index * wrap.clientWidth;
    track.style.transform = `translateX(${base + dx}px)`;
  };
  const onEnd = () => {
    if (!dragging) return; dragging = false; track.style.transition = '';
    if (Math.abs(dx) > threshold) { if (dx < 0) moveCarousel(1); else moveCarousel(-1); } else { applyCarousel(); }
  };
  track.addEventListener('touchstart', (e) => onStart(e.touches[0].clientX), { passive: true });
  track.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX), { passive: true });
  track.addEventListener('touchend', onEnd, { passive: true });
  track.addEventListener('mousedown', (e) => onStart(e.clientX));
  window.addEventListener('mousemove', (e) => onMove(e.clientX));
  window.addEventListener('mouseup', onEnd);
}

function updateFavicon(href) {
  const ensure = (rel) => {
    let link = document.querySelector(`link[rel="${rel}"]`);
    if (!link) { link = document.createElement('link'); link.rel = rel; document.head.appendChild(link); }
    link.href = href; link.type = guessMimeFromUrl(href);
  };
  ensure('icon');
  ensure('shortcut icon');
}

function guessMimeFromUrl(u) {
  try {
    const lower = u.split('?')[0].toLowerCase();
    if (lower.endsWith('.svg') || lower.startsWith('data:image/svg')) return 'image/svg+xml';
    if (lower.endsWith('.png') || lower.startsWith('data:image/png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.startsWith('data:image/jpeg')) return 'image/jpeg';
    if (lower.endsWith('.ico') || lower.startsWith('data:image/x-icon')) return 'image/x-icon';
  } catch {}
  return 'image/x-icon';
}

// 全站图片懒加载：
// - 常规网络图片：使用 loading=lazy + spinner
// - data:image/*（内联 Base64）：改为占位符，使用 IntersectionObserver 进入视口再切换真实 src
let __IMG_LAZY_OBSERVER = null;
const __IMG_PLACEHOLDER = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
function applyGlobalLazyLoading(root = document) {
  const ensureObserver = () => {
    if (__IMG_LAZY_OBSERVER || !('IntersectionObserver' in window)) return;
    __IMG_LAZY_OBSERVER = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        __IMG_LAZY_OBSERVER.unobserve(img);
        const real = img.getAttribute('data-src');
        if (real) {
          const onDone = () => {
            const sp = img.parentElement && img.parentElement.querySelector('.lazy-spinner');
            if (sp) sp.remove();
            img.removeAttribute('data-lazy-pending');
            try { if (img.parentElement) img.parentElement.classList.add('loaded'); img.style.opacity = ''; } catch {}
          };
          img.addEventListener('load', onDone, { once: true });
          img.addEventListener('error', onDone, { once: true });
          // 触发真实加载
          img.src = real;
        }
      });
    }, { rootMargin: '200px 0px', threshold: 0.01 });
  };

  const imgs = Array.from(root.querySelectorAll('img'));
  imgs.forEach(img => {
    if (img.dataset.lazyApplied === '1') return; img.dataset.lazyApplied = '1';
    if (img.dataset.noSpinner === '1') { img.loading = 'eager'; return; }

    const parent = img.parentNode; if (!parent) return;
    const wrapper = document.createElement('span'); wrapper.className = 'lazy-wrapper';
    const spinner = document.createElement('span'); spinner.className = 'lazy-spinner';
    parent.insertBefore(wrapper, img); wrapper.appendChild(img); wrapper.appendChild(spinner);
    // LQIP：如 img 携带 data-lqip，则在包装器设置背景并启用淡入
    try {
      const __lqip = img.getAttribute('data-lqip') || '';
      if (__lqip) {
        wrapper.classList.add('lqip');
        wrapper.style.backgroundImage = `url(${__lqip})`;
        wrapper.style.backgroundSize = 'cover';
        wrapper.style.backgroundPosition = 'center';
        img.style.opacity = '0';
        img.style.transition = 'opacity .6s ease';
      }
    } catch {}

    const srcNow = img.getAttribute('src') || '';
    const isDataUri = /^data:image\//i.test(srcNow);

    if (isDataUri) {
      // 将 data: 源转存为 data-src，占位符占位，使用 IO 进入视口时再真正设置 src
      if (!img.getAttribute('data-src')) img.setAttribute('data-src', srcNow);
      img.setAttribute('data-lazy-pending', '1');
      try { img.decoding = 'async'; } catch {}
      // 占位符避免立即解码原始 data:image
      img.setAttribute('src', __IMG_PLACEHOLDER);
      ensureObserver();
      if (__IMG_LAZY_OBSERVER) {
        __IMG_LAZY_OBSERVER.observe(img);
      } else {
        // 降级：无 IO 时，在空闲时加载
        setTimeout(() => {
          const real = img.getAttribute('data-src'); if (!real) return;
          img.src = real;
        }, 300);
      }
      // 注意：此路径不根据 img.complete 去清除 spinner，等待真实图片加载事件来清除
    } else {
      // 常规网络图片：直接使用浏览器原生 lazy + 事件清理 spinner
      img.loading = 'lazy';
  const clear = () => { try { spinner.remove(); if (img.parentElement) img.parentElement.classList.add('loaded'); img.style.opacity = ''; } catch {} };
      if (img.complete) { clear(); }
      else { img.addEventListener('load', clear, { once: true }); img.addEventListener('error', clear, { once: true }); }
    }
  });
}

// 为正文中的图片添加外框与描述（基于 alt 文本）。
function styleImages(root = document) {
  const scope = root.querySelector ? (root.querySelector('.markdown-body') || root) : root;
  const imgs = Array.from(scope.querySelectorAll('img'));
  imgs.forEach(img => {
    // 已在 frame 中则跳过
    if (img.closest('figure.img-frame')) return;
    const alt = (img.getAttribute('alt') || '').trim();
    // 获取懒加载包装器（若存在）以保持 spinner 与 LQIP 效果
    const wrapper = img.parentElement && img.parentElement.classList.contains('lazy-wrapper') ? img.parentElement : img;
    const parent = wrapper.parentElement;
    if (!parent) return;
    // 创建 figure
    const fig = document.createElement('figure');
    fig.className = 'img-frame';
    parent.insertBefore(fig, wrapper);
    fig.appendChild(wrapper);
    if (alt) {
      const cap = document.createElement('figcaption');
      cap.className = 'img-caption';
      cap.textContent = alt;
      fig.appendChild(cap);
    }
  });

  // 启用图片灯箱 (Lightbox)
  if (window.mediumZoom) {
    mediumZoom(imgs, { background: 'var(--bg)', margin: 24 });
  }
}

function renderArithmatex(container) {
  // 1. 处理 pymdownx.arithmatex 输出的专用类 (generic: true)
  if (window.katex && window.renderMathInElement) {
      //让 KaTeX auto-render 扫描整个容器，处理 $...$ 和 $$...$$ 以及 wrap 里的 math
     renderMathInElement(container, {
      delimiters: [
        {left: "$$", right: "$$", display: true},
        {left: "$", right: "$", display: false},
        {left: "\\(", right: "\\)", display: false},
        {left: "\\[", right: "\\]", display: true}
      ],
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
      throwOnError: false
    });
  }
}

function renderMermaid(container) {
    if (!window.mermaid) return;
    // 根据当前主题初始化
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    try {
      mermaid.initialize({ 
        startOnLoad: false, 
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'loose',
      });
    } catch (e) {}

    // 查找所有 .mermaid 块
    $$('.mermaid', container).forEach(async (el) => {
        if (el.getAttribute('data-processed')) return;
        // 标记已处理
        el.setAttribute('data-processed', 'true');
        // 保存源码
        const code = el.textContent || '';
        // 清空用于渲染 SVG
        el.innerHTML = ''; 
        const id = 'mermaid-' + Math.random().toString(36).substr(2, 9);
        try {
            // mermaid 10.x render 返回 { svg }
            const { svg } = await mermaid.render(id, code);
            el.innerHTML = svg;
        } catch (err) {
            // 渲染失败保留原文或显示错误
            el.textContent = code; 
            console.error('Mermaid render error:', err);
        }
    });
}


// 动态保障 CDN 资源，失败时尝试回退源，并在加载后重渲染数学与高亮
async function ensureCDNAssets() {
  const app = $('#app');
  // 先短暂等待本地 defer 脚本就绪，避免误判而去拉外网
  const katexReady = await waitFor(() => !!(window.katex && window.renderMathInElement), 12, 100);
  const hljsReady = await waitFor(() => !!window.hljs, 12, 100);
  const mermaidReady = await waitFor(() => !!window.mermaid, 12, 100);

  const fallbacks = {
    katexCss: [
      'https://cdn.staticfile.org/KaTeX/0.16.11/katex.min.css',
      'https://npm.elemecdn.com/katex@0.16.11/dist/katex.min.css',
      'https://unpkg.com/katex@0.16.11/dist/katex.min.css'
    ],
    katexJs: [
      'https://cdn.staticfile.org/KaTeX/0.16.11/katex.min.js',
      'https://npm.elemecdn.com/katex@0.16.11/dist/katex.min.js',
      'https://unpkg.com/katex@0.16.11/dist/katex.min.js'
    ],
    autoRender: [
      'https://cdn.staticfile.org/KaTeX/0.16.11/contrib/auto-render.min.js',
      'https://npm.elemecdn.com/katex@0.16.11/dist/contrib/auto-render.min.js',
      'https://unpkg.com/katex@0.16.11/dist/contrib/auto-render.min.js'
    ],
    hljsCss: [
      'https://cdn.staticfile.org/highlight.js/11.10.0/styles/github.min.css',
      'https://npm.elemecdn.com/highlight.js@11.10.0/styles/github.min.css',
      'https://unpkg.com/highlight.js@11.10.0/styles/github.min.css'
    ],
    hljsJs: [
      'https://cdn.staticfile.org/highlight.js/11.10.0/highlight.min.js',
      'https://npm.elemecdn.com/highlight.js@11.10.0/build/highlight.min.js',
      'https://unpkg.com/highlight.js@11.10.0/build/highlight.min.js'
    ],
    mermaidJs: [
      'https://cdn.staticfile.org/mermaid/10.9.0/mermaid.min.js',
      'https://cdnjs.cloudflare.com/ajax/libs/mermaid/10.9.0/mermaid.min.js'
    ]
  };

  const tasks = [];
  if (!katexReady) {
    // 确保 CSS
    if (!hasStylesheet('katex')) tasks.push(loadCssFallback(fallbacks.katexCss));
    // 加载 JS 与 auto-render
    tasks.push(loadScriptFallback(fallbacks.katexJs));
    tasks.push(loadScriptFallback(fallbacks.autoRender));
  }
  if (!mermaidReady) {
     tasks.push(loadScriptFallback(fallbacks.mermaidJs));
  }
  if (!hljsReady) {
    if (!hasStylesheet('highlight.js')) tasks.push(loadCssFallback(fallbacks.hljsCss));
    tasks.push(loadScriptFallback(fallbacks.hljsJs));
  }

  if (tasks.length) {
    // 设定总体超时，避免首屏卡住
    try { await withTimeout(Promise.all(tasks), 2000); } catch {}
    // 资源就绪后尝试重渲染当前页面内容
    if (app) {
      renderArithmatex(app);
      renderMermaid(app);
      renderCode(app);
    }
  }
}

function hasStylesheet(keyword) {
  return Array.from(document.styleSheets || []).some(ss => {
    try { return String(ss.href || '').toLowerCase().includes(keyword.toLowerCase()); } catch { return false; }
  });
}

async function loadScriptFallback(urls) {
  for (const url of urls) {
    try { await loadScript(url); return; } catch { /* try next */ }
  }
  throw new Error('All script fallbacks failed');
}

async function loadCssFallback(urls) {
  for (const url of urls) {
    try { await loadCss(url); return; } catch { /* try next */ }
  }
  throw new Error('All css fallbacks failed');
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.defer = true; s.onload = () => resolve(); s.onerror = () => reject(new Error('load failed'));
    document.head.appendChild(s);
  });
}

function loadCss(href) {
  return new Promise((resolve, reject) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = href; l.onload = () => resolve(); l.onerror = () => reject(new Error('load failed'));
    document.head.appendChild(l);
  });
}

function renderPager() {
  const p = state.pagination || { page: 1, pageSize: 10, totalPages: 1, total: 0, hasPrev: false, hasNext: false };
  const wrap = document.createElement('div');
  wrap.className = 'pager';
  const left = document.createElement('div'); left.className = 'left';
  const center = document.createElement('div'); center.className = 'center';
  const right = document.createElement('div'); right.className = 'right';

  const prev = document.createElement('button');
  prev.textContent = '上一页';
  prev.disabled = !p.hasPrev;
  prev.addEventListener('click', () => setQueryAndNavigate(state.q, Math.max(1, (p.page || 1) - 1)));
  const next = document.createElement('button');
  next.textContent = '下一页';
  next.disabled = !p.hasNext;
  next.addEventListener('click', () => setQueryAndNavigate(state.q, Math.min(p.totalPages || 1, (p.page || 1) + 1)));
  const info = document.createElement('span'); info.className = 'info';
  if ((p.totalPages || 1) <= 1) {
    info.textContent = `共 ${p.total} 篇`;
  } else {
    info.textContent = `第 ${p.page}/${p.totalPages} 页 · 共 ${p.total} 篇`;
  }
  left.appendChild(prev);
  right.appendChild(next);
  center.appendChild(info);
  wrap.appendChild(left);
  wrap.appendChild(center);
  wrap.appendChild(right);
  return wrap;
}

function setupMobileSidebar(cfg) {
  const headerActions = document.querySelector('.header-actions');
  if (!headerActions) return;
  // 如果已存在则不重复创建
  if (!document.getElementById('menuBtn')) {
    const btn = document.createElement('button');
    btn.id = 'menuBtn';
    btn.className = 'menu-btn';
    btn.setAttribute('aria-label', '打开菜单');
    btn.innerHTML = '<span class="bar"></span><span class="bar"></span><span class="bar"></span>';
    headerActions.appendChild(btn);
  }
  if (!document.getElementById('sidebarBackdrop')) {
    const backdrop = document.createElement('div');
    backdrop.id = 'sidebarBackdrop';
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(backdrop);
  }
  if (!document.getElementById('sidebarPanel')) {
    const side = document.createElement('aside');
    side.id = 'sidebarPanel';
    side.className = 'sidebar';
    side.innerHTML = '';
    const title = document.createElement('div'); title.className = 'title'; title.textContent = cfg.siteName || '菜单';
    // 将文本链接与纯图标链接分组，提升移动端观感
    const linksMain = document.createElement('div'); linksMain.className = 'links-main';
    const linksIcons = document.createElement('div'); linksIcons.className = 'links-icons';
    (cfg.navLinks || []).forEach(link => {
      const a = renderNavLink(link);
      const hasImg = !!a.querySelector('img');
      const text = (a.textContent || '').trim();
      if (hasImg && text.length === 0) {
        linksIcons.appendChild(a);
      } else {
        linksMain.appendChild(a);
      }
    });
    // 固定 Tags 入口
    const tagsLink = document.createElement('a');
    tagsLink.href = '/tags';
    tagsLink.textContent = '标签';
    linksMain.appendChild(tagsLink);
    const sinput = document.createElement('input');
    sinput.className = 'search-input'; sinput.type = 'search'; sinput.placeholder = '搜索文章…';
    sinput.value = state.q || '';
    // 输入时仅更新列表，不自动收起侧边栏，避免移动端键盘弹出导致侧栏闪退
    let t2; sinput.addEventListener('input', () => {
      clearTimeout(t2);
      t2 = setTimeout(() => { setQueryAndNavigate(sinput.value.trim(), 1); }, 300);
    });
    // 回车时触发搜索并收起侧边栏
    sinput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { setQueryAndNavigate(sinput.value.trim(), 1); hideSidebar(); }
    });
    side.appendChild(title);
    side.appendChild(linksMain);
    if (linksIcons.childElementCount > 0) side.appendChild(linksIcons);
    side.appendChild(sinput);
    // 语言切换（移动端）
    const langBox = document.createElement('div');
    langBox.className = 'lang-switch mobile';
    langBox.id = 'langSwitchMobile';
    side.appendChild(langBox);
    try {
      if (window.translate) {
        const select = document.createElement('select');
        select.className = 'lang-select';
        const options = [
          { id: 'chinese_simplified', name: '简体中文' },
          { id: 'english', name: 'English' },
          { id: 'japanese', name: '日本語' },
          { id: 'korean', name: '한국어' }
        ];
        const current = (translate.language && translate.language.getCurrent && translate.language.getCurrent()) || 'chinese_simplified';
        options.forEach(o => {
          const opt = document.createElement('option');
          opt.value = o.id; opt.textContent = o.name;
          if (o.id === current) opt.selected = true;
          select.appendChild(opt);
        });
        select.addEventListener('change', (e) => {
          const val = e.target.value;
          try { translate.changeLanguage(val); } catch {}
          // 同步桌面导航的下拉选中项
          try { if (translate.selectLanguageTag && translate.selectLanguageTag.refreshRender) translate.selectLanguageTag.refreshRender(); } catch {}
          // 同步自身显示为当前语言
          try {
            const cur = (translate.language && translate.language.getCurrent && translate.language.getCurrent()) || val;
            Array.from(select.options).forEach(opt => { opt.selected = (opt.value === cur); });
          } catch {}
        });
        langBox.appendChild(select);
      }
    } catch {}
    document.body.appendChild(side);
  }
  const menuBtn = document.getElementById('menuBtn');
  const backdrop = document.getElementById('sidebarBackdrop');
  const panel = document.getElementById('sidebarPanel');
  function showSidebar() { backdrop.classList.add('show'); panel.classList.add('open'); }
  function hideSidebar() { backdrop.classList.remove('show'); panel.classList.remove('open'); }
  menuBtn.onclick = showSidebar;
  backdrop.onclick = hideSidebar;
  // 点击侧边栏的导航链接时自动收起
  panel.querySelectorAll('.links-main a, .links-icons a').forEach(a => a.addEventListener('click', hideSidebar));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideSidebar(); });
}

function renderNavLink(link) {
  const a = document.createElement('a');
  a.href = link.href || '#';
  if (link.ariaLabel) a.setAttribute('aria-label', link.ariaLabel);
  const title = link.title != null ? String(link.title) : '';
  // 如果包含 HTML 标签，按 HTML 注入以支持 <img>/<i> 图标；否则作为纯文本
  if (/[<][a-z]/i.test(title)) a.innerHTML = title; else a.textContent = title;
  return a;
}

function waitFor(check, retries = 10, interval = 100) {
  return new Promise(resolve => {
    let n = 0;
    const timer = setInterval(() => {
      if (check()) { clearInterval(timer); resolve(true); }
      else if (++n >= retries) { clearInterval(timer); resolve(false); }
    }, interval);
  });
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

function mountToc(container) {
  const aside = container.querySelector('.toc-side');
  if (!aside) return;
  const tocInContent = container.querySelector('.markdown-body .toc');
  const tocInAside = aside.querySelector('.toc');

  let activeToc = null;
  if (tocInContent) {
    // 移动 TOC 到侧边栏
    aside.innerHTML = '';
    aside.appendChild(tocInContent);
    activeToc = tocInContent;
  } else if (tocInAside) {
    activeToc = tocInAside;
  }
  
  // 仅当 TOC 有实质内容（存在链接）时才显示
  if (activeToc && activeToc.querySelector('a')) {
    aside.classList.remove('hidden');
  } else {
    aside.classList.add('hidden');
  }
}

// 建立目录与正文滚动同步：高亮当前章节并自动滚动目录保持可见
function setupTocScrollSync(root = document) {
  const article = root.querySelector ? root.querySelector('.markdown-body') : null;
  const toc = root.querySelector ? root.querySelector('.toc-side .toc') : null;
  if (!article || !toc) return;
  const links = Array.from(toc.querySelectorAll('a[href^="#"]'));
  if (!links.length) return;
  const linkMap = new Map();
  links.forEach(a => {
    try { const id = decodeURIComponent((a.getAttribute('href') || '').replace(/^#/, '')); if (id) linkMap.set(id, a); } catch {}
  });
  const headings = Array.from(article.querySelectorAll('h1, h2, h3, h4, h5, h6')).filter(h => h.id && linkMap.has(h.id));
  if (!headings.length) return;
  const headerEl = document.querySelector('.site-header');
  const topOffset = (headerEl ? headerEl.offsetHeight : 56) + 8;
  let activeId = null;
  let positions = [];
  function recomputePositions() {
    positions = headings.map(h => h.offsetTop);
  }
  function setActive(id) {
    if (!id || id === activeId) return;
    activeId = id;
    links.forEach(a => a.classList.remove('active'));
    const link = linkMap.get(id);
    if (link) { 
        link.classList.add('active'); 
        // 自动滚动目录使其可见（垂直居中偏上）
        try {
            link.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch {}
    }
  }
  let ticking = false;
  function onScroll() {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => {
      const y = window.scrollY + topOffset + 4;
      // 找到最后一个 <= y 的标题（线性扫描在标题有限时足够稳定）
      let idx = 0;
      for (let i = 0; i < positions.length; i++) {
        if (positions[i] <= y) idx = i; else break;
      }
      setActive(headings[idx].id);
      ticking = false;
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', () => { recomputePositions(); onScroll(); }, { passive: true });
  // 目录点击期间短暂抑制自动滚动（虽然目录不再单独滚动，仍保留以避免冲突）
  let clickedAt = 0;
  toc.addEventListener('click', (e) => { const a = e.target.closest('a'); if (a) clickedAt = Date.now(); }, true);
  const oldSetActive = setActive;
  setActive = function(id) {
    if (Date.now() - clickedAt < 500) {
      // 抑制目录自动滚动，但仍更新高亮
      activeId = id;
      links.forEach(a => a.classList.remove('active'));
      const link = linkMap.get(id); if (link) link.classList.add('active');
      return;
    }
    oldSetActive(id);
  };
  // 初始计算与多次延时校准（图片加载影响布局）
  recomputePositions();
  setTimeout(() => { recomputePositions(); onScroll(); }, 50);
  setTimeout(() => { recomputePositions(); onScroll(); }, 300);
  setTimeout(() => { recomputePositions(); onScroll(); }, 1200);
}

// 处理页内锚点的滚动与高亮（兼容粘滞头部），避免整页重渲染
function handleInternalAnchorNavigation(hash, opts = { updateHash: true }) {
  if (!hash || hash.length < 2) return;
  const id = decodeURIComponent(hash.replace(/^#/, ''));
  const target = document.getElementById(id);
  if (!target) return;
  const header = document.querySelector('.site-header');
  const headerOffset = (header ? header.offsetHeight : 56) + 8; // 粘性头部高度 + 间距
  const rect = target.getBoundingClientRect();
  const y = rect.top + window.scrollY - headerOffset;
  window.scrollTo({ top: y, behavior: 'smooth' });
  highlightOnce(target);
  if (opts.updateHash) {
    // 保留当前 hash 路由（例如 #/post/slug），仅在其后设置页内锚点（#/post/slug#section）
    const url = new URL(location.href);
    const base = (location.hash.match(/^#\/post\/[^#?]+/) || [null])[0];
    if (base) {
      url.hash = base + '#' + id; // 例：#/post/abc#_2
    } else {
      url.hash = '#' + id; // 非详情页，仅设置锚点
    }
    history.replaceState(null, '', url);
  }
}

function highlightOnce(el) {
  try {
    el.classList.add('anchor-highlight');
    setTimeout(() => el.classList.remove('anchor-highlight'), 2000);
  } catch {}
}

// 捕获文内 a[href^="#"] 点击，执行平滑滚动与高亮
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a) return;
  const href = a.getAttribute('href') || '';
  if (!href.startsWith('#') || href.startsWith('#/')) return;
  e.preventDefault();
  // 在详情页内点击锚点：不触发整页重渲染，使用 pushState 仅更新 URL，并平滑滚动
  const base = (location.hash.match(/^#\/post\/[^#?]+/) || [null])[0];
  const url = new URL(location.href);
  if (base) {
    url.hash = base + href; // 例：#/post/abc#section-1
    history.pushState(null, '', url); // 不触发 hashchange
    handleInternalAnchorNavigation(href, { updateHash: false });
  } else {
    // 非详情页：只更新 #anchor 并滚动
    url.hash = href;
    history.pushState(null, '', url);
    handleInternalAnchorNavigation(href, { updateHash: false });
  }
});
