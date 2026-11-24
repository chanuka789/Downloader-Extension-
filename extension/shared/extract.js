/*
 * MediaHarbor – structured data extractor.
 * Walks JSON (API responses or embedded page data) and finds the
 * highest-quality media that social sites describe:
 *   Instagram / Threads : image_versions2, video_versions, video_dash_manifest
 *   Facebook            : browser_native_hd_url, playable_url_quality_hd, hd_src, manifests
 *   X / Twitter         : video_info.variants (highest bitrate), media_url_https
 *   TikTok              : playAddr / downloadAddr / bitrateInfo
 *   Any site            : JSON-LD contentUrl
 * Runs in the page (MAIN world) and in the content script, so it must not
 * depend on any extension API.
 */
(function (root) {
  'use strict';
  if (root.__mediaHarborExtract) return;

  const MAX_NODES = 250000;

  const isHttp = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);
  const area = (c) => (Number(c.width) || 0) * (Number(c.height) || 0);

  function best(list, scoreFn) {
    let top = null; let topScore = -1;
    for (const c of list) {
      if (!c) continue;
      const s = scoreFn(c);
      if (s > topScore) { top = c; topScore = s; }
    }
    return top;
  }

  function looksLikeMpd(s) {
    return typeof s === 'string' && s.length > 80 && s.length < 2000000 && /<MPD[\s>]/.test(s.slice(0, 4000));
  }

  function mpdMaxHeight(xml) {
    let h = 0; let w = 0;
    const re = /<Representation\b[^>]*?\bheight="(\d+)"[^>]*>/g;
    let m;
    while ((m = re.exec(xml))) {
      const hh = +m[1];
      if (hh > h) {
        h = hh;
        const wm = /\bwidth="(\d+)"/.exec(m[0]);
        w = wm ? +wm[1] : 0;
      }
    }
    return { width: w, height: h };
  }

  function fbImageHost(u) {
    return /fbcdn\.net|cdninstagram\.com|fbsbx\.com/.test(u);
  }

  /**
   * @param {any} data parsed JSON
   * @returns {Array<{kind:string,url:string,width?:number,height?:number,title?:string,thumb?:string,manifest?:string,hasAudio?:boolean,note?:string}>}
   */
  function extract(data) {
    const out = [];
    const seen = new Set();
    const push = (item) => {
      if (!item || !item.url) return;
      const key = item.kind + '|' + (item.manifest ? item.manifest.length + item.url : item.url);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(item);
    };

    const stack = [data];
    let count = 0;
    while (stack.length && count < MAX_NODES) {
      const node = stack.pop();
      count++;
      if (!node || typeof node !== 'object') continue;
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          const v = node[i];
          if (v && typeof v === 'object') stack.push(v);
        }
        continue;
      }

      handleObject(node, push);

      for (const k in node) {
        const v = node[k];
        if (v && typeof v === 'object') stack.push(v);
      }
    }
    return out;
  }

  function titleFor(o) {
    const user = (o.user && (o.user.username || o.user.full_name)) || (o.owner && o.owner.username) || '';
    const code = o.code || o.shortcode || '';
    const t = [user, code].filter(Boolean).join('_');
    return t || undefined;
  }

  function handleObject(o, push) {
    // ---------- Instagram / Threads (private API) ----------
    let igThumb;
    if (o.image_versions2 && Array.isArray(o.image_versions2.candidates)) {
      const c = best(o.image_versions2.candidates, area);
      if (c && isHttp(c.url)) {
        igThumb = c.url;
        // Only list the photo itself when the post is not a video.
        if (!o.video_versions && !o.video_dash_manifest) {
          push({ kind: 'image', url: c.url, width: c.width, height: c.height, title: titleFor(o) });
        }
      }
    }
    if (Array.isArray(o.video_versions) && o.video_versions.length) {
      const v = best(o.video_versions, (c) => area(c) * 10 + (Number(c.type) || 0));
      if (v && isHttp(v.url)) {
        push({ kind: 'video', url: v.url, width: v.width || o.original_width, height: v.height || o.original_height, title: titleFor(o), thumb: igThumb, hasAudio: o.has_audio !== false });
      }
    }
    if (looksLikeMpd(o.video_dash_manifest)) {
      const dim = mpdMaxHeight(o.video_dash_manifest);
      push({ kind: 'dash', url: 'mpd:' + (o.id || o.pk || o.code || o.video_dash_manifest.length), manifest: o.video_dash_manifest, width: dim.width, height: dim.height, title: titleFor(o), thumb: igThumb, note: 'Best quality (video + audio merged)' });
    }
    // Instagram profile picture in HD
    if (o.hd_profile_pic_url_info && isHttp(o.hd_profile_pic_url_info.url)) {
      const c = o.hd_profile_pic_url_info;
      push({ kind: 'image', url: c.url, width: c.width, height: c.height, title: (o.username || 'profile') + '_profile' });
    }
    // Instagram legacy GraphQL
    if (Array.isArray(o.display_resources) && o.display_resources.length) {
      const c = best(o.display_resources, (r) => (r.config_width || 0) * (r.config_height || 0));
      if (c && isHttp(c.src) && !o.is_video) push({ kind: 'image', url: c.src, width: c.config_width, height: c.config_height, title: titleFor(o) });
    } else if (isHttp(o.display_url) && !o.is_video && o.dimensions) {
      push({ kind: 'image', url: o.display_url, width: o.dimensions.width, height: o.dimensions.height, title: titleFor(o) });
    }
    if (isHttp(o.video_url) && (o.is_video || /\.mp4/.test(o.video_url))) {
      push({ kind: 'video', url: o.video_url, width: o.dimensions && o.dimensions.width, height: o.dimensions && o.dimensions.height, title: titleFor(o), thumb: o.display_url });
    }

    // ---------- Facebook ----------
    const fbHd = o.browser_native_hd_url || o.playable_url_quality_hd || o.hd_src_no_ratelimit || o.hd_src;
    const fbSd = o.browser_native_sd_url || o.playable_url || o.sd_src_no_ratelimit || o.sd_src;
    if (isHttp(fbHd) || isHttp(fbSd)) {
      const thumb = (o.preferred_thumbnail && o.preferred_thumbnail.image && o.preferred_thumbnail.image.uri) ||
        (o.thumbnailImage && o.thumbnailImage.uri) || (o.thumbnail && o.thumbnail.uri) || undefined;
      const w = o.original_width || o.width; const h = o.original_height || o.height;
      if (isHttp(fbHd)) push({ kind: 'video', url: fbHd, width: w, height: h, title: o.id ? 'facebook_' + o.id : undefined, thumb, quality: 'HD', hasAudio: true });
      else push({ kind: 'video', url: fbSd, width: w, height: h, title: o.id ? 'facebook_' + o.id : undefined, thumb, quality: 'SD', hasAudio: true });
    }
    // Facebook DASH manifests (highest quality, separate audio/video)
    for (const key of ['dash_manifest', 'manifest_xml', 'dash_manifest_xml']) {
      if (looksLikeMpd(o[key])) {
        const dim = mpdMaxHeight(o[key]);
        push({ kind: 'dash', url: 'mpd:' + (o.id || o.video_id || o[key].length), manifest: o[key], width: dim.width, height: dim.height, title: o.id ? 'facebook_' + o.id : undefined, note: 'Best quality (video + audio merged)' });
      }
    }
    // Facebook photos: { uri, width, height } on fbcdn
    if (isHttp(o.uri) && fbImageHost(o.uri) && Number(o.width) >= 320 && Number(o.height) >= 200 && !/\.mp4/.test(o.uri)) {
      push({ kind: 'image', url: o.uri, width: o.width, height: o.height });
    }

    // ---------- X / Twitter ----------
    if (o.video_info && Array.isArray(o.video_info.variants)) {
      const mp4s = o.video_info.variants.filter((v) => v && v.content_type === 'video/mp4' && isHttp(v.url));
      const v = best(mp4s, (c) => Number(c.bitrate) || 0);
      if (v) {
        const m = /\/(\d+)x(\d+)\//.exec(v.url);
        push({ kind: 'video', url: v.url, width: m ? +m[1] : undefined, height: m ? +m[2] : undefined, thumb: o.media_url_https, title: o.id_str ? 'x_' + o.id_str : undefined, hasAudio: true });
      }
    } else if (isHttp(o.media_url_https) && o.type === 'photo') {
      const size = o.original_info || {};
      push({ kind: 'image', url: o.media_url_https, width: size.width, height: size.height, title: o.id_str ? 'x_' + o.id_str : undefined });
    }

    // ---------- TikTok ----------
    if (o.playAddr && (o.downloadAddr || o.bitrateInfo || o.cover)) {
      let url = typeof o.playAddr === 'string' ? o.playAddr : null;
      let w = o.width; let h = o.height;
      if (Array.isArray(o.bitrateInfo) && o.bitrateInfo.length) {
        const b = best(o.bitrateInfo, (c) => Number(c.Bitrate) || 0);
        const list = b && b.PlayAddr && (b.PlayAddr.UrlList || b.PlayAddr.url_list);
        if (Array.isArray(list) && isHttp(list[0])) {
          url = list[list.length - 1] || list[0];
          if (b.PlayAddr.Width) { w = b.PlayAddr.Width; h = b.PlayAddr.Height; }
        }
      }
      if (isHttp(url)) push({ kind: 'video', url, width: w, height: h, thumb: o.originCover || o.cover, title: o.id ? 'tiktok_' + o.id : undefined, hasAudio: true });
    }

    // ---------- JSON-LD (any site) ----------
    const t = o['@type'];
    if (t && isHttp(o.contentUrl)) {
      const type = Array.isArray(t) ? t.join(' ') : String(t);
      if (/VideoObject/.test(type)) push({ kind: 'video', url: o.contentUrl, title: o.name, thumb: Array.isArray(o.thumbnailUrl) ? o.thumbnailUrl[0] : o.thumbnailUrl, width: +o.width || undefined, height: +o.height || undefined });
      else if (/ImageObject/.test(type)) push({ kind: 'image', url: o.contentUrl, title: o.name, width: +o.width || undefined, height: +o.height || undefined });
    }
  }

  /** Parse a response body that may be JSON, "for (;;);" JSON or JSON lines. */
  function parseLoose(text) {
    if (typeof text !== 'string' || text.length < 7) return [];
    let s = text.trim();
    if (s.startsWith('for (;;);')) s = s.slice(9);
    if (s[0] !== '{' && s[0] !== '[') return [];
    try { return [JSON.parse(s)]; } catch (e) { /* maybe JSON lines */ }
    const out = [];
    for (const line of s.split('\n')) {
      const l = line.trim();
      if (!l || (l[0] !== '{' && l[0] !== '[')) continue;
      try { out.push(JSON.parse(l)); } catch (e) { /* skip */ }
    }
    return out;
  }

  /** Quick check so we skip parsing unrelated responses. */
  function mightContainMedia(text) {
    return /image_versions2|video_versions|video_dash_manifest|display_resources|playable_url|browser_native_|hd_src|video_info|media_url_https|playAddr|bitrateInfo|"uri":"https?:/.test(text);
  }

  Object.defineProperty(root, '__mediaHarborExtract', {
    value: Object.freeze({ extract, parseLoose, mightContainMedia }),
    configurable: false, enumerable: false, writable: false
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
