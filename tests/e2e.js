/*
 * End-to-end test: loads the unpacked extension in Chromium, opens the local
 * test site, checks what was detected, downloads everything and verifies files.
 * Run: node tests/e2e.js   (needs python3 and ffprobe for the checks)
 */
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const EXT = path.resolve(__dirname, '..', 'extension');
const SITE = path.resolve(__dirname, 'site');
const SHOTS = path.resolve(process.env.SHOTS || path.join(__dirname, 'screenshots'));
const PORT = 8765;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const probe = (f) => {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'json', f]).toString();
    return JSON.parse(out).streams;
  } catch (e) { return null; }
};

function check(cond, msg) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) process.exitCode = 1;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  // throw-away self-signed certificate for the local HTTPS test server
  const certs = path.join(__dirname, 'certs');
  if (!fs.existsSync(path.join(certs, 'cert.pem'))) {
    fs.mkdirSync(certs, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(certs, 'key.pem'), '-out', path.join(certs, 'cert.pem'), '-days', '30', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  }
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: SITE, stdio: 'ignore' });
  const httpsServer = spawn('python3', [path.join(__dirname, 'https_server.py'), '8443', SITE], { stdio: 'ignore' });
  const proxy = spawn('python3', [path.join(__dirname, 'test_proxy.py'), '8899', '8443'], { stdio: 'ignore' });
  await sleep(800);
  const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-profile-'));
  const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mh-dl-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium',
    headless: true,
    acceptDownloads: true,
    downloadsPath: dlDir,
    ignoreHTTPSErrors: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--proxy-server=http://127.0.0.1:8899', '--ignore-certificate-errors']
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const extId = sw.url().split('/')[2];
    console.log('extension id', extId);

    // wait until the extension has fully started (it is installed at browser launch here)
    await sw.evaluate(() => new Promise((r) => setTimeout(r, 300)));
    await sleep(1500);
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/index.html`);
    await page.locator('img[data-src]').scrollIntoViewIfNeeded();
    await sleep(3500);
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0].id);

    const items = await sw.evaluate(async (id) => {
      const key = 'tab:' + id;
      await new Promise((r) => setTimeout(r, 1500));
      const saved = (await chrome.storage.local.get(key))[key];
      return saved ? saved.items : [];
    }, tabId);
    const has = (pred) => items.some(pred);
    console.log('detected items:', items.length);
    for (const it of items) console.log('   ', it.kind.padEnd(5), it.source.padEnd(10), (it.width ? it.width + 'x' + it.height : '').padEnd(10), it.url.slice(0, 80), it.drm ? 'DRM' : '');
    check(has((i) => i.url.endsWith('hero-1920.jpg')), 'srcset: picks the 1920w image, not the 480w one');
    check(!has((i) => i.url.endsWith('hero-480.jpg')), 'srcset: small variant not listed separately');
    check(has((i) => i.url.endsWith('photo-large.jpg')), 'normal <img> found');
    check(has((i) => i.url.endsWith('lazy.jpg')), 'lazy-loaded data-src image found');
    check(has((i) => i.url.endsWith('bg.jpg')), 'CSS background image found');
    check(has((i) => i.url.endsWith('linked-full.jpg')), 'linked full-size image / og:image found');
    check(has((i) => i.kind === 'video' && i.url.endsWith('clip.mp4')), '<video> MP4 found');
    check(has((i) => i.kind === 'hls' && i.url.endsWith('master.m3u8') && i.height === 1080), 'HLS master found with best quality 1080p');
    check(!has((i) => i.kind === 'hls' && i.url.endsWith('v0.m3u8')), 'HLS variant playlist hidden (master covers it)');
    check(has((i) => i.kind === 'hls' && i.url.endsWith('enc/index.m3u8') && !i.drm), 'AES-128 HLS found (not marked DRM)');
    check(has((i) => i.kind === 'dash' && i.url.endsWith('stream.mpd') && i.height === 720), 'DASH manifest found (720p)');

    // ---------- UI screenshots ----------
    const shots = [
      { name: 'popup', url: `ui/popup.html?tab=${tabId}`, w: 480, h: 596 },
      { name: 'desktop', url: `ui/manager.html?tab=${tabId}`, w: 1366, h: 860 },
      { name: 'tablet', url: `ui/manager.html?tab=${tabId}`, w: 820, h: 1100 },
      { name: 'mobile', url: `ui/manager.html?tab=${tabId}`, w: 390, h: 844 }
    ];
    for (const s of shots) {
      for (const theme of ['light', 'dark']) {
        const p = await ctx.newPage();
        await p.setViewportSize({ width: s.w, height: s.h });
        await p.emulateMedia({ colorScheme: theme });
        await p.goto(`chrome-extension://${extId}/${s.url}`);
        await p.waitForSelector('.card', { timeout: 8000 });
        await sleep(2500);
        await p.screenshot({ path: path.join(SHOTS, `${s.name}-${theme}.png`) });
        await p.close();
      }
    }

    // ---------- downloads ----------
    const ui = await ctx.newPage();
    await ui.setViewportSize({ width: 1280, height: 860 });
    const errors = [];
    ui.on('pageerror', (e) => errors.push(String(e)));
    await ui.goto(`chrome-extension://${extId}/ui/manager.html?tab=${tabId}`);
    await ui.waitForSelector('.card');
    await sleep(1500);
    check(errors.length === 0, 'no JavaScript errors in the UI ' + (errors[0] || ''));
    const cardCount = await ui.locator('.card').count();
    check(cardCount >= 9, `UI shows the media cards (${cardCount})`);
    check(!items.some((i) => i.url.endsWith('icon.png')), 'tiny 16px icon is ignored');

    // lightbox opens
    await ui.locator('.card .preview').first().click();
    await sleep(500);
    check(await ui.locator('#lightbox[open]').count() === 1, 'preview opens');
    await ui.keyboard.press('Escape');

    // record the file names the extension asks Chrome to use (Playwright renames saved files)
    await sw.evaluate(() => {
      self.__names = {};
      const orig = chrome.downloads.download.bind(chrome.downloads);
      chrome.downloads.download = async (o) => { const id = await orig(o); self.__names[id] = o.filename; return id; };
    });
    await ui.locator('#dlBtn').click();
    // wait for all downloads to complete
    let done = [];
    for (let i = 0; i < 90; i++) {
      await sleep(1000);
      done = await sw.evaluate(async () => (await chrome.downloads.search({})).map((d) => ({ state: d.state, path: d.filename, filename: self.__names[d.id] || '', error: d.error, url: d.url.slice(0, 60), size: d.fileSize })));
      const jobs = await ui.locator('.job').count();
      const running = await ui.locator('.job:not(.done):not(.error)').count();
      if (done.length >= 9 && done.every((d) => d.state !== 'in_progress') && (!jobs || !running)) break;
    }
    await ui.screenshot({ path: path.join(SHOTS, 'downloads-desktop.png') });
    for (const d of done) console.log('   ', d.state.padEnd(11), (d.error || '').padEnd(8), (d.filename || '').padEnd(48), d.size);
    const jobErrors = await ui.locator('.job.error .js').allTextContents();
    check(jobErrors.length === 0, 'no failed stream jobs ' + jobErrors.join(' | '));
    const complete = done.filter((d) => d.state === 'complete');
    check(complete.length >= 9, `downloads complete (${complete.length}/${done.length})`);
    check(complete.every((d) => d.filename.startsWith('MediaHarbor/127.0.0.1/')), 'files saved in MediaHarbor/<site>/ folder');

    const mp4s = complete.filter((d) => /\.mp4$/.test(d.filename) && !/clip/.test(d.filename));
    check(mp4s.length >= 3, `stream videos saved as MP4 (${mp4s.length})`);
    for (const d of mp4s) {
      const s = probe(d.path) || [];
      const v = s.find((x) => x.codec_type === 'video');
      const a = s.find((x) => x.codec_type === 'audio');
      check(!!v && !!a, `${path.basename(d.filename)} has video ${v ? v.width + 'x' + v.height : '-'} and audio ${a ? 'yes' : 'no'}`);
    }
    const hd = complete.find((d) => /hero-1920/.test(d.filename));
    check(!!hd, 'HD srcset image downloaded');

    // ---------- new page in the same tab starts a fresh list ----------
    await page.goto(`http://127.0.0.1:${PORT}/page2.html`);
    await sleep(2500);
    const after = await sw.evaluate((id) => [...tabs.get(id).items.values()].map((i) => i.url.split('/').pop()), tabId);
    check(after.length === 1 && after[0] === 'photo-small.jpg', 'navigating to a new page resets the list: ' + JSON.stringify(after));

    // ---------- Instagram-style feed: page data + HD DASH merge + DRM refusal ----------
    const ig = await ctx.newPage();
    await ig.goto('https://www.instagram.com/ig.html');
    await sleep(3500);
    const igTab = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.instagram.com/*' }))[0].id);
    const igItems = await sw.evaluate((id) => [...tabs.get(id).items.values()], igTab);
    for (const it of igItems) console.log('   ', it.kind.padEnd(5), it.source.padEnd(8), (it.width ? it.width + 'x' + it.height : '').padEnd(10), it.url.slice(0, 60), it.title || '', it.drm ? 'DRM' : '');
    const igHas = (p) => igItems.some(p);
    check(igHas((i) => i.kind === 'image' && i.url.endsWith('photo-large.jpg') && i.width === 2400), 'Instagram: largest photo candidate from page data');
    check(!igHas((i) => i.url.endsWith('photo-small.jpg')), 'Instagram: small candidate not listed');
    check(igHas((i) => i.kind === 'dash' && i.manifest && i.height === 1920), 'Instagram: HD DASH reel found (1080x1920)');
    check(igHas((i) => i.kind === 'video' && i.url.endsWith('clip.mp4')), 'Instagram: progressive MP4 also offered');
    check(igHas((i) => i.kind === 'hls' && i.drm), 'DRM-protected stream detected and marked');
    check(igItems.some((i) => i.title === 'photographer_Cpost1'), 'Instagram: file name from user + post code');

    await sw.evaluate(() => { self.__names = self.__names || {}; });
    const igUi = await ctx.newPage();
    await igUi.setViewportSize({ width: 390, height: 844 });
    await igUi.goto(`chrome-extension://${extId}/ui/manager.html?tab=${igTab}`);
    await igUi.waitForSelector('.card');
    await sleep(1500);
    const drmBtnDisabled = await igUi.locator('.card:has(.badge.warn) .dl-btn').first().isDisabled();
    check(drmBtnDisabled, 'DRM item: download button disabled');
    await igUi.screenshot({ path: path.join(SHOTS, 'instagram-mobile.png') });
    const dashId = igItems.find((i) => i.kind === 'dash').id;
    await igUi.locator(`.card[data-id="${dashId}"] .dl-btn`).click();
    let rec = null;
    for (let i = 0; i < 60 && !rec; i++) {
      await sleep(1000);
      rec = await sw.evaluate(async () => (await chrome.downloads.search({ state: 'complete' })).map((d) => ({ path: d.filename, name: self.__names[d.id] || '' })).find((d) => d.name.includes('instagram.com')));
    }
    await igUi.screenshot({ path: path.join(SHOTS, 'instagram-mobile-done.png') });
    check(!!rec, 'Instagram DASH reel downloaded: ' + (rec ? rec.name : 'none'));
    if (rec) {
      const st = probe(rec.path) || [];
      const v = st.find((x) => x.codec_type === 'video'); const a = st.find((x) => x.codec_type === 'audio');
      check(!!v && v.height === 1920 && !!a, `merged reel has 1080x1920 video + audio (${v ? v.width + 'x' + v.height : '-'}, audio ${a ? 'yes' : 'no'})`);
    }

    // ---------- download buttons inside Instagram pages ----------
    const feed = await ctx.newPage();
    await feed.setViewportSize({ width: 1100, height: 1400 });
    const feedErrors = [];
    feed.on('pageerror', (e) => feedErrors.push(String(e)));
    await feed.goto('https://www.instagram.com/ig-feed.html');
    await sleep(2500);
    const names = () => sw.evaluate(() => Object.values(self.__names));
    const waitNames = async (pred, ms = 20000) => {
      for (let i = 0; i < ms / 500; i++) { const n = await names(); if (pred(n)) return n; await sleep(500); }
      return names();
    };
    const groupsCount = await feed.locator('mediaharbor-overlay .g').count();
    check(groupsCount === 6, `buttons shown on 3 feed posts + 3 grid tiles (${groupsCount})`);
    const carGroup = feed.locator('mediaharbor-overlay .g', { hasText: 'All 3' });
    check(await carGroup.count() === 1, 'carousel post shows "This" + "All 3"');
    await feed.screenshot({ path: path.join(SHOTS, 'instagram-buttons.png') });

    // single photo post
    await feed.locator('mediaharbor-overlay .g').filter({ hasText: 'Download' }).first().click();
    let n = await waitNames((l) => l.some((x) => x.endsWith('/photographer_Cpost1.jpg')));
    check(n.some((x) => x === 'MediaHarbor/instagram.com/photographer_Cpost1.jpg'), 'post button saves the HD photo as photographer_Cpost1.jpg');

    // carousel: move to slide 2, then "This"
    await feed.evaluate(() => { document.getElementById('car').style.transform = 'translateX(-400px)'; });
    await sleep(600);
    await carGroup.locator('button', { hasText: 'This' }).click();
    n = await waitNames((l) => l.some((x) => x.endsWith('carouser_Ccar3xyz_2.jpg')));
    check(n.some((x) => x.endsWith('/carouser_Ccar3xyz_2.jpg')), '"This" saves the visible carousel slide (slide 2)');
    await carGroup.locator('button', { hasText: 'All 3' }).click();
    n = await waitNames((l) => l.some((x) => x.endsWith('carouser_Ccar3xyz_3.mp4')));
    check(['_1.jpg', '_2.jpg', '_3.mp4'].every((sfx) => n.some((x) => x.endsWith('carouser_Ccar3xyz' + sfx))), '"All 3" saves every photo and video of the carousel');

    // grid tile whose post data was never loaded -> fetched from the Instagram web API
    const tiles = feed.locator('mediaharbor-overlay .g .b.round');
    check(await tiles.count() === 3, 'each grid tile has a round download button');
    const tileBoxes = await feed.evaluate(() => [...document.querySelectorAll('.grid a')].map((a) => a.getAttribute('href')));
    await feed.evaluate(() => window.scrollTo(0, 0));
    // the 3rd tile is CnoData9x: find the button closest to it
    const tileRect = await feed.locator('.grid a[href="/p/CnoData9x/"]').boundingBox();
    await feed.mouse.click(tileRect.x + tileRect.width - 8 - 17, tileRect.y + 8 + 17);
    n = await waitNames((l) => l.some((x) => x.endsWith('fallback_CnoData9x.jpg')));
    if (!n.some((x) => x.endsWith('fallback_CnoData9x.jpg'))) console.log('   names:', n.join(' | '));
    check(n.some((x) => x.endsWith('/fallback_CnoData9x.jpg')), 'tile of an unknown post: data fetched, photo saved (' + tileBoxes.length + ' tiles)');

    // bulk: select mode -> select all -> download
    const before = (await names()).length;
    await feed.locator('mediaharbor-overlay .bar button', { hasText: 'Select' }).first().click();
    await sleep(400);
    await feed.locator('mediaharbor-overlay .bar button', { hasText: 'Select all' }).click();
    await sleep(400);
    const goText = await feed.locator('mediaharbor-overlay .bar button.primary').textContent();
    check(await feed.locator('mediaharbor-overlay .ck.on').count() === 6, 'after "Select all" every tick box shows as ticked');
    check(/Download 4/.test(goText), `select all picks the 4 different posts on the page ("${goText.trim()}")`);
    await feed.screenshot({ path: path.join(SHOTS, 'instagram-select.png') });
    await feed.locator('mediaharbor-overlay .bar button.primary').click();
    n = await waitNames((l) => l.length >= before + 6, 30000);
    check(n.length - before >= 6, `bulk download saves all media of the selected posts (${n.length - before} files)`);
    check(feedErrors.length === 0, 'no errors on the Instagram page ' + (feedErrors[0] || ''));

    // reels viewer and stories (data embedded in the page)
    for (const [url, expect, label] of [
      ['https://www.instagram.com/reels/CreelV9/', 'reeluser_CreelV9.mp4', 'Reels viewer'],
      ['https://www.instagram.com/stories/storyuser/9001/', 'storyuser_9001.mp4', 'Stories']
    ]) {
      const p2 = await ctx.newPage();
      await p2.setViewportSize({ width: 900, height: 800 });
      await p2.goto(url);
      await sleep(2000);
      const btn = p2.locator('mediaharbor-overlay .g button', { hasText: 'Download' });
      check(await btn.count() === 1, `${label}: download button shown`);
      if (label === 'Stories') await p2.screenshot({ path: path.join(SHOTS, 'instagram-story.png') });
      if (await btn.count()) {
        await btn.click();
        n = await waitNames((l) => l.some((x) => x.endsWith('/' + expect)));
        check(n.some((x) => x.endsWith('/' + expect)), `${label}: video saved as ${expect}`);
      }
      await p2.close();
    }
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    await ctx.close();
    server.kill();
    httpsServer.kill();
    proxy.kill();
  }
})();
