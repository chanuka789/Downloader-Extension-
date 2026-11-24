/*
 * Captures real MediaHarbor UI states on original demo pages, for the store images.
 * Usage: node tools/store/capture.js <demoDir> <outDir>
 */
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const [demo, out] = process.argv.slice(2).map((p) => path.resolve(p));
const ROOT = path.resolve(__dirname, '..', '..');
const EXT = path.join(ROOT, 'extension');
const TESTS = path.join(ROOT, 'tests');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const certs = path.join(TESTS, 'certs');
  if (!fs.existsSync(path.join(certs, 'cert.pem'))) {
    fs.mkdirSync(certs, { recursive: true });
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(certs, 'key.pem'), '-out', path.join(certs, 'cert.pem'), '-days', '30', '-subj', '/CN=localhost'], { stdio: 'ignore' });
  }
  const procs = [
    spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { cwd: demo, stdio: 'ignore' }),
    spawn('python3', [path.join(TESTS, 'https_server.py'), '8443', demo], { stdio: 'ignore' }),
    spawn('python3', [path.join(TESTS, 'test_proxy.py'), '8899', '8443', 'www.wanderlust-journal.com'], { stdio: 'ignore' })
  ];
  await sleep(900);
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'mh-store-')), {
    channel: 'chromium', headless: true, ignoreHTTPSErrors: true, deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--proxy-server=http://127.0.0.1:8899', '--ignore-certificate-errors']
  });
  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker');
    const id = sw.url().split('/')[2];
    await sleep(1500);

    // 1. demo blog
    const blog = await ctx.newPage();
    await blog.setViewportSize({ width: 1280, height: 800 });
    await blog.goto('https://www.wanderlust-journal.com/blog.html');
    await blog.evaluate(() => window.scrollTo(0, 500));
    await sleep(1200);
    await blog.evaluate(() => window.scrollTo(0, 0));
    await sleep(2500);
    await blog.screenshot({ path: path.join(out, 'blog.png') });
    const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://www.wanderlust-journal.com/*' }))[0].id);

    const shot = async (name, url, w, h, opts = {}) => {
      const p = await ctx.newPage();
      await p.setViewportSize({ width: w, height: h });
      await p.emulateMedia({ colorScheme: opts.dark ? 'dark' : 'light' });
      await p.goto(`chrome-extension://${id}/${url}`);
      await p.waitForSelector('.card');
      await sleep(3000);
      if (opts.before) await opts.before(p);
      await p.screenshot({ path: path.join(out, name) });
      await p.close();
    };
    const selectSome = (n) => async (p) => {
      const boxes = p.locator('.card .cb');
      for (let i = 0; i < n; i++) await boxes.nth(i).check({ force: true });
      await p.mouse.move(5, 5);
      await sleep(400);
    };

    await shot('popup-light.png', `ui/popup.html?tab=${tabId}`, 480, 596);
    await shot('popup-dark.png', `ui/popup.html?tab=${tabId}`, 480, 596, { dark: true });
    await shot('manager-light.png', `ui/manager.html?tab=${tabId}`, 1440, 900, { before: selectSome(4) });
    await shot('manager-dark.png', `ui/manager.html?tab=${tabId}`, 1440, 900, { dark: true });
    await shot('tablet-light.png', `ui/manager.html?tab=${tabId}`, 820, 1180);
    await shot('mobile-dark.png', `ui/manager.html?tab=${tabId}`, 390, 844, { dark: true });
    await shot('mobile-light.png', `ui/manager.html?tab=${tabId}`, 390, 844);

    // streams being prepared (job panel shown with example progress)
    await sw.evaluate((t) => {
      const mk = (jid, title, progress, stage) => jobs.set(jid, { id: jid, tabId: t, itemId: jid, title, kind: 'hls', mode: 'hls', status: 'running', progress, stage, error: '' });
      mk('demo1', 'Wanderlust Journal 1080p.mp4', 0.64, 'Downloading parts 32 of 50');
      mk('demo2', 'Flight over the Alps 1080p.mp4', 0.93, 'Joining video and audio…');
    }, tabId);
    await shot('manager-videos.png', `ui/manager.html?tab=${tabId}&filter=video`, 1440, 660, {
      before: async () => { await sw.evaluate(() => broadcastJobs()); await sleep(500); }
    });
    await sw.evaluate(() => { jobs.delete('demo1'); jobs.delete('demo2'); broadcastJobs(); });

    // 2. social feed with in-page buttons
    const feed = await ctx.newPage();
    await feed.setViewportSize({ width: 1000, height: 960 });
    await feed.goto('https://www.instagram.com/feed.html');
    await sleep(3000);
    await feed.screenshot({ path: path.join(out, 'feed.png') });
    await feed.evaluate(() => window.scrollTo(0, 540));
    await sleep(800);
    await feed.screenshot({ path: path.join(out, 'feed-carousel.png') });
    await feed.evaluate(() => window.scrollTo(0, 0));
    await sleep(600);
    await feed.locator('mediaharbor-overlay .bar button', { hasText: 'Select' }).first().click();
    await sleep(500);
    await feed.locator('mediaharbor-overlay .bar button', { hasText: 'Select all' }).click();
    await sleep(800);
    await feed.screenshot({ path: path.join(out, 'feed-select.png') });
    console.log('captured', fs.readdirSync(out).join(', '));
  } finally {
    await ctx.close();
    procs.forEach((p) => p.kill());
  }
})();
