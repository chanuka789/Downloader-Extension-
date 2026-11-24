/*
 * Builds the Chrome Web Store images from the UI captures.
 * Usage: node tools/store/compose.js <capturesDir> <outDir>
 * Output: 5 screenshots (1280x800), small promo tile (440x280), marquee (1400x560).
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const [caps, out] = process.argv.slice(2).map((p) => path.resolve(p));
const ICON = fs.readFileSync(path.join(__dirname, '..', 'icon.svg'), 'utf8');

const css = `
* { box-sizing: border-box; margin: 0; }
body { width: var(--w); height: var(--h); overflow: hidden; font-family: "Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #fff;
  background: radial-gradient(1200px 700px at 85% -10%, rgba(236,72,153,.55), transparent 60%), radial-gradient(900px 600px at -10% 110%, rgba(34,211,238,.35), transparent 60%), linear-gradient(135deg, #3b2fd6 0%, #6d28d9 50%, #a21caf 100%);
  -webkit-font-smoothing: antialiased; position: relative; }
.grain { position: absolute; inset: 0; background-image: radial-gradient(rgba(255,255,255,.06) 1px, transparent 1px); background-size: 22px 22px; }
h1 { font-size: 48px; line-height: 1.08; font-weight: 800; letter-spacing: -.025em; }
h1 em { font-style: normal; background: linear-gradient(90deg, #fde68a, #fbcfe8); -webkit-background-clip: text; background-clip: text; color: transparent; }
p.sub { font-size: 20px; line-height: 1.4; color: rgba(255,255,255,.86); margin-top: 12px; font-weight: 500; }
.brand { display: flex; align-items: center; gap: 10px; font-weight: 700; font-size: 18px; color: rgba(255,255,255,.95); }
.brand svg { width: 34px; height: 34px; filter: drop-shadow(0 6px 14px rgba(0,0,0,.25)); }
.win { position: absolute; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 40px 90px rgba(18, 8, 60, .55), 0 0 0 1px rgba(255,255,255,.25); }
.win .bar { height: 38px; background: #eef0f6; display: flex; align-items: center; gap: 8px; padding: 0 14px; border-bottom: 1px solid #dfe2ec; }
.win .bar i { width: 11px; height: 11px; border-radius: 50%; background: #ff6159; display: block; }
.win .bar i:nth-child(2) { background: #ffbd2e; } .win .bar i:nth-child(3) { background: #28c941; }
.win .bar span { margin-left: 14px; flex: 1; max-width: 420px; height: 24px; border-radius: 8px; background: #fff; color: #5d6079; font-size: 12.5px; display: flex; align-items: center; padding: 0 12px; }
.win img.shot { display: block; width: 100%; }
.pop { position: absolute; border-radius: 14px; overflow: hidden; box-shadow: 0 30px 70px rgba(18, 8, 60, .55), 0 0 0 1px rgba(20,20,60,.12); background: #fff; }
.pop img { display: block; width: 100%; }
.phone { position: absolute; border-radius: 44px; padding: 12px; background: #0b0b14; box-shadow: 0 40px 90px rgba(10, 5, 40, .6), inset 0 0 0 2px #2a2a3a; }
.phone img { display: block; width: 100%; border-radius: 32px; }
.chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
.chip { padding: 9px 15px; border-radius: 999px; background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.28); font-size: 15px; font-weight: 600; backdrop-filter: blur(6px); display: inline-flex; gap: 8px; align-items: center; }
.chip b { color: #fde68a; }
ul.points { list-style: none; padding: 0; margin-top: 26px; display: grid; gap: 14px; }
ul.points li { font-size: 18px; font-weight: 600; display: flex; gap: 12px; align-items: center; color: rgba(255,255,255,.95); }
ul.points li::before { content: "✓"; width: 26px; height: 26px; border-radius: 50%; background: rgba(255,255,255,.2); display: grid; place-items: center; font-size: 14px; flex: none; }
.arrow { position: absolute; font-size: 15px; font-weight: 700; background: #fff; color: #3b2fd6; padding: 8px 14px; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.25); }
`;

const win = (src, { left, top, width, height, url, cropTop = 0 }) => `
  <div class="win" style="left:${left}px;top:${top}px;width:${width}px;${height ? `height:${height}px;` : ''}">
    <div class="bar"><i></i><i></i><i></i><span>${url}</span></div>
    <div style="overflow:hidden;${height ? `height:${height - 38}px;` : ''}"><img class="shot" src="${src}" style="margin-top:-${cropTop}px"></div>
  </div>`;
const brand = `<div class="brand">${ICON}<span>MediaHarbor</span></div>`;
const ext = (n) => `chrome-extension://mediaharbor/${n}`;

const pages = {
  // 1 — hero: manager with quality badges
  '1-best-quality.png': { w: 1280, h: 800, body: `
    <div style="position:absolute;left:64px;top:56px;width:1150px">${brand}
      <h1 style="margin-top:22px">Save every image &amp; video<br>in the <em>best quality</em></h1>
      <p class="sub">Finds originals, 4K photos and HD videos on the page, automatically.</p></div>
    ${win('manager-light.png', { left: 64, top: 300, width: 1152, height: 560, url: ext('manager.html') })}` },

  // 2 — Instagram buttons
  '2-instagram-buttons.png': { w: 1280, h: 800, body: `
    <div style="position:absolute;left:64px;top:70px;width:400px">${brand}
      <h1 style="margin-top:22px;font-size:44px">Download buttons <em>right on Instagram</em></h1>
      <p class="sub">One click on any post, reel, story or Explore tile, in full quality.</p>
      <div class="chips"><span class="chip">Feed</span><span class="chip">Posts</span><span class="chip">Reels</span><span class="chip">Stories</span><span class="chip">Explore &amp; search</span><span class="chip">Profiles</span></div></div>
    ${win('feed.png', { left: 500, top: 40, width: 740, height: 748, url: 'instagram.com' })}` },

  // 3 — carousels + bulk
  '3-bulk-download.png': { w: 1280, h: 800, body: `
    ${win('feed-select.png', { left: 40, top: 40, width: 740, height: 748, url: 'instagram.com' })}
    <div style="position:absolute;left:820px;top:90px;width:400px">${brand}
      <h1 style="margin-top:22px;font-size:44px">Carousels &amp; <em>bulk download</em></h1>
      <p class="sub">Save one slide or the whole carousel. Select many posts and download them all at once.</p>
      <ul class="points"><li>“This” or “All” on carousels</li><li>Select all posts on a page</li><li>Named by user and post</li></ul></div>` },

  // 4 — HD streams
  '4-hd-video.png': { w: 1280, h: 800, body: `
    <div style="position:absolute;left:64px;top:56px;width:1150px">${brand}
      <h1 style="margin-top:22px">HD videos &amp; streams, <em>saved as one MP4</em></h1>
      <p class="sub">Picks the highest quality and joins video + audio without losing quality.</p></div>
    ${win('manager-videos.png', { left: 64, top: 300, width: 1152, height: 560, url: ext('manager.html') })}` },

  // 5 — popup + responsive
  '5-any-screen.png': { w: 1280, h: 800, body: `
    <div style="position:absolute;left:64px;top:56px;width:460px">${brand}
      <h1 style="margin-top:22px;font-size:44px">Popup, full view,<br><em>light &amp; dark</em></h1>
      <p class="sub">Fits desktop, tablet and phone screens.</p></div>
    ${win('blog.png', { left: 64, top: 290, width: 780, height: 488, url: 'wanderlust-journal.com/blog' })}
    <div class="pop" style="left:560px;top:120px;width:330px">${'<img src="popup-light.png">'}</div>
    <div class="phone" style="left:920px;top:70px;width:300px"><img src="mobile-dark.png"></div>` },

  // small promo tile
  'promo-small-440x280.png': { w: 440, h: 280, body: `
    <div style="position:absolute;left:28px;top:30px;width:390px">
      <div class="brand" style="font-size:22px;gap:12px">${ICON.replace('<svg ', '<svg style="width:46px;height:46px" ')}<span>MediaHarbor</span></div>
      <h1 style="margin-top:18px;font-size:30px">Save images &amp; videos in <em>best quality</em></h1>
      <div class="chips" style="margin-top:16px;gap:6px"><span class="chip" style="font-size:12.5px;padding:6px 11px">4K photos</span><span class="chip" style="font-size:12.5px;padding:6px 11px">HD video</span><span class="chip" style="font-size:12.5px;padding:6px 11px">Instagram</span><span class="chip" style="font-size:12.5px;padding:6px 11px">Bulk</span></div></div>` },

  // marquee
  'promo-marquee-1400x560.png': { w: 1400, h: 560, body: `
    <div style="position:absolute;left:72px;top:92px;width:520px">${brand}
      <h1 style="margin-top:24px;font-size:52px">Save every image &amp; video in the <em>best quality</em></h1>
      <p class="sub">4K photos, HD reels and streams. Download buttons right on Instagram.</p></div>
    ${win('manager-light.png', { left: 640, top: 70, width: 820, height: 560, url: ext('manager.html') })}
    <div class="pop" style="left:600px;top:250px;width:280px"><img src="popup-dark.png"></div>` }
};

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  for (const [name, def] of Object.entries(pages)) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>:root{--w:${def.w}px;--h:${def.h}px}${css}</style></head><body><div class="grain"></div>${def.body}</body></html>`;
    const file = path.join(caps, `compose-${name}.html`);
    fs.writeFileSync(file, html);
    const page = await browser.newPage({ viewport: { width: def.w, height: def.h }, deviceScaleFactor: 1 });
    await page.goto('file://' + file);
    await page.waitForLoadState('load');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, name), omitBackground: false });
    await page.close();
  }
  await browser.close();
  console.log('composed', Object.keys(pages).join(', '));
})();
