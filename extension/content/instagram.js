/*
 * MediaHarbor – download buttons on Instagram.
 * Adds a download button to every post, carousel slide, reel, story and grid
 * tile (feed, explore / search, profiles, hashtags, post pages, reels, stories),
 * plus a selection bar for bulk downloads.
 *
 * Media comes in full quality from the data Instagram loads (sent by
 * page-hook.js and found in embedded JSON). If a post is not known yet, its
 * data is requested from Instagram's web API with the user's own session.
 * The buttons live in a separate overlay (shadow DOM), so Instagram's page
 * code and styles are not touched.
 */
(function () {
  'use strict';
  if (window.__mhInstagram || window !== window.top) return;
  window.__mhInstagram = true;

  const X = globalThis.__mediaHarborExtract;
  if (!X) return;

  const APP_ID = '936619743392459'; // public ID of Instagram's web app
  const CODE_RE = /\/(?:[\w.]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/;
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  const byCode = new Map();
  const byPk = new Map();
  const byFile = new Map(); // image / cover file name -> { post, index }
  const fetching = new Map();
  const parsedScripts = new WeakSet();
  const selected = new Map(); // key -> { code, pk }
  const groups = new Map(); // element -> group UI
  let targets = [];
  let enabled = true;
  let selectMode = false;
  let busy = false;

  // ------------------------------------------------------------------ data
  function addPosts(list) {
    let changed = false;
    for (const p of list || []) {
      if (!p || !Array.isArray(p.media) || !p.media.length) continue;
      const old = (p.code && byCode.get(p.code)) || (p.pk && byPk.get(p.pk));
      let post = p;
      if (old) {
        post = old.media.length >= p.media.length ? { ...old } : { ...p };
        post.code = old.code || p.code; post.pk = old.pk || p.pk; post.user = old.user || p.user;
        // a later copy may know a better video (DASH) for the same slide
        if (old.media.length === p.media.length) {
          post.media = old.media.map((m, i) => (((p.media[i].height || 0) > (m.height || 0)) ? p.media[i] : m));
        }
      }
      if (post.code) byCode.set(post.code, post);
      if (post.pk) byPk.set(post.pk, post);
      post.media.forEach((m, index) => {
        if (m.file) byFile.set(m.file, { post, index });
        if (m.thumbFile) byFile.set(m.thumbFile, { post, index });
      });
      changed = true;
    }
    if (changed) scheduleScan();
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.__mediaHarbor !== 'posts' || !Array.isArray(ev.data.posts)) return;
    addPosts(ev.data.posts.slice(0, 300));
  });

  function scanScripts() {
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      if (parsedScripts.has(s)) continue;
      parsedScripts.add(s);
      const text = s.textContent;
      if (!text || text.length > 8 * 1024 * 1024 || !X.mightContainMedia(text)) continue;
      try { for (const d of X.parseLoose(text)) addPosts(X.extractPosts(d)); } catch (e) { /* ignore */ }
    }
  }

  function codeToPk(code) {
    try {
      let id = 0n;
      for (const ch of code.slice(0, 11)) {
        const i = ALPHA.indexOf(ch);
        if (i < 0) return '';
        id = id * 64n + BigInt(i);
      }
      return id.toString();
    } catch (e) { return ''; }
  }

  /** Ask Instagram for a post we have not seen yet (uses the user's session). */
  function fetchPost(code, pk) {
    pk = pk || (code ? codeToPk(code) : '');
    if (!pk) return Promise.resolve(null);
    const key = code || pk;
    if (fetching.has(key)) return fetching.get(key);
    const p = (async () => {
      const res = await fetch(`/api/v1/media/${pk}/info/`, {
        credentials: 'include',
        headers: { 'X-IG-App-ID': APP_ID, 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      addPosts(X.extractPosts(await res.json()));
      return (code && byCode.get(code)) || byPk.get(pk) || null;
    })().catch(() => null).finally(() => setTimeout(() => fetching.delete(key), 30000));
    fetching.set(key, p);
    return p;
  }

  // ------------------------------------------------------------------ finding posts in the page
  function rectOf(el) { return el.getBoundingClientRect(); }
  function bigMedia(root, min) {
    let best = null; let bestArea = 0;
    const rr = root === document.body ? { left: 0, top: 0, right: innerWidth, bottom: innerHeight } : rectOf(root);
    for (const m of root.querySelectorAll('img, video')) {
      const r = rectOf(m);
      if (r.width < min || r.height < min) continue;
      // visible part only (carousels keep the other slides next to the visible one)
      const w = Math.max(0, Math.min(r.right, innerWidth, rr.right) - Math.max(r.left, 0, rr.left));
      const h = Math.max(0, Math.min(r.bottom, innerHeight, rr.bottom) - Math.max(r.top, 0, rr.top));
      const a = w * h || (r.width * r.height) / 1e6;
      if (a > bestArea) { bestArea = a; best = m; }
    }
    return best;
  }
  function codeFromLinks(root) {
    for (const a of root.querySelectorAll('a[href]')) {
      const m = CODE_RE.exec(a.getAttribute('href') || '');
      if (m && !/^(audio|explore)$/.test(m[1])) return m[1];
    }
    return '';
  }
  function codeFromLocation() {
    const m = CODE_RE.exec(location.pathname);
    return m ? m[1] : '';
  }

  function findTargets() {
    const out = [];
    const used = new Set();
    const path = location.pathname;

    // Stories: one big image / video in the story viewer
    const story = /^\/stories\/(?!highlights\/)[^/]+\/(\d+)/.exec(path);
    if (/^\/stories\//.test(path)) {
      const media = bigMedia(document.body, 180);
      if (media) out.push({ type: 'story', el: media, box: media, code: '', pk: story ? story[1] : '' });
      return out;
    }

    // Posts in feeds, post pages and post pop-ups
    for (const art of document.querySelectorAll('article')) {
      const media = bigMedia(art, 150);
      if (!media) continue;
      const code = codeFromLinks(art) || (art.closest('[role="dialog"]') || document.querySelectorAll('article').length === 1 ? codeFromLocation() : '');
      out.push({ type: 'post', el: art, box: media, code, pk: '' });
      used.add(art);
    }

    // Reels viewer and post pages without <article>
    for (const v of document.querySelectorAll('video')) {
      if ([...used].some((a) => a.contains(v))) continue;
      const r = rectOf(v);
      if (r.width < 150 || r.height < 150) continue;
      let code = '';
      let node = v.parentElement;
      for (let i = 0; i < 8 && node && !code; i++, node = node.parentElement) code = codeFromLinks(node);
      if (!code) {
        const mid = innerHeight / 2;
        if (r.top <= mid && r.bottom >= mid) code = codeFromLocation();
      }
      out.push({ type: 'reel', el: v, box: v, code, pk: '' });
    }
    if (!out.length && codeFromLocation()) {
      const main = document.querySelector('main') || document.body;
      const media = bigMedia(main, 200);
      if (media) out.push({ type: 'post', el: media, box: media, code: codeFromLocation(), pk: '' });
    }

    // Grid tiles: profile, explore, search, hashtag, saved, tagged
    for (const a of document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]')) {
      const m = CODE_RE.exec(a.getAttribute('href') || '');
      if (!m) continue;
      if ([...used].some((x) => x.contains(a))) continue;
      const img = a.querySelector('img') || a.querySelector('video');
      if (!img) continue;
      const r = rectOf(a);
      if (r.width < 80 || r.height < 80) continue;
      out.push({ type: 'tile', el: a, box: a, code: m[1], pk: '' });
    }
    return out;
  }

  // ------------------------------------------------------------------ which media is meant
  function domFallbackMedia(el) {
    const media = el.tagName === 'IMG' || el.tagName === 'VIDEO' ? el : bigMedia(el, 100);
    if (!media) return null;
    if (media.tagName === 'IMG') {
      let url = media.currentSrc || media.src;
      const set = media.getAttribute('srcset');
      if (set) {
        const best = set.split(/,\s+/).map((p) => p.trim().split(/\s+/)).map(([u, w]) => ({ u, w: parseFloat(w) || 0 })).sort((a, b) => b.w - a.w)[0];
        if (best && best.u) url = best.u;
      }
      return /^https?:/.test(url) ? { kind: 'image', url, width: media.naturalWidth, height: media.naturalHeight } : null;
    }
    const src = media.currentSrc || media.src;
    return /^https?:/.test(src) ? { kind: 'video', url: src, width: media.videoWidth, height: media.videoHeight } : null;
  }

  function postForTarget(t) {
    if (t.code && byCode.has(t.code)) return byCode.get(t.code);
    if (t.pk && byPk.has(t.pk)) return byPk.get(t.pk);
    const hit = byFile.get(fileOfElement(t.box));
    // never use another post's data for a button that knows its own post
    if (!hit || (t.code && hit.post.code && hit.post.code !== t.code) || (t.pk && hit.post.pk && hit.post.pk !== t.pk)) return null;
    return hit.post;
  }

  function fileOfElement(el) {
    if (!el) return '';
    if (el.tagName === 'IMG') return X.fileKey(el.currentSrc || el.src || '');
    if (el.tagName === 'VIDEO') return el.poster ? X.fileKey(el.poster) : '';
    const inner = el.querySelector && el.querySelector('img');
    return inner ? X.fileKey(inner.currentSrc || inner.src || '') : '';
  }

  /** Index of the carousel slide that is visible now. */
  function currentIndex(t, post) {
    if (post.media.length < 2) return 0;
    const media = t.type === 'post' ? bigMedia(t.el, 150) : t.box;
    const f = fileOfElement(media);
    if (f) {
      const i = post.media.findIndex((m) => m.file === f || m.thumbFile === f);
      if (i >= 0) return i;
    }
    // Instagram places slides with translateX(index * width)
    const li = media && media.closest('li');
    if (li) {
      const tx = /translateX\((-?[\d.]+)px\)/.exec(li.style.transform || '');
      const w = li.getBoundingClientRect().width;
      if (tx && w) return Math.max(0, Math.min(post.media.length - 1, Math.round(parseFloat(tx[1]) / w)));
      const lis = [...li.parentElement.children].filter((x) => x.querySelector('img,video'));
      const i = lis.indexOf(li);
      if (i >= 0) return Math.min(i, post.media.length - 1);
    }
    if (media && media.tagName === 'VIDEO') {
      const vids = post.media.map((m, i) => [m, i]).filter(([m]) => m.kind !== 'image');
      if (vids.length === 1) return vids[0][1];
    }
    return 0;
  }

  async function resolve(t) {
    let post = postForTarget(t);
    if (!post && (t.code || t.pk)) post = await fetchPost(t.code, t.pk);
    return post;
  }

  function itemsFor(post, indexes) {
    const name = [post.user, post.code || post.pk].filter(Boolean).join('_') || 'instagram';
    return indexes.map((i) => {
      const m = post.media[i];
      if (!m) return null;
      return {
        kind: m.kind, url: m.url, width: m.width, height: m.height, thumb: m.thumb,
        manifest: m.manifest || null, alt: m.alt,
        title: post.media.length > 1 ? `${name}_${i + 1}` : name
      };
    }).filter(Boolean);
  }

  async function send(items) {
    if (!items.length) return { ok: false };
    try {
      return await chrome.runtime.sendMessage({ type: 'ig:download', items });
    } catch (e) {
      return { ok: false, error: 'MediaHarbor was updated. Please reload the page.' };
    }
  }

  // ------------------------------------------------------------------ actions
  async function downloadTarget(t, all, btn) {
    setBusy(btn, true);
    try {
      const post = await resolve(t);
      let items;
      if (post) {
        const idx = all ? post.media.map((_, i) => i) : [currentIndex(t, post)];
        items = itemsFor(post, idx);
      } else {
        const m = domFallbackMedia(t.box);
        if (!m) { toast('This video is not ready yet. Play it for a second, then try again.'); return; }
        items = [{ ...m, title: ['instagram', t.code || t.pk].filter(Boolean).join('_') }];
      }
      const res = await send(items);
      if (res && res.ok) {
        markDone(btn);
        const streams = items.filter((i) => i.kind === 'dash').length;
        toast(streams ? `Saving ${items.length} file${items.length > 1 ? 's' : ''} in best quality (video is being prepared)…` : `Saving ${items.length} file${items.length > 1 ? 's' : ''}`);
      } else toast((res && res.error) || 'Could not start the download.');
    } finally { setBusy(btn, false); }
  }

  async function downloadSelected() {
    if (busy || !selected.size) return;
    busy = true;
    const list = [...selected.values()];
    let items = []; let missing = 0; let done = 0;
    for (const s of list) {
      bar.status.textContent = `Preparing ${++done} of ${list.length}…`;
      const known = (s.code && byCode.get(s.code)) || (s.pk && byPk.get(s.pk));
      const post = known || await fetchPost(s.code, s.pk);
      if (!known) await new Promise((r) => setTimeout(r, 350)); // be gentle with Instagram
      if (post) items = items.concat(itemsFor(post, post.media.map((_, i) => i)));
      else missing++;
    }
    const res = await send(items);
    busy = false;
    if (res && res.ok) {
      toast(`Saving ${items.length} file${items.length === 1 ? '' : 's'} from ${list.length - missing} post${list.length - missing === 1 ? '' : 's'}` + (missing ? ` · ${missing} could not be loaded` : ''));
      selected.clear();
      setSelectMode(false);
    } else toast(missing === list.length ? 'Could not load these posts. Scroll to them or open them, then try again.' : 'Could not start the download.');
    updateBar();
  }

  // ------------------------------------------------------------------ overlay UI
  const host = document.createElement('mediaharbor-overlay');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000;display:block;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; }
    .g { position: fixed; display: flex; gap: 6px; align-items: center; pointer-events: none; transition: opacity .15s; }
    .g > * { pointer-events: auto; }
    .b { height: 34px; min-width: 34px; padding: 0 12px; border: 0; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
         background: rgba(14, 14, 28, .72); color: #fff; font-size: 13px; font-weight: 600; cursor: pointer; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
         box-shadow: 0 2px 10px rgba(0,0,0,.3); transition: background .15s, transform .1s; white-space: nowrap; line-height: 1; }
    .b:hover { background: #5048e5; }
    .b:active { transform: scale(.96); }
    .b:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    .b.round { padding: 0; width: 34px; }
    .b.done { background: #138a4b; }
    .b svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; flex: none; }
    .b.busy svg { animation: spin 0.9s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .ck { width: 30px; height: 30px; border-radius: 9px; border: 2px solid #fff; background: rgba(14,14,28,.45); display: grid; place-items: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.3); padding: 0; }
    .ck.on { background: #5048e5; border-color: #5048e5; }
    .ck svg { width: 16px; height: 16px; stroke: #fff; fill: none; stroke-width: 3; opacity: 0; }
    .ck.on svg { opacity: 1; }
    .bar { position: fixed; right: 16px; bottom: 16px; display: flex; align-items: center; gap: 8px; padding: 8px; border-radius: 18px; pointer-events: auto;
           background: #fff; color: #15162c; box-shadow: 0 12px 36px rgba(10,10,40,.28), 0 2px 6px rgba(10,10,40,.12); max-width: calc(100vw - 32px); flex-wrap: wrap; }
    .bar .logo { width: 34px; height: 34px; border-radius: 11px; display: grid; place-items: center; background: linear-gradient(135deg,#6366f1,#8b5cf6 55%,#d946ef); color: #fff; flex: none; }
    .bar .logo svg { width: 18px; height: 18px; stroke: #fff; fill: none; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
    .bar button { height: 36px; border-radius: 11px; border: 1px solid #e1e4ef; background: #fff; color: #15162c; padding: 0 12px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap; }
    .bar button:hover { background: #f1f2f8; }
    .bar button.primary { background: #5048e5; border-color: #5048e5; color: #fff; }
    .bar button.primary:hover { background: #3f37d1; }
    .bar button:disabled { opacity: .5; cursor: not-allowed; }
    .bar .status { font-size: 13px; color: #5d6079; padding: 0 4px; white-space: nowrap; }
    .toast { position: fixed; left: 50%; top: 20px; transform: translate(-50%, -10px); background: #1a1b2e; color: #fff; padding: 10px 16px; border-radius: 12px; font-size: 13px;
             box-shadow: 0 12px 36px rgba(0,0,0,.35); opacity: 0; transition: all .2s; pointer-events: none; max-width: calc(100vw - 32px); text-align: center; }
    .toast.show { opacity: 1; transform: translate(-50%, 0); }
    @media (prefers-color-scheme: dark) {
      .bar { background: #151724; color: #eceef8; }
      .bar button { background: #1c1f30; color: #eceef8; border-color: #2a2d42; }
      .bar button:hover { background: #262a3f; }
      .bar .status { color: #a2a5bf; }
    }
    @media (max-width: 600px) { .bar { left: 12px; right: 12px; bottom: 64px; justify-content: space-between; } .b { height: 36px; } }
  </style><div id="layer"></div><div class="toast" id="toast" role="status"></div>`;
  const layer = shadow.getElementById('layer');
  const toastEl = shadow.getElementById('toast');

  const ICON = {
    dl: '<svg viewBox="0 0 24 24"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5 10 17 19 7"/></svg>',
    spin: '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.2-8.6"/></svg>',
    stack: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="13" height="13" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/></svg>'
  };

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => toastEl.classList.remove('show'), 3200);
  }
  function setBusy(btn, on) {
    if (!btn) return;
    btn.classList.toggle('busy', on);
    if (on) { btn.dataset.html = btn.innerHTML; btn.innerHTML = ICON.spin + (btn.classList.contains('round') ? '' : '<span>Saving…</span>'); btn.disabled = true; }
    else { btn.disabled = false; if (btn.dataset.html && !btn.classList.contains('done')) btn.innerHTML = btn.dataset.html; }
  }
  function markDone(btn) {
    if (!btn) return;
    const html = btn.dataset.html;
    btn.classList.add('done');
    btn.innerHTML = ICON.check + (btn.classList.contains('round') ? '' : '<span>Saved</span>');
    setTimeout(() => { btn.classList.remove('done'); if (html) btn.innerHTML = html; }, 2500);
  }

  // selection bar
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.innerHTML = `<span class="logo" title="MediaHarbor">${ICON.dl}</span>
    <button id="sel">Select</button>
    <span class="status" id="st"></span>
    <button id="all" hidden>Select all</button>
    <button id="cancel" hidden>Cancel</button>
    <button id="go" class="primary" hidden>Download</button>`;
  shadow.appendChild(bar);
  bar.status = bar.querySelector('#st');
  bar.querySelector('#sel').onclick = () => setSelectMode(true);
  bar.querySelector('#cancel').onclick = () => { selected.clear(); setSelectMode(false); };
  bar.querySelector('#all').onclick = () => {
    for (const t of targets) if (t.type === 'tile' || t.type === 'post' || t.type === 'reel') { const k = t.code || t.pk; if (k) selected.set(k, { code: t.code, pk: t.pk }); }
    updateBar(); rebuildAll();
  };
  bar.querySelector('#go').onclick = downloadSelected;

  function setSelectMode(on) {
    selectMode = on;
    updateBar();
    rebuildAll();
  }
  function updateBar() {
    const n = selected.size;
    bar.querySelector('#sel').hidden = selectMode;
    bar.querySelector('#all').hidden = !selectMode;
    bar.querySelector('#cancel').hidden = !selectMode;
    const go = bar.querySelector('#go');
    go.hidden = !selectMode;
    go.disabled = !n || busy;
    go.textContent = n ? `Download ${n}` : 'Download';
    if (!busy) bar.status.textContent = selectMode ? (n ? `${n} selected` : 'Tick the posts you want') : '';
  }

  function keyOf(t) { return t.code || t.pk || ''; }

  function buildGroup(t) {
    const g = document.createElement('div');
    g.className = 'g';
    const post = postForTarget(t);
    const multi = post && post.media.length > 1;
    const key = keyOf(t);
    if (selectMode && key && t.type !== 'story') {
      const ck = document.createElement('button');
      ck.className = 'ck' + (selected.has(key) ? ' on' : '');
      ck.setAttribute('aria-label', 'Select for download');
      ck.innerHTML = ICON.check;
      ck.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (selected.has(key)) selected.delete(key); else selected.set(key, { code: t.code, pk: t.pk });
        ck.classList.toggle('on', selected.has(key));
        updateBar();
      };
      g.appendChild(ck);
    }
    if (t.type === 'tile') {
      const b = document.createElement('button');
      b.className = 'b round';
      b.title = multi ? `Download all ${post.media.length}` : 'Download in best quality';
      b.setAttribute('aria-label', b.title);
      b.innerHTML = multi ? ICON.stack : ICON.dl;
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); downloadTarget(t, true, b); };
      g.appendChild(b);
    } else {
      const b = document.createElement('button');
      b.className = 'b';
      b.title = multi ? 'Download this photo / video' : 'Download in best quality';
      b.setAttribute('aria-label', b.title);
      b.innerHTML = `${ICON.dl}<span>${multi ? 'This' : 'Download'}</span>`;
      b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); downloadTarget(t, false, b); };
      g.appendChild(b);
      if (multi) {
        const all = document.createElement('button');
        all.className = 'b';
        all.title = `Download all ${post.media.length} photos / videos`;
        all.setAttribute('aria-label', all.title);
        all.innerHTML = `${ICON.stack}<span>All ${post.media.length}</span>`;
        all.onclick = (e) => { e.preventDefault(); e.stopPropagation(); downloadTarget(t, true, all); };
        g.appendChild(all);
      }
    }
    g._sig = `${selectMode}|${multi ? post.media.length : 1}|${key}`;
    return g;
  }

  function signature(t) {
    const post = postForTarget(t);
    return `${selectMode}|${post && post.media.length > 1 ? post.media.length : 1}|${keyOf(t)}`;
  }

  function rebuildAll() {
    for (const [, g] of groups) g.remove();
    groups.clear();
    position();
  }

  // Is the target really visible (not under a pop-up or another layer)?
  function onTop(t, r) {
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    const hit = document.elementFromPoint(x, y);
    if (!hit) return false;
    if (t.el.contains(hit) || hit.contains(t.el) || t.box.contains(hit)) return true;
    // Instagram covers media with transparent layers: accept a hit inside a
    // close ancestor of the media that is not much bigger than the media.
    const max = r.width * r.height * 2.5;
    let a = t.box.parentElement;
    for (let i = 0; i < 6 && a; i++, a = a.parentElement) {
      const ar = a.getBoundingClientRect();
      if (ar.width * ar.height > max) break;
      if (a.contains(hit)) return true;
    }
    return false;
  }

  let posQueued = false;
  function position() {
    if (posQueued) return;
    posQueued = true;
    requestAnimationFrame(() => {
      posQueued = false;
      const seen = new Set();
      if (enabled) {
        for (const t of targets) {
          if (!t.el.isConnected) continue;
          const r = rectOf(t.box);
          if (r.bottom < 40 || r.top > innerHeight - 40 || r.right < 0 || r.left > innerWidth || r.width < 60) continue;
          if (!onTop(t, r)) continue;
          let g = groups.get(t.el);
          if (g && g._sig !== signature(t)) { g.remove(); g = null; }
          if (!g) { g = buildGroup(t); groups.set(t.el, g); layer.appendChild(g); }
          g._t = t;
          seen.add(t.el);
          const inset = t.type === 'tile' ? 8 : 12;
          const top = t.type === 'story' ? Math.min(r.bottom - 60, innerHeight - 140) : Math.max(r.top + inset, 8);
          const gw = g.offsetWidth || 120;
          g.style.top = `${Math.round(top)}px`;
          g.style.left = `${Math.round(Math.min(r.right - inset - gw, innerWidth - gw - 8))}px`;
        }
      }
      for (const [el, g] of groups) if (!seen.has(el)) { g.remove(); groups.delete(el); }
      bar.style.display = enabled && targets.some((t) => t.type !== 'story') ? '' : 'none';
    });
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scanScripts();
      targets = enabled ? findTargets() : [];
      position();
    }, 250);
  }

  // ------------------------------------------------------------------ start
  function start() {
    document.documentElement.appendChild(host);
    new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset', 'style', 'href'] });
    addEventListener('scroll', position, { passive: true, capture: true });
    addEventListener('resize', () => { scheduleScan(); position(); }, { passive: true });
    let lastPath = location.pathname;
    setInterval(() => {
      if (location.pathname !== lastPath) { lastPath = location.pathname; rebuildAll(); }
      scheduleScan();
    }, 1000);
    updateBar();
    scheduleScan();
  }

  chrome.storage.sync.get('settings').then((s) => {
    enabled = !(s && s.settings && s.settings.igButtons === false);
    start();
  }).catch(start);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
      enabled = !(changes.settings.newValue && changes.settings.newValue.igButtons === false);
      rebuildAll(); scheduleScan();
    }
  });
})();
