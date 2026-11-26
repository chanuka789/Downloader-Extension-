/* Shared, dependency-free download policy and ZIP writer (store method, ZIP32). */
(function (root) {
  const defaults = { quality: 'best', maxConcurrent: 3, duplicatePolicy: 'warn', filenameTemplate: '', exportMetadata: false, sitePreferences: {} };
  function site(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }
  function effective(settings, url) { return { ...defaults, ...settings, ...(settings.sitePreferences || {})[site(url)] }; }
  function choose(list, quality = 'best') {
    const sorted = [...list].sort((a, b) => ((b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)) || ((b.bandwidth || 0) - (a.bandwidth || 0)));
    if (quality === 'smallest') return sorted.at(-1);
    if (+quality) return sorted.find(v => Math.min(v.width || v.height, v.height || v.width) <= +quality) || sorted.at(-1);
    return sorted[0];
  }
  function component(value) {
    let s = String(value || '').replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').trim().replace(/^\.+|[. ]+$/g, '').slice(0, 80);
    if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = '_' + s;
    return s || 'media';
  }
  function template(pattern, data) {
    return String(pattern).split(/[\\/]/).filter(Boolean).slice(0, 8).map(p => component(p.replace(/\{([\w-]+)\}/g, (_, k) => component(data[k])))).join('/');
  }
  function error(e) {
    const s = String(e && e.message || e || 'Unknown error');
    if (/drm|encrypted|SAMPLE-AES/i.test(s)) return 'This video is protected (DRM) and cannot be downloaded.';
    if (/live/i.test(s)) return 'Live stream: retry after the broadcast ends.';
    if (/401|403|forbidden|SERVER_UNAUTHORIZED|SERVER_FORBIDDEN/i.test(s)) return 'Login required or link expired. Open the source page, sign in, rescan, and retry.';
    if (/404|410|SERVER_BAD_CONTENT/i.test(s)) return 'File unavailable or link expired. Reload the source page and rescan.';
    if (/network|fetch|NETWORK_|timeout/i.test(s)) return 'Network interrupted. Check your connection and retry; expired links need a fresh scan.';
    if (/unsupported|codec|manifest|format/i.test(s)) return 'Unsupported media format. Try a direct file or another available quality.';
    if (/memory|allocation|RangeError/i.test(s)) return 'This file is too large to process in browser memory. Try a smaller quality.';
    return s.slice(0, 200);
  }
  function metadata(item, page) { return { creator: item.creator || '', caption: item.caption || item.alt || '', title: item.title || page.title || '', sourceUrl: page.url || '', mediaUrl: item.url, downloadedAt: new Date().toISOString(), width: item.width || 0, height: item.height || 0 }; }
  function zip(entries) {
    if (entries.length > 65535) throw new Error('Too many ZIP entries');
    const enc = new TextEncoder(), parts = [], central = []; let offset = 0, csize = 0;
    function header(size) { const b = new Uint8Array(size); return [b, new DataView(b.buffer)]; }
    for (const entry of entries) {
      const name = enc.encode(entry.name), bytes = entry.bytes; let crc = 0xffffffff;
      for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
      crc = (crc ^ 0xffffffff) >>> 0;
      if (offset + bytes.length + name.length + 30 > 0xffffffff || name.length > 65535) throw new Error('ZIP too large');
      const [local, l] = header(30); l.setUint32(0, 0x04034b50, true); l.setUint16(4, 20, true); l.setUint16(6, 0x800, true); l.setUint32(14, crc, true); l.setUint32(18, bytes.length, true); l.setUint32(22, bytes.length, true); l.setUint16(26, name.length, true);
      parts.push(local, name, bytes);
      const [c, v] = header(46); v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x800, true); v.setUint32(16, crc, true); v.setUint32(20, bytes.length, true); v.setUint32(24, bytes.length, true); v.setUint16(28, name.length, true); v.setUint32(42, offset, true);
      central.push(c, name); csize += c.length + name.length; offset += local.length + name.length + bytes.length;
    }
    const [end, v] = header(22); v.setUint32(0, 0x06054b50, true); v.setUint16(8, entries.length, true); v.setUint16(10, entries.length, true); v.setUint32(12, csize, true); v.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }
  root.MHDownloadTools = { defaults, site, effective, choose, component, template, error, metadata, zip };
})(globalThis);
