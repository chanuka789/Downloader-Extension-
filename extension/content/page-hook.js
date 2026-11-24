/*
 * MediaHarbor – page hook (runs in the page's MAIN world, document_start).
 * Social sites load posts with fetch/XHR as you scroll. This hook reads those
 * JSON responses (read-only, the page is not changed) and forwards the
 * high-quality media it finds to the content script.
 */
(function () {
  'use strict';
  const host = location.hostname;
  const ACTIVE = /(^|\.)(instagram\.com|facebook\.com|fb\.watch|threads\.net|threads\.com|x\.com|twitter\.com|tiktok\.com)$/.test(host);
  if (!ACTIVE || window.__mediaHarborHooked) return;
  Object.defineProperty(window, '__mediaHarborHooked', { value: true });

  const X = window.__mediaHarborExtract;
  if (!X) return;

  const MAX_BODY = 15 * 1024 * 1024;
  let queue = [];
  let timer = null;

  function flush() {
    timer = null;
    if (!queue.length) return;
    const items = queue; queue = [];
    try { window.postMessage({ __mediaHarbor: 'media', items }, location.origin); } catch (e) { /* ignore */ }
  }

  function handleText(text) {
    if (typeof text !== 'string' || text.length > MAX_BODY || !X.mightContainMedia(text)) return;
    const run = () => {
      try {
        for (const data of X.parseLoose(text)) {
          const found = X.extract(data);
          if (found.length) queue.push(...found);
        }
        if (queue.length && !timer) timer = setTimeout(flush, 300);
      } catch (e) { /* never break the page */ }
    };
    (window.requestIdleCallback || setTimeout)(run);
  }

  function interesting(contentType) {
    return !contentType || /json|javascript|text\/plain|text\/html/.test(contentType);
  }

  // ---- fetch ----
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    const wrapped = function (...args) {
      const p = origFetch.apply(this, args);
      p.then((res) => {
        try {
          if (!res || res.type === 'opaque') return;
          const ct = res.headers.get('content-type') || '';
          if (!interesting(ct)) return;
          const len = +res.headers.get('content-length') || 0;
          if (len > MAX_BODY) return;
          res.clone().text().then(handleText, () => {});
        } catch (e) { /* ignore */ }
      }, () => {});
      return p;
    };
    try {
      Object.defineProperty(wrapped, 'toString', { value: () => origFetch.toString() });
      window.fetch = wrapped;
    } catch (e) { /* ignore */ }
  }

  // ---- XMLHttpRequest ----
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origSend = XHR.prototype.send;
    XHR.prototype.send = function (...args) {
      try {
        this.addEventListener('load', function () {
          try {
            const rt = this.responseType;
            if (rt === '' || rt === 'text') handleText(this.responseText);
            else if (rt === 'json' && this.response) {
              const found = X.extract(this.response);
              if (found.length) { queue.push(...found); if (!timer) timer = setTimeout(flush, 300); }
            }
          } catch (e) { /* ignore */ }
        });
      } catch (e) { /* ignore */ }
      return origSend.apply(this, args);
    };
  }
})();
