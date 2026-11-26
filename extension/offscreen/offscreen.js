/*
 * MediaHarbor – offscreen worker.
 * Builds one playable file from streaming video:
 *   HLS  (.m3u8): best variant + separate audio, AES-128 decryption, byte ranges, fMP4/TS
 *   DASH (.mpd) : best video + best audio (SegmentTemplate/Timeline/List/Base)
 * and joins video + audio with ffmpeg.wasm (stream copy, no quality loss).
 * Also used as a fallback for direct downloads that need the page's Referer.
 */
import '../shared/download-tools.js';
const D = globalThis.MHDownloadTools;
import { FFmpeg } from '../vendor/ffmpeg/index.js';

const CONCURRENCY = 6;
const RETRIES = 3;
const running = new Map(); // jobId -> AbortController
let ffmpeg = null;
let ffmpegLoading = null;

// ------------------------------------------------------------------ messaging
chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || msg.target !== 'offscreen') return;
  if (msg.type === 'metadata') { const url = URL.createObjectURL(new Blob([JSON.stringify(msg.data, null, 2)], { type: 'application/json' })); respond({ url }); return; }
  if (msg.type === 'job:start') runJob(msg.job);
  else if (msg.type === 'job:cancel') {
    const c = running.get(msg.jobId);
    if (c) c.abort();
  } else if (msg.type === 'revoke') {
    setTimeout(() => { try { URL.revokeObjectURL(msg.url); } catch (e) { /* ignore */ } }, 5000);
  }
});

function send(msg) { return chrome.runtime.sendMessage(msg).catch(() => {}); }

function progressReporter(jobId) {
  let last = 0;
  return (progress, stage, force) => {
    const now = Date.now();
    if (!force && now - last < 250) return;
    last = now;
    send({ type: 'job:progress', jobId, progress: Math.max(0, Math.min(1, progress)), stage });
  };
}

async function runJob(job) {
  const ctrl = new AbortController();
  running.set(job.id, ctrl);
  const report = progressReporter(job.id);
  try {
    let result;
    if (job.mode === 'hls') result = await doHls(job, ctrl.signal, report);
    else if (job.mode === 'dash') result = await doDash(job, ctrl.signal, report);
    else if (job.mode === 'zip') result = await doZip(job, ctrl.signal, report);
    else result = await doDirect(job, ctrl.signal, report);
    send({ type: 'job:result', jobId: job.id, files: result.files, warning: result.warning || '' });
  } catch (e) {
    const msg = ctrl.signal.aborted ? 'canceled' : String((e && e.message) || e);
    send({ type: 'job:result', jobId: job.id, error: msg });
  } finally {
    running.delete(job.id);
  }
}

// ------------------------------------------------------------------ network helpers
async function fetchBytes(url, { signal, range, onProgress } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (signal && signal.aborted) throw new Error('canceled');
    try {
      const headers = {};
      if (range) headers.Range = `bytes=${range.start}-${range.end}`;
      const res = await fetch(url, { credentials: 'include', headers, signal, cache: 'no-store' });
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}`);
        err.status = res.status;
        if (res.status === 403 || res.status === 401 || res.status === 404 || res.status === 410) {
          // retry once with no cookies (some CDNs reject credentialed requests)
          if (attempt === 0) {
            const r2 = await fetch(url, { credentials: 'omit', headers, signal, cache: 'no-store' }).catch(() => null);
            if (r2 && r2.ok) return { bytes: new Uint8Array(await r2.arrayBuffer()), type: r2.headers.get('content-type') || '' };
          }
          throw err;
        }
        throw err;
      }
      const type = res.headers.get('content-type') || '';
      if (!onProgress || !res.body) return { bytes: new Uint8Array(await res.arrayBuffer()), type };
      const total = +res.headers.get('content-length') || 0;
      const reader = res.body.getReader();
      const chunks = []; let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.length;
        onProgress(got, total);
      }
      return { bytes: concat(chunks, got), type };
    } catch (e) {
      lastErr = e;
      if ((signal && signal.aborted) || (e.status && e.status < 500 && e.status !== 429)) throw e;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw lastErr;
}

async function fetchText(url, signal) {
  const { bytes } = await fetchBytes(url, { signal });
  return new TextDecoder().decode(bytes);
}

function concat(chunks, total) {
  if (total === undefined) total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function pool(items, worker, signal) {
  const results = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      if (signal.aborted) throw new Error('canceled');
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }
async function allowHosts(jobId, urls) {
  const hosts = [...new Set(urls.map(hostOf).filter(Boolean))];
  if (hosts.length) await send({ type: 'job:hosts', jobId, hosts });
}

// ------------------------------------------------------------------ ffmpeg
async function getFFmpeg() {
  if (ffmpeg) return ffmpeg;
  if (!ffmpegLoading) {
    ffmpegLoading = (async () => {
      const f = new FFmpeg();
      await f.load({
        coreURL: chrome.runtime.getURL('vendor/ffmpeg-core/ffmpeg-core.js'),
        wasmURL: chrome.runtime.getURL('vendor/ffmpeg-core/ffmpeg-core.wasm')
      });
      ffmpeg = f;
      return f;
    })().finally(() => { ffmpegLoading = null; });
  }
  return ffmpegLoading;
}

/**
 * Join / remux with stream copy. Returns Uint8Array or null when ffmpeg fails.
 * inputs: [{ name, data }]
 */
async function mux(inputs, outExt, report) {
  let f;
  try { f = await getFFmpeg(); } catch (e) { console.warn('ffmpeg load failed', e); return null; }
  const out = 'out.' + outExt;
  const onProg = ({ progress }) => report(0.9 + 0.09 * Math.max(0, Math.min(1, progress || 0)), 'Joining video and audio…');
  f.on('progress', onProg);
  try {
    for (const i of inputs) await f.writeFile(i.name, i.data);
    const args = [];
    for (const i of inputs) args.push('-i', i.name);
    if (inputs.length > 1) args.push('-map', '0:v:0?', '-map', '1:a:0?');
    else args.push('-map', '0:v?', '-map', '0:a?');
    args.push('-c', 'copy');
    if (outExt === 'mp4') args.push('-movflags', '+faststart');
    args.push('-y', out);
    const code = await f.exec(args);
    if (code !== 0) return null;
    const data = await f.readFile(out);
    return data && data.length > 1024 ? data : null;
  } catch (e) {
    console.warn('ffmpeg failed', e);
    return null;
  } finally {
    f.off('progress', onProg);
    for (const name of [...inputs.map((i) => i.name), out]) { try { await f.deleteFile(name); } catch (e) { /* ignore */ } }
  }
}

function fileResult(parts) {
  return parts.map((p, i) => ({
    blobUrl: URL.createObjectURL(new Blob([p.data], { type: p.mime })),
    ext: p.ext, suffix: p.suffix || '', last: i === parts.length - 1
  }));
}

/** Join video (+ audio). Falls back to separate files if ffmpeg cannot join. */
async function finish(video, audio, report) {
  report(0.9, 'Joining video and audio…', true);
  const inputs = [{ name: 'video.' + video.ext, data: video.data }];
  if (audio) inputs.push({ name: 'audio.' + audio.ext, data: audio.data });
  const prefer = /webm/.test(video.ext) && (!audio || /webm/.test(audio.ext)) ? ['webm', 'mkv'] : ['mp4', 'mkv'];
  for (const ext of prefer) {
    const out = await mux(inputs, ext, report);
    if (out) {
      report(1, 'Done', true);
      return { files: fileResult([{ data: out, ext, mime: ext === 'mp4' ? 'video/mp4' : ext === 'webm' ? 'video/webm' : 'video/x-matroska' }]) };
    }
  }
  // ffmpeg failed: give the raw files so nothing is lost
  const parts = [{ data: video.data, ext: video.ext === 'ts' ? 'ts' : video.ext, mime: 'video/' + (video.ext === 'ts' ? 'mp2t' : video.ext), suffix: audio ? '_video' : '' }];
  if (audio) parts.push({ data: audio.data, ext: audio.ext === 'mp4' ? 'm4a' : audio.ext, mime: 'audio/mp4', suffix: '_audio' });
  return { files: fileResult(parts), warning: audio ? 'Saved video and audio as two files (could not join them).' : '' };
}

// ------------------------------------------------------------------ direct
async function doDirect(job, signal, report) {
  const urls = [job.url, job.fallback].filter(Boolean);
  let lastErr;
  for (const url of urls) {
    try {
      const { bytes, type } = await fetchBytes(url, {
        signal,
        onProgress: (got, total) => report(total ? got / total : 0.5, total ? `Downloading ${fmtBytes(got)} of ${fmtBytes(total)}` : `Downloading ${fmtBytes(got)}`)
      });
      const mime = type.split(';')[0].trim() || 'application/octet-stream';
      const ext = extFromMime(mime) || (job.filename.match(/\.(\w+)$/) || [])[1] || 'bin';
      report(1, 'Done', true);
      return { files: fileResult([{ data: bytes, ext, mime }]) };
    } catch (e) { lastErr = e; if (signal.aborted) throw e; }
  }
  throw lastErr || new Error('Download failed');
}

function extFromMime(m) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg', 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' })[m] || '';
}
function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
}

// ------------------------------------------------------------------ HLS
function parseAttrs(s) {
  const out = {};
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2].replace(/^"|"$/g, '');
  return out;
}

function parseMaster(text, base) {
  const lines = text.split(/\r?\n/);
  const variants = []; const audio = {};
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (l.startsWith('#EXT-X-STREAM-INF:')) {
      const a = parseAttrs(l.slice(18));
      let j = i + 1; while (j < lines.length && (!lines[j].trim() || lines[j].startsWith('#'))) j++;
      if (j < lines.length) {
        const [w, h] = (a.RESOLUTION || '0x0').split('x').map(Number);
        variants.push({ url: new URL(lines[j].trim(), base).href, width: w || 0, height: h || 0, bandwidth: +a.BANDWIDTH || +a['AVERAGE-BANDWIDTH'] || 0, audio: a.AUDIO, codecs: a.CODECS || '' });
      }
    } else if (l.startsWith('#EXT-X-MEDIA:')) {
      const a = parseAttrs(l.slice(13));
      if (a.TYPE === 'AUDIO' && a.URI) {
        (audio[a['GROUP-ID']] = audio[a['GROUP-ID']] || []).push({ url: new URL(a.URI, base).href, def: a.DEFAULT === 'YES', name: a.NAME || '', lang: a.LANGUAGE || '' });
      }
    } else if (/^#EXT-X-SESSION-KEY:.*(SAMPLE-AES|KEYFORMAT="(?!identity))/.test(l)) {
      throw new Error('DRM protected');
    }
  }
  return { variants, audio };
}

function parseMedia(text, base) {
  const lines = text.split(/\r?\n/);
  const segs = [];
  let key = null; let map = null; let seq = 0; let nextRange = null; let lastEnd = 0; let dur = 0; let pendingDur = 0;
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    if (l.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = parseInt(l.slice(22), 10) || 0;
    else if (l.startsWith('#EXT-X-KEY:')) {
      const a = parseAttrs(l.slice(11));
      if (a.METHOD === 'NONE') key = null;
      else if (a.METHOD === 'AES-128' && (!a.KEYFORMAT || a.KEYFORMAT === 'identity')) key = { uri: new URL(a.URI, base).href, iv: a.IV || null };
      else throw new Error('DRM protected (encrypted with ' + a.METHOD + ')');
    } else if (l.startsWith('#EXT-X-MAP:')) {
      const a = parseAttrs(l.slice(11));
      map = { url: new URL(a.URI, base).href, range: a.BYTERANGE ? parseRange(a.BYTERANGE, 0) : null };
    } else if (l.startsWith('#EXT-X-BYTERANGE:')) {
      nextRange = parseRange(l.slice(17), lastEnd);
    } else if (l.startsWith('#EXTINF:')) {
      pendingDur = parseFloat(l.slice(8)) || 0;
    } else if (!l.startsWith('#')) {
      const seg = { url: new URL(l, base).href, key, seq: seq++, range: nextRange, duration: pendingDur };
      dur += pendingDur; pendingDur = 0;
      if (nextRange) lastEnd = nextRange.end + 1;
      nextRange = null;
      segs.push(seg);
    }
  }
  return { segs, map, ended: /#EXT-X-ENDLIST/.test(text), duration: dur };
}

function parseRange(s, prevEnd) {
  const [len, off] = s.split('@').map((x) => parseInt(x, 10));
  const start = isNaN(off) ? prevEnd : off;
  return { start, end: start + len - 1 };
}

const keyCache = new Map();
async function decryptSeg(data, seg, signal) {
  if (!seg.key) return data;
  let k = keyCache.get(seg.key.uri);
  if (!k) {
    const { bytes } = await fetchBytes(seg.key.uri, { signal });
    if (bytes.length !== 16) throw new Error('Invalid AES-128 key (DRM?)');
    k = await crypto.subtle.importKey('raw', bytes, 'AES-CBC', false, ['decrypt']);
    keyCache.set(seg.key.uri, k);
  }
  let iv;
  if (seg.key.iv) {
    const hex = seg.key.iv.replace(/^0x/i, '').padStart(32, '0');
    iv = new Uint8Array(16);
    for (let i = 0; i < 16; i++) iv[i] = parseInt(hex.substr(i * 2, 2), 16);
  } else {
    iv = new Uint8Array(16);
    new DataView(iv.buffer).setUint32(12, seg.seq);
  }
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, k, data));
}

async function downloadHlsTrack(url, signal, label, onProg) {
  const text = await fetchText(url, signal);
  const pl = parseMedia(text, url);
  if (!pl.ended) throw new Error('This is a live stream');
  if (!pl.segs.length) throw new Error('Empty playlist');
  let done = 0;
  const chunks = await pool(pl.segs, async (seg) => {
    const { bytes } = await fetchBytes(seg.url, { signal, range: seg.range });
    const out = await decryptSeg(bytes, seg, signal);
    done++;
    onProg(done, pl.segs.length);
    return out;
  }, signal);
  let init = null;
  if (pl.map) init = (await fetchBytes(pl.map.url, { signal, range: pl.map.range })).bytes;
  const data = concat(init ? [init, ...chunks] : chunks);
  const first = (init || chunks[0]).subarray(0, 12);
  const box = String.fromCharCode(...first.subarray(4, 8));
  let ext = 'ts';
  if (init || ['ftyp', 'styp', 'moof', 'sidx'].includes(box)) ext = 'mp4';
  else if (first[0] === 0xff && (first[1] & 0xf0) === 0xf0) ext = 'aac';
  else if (first[0] === 0x49 && first[1] === 0x44 && first[2] === 0x33 && /\.aac/i.test(pl.segs[0].url)) ext = 'aac';
  return { data, ext, duration: pl.duration, segs: pl.segs.length, label };
}

async function doHls(job, signal, report) {
  report(0.01, 'Reading stream…', true);
  const text = await fetchText(job.url, signal);
  if (!text.startsWith('#EXTM3U')) throw new Error('Not a valid HLS playlist');
  let videoUrl = job.url; let audioUrl = null;
  if (text.includes('#EXT-X-STREAM-INF')) {
    const { variants, audio } = parseMaster(text, job.url);
    if (!variants.length) throw new Error('No video qualities found');
    variants.sort((a, b) => (b.width * b.height - a.width * a.height) || (b.bandwidth - a.bandwidth));
    const best = D.choose(variants, job.quality);
    videoUrl = best.url;
    if (best.audio && audio[best.audio] && audio[best.audio].length) {
      const g = audio[best.audio];
      audioUrl = (g.find((a) => a.def) || g[0]).url;
    }
    report(0.02, `Best quality: ${best.height ? best.height + 'p' : Math.round(best.bandwidth / 1000) + ' kbps'}`, true);
  }
  await allowHosts(job.id, [job.url, videoUrl, audioUrl].filter(Boolean));
  const state = { v: [0, 1], a: [0, audioUrl ? 1 : 0] };
  const upd = () => {
    const total = state.v[1] + state.a[1];
    const done = state.v[0] + state.a[0];
    report(0.03 + 0.86 * (done / Math.max(total, 1)), `Downloading parts ${done} of ${total}`);
  };
  const [video, audioTrack] = await Promise.all([
    downloadHlsTrack(videoUrl, signal, 'video', (d, t) => { state.v = [d, t]; upd(); }),
    audioUrl ? downloadHlsTrack(audioUrl, signal, 'audio', (d, t) => { state.a = [d, t]; upd(); }) : Promise.resolve(null)
  ]);
  return finish(video, audioTrack, report);
}

// ------------------------------------------------------------------ DASH
function isoDuration(s) {
  if (!s) return 0;
  const m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s.trim());
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

function childrenByName(el, name) { return Array.from(el.children).filter((c) => c.localName === name); }
function firstChild(el, name) { return childrenByName(el, name)[0] || null; }

function resolveBase(el, base) {
  const b = firstChild(el, 'BaseURL');
  return b && b.textContent.trim() ? new URL(b.textContent.trim(), base).href : base;
}

function fillTemplate(t, vars) {
  return t.replace(/\$\$/g, '\u0000').replace(/\$(RepresentationID|Number|Time|Bandwidth)(?:%0(\d+)d)?\$/g, (_, name, pad) => {
    let v = String(vars[name] !== undefined ? vars[name] : '');
    if (pad) v = v.padStart(+pad, '0');
    return v;
  }).replace(/\u0000/g, '$');
}

function segmentsFor(rep, as, period, mpdBase, periodDur) {
  const asBase = resolveBase(as, resolveBase(period, mpdBase));
  const base = resolveBase(rep, asBase);
  // SegmentTemplate attributes inherit: Representation > AdaptationSet > Period
  const tpls = [firstChild(rep, 'SegmentTemplate'), firstChild(as, 'SegmentTemplate'), firstChild(period, 'SegmentTemplate')].filter(Boolean);
  const list = firstChild(rep, 'SegmentList') || firstChild(as, 'SegmentList');
  const vars = { RepresentationID: rep.getAttribute('id') || '', Bandwidth: rep.getAttribute('bandwidth') || '' };
  const out = { init: null, segs: [] };

  if (tpls.length) {
    const attr = (n) => { for (const t of tpls) { const v = t.getAttribute(n); if (v !== null) return v; } return null; };
    const media = attr('media'); const initT = attr('initialization');
    if (!media) throw new Error('Unsupported DASH manifest (no media template)');
    const timescale = +attr('timescale') || 1;
    const startNumber = attr('startNumber') !== null ? +attr('startNumber') : 1;
    if (initT) out.init = { url: new URL(fillTemplate(initT, vars), base).href };
    let timeline = null;
    for (const t of tpls) { timeline = firstChild(t, 'SegmentTimeline'); if (timeline) break; }
    if (timeline) {
      let time = 0; let num = startNumber;
      const S = childrenByName(timeline, 'S');
      S.forEach((s, idx) => {
        if (s.getAttribute('t') !== null) time = +s.getAttribute('t');
        const d = +s.getAttribute('d');
        let r = +(s.getAttribute('r') || 0);
        if (r < 0) {
          const next = S[idx + 1] && S[idx + 1].getAttribute('t');
          const end = next !== undefined && next !== null ? +next : periodDur * timescale;
          r = Math.max(0, Math.ceil((end - time) / d) - 1);
        }
        for (let i = 0; i <= r; i++) {
          out.segs.push({ url: new URL(fillTemplate(media, { ...vars, Number: num, Time: time }), base).href });
          time += d; num++;
        }
      });
    } else {
      const d = +attr('duration');
      if (!d || !periodDur) throw new Error('Unsupported DASH manifest (unknown length)');
      const count = Math.ceil((periodDur * timescale) / d);
      for (let i = 0; i < count; i++) out.segs.push({ url: new URL(fillTemplate(media, { ...vars, Number: startNumber + i, Time: i * d }), base).href });
    }
    return out;
  }
  if (list) {
    const init = firstChild(list, 'Initialization');
    if (init) out.init = { url: new URL(init.getAttribute('sourceURL') || '', base).href, range: rangeAttr(init.getAttribute('range')) };
    for (const s of childrenByName(list, 'SegmentURL')) {
      out.segs.push({ url: new URL(s.getAttribute('media') || '', base).href, range: rangeAttr(s.getAttribute('mediaRange')) });
    }
    return out;
  }
  // SegmentBase or plain BaseURL: one file
  out.segs.push({ url: base, whole: true });
  return out;
}

function rangeAttr(r) {
  if (!r) return null;
  const [s, e] = r.split('-').map(Number);
  return { start: s, end: e };
}

function parseMpd(xml, manifestUrl, quality) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const mpd = doc.documentElement;
  if (!mpd || mpd.localName !== 'MPD') throw new Error('Not a valid DASH manifest');
  if (mpd.getAttribute('type') === 'dynamic') throw new Error('This is a live stream');
  if (doc.getElementsByTagNameNS('*', 'ContentProtection').length) throw new Error('DRM protected');
  const mpdBase = resolveBase(mpd, manifestUrl);
  const periods = childrenByName(mpd, 'Period');
  if (!periods.length) throw new Error('No content in manifest');
  // longest period (skips short ad periods)
  const total = isoDuration(mpd.getAttribute('mediaPresentationDuration'));
  let period = periods[0];
  let periodDur = isoDuration(period.getAttribute('duration')) || total;
  if (periods.length > 1) {
    let bestDur = -1;
    for (const p of periods) { const d = isoDuration(p.getAttribute('duration')) || 0; if (d > bestDur) { bestDur = d; period = p; } }
    periodDur = bestDur || total;
  }
  let bestVideo = null; let bestAudio = null; const videos = [];
  for (const as of childrenByName(period, 'AdaptationSet')) {
    const reps = childrenByName(as, 'Representation');
    for (const rep of reps) {
      const mime = rep.getAttribute('mimeType') || as.getAttribute('mimeType') || '';
      const ct = as.getAttribute('contentType') || mime.split('/')[0];
      const codecs = rep.getAttribute('codecs') || as.getAttribute('codecs') || '';
      const bw = +rep.getAttribute('bandwidth') || 0;
      if (ct === 'video' || (/^video/.test(mime))) {
        const w = +rep.getAttribute('width') || +as.getAttribute('width') || 0;
        const h = +rep.getAttribute('height') || +as.getAttribute('height') || 0;
        const score = w * h * 1e4 + bw / 1000;
        videos.push({ rep, as, score, w, h, width: w, height: h, bandwidth: bw, mime, codecs });
      } else if (ct === 'audio' || /^audio/.test(mime)) {
        if (!bestAudio || bw > bestAudio.bw) bestAudio = { rep, as, bw, mime, codecs };
      }
    }
  }
  bestVideo = D.choose(videos, quality);
  if (!bestVideo) throw new Error('No video track in manifest');
  const v = segmentsFor(bestVideo.rep, bestVideo.as, period, mpdBase, periodDur);
  const a = bestAudio ? segmentsFor(bestAudio.rep, bestAudio.as, period, mpdBase, periodDur) : null;
  return { video: { ...v, mime: bestVideo.mime, height: bestVideo.h }, audio: a ? { ...a, mime: bestAudio.mime } : null };
}

async function downloadDashTrack(track, signal, onProg) {
  const parts = [];
  if (track.init) parts.push(track.init);
  parts.push(...track.segs);
  let done = 0;
  const whole = parts.length === 1 && parts[0].whole;
  const chunks = await pool(parts, async (p) => {
    const { bytes } = await fetchBytes(p.url, {
      signal, range: p.range,
      onProgress: whole ? (got, total) => onProg(total ? got / total : 0.5, 1) : undefined
    });
    done++;
    if (!whole) onProg(done, parts.length);
    return bytes;
  }, signal);
  const ext = /webm/.test(track.mime) ? 'webm' : 'mp4';
  return { data: concat(chunks), ext };
}

async function doDash(job, signal, report) {
  report(0.01, 'Reading stream…', true);
  const isInline = !!job.manifest;
  const xml = isInline ? job.manifest : await fetchText(job.url, signal);
  const base = isInline ? (job.pageUrl || 'https://example.invalid/') : job.url;
  const { video, audio } = parseMpd(xml, base, job.quality);
  await allowHosts(job.id, [video.segs[0] && video.segs[0].url, audio && audio.segs[0] && audio.segs[0].url, isInline ? null : job.url].filter(Boolean));
  report(0.02, video.height ? `Best quality: ${video.height}p` : 'Downloading…', true);
  const state = { v: 0, a: audio ? 0 : 1 };
  const upd = () => report(0.03 + 0.86 * ((state.v + state.a) / 2), `Downloading ${Math.round(((state.v + state.a) / 2) * 100)}%`);
  const [vt, at] = await Promise.all([
    downloadDashTrack(video, signal, (d, t) => { state.v = d / t; upd(); }),
    audio ? downloadDashTrack(audio, signal, (d, t) => { state.a = d / t; upd(); }) : Promise.resolve(null)
  ]);
  return finish(vt, at, report);
}

// Image collections use ZIP store mode: already-compressed images need no recompression.
async function doZip(job, signal, report) {
  const entries = []; let total = 0;
  for (const [index, item] of job.items.entries()) {
    if (signal.aborted) throw new Error('canceled');
    const { bytes, type } = await fetchBytes(item.url, { signal });
    if (!/^image\//i.test(type)) throw new Error('The server returned an unsupported image format. Reload the source page.');
    total += bytes.length;
    if (total > 256 * 1024 * 1024) throw new Error('Collection exceeds the 256 MB browser memory limit. Select fewer images.');
    entries.push({ name: item.filename, bytes });
    if (job.exportMetadata) entries.push({ name: item.filename + '.json', bytes: new TextEncoder().encode(JSON.stringify(D.metadata(item, job.page || {}), null, 2)) });
    report((index + 1) / job.items.length, `Collecting image ${index + 1} of ${job.items.length}`, true);
  }
  return { files: [{ blobUrl: URL.createObjectURL(D.zip(entries)), ext: 'zip', last: true }] };
}
