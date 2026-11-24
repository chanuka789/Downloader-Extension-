/*
 * MediaHarbor – service worker.
 *  - Keeps the list of media found in every tab
 *  - Watches network traffic for videos, HLS (.m3u8) and DASH (.mpd) streams
 *  - Starts downloads (direct files) and stream jobs (offscreen document + ffmpeg.wasm)
 */
importScripts('shared/rules.js');

const R = self.MHRules;
const MAX_ITEMS_PER_TAB = 2000;
const DEFAULT_SETTINGS = {
  folder: 'MediaHarbor',
  bySite: true,
  askWhere: false,
  theme: 'system',
  minSize: 0,
  hideSmall: true,
  view: 'grid'
};

/** tabId -> { page:{url,title}, items: Map<key,item>, seq:number } */
const tabs = new Map();
const ports = new Set();
const jobs = new Map();
const downloadMap = new Map(); // chrome downloadId -> { itemId, tabId, retry:boolean, item, blobUrl? }
const itemStatus = new Map(); // `${tabId}:${itemId}` -> status
let jobQueue = Promise.resolve();

// ------------------------------------------------------------------ utils
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }
async function getSettings() {
  const s = await chrome.storage.sync.get('settings').catch(() => ({}));
  return { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
}

// ------------------------------------------------------------------ tab store
function newTabState(url, docId) {
  return { page: { url: url || '', title: '' }, items: new Map(), seq: 0, docId: docId || null, oldDocs: [] };
}

// The service worker can be stopped by Chrome at any time, so the list is
// also kept in storage. Loading is "single flight": every caller waits for
// the same load, so nothing is added to a half-loaded list.
const loadingTabs = new Map();
function getTab(tabId) {
  const t = tabs.get(tabId);
  if (t) return Promise.resolve(t);
  if (loadingTabs.has(tabId)) return loadingTabs.get(tabId);
  const p = (async () => {
    const fresh = newTabState();
    try {
      const key = 'tab:' + tabId;
      const saved = (await chrome.storage.local.get(key))[key];
      if (saved && Array.isArray(saved.items)) {
        fresh.page = saved.page || fresh.page;
        fresh.docId = saved.docId || null;
        fresh.oldDocs = saved.oldDocs || [];
        for (const it of saved.items) { fresh.items.set(it.key, it); fresh.seq = Math.max(fresh.seq, it.order || 0); }
      }
    } catch (e) { /* ignore */ }
    if (!tabs.has(tabId)) tabs.set(tabId, fresh); // a reset may have happened meanwhile
    return tabs.get(tabId);
  })().finally(() => loadingTabs.delete(tabId));
  loadingTabs.set(tabId, p);
  return p;
}

const saveTimers = new Map();
function persist(tabId) {
  if (saveTimers.has(tabId)) return;
  saveTimers.set(tabId, setTimeout(async () => {
    saveTimers.delete(tabId);
    const t = tabs.get(tabId);
    if (!t) return;
    try { await chrome.storage.local.set({ ['tab:' + tabId]: { page: t.page, docId: t.docId, oldDocs: t.oldDocs.slice(-20), items: [...t.items.values()] } }); } catch (e) { /* ignore */ }
  }, 800));
}

/** Start a fresh list for a tab (new page). Returns the new state. */
function resetTab(tabId, url, docId) {
  const prev = tabs.get(tabId);
  const t = newTabState(url, docId);
  if (prev) t.oldDocs = [...prev.oldDocs, prev.docId].filter(Boolean).slice(-20);
  tabs.set(tabId, t);
  hlsVariantsSeen.delete(tabId);
  for (const k of [...itemStatus.keys()]) if (k.startsWith(tabId + ':')) itemStatus.delete(k);
  persist(tabId);
  updateBadge(tabId);
  broadcast(tabId, { type: 'reset', tabId, page: t.page });
  return t;
}

function mergeItem(old, inc) {
  const out = { ...old };
  const incArea = (inc.width || 0) * (inc.height || 0);
  const oldArea = (old.width || 0) * (old.height || 0);
  if (incArea > oldArea) { out.width = inc.width; out.height = inc.height; }
  for (const k of ['thumb', 'title', 'alt', 'size', 'mime', 'manifest', 'note', 'quality', 'fallback', 'variants', 'hasAudio', 'duration']) {
    if ((out[k] === undefined || out[k] === null || out[k] === '' || out[k] === 0) && inc[k] !== undefined && inc[k] !== null && inc[k] !== '') out[k] = inc[k];
  }
  // flags only switch on (a stream found to be protected stays protected)
  out.drm = !!(old.drm || inc.drm);
  out.live = !!(old.live || inc.live);
  if (inc.minWidth > (out.minWidth || 0)) out.minWidth = inc.minWidth;
  if (inc.source === 'site') out.source = 'site';
  return out;
}

/**
 * @param ctx {{docId?:string, top?:boolean}} which document sent the items.
 *   A new top-level document means the user opened a new page: start fresh.
 */
async function addItems(tabId, list, page, ctx) {
  if (tabId < 0 || !Array.isArray(list)) return [];
  let t = await getTab(tabId);
  if (ctx && ctx.docId) {
    if (t.oldDocs.includes(ctx.docId)) return []; // late message from a page that is gone
    if (ctx.top) {
      if (!t.docId) t.docId = ctx.docId;
      else if (t.docId !== ctx.docId) t = resetTab(tabId, page && page.url, ctx.docId);
    }
  }
  const changed = [];
  if (page && page.url && /^https?:/.test(page.url)) {
    t.page = { url: page.url, title: page.title || t.page.title };
    // items that arrived before we knew the page get their site now
    const host = hostOf(page.url);
    for (const it of t.items.values()) if (!it.site) { it.site = host; changed.push(it); }
  }
  const site = hostOf(t.page.url);
  for (const raw of list) {
    if (!raw || typeof raw.url !== 'string' || raw.url.length > 100000) continue;
    if (!['image', 'video', 'hls', 'dash'].includes(raw.kind)) continue;
    if (raw.url.startsWith('mpd:') && !raw.manifest) continue;
    if (!raw.url.startsWith('mpd:') && !/^(https?:|data:)/.test(raw.url)) continue;
    const key = raw.kind + '|' + raw.url;
    const existing = t.items.get(key);
    let item;
    if (existing) {
      item = mergeItem(existing, raw);
      if (JSON.stringify(item) === JSON.stringify(existing)) continue;
    } else {
      if (t.items.size >= MAX_ITEMS_PER_TAB) break;
      item = {
        key, id: hash(key), kind: raw.kind, url: raw.url,
        fallback: raw.fallback || null,
        width: +raw.width || 0, height: +raw.height || 0, minWidth: +raw.minWidth || 0,
        size: +raw.size || 0, mime: raw.mime || '',
        thumb: raw.thumb || null, title: raw.title || '', alt: raw.alt || '',
        source: raw.source || 'page', manifest: raw.manifest || null,
        hasAudio: raw.hasAudio, quality: raw.quality || '', note: raw.note || '',
        variants: raw.variants || null, drm: !!raw.drm, live: !!raw.live,
        site, order: ++t.seq
      };
    }
    t.items.set(key, item);
    if (!changed.includes(item)) changed.push(item);
  }
  if (changed.length) {
    persist(tabId);
    updateBadge(tabId);
    broadcast(tabId, { type: 'delta', tabId, items: changed, page: t.page });
  }
  return changed;
}

function removeItemsByUrl(tabId, kind, urls) {
  const t = tabs.get(tabId);
  if (!t) return;
  const removed = [];
  for (const u of urls) {
    const key = kind + '|' + u;
    const it = t.items.get(key);
    if (it) { t.items.delete(key); removed.push(it.id); }
  }
  if (removed.length) {
    persist(tabId); updateBadge(tabId);
    broadcast(tabId, { type: 'remove', tabId, ids: removed });
  }
}

function updateBadge(tabId) {
  const t = tabs.get(tabId);
  let n = 0;
  if (t) for (const it of t.items.values()) if (it.kind !== 'image' || (it.width >= 200 || it.minWidth >= 200 || it.source === 'site' || !it.width)) n++;
  const text = n ? (n > 999 ? '999+' : String(n)) : '';
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: '#5b5bf0' }).catch(() => {});
  chrome.action.setBadgeTextColor && chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' }).catch(() => {});
}

function broadcast(tabId, msg) {
  for (const p of ports) {
    if (p._tabId === tabId || msg.type === 'jobs') {
      try { p.postMessage(msg); } catch (e) { ports.delete(p); }
    }
  }
}
function broadcastJobs() {
  const list = [...jobs.values()].slice(-40).map(({ item, ...j }) => j);
  for (const p of ports) { try { p.postMessage({ type: 'jobs', jobs: list.filter((j) => j.tabId === p._tabId || p._allJobs) }); } catch (e) { ports.delete(p); } }
}
function setItemStatus(tabId, itemId, status) {
  itemStatus.set(tabId + ':' + itemId, status);
  broadcast(tabId, { type: 'status', tabId, id: itemId, status });
}

// ------------------------------------------------------------------ network sniffing
const SEGMENT_RE = /\.(ts|m4s|m4f|m4v_\d+|aac|cmfv|cmfa|vtt|webvtt|key)(?=$|[?#])|\/seg-?\d+|segment\d+|fragment\d+|\/chunk[-_]?\d+/i;

function headerValue(headers, name) {
  if (!headers) return '';
  const h = headers.find((x) => x.name.toLowerCase() === name);
  return h ? h.value || '' : '';
}

chrome.webRequest.onHeadersReceived.addListener((d) => {
  if (d.tabId < 0) return;
  if (d.initiator && d.initiator.startsWith('chrome-extension://')) return;
  if (d.statusCode && d.statusCode >= 400) return;
  const url = d.url;
  if (!/^https?:/.test(url)) return;
  const host = hostOf(url);
  if (R.isBlockedVideoHost(host)) return;
  if (d.initiator && R.isBlockedVideoHost(hostOf(d.initiator))) return;

  const mime = headerValue(d.responseHeaders, 'content-type').split(';')[0].trim().toLowerCase();
  let kind = R.kindFromUrl(url, mime);
  if (!kind || kind === 'audio') return;
  if (mime === 'video/mp2t' || mime === 'video/iso.segment' || SEGMENT_RE.test(new URL(url).pathname)) { if (kind !== 'hls' && kind !== 'dash') return; }
  // Facebook / Instagram stream fragments: we use the page data instead.
  if (/fbcdn\.net|cdninstagram\.com/.test(host) && kind === 'video') return;

  let size = +headerValue(d.responseHeaders, 'content-length') || 0;
  const range = headerValue(d.responseHeaders, 'content-range');
  if (range) { const m = /\/(\d+)\s*$/.exec(range); if (m) size = +m[1]; else return; }

  if (kind === 'image') {
    if (size && size < 60 * 1024) return; // only big network images (DOM scan finds the rest)
    if (!size) return;
  }
  if (kind === 'video' && size && size < 150 * 1024 && !range) return; // tiny clips / ads pixels

  if (d.documentLifecycle === 'prerender') return;
  // a playlist's own size says nothing about the video, so only keep it for files
  const item = { kind, url, mime, size: kind === 'hls' || kind === 'dash' ? 0 : size, source: 'network' };
  const ctx = { docId: d.documentId, top: d.frameId === 0 };
  getTab(d.tabId).then((t) => {
    if (t.page.url && R.isBlockedVideoHost(hostOf(t.page.url)) && kind !== 'image') return;
    addItems(d.tabId, [item], null, ctx).then((added) => {
      if (!added.length) return;
      if (kind === 'hls') inspectHls(d.tabId, url, ctx.docId);
      if (kind === 'dash') inspectDash(d.tabId, url, ctx.docId);
    });
  });
}, { urls: ['<all_urls>'], types: ['media', 'xmlhttprequest', 'other', 'object', 'image'] }, ['responseHeaders']);

chrome.tabs.onRemoved.addListener((tabId) => {
  tabs.delete(tabId);
  chrome.storage.local.remove('tab:' + tabId).catch(() => {});
});

// ---- stream inspection (quality, DRM, live, master vs variant) ----
const hlsVariantsSeen = new Map(); // tabId -> Set(url)

function parseAttrs(s) {
  const out = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2].replace(/^"|"$/g, '');
  return out;
}

async function inspectHls(tabId, url, docId) {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return;
    const text = await res.text();
    if (!text.startsWith('#EXTM3U')) return;
    const info = { kind: 'hls', url };
    if (text.includes('#EXT-X-STREAM-INF')) {
      const lines = text.split(/\r?\n/);
      const variants = [];
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('#EXT-X-STREAM-INF:')) {
          const a = parseAttrs(lines[i].slice(18));
          let j = i + 1; while (j < lines.length && (!lines[j] || lines[j].startsWith('#'))) j++;
          if (lines[j]) {
            const [w, h] = (a.RESOLUTION || '0x0').split('x').map(Number);
            variants.push({ url: new URL(lines[j].trim(), url).href, width: w, height: h, bandwidth: +a.BANDWIDTH || 0 });
          }
        }
      }
      variants.sort((a, b) => (b.width * b.height - a.width * a.height) || (b.bandwidth - a.bandwidth));
      if (variants[0]) { info.width = variants[0].width; info.height = variants[0].height; }
      info.variants = variants.length;
      info.note = variants.length > 1 ? `Best of ${variants.length} qualities` : '';
      const seen = hlsVariantsSeen.get(tabId) || new Set();
      variants.forEach((v) => seen.add(v.url));
      hlsVariantsSeen.set(tabId, seen);
      removeItemsByUrl(tabId, 'hls', variants.map((v) => v.url));
    } else {
      const seen = hlsVariantsSeen.get(tabId);
      if (seen && seen.has(url)) { removeItemsByUrl(tabId, 'hls', [url]); return; }
      let dur = 0;
      for (const m of text.matchAll(/#EXTINF:([\d.]+)/g)) dur += parseFloat(m[1]);
      info.duration = Math.round(dur);
      if (!text.includes('#EXT-X-ENDLIST')) info.live = true;
    }
    if (/#EXT-X-(SESSION-)?KEY:[^\n]*METHOD=SAMPLE-AES|KEYFORMAT="(?!identity)/i.test(text)) info.drm = true;
    await addItems(tabId, [info], null, { docId });
  } catch (e) { /* ignore */ }
}

async function inspectDash(tabId, url, docId) {
  try {
    const res = await fetch(url, { credentials: 'include' });
    if (!res.ok) return;
    const xml = await res.text();
    if (!/<MPD[\s>]/.test(xml)) return;
    let h = 0; let w = 0;
    for (const m of xml.matchAll(/<Representation\b[^>]*>/g)) {
      const hh = +((/\bheight="(\d+)"/.exec(m[0]) || [])[1] || 0);
      if (hh > h) { h = hh; w = +((/\bwidth="(\d+)"/.exec(m[0]) || [])[1] || 0); }
    }
    const info = { kind: 'dash', url, width: w, height: h };
    if (/<ContentProtection\b/i.test(xml)) info.drm = true;
    if (/type="dynamic"/.test(xml)) info.live = true;
    await addItems(tabId, [info], null, { docId });
  } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------------ filenames
const MIME_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/ogg': 'ogv', 'video/x-matroska': 'mkv' };

function sanitize(name) {
  let s = String(name || '').replace(/[\u0000-\u001f\u007f<>:"/\\|?*~#%&{}$!'@+`=]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\.+|\.+$/g, '').slice(0, 80).trim();
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = '_' + s;
  return s;
}

function buildFilename(item, settings, pageTitle, pageUrl) {
  let base = '';
  let ext = '';
  if (item.url.startsWith('data:')) {
    const m = /^data:([^;,]+)/.exec(item.url);
    ext = (m && MIME_EXT[m[1]]) || 'png';
  } else if (!item.url.startsWith('mpd:')) {
    try {
      const u = new URL(item.url);
      const last = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
      const m = /^(.*?)\.([a-z0-9]{2,5})$/i.exec(last);
      if (m) { base = m[1]; ext = m[2].toLowerCase(); } else base = last;
      if (u.hostname === 'pbs.twimg.com') ext = u.searchParams.get('format') || ext;
    } catch (e) { /* ignore */ }
  }
  if (item.kind === 'hls' || item.kind === 'dash') ext = 'mp4';
  if (!ext || ext.length > 5 || ['php', 'aspx', 'asp', 'jsp', 'cgi', 'html', 'htm', 'm3u8', 'mpd'].includes(ext)) ext = MIME_EXT[item.mime] || (item.kind === 'image' ? 'jpg' : 'mp4');
  if (ext === 'jpeg' || ext === 'jfif') ext = 'jpg';
  if (item.title) base = item.title;
  else if (!base || base.length < 3 || item.kind === 'hls' || item.kind === 'dash' || /^(index|master|playlist|manifest|chunklist|stream|main|video|image|media|default|source)([-_ ]?\w{0,6})$/i.test(base)) {
    base = pageTitle || item.site || 'media';
    if (item.kind !== 'image') base += item.height ? ` ${Math.min(item.width || item.height, item.height)}p` : ' video';
  }
  base = sanitize(base) || 'media';
  const parts = [];
  const folder = sanitize(settings.folder || 'MediaHarbor');
  if (folder) parts.push(folder);
  const site = item.site || (pageUrl ? hostOf(pageUrl) : '');
  if (settings.bySite && site) parts.push(sanitize(site.replace(/^www\./, '')) || 'site');
  parts.push(`${base}.${ext}`);
  return parts.join('/');
}

// ------------------------------------------------------------------ offscreen + DNR referer
let creatingOffscreen = null;
async function ensureOffscreen() {
  const url = chrome.runtime.getURL('offscreen/offscreen.html');
  if (chrome.runtime.getContexts) {
    const ctx = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [url] });
    if (ctx.length) return;
  }
  if (creatingOffscreen) return creatingOffscreen;
  creatingOffscreen = chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['BLOBS', 'WORKERS'],
    justification: 'Download stream segments and join video + audio with ffmpeg.wasm into one file.'
  }).catch((e) => { if (!String(e).includes('Only a single offscreen')) throw e; })
    .finally(() => { creatingOffscreen = null; });
  return creatingOffscreen;
}

let ruleSeq = 1000;
async function addRefererRule(pageUrl, hosts) {
  if (!pageUrl || !/^https?:/.test(pageUrl)) return null;
  const id = ++ruleSeq;
  const origin = new URL(pageUrl).origin;
  const rule = {
    id, priority: 1,
    action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: pageUrl }, { header: 'Origin', operation: 'set', value: origin }] },
    condition: { tabIds: [chrome.tabs.TAB_ID_NONE], resourceTypes: ['xmlhttprequest', 'media', 'other'] }
  };
  const list = [...new Set((hosts || []).filter(Boolean))];
  if (list.length) rule.condition.requestDomains = list;
  try { await chrome.declarativeNetRequest.updateSessionRules({ addRules: [rule] }); return id; } catch (e) { return null; }
}
async function removeRule(id) {
  if (id) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }).catch(() => {});
}

// ------------------------------------------------------------------ downloads
async function startDownloads(tabId, ids) {
  const t = await getTab(tabId);
  const settings = await getSettings();
  const byId = new Map([...t.items.values()].map((i) => [i.id, i]));
  const results = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) continue;
    if (item.drm) { setItemStatus(tabId, id, 'error'); results.push({ id, error: 'drm' }); continue; }
    if (item.kind === 'hls' || item.kind === 'dash') { queueStreamJob(tabId, item, settings, t.page); results.push({ id, job: true }); continue; }
    const filename = buildFilename(item, settings, t.page.title, t.page.url);
    try {
      setItemStatus(tabId, id, 'downloading');
      const downloadId = await chrome.downloads.download({ url: item.url, filename, conflictAction: 'uniquify', saveAs: !!settings.askWhere && ids.length === 1 });
      downloadMap.set(downloadId, { itemId: id, tabId, item, filename, page: t.page, retried: false });
      results.push({ id, downloadId });
    } catch (e) {
      // Fallback: fetch with page referer in the offscreen document
      retryViaOffscreen(tabId, item, filename, t.page);
      results.push({ id, retry: true });
    }
    if (ids.length > 6) await new Promise((r) => setTimeout(r, 120)); // be gentle with servers
  }
  return results;
}

async function retryViaOffscreen(tabId, item, filename, page) {
  const url = item.url;
  const job = newJob(tabId, item, filename, 'direct');
  job.stage = 'Retrying download…';
  broadcastJobs();
  jobQueue = jobQueue.then(() => runJob(job, { mode: 'direct', url, fallback: item.fallback, page }));
}

chrome.downloads.onChanged.addListener(async (delta) => {
  const rec = downloadMap.get(delta.id);
  if (!rec) return;
  if (delta.state && delta.state.current === 'complete') {
    setItemStatus(rec.tabId, rec.itemId, 'done');
    if (rec.blobUrl) sendOffscreen({ type: 'revoke', url: rec.blobUrl });
    if (rec.jobId) finishJob(rec.jobId, 'done');
    downloadMap.delete(delta.id);
  } else if (delta.state && delta.state.current === 'interrupted') {
    const err = (delta.error && delta.error.current) || '';
    downloadMap.delete(delta.id);
    if (rec.blobUrl) sendOffscreen({ type: 'revoke', url: rec.blobUrl });
    if (err === 'USER_CANCELED') { setItemStatus(rec.tabId, rec.itemId, ''); if (rec.jobId) finishJob(rec.jobId, 'canceled'); return; }
    if (!rec.retried && !rec.jobId) {
      retryViaOffscreen(rec.tabId, rec.item, rec.filename, rec.page);
    } else {
      setItemStatus(rec.tabId, rec.itemId, 'error');
      if (rec.jobId) finishJob(rec.jobId, 'error', 'Download failed: ' + err);
    }
  }
});

// ------------------------------------------------------------------ jobs
function newJob(tabId, item, filename, mode) {
  const id = 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const job = { id, tabId, itemId: item.id, title: filename.split('/').pop(), kind: item.kind, mode, status: 'queued', progress: 0, stage: 'Waiting…', error: '', item, filename };
  jobs.set(id, job);
  setItemStatus(tabId, item.id, 'queued');
  return job;
}

function queueStreamJob(tabId, item, settings, page) {
  const filename = buildFilename(item, settings, page.title, page.url);
  const job = newJob(tabId, item, filename, item.kind);
  broadcastJobs();
  jobQueue = jobQueue.then(() => runJob(job, { mode: item.kind, url: item.url, manifest: item.manifest, page }));
}

async function runJob(job, spec) {
  if (job.status === 'canceled') return;
  job.status = 'running'; job.stage = 'Starting…';
  setItemStatus(job.tabId, job.itemId, 'downloading');
  broadcastJobs();
  let ruleId = null;
  try {
    await ensureOffscreen();
    const hosts = [hostOf(spec.url), hostOf(spec.page && spec.page.url)].filter(Boolean);
    ruleId = await addRefererRule(spec.page && spec.page.url, spec.mode === 'direct' ? hosts : []);
    job.ruleId = ruleId;
    const result = await new Promise((resolve) => {
      job._resolve = resolve;
      sendOffscreen({ type: 'job:start', job: { id: job.id, mode: spec.mode, url: spec.url, fallback: spec.fallback, manifest: spec.manifest, pageUrl: spec.page && spec.page.url, filename: job.filename } });
    });
    if (result.error) throw new Error(result.error);
    for (const f of result.files) {
      const filename = f.suffix ? job.filename.replace(/\.(\w+)$/, `${f.suffix}.${f.ext}`) : job.filename.replace(/\.(\w+)$/, '.' + f.ext);
      job.stage = 'Saving…';
      broadcastJobs();
      const downloadId = await chrome.downloads.download({ url: f.blobUrl, filename, conflictAction: 'uniquify' });
      downloadMap.set(downloadId, { itemId: job.itemId, tabId: job.tabId, item: job.item, filename, blobUrl: f.blobUrl, jobId: f.last ? job.id : null, retried: true });
    }
    job.progress = 1;
    job.warning = result.warning || '';
    job.stage = result.warning ? result.warning : 'Saving…';
    broadcastJobs();
  } catch (e) {
    finishJob(job.id, job.status === 'canceled' ? 'canceled' : 'error', friendlyError(e));
  } finally {
    await removeRule(ruleId);
  }
}

function friendlyError(e) {
  const s = String((e && e.message) || e || 'Unknown error');
  if (/drm|encrypted|SAMPLE-AES/i.test(s)) return 'This video is protected (DRM) and cannot be downloaded.';
  if (/live/i.test(s)) return 'Live streams cannot be saved. Try again when the stream has ended.';
  if (/403|401|forbidden/i.test(s)) return 'The website refused the download (link expired or login needed). Reload the page and try again.';
  if (/memory|allocation|RangeError/i.test(s)) return 'The video is too large to process in the browser.';
  return s.slice(0, 200);
}

function finishJob(jobId, status, error) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
  job.error = error || '';
  if (status === 'done') { job.progress = 1; job.stage = job.warning || 'Saved'; }
  if (status === 'error') job.stage = 'Failed';
  if (status === 'canceled') job.stage = 'Canceled';
  setItemStatus(job.tabId, job.itemId, status === 'done' ? 'done' : status === 'error' ? 'error' : '');
  if (job._resolve) { job._resolve({ error: error || status }); job._resolve = null; }
  broadcastJobs();
}

function sendOffscreen(msg) {
  return chrome.runtime.sendMessage({ target: 'offscreen', ...msg }).catch(() => {});
}

// ------------------------------------------------------------------ messages
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg !== 'object' || msg.target === 'offscreen') return;
  if (sender.id !== chrome.runtime.id) return;

  // From content scripts
  if (msg.type === 'media:add' && sender.tab) {
    if (sender.documentLifecycle === 'prerender') return;
    const top = sender.frameId === 0;
    addItems(sender.tab.id, msg.items, top ? msg.page : null, { docId: sender.documentId, top });
    return;
  }

  // From the Instagram buttons: save exactly these items
  if (msg.type === 'ig:download' && sender.tab && Array.isArray(msg.items)) {
    (async () => {
      const tabId = sender.tab.id;
      const raw = msg.items.slice(0, 500).filter((i) => i && typeof i.url === 'string' && ['image', 'video', 'dash'].includes(i.kind))
        .map((i) => ({ kind: i.kind, url: i.url, width: i.width, height: i.height, thumb: i.thumb, manifest: i.manifest || null, title: String(i.title || '').slice(0, 120), source: 'site' }));
      await addItems(tabId, raw, sender.frameId === 0 ? { url: sender.tab.url, title: sender.tab.title } : null, { docId: sender.documentId, top: sender.frameId === 0 });
      const t = await getTab(tabId);
      const ids = [];
      for (const r of raw) {
        const it = t.items.get(r.kind + '|' + r.url);
        if (!it) continue;
        if (r.title) it.title = r.title; // name like user_POSTCODE_2
        ids.push(it.id);
      }
      const results = await startDownloads(tabId, ids);
      sendResponse({ ok: ids.length > 0, count: ids.length, results });
    })();
    return true;
  }

  // From offscreen document
  if (msg.type === 'job:progress') {
    const job = jobs.get(msg.jobId);
    if (job && job.status === 'running') {
      job.progress = msg.progress; job.stage = msg.stage || job.stage;
      broadcastJobs();
    }
    return;
  }
  if (msg.type === 'job:result') {
    const job = jobs.get(msg.jobId);
    if (job && job._resolve) { job._resolve(msg); job._resolve = null; }
    return;
  }
  if (msg.type === 'job:hosts') {
    // offscreen learned the CDN hosts of a stream: widen the referer rule to them
    const job = jobs.get(msg.jobId);
    if (job && job.ruleId && job.item) {
      (async () => {
        const t = await getTab(job.tabId);
        await removeRule(job.ruleId);
        job.ruleId = await addRefererRule(t.page.url, msg.hosts);
        sendResponse({ ok: true });
      })();
      return true;
    }
    sendResponse({ ok: false });
    return;
  }

  // From UI pages
  if (msg.type === 'download') {
    startDownloads(msg.tabId, msg.ids || []).then((r) => sendResponse({ ok: true, results: r }));
    return true;
  }
  if (msg.type === 'scan') {
    scanTab(msg.tabId, !!msg.reset).then((r) => sendResponse(r));
    return true;
  }
  if (msg.type === 'autoscroll') {
    chrome.tabs.sendMessage(msg.tabId, { type: msg.stop ? 'autoscroll:stop' : 'autoscroll', seconds: msg.seconds }, { frameId: 0 })
      .then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg.type === 'job:cancel') {
    const job = jobs.get(msg.jobId);
    if (job) {
      if (job.status === 'running') sendOffscreen({ type: 'job:cancel', jobId: job.id });
      finishJob(job.id, 'canceled');
    }
    sendResponse({ ok: true });
    return;
  }
  if (msg.type === 'jobs:clear') {
    for (const [id, j] of jobs) if (j.status !== 'running' && j.status !== 'queued') jobs.delete(id);
    broadcastJobs();
    sendResponse({ ok: true });
    return;
  }
});

async function scanTab(tabId, reset) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'scan', reset });
    return { ok: true };
  } catch (e) {
    // Content script missing (page opened before install) – inject it now.
    try {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['shared/rules.js', 'shared/extract.js', 'content/detector.js'] });
      return { ok: true, injected: true };
    } catch (err) {
      return { ok: false, error: 'This page cannot be scanned (browser pages and the Chrome Web Store are protected).' };
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ui' || (port.sender && port.sender.id !== chrome.runtime.id)) return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener(async (msg) => {
    if (msg.type === 'subscribe') {
      port._tabId = msg.tabId;
      const t = await getTab(msg.tabId);
      let tab = null;
      try { tab = await chrome.tabs.get(msg.tabId); } catch (e) { /* closed */ }
      if (tab && !t.page.url) t.page = { url: tab.url || '', title: tab.title || '' };
      if (tab && tab.title) t.page.title = tab.title;
      const statuses = {};
      for (const [k, v] of itemStatus) if (k.startsWith(msg.tabId + ':')) statuses[k.split(':')[1]] = v;
      try {
        port.postMessage({ type: 'full', tabId: msg.tabId, items: [...t.items.values()], page: t.page, statuses, tabExists: !!tab, favicon: tab && tab.favIconUrl });
      } catch (e) { /* closed */ }
      broadcastJobs();
    }
  });
});

// ------------------------------------------------------------------ context menu & install
chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'mh-save', title: 'Save in best quality (MediaHarbor)', contexts: ['image', 'video'] });
    chrome.contextMenus.create({ id: 'mh-open', title: 'Find all images & videos on this page', contexts: ['page', 'frame', 'link'] });
  });
  // clear old per-tab data
  const all = await chrome.storage.local.get(null).catch(() => ({}));
  const keys = Object.keys(all).filter((k) => k.startsWith('tab:'));
  if (keys.length) chrome.storage.local.remove(keys).catch(() => {});
  // inject into already-open tabs so the user does not have to reload
  const open = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] }).catch(() => []);
  for (const tab of open) {
    chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['shared/rules.js', 'shared/extract.js', 'content/detector.js'] }).catch(() => {});
    if (/^https:\/\/(www\.)?instagram\.com\//.test(tab.url || '')) {
      chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['shared/extract.js', 'content/instagram.js'] }).catch(() => {});
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const all = await chrome.storage.local.get(null).catch(() => ({}));
  const keys = Object.keys(all).filter((k) => k.startsWith('tab:'));
  if (keys.length) chrome.storage.local.remove(keys).catch(() => {});
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab) return;
  if (info.menuItemId === 'mh-open') {
    chrome.tabs.create({ url: chrome.runtime.getURL(`ui/manager.html?tab=${tab.id}`), index: tab.index + 1 });
    return;
  }
  if (info.menuItemId === 'mh-save') {
    const src = info.srcUrl;
    if (!src || src.startsWith('blob:')) {
      // MSE videos have blob: sources – open the manager to pick the detected stream
      chrome.tabs.create({ url: chrome.runtime.getURL(`ui/manager.html?tab=${tab.id}&filter=video`), index: tab.index + 1 });
      return;
    }
    const kind = info.mediaType === 'video' ? (R.kindFromUrl(src) === 'hls' ? 'hls' : 'video') : 'image';
    if (kind !== 'image' && R.isBlockedVideoHost(hostOf(tab.url))) return;
    const up = kind === 'image' ? R.upgrade(src, info.pageUrl) : { url: src, fallback: null };
    const [added] = (await addItems(tab.id, [{ kind, url: up.url, fallback: up.fallback, source: 'page' }])) || [];
    const t = await getTab(tab.id);
    const item = added || t.items.get(kind + '|' + up.url);
    if (item) startDownloads(tab.id, [item.id]);
  }
});
