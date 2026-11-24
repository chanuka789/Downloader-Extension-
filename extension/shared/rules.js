/*
 * MediaHarbor – quality rules.
 * Turns thumbnail / resized image URLs into the largest version a site offers.
 * Used by the content script and the service worker (context menu).
 * Every rule returns { url, fallback } – the fallback is the original URL,
 * used by the UI if the upgraded URL does not load.
 */
(function (root) {
  'use strict';

  const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg|heic|jfif|tiff?)(?=$|[?#])/i;
  const VIDEO_EXT = /\.(mp4|m4v|webm|mov|mkv|ogv|3gp|flv)(?=$|[?#])/i;
  const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)(?=$|[?#])/i;
  const HLS_EXT = /\.m3u8(?=$|[?#])/i;
  const DASH_EXT = /\.mpd(?=$|[?#])/i;

  function safeURL(u, base) {
    try { return new URL(u, base || (typeof location !== 'undefined' ? location.href : undefined)); }
    catch (e) { return null; }
  }

  const rules = [
    // X / Twitter images: ?name=small -> ?name=orig
    {
      test: (u) => u.hostname === 'pbs.twimg.com' && u.pathname.startsWith('/media/'),
      apply(u) {
        const fmt = u.searchParams.get('format') || (u.pathname.match(/\.(\w+)$/) || [])[1] || 'jpg';
        const id = u.pathname.replace(/\.\w+$/, '').replace(/:\w+$/, '');
        return `https://pbs.twimg.com${id}?format=${fmt}&name=orig`;
      }
    },
    // Pinterest: /236x/ /474x/ /736x/ -> /originals/
    {
      test: (u) => u.hostname === 'i.pinimg.com' && /^\/\d+x(\d+)?\//.test(u.pathname),
      apply: (u) => `https://i.pinimg.com${u.pathname.replace(/^\/\d+x(\d+)?\//, '/originals/')}`
    },
    // Reddit previews -> i.redd.it originals
    {
      test: (u) => u.hostname === 'preview.redd.it',
      apply: (u) => `https://i.redd.it${u.pathname}`
    },
    // Wikimedia thumbnails -> original file
    {
      test: (u) => u.hostname === 'upload.wikimedia.org' && u.pathname.includes('/thumb/'),
      apply(u) {
        const p = u.pathname.replace('/thumb/', '/').replace(/\/[^/]+$/, '');
        return `https://upload.wikimedia.org${p}`;
      }
    },
    // Google user content / Blogger: =w200-h200 or /s320/ -> original size
    {
      test: (u) => /(^|\.)googleusercontent\.com$|(^|\.)bp\.blogspot\.com$|^blogger\.googleusercontent\.com$/.test(u.hostname),
      apply(u) {
        let s = u.href;
        if (/=[swh]\d+[^/]*$/.test(u.pathname)) s = s.replace(/=[^/=]*$/, '=s0');
        s = s.replace(/\/[swh]\d+(-[a-z0-9-]+)?\//i, '/s0/');
        return s;
      }
    },
    // YouTube thumbnails -> maxres
    {
      test: (u) => /(^|\.)ytimg\.com$/.test(u.hostname) && /\/vi(_webp)?\/[^/]+\/(default|mqdefault|hqdefault|sddefault|hq720)[^/]*\.(jpg|webp)/.test(u.pathname),
      apply: (u) => `https://i.ytimg.com${u.pathname.replace(/\/(default|mqdefault|hqdefault|sddefault|hq720)[^/]*\.(jpg|webp)$/, '/maxresdefault.$2')}`
    },
    // Unsplash: remove resizing params
    {
      test: (u) => u.hostname === 'images.unsplash.com',
      apply(u) {
        ['w', 'h', 'fit', 'crop', 'q', 'auto', 'dpr', 'ixlib', 'fm'].forEach((k) => u.searchParams.delete(k));
        u.searchParams.set('q', '100');
        return u.href;
      }
    },
    // Amazon: ._AC_SX300_.jpg -> .jpg
    {
      test: (u) => /(^|\.)media-amazon\.com$|(^|\.)ssl-images-amazon\.com$/.test(u.hostname) && /\._[^/]+_\.(jpe?g|png|webp)$/i.test(u.pathname),
      apply: (u) => u.origin + u.pathname.replace(/\._[^/]+_\.(jpe?g|png|webp)$/i, '.$1')
    },
    // WordPress Jetpack CDN (i0.wp.com): drop resize params
    {
      test: (u) => /^i\d\.wp\.com$/.test(u.hostname) && (u.searchParams.has('resize') || u.searchParams.has('w') || u.searchParams.has('fit')),
      apply(u) { ['resize', 'w', 'h', 'fit', 'quality', 'ssl'].forEach((k) => u.searchParams.delete(k)); return u.href; }
    },
    // WordPress generated sizes: image-300x200.jpg -> image.jpg
    {
      test: (u) => u.pathname.includes('/wp-content/uploads/') && /-\d{2,4}x\d{2,4}\.(jpe?g|png|webp|gif)$/i.test(u.pathname),
      apply: (u) => u.origin + u.pathname.replace(/-\d{2,4}x\d{2,4}(\.(jpe?g|png|webp|gif))$/i, '$1')
    },
    // Shopify: _300x300.jpg / _small.jpg -> original
    {
      test: (u) => /(^|\.)shopify\.com$|cdn\.shopify\.com$/.test(u.hostname) && /_(\d+x\d*|\d*x\d+|pico|icon|thumb|small|compact|medium|large|grande|\d+x)(@\dx)?(_crop_\w+)?\.(jpe?g|png|webp|gif)$/i.test(u.pathname),
      apply(u) {
        u.searchParams.delete('width'); u.searchParams.delete('height');
        return u.origin + u.pathname.replace(/_(\d+x\d*|\d*x\d+|pico|icon|thumb|small|compact|medium|large|grande|\d+x)(@\dx)?(_crop_\w+)?(\.(jpe?g|png|webp|gif))$/i, '$4') + (u.search || '');
      }
    },
    // Tumblr: _250.jpg / _500.jpg -> _1280.jpg (old style URLs)
    {
      test: (u) => /\.media\.tumblr\.com$/.test(u.hostname) && /_(75sq|100|250|400|500|540|640)\.(jpe?g|png|gif)$/i.test(u.pathname),
      apply: (u) => u.origin + u.pathname.replace(/_(75sq|100|250|400|500|540|640)\.(jpe?g|png|gif)$/i, '_1280.$2')
    },
    // Imgur: abc123m.jpg (thumb suffix) -> abc123.jpg
    {
      test: (u) => u.hostname === 'i.imgur.com' && /^\/[a-zA-Z0-9]{7}[sbtmlh]\.(jpe?g|png|gif|webp)$/.test(u.pathname),
      apply: (u) => u.origin + u.pathname.replace(/^\/([a-zA-Z0-9]{7})[sbtmlh]\./, '/$1.')
    },
    // Flickr: _m.jpg / _n.jpg / _z.jpg -> _b.jpg (1024px; larger needs secret)
    {
      test: (u) => /(^|\.)staticflickr\.com$/.test(u.hostname) && /_[mnzstqw]\.jpg$/.test(u.pathname),
      apply: (u) => u.origin + u.pathname.replace(/_[mnzstqw]\.jpg$/, '_b.jpg')
    },
    // Generic CDN resize params (Cloudinary-like / imgix): only when clearly resizing
    {
      test: (u) => /(^|\.)imgix\.net$/.test(u.hostname) && (u.searchParams.has('w') || u.searchParams.has('h')),
      apply(u) { ['w', 'h', 'fit', 'crop', 'dpr', 'q', 'auto'].forEach((k) => u.searchParams.delete(k)); return u.href; }
    },
    {
      test: (u) => u.hostname === 'res.cloudinary.com' && /\/(image|video)\/upload\/[^/]*(w_|h_|c_|q_)[^/]*\//.test(u.pathname),
      apply: (u) => u.origin + u.pathname.replace(/\/(image|video)\/upload\/[^/]*(w_|h_|c_|q_)[^/]*\//, '/$1/upload/')
    }
  ];

  function upgrade(rawUrl, base) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    if (rawUrl.startsWith('data:')) return { url: rawUrl, fallback: null };
    const u = safeURL(rawUrl, base);
    if (!u || !/^https?:$/.test(u.protocol)) return null;
    const original = u.href;
    for (const r of rules) {
      try {
        if (r.test(u)) {
          const next = r.apply(new URL(original));
          if (next && next !== original) return { url: next, fallback: original };
          break;
        }
      } catch (e) { /* ignore broken rule */ }
    }
    return { url: original, fallback: null };
  }

  function kindFromUrl(url, mime) {
    mime = (mime || '').toLowerCase();
    if (mime.includes('mpegurl') || HLS_EXT.test(url)) return 'hls';
    if (mime.includes('dash+xml') || DASH_EXT.test(url)) return 'dash';
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('video/')) return 'video';
    if (mime.startsWith('audio/')) return 'audio';
    if (url.startsWith('data:image/')) return 'image';
    if (VIDEO_EXT.test(url)) return 'video';
    if (IMAGE_EXT.test(url)) return 'image';
    if (AUDIO_EXT.test(url)) return 'audio';
    return null;
  }

  /** Hosts where we never offer video downloads (store policy / DRM). */
  function isBlockedVideoHost(hostname) {
    return /(^|\.)(youtube\.com|youtu\.be|googlevideo\.com|youtube-nocookie\.com|netflix\.com|nflxvideo\.net|disneyplus\.com|primevideo\.com|hulu\.com|max\.com|hbomax\.com|spotify\.com|apple\.com)$/i.test(hostname || '');
  }

  root.MHRules = { upgrade, kindFromUrl, isBlockedVideoHost, IMAGE_EXT, VIDEO_EXT, HLS_EXT, DASH_EXT };
})(typeof globalThis !== 'undefined' ? globalThis : self);
