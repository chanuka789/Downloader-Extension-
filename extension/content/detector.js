/*
 * MediaHarbor – content script (isolated world, every frame).
 * Finds images and videos in the page and sends them to the service worker.
 */
(function () {
  'use strict';
  if (window.__mediaHarborDetector) return;
  window.__mediaHarborDetector = true;

  const R = globalThis.MHRules;
  const X = globalThis.__mediaHarborExtract;
  const BLOCK_VIDEO = R.isBlockedVideoHost(location.hostname);
  const IS_TOP = window === window.top;

  let sent = new Set();
  let pending = [];
  let flushTimer = null;
  let scanTimer = null;
  let lastScan = 0;
  const parsedScripts = new WeakSet();

  // ---------- helpers ----------
  function abs(u) {
    if (!u || typeof u !== 'string') return null;
    u = u.trim();
    if (!u || u.startsWith('blob:') || u.startsWith('javascript:') || u.startsWith('about:')) return null;
    if (u.startsWith('data:')) return u.length > 4000 && /^data:(image|video)\//.test(u) ? u : null;
    try {
      const x = new URL(u, document.baseURI);
      return /^https?:$/.test(x.protocol) ? x.href : null;
    } catch (e) { return null; }
  }

  function parseSrcset(srcset) {
    if (!srcset) return [];
    const out = [];
    // split on commas that are followed by whitespace + url (URLs may contain commas)
    const parts = srcset.split(/,\s+(?=[^\s])/);
    for (const p of parts) {
      const m = p.trim().match(/^(\S+)(?:\s+([\d.]+)([wx]))?$/);
      if (!m) continue;
      const val = m[2] ? parseFloat(m[2]) : 1;
      out.push({ url: m[1], w: m[3] === 'w' ? val : 0, x: m[3] === 'x' ? val : (m[3] ? 0 : 1) });
    }
    return out;
  }

  function bestFromSrcset(srcset) {
    const list = parseSrcset(srcset);
    if (!list.length) return null;
    list.sort((a, b) => (b.w - a.w) || (b.x - a.x));
    return list[0].url;
  }

  function add(raw) {
    if (!raw || !raw.url) return;
    let kind = raw.kind;
    let url = raw.url;
    let fallback = raw.fallback || null;

    if (!url.startsWith('mpd:')) {
      url = abs(url);
      if (!url) return;
    }
    if (kind === 'video' || !kind) {
      const k = R.kindFromUrl(url, raw.mime);
      if (k === 'hls' || k === 'dash') kind = k;
      else if (!kind) kind = k;
    }
    if (!kind || kind === 'audio') return;
    if (BLOCK_VIDEO && kind !== 'image') return;

    if (kind === 'image' && !url.startsWith('data:')) {
      const up = R.upgrade(url);
      if (up) { url = up.url; fallback = fallback || up.fallback; }
    }
    let thumb = raw.thumb ? abs(raw.thumb) : null;
    if (thumb) { const up = R.upgrade(thumb); if (up) thumb = up.url; }

    const key = kind + '|' + url;
    if (sent.has(key)) return;
    sent.add(key);
    pending.push({
      kind, url, fallback,
      width: Number(raw.width) || 0,
      height: Number(raw.height) || 0,
      minWidth: Number(raw.minWidth) || 0,
      thumb, title: raw.title ? String(raw.title).slice(0, 120) : '',
      alt: raw.alt ? String(raw.alt).slice(0, 160) : '',
      source: raw.source || 'page',
      manifest: raw.manifest || null,
      hasAudio: raw.hasAudio,
      quality: raw.quality || '',
      note: raw.note || ''
    });
    if (!flushTimer) flushTimer = setTimeout(flush, 250);
  }

  let announced = false;
  function flush() {
    flushTimer = null;
    // The top page always says hello once (even with nothing found), so the
    // extension knows a new page was opened in this tab.
    if (!pending.length && (announced || !IS_TOP)) return;
    announced = true;
    const items = pending.splice(0, 400);
    try {
      chrome.runtime.sendMessage({
        type: 'media:add',
        items,
        page: IS_TOP ? { url: location.href, title: document.title } : null
      }).catch(() => {});
    } catch (e) { /* extension reloaded */ }
    if (pending.length) flushTimer = setTimeout(flush, 100);
  }

  // ---------- scanners ----------
  function scanImages(rootEl) {
    for (const img of rootEl.querySelectorAll('img')) {
      const nw = img.naturalWidth; const nh = img.naturalHeight;
      const lazy = img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src') ||
        img.getAttribute('data-full') || img.getAttribute('data-hi-res-src') || img.getAttribute('data-zoom-image') ||
        img.getAttribute('data-large_image') || img.getAttribute('data-large-file') || img.getAttribute('data-orig-file');
      const lazySet = img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset');
      const fromSet = bestFromSrcset(img.getAttribute('srcset')) || bestFromSrcset(lazySet);
      let url = fromSet || lazy || img.currentSrc || img.src;
      // Parent <picture> sources may offer larger files
      const pic = img.parentElement && img.parentElement.tagName === 'PICTURE' ? img.parentElement : null;
      if (pic) {
        for (const s of pic.querySelectorAll('source')) {
          const b = bestFromSrcset(s.getAttribute('srcset') || s.getAttribute('data-srcset'));
          if (b && !fromSet) url = b;
        }
      }
      if (!url) continue;
      // Skip tracking pixels / tiny icons (only when we know they are tiny)
      if (img.complete && nw && nh && nw < 40 && nh < 40 && !fromSet && !lazy) continue;
      add({ kind: 'image', url, width: url === (img.currentSrc || img.src) ? nw : 0, height: url === (img.currentSrc || img.src) ? nh : 0, minWidth: nw, alt: img.alt, title: img.title });
    }
  }

  function scanVideos(rootEl) {
    if (BLOCK_VIDEO) {
      for (const v of rootEl.querySelectorAll('video[poster]')) add({ kind: 'image', url: v.getAttribute('poster') });
      return;
    }
    for (const v of rootEl.querySelectorAll('video')) {
      const poster = v.getAttribute('poster');
      const sources = [v.currentSrc, v.getAttribute('src'), v.getAttribute('data-src')];
      for (const s of v.querySelectorAll('source')) sources.push(s.getAttribute('src') || s.getAttribute('data-src'));
      for (const s of sources) {
        if (s && !s.startsWith('blob:')) add({ kind: 'video', url: s, width: v.videoWidth, height: v.videoHeight, thumb: poster, title: v.title || document.title, mime: v.querySelector('source[type]') ? v.querySelector('source[type]').type : '' });
      }
      if (poster) add({ kind: 'image', url: poster, source: 'poster' });
    }
  }

  function scanLinks(rootEl) {
    for (const a of rootEl.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#')) continue;
      if (R.IMAGE_EXT.test(href)) add({ kind: 'image', url: href, source: 'link', title: a.title || a.textContent.trim().slice(0, 80) });
      else if (!BLOCK_VIDEO && R.VIDEO_EXT.test(href)) add({ kind: 'video', url: href, source: 'link', title: a.title || a.textContent.trim().slice(0, 80) });
      else if (!BLOCK_VIDEO && (R.HLS_EXT.test(href) || R.DASH_EXT.test(href))) add({ kind: 'video', url: href, source: 'link' });
    }
  }

  function scanBackgrounds() {
    const els = document.body ? document.body.getElementsByTagName('*') : [];
    const limit = Math.min(els.length, 6000);
    for (let i = 0; i < limit; i++) {
      const el = els[i];
      const inline = el.getAttribute('style');
      let bg = '';
      if (inline && inline.includes('url(')) bg = inline;
      else if (i < 3000) {
        const cs = getComputedStyle(el).backgroundImage;
        if (cs && cs !== 'none') bg = cs;
      }
      if (!bg) continue;
      const re = /url\((['"]?)(.*?)\1\)/g;
      let m;
      while ((m = re.exec(bg))) {
        const r = el.getBoundingClientRect();
        if (r.width < 60 && r.height < 60) continue;
        add({ kind: 'image', url: m[2], source: 'background', minWidth: Math.round(r.width) });
      }
    }
  }

  function scanMeta() {
    const pick = (sel) => Array.from(document.querySelectorAll(sel)).map((m) => m.getAttribute('content') || m.getAttribute('href'));
    for (const u of pick('meta[property="og:image"],meta[property="og:image:url"],meta[property="og:image:secure_url"],meta[name="twitter:image"],meta[name="twitter:image:src"],link[rel="image_src"]')) {
      add({ kind: 'image', url: u, source: 'meta', title: document.title });
    }
    if (!BLOCK_VIDEO) {
      for (const u of pick('meta[property="og:video"],meta[property="og:video:url"],meta[property="og:video:secure_url"],meta[name="twitter:player:stream"]')) {
        if (u && !/\.swf|\/embed\//.test(u)) add({ kind: 'video', url: u, source: 'meta', title: document.title });
      }
    }
  }

  function scanEmbeddedJson() {
    if (!X) return;
    const scripts = document.querySelectorAll('script[type="application/json"],script[type="application/ld+json"],script#__NEXT_DATA__,script#__UNIVERSAL_DATA_FOR_REHYDRATION__,script#SIGI_STATE');
    for (const s of scripts) {
      if (parsedScripts.has(s)) continue;
      parsedScripts.add(s);
      const text = s.textContent;
      if (!text || text.length > 8 * 1024 * 1024) continue;
      if (s.type !== 'application/ld+json' && !X.mightContainMedia(text)) continue;
      try {
        for (const data of X.parseLoose(text)) {
          for (const item of X.extract(data)) add({ ...item, source: 'site' });
        }
      } catch (e) { /* ignore */ }
    }
  }

  function fullScan() {
    lastScan = Date.now();
    try {
      if (!document.documentElement) return;
      scanImages(document);
      scanVideos(document);
      scanLinks(document);
      if (IS_TOP) scanMeta();
      scanEmbeddedJson();
      scanBackgrounds();
    } catch (e) { /* keep going */ }
    flush();
  }

  function scheduleScan() {
    if (scanTimer) return;
    const wait = Math.max(400, 1500 - (Date.now() - lastScan));
    scanTimer = setTimeout(() => { scanTimer = null; fullScan(); }, wait);
  }

  // ---------- auto-scroll (helps infinite feeds load more posts) ----------
  let scrolling = false;
  async function autoScroll(seconds) {
    if (scrolling || !IS_TOP) return;
    scrolling = true;
    const end = Date.now() + seconds * 1000;
    const startY = window.scrollY;
    try {
      while (Date.now() < end && scrolling) {
        window.scrollBy({ top: Math.round(window.innerHeight * 0.85), behavior: 'smooth' });
        await new Promise((r) => setTimeout(r, 700));
        scheduleScan();
      }
    } finally {
      scrolling = false;
      window.scrollTo({ top: startY, behavior: 'instant' in window ? 'instant' : 'auto' });
      fullScan();
    }
  }

  // ---------- wiring ----------
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__mediaHarbor !== 'media' || !Array.isArray(ev.data.items)) return;
    for (const item of ev.data.items.slice(0, 500)) {
      if (item && typeof item.url === 'string') add({ ...item, source: 'site' });
    }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'scan') {
      if (msg.reset) sent = new Set();
      fullScan();
      sendResponse({ ok: true });
    } else if (msg.type === 'autoscroll') {
      autoScroll(Math.min(Math.max(+msg.seconds || 10, 3), 60));
      sendResponse({ ok: true });
    } else if (msg.type === 'autoscroll:stop') {
      scrolling = false;
      sendResponse({ ok: true });
    }
  });

  const mo = new MutationObserver(scheduleScan);
  const start = () => {
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'poster', 'style'] });
    fullScan();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
  window.addEventListener('load', scheduleScan, { once: true });
  // Videos learn their size only after metadata loads
  document.addEventListener('loadedmetadata', (e) => {
    if (e.target && e.target.tagName === 'VIDEO') {
      const v = e.target; const s = v.currentSrc;
      if (s && !s.startsWith('blob:')) { sent.delete('video|' + abs(s)); add({ kind: 'video', url: s, width: v.videoWidth, height: v.videoHeight, thumb: v.poster }); }
    }
  }, true);
})();
