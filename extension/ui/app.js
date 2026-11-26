/*
 * MediaHarbor – UI (toolbar popup + full-page manager).
 */
(function () {
  'use strict';

  const MODE = document.body.classList.contains('manager') ? 'manager' : 'popup';
  const params = new URLSearchParams(location.search);
  const D = globalThis.MHDownloadTools;
  const DEFAULTS = { ...D.defaults, folder: 'MediaHarbor', bySite: true, askWhere: false, theme: 'system', minSize: 0, hideSmall: true, view: 'grid', cover: false, igButtons: true };
  const BLOCKED_VIDEO = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|netflix\.com|disneyplus\.com|primevideo\.com|hulu\.com|max\.com|hbomax\.com|spotify\.com)$/i;

  // ------------------------------------------------------------------ icons
  const P = {
    logo: '<path d="M12 3v11"/><path d="m7.5 9.5 4.5 4.5 4.5-4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    download: '<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.9-3.9L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M4 13a8 8 0 0 0 14.9 3.9L20 15.5"/><path d="M20 20v-4.5h-4.5"/>',
    expand: '<path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/>',
    gear: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L6 21"/>',
    video: '<rect x="2" y="5" width="15" height="14" rx="3"/><path d="m22 8-5 4 5 4V8Z"/>',
    play: '<path d="M7 4v16l13-8L7 4Z"/>',
    stream: '<path d="M4.9 19.1a10 10 0 0 1 0-14.2"/><path d="M7.8 16.2a6 6 0 0 1 0-8.4"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M19.1 4.9a10 10 0 0 1 0 14.2"/>',
    check: '<path d="M5 12.5 10 17 19 7"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    scroll: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v3"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    open: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    loader: '<path d="M21 12a9 9 0 1 1-6.2-8.6"/>',
    sparkle: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'
  };
  const icon = (n, cls) => `<svg class="i ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${P[n] || ''}</svg>`;

  // ------------------------------------------------------------------ state
  const state = {
    tabId: null, page: { url: '', title: '' }, favicon: '', tabExists: true,
    items: new Map(), statuses: {}, jobs: [],
    filter: params.get('filter') || 'all', sort: 'quality', minSize: 0, query: '',
    selected: new Set(), lastClicked: null,
    settings: { ...DEFAULTS }, loaded: false, scrolling: false, scanning: false,
    visible: [], scanError: ''
  };
  let port = null;
  const els = {};
  const cards = new Map();

  // ------------------------------------------------------------------ helpers
  const $ = (sel, root) => (root || document).querySelector(sel);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return ''; } };
  const isVideoKind = (k) => k === 'video' || k === 'hls' || k === 'dash';
  const area = (it) => (it.width || 0) * (it.height || 0);

  function fmtBytes(n) {
    if (!n) return '';
    const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
  }
  function fmtDur(s) {
    if (!s) return '';
    const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  }
  function quality(it) {
    const w = it.width || 0; const h = it.height || 0;
    if (isVideoKind(it.kind)) {
      const p = Math.min(w || h, h || w);
      if (!p) return it.quality ? { label: it.quality, cls: it.quality === 'HD' ? 'q-hd' : '' } : null;
      if (p >= 2160) return { label: '4K', cls: 'q-4k' };
      if (p >= 1440) return { label: '1440p', cls: 'q-hd' };
      if (p >= 1080) return { label: '1080p', cls: 'q-hd' };
      if (p >= 720) return { label: '720p', cls: 'q-hd' };
      return { label: p + 'p', cls: '' };
    }
    const long = Math.max(w, h);
    if (long >= 3840) return { label: '4K+', cls: 'q-4k' };
    if (long >= 1920) return { label: 'Full HD', cls: 'q-hd' };
    if (long >= 1200) return { label: 'HD', cls: 'q-hd' };
    return null;
  }
  function extOf(it) {
    if (it.kind === 'hls' || it.kind === 'dash') return 'MP4';
    if (it.url.startsWith('data:')) return ((/^data:\w+\/([\w+]+)/.exec(it.url) || [])[1] || 'img').replace('svg+xml', 'svg').replace('jpeg', 'jpg').toUpperCase();
    try {
      const u = new URL(it.url);
      if (u.hostname === 'pbs.twimg.com' && u.searchParams.get('format')) return u.searchParams.get('format').toUpperCase();
      const m = /\.([a-z0-9]{2,4})$/i.exec(u.pathname);
      if (m) return m[1].toUpperCase().replace('JPEG', 'JPG');
    } catch (e) { /* ignore */ }
    if (it.mime) return (it.mime.split('/')[1] || '').toUpperCase().replace('JPEG', 'JPG');
    return it.kind === 'image' ? 'IMG' : 'VIDEO';
  }
  function displayName(it) {
    if (it.title) return it.title;
    if (it.alt) return it.alt;
    if (it.url.startsWith('data:')) return 'Embedded image';
    if (it.kind === 'hls' || it.kind === 'dash') {
      const q = quality(it);
      return `${state.page.title || hostOf(state.page.url) || 'Video'}${q ? ' · ' + q.label : ''}`;
    }
    try {
      const u = new URL(it.url);
      const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || u.hostname);
      return last.length > 60 ? last.slice(0, 57) + '…' : last;
    } catch (e) { return 'Media'; }
  }
  function typeLabel(it) {
    if (it.kind === 'hls') return 'HLS stream';
    if (it.kind === 'dash') return 'DASH stream';
    return it.kind === 'image' ? 'Image' : 'Video';
  }
  function subline(it) {
    const parts = [];
    if (it.width && it.height) parts.push(`${it.width}×${it.height}`);
    else if (it.minWidth && it.kind === 'image') parts.push(`≥${it.minWidth}px`);
    if (it.duration) parts.push(fmtDur(it.duration));
    if (it.size) parts.push(fmtBytes(it.size));
    parts.push(it.kind === 'hls' ? 'HLS → MP4' : it.kind === 'dash' ? 'DASH → MP4' : extOf(it));
    return parts.join(' · ');
  }
  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }
  function send(msg) { return chrome.runtime.sendMessage(msg).catch(() => null); }

  // ------------------------------------------------------------------ settings & theme
  async function loadSettings() {
    const s = await chrome.storage.sync.get('settings').catch(() => ({}));
    state.settings = { ...DEFAULTS, ...(s.settings || {}) };
    state.minSize = +state.settings.minSize || 0;
    applyTheme();
  }
  function saveSettings() {
    chrome.storage.sync.set({ settings: state.settings }).catch(() => {});
  }
  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
    if (els.themeBtn) els.themeBtn.innerHTML = icon(isDark() ? 'sun' : 'moon');
  }
  function isDark() {
    const t = state.settings.theme;
    return t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  }

  // ------------------------------------------------------------------ layout
  function buildShell() {
    const app = $('#app');
    app.innerHTML = `
      <header class="topbar">
        <div class="brand">
          <div class="logo" aria-hidden="true">${icon('logo')}</div>
          <div class="brand-text">
            <h1>MediaHarbor</h1>
            <p class="page-line"><img id="fav" alt="" hidden><span id="pageHost">Loading…</span></p>
          </div>
        </div>
        <div class="top-actions">
          <button class="icon-btn" id="scanBtn" title="Scan the page again" aria-label="Scan the page again">${icon('refresh')}</button>
          <button class="icon-btn" id="scrollBtn" title="Load more: scroll the page automatically" aria-label="Load more by scrolling the page" aria-pressed="false">${icon('scroll')}</button>
          <button class="icon-btn hide-sm" id="viewBtn" title="Switch grid / list" aria-label="Switch between grid and list view">${icon('list')}</button>
          ${MODE === 'popup' ? `<button class="icon-btn" id="expandBtn" title="Open full view" aria-label="Open full view in a tab">${icon('expand')}</button>` : ''}
          <button class="icon-btn hide-sm" id="themeBtn" title="Light / dark theme" aria-label="Toggle theme">${icon('moon')}</button>
          <button class="icon-btn" id="historyBtn" title="History and queue" aria-label="History and queue">${icon('list')}</button>
          <button class="icon-btn" id="settingsBtn" title="Settings" aria-label="Settings">${icon('gear')}</button>
        </div>
      </header>
      <div class="notice" id="notice" role="status" hidden></div>
      <nav class="toolbar" aria-label="Filters">
        <div class="segmented" role="tablist" aria-label="Media type">
          <button role="tab" data-filter="all" aria-selected="true">All <span class="count" id="cAll">0</span></button>
          <button role="tab" data-filter="image">${icon('image')} Images <span class="count" id="cImg">0</span></button>
          <button role="tab" data-filter="video">${icon('video')} Videos <span class="count" id="cVid">0</span></button>
        </div>
        <div class="tools">
          <label class="search"><span class="sr-only">Search</span>${icon('search')}<input id="query" type="search" placeholder="Search" autocomplete="off"></label>
          <label><span class="sr-only">Sort</span>
            <select class="select" id="sort">
              <option value="quality">Best quality first</option>
              <option value="order">Page order</option>
              <option value="size">Largest file first</option>
              <option value="type">Videos first</option>
            </select>
          </label>
          <label><span class="sr-only">Minimum size</span>
            <select class="select" id="minSize">
              <option value="0">Any size</option>
              <option value="300">300 px +</option>
              <option value="800">800 px +</option>
              <option value="1200">HD 1200 px +</option>
              <option value="1920">Full HD +</option>
            </select>
          </label>
        </div>
      </nav>
      <div class="download-options">
        <label for="downloadQuality">Download quality</label>
        <select id="downloadQuality" class="select"><option value="best">Best available</option><option value="1080">Up to 1080p</option><option value="720">Up to 720p</option><option value="smallest">Smallest available</option></select>
        <button class="btn ghost" id="zipBtn">Save images as ZIP</button>
        <span class="hint">Quality choices apply to HLS/DASH streams. Direct files keep their source quality. Sizes appear when provided by the site.</span>
      </div>
      <div class="selectrow">
        <label class="checkline"><input type="checkbox" class="cb" id="selAll"><span id="selLabel">Select all</span></label>
        <span id="hiddenInfo"></span>
      </div>
      <main class="content" id="content">
        <div class="wrap">
          <div class="grid" id="grid" role="list" aria-label="Found media"></div>
          <div class="empty" id="empty" hidden></div>
        </div>
      </main>
      <section class="jobs" id="jobs" aria-label="Downloads in progress" hidden></section>
      <footer class="actionbar">
        <div class="summary" id="summary"><strong>Scanning…</strong></div>
        <button class="btn ghost" id="clearSel" hidden>Clear</button>
        <button class="btn primary" id="dlBtn" disabled>${icon('download')}<span>Download all</span></button>
      </footer>
      <div class="toast" id="toast" role="status" aria-live="polite"></div>

      <dialog id="lightbox" aria-label="Preview">
        <div class="lb">
          <div class="lb-top">
            <div class="title"><strong id="lbTitle"></strong><span id="lbSub"></span></div>
            <button class="icon-btn" id="lbOpen" title="Open in new tab" aria-label="Open in new tab">${icon('open')}</button>
            <button class="icon-btn" id="lbCopy" title="Copy link" aria-label="Copy link">${icon('copy')}</button>
            <button class="icon-btn" id="lbClose" title="Close (Esc)" aria-label="Close preview">${icon('x')}</button>
          </div>
          <div class="lb-stage" id="lbStage"></div>
          <button class="icon-btn lb-nav prev" id="lbPrev" aria-label="Previous">${icon('left')}</button>
          <button class="icon-btn lb-nav next" id="lbNext" aria-label="Next">${icon('right')}</button>
          <div class="lb-bottom">
            <span class="url" id="lbUrl"></span>
            <button class="btn primary" id="lbDl">${icon('download')}<span>Download</span></button>
          </div>
        </div>
      </dialog>

      <dialog id="history" class="bottom-sheet" aria-labelledby="historyTitle">
        <section class="sheet"><div class="sheet-head"><h2 id="historyTitle">History &amp; queue</h2><button class="icon-btn" id="historyClose" aria-label="Close history">${icon('x')}</button></div>
        <div class="sheet-body"><label for="historySearch">Search downloads</label><input id="historySearch" class="input" type="search" placeholder="File, website, or status">
        <div class="history-tools"><button class="btn ghost" id="queuePause">Pause queue</button><button class="btn ghost" id="historyClear">Clear finished history</button></div>
        <p class="hint">Queue pause stops new jobs. Direct files support pause/resume when the server permits it. Cancel and retry stream or ZIP jobs. Keeps the latest 500 finished records on this device; duplicate checks use exact media URLs and quality.</p>
        <div id="historyRecords" role="list" aria-label="Download history"></div></div></section>
      </dialog>
      <dialog id="settings" class="bottom-sheet" aria-labelledby="setTitle">
        <form class="sheet" method="dialog" id="setForm">
          <div class="sheet-head"><h2 id="setTitle">Settings</h2><button class="icon-btn" value="cancel" aria-label="Close">${icon('x')}</button></div>
          <div class="sheet-body">
            <label class="checkline"><input type="checkbox" id="sSite"> Save download and overlay preferences for this website only</label>
            <p class="hint" id="siteSettingsHost"></p>
            <button type="button" class="linkbtn" id="siteReset">Use global defaults for this website</button>
            <div class="field">
              <label for="sTemplate">File naming pattern (optional)</label><input id="sTemplate" aria-describedby="templateHint" class="input" maxlength="240" placeholder="{creator}/{date}/{post-id}_{index}">
              <p class="hint" id="templateHint">Tokens: {creator}, {date}, {post-id}, {index}, {title}, {site}, {name}. Extension is added automatically. Missing creator becomes “unknown”.</p>
            </div>
            <div class="field"><label for="sConcurrent">Simultaneous downloads (global)</label><input id="sConcurrent" class="input" type="number" min="1" max="6" value="3"></div>
            <div class="field"><label for="sDuplicate">Previously downloaded files</label><select class="select" id="sDuplicate"><option value="warn">Warn before saving again</option><option value="skip">Skip duplicates</option><option value="allow">Always save</option></select></div>
            <label class="checkline"><input type="checkbox" id="sMetadata"> Save source information as JSON beside files (inside ZIP collections)</label>
            <p class="hint">Includes source URL, available creator/caption, and download date. History and exports can contain private media URLs.</p>
            <div class="field">
              <label for="sFolder">Download folder</label>
              <input class="input" id="sFolder" maxlength="60" placeholder="MediaHarbor">
              <p class="hint">Files are saved in your Downloads folder, inside this folder.</p>
            </div>
            <div class="switch-row"><div class="txt"><strong>Sort into folders by website</strong><span>Example: MediaHarbor/instagram.com/photo.jpg</span></div><input type="checkbox" class="switch" aria-label="Sort into folders by website" id="sBySite"></div>
            <div class="switch-row"><div class="txt"><strong>Ask where to save</strong><span>Only for single downloads</span></div><input type="checkbox" class="switch" aria-label="Ask where to save" id="sAsk"></div>
            <div class="switch-row"><div class="txt"><strong>Hide icons and tiny images</strong><span>Hides images smaller than 120 px</span></div><input type="checkbox" class="switch" aria-label="Hide icons and tiny images" id="sHideSmall"></div>
            <div class="switch-row"><div class="txt"><strong>Download buttons on Instagram</strong><span>On every post, reel, story and grid photo</span></div><input type="checkbox" class="switch" aria-label="Download buttons on Instagram" id="sIg"></div>
            <div class="switch-row"><div class="txt"><strong>Crop thumbnails to fill</strong><span>Off shows the whole picture</span></div><input type="checkbox" class="switch" aria-label="Crop thumbnails to fill" id="sCover"></div>
            <div class="field">
              <span class="lbl">Theme</span>
              <div class="seg-mini" id="sTheme">
                <button type="button" data-v="system">System</button>
                <button type="button" data-v="light">Light</button>
                <button type="button" data-v="dark">Dark</button>
              </div>
            </div>
            <p class="legal">Only download content you own or have permission to use. Protected (DRM) videos and YouTube videos are not supported.</p>
          </div>
          <div class="sheet-foot">
            <button class="btn ghost" value="cancel">Cancel</button>
            <button class="btn primary" value="save" id="setSave">Save</button>
          </div>
        </form>
      </dialog>`;

    for (const id of ['fav', 'pageHost', 'scanBtn', 'scrollBtn', 'viewBtn', 'expandBtn', 'themeBtn', 'settingsBtn', 'notice', 'cAll', 'cImg', 'cVid', 'query', 'sort', 'minSize', 'selAll', 'selLabel', 'hiddenInfo', 'content', 'grid', 'empty', 'jobs', 'summary', 'clearSel', 'dlBtn', 'toast', 'lightbox', 'lbTitle', 'lbSub', 'lbStage', 'lbOpen', 'lbCopy', 'lbClose', 'lbPrev', 'lbNext', 'lbUrl', 'lbDl', 'settings', 'setForm', 'historyBtn', 'downloadQuality', 'zipBtn', 'history', 'historyClose', 'historySearch', 'historyRecords', 'queuePause', 'historyClear']) {
      els[id] = document.getElementById(id);
    }
    els.app = app;
    showSkeleton();
  }

  function showSkeleton() {
    els.grid.innerHTML = Array.from({ length: MODE === 'popup' ? 6 : 12 }, () => '<div class="skeleton"></div>').join('');
  }

  // ------------------------------------------------------------------ data
  function connect() {
    port = chrome.runtime.connect({ name: 'ui' });
    port.onMessage.addListener(onPortMessage);
    port.onDisconnect.addListener(() => { port = null; setTimeout(connect, 400); });
    port.postMessage({ type: 'subscribe', tabId: state.tabId });
  }

  function onPortMessage(msg) {
    if (msg.tabId !== undefined && msg.tabId !== state.tabId && msg.type !== 'jobs') return;
    switch (msg.type) {
      case 'full':
        state.items = new Map();
        for (const it of msg.items) state.items.set(it.id, it);
        if (msg.page) state.page = msg.page;
        if (msg.statuses) state.statuses = msg.statuses;
        if (msg.favicon) state.favicon = msg.favicon;
        if (msg.tabExists === false) state.tabExists = false;
        if (!state.loaded) { state.loaded = true; setTimeout(() => { state.firstScanDone = true; render(); }, 1200); }
        els.downloadQuality.value = D.effective(state.settings, state.page.url).quality;
        updateHeader();
        render();
        break;
      case 'delta':
        for (const it of msg.items) {
          const prev = state.items.get(it.id);
          // keep sizes measured locally
          if (prev) { if (area(prev) > area(it)) { it.width = prev.width; it.height = prev.height; } if (prev.size && !it.size) it.size = prev.size; }
          state.items.set(it.id, it);
        }
        if (msg.page && msg.page.url) state.page = msg.page;
        updateHeader();
        scheduleRender();
        break;
      case 'remove':
        for (const id of msg.ids) { state.items.delete(id); state.selected.delete(id); }
        scheduleRender();
        break;
      case 'reset':
        state.items = new Map(); state.selected.clear(); state.statuses = {};
        if (msg.page) state.page = msg.page;
        for (const c of cards.values()) c.el.remove();
        cards.clear();
        updateHeader();
        render();
        break;
      case 'status':
        state.statuses[msg.id] = msg.status;
        updateCardStatus(msg.id);
        break;
      case 'jobs':
        state.jobs = msg.jobs;
        renderJobs();
        break;
    }
  }

  let renderTimer = null;
  function scheduleRender() {
    if (renderTimer) return;
    renderTimer = setTimeout(() => { renderTimer = null; render(); }, 180);
  }

  // ------------------------------------------------------------------ filtering
  function isSmall(it) {
    if (it.kind !== 'image') return false;
    const long = Math.max(it.width || 0, it.height || 0);
    if (long) return long < 120;
    return false;
  }
  function computeVisible() {
    const q = state.query.trim().toLowerCase();
    const list = [];
    let hiddenSmall = 0;
    const counts = { all: 0, image: 0, video: 0 };
    for (const it of state.items.values()) {
      if (state.settings.hideSmall && isSmall(it)) { hiddenSmall++; continue; }
      if (state.minSize && it.kind === 'image') {
        const long = Math.max(it.width || 0, it.height || 0, it.minWidth || 0);
        if (long && long < state.minSize) continue;
        if (!long && it._measured) continue;
      }
      if (q && !(`${displayName(it)} ${it.url} ${it.alt || ''}`.toLowerCase().includes(q))) continue;
      counts.all++;
      if (it.kind === 'image') counts.image++; else counts.video++;
      if (state.filter === 'image' && it.kind !== 'image') continue;
      if (state.filter === 'video' && !isVideoKind(it.kind)) continue;
      list.push(it);
    }
    const typeRank = (it) => (it.kind === 'dash' || it.kind === 'hls' ? 0 : it.kind === 'video' ? 1 : 2);
    if (state.sort === 'quality') list.sort((a, b) => (isVideoKind(b.kind) - isVideoKind(a.kind)) || (area(b) - area(a)) || ((b.size || 0) - (a.size || 0)) || (a.order - b.order));
    else if (state.sort === 'size') list.sort((a, b) => ((b.size || 0) - (a.size || 0)) || (area(b) - area(a)));
    else if (state.sort === 'type') list.sort((a, b) => (typeRank(a) - typeRank(b)) || (a.order - b.order));
    else list.sort((a, b) => a.order - b.order);
    return { list, counts, hiddenSmall };
  }

  // ------------------------------------------------------------------ render
  function updateHeader() {
    const host = hostOf(state.page.url);
    els.pageHost.textContent = host || (state.page.url ? state.page.url : 'This page');
    els.pageHost.title = state.page.title || state.page.url || '';
    if (state.favicon && /^https?:|^data:/.test(state.favicon)) { els.fav.src = state.favicon; els.fav.hidden = false; els.fav.onerror = () => { els.fav.hidden = true; }; }
    if (MODE === 'manager') document.title = host ? `MediaHarbor – ${host}` : 'MediaHarbor';

    let notice = '';
    if (!state.tabExists) notice = `<svg class="i" viewBox="0 0 24 24">${P.info}</svg><p>The original tab is closed. You can still download what was found.</p>`;
    else if (state.scanError) notice = `${icon('info')}<p>${esc(state.scanError)}</p>`;
    else if (BLOCKED_VIDEO.test(host)) notice = `${icon('lock')}<p><strong>Videos are not available on ${esc(host)}.</strong> Store rules and copy protection do not allow it. Images and thumbnails still work.</p>`;
    els.notice.innerHTML = notice;
    els.notice.hidden = !notice;
    els.notice.className = 'notice' + (state.tabExists && !BLOCKED_VIDEO.test(host) ? ' info' : '');
  }

  function render() {
    const { list, counts, hiddenSmall } = computeVisible();
    state.visible = list;
    els.cAll.textContent = counts.all; els.cImg.textContent = counts.image; els.cVid.textContent = counts.video;
    for (const b of els.app.querySelectorAll('.segmented button')) { b.setAttribute('aria-selected', String(b.dataset.filter === state.filter)); b.tabIndex = b.dataset.filter === state.filter ? 0 : -1; }
    els.grid.classList.toggle('list', state.settings.view === 'list');
    els.viewBtn.innerHTML = icon(state.settings.view === 'list' ? 'grid' : 'list');
    els.hiddenInfo.textContent = hiddenSmall ? `${hiddenSmall} small icon${hiddenSmall > 1 ? 's' : ''} hidden` : '';

    // remove skeletons
    for (const s of els.grid.querySelectorAll('.skeleton')) s.remove();
    if (!state.loaded) { showSkeleton(); return; }

    // drop cards that are no longer visible
    const visibleIds = new Set(list.map((i) => i.id));
    for (const [id, c] of cards) if (!visibleIds.has(id)) { c.el.remove(); }
    // append in order (moves existing nodes)
    const frag = document.createDocumentFragment();
    for (const it of list) {
      let c = cards.get(it.id);
      if (!c) { c = createCard(it); cards.set(it.id, c); } else if (c.item !== it) updateCard(c, it);
      frag.appendChild(c.el);
    }
    els.grid.appendChild(frag);
    for (const c of cards.values()) c.el.classList.toggle('cover', !!state.settings.cover);

    // selection cleanup
    for (const id of [...state.selected]) if (!state.items.has(id)) state.selected.delete(id);
    renderEmpty(list.length, counts.all);
    renderSelection();
  }

  function renderEmpty(n, total) {
    if (n) { els.empty.hidden = true; return; }
    els.empty.hidden = false;
    if (state.scanError) {
      els.empty.innerHTML = `<div class="em-icon">${icon('lock')}</div><h2>This page can’t be scanned</h2><p>${esc(state.scanError)}</p>`;
      return;
    }
    if (!state.firstScanDone && !total) {
      els.empty.innerHTML = `<div class="em-icon">${icon('loader', 'spin')}</div><h2>Looking for images and videos…</h2><p>This takes a second.</p>`;
      els.empty.querySelector('svg').style.animation = 'spin 1s linear infinite';
      return;
    }
    if (total) {
      els.empty.innerHTML = `<div class="em-icon">${icon('search')}</div><h2>Nothing matches your filters</h2><p>Try another type or a smaller minimum size.</p><button class="btn" id="resetFilters">Show everything</button>`;
      $('#resetFilters').onclick = () => { state.filter = 'all'; state.minSize = 0; els.minSize.value = '0'; state.query = ''; if (els.query) els.query.value = ''; render(); };
      return;
    }
    els.empty.innerHTML = `<div class="em-icon">${icon('image')}</div><h2>No media found yet</h2><p>Play the video or scroll the page so it loads its pictures, then scan again. “Load more” scrolls the page for you.</p><div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap"><button class="btn" id="emScan">${icon('refresh')} Scan again</button><button class="btn primary" id="emScroll">${icon('scroll')} Load more</button></div>`;
    $('#emScan').onclick = () => rescan(true);
    $('#emScroll').onclick = () => toggleAutoScroll();
  }

  function renderSelection() {
    const n = state.selected.size;
    const vis = state.visible;
    const selVisible = vis.filter((i) => state.selected.has(i.id)).length;
    els.selAll.checked = vis.length > 0 && selVisible === vis.length;
    els.selAll.indeterminate = selVisible > 0 && selVisible < vis.length;
    els.selLabel.textContent = n ? `${n} selected` : 'Select all';
    els.app.classList.toggle('selecting', n > 0);
    els.clearSel.hidden = !n;
    const target = n ? [...state.selected].map((id) => state.items.get(id)).filter(Boolean) : vis.filter((i) => !i.drm && !i.live);
    const bytes = target.reduce((s, i) => s + (i.size || 0), 0);
    const imgs = target.filter((i) => i.kind === 'image').length;
    const vids = target.length - imgs;
    const parts = [];
    if (imgs) parts.push(`${imgs} image${imgs > 1 ? 's' : ''}`);
    if (vids) parts.push(`${vids} video${vids > 1 ? 's' : ''}`);
    els.summary.innerHTML = target.length
      ? `<strong>${n ? 'Selected' : 'On this page'}: ${target.length}</strong>${esc(parts.join(', '))}${bytes ? ' · ' + fmtBytes(bytes) + (target.some((i) => !i.size) ? '+' : '') : ''}`
      : `<strong>Nothing to download</strong>${state.items.size ? 'Change the filters to see more' : 'Waiting for media'}`;
    els.dlBtn.disabled = !target.length;
    els.dlBtn.querySelector('span').textContent = n ? `Download ${n}` : (target.length ? `Download all ${target.length}` : 'Download all');
  }

  // ------------------------------------------------------------------ cards
  function createCard(it) {
    const el = document.createElement('article');
    el.className = 'card';
    el.setAttribute('role', 'listitem');
    el.tabIndex = 0;
    el.dataset.id = it.id;
    el.innerHTML = `
      <button class="thumb" type="button" aria-label="Preview"></button>
      <label class="check" title="Select"><input type="checkbox" class="cb" aria-label="Select"></label>
      <span class="state" aria-hidden="true"></span>
      <div class="meta"><div class="name"></div><div class="sub"></div></div>
      <div class="card-actions">
        <button class="icon-btn preview" type="button" title="Preview" aria-label="Preview">${icon('eye')}</button>
        <button class="icon-btn copy" type="button" title="Copy link" aria-label="Copy link">${icon('copy')}</button>
        <button class="dl-btn" type="button">${icon('download')}<span>Save</span></button>
      </div>`;
    const c = { el, item: null, thumbEl: el.querySelector('.thumb'), loadedThumb: false };
    updateCard(c, it);
    observer.observe(el);
    return c;
  }

  function updateCard(c, it) {
    const prev = c.item;
    c.item = it;
    const el = c.el;
    el.querySelector('.name').textContent = displayName(it);
    el.querySelector('.name').title = displayName(it);
    el.querySelector('.sub').textContent = subline(it);
    const thumb = c.thumbEl;
    thumb.classList.toggle('stream', it.kind === 'hls' || it.kind === 'dash' || (it.kind === 'video' && !it.thumb));
    // badges
    const q = quality(it);
    const badges = [];
    if (q) badges.push(`<span class="badge ${q.cls}">${esc(q.label)}</span>`);
    if (it.kind === 'hls' || it.kind === 'dash') badges.push(`<span class="badge">${icon('stream')} Stream</span>`);
    else if (it.kind === 'video') badges.push(`<span class="badge">${icon('play')}${it.duration ? ' ' + fmtDur(it.duration) : ' Video'}</span>`);
    if (it.drm) badges.push(`<span class="badge warn">${icon('lock')} Protected</span>`);
    if (it.live) badges.push(`<span class="badge warn">Live</span>`);
    let b = thumb.querySelector('.badges');
    if (!b) { b = document.createElement('div'); b.className = 'badges'; thumb.appendChild(b); }
    b.innerHTML = badges.join('');
    const dl = el.querySelector('.dl-btn');
    dl.disabled = !!(it.drm || it.live);
    dl.title = it.drm ? 'Protected video – cannot be downloaded' : it.live ? 'Live stream – cannot be saved' : `Download ${typeLabel(it).toLowerCase()} in best quality`;
    dl.setAttribute('aria-label', dl.title);
    if (!prev || prev.thumb !== it.thumb || prev.url !== it.url) { c.loadedThumb = false; if (c.visible) loadThumb(c); }
    el.classList.toggle('selected', state.selected.has(it.id));
    el.querySelector('.cb').checked = state.selected.has(it.id);
    updateCardStatus(it.id, c);
  }

  function updateCardStatus(id, c) {
    c = c || cards.get(id);
    if (!c) return;
    const s = state.statuses[id] || '';
    c.el.dataset.status = s;
    const st = c.el.querySelector('.state');
    st.innerHTML = s === 'done' ? icon('check') : s === 'error' ? icon('x') : (s === 'downloading' || s === 'queued') ? icon('loader') : '';
    st.title = s === 'done' ? 'Saved' : s === 'error' ? 'Download failed' : s ? 'Downloading' : '';
  }

  // lazy thumbnails + size lookup
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const c = cards.get(e.target.dataset.id);
      if (!c) continue;
      c.visible = e.isIntersecting;
      if (e.isIntersecting) { if (!c.loadedThumb) loadThumb(c); querySize(c.item); }
    }
  }, { root: MODE === 'popup' ? null : null, rootMargin: '300px' });

  function placeholder(thumb, it) {
    let ph = thumb.querySelector('.ph');
    if (!ph) { ph = document.createElement('div'); ph.className = 'ph'; thumb.prepend(ph); }
    ph.innerHTML = icon(it.kind === 'image' ? 'image' : (it.kind === 'video' ? 'play' : 'stream'));
  }

  async function blobUrlFor(url) {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const b = await res.blob();
    if (!/^(image|video)\//.test(b.type) && b.size < 200) throw new Error('not media');
    return URL.createObjectURL(b);
  }

  function loadThumb(c) {
    c.loadedThumb = true;
    const it = c.item;
    const thumb = c.thumbEl;
    for (const m of thumb.querySelectorAll('img,video')) m.remove();
    placeholder(thumb, it);
    const imgSrc = it.kind === 'image' ? it.url : it.thumb;
    if (imgSrc) {
      const img = new Image();
      img.decoding = 'async'; img.loading = 'lazy'; img.alt = it.alt || '';
      img.referrerPolicy = 'no-referrer';
      const candidates = [imgSrc];
      if (it.kind === 'image' && it.fallback) candidates.push(it.fallback);
      let step = 0; let usedBlob = false;
      const tryNext = async () => {
        // order: url -> url as blob -> fallback -> fallback as blob
        const idx = Math.floor(step / 2); const asBlob = step % 2 === 1;
        step++;
        if (idx >= candidates.length) { img.remove(); return; }
        if (!asBlob) { img.src = candidates[idx]; return; }
        try { usedBlob = true; img.src = await blobUrlFor(candidates[idx]); } catch (e) { tryNext(); }
      };
      img.onload = () => {
        img.classList.add('loaded');
        thumb.querySelector('.ph') && thumb.querySelector('.ph').remove();
        if (it.kind === 'image') {
          const cur = c.item;
          if (img.naturalWidth && (img.naturalWidth * img.naturalHeight > area(cur) || !cur.width)) {
            cur.width = img.naturalWidth; cur.height = img.naturalHeight; cur._measured = true;
            c.el.querySelector('.sub').textContent = subline(cur);
            const q = quality(cur); const b = thumb.querySelector('.badges');
            if (q && b && !b.querySelector('.badge.q-hd,.badge.q-4k')) b.insertAdjacentHTML('afterbegin', `<span class="badge ${q.cls}">${esc(q.label)}</span>`);
            if (isSmall(cur) && state.settings.hideSmall) scheduleRender();
            else if (state.minSize) scheduleRender();
          }
          if (step > 2 && it.fallback && img.src !== it.url) { /* fallback in use */ }
        }
        if (usedBlob) setTimeout(() => URL.revokeObjectURL(img.src), 60000);
      };
      img.onerror = () => { tryNext(); };
      thumb.prepend(img);
      tryNext();
    } else if (it.kind === 'video' && !it.url.startsWith('mpd:')) {
      const v = document.createElement('video');
      v.muted = true; v.preload = 'metadata'; v.playsInline = true;
      v.src = it.url + (it.url.includes('#') ? '' : '#t=0.5');
      v.onloadeddata = () => {
        v.classList.add('loaded');
        thumb.querySelector('.ph') && thumb.querySelector('.ph').remove();
        thumb.classList.remove('stream');
      };
      v.onloadedmetadata = () => {
        const cur = c.item;
        if (v.videoWidth && !cur.width) { cur.width = v.videoWidth; cur.height = v.videoHeight; }
        if (v.duration && isFinite(v.duration)) cur.duration = Math.round(v.duration);
        c.el.querySelector('.sub').textContent = subline(cur);
        updateCard(c, cur);
      };
      v.onerror = () => v.remove();
      thumb.prepend(v);
    }
  }

  // file size via HEAD (few at a time)
  const sizeQueue = []; let sizeActive = 0; const sizeTried = new Set();
  function querySize(it) {
    if (!it || it.size || sizeTried.has(it.id) || it.kind === 'hls' || it.kind === 'dash' || !/^https?:/.test(it.url)) return;
    sizeTried.add(it.id);
    sizeQueue.push(it);
    pumpSize();
  }
  function pumpSize() {
    while (sizeActive < 4 && sizeQueue.length) {
      const it = sizeQueue.shift();
      sizeActive++;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      fetch(it.url, { method: 'HEAD', credentials: 'include', signal: ctrl.signal })
        .then((r) => {
          const n = +r.headers.get('content-length') || 0;
          const type = r.headers.get('content-type') || '';
          if (r.ok && n) {
            it.size = n; if (!it.mime && type) it.mime = type.split(';')[0];
            const c = cards.get(it.id);
            if (c) c.el.querySelector('.sub').textContent = subline(it);
            renderSelectionSoon();
          }
        }).catch(() => {}).finally(() => { clearTimeout(t); sizeActive--; pumpSize(); });
    }
  }
  let selTimer = null;
  function renderSelectionSoon() { if (!selTimer) selTimer = setTimeout(() => { selTimer = null; renderSelection(); }, 300); }

  // ------------------------------------------------------------------ actions
  function toggleSelect(id, on, range) {
    if (!id) { /* refresh UI only */ }
    else if (range && state.lastClicked) {
      const ids = state.visible.map((i) => i.id);
      const a = ids.indexOf(state.lastClicked); const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [s, e] = a < b ? [a, b] : [b, a];
        for (let i = s; i <= e; i++) state.selected.add(ids[i]);
      }
    } else if (on === undefined ? !state.selected.has(id) : on) state.selected.add(id);
    else state.selected.delete(id);
    if (id) state.lastClicked = id;
    for (const [cid, c] of cards) {
      const sel = state.selected.has(cid);
      c.el.classList.toggle('selected', sel);
      c.el.querySelector('.cb').checked = sel;
    }
    renderSelection();
  }

  async function download(ids) {
    const list = ids.map((id) => state.items.get(id)).filter((i) => i && !i.drm && !i.live);
    if (!list.length) return;
    if (list.length > 40 && !confirm(`Queue ${list.length} files? The simultaneous download limit applies.`)) return;
    for (const i of list) { state.statuses[i.id] = 'queued'; updateCardStatus(i.id); }
    const options = { quality: els.downloadQuality.value };
    const res = await send({ type: 'download', tabId: state.tabId, ids: list.map((i) => i.id), options });
    if (!res?.ok) { toast(res?.error || 'Could not queue downloads'); return; }
    const duplicates = (res.results || []).filter(r => r.duplicate);
    for (const r of duplicates) { state.statuses[r.id] = ''; updateCardStatus(r.id); }
    const warn = duplicates.filter(r => !r.skipped);
    if (warn.length && confirm(`${warn.length} file(s) are already queued or in your download history. Save them again?`)) {
      await send({ type: 'download', tabId: state.tabId, ids: warn.map(r => r.id), options: { ...options, force: true } });
    }
    if (duplicates.length) { toast(`${duplicates.length} duplicate file(s) checked. Open History & queue for details.`); return; }
    const streams = list.filter((i) => i.kind === 'hls' || i.kind === 'dash').length;
    if (!res) toast('Could not start the download. Please try again.');
    else if (streams) toast(streams === 1 && list.length === 1 ? 'Preparing the video in the selected quality…' : `Started ${list.length} downloads (${streams} need processing)`);
    else toast(list.length === 1 ? 'Download started' : `${list.length} downloads started`);
  }

  async function rescan(reset) {
    state.scanning = true;
    els.scanBtn.classList.add('spin');
    const r = await send({ type: 'scan', tabId: state.tabId, reset });
    state.scanError = r && r.ok === false ? r.error : '';
    updateHeader();
    setTimeout(() => { els.scanBtn.classList.remove('spin'); state.scanning = false; state.firstScanDone = true; render(); }, 900);
  }

  async function toggleAutoScroll() {
    if (state.scrolling) {
      send({ type: 'autoscroll', tabId: state.tabId, stop: true });
      setScrolling(false);
      return;
    }
    const r = await send({ type: 'autoscroll', tabId: state.tabId, seconds: 15 });
    if (!r || !r.ok) { toast('This page cannot be scrolled automatically.'); return; }
    setScrolling(true);
    toast('Scrolling the page to load more…');
    clearTimeout(toggleAutoScroll._t);
    toggleAutoScroll._t = setTimeout(() => setScrolling(false), 16000);
  }
  function setScrolling(on) {
    state.scrolling = on;
    els.scrollBtn.setAttribute('aria-pressed', String(on));
    els.scrollBtn.innerHTML = icon(on ? 'stop' : 'scroll');
    els.scrollBtn.title = on ? 'Stop scrolling' : 'Load more: scroll the page automatically';
  }

  async function copyLink(it) {
    const text = it.url.startsWith('mpd:') ? (state.page.url || '') : it.url;
    try { await navigator.clipboard.writeText(text); toast('Link copied'); } catch (e) { toast('Could not copy the link'); }
  }

  // ------------------------------------------------------------------ jobs
  function renderJobs() {
    const jobs = state.jobs.filter((j) => j.tabId === state.tabId);
    if (!jobs.length) { els.jobs.hidden = true; return; }
    els.jobs.hidden = false;
    const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued').length;
    els.jobs.innerHTML = `<div class="jobs-head"><span>${active ? `Processing ${active} download${active > 1 ? 's' : ''}` : 'Finished'}</span>${active < jobs.length ? '<button class="linkbtn" id="jobsClear">Clear finished</button>' : ''}</div>` +
      jobs.slice().reverse().map((j) => `
        <div class="job ${j.status === 'done' ? 'done' : j.status === 'error' ? 'error' : ''}" data-job="${esc(j.id)}">
          <div class="jt" title="${esc(j.title)}">${esc(j.title)}</div>
          ${(j.status === 'running' || j.status === 'queued') ? `<button class="icon-btn" data-cancel="${esc(j.id)}" title="Cancel" aria-label="Cancel">${icon('x')}</button>` : `<span class="icon-btn" aria-hidden="true">${icon(j.status === 'done' ? 'check' : j.status === 'error' ? 'alert' : 'x')}</span>`}
          <div class="js">${esc(j.status === 'error' ? j.error || 'Failed' : j.status === 'done' ? (j.warning || 'Saved to Downloads') : j.stage || '')}${j.status === 'running' ? ` · ${Math.round((j.progress || 0) * 100)}%` : ''}</div>
          <div class="bar"><i style="width:${Math.round((j.status === 'error' ? 1 : j.progress || 0) * 100)}%"></i></div>
        </div>`).join('');
    const clr = $('#jobsClear');
    if (clr) clr.onclick = () => send({ type: 'jobs:clear' });
    // hide successful jobs automatically; failed ones stay until cleared
    clearTimeout(renderJobs._t);
    if (!active && jobs.every((j) => j.status === 'done' || j.status === 'canceled')) {
      renderJobs._t = setTimeout(() => send({ type: 'jobs:clear' }), 6000);
    }
  }

  async function refreshHistory() {
    const result = await send({ type: 'history:list' });
    if (!result?.ok) { toast(result?.error || 'Could not load history'); return; }
    els.queuePause.dataset.paused = String(result.paused);
    els.queuePause.textContent = result.paused ? 'Resume queue' : 'Pause queue';
    els.queuePause.setAttribute('aria-pressed', String(result.paused));
    const query = els.historySearch.value.toLowerCase();
    const records = result.records.filter(j => `${j.filename} ${j.page?.url} ${j.status} ${j.error}`.toLowerCase().includes(query));
    els.historyRecords.innerHTML = records.length ? records.map(j => {
      const actions = [];
      if (j.status === 'running' && j.mode === 'native') actions.push('pause');
      if (j.status === 'paused') actions.push('resume');
      if (['running', 'paused', 'queued'].includes(j.status)) actions.push('cancel');
      if (['error', 'canceled'].includes(j.status)) actions.push('retry');
      const source = /^https?:/.test(j.page?.url || '') ? `<a href="${esc(j.page.url)}" target="_blank" rel="noopener noreferrer">Open source page</a>` : '';
      return `<article role="listitem" class="history-record"><strong>${esc(j.filename)}</strong><p>${esc(j.status)} · ${esc(new Date(j.createdAt || 0).toLocaleString())}</p>${j.error ? `<p class="history-error">${esc(j.error)}</p>` : ''}${j.warning ? `<p>${esc(j.warning)}</p>` : ''}${source}<div class="history-tools">${actions.map(a => `<button class="btn ghost" data-action="${a}" data-id="${esc(j.id)}">${a[0].toUpperCase() + a.slice(1)}</button>`).join('')}</div></article>`;
    }).join('') : '<p>No downloads match your search.</p>';
  }

  // ------------------------------------------------------------------ lightbox
  let lbIndex = -1;
  function openLightbox(id) {
    lbIndex = state.visible.findIndex((i) => i.id === id);
    if (lbIndex < 0) return;
    fillLightbox();
    if (!els.lightbox.open) els.lightbox.showModal();
  }
  function fillLightbox() {
    const it = state.visible[lbIndex];
    if (!it) return;
    els.lbTitle.textContent = displayName(it);
    els.lbSub.textContent = `${typeLabel(it)} · ${subline(it)}${it.note ? ' · ' + it.note : ''}`;
    els.lbUrl.textContent = it.url.startsWith('mpd:') ? 'Stream description from the page' : it.url.startsWith('data:') ? 'Embedded image (data URL)' : it.url;
    els.lbUrl.title = els.lbUrl.textContent;
    els.lbPrev.disabled = lbIndex <= 0; els.lbNext.disabled = lbIndex >= state.visible.length - 1;
    els.lbDl.disabled = !!(it.drm || it.live);
    const stage = els.lbStage;
    stage.innerHTML = '';
    if (it.kind === 'image') {
      const img = new Image();
      img.alt = it.alt || displayName(it);
      img.referrerPolicy = 'no-referrer';
      let triedBlob = false;
      img.onerror = async () => {
        if (triedBlob) { if (it.fallback && img.src !== it.fallback) img.src = it.fallback; else stage.innerHTML = `<div class="ph">${icon('image')}<p>Preview not available, but you can still download it.</p></div>`; return; }
        triedBlob = true;
        try { img.src = await blobUrlFor(it.url); } catch (e) { if (it.fallback) img.src = it.fallback; }
      };
      img.src = it.url;
      stage.appendChild(img);
    } else if (it.kind === 'video') {
      const v = document.createElement('video');
      v.controls = true; v.autoplay = true; v.playsInline = true; v.src = it.url;
      if (it.thumb) v.poster = it.thumb;
      v.onerror = () => { stage.innerHTML = `<div class="ph">${icon('video')}<p>Preview not available here, but the download should work.</p></div>`; };
      stage.appendChild(v);
    } else {
      stage.innerHTML = `<div class="ph">${it.thumb ? `<img src="${esc(it.thumb)}" alt="" style="max-height:50vh;border-radius:8px;margin-bottom:12px" referrerpolicy="no-referrer"><br>` : icon('stream')}
        <p><strong>${it.drm ? 'Protected stream' : it.live ? 'Live stream' : 'Streaming video'}</strong><br>${it.drm ? 'This video uses DRM copy protection and cannot be saved.' : it.live ? 'Live streams can be saved after they end.' : 'MediaHarbor downloads all parts in the best quality and joins video + audio into one MP4 file.'}</p></div>`;
    }
  }
  function closeLightbox() {
    const v = els.lbStage.querySelector('video'); if (v) v.pause();
    els.lbStage.innerHTML = '';
    if (els.lightbox.open) els.lightbox.close();
  }

  // ------------------------------------------------------------------ settings dialog
  function openSettings() {
    const s = D.effective(state.settings, state.page.url);
    $('#sSite').checked = !!state.settings.sitePreferences?.[D.site(state.page.url)];
    $('#sSite').disabled = !D.site(state.page.url);
    $('#siteSettingsHost').textContent = D.site(state.page.url) || 'Open a website to save site preferences.';
    $('#sTemplate').value = s.filenameTemplate;
    $('#sConcurrent').value = state.settings.maxConcurrent;
    $('#sDuplicate').value = s.duplicatePolicy;
    $('#sMetadata').checked = !!s.exportMetadata;
    $('#sFolder').value = s.folder;
    $('#sBySite').checked = !!s.bySite;
    $('#sAsk').checked = !!s.askWhere;
    $('#sHideSmall').checked = !!s.hideSmall;
    $('#sCover').checked = !!s.cover;
    $('#sIg').checked = s.igButtons !== false;
    for (const b of document.querySelectorAll('#sTheme button')) b.setAttribute('aria-pressed', String(b.dataset.v === s.theme));
    els.settings.querySelector('.sheet').scrollTop = 0;
    els.settings.returnValue = '';
    if (!els.settings.open) els.settings.showModal();
  }

  // ------------------------------------------------------------------ events
  function bindEvents() {
    els.historyBtn.onclick = async () => { await refreshHistory(); els.history.showModal(); };
    els.historyClose.onclick = () => els.history.close();
    els.historySearch.oninput = refreshHistory;
    els.historyClear.onclick = async () => { if (confirm('Clear finished history? Duplicate detection uses this history. Downloaded files will stay on disk.')) { await send({ type: 'history:clear' }); refreshHistory(); } };
    els.queuePause.onclick = async () => { await send({ type: 'queue:pause', paused: els.queuePause.dataset.paused !== 'true' }); refreshHistory(); };
    els.historyRecords.onclick = async e => {
      const button = e.target.closest('[data-action]'); if (!button) return;
      const result = await send({ type: 'download:control', jobId: button.dataset.id, action: button.dataset.action });
      if (!result?.ok) toast(result?.error || 'Could not update download');
      refreshHistory();
    };
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.downloadHistory && els.history.open) refreshHistory(); });
    els.downloadQuality.onchange = () => toast('Quality selected for the next download');
    els.zipBtn.onclick = async () => {
      const ids = (state.selected.size ? [...state.selected] : state.visible.map(i => i.id)).filter(id => state.items.get(id)?.kind === 'image');
      if (!ids.length) { toast('Select images to create a ZIP'); return; }
      if (ids.length > 200) { toast('Choose 200 images or fewer per ZIP'); return; }
      const result = await send({ type: 'images:zip', tabId: state.tabId, ids });
      toast(result?.ok ? 'Image collection queued' : result?.error || 'Could not create ZIP');
    };
    $('#siteReset').onclick = () => {
      delete state.settings.sitePreferences[D.site(state.page.url)]; saveSettings(); openSettings();
      els.downloadQuality.value = state.settings.quality; toast('Global defaults restored for this site');
    };
    els.scanBtn.onclick = () => rescan(true);
    els.scrollBtn.onclick = toggleAutoScroll;
    els.viewBtn.onclick = () => { state.settings.view = state.settings.view === 'list' ? 'grid' : 'list'; saveSettings(); render(); };
    if (els.expandBtn) els.expandBtn.onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL(`ui/manager.html?tab=${state.tabId}${state.filter !== 'all' ? '&filter=' + state.filter : ''}`) }); window.close(); };
    els.themeBtn.onclick = () => { state.settings.theme = isDark() ? 'light' : 'dark'; saveSettings(); applyTheme(); };
    els.settingsBtn.onclick = openSettings;
    for (const b of els.app.querySelectorAll('.segmented button')) b.onclick = () => { state.filter = b.dataset.filter; render(); els.content.scrollTop = 0; };
    const filterTabs = [...els.app.querySelectorAll('.segmented button')];
    filterTabs.forEach((b, index) => b.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const next = e.key === 'Home' ? 0 : e.key === 'End' ? filterTabs.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + filterTabs.length) % filterTabs.length;
      filterTabs[next].click(); filterTabs[next].focus();
    }));
    els.sort.onchange = () => { state.sort = els.sort.value; render(); };
    els.minSize.value = String(state.minSize);
    if (!els.minSize.value) els.minSize.value = '0';
    els.minSize.onchange = () => { state.minSize = +els.minSize.value; state.settings.minSize = state.minSize; saveSettings(); render(); };
    let qt;
    els.query.oninput = () => { clearTimeout(qt); qt = setTimeout(() => { state.query = els.query.value; render(); }, 150); };
    els.selAll.onchange = () => {
      if (els.selAll.checked) state.visible.forEach((i) => { if (!i.drm && !i.live) state.selected.add(i.id); });
      else state.visible.forEach((i) => state.selected.delete(i.id));
      toggleSelect(null, undefined); // refresh UI only
    };
    els.clearSel.onclick = () => { state.selected.clear(); toggleSelect(null, false); };
    els.dlBtn.onclick = () => {
      const ids = state.selected.size ? [...state.selected] : state.visible.map((i) => i.id);
      download(ids);
      if (state.selected.size) { state.selected.clear(); toggleSelect(null, false); }
    };

    els.grid.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card) return;
      const id = card.dataset.id;
      const it = state.items.get(id);
      if (!it) return;
      if (e.target.closest('.check')) {
        if (e.target.matches('input')) toggleSelect(id, e.target.checked, e.shiftKey);
        return;
      }
      if (e.target.closest('.dl-btn')) { download([id]); return; }
      if (e.target.closest('.copy')) { copyLink(it); return; }
      if (e.target.closest('.preview') || e.target.closest('.thumb')) {
        if (state.selected.size && e.target.closest('.thumb')) { toggleSelect(id, undefined, e.shiftKey); return; }
        openLightbox(id);
      }
    });
    els.grid.addEventListener('keydown', (e) => {
      const card = e.target.closest('.card');
      if (!card || e.target !== card) return;
      const id = card.dataset.id;
      if (e.key === ' ') { e.preventDefault(); toggleSelect(id, undefined, e.shiftKey); }
      else if (e.key === 'Enter') { e.preventDefault(); openLightbox(id); }
      else if (e.key.toLowerCase() === 'd') { e.preventDefault(); download([id]); }
      else if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        const all = [...els.grid.querySelectorAll('.card')];
        const i = all.indexOf(card);
        const cols = Math.max(1, Math.round(els.grid.clientWidth / card.offsetWidth));
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? cols : -cols;
        const next = all[Math.max(0, Math.min(all.length - 1, i + step))];
        if (next) next.focus();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (els.lightbox.open) {
        if (e.key === 'ArrowRight' && lbIndex < state.visible.length - 1) { lbIndex++; fillLightbox(); }
        if (e.key === 'ArrowLeft' && lbIndex > 0) { lbIndex--; fillLightbox(); }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !/input|select|textarea/i.test(document.activeElement.tagName)) {
        e.preventDefault(); els.selAll.checked = true; els.selAll.onchange();
      }
      if (e.key === 'Escape' && state.selected.size) { state.selected.clear(); toggleSelect(null, false); }
    });

    els.jobs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cancel]');
      if (b) send({ type: 'job:cancel', jobId: b.dataset.cancel });
    });

    // lightbox
    els.lbClose.onclick = closeLightbox;
    els.lightbox.addEventListener('close', () => { els.lbStage.innerHTML = ''; });
    els.lightbox.addEventListener('click', (e) => { if (e.target === els.lbStage) closeLightbox(); });
    els.lbPrev.onclick = () => { if (lbIndex > 0) { lbIndex--; fillLightbox(); } };
    els.lbNext.onclick = () => { if (lbIndex < state.visible.length - 1) { lbIndex++; fillLightbox(); } };
    els.lbDl.onclick = () => { const it = state.visible[lbIndex]; if (it) download([it.id]); };
    els.lbCopy.onclick = () => { const it = state.visible[lbIndex]; if (it) copyLink(it); };
    els.lbOpen.onclick = () => {
      const it = state.visible[lbIndex];
      if (it && /^https?:/.test(it.url)) chrome.tabs.create({ url: it.url });
      else if (it) toast('This item has no direct link to open');
    };
    // swipe on touch devices
    let sx = null;
    els.lbStage.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
    els.lbStage.addEventListener('touchend', (e) => {
      if (sx === null) return;
      const dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 60) { if (dx < 0) els.lbNext.click(); else els.lbPrev.click(); }
    });

    // settings
    for (const b of document.querySelectorAll('#sTheme button')) b.onclick = () => { for (const o of document.querySelectorAll('#sTheme button')) o.setAttribute('aria-pressed', String(o === b)); };
    els.settings.addEventListener('close', () => {
      if (els.settings.returnValue !== 'save') return;
      const s = { ...state.settings };
      s.filenameTemplate = $('#sTemplate').value.trim();
      s.duplicatePolicy = $('#sDuplicate').value;
      s.exportMetadata = $('#sMetadata').checked;
      s.quality = els.downloadQuality.value;
      const concurrency = Math.max(1, Math.min(6, +$('#sConcurrent').value || 3));
      s.folder = ($('#sFolder').value || '').trim().replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'MediaHarbor';
      s.bySite = $('#sBySite').checked;
      s.askWhere = $('#sAsk').checked;
      s.hideSmall = $('#sHideSmall').checked;
      s.cover = $('#sCover').checked;
      s.igButtons = $('#sIg').checked;
      const t = document.querySelector('#sTheme button[aria-pressed="true"]');
      s.theme = t ? t.dataset.v : 'system';
      const siteKeys = ['folder', 'bySite', 'askWhere', 'filenameTemplate', 'duplicatePolicy', 'exportMetadata', 'quality', 'igButtons'];
      if ($('#sSite').checked) {
        const pref = Object.fromEntries(siteKeys.map(k => [k, s[k]]));
        state.settings.sitePreferences = { ...state.settings.sitePreferences, [D.site(state.page.url)]: pref };
        for (const k of ['theme', 'hideSmall', 'cover']) state.settings[k] = s[k];
      } else {
        Object.assign(state.settings, s);
        delete state.settings.sitePreferences[D.site(state.page.url)];
      }
      state.settings.maxConcurrent = concurrency;
      saveSettings(); applyTheme(); render();
      toast('Settings saved');
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  }

  // ------------------------------------------------------------------ start
  async function init() {
    buildShell();
    await loadSettings();
    bindEvents();
    applyTheme();
    if (MODE === 'popup' && !params.get('tab')) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      state.tabId = tab.id;
      state.page = { url: tab.url || '', title: tab.title || '' };
      state.favicon = tab.favIconUrl || '';
    } else {
      state.tabId = +params.get('tab');
      if (!state.tabId) {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true, url: ['http://*/*', 'https://*/*'] });
        if (tab) state.tabId = tab.id;
      }
    }
    updateHeader();
    if (state.page.url && !/^https?:/.test(state.page.url) && MODE === 'popup') {
      state.scanError = 'Browser pages, settings and the Chrome Web Store cannot be scanned. Open a normal website.';
      state.loaded = true; state.firstScanDone = true;
      updateHeader(); render();
      return;
    }
    connect();
    // ask the page to send everything again (also injects the scanner if needed)
    rescan(true);
  }

  init();
})();
